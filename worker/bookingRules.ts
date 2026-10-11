import {withinCalendarMonths} from '../src/domain.ts';
import type {Env} from './security.ts';
type EligibleBooking={id:string;user_id:string|null;phone:string;start:number;service_id:string;previous_id:string|null;group_code:string|null;spec:string};
function fail(message:string):never{throw Object.assign(new Error(message),{status:409})}
export async function assertBookingEligibility(env:Env,b:EligibleBooking,start:number,price:number){
 if(['refill','touchup'].includes(b.service_id)){
  const previous=await env.DB.prepare("SELECT * FROM bookings WHERE id=? AND status='completed'").bind(b.previous_id||'').first<EligibleBooking>();
  const eligible=previous&&(b.service_id==='refill'?start>previous.start&&start-previous.start<=14*86400000:withinCalendarMonths(previous.start,start,3));
  if(!previous||previous.user_id!==b.user_id||(!b.user_id&&previous.phone!==b.phone)||!eligible||(b.service_id==='touchup'&&!['brows','combo-brows-lashes'].includes(previous.service_id))||(b.service_id==='refill'&&!['single','3d','6d','yy','combo-brows-lashes'].includes(previous.service_id)))fail('優惠資格不符，請核對前次已完成服務');
 }
 if(b.service_id==='refill'&&price===0)fail('請填寫核對後的原款式半價金額');
 if(b.service_id==='touchup'&&price!==0)fail('符合三個月內補色資格時應為免費');
 if(b.service_id==='brows'&&b.spec.includes('兩人')){
  const linked=await env.DB.prepare("SELECT id FROM bookings WHERE group_code=? AND id<>? AND service_id='brows' AND status IN ('pending','confirmed','completed')").bind(b.group_code,b.id).first();
  if(!linked)fail('同行優惠需先建立第二位客人的關聯預約');
 }
}
