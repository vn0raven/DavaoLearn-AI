import logging
from pathlib import Path

import av
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form as MultipartField, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import speech
from .comprehension import create_router as comprehension_router
from .scoring import Conflict, DemoReceiver, Submission, compare, load_forms

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
    except (ValueError, av.FFmpegError):
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

def create_app():
    app = FastAPI(title="BasaBridge Phonics")
    forms = load_forms()
    receiver = DemoReceiver()
    app.include_router(comprehension_router())

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
        if not form:
            raise HTTPException(404, "Unknown phonics form.")
        try:
            return receiver.submit(form, submission)
        except Conflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc

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
