import re
from fractions import Fraction
from pathlib import Path
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

REVIEW_BAND = (75, 85)
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Verdict = Literal["CORRECT", "INCORRECT", "UNCLEAR"]

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

def calculate_score(correct: int, total: int) -> Fraction:
    if type(correct) is not int or type(total) is not int or not 0 <= correct <= total or total < 1:
        raise ValueError("Counts must be integers with 0 <= correct <= total and total > 0.")
    return Fraction(100 * correct, total)


class Target(Model):
    itemId: Identifier
    word: str = Field(pattern=r"^[a-z]{1,32}$")

class Form(Model):
    formId: Identifier
    difficultyTier: Identifier
    pattern: str = Field(min_length=1, max_length=32)
    version: str = Field(default="1.0.0", min_length=1, max_length=64)
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
    assisted: bool = False
    usable: Literal[True] = True
    reviewRequired: bool

    @model_validator(mode="after")
    def validate_derived_fields(self):
        if self.score != 100 * self.correct // self.total:
            raise ValueError("Score must match the teacher-confirmed count.")
        return self

def compare(expected, transcript):
    words = re.findall(r"[^\W_]+", transcript.casefold())
    if not words:
        return "unavailable"
    if len(words) != 1:
        return "review"
    return "match" if words[0] == expected else "possible_mismatch"

def score_probe(form, submission, review_band=REVIEW_BAND):

    if form.formId != submission.formId:
        raise ValueError("Submission targets the wrong form.")
    judgments = submission.judgments
    items = {item.itemId for item in form.items}
    if len(judgments) != len(items) or {j.itemId for j in judgments} != items:
        raise ValueError("Submit exactly one final judgment for each of the five targets.")
    if len({j.attemptId for j in judgments}) != len(items):
        raise ValueError("Do not reuse one attempt for multiple targets.")
    if any(j.verdict == "UNCLEAR" for j in judgments):
        raise ValueError("All five judgments must be clear.")
    correct = sum(j.verdict == "CORRECT" for j in judgments)
    score = int(calculate_score(correct, len(items)))
    assisted = any(j.assisted for j in judgments)
    return PhonicsEvidence(
        eventId=submission.eventId, learnerId=submission.learnerId, formId=form.formId,
        sessionId=submission.sessionId, difficultyTier=form.difficultyTier,
        correct=correct, score=score, assisted=assisted,
        reviewRequired=not assisted and review_band[0] <= score <= review_band[1],
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
