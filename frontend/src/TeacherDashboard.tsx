import { useEffect, useState } from 'react';
import { request } from './api';
import type { ComprehensionForm, Form, Mark, Passage, Profile, Slot, Submission, Skill } from './models';
import { Icon } from './Icons';
import { activities as questActivities } from './practice/activity';
import type { PracticeRun } from './practice/activity';

const label = (skill: Skill) => skill === 'phonics' ? 'Phonics' : skill === 'oral' ? 'Read aloud' : 'Comprehension';
const describe = (error:unknown) => error instanceof Error ? error.message : 'Could not complete request.';
const headersFor = (key:string) => ({'X-Teacher-Key':key});
const wordsOf = (text:string) => text.match(/[^\W\d_]+(?:[’'-][^\W\d_]+)*/gu) ?? [];

export function TeacherDashboard() {
  const [key,setKey] = useState('');
  const [access,setAccess] = useState('');
  const [items,setItems] = useState<Submission[]>([]);
  const [selected,setSelected] = useState<Submission|null>(null);
  const [forms,setForms] = useState<Form[]>([]);
  const [passages,setPassages] = useState<Passage[]>([]);
  const [comprehension,setComprehension] = useState<ComprehensionForm[]>([]);
  const [filter,setFilter] = useState('all');
  const [query,setQuery] = useState('');
  const [profile,setProfile] = useState<Profile|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  async function load(credential:string) {
    setError('');setBusy(true);
    try {
      const [list,forms,passages,comprehension] = await Promise.all([
        request<Submission[]>('/api/teacher/submissions',{headers:headersFor(credential)}),
        request<Form[]>('/api/teacher/forms',{headers:headersFor(credential)}).catch(()=>[] as Form[]),
        request<Passage[]>('/api/teacher/passages',{headers:headersFor(credential)}).catch(()=>[] as Passage[]),
        request<ComprehensionForm[]>('/api/teacher/comprehension/forms',{headers:headersFor(credential)}).catch(()=>[] as ComprehensionForm[]),
      ]);
      setItems(list);setForms(forms);setPassages(passages);setComprehension(comprehension);setAccess(credential);setKey('');
      if(selected) setSelected(list.find(s=>s.id===selected.id)??null);
    } catch(error) {setError(describe(error));}finally{setBusy(false);}
  }
  async function view(item:Submission) {
    setSelected(item);setProfile(null);
    try {setProfile(await request<Profile>(`/api/teacher/learners/${item.learner}/profile`,{headers:headersFor(access)}));}
    catch(error) {setError(describe(error));}
  }
  const filtered = items.filter(item => (filter==='all'||filter===item.status) &&
    `${item.learner} ${item.form} ${item.skill}`.toLowerCase().includes(query.toLowerCase()));
  const position = selected ? filtered.findIndex(s=>s.id===selected.id) : -1;
  return <main className="lesson-home teacher-area" id="teacher-home">
    <section className="litera-hero teacher-hero"><div className="hero-copy"><p className="eyebrow">Grade 3 English · Teacher dashboard</p><h1>Assessment review workspace</h1><p>Listen to learner attempts, validate scores, and guide the next reading activity.</p></div><div className="hero-illustration" aria-hidden="true"/></section>
    {error && <p className="error-message mt-3" role="alert">{error}</p>}
    {!access?<form className="panel padded teacher-login mt-4" onSubmit={event=>{event.preventDefault();void load(key);}}><div className="section-title"><span className="section-icon"><Icon name="lock"/></span><h2>Open your review workspace</h2></div><p className="subtle mt-2">Only teachers with the private access key can review and validate submissions.</p>
      <label className="field mt-3">Teacher access key<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required/></label>
      <button className="button primary mt-3" disabled={busy}><Icon name="lock" size={17}/>{busy?'Checking…':'Unlock dashboard'}</button>
    </form>:<>
      <div className="teacher-overview"><div className="teacher-stats">
        <div className="stat-tile"><span><Icon name="clipboard" size={17}/> Submissions</span><strong>{items.length}</strong></div>
        <div className="stat-tile"><span><Icon name="clock" size={17}/> Awaiting review</span><strong>{items.filter(x=>!x.result).length}</strong></div>
        <div className="stat-tile"><span><Icon name="check" size={17}/> Validated</span><strong>{items.filter(x=>!!x.result).length}</strong></div>
        <div className="stat-tile"><span><Icon name="users" size={17}/> Learners</span><strong>{new Set(items.map(s=>s.learner)).size}</strong></div>
      </div><div className="toolbar"><button className="button" disabled={busy} onClick={()=>void load(access)}><Icon name="refresh" size={17}/> Refresh</button><button className="button" onClick={()=>{setAccess('');setSelected(null);setProfile(null);setItems([]);}}><Icon name="lock" size={17}/> Lock</button></div></div>
      <div className="teacher-columns"><section className="panel dashboard-panel queue-panel" id="queue">
        <div className="section-title"><span className="section-icon"><Icon name="clipboard"/></span><div><h2>Assessment queue</h2><p className="subtle">Review learner submissions.</p></div></div>
        <label className="field mt-3">Search learner or activity<div className="input-with-icon"><Icon name="search" size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Learner ID, phonics, story…"/></div></label>
        <label className="field mt-3">Review status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All submissions</option><option value="awaiting_teacher_review">Awaiting validation</option><option value="validated">Validated</option></select></label>
        <div className="queue-count"><span>{filtered.length} {filtered.length===1?'submission':'submissions'}</span><span className="subtle">Most recent first</span></div>
        <div className="submission-list">{filtered.map(item=><button className="submission-row" aria-pressed={item.id===selected?.id} onClick={()=>void view(item)} key={item.id}>
          <span className="submission-icon"><Icon name={item.skill==='oral'?'mic':item.skill==='phonics'?'book':'question'} size={20}/></span><span className="submission-desc"><strong>{label(item.skill)} · {item.form}</strong><small>Student {item.learner.slice(0,12)}…</small><small>{new Date(item.created_at).toLocaleString()}</small></span>
          <span className={`pill-status ${item.result?'ready':'pending'}`}>{item.result?'Reviewed':'Needs review'}</span>
        </button>)}</div>{filtered.length===0&&<p className="subtle mt-3">No submissions match this filter.</p>}
      </section><div className="teacher-content">
        {!selected?<section className="panel dashboard-panel choose-review"><span className="section-icon"><Icon name="clipboard" size={32}/></span><h2>Choose a submission</h2><p className="subtle mt-2">Select a learner from the assessment queue to listen to their recordings, check the results, and confirm their score.</p></section>:<>
          <Review key={selected.id} item={selected} access={access} slotsUrl={`/api/teacher/submissions/${selected.id}/slots`} form={forms.find(f=>f.formId===selected.form)} passage={passages.find(p=>p.formId===selected.form)} comprehension={comprehension.find(c=>c.formId===selected.form)}
            onPrevious={position>0?()=>void view(filtered[position-1]):undefined}
            onNext={position>=0&&position<filtered.length-1?()=>void view(filtered[position+1]):undefined}
            onSaved={async()=>{const list=await request<Submission[]>('/api/teacher/submissions',{headers:headersFor(access)});setItems(list);const current=list.find(s=>s.id===selected.id)??null;setSelected(current);if(current)setProfile(await request<Profile>(`/api/teacher/learners/${current.learner}/profile`,{headers:headersFor(access)}));}}/>
          <ProfilePanel profile={profile} access={access} item={selected} refresh={async()=>{
            setProfile(await request<Profile>(`/api/teacher/learners/${selected.learner}/profile`,{headers:headersFor(access)}));
          }}/>
        </>}
      </div></div>
    </>}
  </main>;

}

function SecureAudio({access,submission,prompt,take}:{access:string;submission:string;prompt:number;take:number}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{const controller=new AbortController();let object='';fetch(`/api/teacher/submissions/${submission}/audio/${prompt}/${take}`,{headers:headersFor(access),signal:controller.signal})
    .then(response=>{if(!response.ok)throw new Error('Audio unavailable');return response.blob();})
    .then(blob=>{if(!controller.signal.aborted){object=URL.createObjectURL(blob);setUrl(object);}}).catch(()=>{});
    return()=>{controller.abort();if(object)URL.revokeObjectURL(object);};},[access,submission,prompt,take]);
  return url?<audio src={url} preload="metadata" controls aria-label={`Prompt ${prompt+1} attempt ${take}`}/>:<p className="subtle">Loading recording…</p>;
}

function Review({item,access,slotsUrl,form,passage,comprehension,onSaved,onPrevious,onNext}:{item:Submission;access:string;slotsUrl:string;form?:Form;passage?:Passage;comprehension?:ComprehensionForm;onSaved:()=>Promise<void>;onPrevious?:()=>void;onNext?:()=>void}) {
  const [slots,setSlots]=useState<Slot[]>([]);
  const [marks,setMarks]=useState<Record<number,Mark>>({});
  const [selectedTakes,setSelectedTakes]=useState<Record<number,number>>({});
  const [activeWord,setActiveWord]=useState(0);
  const [assisted,setAssisted]=useState(item.assisted);
  const [verified,setVerified]=useState(false);
  const [note,setNote]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const prompts = item.skill==='phonics'?form?.items.map(x=>x.word)??[]:
    item.skill==='oral'?passage?wordsOf(passage.text):[]:
    comprehension?.questions.map(q=>q.prompt)??[];
  const isRecording = item.skill!=='comprehension';
  const groups = item.skill==='phonics'?form?.items.length??0:isRecording?1:0;
  const markedCount = prompts.filter((_,i)=>Boolean(marks[i])).length;
  const remaining = prompts.length-markedCount;
  useEffect(()=>{if(!isRecording)return;request<Slot[]>(slotsUrl,{headers:headersFor(access)}).then(data=>{
    setSlots(data);const latest:Record<number,number>={};for(const slot of data) latest[slot.prompt]=Math.max(latest[slot.prompt]??0,slot.take);setSelectedTakes(latest);
  }).catch(error=>setError(describe(error)));},[slotsUrl,access,isRecording]);
  useEffect(()=>{
    if(item.skill!=='comprehension'||!item.provisional?.items)return;
    setMarks(Object.fromEntries(item.provisional.items.map((entry,i)=>[i,entry.correct?'CORRECT':'INCORRECT'])));
  },[item.id]);
  function setVerdict(index:number, verdict:Mark) {
    setMarks(old=>({...old,[index]:verdict}));setVerified(false);
    if(item.skill==='oral'){
      const next=prompts.findIndex((_,i)=>i>index&&!marks[i]);
      const first=prompts.findIndex((_,i)=>i!==index&&!marks[i]);
      setActiveWord(next>=0?next:first>=0?first:index);
    }
  }
  async function finalize() {
    if(!verified||remaining>0||(isRecording&&Array.from({length:groups},(_,i)=>selectedTakes[i]).some(n=>!n)))return;
    setBusy(true);setError('');
    try {await request(`/api/teacher/submissions/${item.id}/review`,{method:'POST',headers:{...headersFor(access),'Content-Type':'application/json'},body:JSON.stringify({
      marks:prompts.map((_,i)=>marks[i]),selectedTakes:isRecording?Array.from({length:groups},(_,i)=>selectedTakes[i]):[],assisted,verified:true,note,
    })});await onSaved();}catch(err){setError(describe(err));}finally{setBusy(false);}
  }
  function takeCards(promptIndex:number) {
    const matches=slots.filter(s=>s.prompt===promptIndex);
    return <div className="teacher-take-grid">{matches.map(slot=><label className={`teacher-take-card ${selectedTakes[promptIndex]===slot.take?'chosen':''}`} key={`${slot.prompt}-${slot.take}`}>
      <span className="take-label"><input type="radio" name={`selected-take-${promptIndex}`} checked={selectedTakes[promptIndex]===slot.take} onChange={()=>{setSelectedTakes(v=>({...v,[promptIndex]:slot.take}));setVerified(false);}}/> Score take {slot.take}</span>
      <SecureAudio access={access} submission={item.id} prompt={promptIndex} take={slot.take}/>
    </label>)}</div>;
  }
  return <section className="panel dashboard-panel review-panel" id="review">
    <div className="review-heading"><div><p className="eyebrow">Learner {item.learner.slice(0,16)}…</p><h2>{label(item.skill)} review</h2><p className="subtle">{item.form} · Submitted {new Date(item.created_at).toLocaleString()}</p></div><div className="review-heading-actions"><span className={`pill-status ${item.result?'ready':'pending'}`}><Icon name={item.result?'check':'clock'} size={15}/>{item.result?'Reviewed':'Needs review'}</span><div className="review-nav"><button className="button quiet-button" disabled={!onPrevious} onClick={onPrevious} aria-label="Previous submission">← Previous</button><button className="button quiet-button" disabled={!onNext} onClick={onNext}>Next <Icon name="arrow" size={16}/></button></div></div></div>
    {error&&<p className="error-message mt-3" role="alert">{error}</p>}
    {item.result?<><div className="score-banner mt-3">Teacher-validated score: {item.result.event.correct} of {item.result.event.total} ({Math.round(item.result.event.correct/item.result.event.total*100)}%)</div>
      {item.result.note&&<p className="mt-3"><strong>Teacher note:</strong> {item.result.note}</p>}
      <div className="validated-results mt-3"><h3>Confirmed item results</h3><p className="subtle">These are the teacher-validated marks saved for this assessment.</p><div className="word-chip-passage mt-2">{item.result.marks.map((mark,i)=><span className={`reading-word-chip ${mark==='CORRECT'?'correct':'incorrect'}`} key={i}>{prompts[i]??`Item ${i+1}`} {mark==='CORRECT'?<Icon name="check" size={14}/>:<span aria-hidden="true">✕</span>}</span>)}</div></div>
      {item.result.selectedTakes.length>0&&<p className="subtle mt-3"><strong>Scored attempt{item.result.selectedTakes.length===1?'':'s'}:</strong> {item.result.selectedTakes.map((take,i)=>`${item.skill==='oral'?'Passage':`Word ${i+1}`} — take ${take}`).join(', ')}</p>}
      <details className="mt-3"><summary>View saved validation details</summary><pre className="code-output">{JSON.stringify(item.result,null,2)}</pre></details>
      {isRecording&&<div className="teacher-take-grid mt-3">{slots.map(slot=><div className="teacher-take-card" key={`${slot.prompt}-${slot.take}`}><strong>Prompt {slot.prompt+1} · Take {slot.take}</strong><SecureAudio access={access} submission={item.id} prompt={slot.prompt} take={slot.take}/></div>)}</div>}
    </>:<>
      {item.skill==='phonics'&&<>
        <AutomaticPanel item={item}/>
        <div className="review-section-title"><span className="section-icon"><Icon name="headphones"/></span><div><h3>Listen to every student attempt</h3><p className="subtle">All recordings are retained. Choose the take to score and mark each word.</p></div></div>
        <div className="phonics-review-list">{prompts.map((word,i)=><div className="phonics-review-row" key={i}>
          <div className="phonics-word-label"><span className="word-index">Word {i+1}</span><strong>{word}</strong><div className="phonics-verdict"><button className={`verdict-button correct ${marks[i]==='CORRECT'?'selected':''}`} aria-pressed={marks[i]==='CORRECT'} onClick={()=>setVerdict(i,'CORRECT')}><Icon name="check" size={15}/> Correct</button><button className={`verdict-button incorrect ${marks[i]==='INCORRECT'?'selected':''}`} aria-pressed={marks[i]==='INCORRECT'} onClick={()=>setVerdict(i,'INCORRECT')}>✕ Incorrect</button></div></div>
          {takeCards(i)}
        </div>)}</div>
      </>}
      {item.skill==='oral'&&<div className="oral-review-layout"><div className="oral-main">
        <section className="review-subpanel"><div className="review-section-title"><span className="section-icon"><Icon name="mic"/></span><div><h3>Full-passage audio</h3><p className="subtle">Listen to the complete reading. Choose the attempt to score.</p></div></div>{takeCards(0)}</section>
        <section className="review-subpanel"><div className="review-section-title"><span className="section-icon"><Icon name="book"/></span><div><h3>Reading passage</h3><p className="subtle">Select a word to give your verdict. Each word must be marked.</p></div></div>
          <div className="word-chip-passage" aria-label="Reading words and teacher verdicts">{prompts.map((word,i)=><button key={i} className={`reading-word-chip ${marks[i]==='CORRECT'?'correct':marks[i]==='INCORRECT'?'incorrect':'unmarked'} ${activeWord===i?'active':''}`} aria-pressed={activeWord===i} onClick={()=>setActiveWord(i)} title={`Word ${i+1}: ${marks[i]??'Not reviewed'}`}><span>{word}</span>{marks[i]==='CORRECT'?<Icon name="check" size={13}/>:marks[i]==='INCORRECT'?<span aria-hidden="true">✕</span>:null}</button>)}</div>
          <details className="mt-3"><summary>Show original passage with punctuation</summary><p className="story-words">{passage?.text}</p></details>
          {prompts.length>0&&<div className="word-verdict-toolbar"><div className="word-focus">Word {activeWord+1} of {prompts.length}: <strong>{prompts[activeWord]}</strong><span className="subtle">{marks[activeWord]?'Marked':'Not reviewed'}</span></div><div className="word-verdict-actions"><button className={`verdict-button correct ${marks[activeWord]==='CORRECT'?'selected':''}`} aria-pressed={marks[activeWord]==='CORRECT'} onClick={()=>setVerdict(activeWord,'CORRECT')}><Icon name="check" size={17}/> Correct</button><button className={`verdict-button incorrect ${marks[activeWord]==='INCORRECT'?'selected':''}`} aria-pressed={marks[activeWord]==='INCORRECT'} onClick={()=>setVerdict(activeWord,'INCORRECT')}>✕ Incorrect</button><button className="button quiet-button" disabled={!marks[activeWord]} onClick={()=>{setMarks(old=>{const copy={...old};delete copy[activeWord];return copy;});setVerified(false);}}>Reset word</button></div></div>}
        </section>
      </div><aside className="review-suggestions"><AutomaticPanel item={item}/></aside></div>}
      {item.skill==='comprehension'&&<div className="review-subpanel mt-3"><div className="review-section-title"><span className="section-icon"><Icon name="question"/></span><div><h3>Reading comprehension</h3><p className="subtle">Review submitted answers and confirm or adjust the suggested marks.</p></div></div><p className="story-words">{comprehension?.text}</p><AutomaticPanel item={item}/>
        <div className="review-word-grid mt-3">{prompts.map((prompt,i)=><label className="review-word" key={i}><strong>{i+1}. {prompt}</strong><small>Chosen: {comprehension?.questions[i]?.choices.find(c=>c.answerId===item.provisional?.items[i]?.answerId)?.text??'—'}</small><select aria-label={`Teacher verdict for question ${i+1}`} value={marks[i]??''} onChange={e=>setVerdict(i,e.target.value as Mark)} disabled={busy}><option value="">Select verdict</option><option value="CORRECT">Correct</option><option value="INCORRECT">Incorrect</option></select></label>)}</div>
      </div>}
      <div className="review-finalize"><div className="review-section-title"><span className="section-icon"><Icon name="clipboard"/></span><div><h3>Finish teacher validation</h3><p className="subtle">{markedCount} of {prompts.length} items reviewed. {remaining>0?`${remaining} still need a verdict.`:'All items have verdicts.'} Automatic suggestions never become official results by themselves.</p></div></div>
        <label className="checkbox-line"><input type="checkbox" checked={assisted} onChange={e=>{setAssisted(e.target.checked);setVerified(false);}}/>This was a teacher-assisted assessment (not independent evidence).</label>
        <label className="field mt-3">Teacher observation (optional)<textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="Add an observation for this learner…"/></label>
        <label className="checkbox-line mt-3"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>I listened to the evidence and confirm the selected takes and every verdict.</label>
        <div className="review-submit-row"><span className="subtle">{remaining===0?'Ready to save once confirmed.':'Complete the missing verdicts before saving.'}</span><button className="button primary" disabled={busy||!verified||remaining>0||(isRecording&&Array.from({length:groups},(_,i)=>selectedTakes[i]).some(n=>!n))} onClick={()=>void finalize()}>{busy?'Saving…':'Finalize teacher validation'} <Icon name="check" size={18}/></button></div>
      </div>
    </>}
  </section>;
}

function AutomaticPanel({item}:{item:Submission}) {
  const hints=item.provisional?.items??[];
  const likely=hints.filter(x=>x.correct===true||x.verdict==='LIKELY_CORRECT').length;
  const uncertain=hints.filter(x=>x.verdict==='UNCERTAIN').length;
  return <div className="automatic-panel"><div className="review-section-title"><span className="section-icon"><Icon name="sparkles"/></span><div><h3>Automatic suggestions</h3><p className="subtle">Not official results · Teacher review required</p></div></div>
    {item.provisional?<><div className="automatic-stats"><div><span>Likely correct</span><strong>{likely} / {hints.length}</strong></div><div><span>Uncertain</span><strong>{uncertain}</strong></div></div>{item.provisional.message&&<p className="subtle mt-2">{item.provisional.message}</p>}
      <div className="automatic-tags">{hints.slice(0,15).map((x,i)=><span className="mini-feedback" key={i}>{x.word??`Question ${i+1}`}: {x.correct!==undefined?(x.correct?'likely correct':'likely incorrect'):x.verdict?.replaceAll('_',' ').toLowerCase()??'uncertain'}</span>)}</div></>:<p className="subtle mt-3">No automatic suggestions available. Listen to the recording and assign each verdict manually.</p>}
    <p className="automatic-disclaimer"><Icon name="info" size={19}/> Speech recognition can make mistakes. Confirm marks by listening to the learner’s recording.</p>
  </div>;
}

const activities = [
  ['PHONICS_BASED_LEARNING','Phonics-Based Learning'],['GUIDED_ORAL_READING','Guided Oral Reading'],
  ['GUIDED_COMPREHENSION','Guided Comprehension'],['MIXED_READING','Mixed Reading'],
  ['ROTATING_REVIEW','Rotating Review'],['ORAL_REREADING','Oral Rereading'],
  ['SUPPORTED_COMPREHENSION','Supported Comprehension'],['ACCESSIBLE_CURRENT_LEVEL_PRACTICE','Accessible Practice'],
  ['FRESH_INDEPENDENT_CHECK','Fresh Independent Check'],
];
function TeacherPracticeProgress({learnerId, access}:{learnerId:string;access:string}) {
  const [runs,setRuns]=useState<PracticeRun[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let mounted=true;
    setRuns(null);setError('');
    request<PracticeRun[]>(`/api/teacher/learners/${encodeURIComponent(learnerId)}/practice`,{headers:headersFor(access)})
      .then(items=>{if(mounted)setRuns(items);})
      .catch(err=>{if(mounted)setError(describe(err));});
    return()=>{mounted=false;};
  },[learnerId,access]);
  const completed=runs?.filter(item=>item.completedAt)??[];
  const stars=new Set(completed.map(item=>item.activityId)).size;
  return <section className="teacher-practice-summary mt-4" aria-label="Learner guided practice history">
    <div className="spread"><h3>Guided reading quests</h3><span className="pill-status">Practice only · Not graded</span></div>
    {error&&<p role="alert" className="subtle mt-2">Could not load saved practice: {error}</p>}
    {!runs&&!error&&<p role="status" className="subtle mt-2">Loading practice history…</p>}
    {runs&&<><div className="quest-teacher-counts"><span><strong>★ {stars}</strong> unique quest stars</span><span><strong>{completed.length}</strong> completed sessions</span><span><strong>{runs.filter(r=>!r.completedAt).length}</strong> in progress</span></div>
      {runs.length===0?<p className="subtle mt-3">No saved guided practice yet.</p>:<details className="mt-3"><summary><strong>View guided-practice records ({runs.length})</strong></summary>
      <div className="quest-teacher-list">{[...runs].reverse().map(record=><div key={record.runId} className="quest-teacher-record"><strong>{questActivities.find(a=>a.id===record.activityId)?.title??record.activityId}</strong><span>{record.completedAt?'Completed':'In progress'} · {record.skill} · {record.attempts.length} tries · {record.hintHistory?.length??0} hints</span><small>{new Date(record.completedAt??record.startedAt).toLocaleString()}</small>{record.notes&&<p><strong>Note:</strong> {record.notes}</p>}</div>)}</div></details>}
    </>}
    <p className="subtle mt-2">Learner practice history is informational and never changes the official skill scores or statuses.</p>
  </section>;
}

function ProfilePanel({profile,access,item,refresh}: {profile:Profile|null;access:string;item:Submission;refresh:()=>Promise<void>}) {
  const [activity,setActivity]=useState('PHONICS_BASED_LEARNING');
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  async function submitOverride(){setSaving(true);setError('');try{
    await request('/api/teacher/overrides',{method:'POST',headers:{...headersFor(access),'Content-Type':'application/json'},body:JSON.stringify({
      overrideId:crypto.randomUUID(), learnerId:item.learner, sessionId:item.session,
      primaryActivityId:activity,why:reason,timestamp:new Date().toISOString(),
    })});setReason('');await refresh();
  }catch(err){setError(describe(err));}finally{setSaving(false);}}
  return <section className="panel dashboard-panel profile-review-panel mt-4" id="progress-review"><div className="section-title"><span className="section-icon"><Icon name="chart"/></span><h2>Learner progress and recommendations</h2></div>
    {!profile?<p role="status" className="subtle mt-2">Loading validated skill history…</p>:<>
      <div className="skill-grid mt-3">{(['phonics','oral','comprehension'] as Skill[]).map(skill=>{const s=profile.skills.find(x=>x.skill===skill);return <div className="skill-tile" key={skill}><strong>{label(skill)}</strong><p className="skill-score">{s?.latestUsableScore===null||s?.latestUsableScore===undefined?'—':`${s.latestUsableScore}%`}</p><span className="status-wait">{s?.status??'UNCONFIRMED'}</span><p className="subtle">{s?.reassess?'Recheck requested':'No immediate recheck'}</p></div>;})}</div>
      <div className="mt-4"><p><strong>Primary recommendation:</strong> {profile.recommendation.primary?.label ?? 'Awaiting evidence'}</p>
        <p><strong>Secondary recommendation:</strong> {profile.recommendation.secondary?.label??'—'}</p>
        <p className="subtle mt-2">{profile.recommendation.explanation}</p>
        <p className="mt-2"><strong>Learning gaps:</strong> {profile.activeGaps.join(', ')||'None confirmed'}</p>
        <p><strong>Reassessment queue:</strong> {profile.reassessmentQueue.join(', ')||'None'}</p></div>
      <details className="mt-3"><summary><strong>Assessment history ({profile.events.length})</strong></summary>
        {profile.events.map(event=><p className="mt-2" key={event.eventId}>{label(event.skill)} · {event.correct}/{event.total} · {new Date(event.timestamp).toLocaleString()}</p>)}
      </details>
      <details className="mt-3"><summary><strong>Documented overrides ({profile.overrides.length})</strong></summary>
        {profile.overrides.map(entry=><p className="mt-2" key={entry.overrideId}>{entry.why} · {new Date(entry.timestamp).toLocaleString()}</p>)}
      </details>
      <TeacherPracticeProgress learnerId={item.learner} access={access}/>
      <div className="teacher-override mt-4"><h3>Document a teacher override</h3><p className="subtle">Override the recommended activity without changing the original score or evidence.</p>
        <label className="field mt-2">Recommended activity<select value={activity} onChange={e=>setActivity(e.target.value)}>{activities.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
        <label className="field mt-2">Reason<textarea maxLength={240} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required justification" rows={2}/></label>
        <button className="button primary mt-2" disabled={!reason.trim()||saving} onClick={()=>void submitOverride()}>{saving?'Saving…':'Save documented override'}</button>
        {error&&<p role="alert" className="error-message mt-2">{error}</p>}
      </div>
    </>}
  </section>;
}
