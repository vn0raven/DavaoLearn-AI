import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from backend.server import create_app


class FreshCheckTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.db = Path(temp.name) / "test.sqlite3"
        self.api = TestClient(create_app(self.db))
        self.addCleanup(self.api.close)

    def fresh(self, skill, tier="short-text"):
        response = self.api.get("/api/assessment-forms/fresh/demo-practice", params={"skill": skill, "tier": tier})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def mark(self, form, fresh=True):
        return self.api.post("/api/assessment-forms/exposure", json={
            "learnerId": "demo-practice", "formId": form, "requireFresh": fresh,
        })

    def test_unseen_right_tier_only_and_exposure_does_not_change_evidence(self):
        path = "/api/evidence/learners/demo-practice"
        prior = self.api.get(path).json()
        self.assertEqual(self.fresh("phonics", "CVCC-final-nt")["formId"], "PHONICS-A")
        self.assertIsNone(self.fresh("phonics", "other-tier")["formId"])
        self.assertEqual(self.mark("PHONICS-A").status_code, 200)
        self.assertEqual(self.mark("PHONICS-A").status_code, 409)
        exhausted = self.fresh("phonics", "CVCC-final-nt")
        self.assertIsNone(exhausted["formId"])
        self.assertIn("Teacher review", exhausted["reason"])
        self.assertEqual(self.api.get(path).json(), prior)

    def test_shared_passages_are_excluded_across_skills_and_restart(self):
        self.assertEqual(self.fresh("oral")["formId"], "ORAL-A")
        self.assertEqual(self.mark("ORAL-A", fresh=False).status_code, 200)
        self.assertEqual(self.fresh("comprehension")["formId"], "COMP-B")
        with TestClient(create_app(self.db)) as reloaded:
            response = reloaded.get("/api/assessment-forms/fresh/demo-practice?skill=oral&tier=short-text")
            self.assertEqual(response.json()["formId"], "ORAL-B")

        payload = {"eventId": "attempt", "learnerId": "demo-practice", "sessionId": "new-session",
                   "formId": "COMP-B", "difficultyTier": "short-text", "mode": "independent", "requireFresh": True}
        opened = self.api.post("/api/comprehension/start", json=payload)
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(self.api.post("/api/comprehension/start", json=payload).status_code, 200)
        self.assertNotIn("correctAnswerId", opened.text)
        self.assertIsNone(self.fresh("oral")["formId"])

    def test_fresh_open_is_atomic_when_two_routes_choose_same_passage(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(response.status_code for response in pool.map(self.mark, ["ORAL-A", "COMP-A"]))
        self.assertEqual(statuses, [200, 409])
        self.assertEqual(self.mark("UNKNOWN").status_code, 404)

    def test_assisted_mode_cannot_open_a_fresh_check(self):
        response = self.api.post("/api/comprehension/start", json={
            "eventId": "attempt", "learnerId": "demo-practice", "sessionId": "new-session",
            "formId": "COMP-A", "difficultyTier": "short-text", "mode": "assisted", "requireFresh": True,
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.fresh("comprehension")["formId"], "COMP-A")
