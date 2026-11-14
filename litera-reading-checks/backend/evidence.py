"""Shared assessment contract and deterministic routing-status projection."""

from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .scoring import Identifier, Model, calculate_score

VERSION = "litera-evidence-v1"


class Skill(StrEnum):
    PHONICS = "phonics"
    ORAL = "oral"
    COMPREHENSION = "comprehension"


class Status(StrEnum):
    SUPPORT = "SUPPORT"
    READY = "READY"
    UNCONFIRMED = "UNCONFIRMED"


class Rules(Model):
    version: Identifier = VERSION
    cutoff: int = Field(default=80, strict=True, ge=0, le=100)
    reviewLow: int = Field(default=75, strict=True, ge=0, le=100)
    reviewHigh: int = Field(default=85, strict=True, ge=0, le=100)

    @model_validator(mode="after")
    def valid_band(self):
        if not self.reviewLow <= self.cutoff <= self.reviewHigh:
            raise ValueError("The cutoff must be inside the review band.")
        return self


class AssessmentEvent(Model):
    eventId: Identifier
    learnerId: Identifier
    skill: Skill
    sessionId: Identifier
    formId: Identifier
    difficultyTier: Identifier
    kind: Literal["probe", "exit_item", "practice"] = "probe"
    correct: int | None = Field(default=None, strict=True)
    total: int | None = Field(default=None, strict=True)
    assisted: bool = Field(strict=True)
    usable: bool = Field(strict=True)
    timestamp: AwareDatetime
    formVersion: str = Field(min_length=1, max_length=64)
    rubricVersion: Identifier = "v1"
    conditions: Identifier = "standard"
    submissionStatus: Literal["complete", "incomplete", "interrupted", "invalid"] = "complete"
    reviewReason: str | None = Field(default=None, max_length=240)
    passageId: Identifier | None = None

    @model_validator(mode="after")
    def valid_counts(self):
        if self.correct is None and self.total is None:
            if self.submissionStatus == "complete":
                raise ValueError("A completed assessment needs both counts.")
        else:
            calculate_score(self.correct, self.total)
        if self.submissionStatus != "complete" and self.usable:
            raise ValueError("Only completed observations can be usable.")
        return self

    @property
    def score(self):
        return None if self.correct is None else calculate_score(self.correct, self.total)


class ApprovedForm(Model):
    skill: Skill
    difficultyTier: Identifier
    formId: Identifier
    formVersion: str = Field(min_length=1, max_length=64)
    rubricVersion: Identifier = "v1"
    conditions: Identifier = "standard"
    group: Identifier
    approvedBy: str = Field(min_length=1, max_length=120)
    approvalReference: str = Field(min_length=1, max_length=240)

    @property
    def key(self):
        return (self.skill, self.difficultyTier, self.formId, self.formVersion,
                self.rubricVersion, self.conditions)


class Override(Model):
    overrideId: Identifier
    learnerId: Identifier
    sessionId: Identifier
    skill: Skill | None = None
    why: str = Field(min_length=1, max_length=240, pattern=r"\S")
    selectedRecommendation: str = Field(min_length=1, max_length=240, pattern=r"\S")
    previousRecommendation: str | None = Field(default=None, max_length=240)
    timestamp: AwareDatetime


def empty_state():
    return {
        "status": Status.UNCONFIRMED, "latestUsableScore": None, "latestUsableEventId": None,
        "rawBelowCutoff": None, "missingEvidence": True, "reassess": True,
        "reason": "No usable independent probe.", "confirmationEventIds": [],
    }


def project(events: list[AssessmentEvent], rules: Rules, approved: dict):
    state = empty_state()
    history = []
    seen_forms = set()
    seen_passages = set()
    used_sessions = set()
    last_eligible = None
    has_initial = False
    for event in sorted(events, key=lambda item: (item.timestamp, item.eventId)):
        previous = state["status"]
        score = event.score
        result = {"eventId": event.eventId, "score": float(score) if score is not None else None}
        repeated = event.formId in seen_forms or (
            event.passageId is not None and event.passageId in seen_passages
        )
        seen_forms.add(event.formId)
        if event.passageId:
            seen_passages.add(event.passageId)
        if event.kind != "probe":
            history.append({**result, "disposition": "practice-only", "statusAfter": previous})
            continue

        if event.submissionStatus != "complete" or event.assisted or not event.usable:
            reason = event.reviewReason or (
                "Assisted assessment." if event.assisted else "Incomplete or unusable assessment."
            )
            history.append({**result, "disposition": "excluded", "reason": reason, "statusAfter": previous})
            state.update(reassess=True, reason=reason)
            continue

        direction = Status.SUPPORT if score < rules.cutoff else Status.READY
        initial = not has_initial and not repeated
        state.update(
            latestUsableScore=float(score), latestUsableEventId=event.eventId,
            rawBelowCutoff=direction == Status.SUPPORT, missingEvidence=False,
        )
        if initial:
            has_initial = True
            outside_band = not rules.reviewLow <= score <= rules.reviewHigh
            if outside_band:
                state.update(status=direction, reassess=False, reason="Initial usable score is outside the review band.")
            else:
                state.update(reason="Initial usable score is within the inclusive review band.")

        key = (event.skill, event.difficultyTier, event.formId, event.formVersion,
               event.rubricVersion, event.conditions)
        group = approved.get(key)
        same_session = event.sessionId in used_sessions
        used_sessions.add(event.sessionId)
        if repeated or same_session or group is None:
            disposition, reason = (
                ("repeated-form", "This form or passage was already used.") if repeated else
                ("same-session", "This session already contributed a probe.") if same_session else
                ("comparability-unapproved", "This form and its assessment conditions lack approved comparability.")
            )
            if not initial or state["status"] == Status.UNCONFIRMED:
                state.update(reassess=True, reason=reason)
            else:
                state["reason"] += " Form comparability requires educator review."
        else:
            disposition = "eligible"
            signature = (direction, group, event.rubricVersion, event.conditions)
            agrees = last_eligible is not None and last_eligible[1] == signature
            if agrees:
                state.update(
                    status=direction, reassess=False, reason="Two fresh approved probes from separate sessions agree.",
                    confirmationEventIds=[last_eligible[0], event.eventId],
                )
            elif not initial:
                comparable = last_eligible is None or last_eligible[1][1:] == signature[1:]
                needs_check = state["status"] != direction or not comparable
                state.update(
                    reassess=needs_check,
                    reason="Latest approved probes have different comparison groups or conditions." if not comparable
                    else "Keep the prior status pending a fresh comparable probe." if needs_check
                    else "Latest eligible probe agrees with the current status.",
                )
            last_eligible = (event.eventId, signature)
            reason = state["reason"]
        history.append({
            **result, "disposition": disposition, "reason": reason, "statusBefore": previous,
            "statusAfter": state["status"], "formGroup": group,
        })
    return state, history
