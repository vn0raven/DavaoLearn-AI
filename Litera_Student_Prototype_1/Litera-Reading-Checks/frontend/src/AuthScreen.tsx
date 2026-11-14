import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { request } from "./api";

export interface Account {
  learnerId: string;
  expiresAt: number;
}

type Mode = "login" | "signup";

export function authPost<T>(path: string, data: object = {}) {
  return request<T>(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function AuthScreen({ onVerify }: { onVerify: (account: Account) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const passwordField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const wasSent = useRef(false);

  useEffect(() => {
    if (busy) return;
    if (sent) passwordField.current?.focus();
    else if (wasSent.current) emailField.current?.focus();
    wasSent.current = sent;
  }, [sent, busy]);

  function editEmail() {
    setPassword("");
    setSent(false);
    setNotice("");
    setError("");
  }

  async function sendPassword() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await authPost(mode, { email: email.trim() });
      setPassword("");
      setSent(true);
      setNotice(mode === "signup"
        ? "If this email is new to Litera, a temporary password is on its way."
        : "If this email has a Litera account, a temporary password is on its way.");
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!sent) {
      await sendPassword();
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const account = await authPost<Account>("verify", {
        email: email.trim(),
        purpose: mode,
        password,
      });
      onVerify(account);
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return <main className="lesson-home auth-home">
    <div className="auth-intro">
      <h1>My reading lessons</h1>
      <p>Grade 3 English</p>
      <ul className="auth-activities" aria-label="Reading activities">
        <li><span className="lesson-icon" aria-hidden="true">▤</span> Read aloud</li>
        <li><span className="lesson-icon" aria-hidden="true">Aa</span> Practice phonics</li>
      </ul>
    </div>
    <section className="panel auth-panel" aria-labelledby="auth-title">
      <div className="auth-switch" aria-label="Account options" role="group">
        {(["login", "signup"] as const).map(option => <button
          key={option} className="button" type="button" aria-pressed={mode === option}
          disabled={busy} onClick={() => {
            if (mode !== option) {
              setMode(option);
              editEmail();
            }
          }}
        >{option === "login" ? "Log in" : "Sign up"}</button>)}
      </div>
      <h2 id="auth-title">{sent ? "Enter your temporary password" : mode === "login" ? "Log in to Litera" : "Create your Litera account"}</h2>
      {!sent && <p>Enter your email and we’ll send you a temporary password.</p>}
      {sent && <div className="auth-email-status">
        <p className="auth-address">{email.trim()}</p>
        <p>Check your inbox and spam folder. Your password expires after 15 minutes.</p>
      </div>}
      <form onSubmit={submit} aria-busy={busy}>
        {sent ? <label className="field">Temporary password
          <input ref={passwordField} value={password} onChange={event => setPassword(event.target.value)}
            type="password" autoComplete="one-time-code" maxLength={64} required disabled={busy} />
        </label> : <label className="field">Email address
          <input ref={emailField} value={email} onChange={event => setEmail(event.target.value)}
            type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" required disabled={busy} />
        </label>}
        <button type="submit" className="button primary auth-continue" disabled={busy}>
          {busy ? "Please wait…" : sent ? (mode === "signup" ? "Create account and continue" : "Verify and log in") : "Email my temporary password"}
        </button>
      </form>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {sent && <div className="auth-help">
        <button type="button" className="button" disabled={busy} onClick={editEmail}>Change email</button>
        <button type="button" className="button" disabled={busy} onClick={sendPassword}>Send again</button>
      </div>}
    </section>
  </main>;
}
