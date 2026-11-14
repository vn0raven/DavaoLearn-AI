import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentDashboard } from './StudentDashboard';
import { TeacherDashboard } from './TeacherDashboard';
import { AuthScreen, authPost } from './AuthScreen';
import type { Account } from './AuthScreen';
import { request, RequestError } from './api';
import { Icon } from './Icons';
import logo from './litera-logo.webp';
import './oral/style.css';
import './student.css';
import './auth.css';
import './integrated.css';
import './litera-refresh.css';
import './practice/quest.css';
import './mobile.css';

type Navigation = {target:string;version:number};
const learnerNav = [
  {target:'home', label:'Home', icon:'home'},
  {target:'lessons', label:'Assessments', icon:'clipboard'},
  {target:'progress', label:'My progress', icon:'chart'},
  {target:'journey', label:'Practice', icon:'book'},
] as const;
function App() {
  const isTeacher = window.location.pathname === '/teacher';
  const [account,setAccount] = useState<Account|null|undefined>(undefined);
  const [error,setError] = useState('');
  const [navigation,setNavigation] = useState<Navigation|undefined>();
  useEffect(()=>{if(isTeacher)return;request<Account>('/api/auth/session').then(setAccount).catch(err=>{
    if(!(err instanceof RequestError&&err.status===401))setError('Cannot check your account. Confirm the server is running.');
    setAccount(null);
  });},[isTeacher]);
  useEffect(()=>{if(!account)return;const cancel=window.setTimeout(()=>setAccount(null),Math.max(0,account.expiresAt*1000-Date.now()));
    const expired=()=>setAccount(null);window.addEventListener('litera:session-expired',expired);
    return()=>{window.clearTimeout(cancel);window.removeEventListener('litera:session-expired',expired);};},[account]);
  async function signOut(){try{await authPost('logout');setAccount(null);}catch{setError('Could not sign out. Try again.');}}
  function jump(target:string){setNavigation(current=>({target,version:(current?.version??0)+1}));}
  return <><header className="litera-header"><div className="litera-header-inner">
    <a className="litera-wordmark" href={isTeacher?'/teacher':'/'} aria-label="Litera home"><img src={logo} alt="Litera" width={146} height={43}/></a>
    {isTeacher?<nav className="app-nav" aria-label="Teacher navigation"><a href="#teacher-home"><Icon name="home" size={19}/> Overview</a><a href="#queue"><Icon name="clipboard" size={19}/> Assessment queue</a><a href="#progress-review"><Icon name="chart" size={19}/> Learner progress</a></nav>:
      account?<nav className="app-nav" aria-label="Learner navigation">{learnerNav.map(({target,label,icon})=><button type="button" key={target}
        aria-current={(navigation?.target ?? 'home') === target ? 'location' : undefined}
        className={(navigation?.target ?? 'home') === target ? 'current' : undefined}
        onClick={()=>jump(target)}><Icon name={icon} size={19}/> {label}</button>)}</nav>:
      <span className="header-greeting">Learn to read. Grow with Litera.</span>}
    <div className="account-nav">{isTeacher?<a className="button quiet-button" href="/">Student portal</a>:account?<><span className="account-avatar" aria-label="Learner account">L</span><button className="button quiet-button" onClick={()=>void signOut()}><Icon name="logout" size={17}/> Log out</button></>:<a className="button quiet-button" href="/teacher"><Icon name="lock" size={17}/> Teacher portal</a>}</div>
  </div>{error&&<p className="account-alert" role="alert">{error}</p>}</header>
    {isTeacher?<TeacherDashboard/>:account===undefined?<main className="lesson-home"><p role="status">Checking your login…</p></main>:
      account===null?<AuthScreen onVerify={setAccount}/>:<StudentDashboard key={account.learnerId} learnerId={account.learnerId} navigation={navigation}/>}
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
