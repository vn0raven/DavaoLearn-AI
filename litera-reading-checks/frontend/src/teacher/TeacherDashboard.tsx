import { useEffect, useState } from "react";
import type { EvidenceProfile } from "../evidence";
import { saveTeacherOverride } from "../evidence";
import { activities } from "../practice/activity";
import { readPractice, readQueue } from "../practice/storage";
import type { PracticeRun } from "../practice/activity";

const names = { phonics: "Phonics", oral: "Oral reading", comprehension: "Comprehension" };
const options = [
  { value: "PHONICS_BASED_LEARNING", label: "Phonics-based learning" },
  { value: "GUIDED_ORAL_READING", label: "Guided oral reading" },
  { value: "GUIDED_COMPREHENSION", label: "Guided comprehension" },
  { value: "MIXED_READING", label: "Mixed reading" },
  { value: "ORAL_REREADING", label: "Oral rereading" },
];

export function TeacherDashboard({ profile, sessionId, refresh }: {
  profile?: EvidenceProfile; sessionId: string; refresh: () => void;
}) {
  const [records, setRecords] = useState<PracticeRun[]>([]);
  const [reviewQueue, setReviewQueue] = useState<{ skill: keyof typeof names; tier: string; requestedAt: string }[]>([]);
  const [storageWarning, setStorageWarning] = useState(false);
  const [reason, setReason] = useState("");
  const [overrideActivity, setOverrideActivity] = useState("PHONICS_BASED_LEARNING");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!profile) return;
    try {
      setRecords(readPractice(localStorage, profile.learnerId));
      setReviewQueue(readQueue(localStorage, profile.learnerId));
      setStorageWarning(false);
    } catch { setStorageWarning(true); }
  }, [profile]);

  const pending = profile?.skills.filter(item => item.status === "UNCONFIRMED" || item.reassess) ?? [];
  const rejected = profile?.rejectedSubmissions ?? [];
  return <section className="panel teacher-dashboard mx-auto mb-8 max-w-4xl" aria-label="Teacher evidence dashboard">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-bold">Teacher Review · Demo</h2>
      <button type="button" className="button" onClick={refresh}>Refresh saved evidence</button>
    </div>
    <p className="mt-2 text-sm"><strong>Local demonstration only.</strong> This application does not yet have teacher login or server-enforced authorization. Use fictional learner IDs and never deploy it with real child records.</p>
    {!profile ? <p role="status">Saved evidence is loading or unavailable.</p> : <>
      <p className="mt-3"><strong>Learner:</strong> {profile.learnerId}</p>
      <h3 className="mt-4 font-bold">Assessment evidence (separate skills)</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["phonics", "oral", "comprehension"] as const).map(skill => {
          const state = profile.skills.find(item => item.skill === skill && item.difficultyTier === profile.selectedTiers[skill]);
          return <article className="rounded-lg border border-violet-200 p-3" key={skill}>
            <h4 className="font-semibold">{names[skill]}</h4>
            <p>{state?.latestUsableScore === null || state?.latestUsableScore === undefined ? "No confirmed score" : `${state.latestUsableScore}%`}</p>
            <p className="text-sm">Status: {state?.status ?? "UNCONFIRMED"}</p>
            <p className="text-sm">{state?.reason ?? "No assessment evidence yet."}</p>
          </article>;
        })}
      </div>
      <h3 className="mt-5 font-bold">Pending teacher review</h3>
      {!pending.length && !rejected.length && !reviewQueue.length ? <p>No pending review items in available data.</p> :
      <ul className="mt-2 list-disc pl-5">
        {pending.map(item => <li key={`${item.skill}-${item.difficultyTier}`}>{names[item.skill]} ({item.status}): {item.reason}</li>)}
        {rejected.map(item => <li key={item.eventId}>Rejected/duplicate event {item.eventId}: {item.reason}</li>)}
        {reviewQueue.map(item => <li key={`${item.skill}-${item.tier}`}>No fresh comparable form for {names[item.skill]} ({item.tier}); requested {item.requestedAt}</li>)}
      </ul>}
      <h3 className="mt-5 font-bold">Saved assessment history</h3>
      {profile.events.length ? <div className="overflow-x-auto"><table className="evidence-table">
        <thead><tr><th>When / session</th><th>Skill / form</th><th>Result</th><th>Evidence</th><th>Review</th></tr></thead>
        <tbody>{profile.events.map(event => <tr key={event.eventId}>
          <td>{new Date(event.timestamp).toLocaleString()}<span className="block text-xs">{event.sessionId}</span></td>
          <td>{names[event.skill]}<span className="block text-xs">{event.formId} · v{event.formVersion}</span></td>
          <td>{event.correct === null ? "—" : `${event.correct}/${event.total}`}</td>
          <td>{event.kind === "practice" ? "Practice only" : event.assisted ? "Assisted · excluded" : event.usable ? "Independent · usable" : "Unusable"}</td>
          <td>{event.reviewReason ?? (event.submissionStatus !== "complete" ? event.submissionStatus : "—")}</td>
        </tr>)}</tbody>
      </table></div> : <p>No assessment events have been saved.</p>}
      <details className="mt-3"><summary>Original evidence and scoring revisions (audit view)</summary>
        <p className="text-sm">Read-only: overrides never edit original events.</p>
        <pre className="max-h-72 overflow-auto rounded-lg bg-slate-100 p-3 text-xs">{JSON.stringify({ original: profile.originalSubmissions, revisions: profile.revisions }, null, 2)}</pre>
      </details>
      <h3 className="mt-5 font-bold">Recommended interventions</h3>
      <p><strong>Primary:</strong> {profile.recommendation.primary.label}</p>
      <p><strong>Secondary:</strong> {profile.recommendation.secondary.label}</p>
      <p className="text-sm">{profile.recommendation.explanation}</p>
      <h3 className="mt-5 font-bold">Guided practice history · this browser only</h3>
      {storageWarning && <p role="status">This browser could not read practice history.</p>}
      {records.length ? <ul className="mt-2 list-disc pl-5">{records.map(record => <li key={record.runId}>
        {activities.find(item => item.id === record.activityId)?.title ?? record.activityId} · {record.completedAt ? "Quest completed" : "In progress"} ·
        {" "}{record.attempts.length} attempts · {record.hintHistory?.length ?? record.hints.length} hints
        {record.notes ? ` · Teacher observation: ${record.notes}` : ""}
      </li>)}</ul> : <p>No local practice records for this learner.</p>}
      <p className="mt-2 text-sm">Practice and quest completion do not establish mastery. Recordings are not archived by this demo server; replay is available only during the original assessment workflow.</p>
      <form className="mt-5 rounded-lg border border-violet-200 p-3" onSubmit={async event => {
        event.preventDefault(); if (!profile || !reason.trim() || saving) return;
        setSaving(true); setMessage("");
        try {
          await saveTeacherOverride({ learnerId: profile.learnerId, sessionId,
            why: reason.trim(), primaryActivityId: overrideActivity });
          setReason(""); setMessage("Recommendation override saved; original scoring evidence is unchanged."); refresh();
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the override."); }
        finally { setSaving(false); }
      }}>
        <h3 className="font-bold">Override recommended primary activity</h3>
        <p className="text-sm">Changes the recommendation for this session only; does not change assessment results.</p>
        <label className="field mt-2">Selected activity<select value={overrideActivity} onChange={event => setOverrideActivity(event.target.value)}>
          {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>
        <label className="field mt-2">Required educator reason<textarea className="rounded-lg border border-slate-400 p-2" maxLength={240}
          required value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="submit" className="button primary mt-2" disabled={saving || !reason.trim()}>{saving ? "Saving…" : "Save teacher override"}</button>
        <p role="status">{message}</p>
      </form>
    </>}
  </section>;
}
