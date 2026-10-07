import {useEffect,useState} from 'react';
import {AlertCircle,Check,Plus,X} from 'lucide-react';
import {normalizeWindows,taipeiMs,windowsForDate,type DateSchedule,type Settings,type TimeWindow} from '../domain';
import type {Booking} from '../main';

export type SaveDateSchedule=(date:string,windows:TimeWindow[]|null)=>Promise<void>;
type Props={date:string;setDate:(date:string)=>void;settings:Settings;exceptions:DateSchedule[];rows:Booking[];onSave:SaveDateSchedule};

export default function DateScheduleEditor({date,setDate,settings,exceptions,rows,onSave}:Props){
 const current=windowsForDate(date,settings.weekly,exceptions);
 const source=exceptions.some(x=>x.date===date);
 const signature=JSON.stringify(current);
 const [windows,setWindows]=useState<TimeWindow[]>(current.length?current:[['10:00','18:00']]);
 const [closed,setClosed]=useState(!current.length),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const next=JSON.parse(signature) as TimeWindow[];setWindows(next.length?next:[['10:00','18:00']]);setClosed(!next.length);setError('')},[date,signature]);
 const affected=rows.filter(b=>b.date===date&&['pending','confirmed'].includes(b.status)&&
  (closed||!windows.some(([from,to])=>from&&to&&b.start>=taipeiMs(date,from)&&b.end<=taipeiMs(date,to))));
 function change(index:number,side:0|1,value:string){setWindows(windows.map((w,i)=>i===index?[side===0?value:w[0],side===1?value:w[1]]:w));setError('')}
 function add(){const from=windows.at(-1)?.[1]||'10:00';const minutes=Number(from.slice(0,2))*60+Number(from.slice(3));const end=Math.min(1439,minutes+120);setWindows([...windows,[from,`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`]]);setError('')}
 async function save(remove=false){setError('');setBusy(true);try{taipeiMs(date,'00:00');await onSave(date,remove?null:normalizeWindows(closed?[]:windows))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="date-schedule-editor">
  <div className="eyebrow">DAILY AVAILABILITY</div><h2 id="date-schedule-title">當日可預約時間</h2>
  <p className="muted">點日期逐日排班，無須設定固定週班表。當日設定會取代該日的固定排班。</p>
  <label className="field"><span>排班日期</span><input type="date" required value={date} onChange={e=>{if(e.target.value)setDate(e.target.value)}} disabled={busy}/></label>
  <p className="schedule-source">目前：{source?'指定日期排班':current.length?'使用固定排班':'未開放預約'}</p>
  <label className="consent"><input type="checkbox" checked={closed} disabled={busy} onChange={e=>{setClosed(e.target.checked);if(!windows.length)setWindows([['10:00','18:00']]);setError('')}}/>全天休息</label>
  {!closed&&<><div className="schedule-windows">{windows.map(([from,to],i)=><div className="schedule-window" key={i}>
   <div className="schedule-window-heading"><strong>區段 {i+1}</strong><button className="icon-button" aria-label={`刪除區段 ${i+1}`} disabled={busy} onClick={()=>{const next=windows.filter((_,j)=>j!==i);setWindows(next);if(!next.length)setClosed(true)}}><X size={17}/></button></div>
   <div className="schedule-window-times">
   <label className="field"><span>區段 {i+1} 開始時間</span><input type="time" required value={from} disabled={busy} onChange={e=>change(i,0,e.target.value)}/></label>
   <span className="schedule-to">至</span>
   <label className="field"><span>區段 {i+1} 結束時間</span><input type="time" required value={to} disabled={busy} onChange={e=>change(i,1,e.target.value)}/></label>
   </div>
  </div>)}</div><button className="text-link" disabled={busy||windows.length>=5} onClick={add}><Plus size={16}/>新增時間區段</button><p className="muted">每天最多 5 個區段，可分開安排上午、下午或午休。</p></>}
  {affected.length>0&&<div className="notice-box schedule-conflicts"><AlertCircle size={19}/><div><p>此設定影響 {affected.length} 筆既有預約。預約會保留，請確認安排並聯絡客人。</p>{affected.map(b=><small key={b.id}>{b.customer} · {new Date(b.start+8*3600000).toISOString().slice(11,16)} · {b.service_name}</small>)}</div></div>}
  {error&&<div className="error-box" role="alert">{error}</div>}
  <div className="modal-actions"><button className="button" disabled={busy} onClick={()=>void save()}>{busy?'儲存中…':'儲存當日排班'}<Check size={16}/></button>{source&&<button className="button secondary" disabled={busy} onClick={()=>void save(true)}>恢復固定排班</button>}</div>
  <p className="muted">客人只會看到能容納完整服務與整理時間、且未被預約的時段。</p>
 </div>;
}
