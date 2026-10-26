import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,ChevronDown,Wallet,ShieldCheck,AlertCircle} from 'lucide-react';
import {money,serviceEnd} from '../domain';
import {changePeriod} from '../rescheduling';
import type {Booking} from '../main';

type Action='payment'|'completed'|'cancelled'|'no_show';
type Props={booking:Booking;future:boolean;busy:boolean;price:number;setPrice:(n:number)=>void;paid:boolean;setPaid:(paid:boolean)=>void;cash:number;setCash:(n:number)=>void;onUpdate:(status:string)=>Promise<void>;children?:ReactNode};
const actions:Record<Action,{title:string;button:string;description:string;ack?:string}>={
 payment:{title:'核對收款資料',button:'確認儲存收款',description:'核對本次金額與收款狀態後，再儲存。'},
 completed:{title:'確認服務已完成',button:'確認完成服務',description:'完成後，此筆預約會列入已完成的服務紀錄。',ack:'我已確認這位客人已完成服務'},
 cancelled:{title:'確認取消這筆預約',button:'確認取消預約',description:'取消後會釋出這筆預約的時段。',ack:'我已核對客人與日期，確認取消這筆預約'},
 no_show:{title:'確認客人未到店',button:'確認標記未到店',description:'此筆預約會被標記為未到店。',ack:'我已確認客人未到店'}
};

export default function BookingOperations(p:Props){
 const {booking:b,future,busy}=p;
 const [review,setReview]=useState<Action|null>(null),[ack,setAck]=useState(false);
 const heading=useRef<HTMLHeadingElement>(null),confirmation=useRef<HTMLElement>(null),opener=useRef<HTMLElement|null>(null);
 const pending=b.status==='pending',confirmed=b.status==='confirmed',active=pending||confirmed;
 const canEditPayment=pending||!future;
 function begin(action:Action){opener.current=document.activeElement as HTMLElement;setAck(false);setReview(action)}
 useEffect(()=>{if(!review)return;heading.current?.focus();return()=>{if(opener.current?.isConnected)opener.current.focus()}},[review]);
 const detail=review?actions[review]:null;
 async function commit(){if(!review||busy||(detail?.ack&&!ack))return;await p.onUpdate(review==='payment'?b.status:review)}
 return <div className="booking-operations">
  <div hidden={!!review}>
   <section className="booking-operation-card" aria-labelledby="booking-payment-title">
    <div className="booking-operation-heading"><Wallet size={19}/><h3 id="booking-payment-title">{pending?'確認金額與預約':'收款管理'}</h3></div>
    {canEditPayment?<><label className="field"><span>確認服務金額</span><input disabled={busy} type="number" inputMode="numeric" min={0} max={100000} value={p.price} onChange={e=>p.setPrice(Number(e.target.value))}/></label>
     <label className="consent payment-check"><input type="checkbox" disabled={busy} checked={p.paid} onChange={e=>p.setPaid(e.target.checked)}/>已收到款項</label>
     {p.paid&&<label className="field"><span>實收金額</span><input disabled={busy} type="number" inputMode="numeric" min={0} max={100000} value={p.cash} onChange={e=>p.setCash(Number(e.target.value))}/></label>}
     <button type="button" className="button booking-operation-button" disabled={busy} onClick={()=>pending?void p.onUpdate('confirmed'):begin('payment')}>{pending?'確認預約':'儲存收款'}<Check size={17}/></button>
    </>:<><div className="booking-payment-summary"><span>服務金額</span><strong>NT$ {money(b.price)}</strong><span className="badge">{b.paid?'已收 NT$ '+money(b.paid_amount||0):'尚未收款'}</span></div><p className="muted">到預約當日可更新收款。</p></>}
   </section>
   {active&&p.children}
   {confirmed&&(future?<p className="future-booking-note"><ShieldCheck size={19}/><span>預約日期尚未到，目前可取消或提出改期。到預約當日才開放完成服務、未到店與收款操作。</span></p>:<section className="booking-operation-card booking-completion-card" aria-labelledby="booking-completion-title"><div className="booking-operation-heading"><ShieldCheck size={19}/><h3 id="booking-completion-title">服務狀態</h3></div><p className="muted">實際完成這位客人的服務後，再標記完成。</p><button type="button" className="button secondary booking-operation-button" disabled={busy} onClick={()=>begin('completed')}>標記服務完成</button></section>)}
   {active&&<details className="booking-more-actions"><summary><div><strong>其他預約操作</strong><span>{confirmed&&!future?'取消預約、標記未到店':'取消預約'}</span></div><ChevronDown size={19}/></summary><div className="booking-more-body">
    {confirmed&&!future&&<button type="button" className="booking-caution-action" disabled={busy} onClick={()=>begin('no_show')}><strong>標記未到店</strong><span>確認客人未到店後再操作</span></button>}
    <button type="button" className="booking-caution-action destructive" disabled={busy} onClick={()=>begin('cancelled')}><strong>取消預約</strong><span>會釋出時段{b.user_id?'，並通知客戶':''}</span></button>
   </div></details>}
  </div>
  {review&&detail&&<section className="booking-action-confirmation" ref={confirmation} role="group" aria-labelledby="booking-action-confirmation-title" onKeyDown={e=>{
   if(e.key==='Escape'&&!busy){e.stopPropagation();setReview(null)}
   if(e.key==='Tab'){const nodes=Array.from(confirmation.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')||[]),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  }}><div className="booking-confirmation-icon"><AlertCircle size={24}/></div><h3 ref={heading} tabIndex={-1} id="booking-action-confirmation-title">{detail.title}</h3><p className="muted">{detail.description}</p><div className="booking-action-summary"><strong>{b.customer}</strong><span>{b.service_name}・{b.spec}</span><strong>{changePeriod({date:b.date,start:b.start,end:serviceEnd(b)})}</strong></div>
   {review==='payment'?<div className="booking-action-payment"><span>服務金額：NT$ {money(p.price)}</span><strong>{p.paid?'已收款：NT$ '+money(p.cash):'尚未收到款項'}</strong></div>:<p className="muted">收款修改請在「收款管理」另外儲存。{review==='cancelled'&&b.user_id?'取消後將通知客戶。':''}</p>}
   {detail.ack&&<label className="booking-action-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/><span>{detail.ack}</span></label>}
   <div className="booking-action-confirm-buttons"><button type="button" className="button secondary" disabled={busy} onClick={()=>setReview(null)}>返回修改</button><button type="button" className={'button'+(review==='cancelled'?' destructive-confirm':'')} disabled={busy||!!detail.ack&&!ack} onClick={()=>void commit()}>{busy?'儲存中…':detail.button}</button></div>
  </section>}
 </div>;
}
