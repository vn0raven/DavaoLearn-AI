import type { ReactNode } from 'react';

type IconName = 'book'|'mic'|'question'|'chart'|'target'|'clipboard'|'headphones'|'sparkles'|'refresh'|'search'|'home'|'layers'|'check'|'arrow'|'clock'|'lock'|'users'|'file'|'info'|'logout'|'pencil';
const shapes: Record<IconName, ReactNode> = {
  book: <><path d="M12 7c-2.6-1.8-5.2-2.1-9-1.6v13c4-.5 6.4-.1 9 1.6m0-13c2.6-1.8 5.2-2.1 9-1.6v13c-4-.5-6.4-.1-9 1.6M12 7v13"/></>,
  mic: <><rect x="9" y="2.5" width="6" height="13" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"/></>,
  question: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.8 2.8 0 1 1 4.5 2.2c-1.5 1-2 1.6-2 3m0 3h.01"/></>,
  chart: <><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="m13 11 7-7"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6M9 19h4"/></>,
  headphones: <><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2Zm16 0h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z"/></>,
  sparkles: <><path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Zm6-1v4m-2-2h4"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></>,
  home: <><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
  check: <><path d="m4 12 5 5L20 6"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  lock: <><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-14a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5"/></>,
  file: <><path d="M6 2h8l5 5v15H6V2Zm8 0v5h5M9 12h7M9 16h7"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M13 7l5 5-5 5m-8-5h13"/></>,
  pencil: <><path d="m3 17 11-11 4 4L7 21H3v-4ZM14 6l2-2a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3l-2 2"/></>,
};
export function Icon({name,size=22,className=''}:{name:IconName;size?:number;className?:string}) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
