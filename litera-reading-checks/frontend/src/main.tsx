import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PhonicsAssessment } from "./PhonicsAssessment";
import { ComprehensionAssessment } from "./comprehension/ComprehensionAssessment";
import { OralReadingAssessment } from "./oral/OralReadingAssessment";
import { toTreeCheck } from "./oral/scoring";
import { addEvidence, buildHandoff } from "./session";
import type { ReadingEvidence } from "./session";
import "./oral/style.css";

const labels = { phonics: "Phonics", oral: "Oral reading", comprehension: "Comprehension" } as const;

function App() {
  const [learnerId, setLearnerId] = useState("demo-001");
  const [identity, setIdentity] = useState<{ learnerId: string; sessionId: string }>();
  const [check, setCheck] = useState<keyof typeof labels>("phonics");
  const [entries, setEntries] = useState<ReadingEvidence[]>([]);
  const oralExposure = useRef(new Map<string, Set<string>>());
  const ledger = useRef<ReadingEvidence[]>([]);
  const currentSession = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  function accept(entry: ReadingEvidence) {
    if (!identity || currentSession.current !== identity.sessionId) return;
    ledger.current = addEvidence(identity, ledger.current, entry);
    setEntries(ledger.current);
    setStatus("Evidence added to this session.");
  }
  const data = identity ? buildHandoff(identity, entries) : null;
  return <>
    <div className="mx-auto max-w-4xl px-4 pt-6 sm:px-8">
      <header><h1 className="text-3xl font-bold text-violet-900">Litera</h1>
        <p className="mt-1 text-slate-700">Grade 3 English reading checks · Demonstration</p></header>
      {identity ? <>
        <p className="mt-3 text-sm">Learner {identity.learnerId} · One shared session</p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Choose reading check">
          {(["phonics", "oral", "comprehension"] as const).map(type => <button key={type} type="button" className="button"
            disabled={check === type} onClick={() => {
              if (window.confirm("Switch checks? Unsubmitted answers, marks and audio in this check will be cleared.")) {
                setCheck(type);
                setStatus("");
              }
            }}>{labels[type]}</button>)}
          <button className="button" type="button" onClick={() => {
            if (!window.confirm("End this session and clear its local evidence and audio? Export any results first.")) return;
            currentSession.current = undefined;
            setIdentity(undefined);
            ledger.current = [];
            setEntries([]);
            setStatus("");
          }}>End session</button>
        </nav>
      </> : <form className="panel mt-4" onSubmit={event => {
        event.preventDefault();
        setCheck("phonics");
        const sessionId = crypto.randomUUID();
        currentSession.current = sessionId;
        setIdentity({ learnerId, sessionId });
      }}>
        <label className="field">Fictional learner ID<input value={learnerId}
          onChange={event => setLearnerId(event.target.value)} pattern="[A-Za-z0-9_\-]{1,64}" required /></label>
        <button className="button primary mt-3">Start reading session</button>
      </form>}
    </div>
    {identity && (check === "phonics"
      ? <PhonicsAssessment {...identity} onComplete={receipt => accept({ skill: "phonics", event: receipt.event, check: receipt.treeCheck })} />
      : check === "oral" ? <OralReadingAssessment sharedSession={identity} onPassageOpened={passageId => {
          const seen = oralExposure.current.get(identity.learnerId) ?? new Set<string>();
          seen.add(passageId);
          oralExposure.current.set(identity.learnerId, seen);
        }} onComplete={result => accept({ skill: "oral", event: result.event, check: toTreeCheck(result.event) })} />
      : <ComprehensionAssessment identity={identity} seenPassages={oralExposure.current.get(identity.learnerId) ?? new Set()}
          onComplete={receipt => accept({ skill: "comprehension", event: receipt.event, check: receipt.treeCheck })} />)}
    {data && <section className="panel mx-auto mb-8 max-w-3xl">
      <h2 className="text-xl font-bold">Session evidence</h2>
      {entries.length ? <ul className="list-disc pl-5">{entries.map(entry => <li key={entry.event.eventId}>
        {labels[entry.skill]} · {entry.event.correct}/{entry.event.total}
        {entry.event.assisted ? " · practice only" : " · independent"}
      </li>)}</ul> : <p>Complete a check to add evidence.</p>}
      <details className="mt-3"><summary className="cursor-pointer font-semibold">Scoring handoff JSON</summary>
        <button className="button mt-2" onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); setStatus("Copied."); }
          catch { setStatus("Select the JSON below to copy it."); }
        }}>Copy session JSON</button>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-100 p-3 text-sm">{JSON.stringify(data, null, 2)}</pre>
      </details>
      <p role="status">{status}</p>
    </section>}
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
