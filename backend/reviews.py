"""Teacher-only validation and durable student evidence for Litera.

Every recording take is retained (maximum 3 per prompt). Automatic recognition is
provisional; only an authenticated teacher's finalized review creates evidence.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import speech
from .auth import check_origin
from .comprehension import load_forms as load_comprehension, public_form, score_responses, Response as Answer
from .evidence import AssessmentEvent, Override, Skill
from .evidence_api import save_verified
from .evidence_store import EvidenceStore
from .scoring import Submission, compare, score_probe, to_tree_check

ROOT = Path(__file__).resolve().parents[1]
PASSAGES = ROOT / 'frontend' / 'src' / 'oral' / 'data' / 'passages.json'
MIME_TYPES = {'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'}
WORD_PATTERN = re.compile(r"[^\W\d_]+(?:[’'-][^\W\d_]+)*", re.UNICODE)


def require_teacher(x_teacher_key: str = Header(default='', max_length=512)):
    secret = os.getenv('LITERA_TEACHER_KEY', '')
    if not secret:
        raise HTTPException(503, 'Set LITERA_TEACHER_KEY in .env to enable teacher review.')
    if not secrets.compare_digest(x_teacher_key.encode(), secret.encode()):
        raise HTTPException(403, 'Teacher access required.')
    return True


class ReviewPayload(BaseModel):
    marks: list[Literal['CORRECT', 'INCORRECT']] = Field(min_length=1, max_length=200)
    selectedTakes: list[int] = Field(default_factory=list, max_length=200)
    assisted: bool
    verified: Literal[True]
    note: str = Field(default='', max_length=500)


class ComprehensionSubmission(BaseModel):
    attemptId: UUID
    sessionId: UUID
    formId: str = Field(max_length=64)
    responses: list[Answer] = Field(min_length=1, max_length=200)
    assisted: bool = False


def words(passage: dict) -> list[str]:
    return WORD_PATTERN.findall(passage['text'])


def recommendation_profile(store: EvidenceStore, learner_id: str):
    from .plan import plan_from_profile
    tiers = {Skill.PHONICS: 'CVCC-final-nt', Skill.ORAL: 'short-text', Skill.COMPREHENSION: 'short-text'}
    profile = store.profile(learner_id, tiers)
    # Show the most recent documented teacher override, without altering raw scores.
    if profile['overrides']:
        latest = profile['overrides'][-1]
        profile = store.profile(learner_id, tiers, override_session=latest.sessionId)
    profile['recommendation'] = plan_from_profile(profile)
    return json.loads(json.dumps(profile, default=lambda value: value.model_dump(mode='json') if hasattr(value, 'model_dump') else str(value)))


class ReviewRepository:
    def __init__(self, path: str | Path, forms: dict, store: EvidenceStore):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.forms = forms
        self.comprehension = load_comprehension()
        self.passages = {p['formId']: p for p in json.loads(PASSAGES.read_text(encoding='utf-8'))}
        self.store = store
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS submissions (
                    id TEXT PRIMARY KEY, learner TEXT NOT NULL, session TEXT NOT NULL,
                    skill TEXT NOT NULL, form TEXT NOT NULL, created_at TEXT NOT NULL,
                    assisted INTEGER NOT NULL DEFAULT 0,
                    provisional TEXT, result TEXT
                );
                CREATE INDEX IF NOT EXISTS student_submissions ON submissions(learner, created_at);
                CREATE TABLE IF NOT EXISTS recordings (
                    submission TEXT NOT NULL REFERENCES submissions(id),
                    prompt INTEGER NOT NULL, take INTEGER NOT NULL,
                    mime TEXT NOT NULL, data BLOB NOT NULL, digest TEXT NOT NULL,
                    PRIMARY KEY (submission, prompt, take)
                );
            ''')

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=20)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys = ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def summary(self, row):
        return {**{k: row[k] for k in ('id','learner','session','skill','form','created_at')},
                'assisted': bool(row['assisted']),
                'provisional': json.loads(row['provisional']) if row['provisional'] else None,
                'result': json.loads(row['result']) if row['result'] else None,
                'status': 'validated' if row['result'] else 'awaiting_teacher_review'}

    def get(self, attempt: str, learner: str | None = None):
        with self.connect() as db:
            row = db.execute('SELECT * FROM submissions WHERE id=?', (attempt,)).fetchone()
        if row is None or (learner is not None and row['learner'] != learner):
            raise HTTPException(404, 'Submission not found.')
        return row

    def list(self, learner: str | None = None):
        with self.connect() as db:
            if learner:
                rows = db.execute('SELECT * FROM submissions WHERE learner=? ORDER BY created_at DESC, rowid DESC', (learner,)).fetchall()
            else:
                rows = db.execute('SELECT * FROM submissions ORDER BY created_at DESC, rowid DESC').fetchall()
        return [self.summary(row) for row in rows]

    def insert_recordings(self, attempt: UUID, session: UUID, learner: str, form_id: str,
                          slots: list, clips: list[UploadFile]):
        if form_id in self.forms:
            skill, count, limit = 'phonics', len(self.forms[form_id].items), 2 * 1024 * 1024
        elif form_id in self.passages:
            skill, count, limit = 'oral', 1, 16 * 1024 * 1024
        else:
            raise HTTPException(404, 'Unknown assessment form.')
        if not isinstance(slots, list) or len(slots) != len(clips) or not (count <= len(slots) <= count * 3):
            raise HTTPException(422, 'Submit 1–3 recordings per prompt.')
        mapping = {}
        uploads = []
        for slot, clip in zip(slots, clips):
            if not (isinstance(slot, list) and len(slot) == 2 and all(type(v) is int for v in slot)):
                raise HTTPException(422, 'Invalid recording slot.')
            position, take = slot
            if not 0 <= position < count or not 1 <= take <= 3 or (position, take) in mapping:
                raise HTTPException(422, 'Duplicate or out-of-range recording attempt.')
            mapping[(position, take)] = True
            mime = (clip.content_type or '').split(';')[0]
            data = clip.file.read(limit + 1)
            if mime not in MIME_TYPES or not data or len(data) > limit:
                raise HTTPException(422, 'A recording is empty, too large, or unsupported.')
            uploads.append((str(attempt), position, take, mime, data, hashlib.sha256(data).hexdigest()))
        for position in range(count):
            takes = sorted(take for (index, take) in mapping if index == position)
            if takes != list(range(1, len(takes) + 1)):
                raise HTTPException(422, 'Each prompt needs sequential takes starting with 1.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM submissions WHERE id=?', (str(attempt),)).fetchone():
                raise HTTPException(409, 'This submission ID has already been used.')
            db.execute('''INSERT INTO submissions (id,learner,session,skill,form,created_at)
                          VALUES (?,?,?,?,?,?)''', (str(attempt), learner, str(session), skill, form_id,
                            datetime.now(timezone.utc).isoformat()))
            db.executemany('''INSERT INTO recordings (submission,prompt,take,mime,data,digest)
                              VALUES (?,?,?,?,?,?)''', uploads)
        return {'id': str(attempt), 'status': 'awaiting_teacher_review', 'recordingCount': len(uploads)}

    def read_audio(self, attempt: str, prompt: int, take: int, learner=None):
        self.get(attempt, learner)
        with self.connect() as db:
            row = db.execute('SELECT mime,data FROM recordings WHERE submission=? AND prompt=? AND take=?',
                             (attempt, prompt, take)).fetchone()
        if not row:
            raise HTTPException(404, 'Recording not found.')
        return Response(row['data'], media_type=row['mime'], headers={'Cache-Control': 'private, no-store'})

    def slots(self, attempt: str):
        with self.connect() as db:
            return [dict(row) for row in db.execute('''SELECT prompt,take,mime,digest FROM recordings
                                                      WHERE submission=? ORDER BY prompt,take''', (attempt,))]

    def estimate(self, attempt: str, learner: str):
        row = self.get(attempt, learner)
        if row['skill'] == 'comprehension':
            return self.summary(row)['provisional']
        if row['provisional']:
            return json.loads(row['provisional'])
        from difflib import SequenceMatcher
        if row['skill'] == 'phonics':
            prompts = [item.word for item in self.forms[row['form']].items]
        else:
            prompts = words(self.passages[row['form']])
        with self.connect() as db:
            recordings = db.execute('''SELECT prompt,take,data FROM recordings WHERE submission=?
                                       ORDER BY prompt,take''', (attempt,)).fetchall()
        # Every take is retained. The most recent take of each prompt is used for
        # non-authoritative automated feedback; teachers choose the actual take.
        latest = {}
        for recording in recordings:
            latest[recording['prompt']] = recording
        recognized = []
        try:
            for position in sorted(latest):
                duration = 12 if row['skill'] == 'phonics' else 125
                samples = speech.decode_audio(latest[position]['data'], duration)
                recognized.append(speech.transcribe(samples))
        except Exception:
            # Failure is not scored as wrong. Don't misrepresent missing STT as a mismatch.
            result = {'status': 'unavailable', 'message': 'Automatic speech feedback unavailable. Teacher will listen to every recording.',
                      'items': [{'word': word, 'verdict': 'UNCERTAIN'} for word in prompts]}
        else:
            if row['skill'] == 'phonics':
                indicators = [compare(word, recognized[index]) for index,word in enumerate(prompts)]
                verdicts = ['LIKELY_CORRECT' if value == 'match' else
                            'LIKELY_INCORRECT' if value == 'possible_mismatch' else 'UNCERTAIN' for value in indicators]
                result = {'status': 'provisional', 'items': [{'word': word, 'heard': recognized[i],
                          'verdict': verdicts[i]} for i, word in enumerate(prompts)]}
            else:
                heard = WORD_PATTERN.findall(recognized[0].casefold())
                targets = [word.casefold() for word in prompts]
                matched = set()
                for segment in SequenceMatcher(None, targets, heard, autojunk=False).get_matching_blocks():
                    matched.update(range(segment.a, segment.a + segment.size))
                result = {'status': 'provisional', 'transcript': recognized[0], 'items': [
                    {'word': word, 'verdict': 'LIKELY_CORRECT' if i in matched else 'LIKELY_INCORRECT'}
                    for i, word in enumerate(prompts)]}
        with self.connect() as db:
            db.execute('UPDATE submissions SET provisional=? WHERE id=? AND provisional IS NULL',
                       (json.dumps(result), attempt))
        return result

    def submit_comprehension(self, data: ComprehensionSubmission, learner: str):
        form = self.comprehension.get(data.formId)
        if form is None:
            raise HTTPException(404, 'Unknown comprehension form.')
        try:
            answers = score_responses(form, data.responses)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        provisional = {'status': 'provisional', 'items': answers, 'score': round(100 * sum(x['correct'] for x in answers) / len(answers), 2),
                       'notice': 'Automatically checked, but teacher validation is still pending.'}
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM submissions WHERE id=?', (str(data.attemptId),)).fetchone():
                raise HTTPException(409, 'Duplicate submission ID.')
            db.execute('''INSERT INTO submissions
                          (id, learner, session, skill, form, created_at, assisted, provisional)
                          VALUES (?,?,?,?,?,?,?,?)''', (str(data.attemptId), learner, str(data.sessionId),
                            'comprehension', data.formId, datetime.now(timezone.utc).isoformat(),
                            int(data.assisted), json.dumps(provisional)))
        return {'id': str(data.attemptId), 'status': 'awaiting_teacher_review', 'provisional': provisional}

    def finalize(self, attempt: str, payload: ReviewPayload):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM submissions WHERE id=?', (attempt,)).fetchone()
            if not row:
                raise HTTPException(404, 'Submission not found.')
            if row['result']:
                raise HTTPException(409, 'This submission has already been validated.')
            skill, form_id = row['skill'], row['form']
            if skill == 'phonics':
                form = self.forms[form_id]
                prompts = [item.word for item in form.items]
                version, tier = form.version, form.difficultyTier
                passage_id = None
            elif skill == 'oral':
                passage = self.passages[form_id]
                prompts = words(passage)
                version, tier, passage_id = passage['version'], passage['difficultyTier'], passage['passageId']
            else:
                form = self.comprehension[form_id]
                prompts = [question.questionId for question in form.questions]
                version, tier, passage_id = form.version, form.difficultyTier, form.passageId
            if len(payload.marks) != len(prompts):
                raise HTTPException(422, 'Teacher must validate every word or question.')
            if skill == 'comprehension':
                if payload.selectedTakes:
                    raise HTTPException(422, 'Comprehension has no recorded takes.')
            else:
                count = 1 if skill == 'oral' else len(prompts)
                if len(payload.selectedTakes) != count:
                    raise HTTPException(422, 'Select one recorded take for each prompt.')
                for prompt, take in enumerate(payload.selectedTakes):
                    if not 1 <= take <= 3 or not db.execute('''SELECT 1 FROM recordings
                         WHERE submission=? AND prompt=? AND take=?''', (attempt, prompt, take)).fetchone():
                        raise HTTPException(422, 'Selected take does not exist.')
            # Preserve the preexisting server-side scoring contract for phonics.
            if skill == 'phonics':
                student_marks = Submission(eventId=attempt, learnerId=row['learner'], formId=form_id,
                    sessionId=row['session'], judgments=[{'itemId': item.itemId,
                    'attemptId': f'take{payload.selectedTakes[index]}_item{index}',
                    'verdict': payload.marks[index], 'assisted': payload.assisted}
                    for index,item in enumerate(form.items)])
                scored = score_probe(form, student_marks, (self.store.rules.reviewLow, self.store.rules.reviewHigh))
                correct = scored.correct
            else:
                correct = payload.marks.count('CORRECT')
            event = AssessmentEvent(eventId=attempt, learnerId=row['learner'], sessionId=row['session'],
                skill=skill, formId=form_id, formVersion=version, passageId=passage_id,
                difficultyTier=tier, correct=correct, total=len(prompts),
                assisted=payload.assisted or bool(row['assisted']), usable=True,
                timestamp=datetime.now(timezone.utc))
            original = {'teacherMarks': payload.marks, 'selectedTakes': payload.selectedTakes,
                        'assisted': payload.assisted, 'note': payload.note,
                        'provisional': json.loads(row['provisional']) if row['provisional'] else None}
            stored = save_verified(self.store, event, original)
            result = {'event': stored.model_dump(mode='json'), 'treeCheck': to_tree_check(stored),
                      'marks': payload.marks, 'selectedTakes': payload.selectedTakes, 'note': payload.note,
                      'validatedAt': datetime.now(timezone.utc).isoformat()}
            db.execute('UPDATE submissions SET result=? WHERE id=?', (json.dumps(result), attempt))
        return result


def install_reviews(app, auth, forms, store: EvidenceStore, repository_path=None):
    repo = ReviewRepository(repository_path or os.getenv('LITERA_REVIEW_DB') or ROOT / '.litera-data' / 'reviews.sqlite3', forms, store)
    student = APIRouter(prefix='/api', dependencies=[Depends(auth.current_learner)])
    teacher = APIRouter(prefix='/api/teacher', dependencies=[Depends(require_teacher)])

    @student.get('/forms')
    def list_phonics():
        return list(forms.values())

    @student.get('/passages')
    def list_passages():
        return list(repo.passages.values())

    @student.get('/comprehension/forms')
    def list_comprehension():
        return [public_form(form) for form in repo.comprehension.values()]

    @student.post('/comprehension/submissions', status_code=201, dependencies=[Depends(check_origin)])
    def submit_comprehension(data: ComprehensionSubmission, learner=Depends(auth.current_learner)):
        return repo.submit_comprehension(data, learner['learnerId'])

    @student.post('/recording-submissions', status_code=201, dependencies=[Depends(check_origin)])
    def submit_recordings(attempt: UUID = Form(), session: UUID = Form(), form: str = Form(max_length=64),
                          slots: str = Form(max_length=1500), clips: list[UploadFile] = File(),
                          learner=Depends(auth.current_learner)):
        try:
            mapping = json.loads(slots)
        except (ValueError, TypeError):
            raise HTTPException(422, 'Invalid recording manifest.')
        return repo.insert_recordings(attempt, session, learner['learnerId'], form, mapping, clips)

    @student.get('/student/submissions')
    def student_submissions(learner=Depends(auth.current_learner)):
        return repo.list(learner['learnerId'])

    @student.get('/student/submissions/{attempt}/slots')
    def student_slots(attempt: UUID, learner=Depends(auth.current_learner)):
        repo.get(str(attempt), learner['learnerId'])
        return repo.slots(str(attempt))

    @student.get('/student/submissions/{attempt}/audio/{prompt}/{take}')
    def student_audio(attempt: UUID, prompt: int, take: int, learner=Depends(auth.current_learner)):
        return repo.read_audio(str(attempt), prompt, take, learner['learnerId'])

    @student.post('/student/submissions/{attempt}/estimate', dependencies=[Depends(check_origin)])
    def student_estimate(attempt: UUID, learner=Depends(auth.current_learner)):
        return repo.estimate(str(attempt), learner['learnerId'])

    @student.get('/student/profile')
    def student_profile(learner=Depends(auth.current_learner)):
        return recommendation_profile(store, learner['learnerId'])

    @teacher.get('/forms')
    def teacher_forms():
        return list(forms.values())

    @teacher.get('/passages')
    def teacher_passages():
        return list(repo.passages.values())

    @teacher.get('/comprehension/forms')
    def teacher_comprehension_forms():
        return [public_form(form) for form in repo.comprehension.values()]

    @teacher.get('/submissions')
    def teacher_submissions():
        return repo.list()

    @teacher.get('/submissions/{attempt}/slots')
    def teacher_slots(attempt: UUID):
        repo.get(str(attempt))
        return repo.slots(str(attempt))

    @teacher.get('/submissions/{attempt}/audio/{prompt}/{take}')
    def teacher_audio(attempt: UUID, prompt: int, take: int):
        return repo.read_audio(str(attempt), prompt, take)

    @teacher.post('/submissions/{attempt}/review', dependencies=[Depends(check_origin)])
    def teacher_review(attempt: UUID, payload: ReviewPayload):
        return repo.finalize(str(attempt), payload)

    @teacher.get('/learners/{learner_id}/profile')
    def teacher_profile(learner_id: str):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', learner_id):
            raise HTTPException(422, 'Invalid learner ID.')
        return recommendation_profile(store, learner_id)

    @teacher.post('/overrides', dependencies=[Depends(check_origin)])
    def teacher_override(payload: Override):
        from .plan import PlanOverride
        from pydantic import ValidationError
        try:
            PlanOverride.model_validate(payload.plan_input())
        except ValidationError as exc:
            raise HTTPException(422, 'Invalid recommendation override.') from exc
        return store.record_override(payload)

    app.include_router(student)
    app.include_router(teacher)
    return repo
