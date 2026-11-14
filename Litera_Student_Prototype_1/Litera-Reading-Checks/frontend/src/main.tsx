import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthScreen, authPost } from "./AuthScreen";
import type { Account } from "./AuthScreen";
import { RequestError, request } from "./api";
import { PhonicsAssessment } from "./PhonicsAssessment";
import { OralReadingAssessment } from "./oral/OralReadingAssessment";
import { toTreeCheck } from "./oral/scoring";
import { addEvidence, buildHandoff } from "./session";
import type { ReadingEvidence } from "./session";
import "./oral/style.css";
import "./student.css";
import "./auth.css";
import logo from "./litera-logo.webp";

function App() {
  const [account, setAccount] = useState<Account | null>();
  const [loadingError, setLoadingError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");

  async function loadSession() {
    setLoadingError(false);
    try {
      setAccount(await request<Account>("/api/auth/session"));
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) setAccount(null);
      else setLoadingError(true);
    }
  }

  useEffect(() => { void loadSession(); }, []);

  useEffect(() => {
    if (!account) return;
    const expiry = window.setTimeout(() => setAccount(null), Math.max(0, account.expiresAt * 1000 - Date.now()));
    const expired = () => setAccount(null);
    window.addEventListener("litera:session-expired", expired);
    return () => {
      window.clearTimeout(expiry);
      window.removeEventListener("litera:session-expired", expired);
    };
  }, [account]);

  async function logOut() {
    setSigningOut(true);
    setAccountError("");
    try {
      await authPost("logout");
      setAccount(null);
    } catch {
      setAccountError("Litera couldn’t log you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const logoOnly = <header className="litera-header"><div className="litera-header-inner">
    <img src={logo} alt="Litera" width="146" height="43" />
  </div></header>;

  if (account === undefined) return <>{logoOnly}<main className="lesson-home">
    {loadingError ? <section className="panel">
      <p role="alert">Litera couldn’t check your login. Make sure the server is running.</p>
      <button className="button primary mt-4" onClick={loadSession}>Try again</button>
    </section> : <p role="status">Checking your login…</p>}
  </main></>;

  if (!account) return <>{logoOnly}<AuthScreen onVerify={setAccount} /></>;
  return <ReadingApp key={account.learnerId} learnerId={account.learnerId} onLogOut={logOut}
    signingOut={signingOut} accountError={accountError} />;
}

function ReadingApp({ learnerId, onLogOut, signingOut, accountError }: {
  learnerId: string;
  onLogOut: () => void;
  signingOut: boolean;
  accountError: string;
}) {
  const [identity, setIdentity] = useState<{ learnerId: string; sessionId: string }>(() => ({
    learnerId,
    sessionId: crypto.randomUUID(),
  }));
  const [check, setCheck] = useState<"phonics" | "oral" | "lessons">("lessons");
  const [entries, setEntries] = useState<ReadingEvidence[]>([]);
  const ledger = useRef<ReadingEvidence[]>([]);
  const currentSession = useRef(identity.sessionId);
  const [status, setStatus] = useState("");
  const hasReadingWork = check !== "lessons" || entries.length > 0;

  function endReadingSession() {
    if (!window.confirm("End this reading session and clear its local evidence and audio? Export any results first.")) return;
    const sessionId = crypto.randomUUID();
    currentSession.current = sessionId;
    setIdentity({ learnerId, sessionId });
    setCheck("lessons");
    setEntries([]);
    ledger.current = [];
    setStatus("");
  }

  function accept(entry: ReadingEvidence) {
    if (currentSession.current !== identity.sessionId) return;
    ledger.current = addEvidence(identity, ledger.current, entry);
    setEntries(ledger.current);
    setStatus("Evidence added to this session.");
  }
  const data = buildHandoff(identity, entries);
  return <>
    <header className="litera-header">
      <div className="litera-header-inner">
        <img src={logo} alt="Litera" width="146" height="43" />
        <nav aria-label="Session">
          <button className="button" type="button" disabled={check === "lessons"} onClick={() => {
            if (!window.confirm("Return to lessons? Unsubmitted marks and audio for this check will be cleared.")) return;
            setCheck("lessons");
          }}>My lessons</button>
          <button className="button" type="button" disabled={!hasReadingWork} onClick={endReadingSession}>End session</button>
          <button className="button" type="button" disabled={signingOut} onClick={() => {
            if (!hasReadingWork || window.confirm("Log out and clear this session’s local evidence and audio?")) onLogOut();
          }}>{signingOut ? "Logging out…" : "Log out"}</button>
        </nav>
      </div>
      {accountError && <p className="account-alert" role="alert">{accountError}</p>}
    </header>
    {check === "lessons" ? <main className="lesson-home">
      <h1>My reading lessons</h1>
      <p>Choose a reading activity.</p>
      <div className="lesson-grid">
        <section className="panel lesson-card oral-card">
          <span aria-hidden="true" className="lesson-icon">▤</span>
          <h2>Read aloud</h2>
          <p>Read a short story and see which words Litera heard.</p>
          <button className="button primary" onClick={() => setCheck("oral")}>Choose a story</button>
        </section>
        <section className="panel lesson-card phonics-card">
          <span aria-hidden="true" className="lesson-icon">Aa</span>
          <h2>Practice phonics</h2>
          <p>Read five words aloud with your teacher.</p>
          <button className="button primary" onClick={() => setCheck("phonics")}>Open phonics</button>
        </section>
      </div>
    </main> : check === "phonics"
      ? <PhonicsAssessment {...identity} onComplete={receipt => accept({ skill: "phonics", event: receipt.event, check: receipt.treeCheck })} />
      : <OralReadingAssessment sharedSession={identity} onComplete={result => accept({
          skill:"oral", event:result.event, check:toTreeCheck(result.event),
        })} />}
    <section className="panel mx-auto mb-8 max-w-3xl">
      <h2 className="text-xl font-bold">Session evidence</h2>
      {entries.length ? <ul className="list-disc pl-5">{entries.map(entry => <li key={entry.event.eventId}>
        {entry.skill === "oral" ? "Oral reading" : "Phonics"} · {entry.event.correct}/{entry.event.total}
        {entry.event.assisted ? " · practice only" : " · independent"}
      </li>)}</ul> : <p>Complete either check to add evidence.</p>}
      <details className="mt-3"><summary className="cursor-pointer font-semibold">Scoring handoff JSON</summary>
        <button className="button mt-2" onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); setStatus("Copied."); }
          catch { setStatus("Select the JSON below to copy it."); }
        }}>Copy session JSON</button>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-100 p-3 text-sm">{JSON.stringify(data, null, 2)}</pre>
      </details>
      <p role="status">{status}</p>
    </section>
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
