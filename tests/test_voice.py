import io
import json
import itertools
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from voice import server
from voice.tree import Check, Skill, recommend

def probe(skill, percent, form="A", session="1", **kwargs):
    return Check(
        skill=skill, correct=percent, total=100, form=form, session=session, **kwargs
    )

class RoutingTests(unittest.TestCase):
    def test_all_eight_clear_patterns(self):
        for scores in itertools.product((45, 90), repeat=3):
            with self.subTest(scores=scores):
                gaps = [skill for skill, score in zip(Skill, scores) if score == 45]
                result = recommend([probe(skill, score) for skill, score in zip(Skill, scores)])
                self.assertEqual(result["raw_below"], gaps)
                self.assertEqual(result["active_gaps"], gaps)
                self.assertEqual(result["queued_gaps"], gaps[2:])
                self.assertEqual(result["primary_skill"], gaps[0] if gaps else None)
                self.assertEqual(result["teacher_review"], len(gaps) == 3)

    def test_borderline_scores_do_not_immediately_change_level(self):
        result = recommend([probe(skill, score) for skill, score in zip(Skill, [79, 81, 78])])
        self.assertEqual(result["raw_below"], [Skill.PHONICS, Skill.COMPREHENSION])
        self.assertEqual(result["active_gaps"], [])
        self.assertEqual(result["recheck"], list(Skill))
        self.assertIn("current level", result["primary"])

    def test_reassessment_promotes_next_gap_after_two_fresh_sessions(self):
        baseline = [probe(skill, score) for skill, score in zip(Skill, [45, 70, 90])]
        first = probe("phonics", 80, "B", "2")
        second = probe("phonics", 80, "C", "3")
        self.assertEqual(recommend(baseline + [first])["primary_skill"], Skill.PHONICS)
        self.assertEqual(recommend(baseline + [first, second])["primary_skill"], Skill.ORAL)

    def test_repeated_assisted_inaccessible_and_exit_items_cannot_clear_gap(self):
        baseline = [probe("phonics", 45), probe("phonics", 90, "B", "2")]
        for event in (
            probe("phonics", 90, "B", "3"),
            probe("phonics", 90, "C", "2"),
            probe("phonics", 90, "C", "3", assisted=True),
            probe("phonics", 90, "C", "3", usable=False),
            probe("phonics", 90, "C", "3", kind="exit_item"),
            probe("phonics", 90, "C", "3", tier="easier"),
        ):
            with self.subTest(event=event):
                self.assertEqual(recommend(baseline + [event])["primary_skill"], Skill.PHONICS)

    def test_inaccessible_text_and_teacher_override(self):
        checks = [probe(skill, score) for skill, score in zip(Skill, [90, 90, 45])]
        default = recommend(checks, print_accessible=False)
        self.assertTrue(default["teacher_review"])
        override = SimpleNamespace(activity="Read aloud together.", reason="Check listening.")
        result = recommend(checks, print_accessible=False, override=override)
        self.assertEqual(result["primary"], override.activity)
        self.assertEqual(result["active_gaps"], default["active_gaps"])

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_plan_validation_and_response(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        check = probe("phonics", 45).model_dump(mode="json")
        result = self.client.post("/api/plan", json={"checks": [check]})
        self.assertEqual(result.json()["primary_skill"], "phonics")
        self.assertEqual(self.client.post("/api/plan", json={
            "checks": [{**check, "correct": 101}]
        }).status_code, 422)

    def test_demo_fixtures_match_documented_routes(self):
        response = self.client.get("/fixtures.json")
        self.assertEqual(response.status_code, 200)
        fixtures = json.loads(response.text)
        expected = ["phonics", "oral", "phonics", "comprehension", "phonics", None, None, None]
        self.assertEqual(len(fixtures), len(expected))
        for fixture, primary in zip(fixtures, expected):
            with self.subTest(learner=fixture["label"]):
                data = self.client.post("/api/plan", json={"checks": fixture["checks"]}).json()
                self.assertEqual(data["primary_skill"], primary)

    def test_transcript_and_teacher_scores_are_separate(self):
        class Model:
            def transcribe(self, audio, **kwargs):
                assert isinstance(audio, io.BytesIO) and audio.read() == b"sample"
                return iter([SimpleNamespace(text=" I put the ten in the bag.")]), {}
        with patch.object(server, "voice_model", return_value=Model()):
            result = self.client.post("/api/transcribe", files={"clip": ("sample.wav", b"sample")})
        self.assertEqual(result.json(), {"transcript": "I put the ten in the bag."})

    def test_upload_limits(self):
        for payload, code in ((b"", 400), (b"x" * (server.MAX_BYTES + 1), 413)):
            with self.subTest(code=code):
                result = self.client.post("/api/transcribe", files={"clip": ("sample.wav", payload)})
                self.assertEqual(result.status_code, code)

    @unittest.skipUnless(os.getenv("BASABRIDGE_TEST_AUDIO"), "Set BASABRIDGE_TEST_AUDIO for real inference")
    def test_real_inference(self):
        path = Path(os.environ["BASABRIDGE_TEST_AUDIO"])
        result = self.client.post("/api/transcribe", files={"clip": (path.name, path.read_bytes())})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["transcript"].strip(), result.text)
        print(f"Observed transcript: {result.json()['transcript']}")

if __name__ == "__main__":
    unittest.main()
