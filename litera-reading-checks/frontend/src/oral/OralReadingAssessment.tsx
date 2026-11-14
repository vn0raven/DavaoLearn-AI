import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { RequestError } from "../api";
import { recordExposure } from "../practice/fresh";
import { alignReading, reviewSuggestions } from "./alignment";
import type { Suggestion } from "./alignment";
import { SessionAudio } from "./SessionAudio";
import rawPassages from "./data/passages.json";
import { counts, createReceiver, mark, submissionIssue, tokenize, toTreeCheck, validatePassages } from "./scoring";
import type { Assistance, DetailedResult, Judgment, Passage, Quality, Session } from "./types";

const passages: Passage[] = rawPassages;
const variants: Record<Judgment, {label: string; mark: string; style: string}> = {
  CORRECT: {label:"Correct", mark:"✓", style:"border-emerald-300 bg-emerald-100"},
  INCORRECT: {label:"Incorrect", mark:"×", style:"border-rose-300 bg-rose-100"},
  UNCLEAR: {label:"Unclear", mark:"?", style:"border-amber-400 bg-amber-100"},
  UNASSESSED: {label:"Unassessed", mark:"·", style:"border-slate-200 bg-white"},
};
const assistanceLabels: Record<Assistance, string> = {
  independent:"Independent reading",
  "teacher-assisted":"Teacher-assisted reading",
  modeling:"Teacher modeling",
  prompting:"Prompting or corrective feedback",
};
const qualityLabels: Record<Quality, string> = {
  complete:"Usable observation",
  incomplete:"Incomplete assessment",
  unclear:"Unclear observation",
  interrupted:"Interrupted session",
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}

interface Props {
  passagePack?: Passage[];
  learnerId?: string;
  freshFormId?: string;
  sharedSession?: { learnerId: string; sessionId: string };
  onPassageOpened?: (passageId: string) => void;
  onComplete?: (result: DetailedResult) => void | Promise<void>;
}

