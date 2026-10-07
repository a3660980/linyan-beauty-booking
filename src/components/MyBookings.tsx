import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CalendarDays,MessageCircle} from 'lucide-react';
import {api} from '../api';
import {money,statusLabel} from '../domain';
import {DataError,DataLoading} from './DataState';
import type {Booking,SharedProps} from '../main';
const timeOf=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(11,16);

export default function MyBookings(p:SharedProps){
 const [rows,setRows]=useState<Booking[]|null>(null),[loading,setLoading]=useState(!!p.user),[loadError,setLoadError]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null);
 async function load(){
  controller.current?.abort();
  if(!p.user){setRows(null);setLoading(false);return}
  setLoadError('');
  if(p.demo){setRows(p.demoBookings);setLoading(false);return}
  const request=new AbortController();controller.current=request;setLoading(true);
  try{const result=await api<{bookings:Booking[]}>('/bookings','GET',undefined,request.signal);if(!request.signal.aborted)setRows(result.bookings)}
  catch(e){if(!request.signal.aborted)setLoadError((e as Error).message)}
  finally{if(!request.signal.aborted)setLoading(false)}
 }
 useEffect(()=>{void load();return()=>controller.current?.abort()},[p.demo,p.demoBookings,p.user?.id]);
 async function cancel(b:Booking){
  if(!window.confirm('確定取消這筆預約？'))return;
  setBusy(true);setActionError('');
  try{
   if(p.demo)p.setDemoBookings(bs=>bs.map(x=>x.id===b.id?{...x,status:'cancelled'}:x));
   else await api(`/bookings/${b.id}/cancel`,'POST',{});
   setRows(current=>current?.map(row=>row.id===b.id?{...row,status:'cancelled'}:row)??null);
   await load();p.notify('已取消預約');
  }catch(e){setActionError((e as Error).message)}finally{setBusy(false)}
 }
 return <main className="container page"><div className="page-title"><div className="eyebrow">MY RESERVATIONS</div><h1>我的預約</h1><p>查看申請進度與已確認的美好時光。</p></div>
  {!p.user?<div className="empty-state"><MessageCircle size={38}/><h2>登入後查看你的預約</h2><a className="button line-button" href="/api/auth/line?returnTo=my">使用 LINE 登入</a></div>:<>
   <div className="my-toolbar"><button className="text-link" disabled={loading||busy} onClick={()=>void load()}>{loading?'查詢中…':'重新整理'}</button></div>
   {actionError&&<div className="error-box" role="alert">{actionError}</div>}
   {rows===null?(loading?<DataLoading label="載入預約紀錄中…"/>:<DataError message={loadError||'暫時無法載入預約紀錄'} onRetry={()=>void load()}/>):<>
    {loadError&&<DataError compact message={loadError} onRetry={()=>void load()}/>}
    {loading&&<DataLoading compact label="更新預約紀錄中…"/>}
    {busy&&!loading&&<DataLoading compact label="取消預約中…"/>}
    <div className="my-list" aria-busy={loading||busy}>
     {rows.length?rows.map(b=><article className="reservation" key={b.id}><div className="reservation-date"><strong>{b.date.slice(8)}</strong><small>{b.date.slice(5,7)} 月</small></div><div className="reservation-info"><span className={'badge '+b.status}>{statusLabel[b.status]}</span><h3>{b.service_name}・{b.spec}</h3><p>{b.date}　{timeOf(b.start)}　·　到店付款</p><small>預約編號：{b.id}</small>{b.group_code&&<small>同行預約識別碼：{b.group_code}</small>}</div><div className="reservation-actions"><strong>NT$ {money(b.price)}</strong>{['pending','confirmed'].includes(b.status)&&<button disabled={busy||loading} className="text-link" onClick={()=>void cancel(b)}>取消預約</button>}</div></article>):<div className="empty-state"><CalendarDays size={34}/><h3>還沒有預約紀錄</h3><a href={p.demo?'#demo-booking':'#booking'} className="button">開始預約 <ArrowRight size={16}/></a></div>}
    </div>
   </>}
  </>}
 </main>;
}
