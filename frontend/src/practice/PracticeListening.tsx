import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { useRecording } from "../useRecording";
import { usePracticeSpeech } from "../speech/usePracticeSpeech";
import type { PlaybackRate } from "../speech/playback";
import type { AudioSource, ListenTarget } from "./pronunciation";
import "./listening.css";

export function PracticeListening({ targets, rehearsal, soundModel, location, flushPractice, onListen }: {
  targets: readonly ListenTarget[];
  rehearsal: boolean;
  soundModel?: { label: string; url: string };
  location: { runId: string; step: number };
  flushPractice: () => Promise<unknown>;
  onListen: (source: AudioSource) => void;
}) {
  const [selection, setSelection] = useState("");
  const target = targets.find(item => item.id === selection) ?? targets[0];
  const [modelError, setModelError] = useState(false);
  const recordedModel = useRef<HTMLAudioElement>(null);
  const clip = useRef<HTMLAudioElement>(null);
  const openingMic = useRef(false);
  const [last, setLast] = useState<{ id: string; rate: PlaybackRate }>();
  const recording = useRecording("", "", "phonics");
  const microphoneBusy = recording.phase === "opening" || recording.phase === "recording";
  const speech = usePracticeSpeech(location, flushPractice, (item) => onListen(item.source));

  useLayoutEffect(() => {
    const practiceClip = clip.current;
    const teacherClip = recordedModel.current;
    function pauseMedia() {
      practiceClip?.pause();
      teacherClip?.pause();
    }
    function handleVisibility() { if (document.hidden) pauseMedia(); }
    window.addEventListener("pagehide", pauseMedia);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      pauseMedia();
      window.removeEventListener("pagehide", pauseMedia);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [recording.attempt, soundModel?.url]);

  function listen(rate: PlaybackRate, device = false) {
    if (!target || microphoneBusy || openingMic.current) return;
    clip.current?.pause();
    recordedModel.current?.pause();
    setLast({ id: target.id, rate });
    if (device) speech.playDevice(target, rate);
    else void speech.play(target, rate);
  }

  async function startRecording() {
    if (microphoneBusy || openingMic.current) return;
    openingMic.current = true;
    speech.stop();
    clip.current?.pause();
    recordedModel.current?.pause();
    try { await recording.start(); }
    finally { openingMic.current = false; }
  }

  const speaking = speech.state === "playing" || speech.state === "starting";
  const status = microphoneBusy ? "Finish recording before listening." :
    speech.state === "unavailable" ? (speech.deviceAvailable
      ? "The practice voice is unavailable. Try the device voice."
      : "Audio is unavailable. Try again or ask your teacher to read aloud.") :
    speech.state === "error" ? "The device voice could not play. Try again or ask your teacher." :
    speech.state === "starting" ? "Loading audio…" :
    speech.state === "playing" ? "Playing audio…" :
    speech.state === "stopped" ? "Audio stopped." :
    speech.state === "ended" ? "Audio finished." : "";

  return <section className="practice-listening" aria-label="Guided practice audio">
    {target && <>
      {targets.length > 1 ? <label className="practice-listening-select">Listen to
          <select value={target.id} onChange={event => {
            speech.stop();
            setSelection(event.target.value);
          }}>
            {targets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label> : <strong>Practice saying <span className="practice-listening-word">{target.label}</span></strong>}
      <div className="practice-listening-actions">
        <button className="button quiet-button" type="button" disabled={microphoneBusy}
          onClick={() => listen(1)}><Icon name="headphones" size={18}/> Listen</button>
        <button className="button quiet-button" type="button" disabled={microphoneBusy}
          onClick={() => listen(0.75)}>Listen Slowly</button>
        <button className="button quiet-button" type="button" disabled={microphoneBusy || last?.id !== target.id}
          onClick={() => listen(last?.rate ?? 1)}>Listen Again</button>
        <button className="button quiet-button" type="button" disabled={!speaking} onClick={() => speech.stop()}>Stop</button>
        {speech.state === "unavailable" && speech.deviceAvailable && <button className="button quiet-button" type="button"
          disabled={microphoneBusy} onClick={() => listen(last?.rate ?? 1, true)}>Use device voice</button>}
      </div>
      <p className="subtle" role="status">{status}</p>
    </>}
    {soundModel && <div className="practice-rehearsal">
      <strong>{soundModel.label}</strong>
      <audio ref={recordedModel} controls src={soundModel.url} preload="none" aria-label={soundModel.label}
        onPlay={event => {
          if (microphoneBusy || openingMic.current) event.currentTarget.pause();
          else { clip.current?.pause(); speech.stop(); }
        }}
        onPlaying={() => { if (!microphoneBusy && !openingMic.current) onListen("teacher-model"); }}
        onError={() => setModelError(true)}/>
      {modelError && <p role="status">The sound recording is unavailable. Ask your teacher to model the sounds.</p>}
    </div>}
    {rehearsal && target && <div className="practice-rehearsal">
      <p>Say the word. Record it to listen to yourself or ask your teacher for feedback.</p>
      <button className="button quiet-button" type="button" disabled={recording.phase === "opening"}
        onClick={recording.phase === "recording" ? recording.stop : startRecording}>
        <Icon name="mic" size={18}/>{recording.phase === "recording" ? "Stop recording" :
          recording.phase === "opening" ? "Opening microphone…" : recording.attempt ? "Record again" : "Record my voice"}
      </button>
      <p className="subtle" role="status">{recording.message ||
        (recording.phase === "recording" ? "Recording…" : recording.attempt ? "Recording ready to replay." : "")}</p>
      {recording.attempt && <audio ref={clip} controls src={recording.attempt.url} preload="metadata"
        aria-label="Play your practice recording" onPlay={event => {
          if (microphoneBusy || openingMic.current) event.currentTarget.pause();
          else { recordedModel.current?.pause(); speech.stop(); }
        }}/>}
      <p className="subtle">This recording stays in this step.</p>
    </div>}
  </section>;
}