export function OralReadingAssessment({passagePack = passages, learnerId: initialLearner = "demo-001", sharedSession, freshFormId, onPassageOpened, onComplete}: Props) {
  validatePassages(passagePack);
  const [learnerId, setLearnerId] = useState(initialLearner);
  const [sessionId, setSessionId] = useState(newId);
  const available = passagePack.filter(item => !freshFormId || item.formId === freshFormId);
  const [selected, setSelected] = useState(available[0]?.passageId ?? "");
  const [opening, setOpening] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<DetailedResult | null>(null);
  const [notice, setNotice] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const receiving = useRef(createReceiver());
  const inFlight = useRef(false);
  const summary = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [transcript, setTranscript] = useState("");
  const [learnerView, setLearnerView] = useState(false);

  useEffect(() => { if (result) summary.current?.focus(); else if (session?.eventId) title.current?.focus(); }, [result, session?.eventId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passage = available.find(item => item.passageId === selected);
    if (!passage || opening) return;
    if (sharedSession) {
      setOpening(true);
      try {
        await recordExposure(sharedSession.learnerId, passage.formId, Boolean(freshFormId));
      } catch (error) {
        setNotice(error instanceof RequestError ? error.message : "Could not register this form. Try again.");
        return;
      } finally {
        setOpening(false);
      }
    }
    onPassageOpened?.(passage.passageId);
    setNotice("");
    setTranscript("");
    setLearnerView(false);
    setSession({eventId:newId(), learnerId:sharedSession?.learnerId ?? learnerId, sessionId:sharedSession?.sessionId ?? sessionId, passage, judgments:{}, assistance:"independent", quality:"complete", verified:false});
  }

  async function send(next: DetailedResult) {
    if (!onComplete || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setSendFailed(false);
    try {
      await onComplete(next);
      setNotice("Assessment handed off.");
    } catch {
      setSendFailed(true);
      setNotice("Event generated. Handoff failed; retry with the same event ID.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || result) return;
    try {
      const next = receiving.current(session);
      setResult(next);
      setNotice("");
      void send(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the assessment.");
    }
  }

  function reset() {
    setTranscript("");
    setLearnerView(false);
    setResult(null);
    setSession(null);
    setNotice("");
    setSendFailed(false);
    setSessionId(newId());
  }

  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
    <header className="mb-6">
      {!sharedSession && <p className="font-bold text-violet-800">Litera</p>}
      <h1 className="mt-1 text-3xl font-bold">Oral reading check</h1>
      <p className="mt-2 text-slate-700">Grade 3 English · Demonstration passages</p>
    </header>
    {session && <SessionAudio key={session.eventId} canAnalyze={!result} onTranscript={setTranscript} />}
    {result && session ? <>
      <section className="panel" aria-label="Assessment summary">
        <h2 ref={summary} tabIndex={-1} className="text-2xl font-bold">{session.passage.title}</h2>
        <p className="mt-2">Assessment event generated.</p>
        <p className="my-3 text-4xl font-bold text-violet-900">{format(result.event.score)}%</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Scored words" value={result.event.total} />
          <Stat label="Correct" value={result.event.correct} />
          <Stat label="Incorrect" value={result.event.total - result.event.correct} />
          <Stat label="Assessment form" value={result.event.formId} />
          <Stat label="Assistance" value={assistanceLabels[result.assistance]} />
          <Stat label="Evidence" value={result.event.assisted ? "Usable practice only" : "Usable independent probe"} />
        </dl>
        <p className="mt-3 text-slate-700">Accuracy covers word reading only.</p>
        <JsonBlock label="Assessment event" data={result.event} />
        {!result.event.assisted && <JsonBlock label="Decision tree input" data={toTreeCheck(result.event)} />}
        <JsonBlock label="Detailed word judgments" data={result.words} />
        {sendFailed && <button type="button" className="button mt-3" onClick={() => void send(result)}>Retry handoff</button>}
        <button type="button" className="button primary mt-4" disabled={sending} onClick={reset}>Start another check</button>
      </section>
    </> : session && learnerView ? <section className="panel">
      <h2 className="text-2xl font-bold">{session.passage.title}</h2>
      <p className="my-5 text-2xl leading-relaxed sm:text-3xl">{session.passage.text}</p>
      <button type="button" className="button" onClick={() => setLearnerView(false)}>Return to teacher marking</button>
    </section> : session ? <form onSubmit={submit}>
      <section className="panel">
        <h2 ref={title} tabIndex={-1} className="text-2xl font-bold">{session.passage.title}</h2>
        <p className="mt-1 text-slate-700">{session.passage.formId} · {session.passage.difficultyTier} · {assistanceLabels[session.assistance]}</p>
        <button type="button" className="button mt-3" onClick={() => setLearnerView(true)}>Open clean reading view</button>
        <Marking session={session} transcript={transcript} onConfirmSuggestions={suggestions => {
          setSession(current => current && ({
            ...current, judgments:reviewSuggestions(suggestions, current.judgments), verified:false,
          }));
        }} onMark={(id, judgment) => setSession(current => current && mark(current, id, judgment))} />
      </section>
      <section className="panel mt-4">
        <h2 className="text-xl font-bold">Verify evidence</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="field">Reading assistance
            <select value={session.assistance} onChange={e => {
              const value = e.target.value as Assistance;
              if (session.assistance !== "independent" && value === "independent") {
                setNotice("This passage already received help. Start a fresh form for independent evidence.");
                return;
              }
              setSession({...session, assistance:value, verified:false});
              setNotice("");
            }}>
              {Object.entries(assistanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">Observation quality
            <select value={session.quality} onChange={e => setSession({...session, quality:e.target.value as Quality, verified:false})}>
              {Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {session.assistance !== "independent" && <p className="mt-3">This result is practice evidence only.</p>}
        <label className="mt-4 flex items-start gap-2">
          <input className="mt-1 size-5 shrink-0" type="checkbox" checked={session.verified}
            onChange={e => setSession({...session, verified:e.target.checked})} />
          I observed every scored word and verified the assistance and observation settings.
        </label>
        <p className="mt-3 text-sm text-slate-700" role="status">{submissionIssue(session) ?? "Ready to submit."}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="button primary" disabled={!!submissionIssue(session)}>Submit assessment</button>
          <button type="button" className="button" onClick={reset}>End check</button>
        </div>
      </section>
    </form> : <section className="panel max-w-xl">
      <h2 className="text-xl font-bold">Select a passage</h2>
      <form onSubmit={start} className="mt-4 grid gap-4">
        <label className="field">Passage
          <select value={selected} onChange={e => setSelected(e.target.value)}>
            {available.map(p => <option key={p.passageId} value={p.passageId}>{p.title} · {p.wordCount} words</option>)}
          </select>
        </label>
        {!sharedSession && <>
        <label className="field">Fictional learner ID<input value={learnerId} onChange={e => setLearnerId(e.target.value)} required pattern="[A-Za-z0-9_\-]{1,64}" /></label>
        <label className="field">Session ID<input value={sessionId} onChange={e => setSessionId(e.target.value)} required pattern="[A-Za-z0-9_\-]{1,64}" /></label>
        </>}
        <button className="button primary justify-self-start" disabled={!available.length || opening}>Start check</button>
      </form>
      <p className="mt-4 text-sm text-slate-700">These forms are provisional and have not been validated as equivalent.</p>
    </section>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-violet-100 p-3">{notice}</p>}
  </main>;
}

function format(score: number) {
  return new Intl.NumberFormat("en", {maximumFractionDigits: 2}).format(score);
}

function Stat({label, value}: {label: string; value: string | number}) {
  return <div className="rounded-lg bg-slate-50 p-2"><dt className="text-sm text-slate-700">{label}</dt><dd className="font-semibold">{value}</dd></div>;
}

function Marking({session, transcript, onMark, onConfirmSuggestions}: {
  session: Session; transcript: string;
  onMark: (id: string, judgment: Judgment) => void;
  onConfirmSuggestions: (suggestions: Record<string, Suggestion>) => void;
}) {
  const parts = tokenize(session.passage);
  const words = parts.filter(part => typeof part !== "string");
  const [selected, setSelected] = useState(words[0].id);
  const current = words.find(word => word.id === selected) ?? words[0];
  const count = counts(session);
  const labelId = useId();
  let suggestions: Record<string, Suggestion> = {};
  let alignmentError = "";
  try {
    suggestions = alignReading(words, transcript);
  } catch {
    alignmentError = "The transcript is too long to align. Please review the recording manually.";
  }
  const aiCount = words.filter(word => !session.judgments[word.id] && suggestions[word.id]).length;
  let position = 0;
  return <>
    <p className="mt-3 text-sm text-slate-700">Listen to the learner, select a word, then choose a judgment. Use the clean reading view or a clean copy for the learner.</p>
    {transcript && <details className="mt-2">
      <summary className="cursor-pointer font-semibold">Speech-to-text transcript</summary>
      <p className="my-2">{transcript}</p>
    </details>}
    {alignmentError && <p role="status">{alignmentError}</p>}
    {aiCount > 0 && <p className="mt-2 text-sm">
      AI preview: green = heard a match. Red = heard something different or did not hear this word.
      Review the recording before confirming. Dotted boxes are suggestions.
    </p>}
    <p className="my-4 text-xl leading-[2.5] sm:text-2xl" aria-label="Reading passage">
      {parts.map((part, index) => {
        if (typeof part === "string") return <span key={index}>{part}</span>;
        const status = session.judgments[part.id] ?? "UNASSESSED";
        const suggestion = session.judgments[part.id] ? undefined : suggestions[part.id];
        const variant = suggestion ? {
          ...variants[suggestion.kind === "MATCH" ? "CORRECT" : "INCORRECT"],
          label: suggestion.kind === "MATCH" ? "AI match" : "AI possible error",
        } : variants[status];
        const number = ++position;
        return <button type="button" key={part.id}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded border px-1.5 align-middle leading-normal ${variant.style} ${suggestion ? "border-dashed" : ""} ${current.id === part.id ? "ring-2 ring-violet-700" : ""}`}
          aria-label={`Word ${number}: ${part.text}, ${variant.label}`} aria-pressed={current.id === part.id}
          onClick={() => setSelected(part.id)}>{part.text}<span aria-hidden="true" className="text-xs">{variant.mark}</span></button>;
      })}
    </p>
    <div className="rounded-lg bg-violet-50 p-3" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="font-semibold">Mark word {words.indexOf(current) + 1}: {current.text}</p>
      {suggestions[current.id] && <p className="text-sm">AI heard: {suggestions[current.id].heard ?? "No matching word"}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(variants).map(([value, item]) =>
          <button type="button" className="button" key={value}
            aria-pressed={(session.judgments[current.id] ?? "UNASSESSED") === value}
            onClick={() => {
              onMark(current.id, value as Judgment);
              if (value === "CORRECT" || value === "INCORRECT") {
                const next = words[words.indexOf(current) + 1];
                if (next) setSelected(next.id);
              }
            }}>{item.label}</button>)}
      </div>
      {aiCount > 0 && <button type="button" className="button mt-3 mr-2" onClick={() => {
        if (window.confirm("Have you reviewed the audio and checked these remaining AI suggestions? Your existing marks will stay.")) {
          onConfirmSuggestions(suggestions);
        }
      }}>Confirm remaining AI marks</button>}
      <button type="button" className="button mt-3" disabled={!count.unassessed} onClick={() => {
        if (window.confirm("Did you observe every unassessed word being read correctly? Unclear words will stay unscored.")) {
          for (const word of words) {
            if (!session.judgments[word.id] || session.judgments[word.id] === "UNASSESSED") onMark(word.id, "CORRECT");
          }
        }
      }}>Mark remaining as correct</button>
    </div>
    <dl aria-live="polite" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Correct" value={count.correct} />
      <Stat label="Incorrect" value={count.incorrect} />
      <Stat label="Unassessed" value={count.unassessed} />
      <Stat label="Unclear" value={count.unclear} />
    </dl>
    <p className="mt-2 text-sm text-slate-700">Provisional accuracy on judged words: {count.preview === null ? "—" : `${format(count.preview)}% (${count.correct + count.incorrect}/${count.total} words judged)`}</p>
  </>;
}

function JsonBlock({label, data}: {label: string; data: unknown}) {
  const [message, setMessage] = useState("");
  const json = JSON.stringify(data, null, 2);
  return <details className="mt-3 border-t border-slate-200 pt-3">
    <summary className="cursor-pointer font-semibold">{label}</summary>
    <button type="button" className="button mt-2" onClick={async () => {
      try { await navigator.clipboard.writeText(json); setMessage("Copied."); }
      catch { setMessage("Select the text below to copy it."); }
    }}>Copy JSON</button>
    <span role="status" className="ml-2 text-sm">{message}</span>
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-100 p-3 text-sm">{json}</pre>
  </details>;
}
