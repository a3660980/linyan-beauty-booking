import {useEffect,useState} from 'react';
import {api} from '../api';
import {bookingDates,cleanupMinutes,serviceDuration,serviceEnd,type Addons,type Service,type Settings} from '../domain';
import {changePeriod,changeTime,type ChangeView} from '../rescheduling';
import type {Booking} from '../main';
import {InvitationLink} from './BookingInvitation';
import {ChangeDetails} from './ReschedulePage';
import {DataError,DataLoading} from './DataState';
export default function ReschedulePanel({booking,services,settings,price,demo,onChanged}:{booking:Booking;services:Service[];settings:Settings;price:number;demo:boolean;onChanged:()=>Promise<void>|void}){
 const service=services.find(s=>s.id===booking.service_id),spec=service?.specs.findIndex(s=>s.label===booking.spec)??-1;
 let duration=Math.round((serviceEnd(booking)-booking.start)/60000);
 if(service?.category==='lashes'&&spec>=0){try{duration=serviceDuration(service,JSON.parse(booking.addons||'{"lower":false,"removal":"none"}') as Addons,settings,spec)??duration}catch{/* keep the booked service duration */}}
 const [minutes,setMinutes]=useState(duration),[date,setDate]=useState(booking.date),[time,setTime]=useState(changeTime(booking.start)),[reason,setReason]=useState(''),[changes,setChanges]=useState<ChangeView[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[copied,setCopied]=useState(false),[opened,setOpened]=useState(false);
 const dates=bookingDates(settings.bookingDays),pending=changes?.find(c=>c.state==='pending');
 useEffect(()=>{const abort=new AbortController();setError('');if(demo){setChanges([]);return}api<{changes:ChangeView[]}>('/admin/bookings/'+booking.id+'/changes','GET',undefined,abort.signal).then(d=>{if(!abort.signal.aborted)setChanges(d.changes)}).catch(e=>{if(!abort.signal.aborted)setError((e as Error).message)});return()=>abort.abort()},[booking.id,booking.version,demo,attempt]);
 async function propose(){setBusy(true);setError('');try{
  const result=await api<{change:ChangeView}>('/admin/bookings/'+booking.id+'/changes','POST',{version:booking.version,date,time,duration:minutes,price,reason});setChanges(current=>[result.change,...(current||[])]);setOpened(false);await onChanged();
 }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function withdraw(c:ChangeView){setBusy(true);setError('');try{await api('/admin/changes/'+c.id+'/withdraw','POST',{});setChanges(current=>current?.map(x=>x.id===c.id?{...x,state:'withdrawn'}:x)??null);await onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const inviteMessage=pending?`${booking.customer} 您好，店家想與您確認改期。\n原預約：${changePeriod(pending.old)}\n建議改為：${changePeriod(pending.proposed)}\n服務：${booking.service_name}・${booking.spec}\n${pending.reason}\n請登入 LINE 綁定這筆預約，再到「我的預約」選擇接受或維持原時段。` :'';
 const boundMessage=pending?`${booking.customer} 您好，店家想與您確認改期。\n原預約：${changePeriod(pending.old)}\n建議改為：${changePeriod(pending.proposed)}\n請點以下連結回覆，您同意前原預約不會變更：\n${location.origin}/#reschedule/${pending.id}`:'';
 const proposedStart=Date.parse(`${date}T${time}:00+08:00`),previewEnd=proposedStart+minutes*60000;
 return <section className="reschedule-panel"><h3>提出改期</h3>{changes===null&&!error?<DataLoading compact label="查詢改期紀錄中…"/>:changes===null?<DataError compact message={error} onRetry={()=>{setError('');setAttempt(n=>n+1)}}/>:<>
 {error&&<p className="error-box" role="alert">{error}</p>}{busy&&<DataLoading compact label="更新改期提案中…"/>}
 {pending?<><ChangeDetails change={pending}/><p className="muted">新時段已暫時保留。客戶回覆前請保留原預約；如需修改原預約，請先撤回提案。</p>{booking.user_id?<><p className="muted">已排程 LINE 詢問訊息，也可複製以下內容手動傳送。</p><textarea aria-label="改期詢問訊息" readOnly rows={6} value={boundMessage}/><button className="text-link change-copy" disabled={busy} onClick={()=>void navigator.clipboard.writeText(boundMessage).then(()=>setCopied(true)).catch(()=>setError('請長按訊息複製。'))}>{copied?'已複製':'複製改期訊息與連結'}</button></>:<InvitationLink key={pending.id} id={booking.id} auto message={inviteMessage}/>}<button className="button secondary small" disabled={busy} onClick={()=>void withdraw(pending)}>撤回改期提案</button></>:<>
 {opened?<div className="reschedule-fields"><div className="form-grid"><label className="field"><span>改期日期</span><input type="date" min={dates[0]} max={dates.at(-1)} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field"><span>改期開始時間</span><input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div><label className="field"><span>服務時間（分鐘）</span><input type="number" min={5} max={600} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>{Number.isFinite(previewEnd)&&minutes>0&&<p className="muted">客戶服務至 {changeTime(previewEnd)}，店家整理至 {changeTime(previewEnd+cleanupMinutes(settings)*60000)}。</p>}<label className="field"><span>改期原因</span><textarea rows={2} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如調整當日排班"/></label><p className="muted">以目前確認金額提出，最長保留新時段 24 小時，且不晚於原預約或新時段開始。客戶接受後才正式改期。</p><div className="change-actions"><button type="button" className="button small" disabled={busy||demo||!date||!time||minutes<5} onClick={()=>void propose()}>提出改期並詢問客戶</button><button type="button" className="text-link" disabled={busy} onClick={()=>setOpened(false)}>收起</button></div></div>:<button type="button" className="button secondary small" disabled={demo||busy} onClick={()=>setOpened(true)}>{demo?'示範不發送改期提案':'調整日期／服務時間'}</button>}
 {changes.length>0&&<div className="change-history"><p className="muted">最近改期紀錄</p>{changes.slice(0,3).map(c=><ChangeDetails key={c.id} change={c}/>)}</div>}
 </>}
 </>}</section>;
}
