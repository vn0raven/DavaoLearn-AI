import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, Skill } from '../models';
import { request } from '../api';
import { Icon } from '../Icons';
import {
  activities, feedback, hintLevel, hintText, nextStep, recordAttempt, selectActivity, startPractice, useHint,
} from './activity';
import type { Activity, PracticeRun } from './activity';
import { questFor, progressFor, zones } from './quests';
import { readPractice, savePractice } from './storage';

const names: Record<Skill, string> = { phonics: 'Phonics', oral: 'Read aloud', comprehension: 'Comprehension' };
const art: Record<Skill, string> = { phonics: '🔤', oral: '📖', comprehension: '🧩' };
const time = () => new Date().toISOString();

function loadCached(learnerId: string): PracticeRun[] {
  try { return readPractice(window.localStorage, learnerId); } catch { return []; }
}

function pickActivity(profile: Profile | null, skill: Skill, records: PracticeRun[]): Activity | undefined {
  const tier = profile?.selectedTiers?.[skill] ?? (skill === 'phonics' ? 'CVCC-final-nt' : 'short-text');
  const used = records.filter(r => r.completedAt).map(r => r.activityId);
  const plans = [profile?.recommendation?.primary, profile?.recommendation?.secondary];
  for (const plan of plans) {
    if (!plan || (plan.skill && plan.skill !== skill)) continue;
    const chosen = selectActivity(plan, {phonics: 'CVCC-final-nt', oral: 'short-text', comprehension: 'short-text', ...profile?.selectedTiers}, used);
    if (chosen?.skill === skill) return chosen;
  }
  const choices = activities.filter(a => a.skill === skill && a.difficultyTier === tier);
  return choices.find(a => !used.includes(a.id)) ?? choices[0];
}

