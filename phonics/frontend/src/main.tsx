import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { request } from "./api";
import { useRecording } from "./useRecording";
import type { Form, Judgment, Receipt, Signal, Submission, Verdict } from "./contracts";
import "./style.css";

const hints: Record<Signal, string> = {
  match: "Match. Replay to verify.",
  possible_mismatch: "Possible mismatch. Replay to check.",
  unavailable: "Recognition unavailable. Listen to judge.",
  review: "Needs review. More than one word was recognized.",
};

function App() {
  const [forms, setForms] = useState<Form[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [setupError, setSetupError] = useState("");
  const [learnerId, setLearnerId] = useState("demo-001");
  const [sessionId, setSessionId] = useState(() => `session-${crypto.randomUUID()}`);
  useEffect(() => {
    request<Form[]>("/api/forms").then(setForms).catch(error => setSetupError(error.message));
  }, []);
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setForm(forms.find(item => item.formId === data.get("form")) || null);
  }
  return <main>
    <header><p className="brand">BasaBridge</p><h1>Phonics check</h1>
      <p>Five printed words. Demonstration content for adult-voice testing.</p></header>
    {form ? <Assessment form={form} learnerId={learnerId} sessionId={sessionId} reset={() => {
      setForm(null);
      setSessionId(`session-${crypto.randomUUID()}`);
    }} /> : <section>
      <h2>Set up a check</h2>
      {setupError && <p role="alert">{setupError}. Check that the backend is running.</p>}
      <form onSubmit={start}>
        <label>Fictional learner ID<input value={learnerId} onChange={e => setLearnerId(e.target.value)} required pattern="[A-Za-z0-9_-]{1,64}" /></label>
        <label>Session ID<input value={sessionId} onChange={e => setSessionId(e.target.value)} required pattern="[A-Za-z0-9_-]{1,64}" /></label>
        <label>Form<select name="form" required>{forms.map(f => <option key={f.formId} value={f.formId}>{f.formId} · {f.pattern}</option>)}</select></label>
        <button className="primary" disabled={!forms.length}>Start check</button>
      </form>
    </section>}
  </main>;
}

function Assessment({ form, learnerId, sessionId, reset }: {
  form: Form; learnerId: string; sessionId: string; reset: () => void;
}) {
  const [position, setPosition] = useState(0);
  const [judgments, setJudgments] = useState<Judgment[]>([]);
  const [assisted, setAssisted] = useState(false);
  const [live, setLive] = useState(false);
  const [note, setNote] = useState("");
  const [eventId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const target = form.items[position];
  const audio = useRecording(form.formId, target.itemId);
  const blocked = judgments.some(j => j.assisted);
  const done = judgments.length === form.items.length;
  const recording = audio.phase === "opening" || audio.phase === "recording";

  function judge(verdict: Verdict) {
    if (done || audio.waiting || (!audio.attempt && !live) || (audio.invalid && verdict !== "UNCLEAR")) return;
    if (verdict === "UNCLEAR") {
      audio.clear();
      setLive(false);
      setNote("Unscored. Retry the same word without giving the answer.");
      return;
    }
    const judgment: Judgment = {
      itemId: target.itemId, attemptId: audio.attempt?.id || crypto.randomUUID(),
      verdict, assisted,
    };
    setJudgments(previous => previous.some(j => j.itemId === target.itemId)
      ? previous : [...previous, judgment]);
    if (position < form.items.length - 1) setPosition(position + 1);
    setAssisted(false);
    setLive(false);
    setNote("");
    audio.clear();
  }

  async function submit() {
    if (!done || blocked || busy || receipt) return;
    setBusy(true);
    setNote("");
    try {
      const input: Submission = { eventId, learnerId, formId: form.formId, sessionId, judgments };
      setReceipt(await request<Receipt>("/api/phonics/complete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      }));
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    <section>
      <p className="meta">{form.formId} · {form.difficultyTier} · {judgments.length} of 5 judged</p>
      {done ? <>
        <h2>Check complete</h2>
        {blocked ? <p>One or more words received help. This practice check cannot produce an independent score. Use a fresh form for independent evidence.</p> :
          <button className="primary" disabled={busy || !!receipt} onClick={submit}>{busy ? "Submitting…" : "Generate evidence"}</button>}
      </> : <>
        <h2 className="word" aria-label={`Word ${position + 1} of 5: ${target.word}`}>{target.word}</h2>
        <div className="controls">
          <button className="primary" disabled={recording} onClick={() => {
            setNote(""); setLive(false); void audio.start();
          }}>{audio.attempt ? "Record again" : "Record"}</button>
          <button disabled={audio.phase !== "recording"} onClick={audio.stop}>Stop</button>
          <button disabled={recording} onClick={() => {
            setNote(""); audio.clear(); setLive(true);
          }}>Teacher listens live</button>
        </div>
        {audio.attempt && <audio controls src={audio.attempt.url} aria-label="Replay attempt" />}
        <p role="status">{audio.phase === "opening" ? "Waiting for microphone permission…" :
          audio.phase === "recording" ? "Recording…" :
          audio.waiting ? "Checking recording. You can replay it or switch to live listening." : live ? "Listen to the learner read the printed word." : audio.message}</p>
        {audio.signal && <div className="signal"><strong>{hints[audio.signal.indication]}</strong>
          <p>Transcript: {audio.signal.transcript || "No words recognized."}</p>
          {audio.signal.message && <p>{audio.signal.message}</p>}</div>}
        <h3>Teacher judgment</h3>
        <label className="check"><input type="checkbox" checked={assisted} disabled={assisted}
          onChange={e => setAssisted(e.target.checked)} /> Learner received a hint or model for this word</label>
        <div className="controls">{(["CORRECT", "INCORRECT", "UNCLEAR"] as const).map(verdict =>
          <button key={verdict} disabled={recording || audio.waiting || (!audio.attempt && !live) || (audio.invalid && verdict !== "UNCLEAR")} onClick={() => judge(verdict)}>{verdict}</button>)}</div>
      </>}
      {note && <p role="status">{note}</p>}
      <button disabled={busy} onClick={reset}>{done ? "Start another check" : "End check"}</button>
    </section>
    {receipt && <section>
      <h2>Teacher-confirmed score</h2>
      <p className="result">{receipt.event.correct}/5 · {receipt.event.score}%</p>
      {receipt.event.reviewRequired && <p>Within the demo review band. Confirm with a fresh independent form in another session.</p>}
      <details><summary>Assessment event</summary><pre>{JSON.stringify(receipt.event, null, 2)}</pre></details>
      <details><summary>Decision tree input</summary><pre>{JSON.stringify(receipt.treeCheck, null, 2)}</pre></details>
    </section>}
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
