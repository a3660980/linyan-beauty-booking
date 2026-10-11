import {confirmationText,changeRequestText} from './bookingMessages.ts';
export {confirmationText} from './bookingMessages.ts';
import {serviceEnd} from '../src/domain.ts';
import type {Env,Session} from './security.ts';

type InviteBooking={id:string;customer:string;service_name:string;spec:string;date:string;start:number;end:number;service_end?:number|null;status:string;price:number;user_id:string|null;expires_at:number|null;version:number};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
async function digest(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
function validBooking(b:InviteBooking|null,now:number){return b&&['pending','confirmed'].includes(b.status)&&b.start>now&&(b.status!=='pending'||(b.expires_at??0)>now)}


export async function createInvitation(env:Env,s:Session,id:string,origin:string){
 const now=Date.now(),b=await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(id).first<InviteBooking>();
 if(!b)fail('預約不存在',404);
 if(b.user_id)fail('這筆預約已綁定 LINE，不需要邀請連結',409);
 if(!validBooking(b,now))fail('僅能邀請尚未失效、未開始的待確認或已確認預約',409);
 const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const hash=await digest(token),expires=Math.min(now+7*86400000,b.start);
 const r=await env.DB.prepare(`INSERT INTO booking_invitations(token_hash,booking_id,created_by,created_at,expires_at)
 SELECT ?,id,?,?,? FROM bookings WHERE id=? AND user_id IS NULL AND start>? AND (status='confirmed' OR (status='pending' AND expires_at>?))
 ON CONFLICT(booking_id) DO UPDATE SET token_hash=excluded.token_hash,created_by=excluded.created_by,created_at=excluded.created_at,expires_at=excluded.expires_at,claimed_by=NULL,claimed_at=NULL`).bind(hash,s.id,now,expires,id,now,now).run();
 if(!r.meta.changes)fail('預約已更新，請重新整理',409);
 await env.DB.prepare('INSERT INTO audit(id,actor,action,booking_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),s.id,'create_booking_invitation',id,now).run();
 return json({url:origin+'/#invite/'+token,expiresAt:expires});
}

export async function useInvitation(req:Request,env:Env,s:Session,claim:boolean,origin:string){
 const raw=await req.text();if(raw.length>1000)fail('資料過長',413);
 let token:unknown;try{token=(JSON.parse(raw) as {token?:unknown}).token}catch{fail('資料格式錯誤')}
 if(typeof token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(token))fail('邀請連結無效或已失效',404);
 const hash=await digest(token),now=Date.now();
 const b=await env.DB.prepare(`SELECT b.* FROM bookings b JOIN booking_invitations i ON i.booking_id=b.id WHERE i.token_hash=? AND i.expires_at>? AND i.claimed_at IS NULL AND b.user_id IS NULL`).bind(hash,now).first<InviteBooking>();
 if(!validBooking(b,now))fail('邀請連結無效或已失效，請向店家索取新的連結',404);
 if(!claim)return json({booking:{customer:b!.customer,service:b!.service_name,spec:b!.spec,date:b!.date,start:b!.start,end:serviceEnd(b!),status:b!.status}});
 const friend=await env.DB.prepare('SELECT friend FROM users WHERE id=?').bind(s.id).first<{friend:number}>();
 if(friend?.friend!==1)fail('請先加入官方帳號好友，再重新登入確認',403);
 // D1 batch is transactional. The first update exclusively claims the booking;
 // the second consumes the token only when that same booking was updated by this request.
 const held=await env.DB.prepare("SELECT id FROM booking_changes WHERE booking_id=? AND state='pending' AND expires_at>?").bind(b!.id,now).first<{id:string}>();
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE bookings SET user_id=?,updated_at=?,version=version+1 WHERE id=? AND user_id IS NULL AND start>? AND (status='confirmed' OR (status='pending' AND expires_at>?)) AND EXISTS(SELECT 1 FROM booking_invitations WHERE booking_id=bookings.id AND token_hash=? AND expires_at>? AND claimed_at IS NULL)`).bind(s.id,now,b!.id,now,now,hash,now),
  env.DB.prepare(`UPDATE booking_invitations SET claimed_by=?,claimed_at=? WHERE token_hash=? AND claimed_at IS NULL AND changes()=1 AND EXISTS(SELECT 1 FROM bookings WHERE id=booking_id AND user_id=?)`).bind(s.id,now,hash,s.id)
 ,...(held?[env.DB.prepare("UPDATE booking_changes SET state='pending',responded_at=NULL,base_version=(SELECT version FROM bookings WHERE id=booking_id) WHERE id=? AND state='obsolete' AND base_version=(SELECT version-1 FROM bookings WHERE id=booking_id) AND expires_at>? AND EXISTS(SELECT 1 FROM booking_invitations WHERE booking_id=booking_changes.booking_id AND token_hash=? AND claimed_by=? AND claimed_at=?)").bind(held.id,now,hash,s.id,now)]:[])
 ]);
 if(!result[0].meta.changes||!result[1].meta.changes)fail('此邀請已使用或預約已更新，請聯絡店家',409);
 await env.DB.prepare('INSERT INTO audit(id,actor,action,booking_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),s.id,'claim_booking_invitation',b!.id,now).run();
 const current=await env.DB.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').bind(b!.id,s.id).first<InviteBooking>();
 if(current?.status==='confirmed'){
  const cfg=await env.DB.prepare('SELECT data FROM settings WHERE id=1').first<{data:string}>();
  const address=cfg?(JSON.parse(cfg.data) as {address?:string}).address||'':'';
  await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),current.id,s.id,'confirmed',confirmationText(current,current.price,address)+'\n查看預約：'+origin+'/#my').run();
 }
 if(current){
  const change=await env.DB.prepare("SELECT * FROM booking_changes WHERE booking_id=? AND state='pending' AND base_version=? AND expires_at>?").bind(current.id,current.version,now).first<import('./rescheduling.ts').BookingChange>();
  if(change)await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),current.id,s.id,'reschedule_requested:'+change.id,changeRequestText(change,current.service_name+' '+current.spec,origin)).run();
 }
 return json({ok:true,status:current?.status});
}
