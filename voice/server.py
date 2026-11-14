import io
import logging
import os
from functools import lru_cache
from pathlib import Path
from threading import Lock

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from voice.tree import Check, recommend

LOG = logging.getLogger(__name__)
MAX_BYTES = 2 * 1024 * 1024
STATIC = Path(__file__).with_name("static")
VOICE_LOCK = Lock()
app = FastAPI(title="BasaBridge English Voice Tester")

class Override(BaseModel):
    activity: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=240)

class PlanInput(BaseModel):
    checks: list[Check] = Field(max_length=120)
    tier: str = Field(default="demo", min_length=1, max_length=64)
    print_accessible: bool = True
    override: Override | None = None

@lru_cache(maxsize=1)
def voice_model():
    from faster_whisper import WhisperModel

    return WhisperModel(os.getenv("BASABRIDGE_MODEL", "base.en"), device="cpu", compute_type="int8")

@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")

@app.get("/app.js")
def script():
    return FileResponse(STATIC / "app.js", media_type="text/javascript")

@app.get("/style.css")
def style():
    return FileResponse(STATIC / "style.css", media_type="text/css")

@app.get("/fixtures.json")
def fixtures():
    return FileResponse(STATIC / "fixtures.json", media_type="application/json")

@app.get("/health")
def health():
    return {"status": "ok", "voice_loaded": bool(voice_model.cache_info().currsize)}

@app.post("/api/plan")
def plan(request: PlanInput):
    return recommend(request.checks, request.tier, request.print_accessible, request.override)

@app.post("/api/transcribe")
def transcribe(clip: UploadFile = File(...)):
    with clip.file as source:
        data = source.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "The recording is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "The recording exceeds 2 MB.")

    # Load on demand so a model download problem cannot block the teacher workflow.
    with VOICE_LOCK:
        try:
            model = voice_model()
        except Exception:
            LOG.exception("Whisper model unavailable")
            raise HTTPException(503, "Voice model unavailable. Replay and score manually.")
        try:
            segments, _ = model.transcribe(
                io.BytesIO(data), language="en", beam_size=1, condition_on_previous_text=False
            )
            transcript = " ".join(segment.text.strip() for segment in segments)
        except Exception:
            LOG.exception("Could not decode or transcribe clip")
            raise HTTPException(422, "Could not transcribe this clip. Replay or retry.")
    return {"transcript": transcript}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
