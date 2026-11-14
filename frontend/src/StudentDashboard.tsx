import { useEffect, useMemo, useRef, useState } from 'react';
import { request } from './api';
import type { ComprehensionForm, Form, Passage, Profile, Provisional, Skill, Slot, Submission } from './models';
import { useRecording } from './useRecording';
import { Icon } from './Icons';
import { PracticeJourney } from './practice/PracticeJourney';

type Activity = {formId:string; title:string; skill:'phonics' | 'oral'; prompts:string[]};
const title = (skill: Skill) => skill === 'oral' ? 'Read aloud' : skill === 'phonics' ? 'Phonics' : 'Reading comprehension';
const notice = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';

function Playback({blob, label}:{blob:Blob;label:string}) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <audio controls src={url} aria-label={label} preload="metadata"/>;
}

function PreliminaryResults({preview, validated}: {preview:Provisional|null; validated:boolean}) {
  if (!preview) return <p className="subtle">Automatic results haven't been checked yet.</p>;
  return <div className="feedback-block">
    <p className="subtle"><strong>{validated ? 'Automatic estimate — separate from the final teacher marks above.' : 'Automatic feedback only — not teacher-validated.'}</strong></p>
    {preview.message && <p role="status">{preview.message}</p>}
    <div className="feedback-list">{preview.items.map((item, i) => {
      const flag = item.correct === true || item.verdict === 'LIKELY_CORRECT' ? 'Correct (tentative)' :
        item.correct === false || item.verdict === 'LIKELY_INCORRECT' ? 'Needs practice (tentative)' : 'Not determined';
      return <div className="feedback-row" key={i}><strong>{item.word ?? `Question ${i+1}`}</strong><span className="subtle">{item.heard ? `Heard: ${item.heard}` : ''}</span><span className={flag.startsWith('Correct') ? 'status-ok' : flag.startsWith('Needs') ? 'status-low' : 'status-wait'}>{flag}</span></div>;
    })}</div>
  </div>;
}

function Submissions({items, refresh, inspect}: {items:Submission[];refresh:()=>void;inspect:(item:Submission)=>void}) {
  return <section className="panel dashboard-panel submitted-panel" id="submissions"><div className="dashboard-panel-heading"><div className="section-title"><span className="section-icon"><Icon name="clipboard"/></span><div><h2>My submitted assessments</h2><p className="subtle">View your teacher-reviewed results and saved attempts.</p></div></div><button className="button quiet-button" onClick={refresh}><Icon name="refresh" size={17}/> Refresh results</button></div>
    {!items.length && <div className="empty-results"><span className="empty-art"><Icon name="clipboard" size={54}/></span><div><h3>No results yet</h3><p className="subtle">Your submitted assessments will appear here after you send them to your teacher.</p></div></div>}
    <div className="submission-list">{items.map(item => <button className="submission-row" key={item.id} onClick={() => inspect(item)}>
      <span><strong>{title(item.skill)}</strong><small>{item.form} · {new Date(item.created_at).toLocaleString()}</small></span>
      <span className={item.result ? 'pill-status ready' : 'pill-status unconfirmed'}>{item.result ? `Validated · ${item.result.event.correct}/${item.result.event.total}` : 'Pending teacher review'}</span>
    </button>)}</div>
  </section>;
}

