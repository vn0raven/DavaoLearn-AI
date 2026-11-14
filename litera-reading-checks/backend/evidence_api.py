"""Adapters for verified module results and endpoints for evidence history."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from .evidence import ApprovedForm, AssessmentEvent, Override, Rules, Skill
from .evidence_store import EvidenceStore
from .plan import PlanOverride, plan_from_profile
from .scoring import Conflict, Identifier, Model, to_tree_check

ORAL_PASSAGES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "oral" / "data" / "passages.json"


class Configuration(Model):
    rules: Rules = Field(default_factory=Rules)
    comparableForms: list[ApprovedForm] = Field(default_factory=list)


def open_store(db_path, config_path=None):
    config = Configuration.model_validate_json(Path(config_path).read_text(encoding="utf-8")) if config_path else Configuration()
    return EvidenceStore(db_path, config.rules, config.comparableForms)


def verified_event(source_event: BaseModel, version: str, *, timestamp=None):
    source = source_event.model_dump()
    payload = {key: value for key, value in source.items() if key in AssessmentEvent.model_fields}
    payload["formVersion"] = version
    payload["timestamp"] = timestamp or source.get("timestamp") or datetime.now(UTC)
    return AssessmentEvent.model_validate(payload)


def save_verified(store, event, original):
    try:
        return store.ingest(event, original, stable_source=True)
    except Conflict as exc:
        store.reject(event.learnerId, event.eventId, original, str(exc))
        raise HTTPException(409, str(exc)) from exc


class OralMark(Model):
    id: str = Field(min_length=1, max_length=180)
    judgment: Literal["CORRECT", "INCORRECT"]


class OralSubmission(Model):
    eventId: Identifier
    learnerId: Identifier
    sessionId: Identifier
    formId: Identifier
    passageVersion: str = Field(min_length=1, max_length=64)
    assistance: Literal["independent", "teacher-assisted", "modeling", "prompting"]
    verified: Literal[True]
    words: list[OralMark] = Field(max_length=200)


def create_router(store):
    router = APIRouter(prefix="/api/evidence")
    passages = {p["formId"]: p for p in json.loads(ORAL_PASSAGES.read_text(encoding="utf-8"))}

    @router.post("/oral")
    def complete_oral(submission: OralSubmission):
        source = submission.model_dump(mode="json")
        source["words"].sort(key=lambda item: item["id"])
        passage = passages.get(submission.formId)
        if not passage or passage["version"] != submission.passageVersion:
            reason = "Unknown oral form or passage version."
            store.reject(submission.learnerId, submission.eventId, source, reason)
            raise HTTPException(422, reason)
        expected = {
            f"{passage['passageId']}@{passage['version']}:{position}"
            for position in range(1, passage["wordCount"] + 1)
        }
        if len(submission.words) != len(expected) or {mark.id for mark in submission.words} != expected:
            reason = "Teacher judgments must cover each word in the configured passage exactly once."
            store.reject(submission.learnerId, submission.eventId, source, reason)
            raise HTTPException(422, reason)
        event = AssessmentEvent(
            eventId=submission.eventId, learnerId=submission.learnerId, sessionId=submission.sessionId,
            skill=Skill.ORAL, formId=submission.formId, formVersion=submission.passageVersion,
            passageId=passage["passageId"], difficultyTier=passage["difficultyTier"],
            correct=sum(mark.judgment == "CORRECT" for mark in submission.words),
            total=len(expected), assisted=submission.assistance != "independent", usable=True,
            timestamp=datetime.now(UTC),
        )
        saved = save_verified(store, event, source)
        return {"event": saved, "treeCheck": to_tree_check(saved)}

    @router.get("/learners/{learner_id}")
    def learner_evidence(
        learner_id: Identifier, phonicsTier: Identifier = "CVCC-final-nt",
        oralTier: Identifier = "short-text", comprehensionTier: Identifier = "short-text",
        overrideSession: Identifier | None = None,
        printAccessible: bool = True, supportStalled: bool = False,
    ):
        profile = store.profile(learner_id, {
            Skill.PHONICS: phonicsTier, Skill.ORAL: oralTier, Skill.COMPREHENSION: comprehensionTier,
        }, overrideSession)
        profile["planInput"].update(print_accessible=printAccessible, support_stalled=supportStalled)
        profile["recommendation"] = plan_from_profile(
            profile, print_accessible=printAccessible, support_stalled=supportStalled,
        )
        return profile

    @router.post("/overrides")
    def override(override: Override):
        try:
            PlanOverride.model_validate(override.plan_input())
        except ValidationError as exc:
            raise HTTPException(422, "Supply supported activity IDs or difficulty tiers and an override reason.") from exc
        try:
            return store.record_override(override)
        except Conflict as exc:
            raise HTTPException(409, str(exc)) from exc

    return router
