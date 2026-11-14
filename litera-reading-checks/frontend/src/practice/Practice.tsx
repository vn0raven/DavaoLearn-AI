import { useEffect, useRef, useState } from "react";
import type { EvidenceProfile } from "../evidence";
import type { SessionIdentity } from "../session";
import { activities, feedback, nextStep, recordAttempt, selectActivity, startPractice, useHint } from "./activity";
import type { Activity, PracticeRun, Skill } from "./activity";
import { freshCheck } from "./fresh";
import type { FreshCheck } from "./fresh";
import { readPractice, readQueue, savePractice, setQueue } from "./storage";

interface Props {
  identity: SessionIdentity;
  profile?: EvidenceProfile;
  onCheck: (check: FreshCheck & { formId: string }) => void;
  onActive: (active: boolean) => void;
}

const skills = { phonics: "Phonics", oral: "Oral reading", comprehension: "Comprehension" };
const now = () => new Date().toISOString();

export function Practice({ identity, profile, onCheck, onActive }: Props) {
  const [run, setRun] = useState<PracticeRun>();
  const [records, setRecords] = useState<PracticeRun[]>([]);
  const [queue, setReviewQueue] = useState<ReturnType<typeof readQueue>>([]);
  const [notice, setNotice] = useState("");
  const [storageProblem, setStorageProblem] = useState(false);
  const [checking, setChecking] = useState(false);
  const [word, setWord] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const active = activities.find(item => item.id === run?.activityId && item.version === run.contentVersion);

  useEffect(() => {
    try {
      setRecords(readPractice(localStorage, identity.learnerId));
      setReviewQueue(readQueue(localStorage, identity.learnerId));
    } catch {
      setStorageProblem(true);
    }
  }, [identity.learnerId]);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => { if (run) heading.current?.focus(); }, [run?.runId, run?.step, run?.completedAt]);

  function persist(next: PracticeRun) {
    setRun(next);
    try {
      const saved = savePractice(localStorage, next);
      setRecords(records => [...records.filter(item => item.runId !== saved.runId), saved]);
      setStorageProblem(false);
    } catch {
      setStorageProblem(true);
    }
  }

  function launch(activity: Activity) {
    setNotice("");
    setWord(undefined);
    persist(startPractice(activity, identity, crypto.randomUUID(), now()));
    onActive(true);
  }

  function close(message = "") {
    setRun(undefined);
    setNotice(message);
    onActive(false);
  }

  async function requestCheck(skill: Skill, tier: string) {
    if (requestController.current) return;
    const controller = new AbortController();
    requestController.current = controller;
    setChecking(true);
    setNotice("");
    try {
      const result = await freshCheck(identity.learnerId, skill, tier, controller.signal);
      if (controller.signal.aborted) return;
      if (result.formId) {
        try {
          setReviewQueue(setQueue(localStorage, identity.learnerId, skill, tier));
        } catch {
          // A browser storage failure does not prevent opening the server-selected form.
        }
        onCheck({ ...result, formId: result.formId });
        return;
      }
      setNotice(result.reason ?? "Teacher review: a fresh assessment is needed.");
      try {
        setReviewQueue(setQueue(localStorage, identity.learnerId, skill, tier, now()));
      } catch {
        setStorageProblem(true);
      }
    } catch {
      if (!controller.signal.aborted) setNotice("Could not check which forms are available. Try again.");
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function rehearse() {
    if (!run || !active) return null;
    const step = active.steps[run.step];
    const result = feedback(run, active);
    const answered = run.attempts.some(attempt => attempt.step === run.step && attempt.correct !== false);
    return <>
      <p className="mt-2 text-sm" aria-live="polite">Step {run.step + 1} of {active.steps.length}</p>
      {active.passage && <div className="my-4 rounded-lg bg-violet-50 p-4 text-lg leading-relaxed">
        {active.passage.map((sentence, index) => <p key={sentence} className={result?.line === index ? "font-bold text-violet-950" : ""}>
          {run.step > 0 || step.kind === "choice" ? <span className="text-sm text-slate-600">{index + 1}. </span> : null}
          {sentence}
        </p>)}
      </div>}
      {active.wordCues && <div className="my-3">
        <p className="font-semibold">Review a word with your teacher</p>
        <div className="flex flex-wrap gap-2">
          {active.wordCues.map(item => <button key={item.word} className="button" type="button"
            aria-pressed={word === item.word} onClick={() => setWord(item.word)}>{item.word}</button>)}
        </div>
        <p aria-live="polite">{active.wordCues.find(item => item.word === word)?.cue}</p>
      </div>}
      <h4 className="mt-4 text-xl font-semibold">{step.prompt}</h4>
      {step.kind === "guide" ? <>
        <p className="my-3">{step.cue}</p>
        {!answered && <button type="button" className="button" onClick={() => persist(recordAttempt(run, active, "guided"))}>{step.action}</button>}
      </> : <>
        <div className="my-3 grid gap-2 sm:grid-cols-3">
          {step.options.map((option, index) => <button type="button" key={option} className="button min-w-0 break-words"
            disabled={answered} onClick={() => persist(recordAttempt(run, active, index))}>{option}</button>)}
        </div>
        {!answered && !run.hints.includes(run.step) && <button type="button" className="button"
          onClick={() => persist(useHint(run, active))}>Show a hint</button>}
        {run.hints.includes(run.step) && <p className="mt-2" role="status">{step.hint}</p>}
        {result && <p className="mt-3 rounded-lg bg-violet-50 p-3" role="status">
          <strong>{result.correct ? "Correct. " : "Try again. "}</strong>{result.text}
        </p>}
      </>}
      {answered && <button type="button" className="button primary mt-4" onClick={() => persist(nextStep(run, active, now()))}>
        {run.step + 1 === active.steps.length ? "Complete activity" : "Next step"}
      </button>}
      <label className="field mt-4">Teacher observation (optional)
        <input maxLength={240} value={run.notes} onChange={event => persist({ ...run, notes: event.target.value })} />
      </label>
    </>;
  }

  const recommendation = profile?.recommendation;
  const used = records.filter(item => item.completedAt).map(item => item.activityId);
  const lastCompletion = [...records].reverse().find(item => item.completedAt &&
    activities.some(activity => activity.id === item.activityId && activity.version === item.contentVersion));
  const resumable = [...records].reverse().find(item => !item.completedAt &&
    activities.some(activity => activity.id === item.activityId && activity.version === item.contentVersion));
  return <section className="mt-5 border-t border-slate-200 pt-4" aria-label="Reading practice">
    <h3 ref={heading} tabIndex={-1} className="text-xl font-bold">{active?.title ?? "Recommended practice"}</h3>
    {storageProblem && <p role="status" className="mt-2">Practice is available, but browser storage could not save or load the record.</p>}
    {notice && <p role="status" className="mt-3">{notice}</p>}
    {active && run ? <>
      <p className="mt-2">{active.instructions}</p>
      <p className="text-sm text-slate-700">{skills[active.skill]} · {active.difficultyTier}</p>
      {run.completedAt ? <div className="mt-3">
        <p><strong>Activity completed.</strong> {run.attempts.length} practice attempts · {run.hints.length} hints used · Teacher-guided.</p>
        <p className="mt-2">A fresh independent check is the next step.</p>
        <button type="button" className="button primary mt-3" disabled={checking}
          onClick={() => void requestCheck(run.skill, run.difficultyTier)}>Try a new reading check</button>
        <button type="button" className="button ml-2 mt-3" disabled={checking} onClick={() => close()}>Back to practice choices</button>
      </div> : <>
        {rehearse()}
        <button type="button" className="button mt-4" onClick={() => close("Practice paused.")}>Pause practice</button>
      </>}
    </> : <>
      {recommendation && profile && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["primary", "secondary"] as const).map(slot => {
          const plan = recommendation[slot];
          const activity = selectActivity(plan, profile.selectedTiers, used);
          const skill = plan.skill;
          return <div key={slot} className="min-w-0 rounded-lg border border-violet-200 p-3">
            <p className="text-sm capitalize">{slot}</p>
            <h4 className="font-semibold">{plan.label}</h4>
            {activity ? <>
              <p className="mt-1 text-sm">{activity.title} · {skills[activity.skill]} · {activity.difficultyTier}</p>
              <p>{activity.instructions}</p>
              <button type="button" className="button mt-2" disabled={checking} onClick={() => launch(activity)}>Start {slot} activity</button>
            </> : plan.activityId === "FRESH_INDEPENDENT_CHECK" && skill ?
              <button type="button" className="button mt-2" disabled={checking}
                onClick={() => void requestCheck(skill, plan.difficultyTier ?? profile.selectedTiers[skill])}>Try a new reading check</button>
              : <p className="mt-1">Teacher review: no matching practice at {plan.difficultyTier ?? "the current tier"}.</p>}
          </div>;
        })}
      </div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {resumable && <button type="button" className="button" disabled={checking} onClick={() => {
          setNotice(""); setWord(undefined); setRun(resumable); onActive(true);
        }}>Resume practice</button>}
        {lastCompletion && <button type="button" className="button" disabled={checking} onClick={() => {
          setNotice(""); setRun(lastCompletion); onActive(true);
        }}>View last completed activity</button>}
      </div>
      {queue.length > 0 && <p className="mt-3 text-sm">Teacher review queue: {queue.map(item => `${skills[item.skill]} (${item.tier})`).join(", ")}.</p>}
    </>}
  </section>;
}
