import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';
import {DataError,DataLoading} from './DataState';
import type {Booking} from '../main';
type Customer={id:string;customer:string;phone:string;lineBound:boolean};
export default function ManualCustomerPicker({demo,bookings,selected,onSelect}:{demo:boolean;bookings:Booking[];selected:string;onSelect:(customer:Customer|null)=>void}){
 const [customers,setCustomers]=useState<Customer[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[query,setQuery]=useState(''),[existing,setExisting]=useState(false);
 useEffect(()=>{
  const abort=new AbortController();setLoading(true);setError('');
  const read=demo?Promise.resolve({customers:bookings.map(b=>({id:b.id,customer:b.customer,phone:b.phone,lineBound:!!b.user_id}))}):api<{customers:Customer[]}>('/admin/customers','GET',undefined,abort.signal);
  read.then(data=>{if(!abort.signal.aborted)setCustomers(data.customers)}).catch(e=>{if(!abort.signal.aborted)setError((e as Error).message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});
  return()=>abort.abort();
 },[demo,bookings,attempt]);
 const matches=useMemo(()=>customers.filter(c=>!query||c.customer.toLowerCase().includes(query.toLowerCase())||c.phone.includes(query)),[customers,query]);
 return <div className="manual-customer-picker"><div className="tabs compact" role="group" aria-label="客人來源"><button type="button" className={existing?'active':''} onClick={()=>{setExisting(true);onSelect(null)}}>選擇現有客人</button><button type="button" className={!existing?'active':''} onClick={()=>{setExisting(false);onSelect(null)}}>新增客人</button></div>{existing&&<>{loading?<DataLoading compact label="載入現有客人中…"/>:error?<DataError compact message={error} onRetry={()=>setAttempt(n=>n+1)}/>:<><label className="field"><span>搜尋姓名或電話</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="輸入姓名或電話"/></label><label className="field"><span>現有客人</span><select value={selected} required onChange={e=>onSelect(customers.find(c=>c.id===e.target.value)||null)}><option value="">請選擇客人</option>{matches.map(c=><option key={c.id} value={c.id}>{c.customer} · {c.phone} · {c.lineBound?'已綁定 LINE':'尚未綁定 LINE'}</option>)}</select></label>{!matches.length&&<p className="muted">沒有符合的客人，可切換「新增客人」直接輸入。</p>}</>}</>}<p className="muted">後台建立的預約會直接確認。已綁定 LINE 的客人會收到通知；未綁定者會產生邀請訊息。</p></div>
}
