import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,X} from 'lucide-react';
import {statusLabel,taipeiDay,windowsForDate,type DateSchedule,type Settings} from '../domain';
import DateScheduleEditor,{type SaveDateSchedule} from './DateScheduleEditor';
import CalendarSubscription from './CalendarSubscription';
import type {Booking} from '../main';
const time=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(11,16);
const offset=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00+08:00')+n*86400000+8*3600000).toISOString().slice(0,10);
const monthOffset=(date:string,n:number)=>{const d=new Date(date.slice(0,7)+'-01T12:00:00+08:00');d.setUTCMonth(d.getUTCMonth()+n);return taipeiDay(d.getTime())};
type Props={rows:Booking[];date:string;setDate:(d:string)=>void;onOpen:(b:Booking)=>void;settings:Settings;exceptions:DateSchedule[];onSaveSchedule:SaveDateSchedule;demo?:boolean};
export default function CalendarPanel({rows,date,setDate,onOpen,settings,exceptions,onSaveSchedule,demo}:Props){
 const [view,setView]=useState('month'),[editing,setEditing]=useState<string|null>(null);
 const modal=useRef<HTMLElement>(null),opener=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(!editing)return;opener.current=document.activeElement as HTMLElement;modal.current?.querySelector<HTMLInputElement>('input')?.focus();return()=>opener.current?.focus()},[!!editing]);
 const active=rows.filter(b=>['pending','confirmed','completed'].includes(b.status));
 const selected=new Date(date+'T12:00:00+08:00');
 let dates=[date];
 if(view==='week'){const first=offset(date,-((selected.getUTCDay()+6)%7));dates=Array.from({length:7},(_,i)=>offset(first,i));}
 if(view==='month'){const first=date.slice(0,8)+'01',weekday=new Date(first+'T12:00:00+08:00').getUTCDay();dates=Array.from({length:42},(_,i)=>offset(first,i-((weekday+6)%7)));}
 const selectedWindows=windowsForDate(date,settings.weekly,exceptions);
 const open=(d:string)=>{setDate(d);setEditing(d)};
 const move=(n:number)=>setDate(view==='month'?monthOffset(date,n):offset(date,n*(view==='week'?7:1)));
 const event=(b:Booking)=><button className={'calendar-event '+b.status} key={b.id} onClick={()=>onOpen(b)}><strong>{b.customer} · {b.service_name}</strong><small>{time(b.start)}–{time(b.end)}　{statusLabel[b.status]}</small></button>;
 return <>
  <CalendarSubscription demo={demo}/>
  <div className="calendar-toolbar"><div className="tabs compact">{[['day','日'],['week','週'],['month','月']].map(([id,name])=><button className={view===id?'active':''} key={id} onClick={()=>setView(id)}>{name}</button>)}</div><input aria-label="行事曆日期" type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value)}}/></div>
  <div className="calendar-schedule-heading"><p>點選日期設定當天開放時間，可一次新增多個區段。</p><button className="button secondary small" onClick={()=>open(date)}><Plus size={16}/>新增可預約時間</button></div>
  <div className="calendar-navigation"><button className="icon-button" aria-label="前一段日期" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><strong>{date.slice(0,7)}</strong><button className="icon-button" aria-label="下一段日期" onClick={()=>move(1)}><ChevronRight size={18}/></button></div>
  {view==='day'?<><div className="calendar-day-schedule"><div><strong>{date} · 開放時間</strong><p>{selectedWindows.length?selectedWindows.map(w=>w.join('–')).join('、'):'這天未開放預約'}</p></div><button className="text-link" onClick={()=>open(date)}>設定當日時間</button></div><div className="calendar-day">{Array.from({length:24},(_,i)=>i).map(h=><div className={'calendar-hour '+(selectedWindows.some(([from,to])=>from<`${String(h+1).padStart(2,'0')}:00`&&to>`${String(h).padStart(2,'0')}:00`)?'open-hour':'')} key={h}><span>{String(h).padStart(2,'0')}:00</span><div>{active.filter(b=>b.date===date&&Number(time(b.start).slice(0,2))===h).map(event)}</div></div>)}</div></>:<div className="calendar-scroll"><div className={'calendar-weekdays '+view}>{['一','二','三','四','五','六','日'].map(d=><span key={d}>週{d}</span>)}</div><div className={'calendar-multi '+view}>{dates.map(d=>{
   const windows=windowsForDate(d,settings.weekly,exceptions),custom=exceptions.some(x=>x.date===d);
   return <div data-date={d} className={'calendar-cell '+(d.slice(0,7)!==date.slice(0,7)?'outside ':'')+(d===date?'selected-date ':'')+(d===taipeiDay()?'today':'')} key={d}>
    <button className="calendar-cell-date" aria-label={`設定 ${d} 的可預約時間`} onClick={()=>open(d)}>{Number(d.slice(8))}</button>
    <div className={'calendar-availability '+(custom?'custom ':'')+(windows.length?'open':'closed')}><span>{custom?'指定排班':windows.length?'固定時間':'未開放'}</span>{windows.length?windows.slice(0,view==='month'?2:5).map(w=><small key={w.join('-')}>{w.join('–')}</small>):custom&&<small>全天休息</small>}{windows.length>2&&view==='month'&&<small>另 {windows.length-2} 個區段</small>}</div>
    {active.filter(b=>b.date===d).sort((a,b)=>a.start-b.start).map(event)}
   </div>
  })}</div></div>}
  <p className="muted">固定週班表可以全部留空，只開放有設定的日期。既有預約會保留。</p>
  {editing&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setEditing(null)}}><section ref={modal} className="modal schedule-modal" role="dialog" aria-modal="true" aria-labelledby="date-schedule-title" onKeyDown={e=>{
   if(e.key==='Escape')setEditing(null);
   if(e.key==='Tab'){const nodes=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')||[]);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  }}><button className="modal-close icon-button" aria-label="關閉排班設定" onClick={()=>setEditing(null)}><X/></button><DateScheduleEditor date={editing} setDate={d=>{setDate(d);setEditing(d)}} settings={settings} exceptions={exceptions} rows={rows} onSave={async(d,w)=>{await onSaveSchedule(d,w);setEditing(null)}}/></section></div>}
 </>;
}
