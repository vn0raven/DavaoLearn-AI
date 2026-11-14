"""Synthetic six-phase contract smoke checks; never use real learner identifiers."""
import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend.evidence import ApprovedForm, AssessmentEvent, Rules
from backend.evidence_store import EvidenceStore
from backend.plan import plan_from_profile
from backend.scoring import Conflict
from backend.server import create_app


class HackathonJourneyTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name)
        self.learner = "fictional-journey-001"
        self.tiers = {"phonics": "CVCC-final-nt", "oral": "short-text", "comprehension": "short-text"}
        self.approvals = [ApprovedForm(
            skill=skill, difficultyTier=tier, formId=f"{skill}-{number}", formVersion="1",
            group=f"{skill}-equivalent", approvedBy="Synthetic test fixture",
            approvalReference="Simulated approved forms for software QA only",
        ) for skill, tier in self.tiers.items() for number in range(1, 5)]
        self.store = EvidenceStore(self.path / "evidence.sqlite3", approvals=self.approvals)
        config = self.path / "config.json"
        config.write_text(json.dumps({"comparableForms": [item.model_dump(mode="json") for item in self.approvals]}))
        self.client = TestClient(create_app(evidence_path=self.store.path, evidence_config=config))
        self.when = datetime(2026, 11, 15, tzinfo=UTC)

    def add(self, skill, number, correct, total=5, **changes):
        event = AssessmentEvent(
            eventId=f"{skill}-{number}-event", learnerId=self.learner, sessionId=f"session-{number}",
            skill=skill, formId=f"{skill}-{number}", difficultyTier=self.tiers[skill],
            formVersion="1", correct=correct, total=total, assisted=False,
            usable=True, timestamp=self.when + timedelta(minutes=number), **changes,
        )
        self.store.ingest(event)
        return event

    def test_independent_to_recommendation_to_separate_reassessment(self):
        first = self.add("phonics", 1, 2)
        self.add("oral", 1, 5)
        self.add("comprehension", 1, 2)
        response = self.client.get(f"/api/evidence/learners/{self.learner}")
        self.assertEqual(response.status_code, 200)
        before = response.json()
        self.assertEqual(before["recommendation"]["primary"]["activityId"], "PHONICS_BASED_LEARNING")
        self.assertEqual(before["recommendation"]["secondary"]["activityId"], "GUIDED_COMPREHENSION")
        self.assertEqual(set(before["activeGaps"]), {"phonics", "comprehension"})
        self.assertEqual(before["rules"]["cutoff"], 80)
        self.assertEqual((before["rules"]["reviewLow"], before["rules"]["reviewHigh"]), (75, 85))
        # Assisted/invalid work cannot affect confirmed skill status.
        assisted = AssessmentEvent(
            eventId="phonics-assisted", learnerId=self.learner, sessionId="session-assisted",
            skill="phonics", formId="phonics-2", formVersion="1", difficultyTier=self.tiers["phonics"],
            correct=5, total=5, assisted=True, usable=True, timestamp=self.when + timedelta(minutes=2),
        )
        self.store.ingest(assisted)
        same = self.store.profile(self.learner, self.tiers)
        phonics = next(state for state in same["skills"] if state["skill"] == "phonics")
        self.assertEqual(phonics["status"], "SUPPORT")
        self.assertEqual(phonics["latestUsableScore"], 40)
        # Two new comparable independent checks in distinct sessions.
        self.add("phonics", 3, 5)
        middle = self.store.profile(self.learner, self.tiers)
        phonics_middle = next(state for state in middle["skills"] if state["skill"] == "phonics")
        self.assertEqual(phonics_middle["status"], "SUPPORT")
        self.add("phonics", 4, 5)
        end = self.client.get(f"/api/evidence/learners/{self.learner}").json()
        after_phonics = next(state for state in end["skills"] if state["skill"] == "phonics")
        self.assertEqual(after_phonics["status"], "READY")
        self.assertEqual(len(after_phonics["confirmationEventIds"]), 2)
        self.assertEqual(end["recommendation"]["primary"]["activityId"], "GUIDED_COMPREHENSION")
        self.assertEqual(len(end["events"]), 6)
        self.assertIn(first.eventId, {event["eventId"] for event in end["events"]})

    def test_overrides_audit_duplicate_rejection_and_missing_states(self):
        missing = self.client.get(f"/api/evidence/learners/{self.learner}").json()
        self.assertEqual(len(missing["missingEvidence"]), 3)
        item = self.add("phonics", 1, 2)
        self.assertEqual(self.store.ingest(item).eventId, item.eventId)  # Idempotent retry
        with self.assertRaises(Conflict):
            self.store.ingest(item.model_copy(update={"correct": 5}))
        response = self.client.post("/api/evidence/overrides", json={
            "overrideId": "teacher-override-1", "learnerId": self.learner, "sessionId": "session-1",
            "why": "Practise comprehension with supervision", "primaryActivityId": "GUIDED_COMPREHENSION",
            "timestamp": self.when.isoformat(),
        })
        self.assertEqual(response.status_code, 200, response.text)
        profile = self.client.get(f"/api/evidence/learners/{self.learner}?overrideSession=session-1").json()
        self.assertEqual(profile["recommendation"]["primary"]["activityId"], "GUIDED_COMPREHENSION")
        self.assertEqual(profile["events"][0]["correct"], 2)
        self.assertEqual(len(profile["originalSubmissions"]), 1)
        self.assertEqual(len(profile["revisions"]), 1)


if __name__ == "__main__":
    unittest.main()
