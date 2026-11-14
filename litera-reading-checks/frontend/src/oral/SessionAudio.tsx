import { request } from "../api";
import { useEffect, useRef, useState } from "react";

type Kind = "reading" | "teacher";
const labels = { reading: "Passage read-aloud", teacher: "Teacher voice note" };
const formats = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

export function SessionAudio({ onTranscript, canAnalyze }: {
  onTranscript: (text: string) => void;
  canAnalyze: boolean;
}) {
  const [clips, setClips] = useState<Partial<Record<Kind, string>>>({});
  const [active, setActive] = useState<Kind | null>(null);
  const [opening, setOpening] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const readingClip = useRef<Blob | null>(null);
  const [notice, setNotice] = useState("");
  const urls = useRef<Partial<Record<Kind, string>>>({});
  const job = useRef<{ stream?: MediaStream; recorder?: MediaRecorder; timer?: number } | null>(null);

  function stopRecording() {
    const recorder = job.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  useEffect(() => () => {
    const current = job.current;
    pending.current?.abort();
    pending.current = null;
    job.current = null;
    clearTimeout(current?.timer);
    if (current?.recorder?.state === "recording") current.recorder.stop();
    current?.stream?.getTracks().forEach(track => track.stop());
    for (const url of Object.values(urls.current)) URL.revokeObjectURL(url);
    urls.current = {};
  }, []);

  async function analyze(clip: Blob) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setAnalyzing(true);
    onTranscript("");
    setNotice("Checking spoken words… You can still replay and mark manually.");
    const data = new FormData();
    data.append("clip", clip, "read-aloud");
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const result = await request<{ transcript: string; message: string | null }>("/api/oral/transcribe", {
        method:"POST", body:data, signal:controller.signal,
      });
      if (pending.current !== controller) return;
      onTranscript(result.transcript);
      setNotice(result.transcript.trim() ? "AI suggestions ready. Replay and review before scoring." :
        result.message || "No words recognized. Replay and score manually.");
    } catch (error) {
      if (pending.current === controller) setNotice(
        controller.signal.aborted ? "Speech check timed out. Retry the check or score manually." :
        error instanceof Error ? error.message : "Speech check unavailable. Score manually.",
      );
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = null;
        setAnalyzing(false);
      }
    }
  }

  async function record(kind: Kind) {
    if (job.current) return;
    const current: { stream?: MediaStream; recorder?: MediaRecorder; timer?: number } = {};
    job.current = current;
    setOpening(true);
    setActive(kind);
    setNotice("");
    function release() {
      clearTimeout(current.timer);
      current.stream?.getTracks().forEach(track => track.stop());
      if (job.current === current) {
        job.current = null;
        setActive(null);
        setOpening(false);
      }
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
        throw new Error("Use a supported browser on localhost or HTTPS to record.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      current.stream = stream;
      if (job.current !== current) { release(); return; }
      const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      current.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      let interrupted = false;
      recorder.onerror = () => {
        interrupted = true;
        if (job.current === current) {
          setNotice("Recording interrupted. You can retry and still score by listening live.");
          release();
        }
      };
      stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
        interrupted = true;
        if (job.current === current) stopRecording();
      }));
      recorder.onstop = () => {
        if (job.current !== current) return;
        release();
        const clip = new Blob(chunks, { type:recorder.mimeType || chunks[0]?.type });
        if (interrupted || !clip.size) {
          setNotice("Recording interrupted or empty. Try again.");
          return;
        }
        if (urls.current[kind]) URL.revokeObjectURL(urls.current[kind]);
        const url = URL.createObjectURL(clip);
        urls.current[kind] = url;
        setClips(previous => ({...previous, [kind]:url}));
        if (kind === "reading") {
          readingClip.current = clip;
          if (canAnalyze) void analyze(clip);
        } else setNotice(labels[kind] + " ready for replay.");
      };
      recorder.start();
      setOpening(false);
      current.timer = window.setTimeout(stopRecording, kind === "reading" ? 120000 : 45000);
    } catch (error) {
      if (job.current !== current) return;
      setNotice(error instanceof Error && error.name === "NotAllowedError"
        ? "Microphone permission denied. You can still mark the reading live."
        : error instanceof Error ? error.message : "Could not record.");
      release();
    }
  }

  function remove(kind: Kind) {
    if (kind === "reading") {
      pending.current?.abort();
      pending.current = null;
      readingClip.current = null;
      setAnalyzing(false);
      onTranscript("");
    }
    if (urls.current[kind]) URL.revokeObjectURL(urls.current[kind]);
    delete urls.current[kind];
    setClips(previous => ({...previous, [kind]:undefined}));
    setNotice(labels[kind] + " deleted.");
  }

  return <section className="panel mb-4">
    <h2 className="text-xl font-bold">Optional audio</h2>
    <p className="mt-1 text-sm text-slate-700">The read-aloud captures the room mic, including either person who speaks. Record a separate teacher note afterward. Mark any cues given during the reading as assistance.</p>
    {(["reading","teacher"] as const).map(kind => <div key={kind} className="mt-3">
      <h3 className="font-semibold">{labels[kind]}</h3>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className="button" disabled={!!active || (kind === "reading" && (!canAnalyze || analyzing))} onClick={() => void record(kind)}>
          {clips[kind] ? "Replace" : "Record"} {kind === "reading" ? "read-aloud" : "teacher note"}
        </button>
        {kind === "reading" && clips.reading && canAnalyze &&
          <button type="button" className="button" disabled={!!active || analyzing}
            onClick={() => { if (readingClip.current) void analyze(readingClip.current); }}>
            Run speech check again
          </button>}
        {active === kind && <button type="button" className="button" disabled={opening} onClick={stopRecording}>Stop recording</button>}
        {clips[kind] && <button type="button" className="button" disabled={!!active} onClick={() => remove(kind)}>Delete {kind === "reading" ? "read-aloud" : "teacher note"}</button>}
      </div>
      {clips[kind] && <audio controls src={clips[kind]} aria-label={`Replay ${labels[kind]}`} className="mt-2 max-w-full" />}
    </div>)}
    <p role="status" className="mt-2 text-sm">{opening ? "Waiting for microphone permission…" : active ? "Recording " + labels[active].toLowerCase() + "…" : notice}</p>
    <p className="mt-1 text-xs text-slate-700">Clips stay in this tab and clear when you leave this check. For the demo, use consenting adults.</p>
  </section>;
}
