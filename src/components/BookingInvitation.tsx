import {useEffect,useState} from 'react';
import {MessageCircle,Check,Copy} from 'lucide-react';
import {api} from '../api';
import {DataLoading,DataError} from './DataState';

export function InvitationLink({id,demo=false}:{id:string;demo?:boolean}){
 const [link,setLink]=useState<{url:string;expiresAt:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 async function generate(){setBusy(true);setError('');setCopied(false);try{setLink(await api('/admin/bookings/'+encodeURIComponent(id)+'/invitation','POST',{}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function copy(){try{await navigator.clipboard.writeText(link!.url);setCopied(true)}catch{setError('請長按下方網址，選擇複製。')}}
 return <div className="invitation-link"><h3><MessageCircle size={18}/>邀請客戶綁定 LINE</h3><p className="muted">將連結私訊給這位客戶。客戶登入 LINE 並加入官方帳號後，可綁定此筆預約並接收通知。</p>{busy&&<DataLoading compact label="產生邀請連結中…"/>}{error&&<div className="error-box" role="alert">{error}</div>}{link&&<><label className="field"><span>此筆預約專屬網址</span><input readOnly value={link.url} onFocus={e=>e.target.select()}/></label><button type="button" className="text-link" onClick={()=>void copy()}><Copy size={16}/>{copied?'已複製':'複製邀請網址'}</button><p className="muted">有效至 {new Date(link.expiresAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}。限使用一次；重新產生會讓舊連結失效。預約若取消或逾時，連結也會失效。</p></>}<button type="button" className="button secondary small" disabled={busy||demo} onClick={()=>void generate()}>{demo?'示範不產生真實邀請':link?'重新產生邀請連結':'產生邀請連結'}</button></div>
}

type Preview={booking:{customer:string;service:string;spec:string;date:string;start:number;end:number;status:string}};
export default function BookingInvitation({token,user,lineUrl}:{token:string;user:{friend:boolean}|null;lineUrl:string}){
 const [preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 const login='/api/auth/line?returnTo='+encodeURIComponent('invite/'+token);
 useEffect(()=>{
  if(!user)return;
  const controller=new AbortController();setLoading(true);setError('');setPreview(null);
  api<Preview>('/invitations/preview','POST',{token},controller.signal).then(p=>{if(!controller.signal.aborted)setPreview(p)}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[token,user,attempt]);
 async function claim(){setBusy(true);setError('');try{await api('/invitations/claim','POST',{token});setDone(true);history.replaceState(null,'',location.pathname+location.search+'#invite-complete')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <main className="container page narrow invitation-page"><div className="eyebrow">YOUR RESERVATION</div><h1>{done?'已綁定預約通知':'綁定 LINE 預約通知'}</h1>{done?<><div className="success-icon"><Check size={32}/></div><p>這筆預約已連結到你的 LINE 帳號。<br/>待確認預約仍需等候店家確認；已確認預約會傳送成功通知。</p><a className="button" href="#my">查看我的預約</a></>:!user?<div className="line-login"><MessageCircle size={30}/><p>店家為你建立了預約。請使用自己的 LINE 帳號登入，確認預約資料後綁定通知。</p><a className="button line-button" href={login}>使用 LINE 登入</a></div>:loading?<DataLoading label="載入邀請預約中…"/>:!preview?<DataError message={error||'邀請連結無效'} onRetry={()=>setAttempt(n=>n+1)}/>:<><div className="summary-box"><h3>{preview.booking.customer} 的預約</h3><p>{preview.booking.service}・{preview.booking.spec}</p><p>{preview.booking.date}　{new Date(preview.booking.start).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'})}–{new Date(preview.booking.end).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'})}</p><p>{preview.booking.status==='confirmed'?'店家已確認此預約':'等待店家確認'}</p></div>{!user.friend?<div className="notice-box"><MessageCircle size={20}/><div><p>請先加入官方帳號好友，讓店家可以傳送通知，再重新登入確認。</p>{lineUrl&&<a className="text-link" href={lineUrl} target="_blank" rel="noreferrer">加入官方帳號好友</a>}<a className="text-link" href={login}>重新登入確認</a></div></div>:<><p>請確認這是你的預約。綁定後，這個 LINE 帳號就能查看並接收此筆預約通知。</p>{error&&<div className="error-box" role="alert">{error}</div>}<button className="button" disabled={busy} onClick={()=>void claim()}>{busy?'綁定中…':'確認並綁定這筆預約'}</button></>}</>}</main>
}
