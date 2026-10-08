import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,Smartphone} from 'lucide-react';
import {api} from '../api';
import {DataError,DataLoading} from './DataState';

type Subscription={enabled:false}|{enabled:true;httpsUrl:string;webcalUrl:string;createdAt:number};
export default function CalendarSubscription({demo=false}:{demo?:boolean}){
 const [open,setOpen]=useState(false),[subscription,setSubscription]=useState<Subscription|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[showUrl,setShowUrl]=useState(false),[message,setMessage]=useState('');
 const controller=useRef<AbortController|null>(null),urlField=useRef<HTMLInputElement>(null);
 async function load(){
  controller.current?.abort();setError('');
  if(demo){setSubscription({enabled:false});setLoading(false);return}
  const request=new AbortController();controller.current=request;setLoading(true);
  try{const result=await api<Subscription>('/admin/calendar-subscription','GET',undefined,request.signal);if(!request.signal.aborted)setSubscription(result)}
  catch(e){if(!request.signal.aborted)setError((e as Error).message)}
  finally{if(!request.signal.aborted)setLoading(false)}
 }
 useEffect(()=>{if(!open)return;void load();return()=>controller.current?.abort()},[open,demo,attempt]);
 useEffect(()=>{if(showUrl){urlField.current?.focus();urlField.current?.select()}},[showUrl]);
 async function change(method:'POST'|'PUT'|'DELETE'){
  if(method==='PUT'&&!confirm('重新產生後，舊連結會失效，iPhone 需要重新訂閱。確定繼續？'))return;
  if(method==='DELETE'&&!confirm('停用後，使用這個連結的裝置將無法再更新行事曆。確定停用？'))return;
  setBusy(true);setActionError('');setMessage('');
  try{setSubscription(await api<Subscription>('/admin/calendar-subscription',method,{}));setShowUrl(false);setMessage(method==='DELETE'?'已停用你的行事曆訂閱。':method==='PUT'?'已產生新連結，請重新加入 iPhone 行事曆。':'訂閱已開啟，可加入 iPhone 行事曆。')}
  catch(e){setActionError((e as Error).message);await load()}
  finally{setBusy(false)}
 }
 async function copy(){
  if(!subscription?.enabled)return;
  try{await navigator.clipboard.writeText(subscription.httpsUrl);setMessage('已複製訂閱網址。')}
  catch{setShowUrl(true);setMessage('請長按下方網址，選取並複製。')}
 }
 return <section className="calendar-sync">
  <div className="calendar-sync-heading"><div><Smartphone size={22}/><div><h3>iPhone 行事曆</h3><p>單向訂閱 · 定期更新</p></div></div><button className="button secondary small" disabled={busy} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'收起設定':'同步到 iPhone'}</button></div>
  {open&&<div className="calendar-sync-body">
   <p>同步已確認與已完成的預約，包含客人姓名、服務與整理時間。範圍為近 30 天至未來 180 天；預約變更仍在後台操作。</p>
   {error&&<DataError compact message={error} onRetry={()=>setAttempt(value=>value+1)}/>}
   {actionError&&<div className="error-box" role="alert">{actionError}</div>}
   {(loading||(!subscription&&!error))&&<DataLoading compact label={subscription?'更新行事曆訂閱中…':'載入行事曆訂閱中…'}/>}
   {busy&&<DataLoading compact label="儲存行事曆訂閱中…"/>}
   {subscription&&<div className="calendar-sync-options" aria-busy={loading||busy} inert={loading||busy||!!error}>
    {demo?<p className="muted">示範模式不建立私人訂閱，請在正式後台開啟。</p>:subscription.enabled?<>
     <p className="calendar-sync-private">這是你的私人訂閱連結，可讀取預約姓名與時段，請只提供給管理員。</p>
     <div className="calendar-sync-actions"><a className="button small" href={subscription.webcalUrl}>加入 iPhone 行事曆 <ExternalLink size={16}/></a><button className="button secondary small" onClick={()=>void copy()}><Copy size={16}/>複製訂閱網址</button></div>
     <button className="text-link" aria-expanded={showUrl} onClick={()=>setShowUrl(value=>!value)}>{showUrl?'隱藏訂閱網址':'顯示訂閱網址'}</button>
     {showUrl&&<label className="field"><span>私人訂閱網址</span><input ref={urlField} className="calendar-sync-url" readOnly autoComplete="off" spellCheck={false} value={subscription.httpsUrl}/></label>}
     <div className="calendar-sync-manage"><button className="text-link" onClick={()=>void change('PUT')}>重新產生連結</button><button className="text-link" onClick={()=>void change('DELETE')}>停用訂閱</button></div>
    </>:<><p>尚未開啟你的行事曆訂閱。</p><button className="button small" onClick={()=>void change('POST')}>開啟訂閱</button></>}
   </div>}
   {message&&<p className="calendar-sync-message" role="status">{message}</p>}
   <details className="calendar-sync-help"><summary>手動加入與更新方式</summary><ol><li>複製訂閱網址，打開 iPhone「行事曆」App。</li><li>開啟「行事曆」列表，選擇「加入行事曆」→「加入訂閱行事曆」。</li><li>貼上網址並完成訂閱；若在 LINE 內無法直接加入，可改用 Safari 開啟後台。</li></ol><p>iPhone 會依行事曆擷取設定更新，非即時同步。要查看最新預約狀態，請以後台為準。</p><p>停用或重新產生連結後，請在 iPhone 取消舊訂閱；使用新連結重新加入。每位管理員可各自開啟訂閱。</p><a className="text-link" href="https://support.apple.com/zh-tw/guide/iphone/iph3d1110d4/ios" target="_blank" rel="noopener noreferrer">Apple 訂閱設定說明 <ExternalLink size={14}/></a></details>
  </div>}
 </section>;
}
