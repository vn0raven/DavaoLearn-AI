"""Server-side grading and in-memory receipts for the comprehension demo."""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator

from .evidence import AssessmentEvent
from .evidence_api import save_verified
from .scoring import Identifier, Model, to_tree_check

Mode = Literal["independent", "assisted"]


class Choice(Model):
    answerId: Identifier
    text: str = Field(min_length=1)


class Question(Model):
    questionId: Identifier
    prompt: str = Field(min_length=1)
    choices: list[Choice] = Field(min_length=2)
    correctAnswerId: Identifier

    @model_validator(mode="after")
    def validate_choices(self):
        ids = {choice.answerId for choice in self.choices}
        if len(ids) != len(self.choices) or self.correctAnswerId not in ids:
            raise ValueError("Use unique choice IDs and a valid answer key.")
        if len({choice.text.strip().casefold() for choice in self.choices}) != len(ids):
            raise ValueError("Answer choices must have distinct labels.")
        return self


class Form(Model):
    formId: Identifier
    passageId: Identifier
    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    difficultyTier: Identifier
    competencies: list[str] = Field(min_length=1)
    version: str = Field(min_length=1)
    source: str = Field(min_length=1)
    licensingStatus: str = Field(min_length=1)
    questions: list[Question] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_questions(self):
        if len({question.questionId for question in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique within the form.")
        return self


def load_forms(directory=None):
    directory = directory or Path(__file__).with_name("comprehension_forms")
    forms = {}
    for path in sorted(directory.glob("*.json")):
        form = Form.model_validate_json(path.read_text(encoding="utf-8"))
        if form.formId in forms:
            raise ValueError(f"Duplicate comprehension form ID: {form.formId}")
        forms[form.formId] = form
    if not forms:
        raise ValueError("No comprehension forms configured.")
    return forms


def public_form(form):
    return form.model_dump(exclude={"questions": {"__all__": {"correctAnswerId"}}})


class Start(Model):
    eventId: Identifier
    learnerId: Identifier
    sessionId: Identifier
    formId: Identifier
    difficultyTier: Identifier
    mode: Mode


class Response(Model):
    questionId: Identifier
    answerId: Identifier


class Submission(Model):
    responses: list[Response] = Field(max_length=200)
    assisted: bool


def score_responses(form, responses):
    questions = {question.questionId: question for question in form.questions}
    selected = {}
    for response in responses:
        question = questions.get(response.questionId)
        if question is None:
            raise ValueError("A response refers to a question outside this form.")
        if response.questionId in selected:
            raise ValueError("Each question accepts exactly one response.")
        if response.answerId not in {choice.answerId for choice in question.choices}:
            raise ValueError("A response has an invalid answer choice.")
        selected[response.questionId] = response.answerId
    unanswered = len(questions) - len(selected)
    if unanswered:
        raise ValueError(f"Answer all questions before submitting. Remaining: {unanswered}.")
    return [
        {
            "questionId": question.questionId,
            "answerId": selected[question.questionId],
            "correct": selected[question.questionId] == question.correctAnswerId,
        }
        for question in form.questions
    ]


@dataclass
class Attempt:
    start: Start
    interrupted: bool = False
    receipt: dict | None = None


def create_router(store):
    router = APIRouter(prefix="/api/comprehension")
    forms = load_forms()
    attempts: dict[str, Attempt] = {}
    exposed_forms: set[tuple[str, str]] = set()
    exposed_passages: set[tuple[str, str]] = set()
    completed_sessions: set[tuple[str, str, str]] = set()
    lock = Lock()

    @router.get("/forms")
    def list_forms():
        return [
            form.model_dump(exclude={"questions", "text"})
            for form in forms.values()
        ]

    @router.post("/start")
    def start_assessment(start: Start):
        form = forms.get(start.formId)
        if form is None:
            raise HTTPException(404, "Comprehension form was not found.")
        if form.difficultyTier != start.difficultyTier:
            raise HTTPException(422, "The difficulty tier does not match this form.")
        form_key = (start.learnerId, start.formId)
        passage_key = (start.learnerId, form.passageId)
        session_key = (start.learnerId, start.sessionId, form.difficultyTier)
        with lock:
            prior = attempts.get(start.eventId)
            if prior:
                if prior.start != start or prior.interrupted:
                    raise HTTPException(409, "This attempt ID is already in use. Start a new attempt.")
            else:
                saved = store.prior_events(start.learnerId, "comprehension", form.difficultyTier)
                if session_key in completed_sessions or any(
                    event.sessionId == start.sessionId and event.submissionStatus == "complete" for event in saved
                ):
                    raise HTTPException(409, "This session already has a result for this tier. Start a separate session.")
                seen = any(event.formId == form.formId or event.passageId == form.passageId for event in saved)
                if start.mode == "independent" and (seen or form_key in exposed_forms or passage_key in exposed_passages):
                    raise HTTPException(409, "This learner has seen this passage or form. Choose a fresh passage or Assisted practice.")
                attempts[start.eventId] = Attempt(start)
                exposed_forms.add(form_key)
                exposed_passages.add(passage_key)
        return public_form(form)

    @router.post("/{event_id}/interrupt", status_code=204)
    def interrupt_assessment(event_id: Identifier):
        with lock:
            attempt = attempts.get(event_id)
            if attempt is None:
                raise HTTPException(404, "Attempt not found.")
            if attempt.receipt:
                raise HTTPException(409, "This assessment has already been submitted.")
            form = forms[attempt.start.formId]
            original = attempt.start.model_dump(mode="json")
            event = AssessmentEvent(
                eventId=event_id, learnerId=attempt.start.learnerId, sessionId=attempt.start.sessionId,
                skill="comprehension", formId=form.formId, formVersion=form.version,
                passageId=form.passageId, difficultyTier=form.difficultyTier,
                assisted=attempt.start.mode == "assisted", usable=False, timestamp=datetime.now(UTC),
                submissionStatus="interrupted",
            )
            save_verified(store, event, original)
            attempt.interrupted = True

    def build_receipt(saved, responses):
        event = saved.model_dump(mode="json", include={
            "eventId", "learnerId", "sessionId", "skill", "formId", "passageId",
            "difficultyTier", "kind", "correct", "total", "assisted", "usable", "timestamp",
        })
        return {
            "event": {**event, "passageVersion": saved.formVersion, "score": float(saved.score)},
            "treeCheck": to_tree_check(saved),
            "evidence": saved, "responses": responses, "incorrect": saved.total - saved.correct,
            "unanswered": 0, "quality": "complete",
        }

    @router.post("/{event_id}/complete")
    def complete_assessment(event_id: Identifier, submission: Submission):
        with lock:
            attempt = attempts.get(event_id)
            if attempt is None:
                stored = store.stored_submission(event_id)
                if stored is None or stored[0].skill != "comprehension":
                    raise HTTPException(404, "Attempt not found. The demo server may have restarted.")
                saved, original = stored
                if saved.submissionStatus != "complete":
                    raise HTTPException(409, "This assessment was interrupted. Start a new check.")
                responses = original["responses"]
                expected = sorted((item["questionId"], item["answerId"]) for item in responses)
                submitted = sorted((item.questionId, item.answerId) for item in submission.responses)
                assisted = original["start"]["mode"] == "assisted" or submission.assisted
                if expected != submitted or saved.assisted != assisted:
                    raise HTTPException(409, "This assessment already has a different submission.")
                return build_receipt(saved, responses)
            if attempt.interrupted:
                raise HTTPException(409, "This assessment was interrupted. Start a new check.")
            start = attempt.start
            form = forms[start.formId]
            try:
                responses = score_responses(form, submission.responses)
            except ValueError as exc:
                store.reject(start.learnerId, event_id, submission.model_dump(mode="json"), str(exc))
                raise HTTPException(422, str(exc)) from exc
            assisted = start.mode == "assisted" or submission.assisted
            if attempt.receipt is not None:
                if attempt.receipt["responses"] != responses or attempt.receipt["event"]["assisted"] != assisted:
                    raise HTTPException(409, "This assessment already has a different submission.")
                return attempt.receipt

            session_key = (start.learnerId, start.sessionId, start.difficultyTier)
            if session_key in completed_sessions:
                raise HTTPException(409, "This session already has a result for this tier. Start a separate session.")

            correct = sum(response["correct"] for response in responses)
            total = len(form.questions)
            event = AssessmentEvent(
                eventId=event_id, learnerId=start.learnerId, sessionId=start.sessionId, skill="comprehension",
                formId=form.formId, passageId=form.passageId, formVersion=form.version,
                difficultyTier=form.difficultyTier, correct=correct, total=total,
                assisted=assisted, usable=True, timestamp=datetime.now(UTC),
            )
            original = {"start": start.model_dump(mode="json"), "responses": responses, "assisted": assisted}
            saved = save_verified(store, event, original)
            receipt = build_receipt(saved, responses)
            attempt.receipt = receipt
            completed_sessions.add(session_key)
            return receipt

    return router
