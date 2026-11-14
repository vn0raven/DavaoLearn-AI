"""Select fresh assessment material without creating assessment evidence."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import Field

from .evidence import Skill
from .evidence_api import ORAL_PASSAGES
from .scoring import Identifier, Model

EXPOSURE_SCHEMA = """
CREATE TABLE IF NOT EXISTS assessment_exposure (
    learner_id TEXT NOT NULL,
    form_id TEXT NOT NULL,
    passage_id TEXT,
    PRIMARY KEY (learner_id, form_id)
);
"""


def seen_material(db, learner_id):
    prior = db.execute("SELECT payload FROM assessment WHERE learner_id=?", (learner_id,)).fetchall()
    exposures = db.execute(
        "SELECT form_id, passage_id FROM assessment_exposure WHERE learner_id=?", (learner_id,),
    ).fetchall()
    events = [json.loads(row["payload"]) for row in prior]
    forms = {event["formId"] for event in events} | {row["form_id"] for row in exposures}
    passages = {event.get("passageId") for event in events} | {row["passage_id"] for row in exposures}
    return forms, passages


def mark_exposure(store, learner_id, form_id, passage_id=None, *, require_fresh=False):
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if require_fresh:
            forms, passages = seen_material(db, learner_id)
            if form_id in forms or (passage_id is not None and passage_id in passages):
                raise HTTPException(409, "This material was already seen. Request another fresh check.")
        db.execute("INSERT OR IGNORE INTO assessment_exposure VALUES (?, ?, ?)",
                   (learner_id, form_id, passage_id))


def create_router(store, phonics_forms, comprehension_forms):
    router = APIRouter(prefix="/api/assessment-forms")
    oral_forms = json.loads(ORAL_PASSAGES.read_text(encoding="utf-8"))
    options = {
        Skill.PHONICS: [(f.formId, f.difficultyTier, None) for f in phonics_forms.values()],
        Skill.ORAL: [(f["formId"], f["difficultyTier"], f["passageId"]) for f in oral_forms],
        Skill.COMPREHENSION: [(f.formId, f.difficultyTier, f.passageId) for f in comprehension_forms.values()],
    }
    known_forms = {form_id: passage for forms in options.values() for form_id, _, passage in forms}
    with store.connect() as db:
        db.executescript(EXPOSURE_SCHEMA)

    @router.post("/exposure")
    def record_exposure(exposure: Exposure):
        if exposure.formId not in known_forms:
            raise HTTPException(404, "Assessment form not found.")
        mark_exposure(store, exposure.learnerId, exposure.formId, known_forms[exposure.formId],
                      require_fresh=exposure.requireFresh)
        return {"recorded": True}

    @router.get("/fresh/{learner_id}")
    def find_fresh(learner_id: Identifier, skill: Skill, tier: Identifier):
        with store.connect() as db:
            db.execute("BEGIN")
            seen_forms, seen_passages = seen_material(db, learner_id)
        for form_id, difficulty, passage_id in options[skill]:
            if difficulty == tier and form_id not in seen_forms and (passage_id is None or passage_id not in seen_passages):
                return {"skill": skill, "formId": form_id, "difficultyTier": tier}
        return {"skill": skill, "formId": None, "difficultyTier": tier,
                "reason": "Teacher review: no unseen assessment form is available at this tier."}

    return router


class Exposure(Model):
    learnerId: Identifier
    formId: Identifier
    requireFresh: bool = Field(default=False, strict=True)
