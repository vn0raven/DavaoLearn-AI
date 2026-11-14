import io
import json
import sys
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.evidence import ApprovedForm, AssessmentEvent, Rules, Skill
from backend.evidence_store import EvidenceStore
from backend.scoring import Conflict, calculate_score
from backend.server import create_app

TIERS = {Skill.PHONICS: "CVCC-final-nt", Skill.ORAL: "short-text", Skill.COMPREHENSION: "short-text"}
LEARNER = "fictional-learner"


def evidence(number=1, correct=3, total=5, skill=Skill.PHONICS, **changes):
    fields = dict(
        eventId=f"check-{number}", learnerId=LEARNER, skill=skill,
        sessionId=f"session-{number}", formId=f"form-{number}", difficultyTier=TIERS[skill],
        correct=correct, total=total, assisted=False, usable=True, formVersion="1",
        timestamp=datetime(2026, 1, 1, 0, number, tzinfo=UTC),
    )
    return AssessmentEvent(**(fields | changes))


def approvals():
    return [
        ApprovedForm(
            skill="phonics", difficultyTier=TIERS[Skill.PHONICS], formId=f"form-{n}",
            formVersion="1", group="demo-fixture", approvedBy="Test fixture",
            approvalReference="Synthetic assignment for software verification only",
        )
        for n in range(1, 6)
    ]


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = Path(temp.name) / "evidence.sqlite3"
        self.store = EvidenceStore(self.db, approvals=approvals())

    def profile(self):
        return self.store.profile(LEARNER, TIERS)

    def state(self, skill="phonics", tier=None):
        return next(x for x in self.profile()["skills"] if x["skill"] == skill and x["difficultyTier"] == (tier or TIERS[skill]))

    def test_shared_counts_and_exact_percentage(self):
        self.assertEqual(calculate_score(3, 5), 60)
        self.assertEqual(calculate_score(17, 20), 85)
        self.assertLess(calculate_score(7999, 10000), 80)
        self.assertEqual(calculate_score(4, 5), 80)
        for bad in ((0, 0), (2, 1), (-1, 1), (True, 1), (1.0, 1)):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                calculate_score(*bad)
        for value in (-1, 6, True, "3", None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                evidence(correct=value)

    def test_missing_evidence_has_no_score(self):
        result = self.state()
        self.assertIsNone(result["latestUsableScore"])
        self.assertIsNone(result["rawBelowCutoff"])
        self.assertTrue(result["missingEvidence"])
        self.assertEqual(result["status"], "UNCONFIRMED")

    def test_independent_skills_tiers_and_example_progression(self):
        events = [evidence(), evidence(2, 18, 20, Skill.ORAL), evidence(3, 4, 5, Skill.COMPREHENSION)]
        for event in events:
            self.store.ingest(event)
        self.assertEqual([self.state(skill)["status"] for skill in TIERS], ["SUPPORT", "READY", "UNCONFIRMED"])
        self.store.ingest(evidence(4, 4))
        self.assertEqual(self.state()["status"], "SUPPORT")
        self.assertEqual(self.state()["latestUsableScore"], 80)
        self.assertTrue(self.state()["reassess"])
        self.store.ingest(evidence(5, 4))
        self.assertEqual(self.state()["status"], "READY")
        self.assertEqual(self.state()["confirmationEventIds"], ["check-4", "check-5"])
        self.assertEqual(self.state("comprehension")["status"], "UNCONFIRMED")
        self.store.ingest(evidence(6, difficultyTier="different-tier"))
        self.assertEqual(self.state(tier="different-tier")["status"], "SUPPORT")
        self.assertEqual(self.state()["status"], "READY")

    def test_inclusive_review_band_and_configurable_cutoff(self):
        for n, percent in enumerate((74, 75, 80, 85, 86), 1):
            event = evidence(n, percent, 100, learnerId=f"learner-{n}")
            self.store.ingest(event)
            profile = self.store.profile(event.learnerId, TIERS)
            expected = "SUPPORT" if percent < 75 else "READY" if percent > 85 else "UNCONFIRMED"
            self.assertEqual(profile["planInput"]["evidence"]["phonics"]["status"], expected.lower())
        self.store = EvidenceStore(self.db, Rules(version="fixture-82", cutoff=82), approvals())
        self.store.ingest(evidence(1, 80, 100, eventId="config-boundary"))
        self.assertTrue(self.state()["rawBelowCutoff"])
        self.assertEqual(self.profile()["revisions"][-1]["configuration"]["rules"]["version"], "fixture-82")

    def test_two_failures_reopen_support(self):
        self.store.ingest(evidence(correct=5))
        self.store.ingest(evidence(2, 3))
        self.assertEqual(self.state()["status"], "READY")
        self.assertTrue(self.state()["reassess"])
        self.store.ingest(evidence(3, 3))
        self.assertEqual(self.state()["status"], "SUPPORT")

    def test_assisted_unusable_and_interrupted_excluded(self):
        self.store.ingest(evidence())
        self.store.ingest(evidence(2, 5, assisted=True))
        self.store.ingest(evidence(3, 5, usable=False, reviewReason="Print inaccessible"))
        self.store.ingest(evidence(4, None, None, usable=False, submissionStatus="interrupted"))
        state = self.state()
        self.assertEqual((state["status"], state["latestUsableScore"]), ("SUPPORT", 60))
        self.assertTrue(state["reassess"])
        self.assertIsNone(state["history"][-1]["score"])
        self.assertEqual(len(self.profile()["revisions"]), 4)

    def test_practice_never_counts_toward_confirmation(self):
        self.store.ingest(evidence())
        self.store.ingest(evidence(2, 5, kind="practice"))
        self.store.ingest(evidence(3, 5, kind="exit_item"))
        self.assertEqual(self.state()["status"], "SUPPORT")
        self.assertEqual(self.state()["latestUsableScore"], 60)

    def test_repeated_form_same_session_wrong_version_and_conditions_cannot_confirm(self):
        self.store.ingest(evidence())
        self.store.ingest(evidence(2, 4))
        self.store.ingest(evidence(3, 4, formId="form-2"))
        self.store.ingest(evidence(4, 4, sessionId="session-2"))
        self.store.ingest(evidence(5, 4, formVersion="unapproved-version"))
        self.store.ingest(evidence(6, 4, formId="form-5", conditions="different"))
        state = self.state()
        self.assertEqual(state["status"], "SUPPORT")
        self.assertEqual([h["disposition"] for h in state["history"][-4:]],
                         ["repeated-form", "same-session", "comparability-unapproved", "repeated-form"])

    def test_distinct_form_groups_and_conditions_do_not_combine(self):
        for field, changed in (("group", "different"), ("conditions", "different"), ("rubricVersion", "different")):
            with self.subTest(field=field):
                self.store = EvidenceStore(self.db, approvals=[
                    *approvals()[:2], approvals()[2].model_copy(update={field: changed}),
                ])
                learner = f"learner-{field}"
                self.store.ingest(evidence(1, learnerId=learner, eventId=f"{learner}-1"))
                self.store.ingest(evidence(2, 4, learnerId=learner, eventId=f"{learner}-2"))
                overrides = {} if field == "group" else {field: changed}
                self.store.ingest(evidence(3, 4, learnerId=learner, eventId=f"{learner}-3", **overrides))
                state = self.store.profile(learner, TIERS)["planInput"]["evidence"]["phonics"]
                self.assertEqual(state["status"], "support")
                self.assertTrue(state["recheck"])

    def test_reused_passage_not_fresh_even_with_new_form_id(self):
        self.store.ingest(evidence(1, passageId="same-text"))
        self.store.ingest(evidence(2, 5, passageId="same-text"))
        self.store.ingest(evidence(3, 5, passageId="new-text"))
        self.assertEqual(self.state()["status"], "SUPPORT")
        self.assertEqual(self.state()["history"][1]["disposition"], "repeated-form")

    def test_reload_and_out_of_order_projection(self):
        self.store.ingest(evidence(3, 4))
        self.store.ingest(evidence(1))
        self.store.ingest(evidence(2, 4))
        before = self.profile()
        self.store = EvidenceStore(self.db, approvals=approvals())
        self.assertEqual(self.profile(), before)
        self.assertEqual(self.state()["status"], "READY")
        self.assertEqual([event.eventId for event in before["events"]], ["check-1", "check-2", "check-3"])
        self.assertEqual([revision["eventId"] for revision in before["revisions"]], ["check-3", "check-1", "check-2"])

    def test_duplicate_conflict_and_concurrent_same_submission(self):
        event = evidence()
        with ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(list(pool.map(self.store.ingest, [event] * 12)), [event] * 12)
        with self.assertRaises(Conflict):
            self.store.ingest(evidence(correct=5))
        self.assertEqual(len(self.profile()["events"]), 1)
        self.assertEqual(len(self.profile()["revisions"]), 1)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = Path(temp.name) / "evidence.sqlite3"
        self.api = TestClient(create_app(self.db))
        self.addCleanup(self.api.close)

    def profile(self, **params):
        return self.api.get(f"/api/evidence/learners/{LEARNER}", params=params).json()

    def phonics(self):
        form = self.api.get("/api/forms").json()[0]
        return {
            "eventId": "p-1", "learnerId": LEARNER, "formId": form["formId"], "sessionId": "s-1",
            "judgments": [
                {"itemId": item["itemId"], "attemptId": f"p-{i}", "assisted": False,
                 "verdict": "CORRECT" if i < 3 else "INCORRECT"}
                for i, item in enumerate(form["items"])
            ],
        }

    def test_stt_failure_writes_no_evidence_and_teacher_marks_decide(self):
        audio = io.BytesIO()
        with wave.open(audio, "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            output.writeframes(b"\xff\x03" * 16000)
        data = self.phonics()
        with patch("backend.speech.transcribe", side_effect=RuntimeError("No model")), self.assertLogs("backend.server"):
            response = self.api.post("/api/phonics/transcribe",
                data={"attemptId": "p-0", "formId": data["formId"], "itemId": data["judgments"][0]["itemId"]},
                files={"clip": ("fiction.wav", audio.getvalue(), "audio/wav")})
        self.assertEqual(response.json()["indication"], "unavailable")
        self.assertEqual(self.profile()["events"], [])
        self.assertEqual(self.api.post("/api/phonics/complete", json=data).json()["event"]["score"], 60)
        restarted_api = TestClient(create_app(self.db))
        data["judgments"].reverse()
        self.assertEqual(restarted_api.post("/api/phonics/complete", json=data).status_code, 200)
        restarted_api.close()
        profile = self.profile()
        self.assertEqual(len(profile["events"]), 1)
        self.assertEqual(profile["planInput"]["evidence"]["phonics"]["status"], "support")
        self.assertNotIn("transcript", json.dumps(profile))

    def test_assisted_phonics_persists_practice_only(self):
        data = self.phonics()
        data["judgments"][0]["assisted"] = True
        result = self.api.post("/api/phonics/complete", json=data)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["evidence"]["assisted"])
        self.assertIsNone(self.profile()["planInput"]["evidence"]["phonics"]["score"])

    def test_oral_server_scores_teacher_judgments_and_logs_invalid_attempt(self):
        data = {
            "eventId": "o-1", "learnerId": LEARNER, "sessionId": "s-1", "formId": "ORAL-A",
            "passageVersion": "1.0.0", "assistance": "independent", "verified": True,
            "words": [{"id": f"seed-bag@1.0.0:{i}", "judgment": "CORRECT" if i <= 37 else "INCORRECT"}
                      for i in range(1, 42)],
        }
        incomplete = {**data, "words": data["words"][:-1]}
        self.assertEqual(self.api.post("/api/evidence/oral", json=incomplete).status_code, 422)
        self.assertEqual(len(self.profile()["rejectedSubmissions"]), 1)
        self.assertEqual(self.profile()["events"], [])
        response = self.api.post("/api/evidence/oral", json=data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["event"]["correct"], 37)
        self.assertAlmostEqual(self.profile()["planInput"]["evidence"]["oral"]["score"], 100 * 37 / 41)

    def test_comprehension_adapter_records_verified_score(self):
        from backend.comprehension import load_forms
        form = load_forms()["COMP-A"]
        data = {"eventId": "c-1", "learnerId": LEARNER, "sessionId": "s-1",
                "formId": form.formId, "difficultyTier": form.difficultyTier, "mode": "independent"}
        self.assertEqual(self.api.post("/api/comprehension/start", json=data).status_code, 200)
        answers = [{"questionId": q.questionId, "answerId": q.correctAnswerId} for q in form.questions]
        first = form.questions[0]
        answers[0]["answerId"] = next(c.answerId for c in first.choices if c.answerId != first.correctAnswerId)
        result = self.api.post("/api/comprehension/c-1/complete", json={"responses": answers, "assisted": False})
        self.assertEqual(result.status_code, 200, result.text)
        profile = self.profile()
        self.assertEqual(profile["planInput"]["evidence"]["comprehension"]["score"], 80)
        self.assertEqual(profile["planInput"]["evidence"]["comprehension"]["status"], "unconfirmed")
        self.assertEqual(profile["events"][0]["formVersion"], form.version)
        with TestClient(create_app(self.db)) as reloaded:
            retry = reloaded.post("/api/comprehension/c-1/complete", json={
                "responses": list(reversed(answers)), "assisted": False,
            })
            self.assertEqual(retry.json(), result.json())

    def test_teacher_override_preserves_evidence_and_reaches_existing_tree(self):
        self.api.post("/api/phonics/complete", json=self.phonics()).raise_for_status()
        baseline = self.profile()
        override = {
            "overrideId": "override-1", "learnerId": LEARNER, "sessionId": "s-2", "skill": "phonics",
            "why": "Teacher observed fatigue.", "previousRecommendation": "Blend target pattern.",
            "selectedRecommendation": "Reread with a teacher.", "timestamp": "2026-01-01T00:00:00Z",
        }
        self.api.post("/api/evidence/overrides", json=override).raise_for_status()
        updated = self.profile(overrideSession="s-2")
        self.assertEqual(updated["events"], baseline["events"])
        self.assertEqual(updated["revisions"], baseline["revisions"])
        self.assertEqual(updated["skills"], baseline["skills"])
        self.assertEqual(updated["overrides"][0]["previousRecommendation"], override["previousRecommendation"])
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        self.addCleanup(sys.path.remove, sys.path[0])
        from voice.server import app
        with TestClient(app) as router:
            result = router.post("/api/plan", json=updated["planInput"])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["active_gaps"], ["phonics"])
        self.assertEqual(result.json()["primary"], override["selectedRecommendation"])
