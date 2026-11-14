import io
import json
import os
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.scoring import load_forms
from backend.server import create_app
from backend import speech

def wav(silent=False):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav_file:
        wav_file.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav_file.writeframes((b"\0\0" if silent else b"\0\x08") * 4000)
    return stream.getvalue()

class PhonicsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app())
        self.form = load_forms()["PHONICS-A"]

    def clip(self, data, attempt="a0"):
        return self.client.post("/api/phonics/transcribe", files={"clip": ("test.wav", data)}, data={
            "formId": "PHONICS-A", "itemId": "A-01", "attemptId": attempt,
        })

    def payload(self, verdict="CORRECT"):
        return {
            "eventId": "event-1", "learnerId": "demo-1", "formId": self.form.formId,
            "sessionId": "session-1", "judgments": [
                {"itemId": item.itemId, "attemptId": f"a{i}", "assisted": False,
                 "verdict": verdict if i == 0 else "CORRECT"}
                for i, item in enumerate(self.form.items)
            ],
        }

    def complete(self, payload):
        return self.client.post("/api/phonics/complete", json=payload)

    def check_pair(self, text, indication, verdict, count):
        with patch.object(speech, "transcribe", return_value=text):
            r = self.clip(wav())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["indication"], indication)
        self.assertEqual(r.json()["attemptId"], "a0")
        r = self.complete(self.payload(verdict))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["event"]["correct"], count)

    def test_match_and_teacher_correct(self):
        self.check_pair(" TENT! ", "match", "CORRECT", 5)

    def test_mismatch_but_teacher_correct(self):
        self.check_pair("ten", "possible_mismatch", "CORRECT", 5)

    def test_match_but_teacher_incorrect(self):
        self.check_pair("tent", "match", "INCORRECT", 4)

    def test_empty_transcript(self):
        self.check_pair("", "unavailable", "CORRECT", 5)

    def test_multiple_tokens(self):
        self.check_pair("tent ten", "review", "CORRECT", 5)

    def test_unclear_retry_and_duplicate_item(self):
        payload = self.payload("UNCLEAR")
        self.assertEqual(self.complete(payload).status_code, 422)
        original = dict(payload["judgments"][0])
        payload["judgments"][0].update(attemptId="retry-1", verdict="CORRECT")
        payload["judgments"][1] = original
        self.assertEqual(self.complete(payload).status_code, 422)
        payload["judgments"][1] = self.payload()["judgments"][1]
        self.assertEqual(self.complete(payload).json()["event"]["total"], 5)

    def test_invalid_empty_silent_oversized(self):
        for data, status in [(b"broken", 422), (b"", 422), (wav(True), 422), (b"x" * (speech.MAX_BYTES + 1), 413)]:
            with self.subTest(status=status, size=len(data)):
                self.assertEqual(self.clip(data).status_code, status)

    def test_model_failure_leaves_teacher_scoring_available(self):
        with patch.object(speech, "transcribe", side_effect=RuntimeError("mock failure")):
            with self.assertLogs("backend.server", level="WARNING"):
                self.assertEqual(self.clip(wav()).json()["indication"], "unavailable")
        self.assertEqual(self.complete(self.payload()).status_code, 200)

    def test_assisted_attempt_cannot_produce_evidence(self):
        payload = self.payload()
        payload["judgments"][0]["assisted"] = True
        self.assertEqual(self.complete(payload).status_code, 422)

    def test_incomplete_assessment(self):
        payload = self.payload()
        payload["judgments"].pop()
        self.assertEqual(self.complete(payload).status_code, 422)

    def test_idempotent_retry_and_conflicting_event(self):
        payload = self.payload()
        first = self.complete(payload).json()
        payload["judgments"].reverse()
        self.assertEqual(self.complete(payload).json(), first)
        payload["judgments"][0]["verdict"] = "INCORRECT"
        self.assertEqual(self.complete(payload).status_code, 409)

    def test_review_band_and_serialization(self):
        r = self.complete(self.payload("INCORRECT"))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(json.loads(r.text)["event"], {
            "eventId": "event-1", "learnerId": "demo-1", "skill": "phonics",
            "formId": "PHONICS-A", "sessionId": "session-1", "difficultyTier": "CVCC-final-nt",
            "kind": "probe", "correct": 4, "total": 5, "score": 80,
            "assisted": False, "usable": True, "reviewRequired": True,
        })
        self.assertEqual(r.json()["treeCheck"], {
            "skill": "phonics", "form": "PHONICS-A", "session": "session-1",
            "tier": "CVCC-final-nt", "kind": "probe", "correct": 4, "total": 5,
            "assisted": False, "usable": True,
        })

    def test_form_reuse_on_new_session_and_fresh_form_on_same_session(self):
        form_b = self.form.model_copy(update={"formId": "PHONICS-B"})
        with patch("backend.server.load_forms", return_value={self.form.formId: self.form, form_b.formId: form_b}):
            self.client = TestClient(create_app())
        payload = self.payload()
        self.assertEqual(self.complete(payload).status_code, 200)
        self.assertEqual(self.complete({**payload, "eventId": "event-2", "sessionId": "session-2"}).status_code, 409)
        self.assertEqual(self.complete({**payload, "eventId": "event-3", "formId": "PHONICS-B"}).status_code, 409)
        fresh = self.complete({**payload, "eventId": "event-4", "formId": "PHONICS-B", "sessionId": "session-2"})
        self.assertEqual(fresh.status_code, 200, fresh.text)
        self.assertEqual(fresh.json()["treeCheck"]["form"], "PHONICS-B")
        self.assertEqual(fresh.json()["treeCheck"]["session"], "session-2")

    @unittest.skipUnless(os.environ.get("BASABRIDGE_TEST_AUDIO"), "Set BASABRIDGE_TEST_AUDIO to exercise real STT")
    def test_real_inference(self):
        r = self.clip(Path(os.environ["BASABRIDGE_TEST_AUDIO"]).read_bytes())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["transcript"], r.text)
        print("Observed transcript:", r.json()["transcript"])
