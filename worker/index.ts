import {SERVICES,DEFAULT_SETTINGS,availableSlots,normalizeWindows,withinCalendarMonths,weekday,taipeiMs,taipeiDay,serviceDuration,priceFor,statusLabel,type Settings,type Service,type Addons} from '../src/domain.ts';
import {sign,verify,session,isAdmin,cookies,cookie,validLineSignature,sameOrigin,type Env,type Session} from './security.ts';
type Booking={id:string;user_id:string|null;customer:string;phone:string;note:string;service_id:string;service_name:string;spec:string;addons:string;date:string;start:number;end:number;price:number;price_confirmed:number;status:string;expires_at:number|null;created_at:number;updated_at:number;paid:number;paid_amount:number|null;previous_id:string|null;group_code:string|null;companion:string;version:number};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function text(value:unknown,max=200,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('請檢查必填欄位與字數');return value.trim();}
function integer(value:unknown,min:number,max:number){if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)fail('設定數值不在允許範圍');return value as number;}
function addonInput(value:unknown):Addons{const a=value as Addons;if(!a||typeof a.lower!=='boolean'||!['none','own','other'].includes(a.removal))fail('加購選項錯誤');return {lower:a.lower,removal:a.removal};}
async function body(req:Request){const raw=await req.text();if(raw.length>20000)fail('資料過長',413);try{return JSON.parse(raw) as Record<string,unknown>}catch{fail('資料格式錯誤')}}
async function settings(env:Env):Promise<Settings>{const row=await env.DB.prepare('SELECT data FROM settings WHERE id=1').first<{data:string}>();return row?JSON.parse(row.data):structuredClone(DEFAULT_SETTINGS)}
async function services(env:Env):Promise<Service[]>{const {results}=await env.DB.prepare('SELECT data FROM services ORDER BY rowid').all<{data:string}>();return results.length?results.map(r=>JSON.parse(r.data)):structuredClone(SERVICES)}
async function audit(env:Env,s:Session,action:string,id:string|null=null){await env.DB.prepare('INSERT INTO audit(id,actor,action,booking_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),s.id,action,id,Date.now()).run();}
async function occupied(env:Env,date:string){const {results}=await env.DB.prepare("SELECT start,end FROM bookings WHERE date=? AND status IN ('pending','confirmed')").bind(date).all<{start:number;end:number}>();return results;}
async function windows(env:Env,date:string,s:Settings):Promise<[string,string][]>{const r=await env.DB.prepare('SELECT windows FROM exceptions WHERE date=?').bind(date).first<{windows:string}>();return r?JSON.parse(r.windows):s.weekly[String(weekday(date))]||[];}
async function expire(env:Env){const now=Date.now();await env.DB.batch([
 env.DB.prepare("INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) SELECT lower(hex(randomblob(16))),id,user_id,'expired','您的預約申請因尚未獲得店家確認而失效，請重新選擇時段。' FROM bookings WHERE status='pending' AND expires_at<=? AND user_id IS NOT NULL").bind(now),
 env.DB.prepare("UPDATE bookings SET status='expired',updated_at=?,version=version+1 WHERE status='pending' AND expires_at<=?").bind(now,now)
]);}
async function rateLimit(req:Request,env:Env){const ip=req.headers.get('cf-connecting-ip')||'local';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.AUTH_SECRET}:${ip}:${Math.floor(Date.now()/60000)}`));const id=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');const r=await env.DB.prepare('INSERT INTO request_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,Date.now()+120000).first<{count:number}>();if((r?.count||0)>20)fail('操作過於頻繁，請稍後再試',429);}
function validateWindows(value:unknown):[string,string][]{try{return normalizeWindows(value)}catch(e){fail((e as Error).message)}}
function validateSettings(d:Record<string,unknown>):Settings{const w=d.weekly as Record<string,unknown>;if(!w)fail('請設定每週排班');const weekly:Settings['weekly']={};for(let i=0;i<7;i++)weekly[i]=validateWindows(w[i]);const ad=d.addonDurations as Record<string,unknown>;if(!ad)fail('缺少加購服務时间');const dur=(v:unknown)=>v===null?null:integer(v,0,360);return {
 address:text(d.address,300),instagram:text(d.instagram,300),lineUrl:text(d.lineUrl,300),policies:text(d.policies,3000),weekly,
 bookingDays:integer(d.bookingDays,1,90),leadHours:integer(d.leadHours,0,168),cancelHours:integer(d.cancelHours,0,168),approvalHours:integer(d.approvalHours,1,72),bufferMinutes:integer(d.bufferMinutes,0,120),stepMinutes:integer(d.stepMinutes,5,120),reminders:d.reminders===true,addonDurations:{lower:dur(ad.lower),own:dur(ad.own),other:dur(ad.other)}
};}
function safeLink(value:string){return !value||/^https:\/\//.test(value)}
async function authRoutes(req:Request,env:Env,path:string,origin:string):Promise<Response|null>{
 if(path==='/api/auth/line'){
  if(!env.LINE_LOGIN_CHANNEL_ID||!env.LINE_LOGIN_CHANNEL_SECRET||!env.AUTH_SECRET||env.AUTH_SECRET.length<32)fail('LINE 登入尚未設定，請聯絡店家',503);
  const state=crypto.randomUUID(),nonce=crypto.randomUUID();const returnTo=new URL(req.url).searchParams.get('returnTo')==='admin'?'admin':'booking';
  const token=await sign({state,nonce,returnTo,expires:Date.now()+600000},env.AUTH_SECRET);const url=new URL('https://access.line.me/oauth2/v2.1/authorize');
  Object.entries({response_type:'code',client_id:env.LINE_LOGIN_CHANNEL_ID,redirect_uri:origin+'/api/auth/line/callback',state,scope:'openid profile',nonce,bot_prompt:'aggressive'}).forEach(([k,v])=>url.searchParams.set(k,v));
  return new Response(null,{status:302,headers:{Location:url.toString(),'Set-Cookie':cookie('linyan_oauth',token,600,origin.startsWith('https:'))}});
 }
 if(path==='/api/auth/line/callback'){
  const url=new URL(req.url);const o=await verify<{state:string;nonce:string;returnTo:string;expires:number}>(cookies(req).linyan_oauth,env.AUTH_SECRET);
  if(!o||o.expires<Date.now()||url.searchParams.get('state')!==o.state||!url.searchParams.get('code'))fail('登入驗證已失效，請重新登入',401);
  const resp=await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code')!,redirect_uri:origin+'/api/auth/line/callback',client_id:env.LINE_LOGIN_CHANNEL_ID!,client_secret:env.LINE_LOGIN_CHANNEL_SECRET!})});
  if(!resp.ok)fail('LINE 登入失敗，請重試',401);const t=await resp.json() as {id_token:string;access_token:string};
  const vr=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',body:new URLSearchParams({id_token:t.id_token,client_id:env.LINE_LOGIN_CHANNEL_ID!})});
  if(!vr.ok)fail('LINE 身分驗證失敗',401);const identity=await vr.json() as {sub:string;name:string;nonce:string};if(identity.nonce!==o.nonce)fail('登入驗證失敗',401);
  let friend=false;const fr=await fetch('https://api.line.me/friendship/v1/status',{headers:{Authorization:`Bearer ${t.access_token}`}});if(fr.ok)friend=(await fr.json() as {friendFlag:boolean}).friendFlag===true;
  await env.DB.prepare('INSERT INTO users(id,name,friend,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,friend=excluded.friend,updated_at=excluded.updated_at').bind(identity.sub,identity.name||'LINE 使用者',friend?1:0,Date.now()).run();
  const tok=await sign({id:identity.sub,name:identity.name,expires:Date.now()+7*86400000},env.AUTH_SECRET!);
  const headers=new Headers({Location:origin+'/#'+(o.returnTo==='admin'?'admin':'booking')});headers.append('Set-Cookie',cookie('linyan_session',tok,7*86400,origin.startsWith('https:')));headers.append('Set-Cookie',cookie('linyan_oauth','',0,origin.startsWith('https:')));return new Response(null,{status:302,headers});
 }return null;
}
async function pushNotifications(env:Env){
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)return;
 const rows=await env.DB.prepare("SELECT id,booking_id,user_id,kind,text,attempts FROM notifications WHERE state IN ('queued','failed','sending') AND retry_at<=? AND lease_until<? AND attempts<5 LIMIT 10").bind(Date.now(),Date.now()).all<{id:string;booking_id:string;user_id:string;kind:string;text:string;attempts:number}>();
 for(const n of rows.results){
  const claim=await env.DB.prepare("UPDATE notifications SET state='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND state IN ('queued','failed','sending')").bind(Date.now()+120000,n.id,Date.now()).run();if(!claim.meta.changes)continue;
  try{const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json','X-Line-Retry-Key':n.id.length===32?`${n.id.slice(0,8)}-${n.id.slice(8,12)}-${n.id.slice(12,16)}-${n.id.slice(16,20)}-${n.id.slice(20)}`:n.id},body:JSON.stringify({to:n.user_id,messages:[{type:'text',text:n.text}]})});
   if(r.ok||r.status===409){await env.DB.prepare("UPDATE notifications SET state='accepted',sent_at=?,error=NULL,lease_until=0 WHERE id=?").bind(Date.now(),n.id).run();}
   else{await env.DB.prepare("UPDATE notifications SET state='failed',error=?,retry_at=?,lease_until=0 WHERE id=?").bind(r.status===429?'LINE 額度或頻率限制':`LINE API ${r.status}`,Date.now()+Math.min(86400000,60000*2**n.attempts),n.id).run();}
  }catch{await env.DB.prepare("UPDATE notifications SET state='failed',error='LINE 連線失敗',retry_at=?,lease_until=0 WHERE id=?").bind(Date.now()+300000,n.id).run();}
 }
}
async function api(req:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(req.url),path=url.pathname,method=req.method,origin=env.APP_ORIGIN||url.origin;
 if(path==='/api/health')return json({ok:true});
 if(!env.DB)fail('資料庫尚未連接',503);
 if(path==='/api/line/webhook'&&method==='POST'){
  const raw=await req.text();if(raw.length>100000)fail('資料過長',413);if(!await validLineSignature(raw,req.headers.get('x-line-signature'),env.LINE_CHANNEL_SECRET))fail('簽章驗證失敗',401);
  const data=JSON.parse(raw) as {events:{webhookEventId:string;type:string;source:{userId?:string}}[]};for(const event of data.events||[]){
   const uid=event.source?.userId;if(!uid||!['follow','unfollow'].includes(event.type))continue;
   // Event insertion and friend update are one atomic batch; duplicate events cannot overwrite newer state.
   const seen=await env.DB.prepare('SELECT id FROM webhook_events WHERE id=?').bind(event.webhookEventId).first();if(seen)continue;
   try{await env.DB.batch([env.DB.prepare('INSERT INTO webhook_events(id,created_at) VALUES(?,?)').bind(event.webhookEventId,Date.now()),env.DB.prepare('INSERT INTO users(id,name,friend,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET friend=excluded.friend,updated_at=excluded.updated_at').bind(uid,'LINE 使用者',event.type==='follow'?1:0,Date.now())]);}catch{/* duplicate redelivery */}
  }return json({ok:true});
 }
 const auth=await authRoutes(req,env,path,origin);if(auth)return auth;
 const s=await session(req,env);
 if(path==='/api/me'&&method==='GET'){const user=s?await env.DB.prepare('SELECT friend FROM users WHERE id=?').bind(s.id).first<{friend:number}>():null;return json({user:s?{id:s.id,name:s.name,friend:user?.friend===1,admin:isAdmin(s,env)}:null});}
 if(path==='/api/public'&&method==='GET'){const config=await settings(env),items=await services(env);return json({settings:config,services:items.filter(x=>x.active),lineReady:!!env.LINE_LOGIN_CHANNEL_ID&&!!env.LINE_LOGIN_CHANNEL_SECRET&&!!env.AUTH_SECRET,lineUrl:env.LINE_ADD_FRIEND_URL||config.lineUrl});}
 if(path==='/api/availability'&&method==='GET'){
  const date=url.searchParams.get('date')||'';taipeiMs(date,'00:00');const item=(await services(env)).find(x=>x.id===url.searchParams.get('service')&&x.active);if(!item)fail('服務不存在',404);const a: Addons={lower:url.searchParams.get('lower')==='true',removal:(url.searchParams.get('removal')||'none') as Addons['removal']};addonInput(a);priceFor(item,0,a);
  const cfg=await settings(env),duration=serviceDuration(item,a,cfg);if(!duration)return json({slots:[],reason:'店家尚未設定此服務時間'});await expire(env);
  return json({slots:availableSlots(date,duration,cfg,await windows(env,date,cfg),await occupied(env,date)),duration});
 }
 if(!['GET','HEAD'].includes(method)){if(!sameOrigin(req,origin))fail('請從網站頁面操作',403);await rateLimit(req,env);}
 if(path==='/api/logout'&&method==='POST')return new Response('{}',{headers:{'Content-Type':'application/json','Set-Cookie':cookie('linyan_session','',0,origin.startsWith('https:'))}});
 if(!s)fail('請先使用 LINE 登入',401);
 if(path==='/api/bookings'&&method==='GET'){await expire(env);const rows=await env.DB.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY start DESC LIMIT 100').bind(s.id).all<Booking>();return json({bookings:rows.results});}
 if(path==='/api/bookings'&&method==='POST'){
  const friend=await env.DB.prepare('SELECT friend FROM users WHERE id=?').bind(s.id).first<{friend:number}>();if(!friend?.friend)fail('請先加入官方帳號好友，再重新登入確認',403);return createBooking(req,env,s,false);
 }
 const cancel=path.match(/^\/api\/bookings\/([^/]+)\/cancel$/);if(cancel&&method==='POST'){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').bind(cancel[1],s.id).first<Booking>();if(!b)fail('預約不存在',404);if(!['pending','confirmed'].includes(b.status))fail('此預約無法取消',409);const cfg=await settings(env);if(b.start-Date.now()<cfg.cancelHours*3600000)fail('已超過線上取消期限，請聯絡店家',409);
  const r=await env.DB.prepare("UPDATE bookings SET status='cancelled',updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','confirmed')").bind(Date.now(),b.id,b.version).run();if(!r.meta.changes)fail('預約狀態已更新，請重新整理',409);await notify(env,b,'cancelled','您的預約已取消，時段已釋出。',origin);ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(!path.startsWith('/api/admin'))fail('找不到此功能',404);if(!isAdmin(s,env))fail('此帳號沒有管理權限',403);
 if(path==='/api/admin/quota'&&method==='GET'){
  if(!env.LINE_CHANNEL_ACCESS_TOKEN)return json({available:false,reason:'LINE 推播尚未設定'});
  const headers={Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`};
  try{const [a,b]=await Promise.all([fetch('https://api.line.me/v2/bot/message/quota',{headers}),fetch('https://api.line.me/v2/bot/message/quota/consumption',{headers})]);if(!a.ok||!b.ok)return json({available:false,reason:'暫時無法查詢 LINE 額度'});const q=await a.json() as {type:string;value?:number},u=await b.json() as {totalUsage:number};return json({available:true,limit:q.value??null,used:u.totalUsage,remaining:q.value==null?null:Math.max(0,q.value-u.totalUsage)});}catch{return json({available:false,reason:'LINE 連線失敗'});}
 }
 if(path==='/api/admin'&&method==='GET'){
  await expire(env);const rows=await env.DB.prepare('SELECT * FROM bookings ORDER BY start DESC LIMIT 1000').all<Booking>();const notifications=await env.DB.prepare('SELECT id,booking_id,kind,state,attempts,error,sent_at FROM notifications ORDER BY rowid DESC LIMIT 300').all();const ex=await env.DB.prepare('SELECT * FROM exceptions ORDER BY date').all();
  return json({bookings:rows.results,notifications:notifications.results,exceptions:ex.results,settings:await settings(env),services:await services(env),ready:{login:!!env.LINE_LOGIN_CHANNEL_ID&&!!env.LINE_LOGIN_CHANNEL_SECRET,notifications:!!env.LINE_CHANNEL_ACCESS_TOKEN,webhook:!!env.LINE_CHANNEL_SECRET,session:!!env.AUTH_SECRET&&env.AUTH_SECRET.length>=32}});
 }
 if(path==='/api/admin/init'&&method==='POST'){
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO settings(id,data) VALUES(1,?)').bind(JSON.stringify(DEFAULT_SETTINGS)),...SERVICES.map(x=>env.DB.prepare('INSERT OR IGNORE INTO services(id,data) VALUES(?,?)').bind(x.id,JSON.stringify(x)))]);await audit(env,s,'initialize');return json({ok:true});
 }
 if(path==='/api/admin/settings'&&method==='PUT'){
  const cfg=validateSettings(await body(req));if(!safeLink(cfg.lineUrl)||!safeLink(cfg.instagram))fail('連結需使用 https://');await env.DB.prepare('INSERT INTO settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(JSON.stringify(cfg)).run();await audit(env,s,'update_settings');return json({ok:true,message:'設定已儲存，既有預約保留原時段，請檢查行事曆。'});
 }
 if(path==='/api/admin/services'&&method==='PUT'){
  const d=await body(req),input=d.services;if(!Array.isArray(input)||input.length>30)fail('服務資料格式錯誤');const known=new Set(SERVICES.map(x=>x.id));const updated:Service[]=input.map(x=>{const v=x as Service;if(!known.has(v.id))fail('服務識別碼錯誤');if(!Array.isArray(v.specs)||v.specs.length<1||v.specs.length>5)fail('服務規格錯誤');return {id:v.id,name:text(v.name,80,true),description:text(v.description,500),category:SERVICES.find(k=>k.id===v.id)!.category,specs:v.specs.map(a=>({label:text(a.label,80,true),price:integer(a.price,0,100000)})),duration:v.duration===null?null:integer(v.duration,5,600),active:v.active===true}});await env.DB.batch(updated.map(v=>env.DB.prepare('INSERT INTO services(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(v.id,JSON.stringify(v))));await audit(env,s,'update_services');return json({ok:true});
 }
 if(path==='/api/admin/exceptions'&&method==='PUT'){
  const d=await body(req),date=text(d.date,10,true);try{taipeiMs(date,'00:00')}catch(e){fail((e as Error).message)}if(d.remove===true){await env.DB.prepare('DELETE FROM exceptions WHERE date=?').bind(date).run();}else{const w=validateWindows(d.windows);await env.DB.prepare('INSERT INTO exceptions(date,windows) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET windows=excluded.windows').bind(date,JSON.stringify(w)).run();}await audit(env,s,'update_exception');return json({ok:true,message:'已更新當日排班；既有預約不會自動取消，請檢查並聯絡受影響客人。'});
 }
 if(path==='/api/admin/bookings'&&method==='POST')return createBooking(req,env,s,true);
 const action=path.match(/^\/api\/admin\/bookings\/([^/]+)$/);if(action&&method==='PATCH'){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(action[1]).first<Booking>();if(!b)fail('預約不存在',404);const d=await body(req);const version=integer(d.version,1,1000000);if(version!==b.version)fail('預約已被更新，請重新整理',409);
  const next=text(d.status,20,true);const allowed:Record<string,string[]>={pending:['confirmed','rejected','cancelled'],confirmed:['confirmed','completed','cancelled','no_show'],completed:['completed'],no_show:['no_show'],cancelled:['cancelled'],rejected:['rejected'],expired:['expired']};if(!allowed[b.status]?.includes(next))fail('不允許此狀態變更',409);if(b.status==='pending'&&b.expires_at!<=Date.now())fail('申請已失效，請客人重新預約',409);
  const price=integer(d.price??b.price,0,100000),paid=d.paid===true?1:0;const paidAmount=paid?integer(d.paidAmount??price,0,100000):null;
  if(next==='confirmed'&&['refill','touchup'].includes(b.service_id)){
   const previous=await env.DB.prepare("SELECT * FROM bookings WHERE id=? AND status='completed'").bind(b.previous_id||'').first<Booking>();const eligible=previous&&(b.service_id==='refill'?b.start>previous.start&&b.start-previous.start<=14*86400000:withinCalendarMonths(previous.start,b.start,3));if(!previous||previous.user_id!==b.user_id||(!b.user_id&&previous.phone!==b.phone)||!eligible||(b.service_id==='touchup'&&previous.service_id!=='brows')||(b.service_id==='refill'&&!['single','3d','6d','yy'].includes(previous.service_id)))fail('優惠資格不符，請核對前次已完成服務',409);
  }
  if(next==='confirmed'&&b.service_id==='refill'&&price===0)fail('請填寫核對後的原款式半價金額',409);
  if(next==='confirmed'&&b.service_id==='touchup'&&price!==0)fail('符合三個月內補色資格時應為免費',409);
  if(next==='confirmed'&&b.service_id==='brows'&&b.spec.includes('兩人')){const linked=await env.DB.prepare("SELECT id FROM bookings WHERE group_code=? AND id<>? AND service_id='brows' AND status IN ('pending','confirmed','completed')").bind(b.group_code,b.id).first();if(!linked)fail('同行優惠需先建立第二位客人的關聯預約',409);}
  const r=await env.DB.prepare('UPDATE bookings SET status=?,price=?,price_confirmed=1,paid=?,paid_amount=?,paid_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(next,price,paid,paidAmount,paid?Date.now():null,Date.now(),b.id,version).run();if(!r.meta.changes)fail('預約已被更新',409);
  await audit(env,s,`booking_${next}`,b.id);if(next!==b.status&&['confirmed','rejected','cancelled'].includes(next))await notify(env,b,next,next==='confirmed'?`您的預約已確認 ✨\n日期：${b.date}\n時間：${new Date(b.start+8*3600000).toISOString().slice(11,16)}\n服務：${b.service_name} ${b.spec}\n金額：NT$${price}\n付款：到店付現\n${(await settings(env)).address}`:next==='rejected'?'很抱歉，此次預約未能成立，請重新選擇時段或聯絡店家。':'您的預約已由店家取消，請聯絡店家確認。',origin);
  ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(path==='/api/admin/retry'&&method==='POST'){
  const d=await body(req),id=text(d.id,80,true);await env.DB.prepare("UPDATE notifications SET state='queued',attempts=0,retry_at=0 WHERE id=? AND state='failed' AND lease_until<?").bind(id,Date.now()).run();await audit(env,s,'retry_notification');ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(path==='/api/admin/export'&&method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM bookings ORDER BY start DESC').all<Booking>();const cell=(v:unknown)=>{let t=String(v??'');if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"'};const lines=[['預約編號','日期','時間','姓名','電話','服務','規格','狀態','應付','已收現金'],...rows.results.map(b=>[b.id,b.date,new Date(b.start+8*3600000).toISOString().slice(11,16),b.customer,b.phone,b.service_name,b.spec,statusLabel[b.status],b.price,b.paid?b.paid_amount:0])];await audit(env,s,'export_bookings');return new Response('\ufeff'+lines.map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="bookings.csv"','Cache-Control':'no-store'}});
 }fail('找不到此功能',404);
}
async function createBooking(req:Request,env:Env,s:Session,admin:boolean){
 const d=await body(req);const cfg=await settings(env);const item=(await services(env)).find(x=>x.id===d.serviceId&&x.active);if(!item)fail('此服務目前不開放',404);const spec=integer(d.spec,0,item.specs.length-1),a=addonInput(d.addons);const price=priceFor(item,spec,a),duration=serviceDuration(item,a,cfg);if(!duration)fail('店家尚未設定此服務時間',409);
 const date=text(d.date,10,true),time=text(d.time,5,true),start=taipeiMs(date,time),end=start+(duration+cfg.bufferMinutes)*60000;await expire(env);const slots=availableSlots(date,duration,cfg,await windows(env,date,cfg),await occupied(env,date));if(!slots.includes(time))fail('此時段已無法預約，請重新選擇',409);
 const customer=text(d.customer,80,true),phone=text(d.phone,30,true);if(!/^[+\d\s()-]{8,25}$/.test(phone))fail('請輸入有效聯絡電話');const note=text(d.note||'',1000),previous=text(d.previousId||'',80),companion=text(d.companion||'',80);if(['refill','touchup'].includes(item.id)&&!previous)fail('請填寫前次預約編號供店家核對');if(item.id==='brows'&&spec===1&&!companion)fail('請填寫同行者姓名');
 const id=crypto.randomUUID(),now=Date.now();let group:string|null=null;if(item.id==='brows'&&spec===1){group=crypto.randomUUID();if(d.groupCode){const code=text(d.groupCode,80,true);const existing=await env.DB.prepare("SELECT id FROM bookings WHERE group_code=? AND service_id='brows' AND status IN ('pending','confirmed')").bind(code).all();if(existing.results.length!==1)fail('同行預約識別碼無效或已額滿');group=code;}}
 try{await env.DB.prepare('INSERT INTO bookings(id,user_id,customer,phone,note,service_id,service_name,spec,addons,date,start,end,price,status,expires_at,created_at,updated_at,previous_id,group_code,companion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,admin?null:s.id,customer,phone,note,item.id,item.name,item.specs[spec].label,JSON.stringify(a),date,start,end,price,'pending',now+cfg.approvalHours*3600000,now,now,previous||null,group,companion).run();}catch(e){if(String(e).includes('GROUP_FULL'))fail('此同行優惠已額滿',409);if(String(e).includes('SLOT_TAKEN'))fail('此時段剛被其他客人預約，請選擇其他時段',409);throw e;}
 if(admin)await audit(env,s,'manual_booking',id);return json({ok:true,id,groupCode:group,status:'pending'},201);
}
async function notify(env:Env,b:Pick<Booking,'id'|'user_id'>,kind:string,message:string,origin:string){if(!b.user_id)return;await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.id,b.user_id,kind,message+'\n查看預約：'+origin+'/#my').run();}
async function scheduled(env:Env){if(!env.DB)return;await expire(env);const cfg=await settings(env);if(cfg.reminders){const now=Date.now();await env.DB.prepare("INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) SELECT lower(hex(randomblob(16))),id,user_id,'reminder','提醒您明日的預約：'||date||' '||service_name||'。到店現金付款，詳情請至我的預約查看。' FROM bookings WHERE status='confirmed' AND user_id IS NOT NULL AND start BETWEEN ? AND ?").bind(now+23*3600000,now+24*3600000).run();}await pushNotifications(env);await env.DB.batch([env.DB.prepare('DELETE FROM request_limits WHERE expires<?').bind(Date.now()),env.DB.prepare('DELETE FROM webhook_events WHERE created_at<?').bind(Date.now()-30*86400000)]);}
export default {
 async fetch(req:Request,env:Env,ctx:ExecutionContext){try{let response=new URL(req.url).pathname.startsWith('/api/')?await api(req,env,ctx):await env.ASSETS.fetch(req);response=new Response(response.body,response);response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");return response;}catch(e){const error=e as Error&{status?:number};return json({error:error.status?error.message:'系統暫時無法處理，請稍後再試'},error.status||500);}},
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(scheduled(env));}
};
