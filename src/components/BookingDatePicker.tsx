import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,ChevronDown,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {offsetDate,taipeiDay,weekDates,type AvailabilityDay} from '../domain';
type Props={date:string;onChange:(date:string)=>void;days:AvailabilityDay[];firstAvailableDate:string|null;minDate:string;maxDate:string;busy:boolean;onViewSlots?:()=>void};
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
const shiftMonth=(month:string,n:number)=>{const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7)};

export default function BookingDatePicker({date,onChange,days,firstAvailableDate,minDate,maxDate,busy,onViewSlots}:Props){
 const week=weekDates(date),id=useId(),trigger=useRef<HTMLButtonElement>(null),calendar=useRef<HTMLDivElement>(null),overlay=useRef<HTMLDivElement>(null),viewSlotsAfterClose=useRef(false);
 const [open,setOpen]=useState(false),[month,setMonth]=useState(date.slice(0,7));
 const available=new Set(days.filter(day=>day.slots.length>0).map(day=>day.date));
 const first=weekDates(month+'-01')[0],monthDates=Array.from({length:42},(_,i)=>offsetDate(first,i));
 const monthLabel=`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;
 useEffect(()=>setMonth(date.slice(0,7)),[date]);
 useEffect(()=>{if(!open&&viewSlotsAfterClose.current){viewSlotsAfterClose.current=false;onViewSlots?.()}},[open,onViewSlots]);
 useLayoutEffect(()=>{
  if(!open||!calendar.current||!overlay.current)return;
  const root=calendar.current,layer=overlay.current,body=document.body,app=document.getElementById('root'),scrollY=window.scrollY,viewport=window.visualViewport;
  const bodyStyle={overflow:body.style.overflow,paddingRight:body.style.paddingRight};
  const appStyle=app?{position:app.style.position,top:app.style.top,left:app.style.left,right:app.style.right,width:app.style.width}:null;
  const appHidden=app?.getAttribute('aria-hidden'),appInert=app?.inert;
  const scrollbar=Math.max(0,innerWidth-document.documentElement.clientWidth);
  // Freeze only the app, leaving the body and this separate portal free of fixed-body WebView hit testing.
  if(app){const box=app.getBoundingClientRect();Object.assign(app.style,{position:'fixed',top:`${box.top}px`,left:`${box.left}px`,right:'auto',width:`${box.width}px`});app.inert=true;app.setAttribute('aria-hidden','true')}
  Object.assign(body.style,{overflow:'hidden',paddingRight:`${parseFloat(getComputedStyle(body).paddingRight)+scrollbar}px`});
  function position(){
   const height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;
   Object.assign(layer.style,{top:`${viewport?.offsetTop||0}px`,left:`${viewport?.offsetLeft||0}px`,width:`${width}px`,height:`${height}px`});
   layer.style.setProperty('--booking-calendar-height',`${height}px`);
   if(matchMedia('(max-width:600px)').matches){root.style.left='';root.style.top='';return}
   const anchor=trigger.current?.getBoundingClientRect(),bounds=layer.getBoundingClientRect();if(!anchor)return;
   const below=anchor.bottom-bounds.top+8,above=anchor.top-bounds.top-root.offsetHeight-8;
   root.style.left=`${Math.max(16,Math.min(anchor.left-bounds.left,width-root.offsetWidth-16))}px`;
   root.style.top=`${Math.max(16,Math.min(below+root.offsetHeight<=height-16?below:above>=16?above:below,height-root.offsetHeight-16))}px`;
  }
  position();
  const target=root.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)')||root.querySelector<HTMLButtonElement>('.booking-month-days button:not(:disabled)');
  (target||root).focus({preventScroll:true});
  function containFocus(e:FocusEvent){if(e.target instanceof Node&&!root.contains(e.target))root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true})}
  document.addEventListener('focusin',containFocus);window.addEventListener('resize',position);viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position);
  return()=>{
   document.removeEventListener('focusin',containFocus);window.removeEventListener('resize',position);viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position);
   if(app&&appStyle){app.inert=appInert||false;if(appHidden===null)app.removeAttribute('aria-hidden');else if(appHidden!==undefined)app.setAttribute('aria-hidden',appHidden);Object.assign(app.style,appStyle)}
   Object.assign(body.style,bodyStyle);window.scrollTo(0,scrollY);trigger.current?.focus({preventScroll:true});
  };
 },[open]);
 function select(value:string){if(value>=minDate&&value<=maxDate)onChange(value)}
 function move(n:number){const next=offsetDate(date,n*7);select(next<minDate?minDate:next>maxDate?maxDate:next)}
 function close(showSlots=false){viewSlotsAfterClose.current=showSlots;setOpen(false)}
 function choose(value:string){if(busy||!available.has(value))return;select(value);close(true)}
 return <div className="booking-date-picker" aria-busy={busy}>
  <div className="booking-week-navigation">
   <button className="week-button" aria-label="上一週" disabled={busy||week[0]<=minDate} onClick={()=>move(-1)}><ChevronLeft size={16}/><span>上一週</span></button>
   <strong aria-live="polite">{week[0].slice(0,4)} · {shortDate(week[0])} – {week.at(-1)!.slice(0,4)!==week[0].slice(0,4)?week.at(-1)!.slice(0,4)+'/':''}{shortDate(week.at(-1)!)}</strong>
   <button className="week-button" aria-label="下一週" disabled={busy||week.at(-1)!>=maxDate} onClick={()=>move(1)}><span>下一週</span><ChevronRight size={16}/></button>
  </div>
  <div className="date-strip" aria-label="本週日期">
   {week.map(d=>{const open=available.has(d),outside=d<minDate||d>maxDate;return <button key={d} data-date={d} className={d===date?'selected':''} aria-label={`${d}${open?'，有可預約時段':''}`} aria-pressed={d===date} disabled={busy||outside} onClick={()=>select(d)}><small>{new Date(d+'T12:00:00+08:00').toLocaleDateString('zh-TW',{weekday:'short',timeZone:'Asia/Taipei'})}</small><strong>{Number(d.slice(8))}</strong><small>{Number(d.slice(5,7))} 月</small><span className={'availability-dot'+(open?' open':'')} aria-hidden="true"/></button>})}
  </div>
  <div className="booking-date-actions"><div className="field booking-date-field"><span id={id+'-label'}>預約日期</span><button ref={trigger} type="button" className="booking-date-trigger" aria-label="預約日期" data-date={date} aria-expanded={open} aria-haspopup="dialog" aria-controls={id+'-calendar'} disabled={busy} onClick={()=>{setMonth(date.slice(0,7));setOpen(!open)}}><span>{date.replaceAll('-',' / ')}</span><span className="booking-date-trigger-icons"><CalendarDays size={19}/><ChevronDown size={15}/></span></button></div><button className="text-link nearest-date" disabled={busy||!firstAvailableDate} onClick={()=>{if(firstAvailableDate){select(firstAvailableDate);setMonth(firstAvailableDate.slice(0,7));setOpen(false)}}}><CalendarDays size={16}/>最近可預約日</button>
   {open&&createPortal(<div ref={overlay} className="booking-calendar-overlay"><button type="button" className="booking-calendar-backdrop" tabIndex={-1} aria-label="關閉月曆背景" onClick={()=>close()}/><div ref={calendar} id={id+'-calendar'} className="booking-month-calendar" data-month={month} role="dialog" aria-label="選擇預約日期" aria-modal="true" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}if(e.key!=='Tab')return;const nodes=Array.from(calendar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}>
    <div className="booking-month-title"><h2>選擇預約日期</h2><button type="button" className="icon-button" aria-label="關閉月曆" onClick={()=>close()}><X size={21}/></button></div>
    <div className="booking-month-heading"><button type="button" className="icon-button" aria-label="上個月" disabled={busy||month<=minDate.slice(0,7)} onClick={()=>setMonth(shiftMonth(month,-1))}><ChevronLeft size={19}/></button><strong aria-live="polite">{monthLabel}</strong><button type="button" className="icon-button" aria-label="下個月" disabled={busy||month>=maxDate.slice(0,7)} onClick={()=>setMonth(shiftMonth(month,1))}><ChevronRight size={19}/></button></div>
    <div className="booking-month-weekdays" aria-hidden="true">{['一','二','三','四','五','六','日'].map(d=><span key={d}>{d}</span>)}</div>
    <div className="booking-month-days">{monthDates.map(d=>{const inMonth=d.slice(0,7)===month,within=d>=minDate&&d<=maxDate,canBook=inMonth&&within&&available.has(d),selected=d===date;return <button type="button" key={d} data-date={d} className={(canBook?'available':'unavailable')+(selected?' is-chosen':'')+(!inMonth?' outside':'')} aria-label={`${d}，${canBook?'有可預約時段':'無可預約時段'}`} aria-pressed={selected} aria-current={d===taipeiDay()?'date':undefined} disabled={busy||!canBook} onClick={()=>choose(d)}><span>{Number(d.slice(8))}</span><span className={'availability-dot'+(canBook?' open':'')} aria-hidden="true"/></button>})}</div>
    <div className="booking-month-legend"><span><i className="availability-dot open"/>可預約</span><span><i className="availability-dot"/>無可預約時段</span></div><p className="booking-month-hint">依所選服務顯示可預約日期，選取後再挑選時段。</p><button type="button" className={'booking-month-close '+(available.has(date)?'button':'text-link')} onClick={()=>close(available.has(date))}>{available.has(date)?'查看這天的時段':'收起月曆'}</button>
   </div></div>,document.body)}
  </div>
 </div>;
}
