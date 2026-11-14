"""SQLite evidence, original inputs, overrides and classification revisions."""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .evidence import AssessmentEvent, Override, Rules, Skill, project
from .scoring import Conflict

SCHEMA = """
CREATE TABLE IF NOT EXISTS assessment (
    event_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    skill TEXT NOT NULL,
    tier TEXT NOT NULL,
    payload TEXT NOT NULL,
    source_key TEXT NOT NULL,
    original TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_scope ON assessment(learner_id, skill, tier);
CREATE TABLE IF NOT EXISTS scoring_revision (
    event_id TEXT PRIMARY KEY REFERENCES assessment(event_id),
    configuration TEXT NOT NULL,
    before_state TEXT NOT NULL,
    after_state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_override (
    override_id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rejected_submission (
    id INTEGER PRIMARY KEY,
    learner_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    reason TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (learner_id, event_id, payload, reason)
);
"""


def encode(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


class EvidenceStore:
    def __init__(self, path, rules=None, approvals=()):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.rules = rules or Rules()
        self.approvals = tuple(approvals)
        self.approved = {item.key: item.group for item in self.approvals}
        if len(self.approved) != len(self.approvals):
            raise ValueError("Duplicate form approval.")
        self.config = {
            "rules": self.rules.model_dump(mode="json"),
            "approvals": [item.model_dump(mode="json") for item in self.approvals],
        }
        with self.connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _events(self, db, learner, skill=None, tier=None):
        if skill is None:
            query = db.execute("SELECT payload FROM assessment WHERE learner_id=?", (learner,))
        else:
            query = db.execute(
                "SELECT payload FROM assessment WHERE learner_id=? AND skill=? AND tier=?",
                (learner, skill, tier),
            )
        return [AssessmentEvent.model_validate_json(row["payload"]) for row in query]

    def ingest(self, event: AssessmentEvent, original=None, *, stable_source=False):
        payload = event.model_dump(mode="json")
        source = original if original is not None else payload
        # Server-stamped adapter retries use the verified source payload as their idempotency key.
        identity = {k: v for k, v in payload.items() if k != "timestamp" or not stable_source}
        fingerprint = encode([identity, source])
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT payload, source_key FROM assessment WHERE event_id=?", (event.eventId,),
            ).fetchone()
            if existing:
                if fingerprint != existing["source_key"]:
                    raise Conflict("This event ID already identifies another submission.")
                return AssessmentEvent.model_validate_json(existing["payload"])
            scope = self._events(db, event.learnerId, event.skill, event.difficultyTier)
            before, _ = project(scope, self.rules, self.approved)
            after, _ = project([*scope, event], self.rules, self.approved)
            db.execute("INSERT INTO assessment VALUES (?,?,?,?,?,?,?)",
                       (event.eventId, event.learnerId, event.skill, event.difficultyTier,
                        encode(payload), fingerprint, encode(source)))
            db.execute("INSERT INTO scoring_revision VALUES (?,?,?,?)",
                       (event.eventId, encode(self.config), encode(before), encode(after)))
        return event

    def stored_submission(self, event_id):
        with self.connect() as db:
            row = db.execute("SELECT payload, original FROM assessment WHERE event_id=?", (event_id,)).fetchone()
        if row:
            return AssessmentEvent.model_validate_json(row["payload"]), json.loads(row["original"])
        return None

    def prior_events(self, learner, skill, tier):
        with self.connect() as db:
            return self._events(db, learner, skill, tier)

    def reject(self, learner, event_id, source, reason):
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO rejected_submission(learner_id,event_id,payload,reason) VALUES (?,?,?,?)",
                       (learner, event_id, encode(source), reason))

    def record_override(self, override: Override):
        payload = override.model_dump_json()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT payload FROM evidence_override WHERE override_id=?",
                               (override.overrideId,)).fetchone()
            if prior and Override.model_validate_json(prior["payload"]) != override:
                raise Conflict("This override ID already identifies another record.")
            if not prior:
                db.execute("INSERT INTO evidence_override VALUES (?,?,?)",
                           (override.overrideId, override.learnerId, payload))
        return override

    def profile(self, learner, selected_tiers, override_session=None):
        with self.connect() as db:
            db.execute("BEGIN")
            events = self._events(db, learner)
            audits = db.execute("""
                SELECT assessment.event_id, original, configuration, before_state, after_state
                FROM assessment JOIN scoring_revision USING(event_id) WHERE learner_id=?
                ORDER BY assessment.rowid
                """, (learner,)).fetchall()
            overrides = [Override.model_validate_json(row["payload"]) for row in db.execute(
                "SELECT payload FROM evidence_override WHERE learner_id=?", (learner,))]
            rejected = db.execute("""
                SELECT event_id, payload, reason, received_at FROM rejected_submission
                WHERE learner_id=? ORDER BY id
                """, (learner,)).fetchall()
        scopes = {(skill, tier): [] for skill, tier in selected_tiers.items()}
        for event in events:
            scopes.setdefault((event.skill, event.difficultyTier), []).append(event)
        states = []
        tree = {}
        references = {}
        for (skill, tier), checks in sorted(scopes.items()):
            state, history = project(checks, self.rules, self.approved)
            states.append({"skill": skill, "difficultyTier": tier, **state, "history": history})
            if tier == selected_tiers.get(skill):
                references[skill] = state["latestUsableEventId"]
                tree[skill] = {
                    "status": state["status"].lower(), "score": state["latestUsableScore"],
                    "raw_below": state["rawBelowCutoff"] is True, "recheck": state["reassess"],
                    "note": state["reason"],
                }
        overrides.sort(key=lambda item: (item.timestamp, item.overrideId))
        plan_input = {"evidence": tree, "learnerId": learner,
                      "selectedTiers": selected_tiers, "evidenceRefs": references}
        matching = [item for item in overrides if item.sessionId == override_session]
        if matching:
            latest = matching[-1]
            plan_input["override"] = latest.plan_input()
        return {
            "learnerId": learner, "rules": self.rules, "selectedTiers": selected_tiers, "skills": states,
            "activeGaps": [skill for skill in Skill if tree[skill]["status"] == "support"],
            "unconfirmed": [skill for skill in Skill if tree[skill]["status"] == "unconfirmed"],
            "missingEvidence": [skill for skill in Skill if tree[skill]["score"] is None],
            "reassessmentQueue": [skill for skill in Skill if tree[skill]["recheck"]],
            "events": sorted(events, key=lambda item: (item.timestamp, item.eventId)),
            "revisions": [{"eventId": row["event_id"], "configuration": json.loads(row["configuration"]),
                           "before": json.loads(row["before_state"]), "after": json.loads(row["after_state"])}
                          for row in audits],
            "originalSubmissions": {row["event_id"]: json.loads(row["original"]) for row in audits},
            "rejectedSubmissions": [{"eventId": row["event_id"], "submission": json.loads(row["payload"]),
                                     "reason": row["reason"], "receivedAt": row["received_at"]} for row in rejected],
            "overrides": overrides,
            "planInput": plan_input,
        }
