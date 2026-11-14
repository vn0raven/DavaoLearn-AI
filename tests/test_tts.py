import io
import shutil
import sys
import wave
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.practice import KNOWN, PracticeRepository, PracticeRun
from backend.tts import install_tts


class LearnerAuth:
    learner = "learner-a"

    def current_learner(self):
        if self.learner is None:
            raise HTTPException(401)
        return {"learnerId": self.learner}


@pytest.fixture
def setup_tts(tmp_path):
    app = FastAPI()
    auth = LearnerAuth()
    repo = PracticeRepository(tmp_path / "practice.sqlite3")
    install_tts(app, auth, repo)

    def begin(activity, step=0, attempts=None):
        run_id = str(uuid4())
        body = PracticeRun(learnerId="learner-a", sessionId=uuid4(), runId=run_id,
                           activityId=activity["id"], contentVersion=activity["version"], skill=activity["skill"],
                           difficultyTier=activity["difficultyTier"], passageId=activity.get("passageId"),
                           startedAt="2026-11-15T00:00:00Z", step=step, attempts=attempts or [],
                           hints=[], notes="", intendedUse="practice")
        repo.save("learner-a", run_id, body)
        return {"runId": run_id, "step": step, "targetId": "model", "speed": "normal"}

    return TestClient(app), auth, begin


def test_allowlist_current_step_and_authentication(setup_tts, monkeypatch):
    client, auth, begin = setup_tts
    called = []
    monkeypatch.setattr("backend.tts.subprocess.run", lambda *args, **kwargs: called.append(args))
    form = next(iter(KNOWN.values()))
    body = begin(form)
    url = "/api/practice/tts"
    assert client.post(url, json={**body, "text": "arbitrary text"}).status_code == 422
    assert client.post(url, json={**body, "targetId": "PHONICS-A"}).status_code == 422
    assert client.post(url, json={**body, "speed": "2.0"}).status_code == 422
    assert client.post(url, json={**body, "step": 1}).status_code == 404
    assert client.post(url, json=body, headers={"Origin": "https://other.example"}).status_code == 403
    auth.learner = "learner-b"
    assert client.post(url, json=body).status_code == 404
    auth.learner = None
    assert client.post(url, json=body).status_code == 401
    assert not called


def test_comprehension_explanation_requires_attempt(setup_tts, monkeypatch):
    client, _, begin = setup_tts
    activity = next(item for item in KNOWN.values() if item["skill"] == "comprehension" and item["steps"][0]["kind"] == "choice")
    attempts = [{"step": 0, "response": activity["steps"][0]["answer"], "correct": True, "assistance": []}]
    monkeypatch.setattr("backend.tts.shutil.which", lambda _: None)
    url = "/api/practice/tts"
    assert client.post(url, json={**begin(activity), "targetId": "explanation"}).status_code == 404
    assert client.post(url, json={**begin(activity, attempts=attempts), "targetId": "explanation"}).status_code == 503


def test_missing_engine_returns_clear_error(setup_tts, monkeypatch):
    client, _, begin = setup_tts
    monkeypatch.setattr("backend.tts.shutil.which", lambda _: None)
    response = client.post("/api/practice/tts", json=begin(next(iter(KNOWN.values()))))
    assert response.status_code == 503
    assert response.json()["detail"] == "The practice voice is unavailable on the server."


@pytest.mark.skipif(sys.platform != "win32" and not shutil.which("ffmpeg"), reason="Local TTS engine is required")
def test_backend_generates_playable_wav_at_both_speeds(setup_tts):
    client, _, begin = setup_tts
    body = begin(next(iter(KNOWN.values())))
    durations = []
    for speed in ("normal", "slow"):
        response = client.post("/api/practice/tts", json={**body, "speed": speed})
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "audio/wav"
        assert response.headers["cache-control"] == "no-store"
        with wave.open(io.BytesIO(response.content)) as audio:
            assert audio.getsampwidth() == 2
            assert len(set(audio.readframes(audio.getnframes()))) > 1
            durations.append(audio.getnframes() / audio.getframerate())
    assert durations[1] > durations[0] * 1.15
