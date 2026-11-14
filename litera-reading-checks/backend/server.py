import logging
import os
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form as MultipartField, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import speech
from .comprehension import create_router as comprehension_router
from .comprehension import load_forms as comprehension_forms
from .evidence_api import create_router as evidence_router
from .evidence_api import open_store, save_verified, verified_event
from .fresh_checks import create_router as fresh_checks_router
from .scoring import Submission, compare, load_forms, score_probe, to_tree_check

LOG = logging.getLogger(__name__)
FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "dist"

def read_clip(clip, max_bytes, max_seconds):
    with clip.file as source:
        data = source.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, "Recording exceeds the upload limit. Record a shorter clip.")
    if not data:
        raise HTTPException(422, "Recording is empty. Try again.")
    try:
        samples = speech.decode_audio(data, max_seconds)
    except (ValueError, speech.AVDecodeError):
        raise HTTPException(422, "Audio is unsupported, interrupted, or too long. Try recording again.")
    if not np.isfinite(samples).all() or float(np.max(np.abs(samples))) <= 1e-5:
        raise HTTPException(422, "No audible signal detected. Try recording again.")
    try:
        transcript = speech.transcribe(samples)
    except Exception:
        LOG.warning("Speech transcription unavailable", exc_info=True)
        transcript = ""
        message = "Transcription failed. Replay the clip or listen live to judge."
    else:
        message = None
    return transcript, message

def create_app(evidence_path=None, evidence_config=None):
    path = evidence_path or os.getenv("LITERA_EVIDENCE_DB") or FRONTEND.parents[1] / "data" / "evidence.sqlite3"
    store = open_store(path, evidence_config or os.getenv("LITERA_EVIDENCE_CONFIG"))
    app = FastAPI(title="BasaBridge Phonics")
    forms = load_forms()
    app.include_router(evidence_router(store))
    reading_forms = comprehension_forms()
    app.include_router(fresh_checks_router(store, forms, reading_forms))
    app.include_router(comprehension_router(store, reading_forms))

    @app.get("/api/forms")
    def list_forms():
        return list(forms.values())

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/phonics/transcribe")
    def speech_check(
        clip: UploadFile = File(...),
        attemptId: str = MultipartField(..., pattern=r"^[A-Za-z0-9_-]{1,64}$"),
        formId: str = MultipartField(..., max_length=64),
        itemId: str = MultipartField(..., max_length=64),
    ):
        form = forms.get(formId)
        item = next((item for item in form.items if item.itemId == itemId), None) if form else None
        if not item:
            raise HTTPException(404, "Unknown form or item.")
        transcript, message = read_clip(clip, speech.MAX_BYTES, speech.MAX_SECONDS)
        return {
            "attemptId": attemptId, "transcript": transcript,
            "indication": compare(item.word, transcript), "message": message,
        }

    @app.post("/api/oral/transcribe")
    def oral_transcript(clip: UploadFile = File(...)):
        transcript, message = read_clip(clip, 16 * 1024 * 1024, 125)
        return {"transcript": transcript, "message": message}

    @app.post("/api/phonics/complete")
    def complete(submission: Submission):
        form = forms.get(submission.formId)
        source = submission.model_dump(mode="json")
        source["judgments"].sort(key=lambda item: item["itemId"])
        if not form:
            store.reject(submission.learnerId, submission.eventId, source, "Unknown phonics form.")
            raise HTTPException(404, "Unknown phonics form.")
        try:
            checked = score_probe(form, submission, (store.rules.reviewLow, store.rules.reviewHigh))
        except (ValueError, ValidationError) as exc:
            store.reject(submission.learnerId, submission.eventId, source, str(exc))
            raise HTTPException(422, str(exc)) from exc
        saved = save_verified(store, verified_event(checked, form.version), source)
        event = {**checked.model_dump(), "timestamp": saved.model_dump(mode="json")["timestamp"], "formVersion": saved.formVersion}
        return {"event": event, "evidence": saved, "treeCheck": to_tree_check(saved)}

    if FRONTEND.is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/")
    def index():
        index_file = FRONTEND / "index.html"
        if not index_file.is_file():
            raise HTTPException(503, "Build the React frontend or run its development server.")
        return FileResponse(index_file)

    return app

app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
