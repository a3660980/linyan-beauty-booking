import {useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {statusLabel} from '../domain';
import type {Booking} from '../main';
const time=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(11,16);
const offset=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00+08:00')+n*86400000+8*3600000).toISOString().slice(0,10);
export default function CalendarPanel({rows,date,setDate,onOpen}:{rows:Booking[];date:string;setDate:(d:string)=>void;onOpen:(b:Booking)=>void}){
 const [view,setView]=useState('day');
 const active=rows.filter(b=>['pending','confirmed','completed'].includes(b.status));
 const selected=new Date(date+'T12:00:00+08:00');
 let dates=[date];
 if(view==='week'){const first=offset(date,-((selected.getUTCDay()+6)%7));dates=Array.from({length:7},(_,i)=>offset(first,i));}
 if(view==='month'){const first=date.slice(0,8)+'01',weekday=new Date(first+'T12:00:00+08:00').getUTCDay();dates=Array.from({length:42},(_,i)=>offset(first,i-((weekday+6)%7)));}
 const event=(b:Booking)=><button className={'calendar-event '+b.status} key={b.id} onClick={()=>onOpen(b)}><strong>{b.customer} · {b.service_name}</strong><small>{time(b.start)}–{time(b.end)}　{statusLabel[b.status]}</small></button>;
 return <><div className="calendar-toolbar"><div className="tabs compact">{[['day','日'],['week','週'],['month','月']].map(([id,name])=><button className={view===id?'active':''} key={id} onClick={()=>setView(id)}>{name}</button>)}</div><input aria-label="行事曆日期" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="calendar-navigation"><button className="icon-button" aria-label="前一段日期" onClick={()=>setDate(offset(date,view==='day'?-1:view==='week'?-7:-28))}><ChevronLeft size={18}/></button><strong>{date.slice(0,7)}</strong><button className="icon-button" aria-label="下一段日期" onClick={()=>setDate(offset(date,view==='day'?1:view==='week'?7:28))}><ChevronRight size={18}/></button></div>{view==='day'?<div className="calendar-day">{Array.from({length:24},(_,i)=>i).map(h=><div className="calendar-hour" key={h}><span>{String(h).padStart(2,'0')}:00</span><div>{active.filter(b=>b.date===date&&Number(time(b.start).slice(0,2))===h).map(event)}</div></div>)}</div>:<div className="calendar-scroll"><div className={'calendar-multi '+view}>{dates.map(d=><div className={'calendar-cell '+(d.slice(0,7)!==date.slice(0,7)?'outside':'')} key={d}><button className="calendar-cell-date" onClick={()=>{setDate(d);setView('day')}}>{new Date(d+'T12:00:00+08:00').toLocaleDateString('zh-TW',{month:'numeric',day:'numeric',weekday:'short'})}</button>{active.filter(b=>b.date===d).sort((a,b)=>a.start-b.start).map(event)}</div>)}</div></div>}<p className="muted">時段包含整理緩衝。休息日變更不會自動取消既有預約。</p></>;
}
