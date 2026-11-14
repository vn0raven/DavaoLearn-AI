import { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api";
import type { SpeechResult } from "./contracts";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];
const LIMIT_BYTES = 2 * 1024 * 1024;

export function useRecording(formId: string, itemId: string) {
  const [phase, setPhase] = useState<"idle" | "opening" | "recording" | "review">("idle");
  const [attempt, setAttempt] = useState<{ id: string; url: string } | null>(null);
  const [signal, setSignal] = useState<SpeechResult | null>(null);
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const upload = useRef<AbortController | null>(null);
  const url = useRef("");
  const generation = useRef(0);

  function release() {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
  }

  function dispose() {
    generation.current++;
    upload.current?.abort();
    const active = recorder.current;
    if (active && active.state !== "inactive") {
      active.onstop = null;
      active.stop();
    }
    release();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
  }

  useEffect(() => () => dispose(), []);

  function clear() {
    dispose();
    setPhase("idle");
    setAttempt(null);
    setSignal(null);
    setInvalid(false);
    setWaiting(false);
    setMessage("");
  }

  async function start() {
    clear();
    const current = generation.current;
    setPhase("opening");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("Recording needs a supported browser on localhost or HTTPS.");
      }
      const activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) {
        activeStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = activeStream;
      const mimeType = MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(activeStream, mimeType ? { mimeType } : undefined);
      recorder.current = active;
      const chunks: Blob[] = [];
      let interrupted = "";
      const id = crypto.randomUUID();
      active.ondataavailable = event => chunks.push(event.data);
      active.onerror = () => { interrupted = "Recording interrupted. Try again or ask the teacher to listen live."; };
      activeStream.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
        if (active.state === "recording") {
          interrupted = "Microphone disconnected. Try again or ask the teacher to listen live.";
          active.stop();
        }
      }));
      active.onstop = async () => {
        if (current !== generation.current) return;
        release();
        const blob = new Blob(chunks, { type: active.mimeType || chunks[0]?.type });
        if (interrupted || !blob.size || blob.size > LIMIT_BYTES) {
          setMessage(interrupted || (blob.size ? "Recording exceeds 2 MB. Try a shorter clip." : "Recording was empty. Try again."));
          setPhase("idle");
          return;
        }
        url.current = URL.createObjectURL(blob);
        setAttempt({ id, url: url.current });
        setPhase("review");
        setWaiting(true);
        const data = new FormData();
        data.append("clip", blob, "phonics-attempt");
        data.append("formId", formId);
        data.append("itemId", itemId);
        data.append("attemptId", id);
        const controller = new AbortController();
        upload.current = controller;
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const result = await request<SpeechResult>("/api/phonics/transcribe", {
            method: "POST", body: data, signal: controller.signal,
          });
          if (current === generation.current && result.attemptId === id) setSignal(result);
        } catch (error) {
          if (current === generation.current) {
            if (error instanceof RequestError && [413, 422].includes(error.status)) setInvalid(true);
            setMessage(error instanceof Error && error.name !== "AbortError"
              ? error.message : "Transcription timed out. You can still replay this clip.");
          }
        } finally {
          clearTimeout(timeout);
          if (current === generation.current) setWaiting(false);
        }
      };
      active.start();
      setPhase("recording");
      timer.current = setTimeout(stop, 8000);
    } catch (error) {
      if (current !== generation.current) return;
      release();
      setPhase("idle");
      if (error instanceof DOMException) {
        const details: Record<string, string> = {
          NotAllowedError: "Microphone permission denied. Allow access or ask the teacher to listen live.",
          NotFoundError: "No microphone found. Check your input device.",
          NotReadableError: "Microphone unavailable. Check Windows privacy settings and other apps.",
          NotSupportedError: "Recording format unsupported. Try Chrome or Edge.",
        };
        setMessage(details[error.name] || "Could not start recording. Try again or listen live.");
      } else {
        setMessage(error instanceof Error ? error.message : "Could not start recording.");
      }
    }
  }
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  return { phase, attempt, signal, message, invalid, waiting, start, stop, clear };
}
