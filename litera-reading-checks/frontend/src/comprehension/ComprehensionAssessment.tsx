import { useEffect, useRef, useState } from "react";
import { RequestError } from "../api";
import type { SessionIdentity } from "../session";
import { completeAssessment, interruptAssessment, listForms, startAssessment } from "./api";
import type { StartRequest } from "./api";
import type { ComprehensionForm, FormSummary, LearnerResponse, Mode, Receipt } from "./types";

interface Props {
  identity: SessionIdentity;
  seenPassages: ReadonlySet<string>;
  onComplete: (receipt: Receipt) => void;
}

function describe(error: unknown, fallback: string) {
  return error instanceof RequestError ? error.message : fallback;
}

export function ComprehensionAssessment({ identity, seenPassages, onComplete }: Props) {
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loadKey, setLoadKey] = useState(0);
  const [formId, setFormId] = useState("");
  const [mode, setMode] = useState<Mode>("independent");
  const [attempt, setAttempt] = useState<{ id: string; form: ComprehensionForm }>();
  const [assisted, setAssisted] = useState(false);
  const [index, setIndex] = useState<number>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handoffFailed, setHandoffFailed] = useState(false);
  const starting = useRef<StartRequest | undefined>(undefined);
  const active = useRef<string | undefined>(undefined);
  const sending = useRef(false);
  const pendingSubmission = useRef<{ responses: LearnerResponse[]; assisted: boolean } | undefined>(undefined);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    function closeAttempt() {
      if (active.current) void interruptAssessment(active.current).catch(() => undefined);
    }
    mounted.current = true;
    window.addEventListener("pagehide", closeAttempt);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", closeAttempt);
      closeAttempt();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    listForms(controller.signal).then(items => {
      setForms(items);
      setFormId(items[0]?.formId ?? "");
    }).catch(error => {
      if (!controller.signal.aborted) setError(describe(error, "Could not load comprehension forms."));
    });
    return () => controller.abort();
  }, [loadKey]);
  useEffect(() => { if (attempt || receipt) heading.current?.focus(); }, [attempt, index, receipt]);

  async function start() {
    const form = forms.find(item => item.formId === formId);
    if (!form || sending.current || (mode === "independent" && seenPassages.has(form.passageId))) return;
    const previous = starting.current;
    const data = previous?.formId === formId && previous.mode === mode ? previous : {
      ...identity, eventId: crypto.randomUUID(), formId, mode, difficultyTier: form.difficultyTier,
    };
    starting.current = data;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const loaded = await startAssessment(data);
      if (!mounted.current) {
        await interruptAssessment(data.eventId).catch(() => undefined);
        return;
      }
      active.current = data.eventId;
      setAttempt({ id: data.eventId, form: loaded });
      setAssisted(mode === "assisted");
    } catch (error) {
      if (mounted.current) setError(describe(error, "Could not open the passage. Try again."));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function handoff(result: Receipt) {
    try {
      onComplete(result);
      setHandoffFailed(false);
      setError("");
    } catch {
      setHandoffFailed(true);
      setError("The score was saved. Retry adding this same event to the shared session.");
    }
  }

  async function submit() {
    if (!attempt || sending.current || receipt) return;
    const responses = attempt.form.questions.flatMap(({ questionId }) =>
      answers[questionId] === undefined ? [] : [{ questionId, answerId: answers[questionId] }],
    );
    if (responses.length !== attempt.form.questions.length) {
      setError("Answer every question before submitting.");
      const first = attempt.form.questions.findIndex(question => answers[question.questionId] === undefined);
      setIndex(first);
      return;
    }
    const data = pendingSubmission.current ?? { responses, assisted };
    pendingSubmission.current = data;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await completeAssessment(attempt.id, data.responses, data.assisted);
      active.current = undefined;
      if (!mounted.current) return;
      setReceipt(result);
      handoff(result);
    } catch (error) {
      if (error instanceof RequestError && error.status === 422) pendingSubmission.current = undefined;
      if (mounted.current) setError(describe(error, "Could not confirm submission. Retry to recover the same result."));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function stop() {
    if (!attempt || sending.current) return;
    if (!window.confirm("End this attempt without submitting? Use a fresh passage for another independent check.")) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await interruptAssessment(attempt.id);
      active.current = undefined;
      starting.current = undefined;
      pendingSubmission.current = undefined;
      if (!mounted.current) return;
      setAttempt(undefined);
      setIndex(undefined);
      setAnswers({});
    } catch {
      if (mounted.current) setError("Could not end this attempt. If submission may have succeeded, retry submission to recover the result.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const question = index === undefined ? undefined : attempt?.form.questions[index];
  const total = attempt?.form.questions.length ?? 0;
  const unanswered = total - Object.keys(answers).length;
  const openedInOral = forms.some(form => form.formId === formId && seenPassages.has(form.passageId));

  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
    <header className="mb-6">
      <h1 className="text-3xl font-bold">Reading comprehension check</h1>
      <p className="mt-2 text-slate-700">Grade 3 English · Provisional demonstration materials</p>
    </header>
    {error && <p role="alert" className="mb-3 rounded-lg bg-amber-100 p-3">{error}</p>}
    {receipt && attempt ? <section className="panel">
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">{attempt.form.title}</h2>
      <p className="my-3 text-4xl font-bold text-violet-900">
        {receipt.event.score.toLocaleString(undefined, { maximumFractionDigits: 2 })}%
      </p>
      <p>{receipt.event.correct} correct · {receipt.incorrect} incorrect · {receipt.unanswered} unanswered · {receipt.event.total} total</p>
      <p className="mt-2">Form {receipt.event.formId} · {receipt.event.difficultyTier}</p>
      <p className="mt-2">{receipt.event.assisted ? "Assisted practice · Excluded from independent evidence" : "Independent assessment · Usable evidence"}</p>
      <p role="status" className="mt-2">{handoffFailed ? "Submitted · Session handoff pending" : "Submitted · Assessment event added to the session"}</p>
      {handoffFailed && <button type="button" className="button mt-3" onClick={() => handoff(receipt)}>Retry session handoff</button>}
    </section> : !attempt ? <section className="panel">
      <label className="field">Passage
        <select value={formId} disabled={busy || forms.length === 0} onChange={event => setFormId(event.target.value)}>
          {!forms.length && <option value="">No forms loaded</option>}
          {forms.map(form => <option key={form.formId} value={form.formId}>{form.title} ({form.formId} · {form.difficultyTier})</option>)}
        </select>
      </label>
      <label className="field mt-3">Assessment mode
        <select value={mode} disabled={busy} onChange={event => setMode(event.target.value === "assisted" ? "assisted" : "independent")}>
          <option value="independent">Independent reading</option>
          <option value="assisted">Assisted practice</option>
        </select>
      </label>
      {openedInOral && <p className="mt-3">This passage was opened in oral reading. Choose a fresh passage or Assisted practice.</p>}
      <button type="button" className="button primary mt-4" disabled={busy || !formId || (openedInOral && mode === "independent")}
        onClick={() => void start()}>{busy ? "Opening passage…" : "Open passage"}</button>
      {!forms.length && error && <button type="button" className="button ml-2" onClick={() => { setError(""); setLoadKey(key => key + 1); }}>Retry loading forms</button>}
    </section> : <section className="panel">
      {question && index !== undefined ? <>
        <p className="text-sm font-semibold text-violet-900" aria-live="polite">Question {index + 1} of {total} · {unanswered} unanswered</p>
        <h2 ref={heading} tabIndex={-1} id="comprehension-question" className="my-3 text-xl font-bold sm:text-2xl">{question.prompt}</h2>
        <fieldset aria-labelledby="comprehension-question" disabled={busy || !!pendingSubmission.current} className="grid gap-2">
          {question.choices.map(choice => <label key={choice.answerId} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-400 p-3 has-checked:border-violet-800 has-checked:bg-violet-100">
            <input type="radio" name={question.questionId} value={choice.answerId} checked={answers[question.questionId] === choice.answerId}
              onChange={() => setAnswers(current => ({ ...current, [question.questionId]: choice.answerId }))} />
            {choice.text}
          </label>)}
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="button" disabled={busy || index === 0} onClick={() => setIndex(index - 1)}>Previous</button>
          <button type="button" className="button" disabled={busy || index === total - 1} onClick={() => setIndex(index + 1)}>Next</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Working…" : pendingSubmission.current ? "Retry submission" : "Submit assessment"}
          </button>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">Read the passage again</summary>
          <p className="mt-2 text-xl leading-relaxed">{attempt.form.text}</p>
        </details>
      </> : <>
        <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">{attempt.form.title}</h2>
        <p className="mt-1 text-sm">Form {attempt.form.formId} · {attempt.form.difficultyTier}</p>
        <p className="mt-3">{assisted ? "Read with your teacher, then answer the questions." : "Read the story on your own, then answer the questions."}</p>
        <p className="my-5 max-w-prose text-xl leading-relaxed sm:text-2xl">{attempt.form.text}</p>
        <button type="button" className="button primary" disabled={busy} onClick={() => setIndex(0)}>Start questions</button>
      </>}
      <div className="mt-5 border-t border-slate-200 pt-3">
        {assisted ? <p>Assisted practice</p> : <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" disabled={busy || !!pendingSubmission.current} checked={assisted} onChange={() => setAssisted(true)} />
          Mark as assisted if the learner received help
        </label>}
        <button type="button" className="button mt-2" disabled={busy} onClick={() => void stop()}>End without submitting</button>
      </div>
    </section>}
  </main>;
}