function RecordTest({activity, session, onSent, onBack}: {activity:Activity;session:string;onSent:(id:string)=>void;onBack:()=>void}) {
  const [index,setIndex] = useState(0);
  const [takes,setTakes] = useState<Blob[][]>(() => activity.prompts.map(() => []));
  const [sending,setSending] = useState(false);
  const [error,setError] = useState('');
  const recorder = useRecording(activity.formId, '', activity.skill);
  const busy = recorder.phase === 'recording' || recorder.phase === 'opening';
  const lastSaved = useRef<string|null>(null);
  const current = takes[index];
  useEffect(() => {
    if (!recorder.attempt || lastSaved.current === recorder.attempt.id) return;
    lastSaved.current = recorder.attempt.id;
    setTakes(old => old.map((clips, position) => position !== index ? clips : clips.length < 3 ? [...clips, recorder.attempt!.blob] : clips));
  }, [recorder.attempt, index]);
  async function submit() {
    if (busy || sending || takes.some(list => list.length === 0)) return;
    setSending(true); setError('');
    const id = crypto.randomUUID();
    const data = new FormData();
    const slots:number[][] = [];
    data.set('attempt',id); data.set('session',session); data.set('form',activity.formId);
    takes.forEach((clips,prompt) => clips.forEach((clip,position) => {
      slots.push([prompt,position+1]);
      data.append('clips',clip,`prompt-${prompt+1}-take-${position+1}.webm`);
    }));
    data.set('slots',JSON.stringify(slots));
    try { await request('/api/recording-submissions',{method:'POST',body:data}); onSent(id); }
    catch(error) { setError(notice(error)); setSending(false); }
  }
  return <main className="lesson-home">
    <div className="spread"><div><p className="eyebrow">{title(activity.skill)} assessment</p><h1>{activity.title}</h1></div><button className="button" disabled={busy || sending} onClick={onBack}>Back to lessons</button></div>
    <section className="panel padded mt-4">
      <div className="spread"><strong>{activity.skill === 'phonics' ? `Word ${index+1} of ${activity.prompts.length}` : 'Read the entire passage'}</strong><span className="counter">{current.length}/3 attempts saved</span></div>
      <div className="progress-track"><div style={{width:`${100*(index+1)/activity.prompts.length}%`}} /></div>
      <div className={activity.skill === 'phonics' ? 'student-word' : 'story-words'}>{activity.prompts[index]}</div>
      <p className="subtle mt-3">You may record up to three times. <strong>Every take is submitted to your teacher</strong>, not just your last one.</p>
      <div className="record-actions mt-4">
        {recorder.phase === 'recording' ? <button className="button primary" onClick={recorder.stop}>■ Stop recording</button> :
         <button className="button primary" disabled={busy || sending || current.length >= 3} onClick={() => void recorder.start()}>● {current.length ? 'Record another attempt' : 'Start recording'}</button>}
        <span role="status">{recorder.phase === 'opening' ? 'Waiting for microphone permission…' : recorder.phase === 'recording' ? 'Recording…' : recorder.message}</span>
      </div>
      <div className="take-grid mt-4">{current.map((clip,n) => <div className="take-card" key={n}><strong>Attempt {n+1}</strong><Playback blob={clip} label={`Attempt ${n+1} for prompt ${index+1}`}/></div>)}</div>
      <div className="spread mt-4">
        <button className="button" disabled={busy || sending || index === 0} onClick={() => {recorder.clear();setIndex(i => i-1);}}>Previous</button>
        {index < activity.prompts.length-1 ? <button className="button primary" disabled={busy || sending || !current.length} onClick={() => {recorder.clear();setIndex(i => i+1);}}>Next →</button> :
        <button className="button primary" disabled={busy || sending || takes.some(list => !list.length)} onClick={() => void submit()}>{sending ? 'Submitting all attempts…' : 'Submit all recordings'}</button>}
      </div>
      {error && <p role="alert" className="error-message mt-3">{error}</p>}
    </section>
  </main>;
}

