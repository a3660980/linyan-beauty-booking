import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {offsetDate,weekDates,type AvailabilityDay} from '../domain';
type Props={date:string;onChange:(date:string)=>void;days:AvailabilityDay[];firstAvailableDate:string|null;minDate:string;maxDate:string;busy:boolean};
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8))}`;

export default function BookingDatePicker({date,onChange,days,firstAvailableDate,minDate,maxDate,busy}:Props){
 const week=weekDates(date);
 function select(value:string){if(value>=minDate&&value<=maxDate)onChange(value)}
 function move(n:number){const next=offsetDate(date,n*7);select(next<minDate?minDate:next>maxDate?maxDate:next)}
 return <div className="booking-date-picker" aria-busy={busy}>
  <div className="booking-week-navigation">
   <button className="week-button" aria-label="上一週" disabled={busy||week[0]<=minDate} onClick={()=>move(-1)}><ChevronLeft size={16}/><span>上一週</span></button>
   <strong aria-live="polite">{week[0].slice(0,4)} · {shortDate(week[0])} – {week.at(-1)!.slice(0,4)!==week[0].slice(0,4)?week.at(-1)!.slice(0,4)+'/':''}{shortDate(week.at(-1)!)}</strong>
   <button className="week-button" aria-label="下一週" disabled={busy||week.at(-1)!>=maxDate} onClick={()=>move(1)}><span>下一週</span><ChevronRight size={16}/></button>
  </div>
  <div className="date-strip" aria-label="本週日期">
   {week.map(d=>{const open=days.some(day=>day.date===d&&day.slots.length>0),outside=d<minDate||d>maxDate;return <button key={d} data-date={d} className={d===date?'selected':''} aria-label={`${d}${open?'，有可預約時段':''}`} aria-pressed={d===date} disabled={busy||outside} onClick={()=>select(d)}><small>{new Date(d+'T12:00:00+08:00').toLocaleDateString('zh-TW',{weekday:'short',timeZone:'Asia/Taipei'})}</small><strong>{Number(d.slice(8))}</strong><small>{Number(d.slice(5,7))} 月</small><span className={'availability-dot'+(open?' open':'')} aria-hidden="true"/></button>})}
  </div>
  <div className="booking-date-actions"><label className="field"><span>預約日期</span><input type="date" min={minDate} max={maxDate} value={date} disabled={busy} onChange={e=>select(e.target.value)}/></label><button className="text-link nearest-date" disabled={busy||!firstAvailableDate} onClick={()=>firstAvailableDate&&select(firstAvailableDate)}><CalendarDays size={16}/>最近可預約日</button></div>
 </div>;
}
