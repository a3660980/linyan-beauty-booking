import {bookingDates,cleanupMinutes,serviceEnd,taipeiMs,windowsForDate,type Settings,type DateSchedule} from '../src/domain.ts';
import {isAdminId,type Env,type Session} from './security.ts';
import {changeRequestText,confirmationText} from './bookingMessages.ts';
import {assertBookingEligibility} from './bookingRules.ts';
export type BookingChange={id:string;booking_id:string;base_version:number;old_date:string;old_start:number;old_service_end:number;date:string;start:number;service_end:number;end:number;price:number;reason:string;state:string;created_by:string;created_at:number;expires_at:number;responded_at:number|null};
type Booking={id:string;user_id:string|null;customer:string;phone:string;service_id:string;service_name:string;spec:string;date:string;start:number;end:number;service_end:number|null;status:string;price:number;version:number;expires_at:number|null;previous_id:string|null;group_code:string|null};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status})}
function integer(v:unknown,min:number,max:number){if(!Number.isInteger(v)||Number(v)<min||Number(v)>max)fail('請檢查服務分鐘、金額與預約版本',400);return v as number}
async function body(req:Request){const raw=await req.text();if(raw.length>4000)fail('資料過長',413);try{return JSON.parse(raw) as Record<string,unknown>}catch{fail('資料格式錯誤',400)}}
async function settings(env:Env){const cfg=await env.DB.prepare('SELECT data FROM settings WHERE id=1').first<{data:string}>();if(!cfg)fail('請先設定店家排班',400);return JSON.parse(cfg.data) as Settings}
async function audit(env:Env,s:Session,action:string,id:string){await env.DB.prepare('INSERT INTO audit(id,actor,action,booking_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),s.id,action,id,Date.now()).run()}
function upcoming(b:Booking,now:number){return ['pending','confirmed'].includes(b.status)&&b.start>now&&(b.status!=='pending'||(b.expires_at??0)>now)}
async function assertOpen(env:Env,c:{date:string;start:number;end:number},cfg:Settings,now:number){
 const dates=bookingDates(cfg.bookingDays,now);if(c.start<=now||!dates.includes(c.date))fail('請選擇開放期間內、尚未開始的時段');
 const ex=await env.DB.prepare('SELECT date,windows FROM exceptions WHERE date=?').bind(c.date).all<DateSchedule>();
 if(!windowsForDate(c.date,cfg.weekly,ex.results).some(([from,to])=>taipeiMs(c.date,from)<=c.start&&c.end<=taipeiMs(c.date,to)))fail('此時段目前未開放，或無法容納完整服務與整理時間');
}
export async function expireChanges(env:Env,now=Date.now()){
 await env.DB.prepare(`UPDATE booking_changes SET state=CASE WHEN expires_at<=? THEN 'expired' ELSE 'obsolete' END,responded_at=?
 WHERE state='pending' AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND b.version=base_version AND b.status IN ('pending','confirmed') AND b.start>? AND (b.status='confirmed' OR b.expires_at>?)))`).bind(now,now,now,now,now).run();
}
export function customerChange(c:BookingChange){return {id:c.id,state:c.state,reason:c.reason,price:c.price,expiresAt:c.expires_at,old:{date:c.old_date,start:c.old_start,end:c.old_service_end},proposed:{date:c.date,start:c.start,end:c.service_end}}}
export async function bookingChanges(env:Env,id:string){return (await env.DB.prepare('SELECT * FROM booking_changes WHERE booking_id=? ORDER BY created_at DESC LIMIT 10').bind(id).all<BookingChange>()).results}
export async function proposeChange(req:Request,env:Env,s:Session,id:string,origin:string){
 const now=Date.now();await expireChanges(env,now);
 const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(id).first<Booking>();if(!b)fail('預約不存在',404);if(!upcoming(b,now))fail('只能調整尚未開始且有效的預約');
 const d=await body(req);if(integer(d.version,1,1000000)!==b.version)fail('預約已更新，請重新整理');
 if(typeof d.date!=='string'||typeof d.time!=='string')fail('請選擇日期與開始時間',400);
 const start=taipeiMs(d.date,d.time),duration=integer(d.duration??Math.round((serviceEnd(b)-b.start)/60000),5,600),price=integer(d.price??b.price,0,100000),cfg=await settings(env);
 const reason=typeof d.reason==='string'?d.reason.trim():'希望調整預約時間';if(reason.length>500)fail('改期原因最多 500 字',400);
 const c:BookingChange={id:crypto.randomUUID(),booking_id:b.id,base_version:b.version,old_date:b.date,old_start:b.start,old_service_end:serviceEnd(b),date:d.date,start,service_end:start+duration*60000,end:start+(duration+cleanupMinutes(cfg))*60000,price,reason:reason||'希望調整預約時間',state:'pending',created_by:s.id,created_at:now,expires_at:Math.min(now+24*3600000,b.start,start,b.status==='pending'?b.expires_at!:Infinity),responded_at:null};
 if(c.start===b.start&&c.service_end===serviceEnd(b)&&price===b.price)fail('新時段與原預約相同');
 await assertOpen(env,c,cfg,now);await assertBookingEligibility(env,b,start,price);
 const inserts=[env.DB.prepare(`INSERT INTO booking_changes(id,booking_id,base_version,old_date,old_start,old_service_end,date,start,service_end,end,price,reason,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(c.id,c.booking_id,c.base_version,c.old_date,c.old_start,c.old_service_end,c.date,c.start,c.service_end,c.end,c.price,c.reason,c.created_by,c.created_at,c.expires_at)];
 if(b.user_id)inserts.push(env.DB.prepare('INSERT INTO notifications(id,booking_id,user_id,kind,text) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.id,b.user_id,'reschedule_requested:'+c.id,changeRequestText(c,b.service_name+' '+b.spec,origin)));
 try{await env.DB.batch(inserts)}catch(e){const error=String(e);if(error.includes('SLOT_TAKEN'))fail('此時段已被預約或保留，請選擇其他時段');if(error.includes('STALE_BOOKING'))fail('預約已更新，請重新整理');if(error.includes('UNIQUE'))fail('已有等待客戶回覆的改期提案，請先撤回');throw e}
 await audit(env,s,'propose_reschedule',id);
 return json({change:customerChange(c),lineBound:!!b.user_id,notificationQueued:!!b.user_id},201);
}
export async function customerChangeDetails(env:Env,s:Session,id:string){
 await expireChanges(env);
 const c=await env.DB.prepare('SELECT c.* FROM booking_changes c JOIN bookings b ON b.id=c.booking_id WHERE c.id=? AND b.user_id=?').bind(id,s.id).first<BookingChange>();if(!c)fail('找不到此改期提案，請使用預約本人的 LINE 帳號登入',404);
 const b=await env.DB.prepare('SELECT customer,service_name,spec,status FROM bookings WHERE id=?').bind(c.booking_id).first<Pick<Booking,'customer'|'service_name'|'spec'|'status'>>();
 return json({change:customerChange(c),booking:{customer:b!.customer,service:b!.service_name,spec:b!.spec,status:b!.status}});
}
export async function respondToChange(req:Request,env:Env,s:Session,id:string,origin:string){
 const now=Date.now();await expireChanges(env,now);
 const c=await env.DB.prepare('SELECT c.* FROM booking_changes c JOIN bookings b ON b.id=c.booking_id WHERE c.id=? AND b.user_id=?').bind(id,s.id).first<BookingChange>();if(!c)fail('改期提案不存在',404);if(c.state!=='pending'||c.expires_at<=now)fail('此改期提案已回覆或失效，請重新整理');
 const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').bind(c.booking_id,s.id).first<Booking>();if(!b||!upcoming(b,now)||b.version!==c.base_version)fail('原預約已更新，請聯絡店家');
 const d=await body(req);if(!['accept','decline'].includes(String(d.decision)))fail('請選擇接受或維持原時段',400);
 const accept=d.decision==='accept',cfg=await settings(env);if(accept){await assertOpen(env,c,cfg,now);await assertBookingEligibility(env,b,c.start,c.price)}
 const changes=[env.DB.prepare(`UPDATE booking_changes SET state=?,responded_at=?,responded_by=? WHERE id=? AND state='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND b.user_id=? AND b.version=base_version AND b.status IN ('pending','confirmed') AND b.start>? AND (b.status='confirmed' OR b.expires_at>?))`).bind(accept?'accepted':'declined',now,s.id,c.id,now,s.id,now,now)];
 if(accept){
  changes.push(env.DB.prepare(`UPDATE bookings SET date=?,start=?,service_end=?,end=?,price=?,price_confirmed=1,status='confirmed',expires_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND user_id=? AND EXISTS(SELECT 1 FROM booking_changes WHERE id=? AND state='accepted' AND responded_at=? AND responded_by=?)`).bind(c.date,c.start,c.service_end,c.end,c.price,now,b.id,c.base_version,s.id,c.id,now,s.id));
  changes.push(env.DB.prepare(`INSERT INTO notifications(id,booking_id,user_id,kind,text) SELECT ?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),b.id,s.id,'reschedule_confirmed:'+c.id,confirmationText({...b,date:c.date,start:c.start,service_end:c.service_end,end:c.end},c.price,cfg.address).replace('您的預約已確認 ✨','您的改期已確認 ✨')+'\n查看預約：'+origin+'/#my'));
 }
 const recipient=await env.DB.prepare("SELECT user_id FROM notification_recipients WHERE kind='review_requested'").first<{user_id:string}>();
 if(recipient&&isAdminId(recipient.user_id,env))changes.push(env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,booking_id,user_id,kind,text) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM booking_changes WHERE id=? AND state=? AND responded_at=? AND responded_by=?)`).bind(crypto.randomUUID(),b.id,recipient.user_id,'reschedule_response:'+c.id,`${b.customer} ${accept?'已接受改期':'選擇維持原預約'}\n${accept?c.date:b.date} ${new Date((accept?c.start:b.start)+8*3600000).toISOString().slice(11,16)}\n查看預約：${origin}/#admin`,c.id,accept?'accepted':'declined',now,s.id));
 let result:D1Result[];try{result=await env.DB.batch(changes)}catch(e){if(String(e).includes('SLOT_TAKEN'))fail('新時段目前無法使用，原預約已保留，請聯絡店家');throw e}
 if(!result[0].meta.changes||(accept&&!result[1].meta.changes))fail('預約已更新，請重新整理');
 await audit(env,s,accept?'accept_reschedule':'decline_reschedule',b.id);
 return json({ok:true,state:accept?'accepted':'declined'});
}
export async function withdrawChange(env:Env,s:Session,id:string,origin:string){
 await expireChanges(env);const now=Date.now();const c=await env.DB.prepare('SELECT * FROM booking_changes WHERE id=?').bind(id).first<BookingChange>();if(!c)fail('改期提案不存在',404);
 const b=await env.DB.prepare('SELECT user_id FROM bookings WHERE id=?').bind(c.booking_id).first<{user_id:string|null}>();
 const statements=[env.DB.prepare("UPDATE booking_changes SET state='withdrawn',responded_at=?,responded_by=? WHERE id=? AND state='pending' AND expires_at>?").bind(now,s.id,id,now)];
 if(b?.user_id)statements.push(env.DB.prepare('INSERT INTO notifications(id,booking_id,user_id,kind,text) SELECT ?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),c.booking_id,b.user_id,'reschedule_withdrawn:'+id,'店家已撤回改期提案，原預約時段保持不變。\n查看預約：'+origin+'/#my'));
 const result=await env.DB.batch(statements);if(!result[0].meta.changes)fail('此改期提案已回覆或失效');await audit(env,s,'withdraw_reschedule',c.booking_id);return json({ok:true});
}