function ComprehensionTest({session,onSent,onBack}: {session:string;onSent:(id:string)=>void;onBack:()=>void}) {
  const [forms,setForms] = useState<ComprehensionForm[]>([]);
  const [selected,setSelected] = useState('');
  const [index,setIndex] = useState(0);
  const [answers,setAnswers] = useState<Record<string,string>>({});
  const [assisted,setAssisted] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {request<ComprehensionForm[]>('/api/comprehension/forms').then(items => {setForms(items);setSelected(items[0]?.formId ?? '');}).catch(err => setError(notice(err)));},[]);
  const form = forms.find(item => item.formId === selected);
  async function submit() {
    if (!form || Object.keys(answers).length !== form.questions.length || loading) return;
    setError('');setLoading(true);
    const id = crypto.randomUUID();
    try {
      await request('/api/comprehension/submissions',{method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({
        attemptId:id,sessionId:session,formId:form.formId,assisted,
        responses:form.questions.map(q => ({questionId:q.questionId, answerId:answers[q.questionId]})),
      })}); onSent(id);
    } catch(err) {setError(notice(err));setLoading(false);}
  }
  const question = form?.questions[index];
  return <main className="lesson-home">
    <div className="spread"><div><p className="eyebrow">Reading comprehension</p><h1>Understand the story</h1></div><button className="button" disabled={loading} onClick={onBack}>Back to lessons</button></div>
    {error && <p role="alert" className="error-message mt-4">{error}</p>}
    {form ? <section className="panel padded mt-4">
      <label className="field">Select a story <select value={selected} onChange={e => {setSelected(e.target.value);setIndex(0);setAnswers({});}} disabled={loading}>{forms.map(item => <option value={item.formId} key={item.formId}>{item.title}</option>)}</select></label>
      <h2 className="mt-4">{form.title}</h2><p className="story-words">{form.text}</p>
      <div className="progress-track mt-4"><div style={{width:`${100*(index+1)/form.questions.length}%`}} /></div>
      <fieldset className="mt-4" disabled={loading}><legend><strong>Question {index+1} of {form.questions.length}: {question?.prompt}</strong></legend>
        {question?.choices.map(choice => <label className="answer-choice" key={choice.answerId}><input type="radio" name={question.questionId} checked={answers[question.questionId]===choice.answerId} onChange={() => setAnswers(old => ({...old,[question.questionId]:choice.answerId}))}/>{choice.text}</label>)}
      </fieldset>
      <div className="spread mt-4"><button className="button" disabled={!index||loading} onClick={() => setIndex(i=>i-1)}>Previous</button>
        {index<form.questions.length-1?<button className="button primary" disabled={!answers[question!.questionId]||loading} onClick={() => setIndex(i=>i+1)}>Next →</button>:<button className="button primary" disabled={Object.keys(answers).length!==form.questions.length||loading} onClick={()=>void submit()}>{loading?'Submitting…':'Submit answers'}</button>}
      </div><label className="checkbox-line mt-3"><input type="checkbox" checked={assisted} onChange={e=>setAssisted(e.target.checked)}/>I received help while reading.</label>
      <p className="subtle mt-3">Answers receive tentative feedback after submission. A teacher confirms the official score.</p>
    </section> : <p role="status" className="mt-4">Loading comprehension activities…</p>}
  </main>;
}

function LearningPlan({profile}: {profile:Profile|null}) {
  const primary = profile?.recommendation?.primary;
  return <section className="panel dashboard-panel learning-panel" id="practice"><div className="section-title"><span className="section-icon"><Icon name="target"/></span><div><h2>My next learning activity</h2><p className="subtle">Recommendations use teacher-validated evidence only.</p></div></div>
    <div className="learning-highlight"><span className="practice-art" aria-hidden="true">✦<Icon name="book" size={56}/></span><div className="learning-text"><h3 className="activity-heading">{primary?.label ?? 'Guided reading practice'}</h3>
    <p>{profile?.recommendation?.explanation ?? 'Read a short story with a trusted adult, practise the words, then ask your teacher for a reading check.'}</p>
    {profile?.recommendation?.secondary && <p className="mt-2"><strong>Try next:</strong> {profile.recommendation.secondary.label}</p>}
    <div className="learning-steps"><p><strong>1</strong> Read the target or story once.</p><p><strong>2</strong> Repeat slowly and listen to the sounds.</p><p><strong>3</strong> Explain or practise the difficult words.</p></div>
    <button className="button primary mt-3" onClick={()=>document.getElementById('journey')?.scrollIntoView({behavior:'smooth',block:'start'})}><Icon name="arrow" size={17}/> Explore guided quests</button></div></div>
  </section>;
}

