import {isAdminId,sign,verify,type Env,type Session} from './security.ts';

export type CalendarBooking={id:string;customer:string;service_name:string;spec:string;start:number;end:number;status:string;created_at:number;updated_at:number;version:number};
type Subscription={admin_id:string;subscription_id:string;created_at:number};
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
const textEncoder=new TextEncoder();
export const calendarText=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const timestamp=(ms:number)=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function folded(line:string){
 const lines:string[]=[];let part='',bytes=0;
 for(const char of line){const size=textEncoder.encode(char).length;if(bytes+size>75){lines.push(part);part=' ';bytes=1}part+=char;bytes+=size}
 lines.push(part);return lines.join('\r\n');
}

export function calendarIcs(bookings:CalendarBooking[],origin:string,address:string){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Linyanbeauty//Booking Calendar//ZH-TW','CALSCALE:GREGORIAN','X-WR-CALNAME:琳顏美學・預約','X-WR-TIMEZONE:Asia/Taipei','REFRESH-INTERVAL;VALUE=DURATION:PT15M','X-PUBLISHED-TTL:PT15M'];
 for(const b of bookings){
  lines.push('BEGIN:VEVENT',`UID:${calendarText(b.id)}@${new URL(origin).hostname}`,`DTSTAMP:${timestamp(b.updated_at)}`,`CREATED:${timestamp(b.created_at)}`,`LAST-MODIFIED:${timestamp(b.updated_at)}`,`SEQUENCE:${b.version}`,`DTSTART:${timestamp(b.start)}`,`DTEND:${timestamp(b.end)}`,`SUMMARY:${calendarText(`${b.customer} · ${b.service_name}${b.status==='completed'?'（已完成）':''}`)}`,`DESCRIPTION:${calendarText(`${b.service_name}・${b.spec}\n時段包含服務與整理時間。\n預約編號：${b.id}\n變更請至店家後台處理。`)}`,'STATUS:CONFIRMED','TRANSP:OPAQUE',`URL:${origin}/#admin`);
  if(address)lines.push(`LOCATION:${calendarText(address)}`);
  lines.push('END:VEVENT');
 }
 lines.push('END:VCALENDAR');return lines.map(folded).join('\r\n')+'\r\n';
}

async function subscriptionData(row:Subscription|null,env:Env,origin:string){
 if(!row)return {enabled:false};
 const token=await sign({purpose:'calendar',id:row.subscription_id},env.AUTH_SECRET!);
 const httpsUrl=`${origin}/api/calendar/${token}.ics`;
 return {enabled:true,httpsUrl,webcalUrl:httpsUrl.replace(/^https?:/,'webcal:'),createdAt:row.created_at};
}

export async function manageCalendarSubscription(req:Request,env:Env,s:Session,origin:string){
 if(!env.AUTH_SECRET||env.AUTH_SECRET.length<32)throw Object.assign(new Error('登入驗證金鑰尚未完成設定'),{status:503});
 if(req.method==='POST'){
  await env.DB.prepare('INSERT OR IGNORE INTO calendar_subscriptions(admin_id,subscription_id,created_at) VALUES(?,?,?)').bind(s.id,crypto.randomUUID(),Date.now()).run();
 }else if(req.method==='PUT'){
  await env.DB.prepare('INSERT INTO calendar_subscriptions(admin_id,subscription_id,created_at) VALUES(?,?,?) ON CONFLICT(admin_id) DO UPDATE SET subscription_id=excluded.subscription_id,created_at=excluded.created_at').bind(s.id,crypto.randomUUID(),Date.now()).run();
 }else if(req.method==='DELETE')await env.DB.prepare('DELETE FROM calendar_subscriptions WHERE admin_id=?').bind(s.id).run();
 if(req.method!=='GET')await env.DB.prepare('INSERT INTO audit(id,actor,action,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),s.id,req.method==='DELETE'?'calendar_disable':req.method==='PUT'?'calendar_rotate':'calendar_enable',Date.now()).run();
 const row=await env.DB.prepare('SELECT admin_id,subscription_id,created_at FROM calendar_subscriptions WHERE admin_id=?').bind(s.id).first<Subscription>();
 return json(await subscriptionData(row,env,origin));
}

export async function calendarFeed(req:Request,env:Env,token:string,origin:string){
 const payload=await verify<{purpose:string;id:string}>(token,env.AUTH_SECRET);
 const unavailable=()=>new Response('Calendar subscription unavailable',{status:404,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
 if(payload?.purpose!=='calendar'||typeof payload.id!=='string')return unavailable();
 const subscription=await env.DB.prepare('SELECT admin_id FROM calendar_subscriptions WHERE subscription_id=?').bind(payload.id).first<{admin_id:string}>();
 if(!subscription||!isAdminId(subscription.admin_id,env))return unavailable();
 const responseHeaders={...headers,'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="linyan-bookings.ics"'};
 if(req.method==='HEAD')return new Response(null,{headers:responseHeaders});
 const now=Date.now();
 const rows=await env.DB.prepare("SELECT id,customer,service_name,spec,start,end,status,created_at,updated_at,version FROM bookings WHERE date>=? AND date<=? AND status IN ('confirmed','completed') ORDER BY start LIMIT 2001").bind(new Date(now-30*86400000+8*3600000).toISOString().slice(0,10),new Date(now+180*86400000+8*3600000).toISOString().slice(0,10)).all<CalendarBooking>();
 if(rows.results.length>2000)return new Response('Calendar subscription temporarily unavailable',{status:503,headers:{...headers,'Retry-After':'3600','Content-Type':'text/plain; charset=utf-8'}});
 const config=await env.DB.prepare('SELECT data FROM settings WHERE id=1').first<{data:string}>();
 const address=config?String(JSON.parse(config.data).address||''):'';
 return new Response(calendarIcs(rows.results,origin,address),{headers:responseHeaders});
}
