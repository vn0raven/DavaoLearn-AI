"""Authenticated, durable *practice-only* progress for Litera reading quests.

Never imports the assessment scoring service and never creates score evidence.
Uploaded progress is practice self-report, not independent mastery evidence.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .auth import check_origin
from .reviews import require_teacher

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'frontend' / 'src' / 'practice' / 'content.json'
KNOWN = {item['id']: item for item in json.loads(PACK.read_text(encoding='utf-8'))}

class Hint(BaseModel):
    step: int = Field(ge=0, le=50)
    level: Literal[1, 2, 3]
    requestedAt: str = Field(min_length=10, max_length=40)

class PracticeAudio(BaseModel):
    model_config = ConfigDict(extra='forbid')
    step: int = Field(ge=0, le=50)
    source: Literal['model', 'passage', 'sentence', 'word', 'instructions', 'explanation', 'teacher-model']

class Attempt(BaseModel):
    step: int = Field(ge=0, le=50)
    response: int | Literal['guided']
    correct: bool | None
    assistance: list[Literal['teacher-guided', 'hint', 'corrective-feedback']] = Field(max_length=3)
    errorCategory: str | None = Field(default=None, max_length=70)

class PracticeRun(BaseModel):
    model_config = ConfigDict(extra='forbid')
    learnerId: str = Field(min_length=1, max_length=80)
    sessionId: UUID
    runId: UUID
    activityId: str = Field(min_length=1, max_length=100)
    contentVersion: str = Field(min_length=1, max_length=50)
    skill: Literal['phonics', 'oral', 'comprehension']
    difficultyTier: str = Field(max_length=70)
    passageId: str | None = Field(default=None, max_length=100)
    startedAt: str = Field(min_length=10, max_length=40)
    completedAt: str | None = Field(default=None, min_length=10, max_length=40)
    step: int = Field(ge=0, le=50)
    attempts: list[Attempt] = Field(max_length=150)
    hints: list[int] = Field(max_length=50)
    hintHistory: list[Hint] = Field(default_factory=list, max_length=150)
    audioAssistance: list[PracticeAudio] | None = Field(default=None, max_length=200)
    notes: str = Field(max_length=240)
    intendedUse: Literal['practice']

    @model_validator(mode='after')
    def validate_content(self):
        activity = KNOWN.get(self.activityId)
        if activity is None:
            raise ValueError('Unknown guided practice activity.')
        if any((self.contentVersion != activity['version'], self.skill != activity['skill'],
                self.difficultyTier != activity['difficultyTier'], self.passageId != activity.get('passageId'))):
            raise ValueError('Practice activity metadata mismatch.')
        steps = activity['steps']
        if not 0 <= self.step < len(steps):
            raise ValueError('Invalid practice step.')
        passed = set()
        for attempt in self.attempts:
            if attempt.step >= len(steps):
                raise ValueError('Invalid step in practice attempt.')
            prompt = steps[attempt.step]
            if prompt['kind'] == 'guide':
                if attempt.response != 'guided' or attempt.correct is not None:
                    raise ValueError('Guided step mismatch.')
                passed.add(attempt.step)
            else:
                if type(attempt.response) is not int or not 0 <= attempt.response < len(prompt['options']):
                    raise ValueError('Invalid practice response.')
                if attempt.correct is not (attempt.response == prompt['answer']):
                    raise ValueError('Practice answer cannot change authored feedback.')
                if attempt.correct:
                    passed.add(attempt.step)
        if self.completedAt is not None and len(passed) != len(steps):
            raise ValueError('Every guided step must be completed before finishing the quest.')
        if any(i < 0 or i >= len(steps) for i in self.hints):
            raise ValueError('Invalid hint step.')
        by_step = {}
        for hint in self.hintHistory:
            by_step.setdefault(hint.step, []).append(hint.level)
        if any(levels != list(range(1, len(levels)+1)) or len(levels) > 3 for levels in by_step.values()):
            raise ValueError('Hints must be requested in order, maximum three per step.')
        audio_used = set()
        attempted_steps = {attempt.step for attempt in self.attempts}
        for audio in self.audioAssistance or []:
            if audio.step > self.step or (audio.step, audio.source) in audio_used:
                raise ValueError('Invalid or duplicate practice audio.')
            prompt = steps[audio.step]
            allowed = (
                audio.source == 'model' and self.skill == 'phonics' and prompt.get('modelWord')
                and (prompt['kind'] == 'guide' or audio.step in attempted_steps)
            ) or (
                audio.source in ('passage', 'sentence') and self.skill != 'phonics' and activity.get('passage')
            ) or (
                audio.source == 'word' and self.skill == 'oral' and activity.get('wordCues')
            ) or (
                audio.source == 'teacher-model' and self.skill == 'phonics'
                and prompt['kind'] == 'guide' and prompt.get('soundModel')
                and re.fullmatch(r'[a-zA-Z0-9_-]+\.(mp3|wav|ogg)', prompt['soundModel'].get('file', ''), flags=re.I)
            ) or (
                audio.source == 'instructions' and self.skill == 'comprehension'
            ) or (
                audio.source == 'explanation' and self.skill == 'comprehension'
                and prompt['kind'] == 'choice' and audio.step in attempted_steps
            )
            if not allowed:
                raise ValueError('Audio source unavailable for this practice step.')
            audio_used.add((audio.step, audio.source))
        return self

class PracticeRepository:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS practice_runs (
                run_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, activity_id TEXT NOT NULL,
                completed_at TEXT, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS practice_by_learner ON practice_runs(learner_id);''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db: yield db
        finally:
            db.close()

    def list(self, learner_id):
        with self.connect() as db:
            rows = db.execute('SELECT payload FROM practice_runs WHERE learner_id=? ORDER BY rowid ASC', (learner_id,)).fetchall()
        return [json.loads(row['payload']) for row in rows]

    def save(self, learner_id, run_id, run: PracticeRun):
        if str(run.runId) != run_id or run.learnerId != learner_id:
            raise HTTPException(403, 'Cannot save another learner\'s practice progress.')
        content = run.model_dump(mode='json')
        if run.audioAssistance is None:
            content.pop('audioAssistance')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT learner_id, completed_at, payload FROM practice_runs WHERE run_id=?', (run_id,)).fetchone()
            if old and old['learner_id'] != learner_id:
                raise HTTPException(409, 'Practice run ID already exists.')
            if old and old['completed_at']:
                if json.loads(old['payload']) != content:
                    raise HTTPException(409, 'A completed quest cannot be changed.')
                return {'saved': True, 'completed': True}
            if old:
                previous = json.loads(old['payload'])
                if len(content['attempts']) < len(previous['attempts']) or len(content['hintHistory']) < len(previous['hintHistory']):
                    raise HTTPException(409, 'Cannot discard previously saved practice attempts or hints.')
                previous_audio = previous.get('audioAssistance', [])
                current_audio = content.get('audioAssistance', [])
                if any(use not in current_audio for use in previous_audio):
                    raise HTTPException(409, 'Cannot discard previously saved practice audio assistance.')
            db.execute('''INSERT INTO practice_runs (run_id, learner_id, activity_id, completed_at, payload)
                VALUES (?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET completed_at=excluded.completed_at,payload=excluded.payload''',
                (run_id, learner_id, run.activityId, run.completedAt, json.dumps(content)))
        return {'saved': True, 'completed': bool(run.completedAt)}


def install_practice(app, auth, path=None):
    repo = PracticeRepository(path or os.getenv('LITERA_PRACTICE_DB') or ROOT / '.litera-data' / 'practice.sqlite3')
    student = APIRouter(prefix='/api/student', dependencies=[Depends(auth.current_learner)])
    teacher = APIRouter(prefix='/api/teacher', dependencies=[Depends(require_teacher)])

    @student.get('/practice')
    def get_practice(learner=Depends(auth.current_learner)):
        return repo.list(learner['learnerId'])

    @student.put('/practice/{run_id}', dependencies=[Depends(check_origin)])
    def save_practice(run_id: UUID, body: PracticeRun, learner=Depends(auth.current_learner)):
        return repo.save(learner['learnerId'], str(run_id), body)

    @teacher.get('/learners/{learner_id}/practice')
    def teacher_practice(learner_id: str):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', learner_id):
            raise HTTPException(422, 'Invalid learner identifier.')
        return repo.list(learner_id)

    app.include_router(student)
    app.include_router(teacher)
    return repo
