import json
import re
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

REVIEW_BAND = (75, 85)
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Verdict = Literal["CORRECT", "INCORRECT", "UNCLEAR"]

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

class Target(Model):
    itemId: Identifier
    word: str = Field(pattern=r"^[a-z]{1,32}$")

class Form(Model):
    formId: Identifier
    difficultyTier: Identifier
    pattern: str = Field(min_length=1, max_length=32)
    items: list[Target] = Field(min_length=5, max_length=5)

    @model_validator(mode="after")
    def unique_items(self):
        if len({i.itemId for i in self.items}) != len(self.items) or len({i.word for i in self.items}) != len(self.items):
            raise ValueError("Each form needs distinct item IDs and words.")
        return self

def load_forms(directory=None):
    directory = directory or Path(__file__).with_name("forms")
    forms = {}
    for path in sorted(directory.glob("*.json")):
        form = Form.model_validate_json(path.read_text(encoding="utf-8"))
        if form.formId in forms:
            raise ValueError(f"Duplicate form ID: {form.formId}")
        forms[form.formId] = form
    if not forms:
        raise ValueError("No phonics forms configured.")
    return forms

class Judgment(Model):
    itemId: Identifier
    attemptId: Identifier
    verdict: Verdict
    assisted: bool = False

class Submission(Model):
    eventId: Identifier
    learnerId: Identifier
    formId: Identifier
    sessionId: Identifier
    judgments: list[Judgment] = Field(max_length=5)

class PhonicsEvidence(Model):
    eventId: Identifier
    learnerId: Identifier
    skill: Literal["phonics"] = "phonics"
    formId: Identifier
    sessionId: Identifier
    difficultyTier: Identifier
    kind: Literal["probe"] = "probe"
    correct: int = Field(ge=0, le=5)
    total: Literal[5] = 5
    score: int = Field(ge=0, le=100)
    assisted: Literal[False] = False
    usable: Literal[True] = True
    reviewRequired: bool

    @model_validator(mode="after")
    def validate_derived_fields(self):
        if self.score != 100 * self.correct // self.total:
            raise ValueError("Score must match the teacher-confirmed count.")
        if self.reviewRequired != (REVIEW_BAND[0] <= self.score <= REVIEW_BAND[1]):
            raise ValueError("Review flag must match the configured band.")
        return self

def compare(expected, transcript):
    words = re.findall(r"[^\W_]+", transcript.casefold())
    if not words:
        return "unavailable"
    if len(words) != 1:
        return "review"
    return "match" if words[0] == expected else "possible_mismatch"

def score_probe(form, submission):
    if form.formId != submission.formId:
        raise ValueError("Submission targets the wrong form.")
    judgments = submission.judgments
    items = {item.itemId for item in form.items}
    if len(judgments) != len(items) or {j.itemId for j in judgments} != items:
        raise ValueError("Submit exactly one final judgment for each of the five targets.")
    if len({j.attemptId for j in judgments}) != len(items):
        raise ValueError("Do not reuse one attempt for multiple targets.")
    if any(j.verdict == "UNCLEAR" or j.assisted for j in judgments):
        raise ValueError("All five judgments must be clear and independent.")
    correct = sum(j.verdict == "CORRECT" for j in judgments)
    score = 100 * correct // len(items)
    return PhonicsEvidence(
        eventId=submission.eventId, learnerId=submission.learnerId, formId=form.formId,
        sessionId=submission.sessionId, difficultyTier=form.difficultyTier,
        correct=correct, score=score, reviewRequired=REVIEW_BAND[0] <= score <= REVIEW_BAND[1],
    )

class TreeEvidence(Protocol):
    @property
    def skill(self) -> str: ...
    @property
    def formId(self) -> str: ...
    @property
    def sessionId(self) -> str: ...
    @property
    def difficultyTier(self) -> str: ...
    @property
    def kind(self) -> str: ...
    @property
    def correct(self) -> int: ...
    @property
    def total(self) -> int: ...
    @property
    def assisted(self) -> bool: ...
    @property
    def usable(self) -> bool: ...


def to_tree_check(event: TreeEvidence):
    """Exact payload accepted by the existing voice.tree.Check model."""
    return {
        "skill": event.skill, "form": event.formId, "session": event.sessionId,
        "tier": event.difficultyTier, "kind": event.kind, "correct": event.correct,
        "total": event.total, "assisted": event.assisted, "usable": event.usable,
    }

class Conflict(ValueError):
    pass

class DemoReceiver:
    """In-memory receipt ledger for a single local demo process."""
    def __init__(self):
        self.receipts = {}
        self.forms_used = set()
        self.sessions_used = set()
        self.lock = Lock()

    def submit(self, form, submission):
        event = score_probe(form, submission)
        # Sort by item so retrying the same data in a different order is idempotent.
        payload = submission.model_dump()
        payload["judgments"].sort(key=lambda item: item["itemId"])
        fingerprint = json.dumps(payload, sort_keys=True)
        form_key = (event.learnerId, event.formId)
        session_key = (event.learnerId, event.difficultyTier, event.sessionId)
        with self.lock:
            if event.eventId in self.receipts:
                prior, receipt = self.receipts[event.eventId]
                if prior != fingerprint:
                    raise Conflict("This event ID has already been used with a different submission.")
                return receipt
            if form_key in self.forms_used or session_key in self.sessions_used:
                raise Conflict("Use a fresh form and a separate session for this learner and tier.")
            receipt = {"event": event, "treeCheck": to_tree_check(event)}
            self.receipts[event.eventId] = (fingerprint, receipt)
            self.forms_used.add(form_key)
            self.sessions_used.add(session_key)
            return receipt
