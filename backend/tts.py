"""Synthesize authored guided-practice prompts with a local English voice."""

import io
import logging
import shutil
import subprocess
import sys
import wave
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import check_origin
from .practice import KNOWN

LOG = logging.getLogger(__name__)
MAX_WAV_BYTES = 3 * 1024 * 1024


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runId: UUID
    step: int = Field(ge=0, le=50, strict=True)
    targetId: str = Field(pattern=r"^(model|passage|instructions|explanation|sentence-[0-9]{1,2}|word-[0-9]{1,2})$")
    speed: Literal["normal", "slow"]


def resolve_text(activity, run, step_index, target):
    """Expose exactly the content offered for a guided step, including its feedback gate."""
    if activity["intendedUse"] != "practice" or not 0 <= step_index < len(activity["steps"]):
        return None
    step = activity["steps"][step_index]
    attempted = any(attempt["step"] == step_index for attempt in run["attempts"])
    skill = activity["skill"]
    if skill == "phonics":
        if target == "model" and (step["kind"] == "guide" or attempted):
            return step.get("modelWord")
        return None
    passage = activity.get("passage", [])
    if target == "passage":
        return " ".join(passage)
    if target.startswith("sentence-"):
        index = int(target.removeprefix("sentence-"))
        return passage[index] if index < len(passage) else None
    if skill == "oral" and target.startswith("word-"):
        index = int(target.removeprefix("word-"))
        words = activity.get("wordCues", [])
        return words[index]["word"] if index < len(words) else None
    if skill == "comprehension":
        if target == "instructions":
            return activity["instructions"]
        if target == "explanation" and step["kind"] == "choice" and attempted:
            return step.get("feedback")
    return None


def synthesize_wav(text, speed):
    # Fixed arguments and a plain-text file keep content out of the command/filter syntax.
    with TemporaryDirectory(prefix="litera-tts-") as directory:
        work = Path(directory)
        (work / "input.txt").write_text(text, encoding="utf-8")
        if sys.platform == "win32" and (powershell := shutil.which("powershell.exe")):
            script = Path(__file__).with_name("tts_windows.ps1")
            command = [powershell, "-NoProfile", "-NonInteractive", "-File", str(script), speed]
        elif ffmpeg := shutil.which("ffmpeg"):
            tempo = "0.75" if speed == "slow" else "1"
            command = [ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi",
                       "-i", "flite=textfile=input.txt:voice=slt", "-af", f"atempo={tempo}",
                       "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "output.wav"]
        else:
            raise RuntimeError("No local speech engine")
        subprocess.run(command, cwd=work, check=True, timeout=8,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        path = work / "output.wav"
        if path.stat().st_size > MAX_WAV_BYTES:
            raise ValueError("Speech audio exceeds size limit")
        audio = path.read_bytes()
        with wave.open(io.BytesIO(audio)) as output:
            if output.getnframes() == 0:
                raise ValueError("Speech audio is empty")
        return audio


def install_tts(app, auth, practice_repo):
    router = APIRouter()
    synthesize = lru_cache(maxsize=48)(synthesize_wav)
    engine_slots = BoundedSemaphore(2)

    @router.post("/api/practice/tts", dependencies=[Depends(check_origin)])
    def guided_speech(body: SpeechRequest, learner=Depends(auth.current_learner)):
        run = practice_repo.get(learner["learnerId"], str(body.runId))
        if not run or run["completedAt"] or body.step != run["step"]:
            raise HTTPException(404, "Guided practice step is unavailable.")
        activity = KNOWN.get(run["activityId"])
        text = resolve_text(activity, run, body.step, body.targetId) if activity else None
        if not text or len(text) > 600:
            raise HTTPException(404, "This listening model is unavailable for the current step.")
        if not engine_slots.acquire(blocking=False):
            raise HTTPException(503, "The practice voice is busy. Try again.")
        try:
            audio = synthesize(text, body.speed)
        except (OSError, RuntimeError, ValueError, EOFError, wave.Error, subprocess.SubprocessError) as exc:
            LOG.warning("Practice speech unavailable (%s)", type(exc).__name__)
            raise HTTPException(503, "The practice voice is unavailable on the server.") from None
        finally:
            engine_slots.release()
        return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})

    app.include_router(router)
