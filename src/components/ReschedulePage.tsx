import {useEffect,useState} from 'react';
import {api} from '../api';
import {money,statusLabel} from '../domain';
import {changeLabels,changePeriod,type ChangeView} from '../rescheduling';
import {DataError,DataLoading} from './DataState';

export function ChangeDetails({change}:{change:ChangeView}){
 return <div className="change-details"><span className={'badge '+(change.state==='pending'?'pending':change.state==='accepted'?'confirmed':'cancelled')}>{changeLabels[change.state]}</span><div className="change-period"><span>原預約</span><strong>{changePeriod(change.old)}</strong></div><div className="change-period proposed"><span>建議改為</span><strong>{changePeriod(change.proposed)}</strong></div><p>服務金額：NT$ {money(change.price)}</p><p>{change.reason}</p>{change.state==='pending'&&<p className="muted">請於 {new Date(change.expiresAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})} 前回覆。同意前，原預約時段不會變更。</p>}</div>;
}
export function ChangeDecision({change,onDone}:{change:ChangeView;onDone:(state:string)=>Promise<void>|void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function respond(decision:'accept'|'decline'){
  if(busy)return;setBusy(true);setError('');
  try{const result=await api<{state:string}>('/changes/'+change.id+'/respond','POST',{decision});await onDone(result.state)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="change-card" aria-label="店家改期提案"><h3>店家想與你確認改期</h3><ChangeDetails change={change}/>{error&&<p className="error-box" role="alert">{error}</p>}{busy&&<DataLoading compact label="送出改期回覆中…"/>}{change.state==='pending'&&<div className="change-actions"><button className="button small" disabled={busy} onClick={()=>void respond('accept')}>接受改期</button><button className="button secondary small" disabled={busy} onClick={()=>void respond('decline')}>維持原時段</button></div>}</section>;
}
type Details={change:ChangeView;booking:{customer:string;service:string;spec:string;status:string}};
export default function ReschedulePage({id,user}:{id:string;user:{id:string}|null}){
 const [data,setData]=useState<Details|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!user)return;const controller=new AbortController();setLoading(true);setError('');
  api<Details>('/changes/'+id,'GET',undefined,controller.signal).then(d=>{if(!controller.signal.aborted)setData(d)}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort();
 },[id,user?.id,attempt]);
 return <main className="container page narrow"><div className="eyebrow">RESCHEDULE YOUR MOMENT</div><h1>確認改期</h1>{!user?<div className="line-login"><p>請使用預約本人的 LINE 帳號登入，查看店家提出的新時段。</p><a className="button line-button" href={'/api/auth/line?returnTo='+encodeURIComponent('reschedule/'+id)}>使用 LINE 登入</a></div>:loading?<DataLoading label="載入改期提案中…"/>:error||!data?<DataError message={error||'暫時無法取得改期資料'} onRetry={()=>setAttempt(n=>n+1)}/>:<><p>{data.booking.customer} · {data.booking.service}・{data.booking.spec}</p><p>預約狀態：{statusLabel[data.booking.status]}</p><ChangeDecision key={data.change.id+data.change.state} change={data.change} onDone={state=>setData({...data,booking:{...data.booking,status:state==='accepted'?'confirmed':data.booking.status},change:{...data.change,state}})}/>{data.change.state==='accepted'&&data.booking.status==='confirmed'&&<p role="status">改期已成功，確認通知已排程傳送。</p>}{data.change.state==='declined'&&<p role="status">已告知店家維持原預約時段。</p>}<a className="text-link" href="#my">查看我的預約</a></>}</main>;
}