/** Guided activities only. These records never count as scored assessment evidence. */
export function PracticeJourney({ learnerId, sessionId, profile, onAssessment }: {
  learnerId: string; sessionId: string; profile: Profile | null; onAssessment: (skill: Skill) => void;
}) {
  const [records, setRecords] = useState<PracticeRun[]>([]);
  const [run, setRun] = useState<PracticeRun | null>(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [focus, setFocus] = useState(false);
  const [word, setWord] = useState('');
  const [syncState, setSyncState] = useState<'ok' | 'pending' | 'error'>('ok');
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());
  const latestEdit = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let mounted = true;
    setReady(false);
    const local = loadCached(learnerId);
    setRecords(local);
    request<PracticeRun[]>('/api/student/practice').then(remote => {
      if (!mounted) return;
      // Never overwrite a locally completed run with a stale server snapshot.
      const merged = new Map(remote.map(r => [r.runId, r]));
      for (const pending of local) {
        const saved = merged.get(pending.runId);
        if (!saved || (pending.completedAt && !saved.completedAt) ||
            pending.attempts.length > saved.attempts.length ||
            (pending.hintHistory?.length ?? 0) > (saved.hintHistory?.length ?? 0)) {
          merged.set(pending.runId, pending);
        }
      }
      const all = [...merged.values()];
      setRecords(all);
      try { for (const item of all) savePractice(window.localStorage, item); } catch { /* local cache is optional */ }
      setReady(true);
    }).catch(() => {
      if (mounted) { setReady(true); setNotice('Practice progress could not be loaded from the server. Your local copy is available on this device.'); }
    });
    return () => { mounted = false; };
  }, [learnerId]);

  useEffect(() => { if (run) headingRef.current?.focus(); }, [run?.runId, run?.step, run?.completedAt]);

  function persist(next: PracticeRun) {
    setRun(next);
    setRecords(before => [...before.filter(r => r.runId !== next.runId), next]);
    try { savePractice(window.localStorage, next); } catch {
      setNotice('Local browser backup is unavailable. Your progress will still be sent to the server.');
    }
    setSyncState('pending');
    const edit = ++latestEdit.current;
    // Sequential saves prevent a late network response from overwriting a newer step.
    sendQueue.current = sendQueue.current.catch(() => undefined).then(async () => {
      await request(`/api/student/practice/${next.runId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(next),
      });
      if (edit === latestEdit.current) setSyncState('ok');
    }).catch(() => {
      if (edit === latestEdit.current) setSyncState('error');
      setNotice('Could not sync this practice run. It is saved in this browser; use Retry sync before closing.');
    });
  }

  function begin(activity: Activity) {
    setNotice(''); setWord('');
    persist(startPractice(activity, {learnerId, sessionId}, crypto.randomUUID(), time()));
  }

  function resume(record: PracticeRun) { setRun(record); setWord(''); setNotice(''); }

  function retry() {
    if (!run) return;
    persist(run);
  }

  const active = activities.find(a => a.id === run?.activityId && a.version === run.contentVersion);
  const stats = useMemo(() => progressFor(records), [records]);
  const completedUnique = new Set(records.filter(r => r.completedAt).map(r => r.activityId));
  const resumed = [...records].reverse().find(r => !r.completedAt && activities.some(a => a.id === r.activityId));
  const step = active && run ? active.steps[run.step] : undefined;
  const final = step && run && active ? feedback(run, active) : undefined;
  const doneStep = Boolean(run && run.attempts.some(a => a.step === run.step && a.correct !== false));
  const suggested = profile?.recommendation?.primary;
  const recommended = suggested ? selectActivity(suggested, {
    phonics: 'CVCC-final-nt', oral: 'short-text', comprehension: 'short-text', ...profile?.selectedTiers,
  }, records.filter(r => r.completedAt).map(r => r.activityId)) : undefined;

  return <section id="journey" className={`panel dashboard-panel quest-panel ${largeText?'quest-large':''} ${contrast?'quest-contrast':''} ${focus && run?'quest-focus':''}`} aria-label="Guided reading quests">
    <div className="dashboard-panel-heading quest-heading"><div className="section-title"><span className="section-icon"><Icon name="target"/></span><div><h2>My Reading Journey <span aria-hidden="true">✨</span></h2><p className="subtle">Explore learning quests based on your reading needs. Practising is different from taking an assessment.</p></div></div>
      <div className="quest-metrics"><span title="Unique reading quests completed"><strong>★ {completedUnique.size}</strong> quest stars</span><span><strong>{completedUnique.size * 25} XP</strong> practice points</span><span><strong>{stats.activitiesCompleted}</strong> sessions completed</span></div>
    </div>
    <div className="quest-tools" aria-label="Reading accessibility settings"><span className="subtle">Reading settings</span>
      <button type="button" aria-pressed={largeText} className="button quiet-button" onClick={()=>setLargeText(v=>!v)}>Aa Larger text</button>
      <button type="button" aria-pressed={contrast} className="button quiet-button" onClick={()=>setContrast(v=>!v)}>High contrast</button>
      <button type="button" aria-pressed={focus} className="button quiet-button" onClick={()=>setFocus(v=>!v)}>Focus reading</button>
    </div>
    {!ready && <p role="status" className="subtle mt-3">Loading your reading journey…</p>}
    {notice && <p role="status" className="quest-notice mt-3">{notice}</p>}
    {syncState === 'pending' && <p role="status" className="subtle mt-2">Saving practice progress…</p>}
    {syncState === 'error' && run && <button className="button quiet-button mt-2" onClick={retry}><Icon name="refresh" size={16}/> Retry sync</button>}
    {!run ? <>
      {recommended && <div className="quest-recommended"><span className="quest-highlight-icon" aria-hidden="true">🌟</span><div><strong>Suggested next quest: {recommended.title}</strong><p>Chosen from your teacher-validated reading plan. You can also explore the other areas below.</p></div><button className="button primary" onClick={()=>begin(recommended)}>Start suggested quest <Icon name="arrow" size={17}/></button></div>}
      {resumed && <div className="quest-resume"><div><strong>Continue your unfinished quest</strong><p>{activities.find(a=>a.id===resumed.activityId)?.title} · Step {resumed.step+1}</p></div><button className="button quiet-button" onClick={()=>resume(resumed)}>Resume quest <Icon name="arrow" size={16}/></button></div>}
      <div className="quest-zones">
        {zones.map((zone, index) => {
          const choices = activities.filter(a => a.skill === zone.skill);
          const complete = choices.filter(a => completedUnique.has(a.id)).length;
          const next = pickActivity(profile, zone.skill, records);
          return <article className={`quest-zone quest-zone-${zone.skill}`} key={zone.skill}>
            <div className="quest-zone-top"><span className="quest-zone-art" aria-hidden="true">{art[zone.skill]}</span><span className="quest-zone-progress">★ {complete}/{choices.length}</span></div>
            <span className="eyebrow">Area {index+1} · {names[zone.skill]}</span><h3>{zone.name}</h3><p>{zone.description}</p>
            <div className="quest-mini-progress" role="progressbar" aria-label={`${zone.name} quest progress`} aria-valuemin={0} aria-valuemax={choices.length} aria-valuenow={complete}><span style={{width:`${100*complete/choices.length}%`}}/></div>
            <p className="quest-next">{next ? `Next: ${next.title}` : 'Ask your teacher for activities at your level.'}</p>
            <button className="button primary" disabled={!next || !ready} onClick={()=>next&&begin(next)}>Play a quest <Icon name="arrow" size={17}/></button>
          </article>;
        })}
      </div>
      {completedUnique.size > 0 && <details className="quest-history"><summary>My practice badges</summary>
        <div className="quest-badges">{[
          {label:'First Quest',icon:'🌟',earned:completedUnique.size>=1},
          {label:'Word Explorer',icon:'🔤',earned:records.some(r=>r.skill==='phonics'&&r.completedAt)},
          {label:'Story Adventurer',icon:'📚',earned:records.some(r=>r.skill==='oral'&&r.completedAt)},
          {label:'Meaning Detective',icon:'🧩',earned:records.some(r=>r.skill==='comprehension'&&r.completedAt)},
          {label:'Three-Skill Explorer',icon:'🏅',earned:new Set(records.filter(r=>r.completedAt).map(r=>r.skill)).size===3},
        ].map(b=><span key={b.label} className={`quest-badge ${b.earned?'earned':''}`} aria-label={`${b.label}: ${b.earned?'earned':'not yet earned'}`}>{b.icon} {b.label} {b.earned?'✓':'○'}</span>)}</div>
        <p className="subtle mt-2">Badges and XP celebrate practice participation, not reading ability.</p>
      </details>}
      {stats.activitiesCompleted > 0 && <details className="quest-history"><summary>My practice history ({stats.activitiesCompleted})</summary><ul>{records.filter(r=>r.completedAt).slice(-8).reverse().map(item=><li key={item.runId}><strong>{activities.find(a=>a.id===item.activityId)?.title??item.activityId}</strong><span>{new Date(item.completedAt!).toLocaleString()}</span></li>)}</ul></details>}
      <p className="quest-disclaimer">Quest stars, practice XP, and badges reward participation and completed activities only. They are <strong>not grades, verified reading scores, or certificates of mastery</strong>. Only teacher-reviewed assessment evidence changes your skill status.</p>
    </> : active && step ? <div className="quest-workspace">
      <div className="quest-workspace-head"><button className="button quiet-button" onClick={()=>setRun(null)}>← Back to my journey</button><span className="pill-status">{names[active.skill]} · Guided practice</span></div>
      <div className="quest-workspace-intro"><span className="quest-zone-art" aria-hidden="true">{art[active.skill]}</span><div><p className="eyebrow">{questFor(active).zone} · {active.difficultyTier}</p><h3 ref={headingRef} tabIndex={-1}>{active.title}</h3><p>{active.instructions}</p></div></div>
      {run.completedAt ? <div className="quest-complete" role="status"><span aria-hidden="true">🏅</span><h3>Quest completed!</h3><p>You earned a practice star for this activity. You can repeat it anytime.</p><p>{run.attempts.length} attempts · {run.hintHistory?.length??0} hints used</p>
        <div className="quest-footer-actions"><button className="button primary" onClick={()=>onAssessment(active.skill)}>Choose a reading assessment <Icon name="arrow" size={17}/></button><button className="button quiet-button" onClick={()=>setRun(null)}>Return to quest map</button></div><p className="subtle">Your teacher still needs to validate any assessment results. Reusing an assessment form may not count as fresh evidence.</p></div> : <>
        <div className="quest-step-line"><strong>Step {run.step+1} of {active.steps.length}</strong><span>{Math.round(100*(run.step+1)/active.steps.length)}% of steps</span></div>
        <div className="progress-track"><div style={{width:`${100*(run.step+1)/active.steps.length}%`}}/></div>
        {active.passage?.length ? <div className="quest-reading-passage" aria-label="Practice reading passage">{active.passage.map((line,i)=><p key={i} className={final?.line === i ? 'quest-evidence-line' : ''}>{line}</p>)}</div> : null}
        {active.wordCues?.length ? <div className="quest-word-cues"><strong>Word clues</strong><div className="quest-cue-buttons">{active.wordCues.map(c=><button className="button quiet-button" key={c.word} aria-pressed={word===c.word} onClick={()=>setWord(c.word)}>{c.word}</button>)}</div>{word && <p role="status">{active.wordCues.find(c=>c.word===word)?.cue}</p>}</div> : null}
        <div className="quest-step"><h4>{step.prompt}</h4>{step.kind === 'guide' ? <><p className="quest-cue">{step.cue}</p>{!doneStep && <button className="button primary" onClick={()=>persist(recordAttempt(run,active,'guided'))}>{step.action} <Icon name="check" size={17}/></button>}</> : <div className="quest-options">{step.options.map((choice,i)=><button type="button" key={i} className="quest-choice" disabled={doneStep} onClick={()=>persist(recordAttempt(run,active,i))}>{choice}</button>)}</div>}
          {!doneStep && hintLevel(run)<3 && <button className="button quiet-button quest-hint" onClick={()=>persist(useHint(run,active))}>💡 Get hint {hintLevel(run)+1} of 3</button>}
          {hintText(run, active) && <div className="quest-feedback" role="status"><strong>Hint {hintLevel(run)}</strong><p>{hintText(run,active)}</p></div>}
          {final && <div className={`quest-feedback ${final.correct?'positive':'try-again'}`} role="status"><strong>{final.correct?'Correct! Great work.':'Try again — you can do it!'}</strong><p>{final.text}</p>{!final.correct && run.attempts.at(-1)?.errorCategory && <p>Practice feedback: {run.attempts.at(-1)?.errorCategory?.replaceAll('-', ' ')}</p>}</div>}
          {doneStep && <button className="button primary mt-3" onClick={()=>persist(nextStep(run,active,time()))}>{run.step+1===active.steps.length?'Finish quest ★':'Next step'} <Icon name="arrow" size={17}/></button>}
        </div>
        <label className="field quest-note">Teacher or learner note (optional)<input maxLength={240} value={run.notes} onChange={e=>persist({...run,notes:e.target.value})} placeholder="What was helpful today?"/></label>
        <div className="quest-footer-actions"><button className="button quiet-button" onClick={()=>setRun(null)}>Pause and return to map</button><span className="subtle">Help is allowed here. This is not a test.</span></div>
      </>}
    </div> : <div role="alert" className="quest-notice">The activity content is unavailable. Please return to the quest map. <button className="button" onClick={()=>setRun(null)}>Return</button></div>}
  </section>;
}
