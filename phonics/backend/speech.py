import io
import os
from functools import lru_cache
from threading import Lock

import av
import numpy as np

RATE = 16000
MAX_SECONDS = 12
MAX_BYTES = 2 * 1024 * 1024
MODEL_LOCK = Lock()

def decode_audio(data):
    """Decode into bounded mono float32 PCM. Raise on unusable input."""
    chunks, frames = [], 0
    with av.open(io.BytesIO(data), mode="r") as container:
        if not container.streams.audio:
            raise ValueError("No audio track.")
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                frames += converted.samples
                if frames > RATE * MAX_SECONDS:
                    raise ValueError("Audio is longer than the assessment limit.")
                chunks.append(converted.to_ndarray().reshape(-1))
        for converted in resampler.resample(None):
            frames += converted.samples
            if frames > RATE * MAX_SECONDS:
                raise ValueError("Audio is longer than the assessment limit.")
            chunks.append(converted.to_ndarray().reshape(-1))
    if not chunks or not frames:
        raise ValueError("No audio samples.")
    return np.concatenate(chunks).astype(np.float32, copy=False)

@lru_cache(maxsize=1)
def model():
    from faster_whisper import WhisperModel
    return WhisperModel(os.getenv("BASABRIDGE_MODEL", "base.en"), device="cpu", compute_type="int8")

def transcribe(samples):
    with MODEL_LOCK:
        segments, _ = model().transcribe(
            samples, language="en", beam_size=1, condition_on_previous_text=False,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
