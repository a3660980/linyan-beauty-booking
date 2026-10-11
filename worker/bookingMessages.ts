import {serviceEnd} from '../src/domain.ts';
const time=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(11,16);
export function confirmationText(b:{date:string;start:number;end:number;service_end?:number|null;service_name:string;spec:string},price:number,address:string){return `您的預約已確認 ✨\n日期：${b.date}\n時間：${time(b.start)}–${time(serviceEnd(b))}\n服務：${b.service_name} ${b.spec}\n金額：NT$${price}\n付款：現金或當下匯款\n${address}`}
export function changeRequestText(c:{id:string;old_date:string;old_start:number;old_service_end:number;date:string;start:number;service_end:number;price:number;reason:string;expires_at:number},service:string,origin:string){
 return `店家想與您確認改期 ✨\n服務：${service}\n原預約：${c.old_date} ${time(c.old_start)}–${time(c.old_service_end)}\n建議改為：${c.date} ${time(c.start)}–${time(c.service_end)}\n金額：NT$${c.price}\n原因：${c.reason}\n請於 ${new Date(c.expires_at+8*3600000).toISOString().slice(0,16).replace('T',' ')} 前選擇接受或維持原時段。您同意前，原預約不會變更。\n確認改期：${origin}/#reschedule/${c.id}`;
}