export function StudentDashboard({learnerId, navigation}: {learnerId:string; navigation?:{target:string;version:number}}) {
  const [skill,setSkill] = useState<Skill|null>(null);
  const [activity,setActivity] = useState<Activity|null>(null);
  const [forms,setForms] = useState<Form[]>([]);
  const [passages,setPassages] = useState<Passage[]>([]);
  const [session,setSession] = useState(() => crypto.randomUUID());
  const [submissions,setSubmissions] = useState<Submission[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [selected,setSelected] = useState<Submission|null>(null);
  const [slots,setSlots] = useState<Slot[]>([]);
  const [loadingPreview,setLoadingPreview] = useState(false);
  const [error,setError] = useState('');
  async function refresh() {
    try {const [items,p]=await Promise.all([request<Submission[]>('/api/student/submissions'),request<Profile>('/api/student/profile')]);setSubmissions(items);setProfile(p); if(selected) setSelected(items.find(s=>s.id===selected.id)??null);}
    catch(err) {setError(notice(err));}
  }
  useEffect(()=>{void refresh();Promise.all([request<Form[]>('/api/forms'),request<Passage[]>('/api/passages')]).then(([f,p])=>{setForms(f);setPassages(p);}).catch(err=>setError(notice(err)));},[]);
  async function inspect(item:Submission) {
    setSelected(item);setSlots([]);setError('');
    if(item.skill!=='comprehension') try {setSlots(await request<Slot[]>(`/api/student/submissions/${item.id}/slots`));}catch(err){setError(notice(err));}
  }
  async function estimate(item:Submission) {
    setLoadingPreview(true);setError('');
    try {await request(`/api/student/submissions/${item.id}/estimate`,{method:'POST'});await refresh();}
    catch(err){setError(notice(err));}finally{setLoadingPreview(false);}
  }
  function sent(id:string) {setSkill(null);setActivity(null);void refresh().then(async()=>{
    try {const items=await request<Submission[]>('/api/student/submissions'); const item=items.find(s=>s.id===id);if(item)await inspect(item);}catch{};
  });}
  useEffect(() => {
    if (!navigation) return;
    setActivity(null); setSkill(null);
    const frame = window.requestAnimationFrame(() => document.getElementById(navigation.target)?.scrollIntoView({behavior:'smooth',block:'start'}));
    return () => window.cancelAnimationFrame(frame);
  }, [navigation]);
  if(activity) return <RecordTest key={`${activity.formId}-${session}`} activity={activity} session={session} onSent={sent} onBack={()=>setActivity(null)}/>;
  if(skill==='comprehension') return <ComprehensionTest key={session} session={session} onSent={sent} onBack={()=>setSkill(null)}/>;
  return <main className="lesson-home litera-student-home" id="home">
    <section className="litera-hero learner-hero"><div className="hero-copy"><p className="eyebrow">Grade 3 English · Learner dashboard</p><h1>{skill ? title(skill) : 'Welcome to your reading space!'} <span aria-hidden="true">👋</span></h1><p>Learn, record and practise at your own pace. Your teacher validates the official results.</p></div><div className="hero-actions"><button className="button" onClick={()=>{setSession(crypto.randomUUID());setError('');}}>New session</button></div><div className="hero-illustration" aria-hidden="true"/></section>
    {error && <p className="error-message mt-3" role="alert">{error}</p>}
    {skill? <section className="panel padded mt-4"><div className="spread"><h2>Choose an assessment</h2><button className="button" onClick={()=>setSkill(null)}>← Back to dashboard</button></div><p className="subtle mt-2">Record between one and three takes for each word or passage.</p>
      {(skill==='phonics'?forms.map(form=>({formId:form.formId,title:`Phonics · ${form.formId}`,skill:'phonics' as const,prompts:form.items.map(i=>i.word)})):
        passages.map(p=>({formId:p.formId,title:p.title,skill:'oral' as const,prompts:[p.text]}))).map(item=><button className="button primary mr-2 mt-3" key={item.formId} onClick={()=>setActivity(item)}>{item.title}<Icon name="arrow" size={17}/></button>)}
    </section>:<div className="student-dashboard-grid">
      <section className="panel dashboard-panel lessons-panel" id="lessons"><div className="section-title"><span className="section-icon"><Icon name="book"/></span><div><h2>Your reading lessons</h2><p className="subtle">Choose an activity to practise and build your skills.</p></div></div>
        <div className="lesson-grid">
          <article className="lesson-card read-card"><span className="lesson-icon"><Icon name="mic" size={27}/></span><h3>Read aloud</h3><p>Read a short story. Save up to three recordings.</p><span className="card-doodle" aria-hidden="true">📖</span><button className="button primary" onClick={()=>setSkill('oral')}>Choose a story <Icon name="arrow" size={17}/></button></article>
          <article className="lesson-card phonics-card"><span className="lesson-icon" aria-hidden="true">Aa</span><h3>Phonics</h3><p>Practise five target words, with up to three takes each.</p><span className="card-doodle" aria-hidden="true">🔤</span><button className="button primary" onClick={()=>setSkill('phonics')}>Open phonics <Icon name="arrow" size={17}/></button></article>
          <article className="lesson-card comprehension-card"><span className="lesson-icon"><Icon name="question" size={27}/></span><h3>Comprehension</h3><p>Read and answer questions about the story.</p><span className="card-doodle" aria-hidden="true">📝</span><button className="button primary" onClick={()=>setSkill('comprehension')}>Read and answer <Icon name="arrow" size={17}/></button></article>
        </div>
      </section>
      <section className="panel dashboard-panel progress-panel" id="progress"><div className="dashboard-panel-heading"><div className="section-title"><span className="section-icon"><Icon name="chart"/></span><h2>My verified skill progress</h2></div><span className="small-hint">Teacher-validated only</span></div>
        <div className="skill-stack">{(['phonics','oral','comprehension'] as Skill[]).map(name=>{const state=profile?.skills.find(s=>s.skill===name);return <div className="skill-tile" key={name}><span className="skill-symbol"><Icon name={name==='phonics'?'book':name==='oral'?'mic':'question'} size={23}/></span><strong>{title(name)}</strong><span className="skill-score">{state?.latestUsableScore===null||state?.latestUsableScore===undefined?'—':`${state.latestUsableScore}%`}</span><span className={`pill-status ${state?.status==='READY'?'ready':state?.status==='SUPPORT'?'support':'unconfirmed'}`}>{state?.status??'UNCONFIRMED'}</span></div>;})}</div>
      </section>
      <LearningPlan profile={profile}/>
      <Submissions items={submissions} refresh={()=>void refresh()} inspect={item=>void inspect(item)}/>
      <PracticeJourney learnerId={learnerId} sessionId={session} profile={profile} onAssessment={setSkill} navigationVersion={navigation?.version}/>
    </div>}

    {selected && <div role="dialog" aria-modal="true" aria-label="Submitted assessment details" className="modal-screen" onClick={()=>setSelected(null)}><section className="panel modal-panel" onClick={event=>event.stopPropagation()}>
      <div className="spread"><h2>{title(selected.skill)} results</h2><button aria-label="Close details" className="button" onClick={()=>setSelected(null)}>Close ✕</button></div>
      <p className="subtle mt-2">{selected.form} · {new Date(selected.created_at).toLocaleString()}</p>
      <p className={selected.result?'status-ok mt-2':'status-wait mt-2'}>{selected.result?'Teacher-validated':'Awaiting teacher validation'}</p>
      {selected.result && <div className="score-banner">Final result: {selected.result.event.correct} of {selected.result.event.total} correct ({Math.round(selected.result.event.correct/selected.result.event.total*100)}%)</div>}
      {selected.result?.note && <p className="mt-2"><strong>Teacher note:</strong> {selected.result.note}</p>}
      {selected.result?.marks && <div className="feedback-list mt-3">{selected.result.marks.map((mark,i)=><div className="feedback-row" key={i}><strong>{selected.skill==='comprehension'?`Question ${i+1}`:`Item ${i+1}`}</strong><span className={mark==='CORRECT'?'status-ok':'status-low'}>{mark==='CORRECT'?'Correct':'Needs practice'}</span></div>)}</div>}
      {selected.skill!=='comprehension' && <><h3 className="mt-4">Saved recordings ({slots.length})</h3><div className="take-grid mt-2">{slots.map(slot=><div className="take-card" key={`${slot.prompt}-${slot.take}`}><strong>{selected.skill==='phonics'?`Word ${slot.prompt+1}`:'Passage'} · Attempt {slot.take}</strong><StoredAudio submission={selected.id} prompt={slot.prompt} take={slot.take}/></div>)}</div></>}
      {!selected.provisional && selected.skill!=='comprehension' && <button className="button primary mt-3" disabled={loadingPreview} onClick={()=>void estimate(selected)}>{loadingPreview?'Checking speech…':'Check tentative right/wrong results'}</button>}
      <PreliminaryResults preview={selected.provisional} validated={!!selected.result}/>
      <p className="subtle mt-3">Speech recognition can make mistakes. Only your teacher's validation determines the official score.</p>
    </section></div>}
  </main>;
}

function StoredAudio({submission,prompt,take}:{submission:string;prompt:number;take:number}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{const controller=new AbortController();let object=''; fetch(`/api/student/submissions/${submission}/audio/${prompt}/${take}`,{signal:controller.signal}).then(resp=>{if(!resp.ok)throw new Error('Audio unavailable');return resp.blob();}).then(blob=>{if(controller.signal.aborted)return;object=URL.createObjectURL(blob);setUrl(object);}).catch(()=>{});return()=>{controller.abort();if(object)URL.revokeObjectURL(object);};},[submission,prompt,take]);
  return url?<audio controls preload="metadata" src={url}/>:<p className="subtle">Loading audio…</p>;
}
