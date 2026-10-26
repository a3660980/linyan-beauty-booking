import {SERVICES,DEFAULT_SETTINGS,availableSlots,bookingDates,windowsForDate,normalizeWindows,withinCalendarMonths,weekday,taipeiMs,taipeiDay,serviceDuration,priceFor,statusLabel,cleanupMinutes,serviceEnd,type DateSchedule,type Settings,type Service,type Addons} from '../src/domain.ts';
import {sign,verify,session,isAdmin,cookies,cookie,validLineSignature,sameOrigin,safeReturnTo,isAdminId,type Env,type Session} from './security.ts';
import {createInvitation,useInvitation,confirmationText} from './invitations.ts';
import {assertBookingEligibility} from './bookingRules.ts';
import {expireChanges,bookingChanges,customerChange,proposeChange,customerChangeDetails,respondToChange,withdrawChange,type BookingChange} from './rescheduling.ts';
import {calendarFeed,manageCalendarSubscription} from './calendar.ts';
type Booking={id:string;user_id:string|null;customer:string;phone:string;note:string;service_id:string;service_name:string;spec:string;addons:string;date:string;start:number;end:number;service_end?:number|null;price:number;price_confirmed:number;status:string;expires_at:number|null;created_at:number;updated_at:number;paid:number;paid_amount:number|null;paid_at:number|null;previous_id:string|null;group_code:string|null;companion:string;version:number};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function text(value:unknown,max=200,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('請檢查必填欄位與字數');return value.trim();}
function integer(value:unknown,min:number,max:number){if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)fail('設定數值不在允許範圍');return value as number;}
function addonInput(value:unknown):Addons{const a=value as Addons;if(!a||typeof a.lower!=='boolean'||!['none','own','other'].includes(a.removal))fail('加購選項錯誤');return {lower:a.lower,removal:a.removal};}
async function body(req:Request){const raw=await req.text();if(raw.length>20000)fail('資料過長',413);try{return JSON.parse(raw) as Record<string,unknown>}catch{fail('資料格式錯誤')}}
async function settings(env:Env):Promise<Settings>{const row=await env.DB.prepare('SELECT data FROM settings WHERE id=1').first<{data:string}>();return row?JSON.parse(row.data):structuredClone(DEFAULT_SETTINGS)}
async function services(env:Env):Promise<Service[]>{const {results}=await env.DB.prepare('SELECT data FROM services ORDER BY rowid').all<{data:string}>();return results.length?results.map(r=>JSON.parse(r.data)):structuredClone(SERVICES)}
async function reviewRecipient(env:Env){const row=await env.DB.prepare("SELECT user_id FROM notification_recipients WHERE kind='review_requested'").first<{user_id:string}>();return row&&isAdminId(row.user_id,env)?row.user_id:null;}
async function audit(env:Env,s:Session,action:string,id:string|null=null){await env.DB.prepare('INSERT INTO audit(id,actor,action,booking_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),s.id,action,id,Date.now()).run();}
async function occupied(env:Env,date:string){const {results}=await env.DB.prepare("SELECT start,end FROM bookings WHERE date=? AND status IN ('pending','confirmed') UNION ALL SELECT start,end FROM booking_changes WHERE date=? AND state='pending' AND expires_at>?").bind(date,date,Date.now()).all<{start:number;end:number}>();return results;}
async function windows(env:Env,date:string,s:Settings):Promise<[string,string][]>{const r=await env.DB.prepare('SELECT windows FROM exceptions WHERE date=?').bind(date).first<{windows:string}>();return r?JSON.parse(r.windows):s.weekly[String(weekday(date))]||[];}
async function expire(env:Env){const now=Date.now();await expireChanges(env,now);await env.DB.batch([
 env.DB.prepare("INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) SELECT lower(hex(randomblob(16))),id,user_id,'expired','您的預約申請因尚未獲得店家確認而失效，請重新選擇時段。' FROM bookings WHERE status='pending' AND expires_at<=? AND user_id IS NOT NULL").bind(now),
 env.DB.prepare("UPDATE bookings SET status='expired',updated_at=?,version=version+1 WHERE status='pending' AND expires_at<=?").bind(now,now)
]);}
async function rateLimit(req:Request,env:Env){const ip=req.headers.get('cf-connecting-ip')||'local';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.AUTH_SECRET}:${ip}:${Math.floor(Date.now()/60000)}`));const id=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');const r=await env.DB.prepare('INSERT INTO request_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,Date.now()+120000).first<{count:number}>();if((r?.count||0)>20)fail('操作過於頻繁，請稍後再試',429);}
function validateWindows(value:unknown):[string,string][]{try{return normalizeWindows(value)}catch(e){fail((e as Error).message)}}
function validateSettings(d:Record<string,unknown>):Settings{const w=d.weekly as Record<string,unknown>;if(!w)fail('請設定每週排班');const weekly:Settings['weekly']={};for(let i=0;i<7;i++)weekly[i]=validateWindows(w[i]);const ad=d.addonDurations as Record<string,unknown>;if(!ad)fail('缺少加購服務时间');const dur=(v:unknown)=>v===null?null:integer(v,0,360);return {
 address:text(d.address,300),instagram:text(d.instagram,300),lineUrl:text(d.lineUrl,300),policies:text(d.policies,3000),weekly,
 bookingDays:integer(d.bookingDays,1,90),leadHours:integer(d.leadHours,0,168),cancelHours:integer(d.cancelHours,0,168),approvalHours:integer(d.approvalHours,1,72),bufferMinutes:integer(d.bufferMinutes,10,120),stepMinutes:integer(d.stepMinutes,5,120),reminders:d.reminders===true,addonDurations:{lower:dur(ad.lower),own:dur(ad.own),other:dur(ad.other)}
};}
function safeLink(value:string){return !value||/^https:\/\//.test(value)}
async function authRoutes(req:Request,env:Env,path:string,origin:string):Promise<Response|null>{
 if(path==='/api/auth/line'){
  if(!env.LINE_LOGIN_CHANNEL_ID||!env.LINE_LOGIN_CHANNEL_SECRET||!env.AUTH_SECRET||env.AUTH_SECRET.length<32)fail('LINE 登入尚未設定，請聯絡店家',503);
  const state=crypto.randomUUID(),nonce=crypto.randomUUID();const requested=new URL(req.url).searchParams.get('returnTo');const returnTo=safeReturnTo(requested);
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
  const headers=new Headers({Location:origin+'/#'+safeReturnTo(o.returnTo)});headers.append('Set-Cookie',cookie('linyan_session',tok,7*86400,origin.startsWith('https:')));headers.append('Set-Cookie',cookie('linyan_oauth','',0,origin.startsWith('https:')));return new Response(null,{status:302,headers});
 }return null;
}
async function pushNotifications(env:Env){
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)return;
 const rows=await env.DB.prepare("SELECT id,booking_id,user_id,kind,text,attempts FROM notifications WHERE state IN ('queued','failed','sending') AND retry_at<=? AND lease_until<? AND attempts<5 LIMIT 10").bind(Date.now(),Date.now()).all<{id:string;booking_id:string;user_id:string;kind:string;text:string;attempts:number}>();
 for(const n of rows.results){
  if((n.kind==='review_requested'||n.kind.startsWith('reschedule_response:'))&&!isAdminId(n.user_id,env)){await env.DB.prepare("UPDATE notifications SET state='failed',attempts=5,error='通知對象已無管理權限',lease_until=0 WHERE id=?").bind(n.id).run();continue;}
  if(n.kind.startsWith('reschedule_requested:')){
   const proposal=await env.DB.prepare("SELECT id FROM booking_changes WHERE id=? AND state='pending' AND expires_at>?").bind(n.kind.slice('reschedule_requested:'.length),Date.now()).first();
   if(!proposal){await env.DB.prepare("UPDATE notifications SET state='failed',attempts=5,error='改期提案已失效',lease_until=0 WHERE id=?").bind(n.id).run();continue;}
  }
  const claim=await env.DB.prepare("UPDATE notifications SET state='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND lease_until<? AND state IN ('queued','failed','sending')").bind(Date.now()+120000,n.id,Date.now()).run();if(!claim.meta.changes)continue;
  try{const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json','X-Line-Retry-Key':n.id.length===32?`${n.id.slice(0,8)}-${n.id.slice(8,12)}-${n.id.slice(12,16)}-${n.id.slice(16,20)}-${n.id.slice(20)}`:n.id},body:JSON.stringify({to:n.user_id,messages:[{type:'text',text:n.text}]})});
   if(r.ok||r.status===409){await env.DB.prepare("UPDATE notifications SET state='accepted',sent_at=?,error=NULL,lease_until=0 WHERE id=?").bind(Date.now(),n.id).run();}
   else{await env.DB.prepare("UPDATE notifications SET state='failed',error=?,retry_at=?,lease_until=0 WHERE id=?").bind(r.status===429?'LINE 額度或頻率限制':`LINE API ${r.status}`,Date.now()+Math.min(86400000,60000*2**n.attempts),n.id).run();}
  }catch{await env.DB.prepare("UPDATE notifications SET state='failed',error='LINE 連線失敗',retry_at=?,lease_until=0 WHERE id=?").bind(Date.now()+300000,n.id).run();}
 }
}
async function api(req:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(req.url),path=url.pathname,method=req.method,origin=new URL(env.APP_ORIGIN||url.origin).origin;
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
 try{const auth=await authRoutes(req,env,path,origin);if(auth)return auth}catch(e){
  if(!['/api/auth/line','/api/auth/line/callback'].includes(path))throw e;
  const error=e as Error&{status?:number};
  const previous=await verify<{returnTo:string}>(cookies(req).linyan_oauth,env.AUTH_SECRET);
  const requested=previous?.returnTo||url.searchParams.get('returnTo');
  const returnTo=safeReturnTo(requested);
  const reason=url.searchParams.get('error')==='access_denied'?'cancelled':error.status===503?'unavailable':error.message.includes('已失效')?'expired':'failed';
  return new Response(null,{status:302,headers:{Location:origin+'/?authError='+reason+'#'+returnTo,'Set-Cookie':cookie('linyan_oauth','',0,origin.startsWith('https:')),'Cache-Control':'no-store'}});
 }
 const s=await session(req,env);
 if(path==='/api/me'&&method==='GET'){const user=s?await env.DB.prepare('SELECT friend FROM users WHERE id=?').bind(s.id).first<{friend:number}>():null;return json({user:s?{id:s.id,name:s.name,friend:user?.friend===1,admin:isAdmin(s,env)}:null});}
 if(path==='/api/public'&&method==='GET'){const config=await settings(env),items=await services(env);return json({settings:config,services:items.filter(x=>x.active),lineReady:!!env.LINE_LOGIN_CHANNEL_ID&&!!env.LINE_LOGIN_CHANNEL_SECRET&&!!env.AUTH_SECRET,lineUrl:env.LINE_ADD_FRIEND_URL||config.lineUrl});}
 if(['/api/availability','/api/availability/dates'].includes(path)&&method==='GET'){
  const range=path.endsWith('/dates'),date=url.searchParams.get('date')||'';if(!range)taipeiMs(date,'00:00');const item=(await services(env)).find(x=>x.id===url.searchParams.get('service')&&x.active);if(!item)fail('服務不存在',404);const a: Addons={lower:url.searchParams.get('lower')==='true',removal:(url.searchParams.get('removal')||'none') as Addons['removal']};addonInput(a);try{priceFor(item,0,a)}catch(e){fail((e as Error).message)}
  const cfg=await settings(env),spec=integer(Number(url.searchParams.get('spec')||'0'),0,item.specs.length-1),duration=serviceDuration(item,a,cfg,spec);if(!duration)return json(range?{days:[],firstAvailableDate:null,duration:null,reason:'店家尚未設定此服務時間'}:{slots:[],reason:'店家尚未設定此服務時間'});await expire(env);
  if(range){
   const now=Date.now(),dates=bookingDates(cfg.bookingDays,now),first=dates[0],last=dates.at(-1)!;
   const [exceptions,occupied]=await Promise.all([
    env.DB.prepare('SELECT date,windows FROM exceptions WHERE date>=? AND date<=?').bind(first,last).all<DateSchedule>(),
    env.DB.prepare("SELECT date,start,end FROM bookings WHERE date>=? AND date<=? AND status IN ('pending','confirmed') UNION ALL SELECT date,start,end FROM booking_changes WHERE date>=? AND date<=? AND state='pending' AND expires_at>?").bind(first,last,first,last,now).all<{date:string;start:number;end:number}>()
   ]);
   const days=dates.map(d=>({date:d,slots:availableSlots(d,duration,cfg,windowsForDate(d,cfg.weekly,exceptions.results),occupied.results.filter(b=>b.date===d),now)}));
   return json({days,firstAvailableDate:days.find(d=>d.slots.length)?.date??null,duration});
  }
  return json({slots:availableSlots(date,duration,cfg,await windows(env,date,cfg),await occupied(env,date)),duration});
 }
 if(!['GET','HEAD'].includes(method)){if(!sameOrigin(req,origin))fail('請從網站頁面操作',403);await rateLimit(req,env);}
 if(path==='/api/logout'&&method==='POST')return new Response('{}',{headers:{'Content-Type':'application/json','Set-Cookie':cookie('linyan_session','',0,origin.startsWith('https:'))}});
 const feed=path.match(/^\/api\/calendar\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.ics$/);
 if(path.startsWith('/api/calendar/')&&['GET','HEAD'].includes(method))return calendarFeed(req,env,feed?.[1]||'',origin);
 if(!s)fail('請先使用 LINE 登入',401);
 if(['/api/invitations/preview','/api/invitations/claim'].includes(path)&&method==='POST'){const response=await useInvitation(req,env,s,path.endsWith('/claim'),origin);if(path.endsWith('/claim'))ctx.waitUntil(pushNotifications(env));return response;}
 if(path==='/api/bookings'&&method==='GET'){await expire(env);const rows=await env.DB.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY start DESC LIMIT 100').bind(s.id).all<Booking>();const changes=await env.DB.prepare("SELECT c.* FROM booking_changes c JOIN bookings b ON b.id=c.booking_id WHERE b.user_id=? AND c.state='pending' AND c.expires_at>?").bind(s.id,Date.now()).all<BookingChange>();return json({bookings:rows.results.map(b=>({reschedule:changes.results.find(c=>c.booking_id===b.id)?customerChange(changes.results.find(c=>c.booking_id===b.id)!):undefined,id:b.id,customer:b.customer,service_id:b.service_id,service_name:b.service_name,spec:b.spec,date:b.date,start:b.start,end:serviceEnd(b),service_end:serviceEnd(b),price:b.price,status:b.status,version:b.version,paid:b.paid,paid_amount:b.paid_amount,group_code:b.group_code,companion:b.companion,previous_id:b.previous_id}))});}
 const changeRoute=path.match(/^\/api\/changes\/([0-9a-f-]{36})(?:\/(respond))?$/);if(changeRoute){if(method==='GET'&&!changeRoute[2])return customerChangeDetails(env,s,changeRoute[1]);if(method==='POST'&&changeRoute[2]){const response=await respondToChange(req,env,s,changeRoute[1],origin);ctx.waitUntil(pushNotifications(env));return response;}}
 if(path==='/api/bookings'&&method==='POST'){
  const friend=await env.DB.prepare('SELECT friend FROM users WHERE id=?').bind(s.id).first<{friend:number}>();if(!friend?.friend)fail('請先加入官方帳號好友，再重新登入確認',403);return createBooking(req,env,s,false,ctx,origin);
 }
 const cancel=path.match(/^\/api\/bookings\/([^/]+)\/cancel$/);if(cancel&&method==='POST'){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').bind(cancel[1],s.id).first<Booking>();if(!b)fail('預約不存在',404);if(!['pending','confirmed'].includes(b.status))fail('此預約無法取消',409);const cfg=await settings(env);if(b.start-Date.now()<cfg.cancelHours*3600000)fail('已超過線上取消期限，請聯絡店家',409);
  const r=await env.DB.prepare("UPDATE bookings SET status='cancelled',updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','confirmed')").bind(Date.now(),b.id,b.version).run();if(!r.meta.changes)fail('預約狀態已更新，請重新整理',409);await notify(env,b,'cancelled','您的預約已取消，時段已釋出。',origin);ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(!path.startsWith('/api/admin'))fail('找不到此功能',404);if(!isAdmin(s,env))fail('此帳號沒有管理權限',403);
 if(path==='/api/admin/customers'&&method==='GET'){
  const rows=await env.DB.prepare(`SELECT id,customer,phone,user_id FROM (
   SELECT id,customer,phone,user_id,ROW_NUMBER() OVER(PARTITION BY COALESCE(user_id,'phone:'||REPLACE(phone,' ','')) ORDER BY created_at DESC,rowid DESC) AS rank FROM bookings
  ) WHERE rank=1 ORDER BY customer LIMIT 1000`).all<{id:string;customer:string;phone:string;user_id:string|null}>();
  return json({customers:rows.results.map(b=>({id:b.id,customer:b.customer,phone:b.phone,lineBound:!!b.user_id}))});
 }
 const changeAdmin=path.match(/^\/api\/admin\/bookings\/([^/]+)\/changes$/);
 if(changeAdmin&&method==='GET'){await expire(env);return json({changes:(await bookingChanges(env,changeAdmin[1])).map(customerChange)});}
 if(changeAdmin&&method==='POST'){await expire(env);const response=await proposeChange(req,env,s,changeAdmin[1],origin);ctx.waitUntil(pushNotifications(env));return response;}
 const withdrawal=path.match(/^\/api\/admin\/changes\/([0-9a-f-]{36})\/withdraw$/);if(withdrawal&&method==='POST'){const response=await withdrawChange(env,s,withdrawal[1],origin);ctx.waitUntil(pushNotifications(env));return response;}
 if(path==='/api/admin/calendar-subscription'&&['GET','POST','PUT','DELETE'].includes(method))return manageCalendarSubscription(req,env,s,origin);
 if(path==='/api/admin/quota'&&method==='GET'){
  if(!env.LINE_CHANNEL_ACCESS_TOKEN)return json({available:false,reason:'LINE 推播尚未設定'});
  const headers={Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`};
  try{const [a,b]=await Promise.all([fetch('https://api.line.me/v2/bot/message/quota',{headers}),fetch('https://api.line.me/v2/bot/message/quota/consumption',{headers})]);if(!a.ok||!b.ok)return json({available:false,reason:'暫時無法查詢 LINE 額度'});const q=await a.json() as {type:string;value?:number},u=await b.json() as {totalUsage:number};return json({available:true,limit:q.value??null,used:u.totalUsage,remaining:q.value==null?null:Math.max(0,q.value-u.totalUsage)});}catch{return json({available:false,reason:'LINE 連線失敗'});}
 }
 if(path==='/api/admin'&&method==='GET'){
  await expire(env);const rows=await env.DB.prepare('SELECT * FROM bookings ORDER BY start DESC LIMIT 1000').all<Booking>();const notifications=await env.DB.prepare('SELECT id,booking_id,kind,state,attempts,error,sent_at FROM notifications ORDER BY rowid DESC LIMIT 300').all();const ex=await env.DB.prepare('SELECT * FROM exceptions ORDER BY date').all();const changes=await env.DB.prepare("SELECT * FROM booking_changes WHERE state='pending' ORDER BY start").all<BookingChange>();
  return json({today:taipeiDay(),changes:changes.results,bookings:rows.results,notifications:notifications.results,exceptions:ex.results,settings:await settings(env),services:await services(env),ready:{login:!!env.LINE_LOGIN_CHANNEL_ID&&!!env.LINE_LOGIN_CHANNEL_SECRET,notifications:!!env.LINE_CHANNEL_ACCESS_TOKEN,webhook:!!env.LINE_CHANNEL_SECRET,session:!!env.AUTH_SECRET&&env.AUTH_SECRET.length>=32,reviewNotifications:!!await reviewRecipient(env)}});
 }
 if(path==='/api/admin/init'&&method==='POST'){
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO settings(id,data) VALUES(1,?)').bind(JSON.stringify(DEFAULT_SETTINGS)),...SERVICES.map(x=>env.DB.prepare('INSERT OR IGNORE INTO services(id,data) VALUES(?,?)').bind(x.id,JSON.stringify(x)))]);await audit(env,s,'initialize');return json({ok:true});
 }
 if(path==='/api/admin/settings'&&method==='PUT'){
  const cfg=validateSettings(await body(req));if(!safeLink(cfg.lineUrl)||!safeLink(cfg.instagram))fail('連結需使用 https://');await env.DB.prepare('INSERT INTO settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(JSON.stringify(cfg)).run();await audit(env,s,'update_settings');return json({ok:true,message:'設定已儲存，既有預約保留原時段，請檢查行事曆。'});
 }
 if(path==='/api/admin/services'&&method==='PUT'){
  const d=await body(req),input=d.services;if(!Array.isArray(input)||input.length>30)fail('服務資料格式錯誤');const known=new Set(SERVICES.map(x=>x.id));const updated:Service[]=input.map(x=>{const v=x as Service;if(!known.has(v.id))fail('服務識別碼錯誤');if(!Array.isArray(v.specs)||v.specs.length<1||v.specs.length>(v.id==='combo-brows-lashes'?20:5))fail('服務規格錯誤');return {id:v.id,name:text(v.name,80,true),description:text(v.description,500),category:SERVICES.find(k=>k.id===v.id)!.category,specs:v.specs.map(a=>({label:text(a.label,80,true),price:integer(a.price,0,100000),...(a.duration===undefined?{}:{duration:a.duration===null?null:integer(a.duration,5,600)})})),duration:v.duration===null?null:integer(v.duration,5,600),active:v.active===true}});await env.DB.batch(updated.map(v=>env.DB.prepare('INSERT INTO services(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(v.id,JSON.stringify(v))));await audit(env,s,'update_services');return json({ok:true});
 }
 if(path==='/api/admin/exceptions'&&method==='PUT'){
  const d=await body(req),date=text(d.date,10,true);try{taipeiMs(date,'00:00')}catch(e){fail((e as Error).message)}if(d.remove===true){await env.DB.prepare('DELETE FROM exceptions WHERE date=?').bind(date).run();}else{const w=validateWindows(d.windows);await env.DB.prepare('INSERT INTO exceptions(date,windows) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET windows=excluded.windows').bind(date,JSON.stringify(w)).run();}await audit(env,s,'update_exception');return json({ok:true,message:'已更新當日排班；既有預約不會自動取消，請檢查並聯絡受影響客人。'});
 }
 const invitation=path.match(/^\/api\/admin\/bookings\/([^/]+)\/invitation$/);if(invitation&&method==='POST')return createInvitation(env,s,invitation[1],origin);
 if(path==='/api/admin/bookings'&&method==='POST')return createBooking(req,env,s,true,ctx,origin);
 const action=path.match(/^\/api\/admin\/bookings\/([^/]+)$/);if(action&&method==='PATCH'){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(action[1]).first<Booking>();if(!b)fail('預約不存在',404);const d=await body(req);const version=integer(d.version,1,1000000);if(version!==b.version)fail('預約已被更新，請重新整理',409);
  const next=text(d.status,20,true);const allowed:Record<string,string[]>={pending:['confirmed','rejected','cancelled'],confirmed:['confirmed','completed','cancelled','no_show'],completed:['completed'],no_show:['no_show'],cancelled:['cancelled'],rejected:['rejected'],expired:['expired']};if(!allowed[b.status]?.includes(next))fail('不允許此狀態變更',409);if(b.status==='pending'&&b.expires_at!<=Date.now())fail('申請已失效，請客人重新預約',409);
  if(b.status==='confirmed'&&b.date>taipeiDay()&&next!=='cancelled')fail('預約日期尚未到，目前只能取消或提出改期',409);
  const editPayment=next===b.status||b.status==='pending'&&next==='confirmed';
  const price=editPayment?integer(d.price??b.price,0,100000):b.price,paid=editPayment?(d.paid===true?1:0):b.paid;
  const paidAmount=editPayment?(paid?integer(d.paidAmount??price,0,100000):null):b.paid_amount;
  const paidAt=editPayment?(paid?(b.paid&&b.paid_amount===paidAmount?b.paid_at??Date.now():Date.now()):null):b.paid_at;
  if(next==='confirmed'){
   const hold=await env.DB.prepare("SELECT id FROM booking_changes WHERE booking_id=? AND state='pending' AND expires_at>?").bind(b.id,Date.now()).first();
   if(hold)fail('已有等待客戶回覆的改期提案，請先撤回或等客戶回覆',409);
   await assertBookingEligibility(env,b,b.start,price);
  }
  const r=await env.DB.prepare('UPDATE bookings SET status=?,price=?,price_confirmed=1,paid=?,paid_amount=?,paid_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(next,price,paid,paidAmount,paidAt,Date.now(),b.id,version).run();if(!r.meta.changes)fail('預約已被更新',409);
  await audit(env,s,`booking_${next}`,b.id);if(next!==b.status&&['confirmed','rejected','cancelled'].includes(next))await notify(env,b,next,next==='confirmed'?confirmationText(b,price,(await settings(env)).address):next==='rejected'?'很抱歉，此次預約未能成立，請重新選擇時段或聯絡店家。':'您的預約已由店家取消，請聯絡店家確認。',origin);
  ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(path==='/api/admin/retry'&&method==='POST'){
  const d=await body(req),id=text(d.id,80,true);await env.DB.prepare("UPDATE notifications SET state='queued',attempts=0,retry_at=0 WHERE id=? AND state='failed' AND lease_until<?").bind(id,Date.now()).run();await audit(env,s,'retry_notification');ctx.waitUntil(pushNotifications(env));return json({ok:true});
 }
 if(path==='/api/admin/export'&&method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM bookings ORDER BY start DESC').all<Booking>();const cell=(v:unknown)=>{let t=String(v??'');if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"'};const lines=[['預約編號','日期','時間','姓名','電話','服務','規格','狀態','應付','已收款'],...rows.results.map(b=>[b.id,b.date,new Date(b.start+8*3600000).toISOString().slice(11,16),b.customer,b.phone,b.service_name,b.spec,statusLabel[b.status],b.price,b.paid?b.paid_amount:0])];await audit(env,s,'export_bookings');return new Response('\ufeff'+lines.map(row=>row.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="bookings.csv"','Cache-Control':'no-store'}});
 }fail('找不到此功能',404);
}
async function createBooking(req:Request,env:Env,s:Session,admin:boolean,ctx:ExecutionContext,origin:string){
 const d=await body(req);const cfg=await settings(env);const item=(await services(env)).find(x=>x.id===d.serviceId&&x.active);if(!item)fail('此服務目前不開放',404);const spec=integer(d.spec,0,item.specs.length-1),a=addonInput(d.addons);const basePrice=priceFor(item,spec,a),price=admin&&d.manualPrice!==undefined?integer(d.manualPrice,0,100000):basePrice,duration=serviceDuration(item,a,cfg,spec);if(!duration)fail('店家尚未設定此服務時間',409);
 const date=text(d.date,10,true),time=text(d.time,5,true),start=taipeiMs(date,time),service_end=start+duration*60000,end=service_end+cleanupMinutes(cfg)*60000;await expire(env);const slots=availableSlots(date,duration,cfg,await windows(env,date,cfg),await occupied(env,date));if(!slots.includes(time))fail('此時段已無法預約，請重新選擇',409);
 const customer=text(d.customer,80,true),phone=text(d.phone,30,true);if(!/^[+\d\s()-]{8,25}$/.test(phone))fail('請輸入有效聯絡電話');const note=text(d.note||'',1000),previous=text(d.previousId||'',80),companion=text(d.companion||'',80);if(['refill','touchup'].includes(item.id)&&!previous)fail('請填寫前次預約編號供店家核對');if(item.id==='brows'&&spec===1&&!companion)fail('請填寫同行者姓名');
 let bookingUser=admin?null:s.id;
 if(admin&&d.existingCustomerId){
  const existing=await env.DB.prepare('SELECT user_id FROM bookings WHERE id=?').bind(text(d.existingCustomerId,80,true)).first<{user_id:string|null}>();
  if(!existing)fail('找不到此客人，請重新選擇',404);bookingUser=existing.user_id;
 }
 if(admin&&['refill','touchup'].includes(item.id)){
  const prev=await env.DB.prepare("SELECT * FROM bookings WHERE id=? AND status='completed'").bind(previous).first<Booking>();
  const eligible=prev&&(item.id==='refill'?start>prev.start&&start-prev.start<=14*86400000:withinCalendarMonths(prev.start,start,3));
  if(!prev||!eligible||(bookingUser?prev.user_id!==bookingUser:prev.phone!==phone)||(item.id==='touchup'&&!['brows','combo-brows-lashes'].includes(prev.service_id))||(item.id==='refill'&&!['single','3d','6d','yy','combo-brows-lashes'].includes(prev.service_id)))fail('優惠資格不符，請核對前次已完成服務',409);
  if(item.id==='refill'&&price===0)fail('請填寫核對後的原款式半價金額',409);
  if(item.id==='touchup'&&price!==0)fail('符合三個月內補色資格時應為免費',409);
 }
 const status=admin?'confirmed':'pending';
 const confirmedNotice=admin&&bookingUser?confirmationText({date,start,end,service_end,service_name:item.name,spec:item.specs[spec].label},price,cfg.address)+'\n查看預約：'+origin+'/#my':null;
 const recipient=!admin?await reviewRecipient(env):null;
 const id=crypto.randomUUID(),now=Date.now();let group:string|null=null;if(item.id==='brows'&&spec===1){group=crypto.randomUUID();if(d.groupCode){const code=text(d.groupCode,80,true);const existing=await env.DB.prepare("SELECT id FROM bookings WHERE group_code=? AND service_id='brows' AND status IN ('pending','confirmed')").bind(code).all();if(existing.results.length!==1)fail('同行預約識別碼無效或已額滿');group=code;}}
 try{const insert=env.DB.prepare('INSERT INTO bookings(id,user_id,customer,phone,note,service_id,service_name,spec,addons,date,start,end,service_end,price,price_confirmed,status,expires_at,created_at,updated_at,previous_id,group_code,companion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,bookingUser,customer,phone,note,item.id,item.name,item.specs[spec].label,JSON.stringify(a),date,start,end,service_end,price,admin?1:0,status,admin?null:now+cfg.approvalHours*3600000,now,now,previous||null,group,companion);
 const statements=[insert];
 if(confirmedNotice)statements.push(env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,bookingUser,'confirmed',confirmedNotice));
 if(recipient)statements.push(env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,recipient,'review_requested',`有新的預約申請，請審核 ✨\n客人：${customer}\n日期：${date}\n時間：${time}\n服務：${item.name} ${item.specs[spec].label}\n預估金額：NT$${price}\n目前等待店家確認，預約尚未正式成立。\n審核預約：${origin}/#admin`));
 await env.DB.batch(statements);
 }catch(e){if(String(e).includes('GROUP_FULL'))fail('此同行優惠已額滿',409);if(String(e).includes('SLOT_TAKEN'))fail('此時段剛被其他客人預約，請選擇其他時段',409);throw e;}
 if(admin)await audit(env,s,'manual_booking',id);
 if(recipient||confirmedNotice)ctx.waitUntil(pushNotifications(env));
 return json({ok:true,id,groupCode:group,status,lineBound:!!bookingUser,notificationQueued:!!confirmedNotice},201);
}
async function notify(env:Env,b:Pick<Booking,'id'|'user_id'>,kind:string,message:string,origin:string){if(!b.user_id)return;await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.id,b.user_id,kind,message+'\n查看預約：'+origin+'/#my').run();}
async function scheduled(env:Env){if(!env.DB)return;await expire(env);const cfg=await settings(env);if(cfg.reminders){const now=Date.now();await env.DB.prepare("INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) SELECT lower(hex(randomblob(16))),id,user_id,'reminder','提醒您明日的預約：'||date||' '||service_name||'。現金或當下匯款，詳情請至我的預約查看。' FROM bookings WHERE status='confirmed' AND user_id IS NOT NULL AND start BETWEEN ? AND ?").bind(now+23*3600000,now+24*3600000).run();}await pushNotifications(env);await env.DB.batch([env.DB.prepare('DELETE FROM request_limits WHERE expires<?').bind(Date.now()),env.DB.prepare('DELETE FROM webhook_events WHERE created_at<?').bind(Date.now()-30*86400000)]);}
export default {
 async fetch(req:Request,env:Env,ctx:ExecutionContext){try{let response=new URL(req.url).pathname.startsWith('/api/')?await api(req,env,ctx):await env.ASSETS.fetch(req);response=new Response(response.body,response);response.headers.set('X-Content-Type-Options','nosniff');if(!response.headers.has('Referrer-Policy'))response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://scdn.line-apps.com; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");return response;}catch(e){const error=e as Error&{status?:number};return json({error:error.status?error.message:'系統暫時無法處理，請稍後再試'},error.status||500);}},
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(scheduled(env));}
};
