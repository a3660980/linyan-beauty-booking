import {useState} from 'react';
import {ChevronLeft,ChevronRight,CalendarDays} from 'lucide-react';
import {taipeiDay,type DateSchedule,type TimeWindow} from '../domain';

const PAGE_SIZE=5;
const monthLabel=(month:string)=>`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;

export default function ScheduledDates({exceptions,date,onEdit}:{exceptions:DateSchedule[];date:string;onEdit:(date:string)=>void}){
 const [includePast,setIncludePast]=useState(false);
 const [browse,setBrowse]=useState({anchor:date,month:date.slice(0,7),page:0});
 const today=taipeiDay(),month=browse.anchor===date?browse.month:date.slice(0,7);
 const all=[...exceptions].sort((a,b)=>a.date.localeCompare(b.date));
 const visible=all.filter(ex=>includePast||ex.date>=today);
 const months=[...new Set([month,date.slice(0,7),...visible.map(ex=>ex.date.slice(0,7))])].sort();
 const dates=visible.filter(ex=>ex.date.startsWith(month));
 const selectedIndex=dates.findIndex(ex=>ex.date===date);
 const pageCount=Math.max(1,Math.ceil(dates.length/PAGE_SIZE));
 const page=Math.min(browse.anchor===date?browse.page:Math.max(0,Math.floor(selectedIndex/PAGE_SIZE)),pageCount-1);
 const rows=dates.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE),monthIndex=months.indexOf(month);
 const pastCount=all.filter(ex=>ex.date<today).length;
 const selectMonth=(next:string)=>setBrowse({anchor:date,month:next,page:0});
 const selectPage=(next:number)=>setBrowse({anchor:date,month,page:next});
 return <section className="schedule-list scheduled-dates" aria-labelledby="scheduled-dates-title">
  <div className="scheduled-dates-heading"><div><h3 id="scheduled-dates-title">已設定的日期</h3><p>依月份查看，每頁最多 {PAGE_SIZE} 天。</p></div><span className="scheduled-dates-count">{dates.length} 天</span></div>
  <div className="scheduled-dates-month">
   <button className="icon-button" aria-label="上一個排班月份" disabled={monthIndex===0} onClick={()=>selectMonth(months[monthIndex-1])}><ChevronLeft size={20}/></button>
   <label className="field"><span className="sr-only">查看排班月份</span><select value={month} onChange={e=>selectMonth(e.target.value)}>{months.map(value=><option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>
   <button className="icon-button" aria-label="下一個排班月份" disabled={monthIndex===months.length-1} onClick={()=>selectMonth(months[monthIndex+1])}><ChevronRight size={20}/></button>
  </div>
  {pastCount>0&&<button className="text-link scheduled-dates-past" aria-pressed={includePast} onClick={()=>{setIncludePast(!includePast);selectMonth(includePast&&month<today.slice(0,7)?today.slice(0,7):month)}}>{includePast?'收起過去排班':`查看過去排班（${pastCount} 天）`}</button>}
  <div className="scheduled-dates-rows">{rows.length?rows.map(ex=>{
   const windows=JSON.parse(ex.windows) as TimeWindow[];
   return <article className={'exception-row scheduled-date-row'+(ex.date===date?' is-selected':'')} key={ex.date}>
    <div className="scheduled-date-info"><strong>{ex.date}<span>{new Date(ex.date+'T12:00:00+08:00').toLocaleDateString('zh-TW',{weekday:'short',timeZone:'Asia/Taipei'})}</span></strong><div className="scheduled-date-times">{windows.length?windows.map(([from,to],i)=><span key={i}>{from}–{to}</span>):<span className="is-closed">全天休息</span>}</div></div>
    <button className="text-link" aria-label={`編輯 ${ex.date} 的時間`} onClick={()=>onEdit(ex.date)}>編輯時間</button>
   </article>;
  }):<div className="scheduled-dates-empty"><CalendarDays size={24}/><p>這個月份沒有{includePast?'已設定的':'即將到來的'}排班。</p></div>}</div>
  {dates.length>PAGE_SIZE&&<nav className="scheduled-dates-pages" aria-label="已設定日期分頁"><button className="button secondary small" disabled={page===0} onClick={()=>selectPage(page-1)}><ChevronLeft size={16}/>上一頁</button><span aria-live="polite">{page+1} / {pageCount}</span><button className="button secondary small" disabled={page===pageCount-1} onClick={()=>selectPage(page+1)}>下一頁<ChevronRight size={16}/></button></nav>}
 </section>;
}
