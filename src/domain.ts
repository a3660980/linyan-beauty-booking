export type Service = {id:string; name:string; category:'lashes'|'removal'|'brows'; description:string; specs:{label:string;price:number}[]; duration:number|null; active:boolean; image?:string};
export const SERVICES:Service[] = [
 {id:'single',name:'日式單根',category:'lashes',description:'輕盈單根，呈現自然細緻的眼神。',specs:[{label:'100 根',price:900},{label:'150 根',price:1000},{label:'200 根',price:1100}],duration:120,active:true},
 {id:'3d',name:'3D 小絨花',category:'lashes',description:'柔軟蓬鬆，為雙眼增添溫柔層次。',specs:[{label:'100 根',price:900},{label:'150 根',price:1000},{label:'200 根',price:1100}],duration:120,active:true},
 {id:'6d',name:'6D 小絨花',category:'lashes',description:'細緻綻放，打造更有存在感的睫毛。',specs:[{label:'100 根',price:900},{label:'150 根',price:1000},{label:'200 根',price:1100}],duration:120,active:true},
 {id:'yy',name:'YY 美人魚',category:'lashes',description:'交織的輕柔線條，映出迷人眼神。',specs:[{label:'150 根',price:900},{label:'200 根',price:1000},{label:'300 根',price:1100}],duration:120,active:true},
 {id:'refill',name:'兩週內補睫',category:'lashes',description:'限原款式，半價優惠需由店家核對前次服務。',specs:[{label:'原款式半價・店家確認',price:0}],duration:60,active:true},
 {id:'remove-own',name:'本店卸除不續接',category:'removal',description:'本店睫毛卸除。',specs:[{label:'單次',price:200}],duration:30,active:true},
 {id:'remove-other',name:'他店純卸除',category:'removal',description:'他店睫毛卸除。',specs:[{label:'單次',price:300}],duration:30,active:true},
 {id:'brows',name:'手工漸層霧眉',category:'brows',description:'不限男女。兩人同行每人折 $500；三個月內補色免費。',specs:[{label:'單人',price:5000},{label:'兩人同行・每人',price:4500}],duration:180,active:true},
 {id:'touchup',name:'霧眉補色',category:'brows',description:'三個月內免費，需由店家確認前次服務紀錄。',specs:[{label:'三個月內・店家確認',price:0}],duration:180,active:true},
 {id:'color-removal',name:'無創除色',category:'brows',description:'NT$2,000–3,000，實際金額依店家評估。',specs:[{label:'現場評估',price:2000}],duration:60,active:true}
];
export type Settings = {address:string;instagram:string;lineUrl:string;bookingDays:number;leadHours:number;cancelHours:number;approvalHours:number;bufferMinutes:number;stepMinutes:number;reminders:boolean;addonDurations:{lower:number|null;own:number|null;other:number|null};weekly:Record<string,[string,string][]>;policies:string};
export const DEFAULT_SETTINGS:Settings={address:'',instagram:'',lineUrl:'',bookingDays:30,leadHours:12,cancelHours:24,approvalHours:12,bufferMinutes:30,stepMinutes:30,reminders:false,addonDurations:{lower:30,own:30,other:30},weekly:{'0':[],'1':[],'2':[],'3':[],'4':[],'5':[],'6':[]},policies:'預約須經店家確認後才正式成立。到店以現金付款。取消、改期與遲到規則請於預約前向店家確認。'};
export type Addons={lower:boolean;removal:'none'|'own'|'other'};
export type TimeWindow=[string,string];
export type DateSchedule={date:string;windows:string};
export function normalizeWindows(value:unknown):TimeWindow[]{
 if(!Array.isArray(value)||value.length>5)throw new Error('每天最多設定 5 個時間區段');
 const result=value.map(v=>{
  if(!Array.isArray(v)||v.length!==2||v.some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||v[0]>=v[1])throw new Error('開始時間須早於結束時間，且在同一天');
  return [v[0],v[1]] as TimeWindow;
 }).sort((a,b)=>a[0].localeCompare(b[0]));
 for(let i=1;i<result.length;i++)if(result[i][0]<result[i-1][1])throw new Error('時間區段不能重疊');
 return result;
}
export function windowsForDate(date:string,weekly:Settings['weekly'],exceptions:DateSchedule[]):TimeWindow[]{
 const override=exceptions.find(x=>x.date===date);
 return override?JSON.parse(override.windows):weekly[String(weekday(date))]||[];
}
export function priceFor(service:Service,spec:number,addons:Addons){
 if(!Number.isInteger(spec)||!service.specs[spec])throw new Error('請選擇有效的服務規格');
 if(service.category!=='lashes'&& (addons.lower||addons.removal!=='none'))throw new Error('此服務不適用美睫加購');
 return service.specs[spec].price+(addons.lower?200:0)+(addons.removal==='other'?200:0);
}
export function serviceDuration(service:Service,addons:Addons,settings:Settings):number|null{
 if(!service.duration||service.duration<1)return null;
 let duration=service.duration;
 for(const key of [addons.lower?'lower':null,addons.removal==='none'?null:addons.removal] as const){if(key){const d=settings.addonDurations[key];if(d===null)return null;duration+=d;}}
 return duration;
}
export function taipeiDay(now=Date.now()){return new Date(now+8*3600000).toISOString().slice(0,10)}
export function taipeiMs(date:string,time:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('日期或時間格式錯誤');const ms=Date.parse(`${date}T${time}:00+08:00`);if(!Number.isFinite(ms)||taipeiDay(ms)!==date)throw new Error('日期不存在');return ms;}
export function weekday(date:string){return new Date(`${date}T12:00:00+08:00`).getUTCDay()}
export function overlaps(a:number,b:number,c:number,d:number){return a<d&&c<b;}
export function availableSlots(date:string,duration:number,settings:Settings,windows:[string,string][],occupied:{start:number;end:number}[],now=Date.now()){
 const day=taipeiMs(date,'00:00'); const today=taipeiMs(taipeiDay(now),'00:00');
 if(day<today||day>=today+settings.bookingDays*86400000)return [];
 const result:string[]=[];
 for(const [from,to] of windows){let t=taipeiMs(date,from);const limit=taipeiMs(date,to);for(;t+(duration+settings.bufferMinutes)*60000<=limit;t+=settings.stepMinutes*60000){
  const end=t+(duration+settings.bufferMinutes)*60000;
  if(t<now+settings.leadHours*3600000||occupied.some(o=>overlaps(t,end,o.start,o.end)))continue;
  result.push(new Date(t+8*3600000).toISOString().slice(11,16));
 }}return [...new Set(result)].sort();
}
export const statusLabel:Record<string,string>={pending:'等待確認',confirmed:'預約成功',completed:'服務完成',cancelled:'已取消',rejected:'未成立',expired:'申請已失效',no_show:'未到店'};
export function money(n:number){return new Intl.NumberFormat('zh-TW').format(n)}
export function withinCalendarMonths(previous:number,next:number,months:number){
 const limit=new Date(previous+8*3600000),day=limit.getUTCDate();
 limit.setUTCDate(1);limit.setUTCMonth(limit.getUTCMonth()+months);
 const lastDay=new Date(Date.UTC(limit.getUTCFullYear(),limit.getUTCMonth()+1,0)).getUTCDate();
 limit.setUTCDate(Math.min(day,lastDay));
 return next>previous&&next<=limit.getTime()-8*3600000;
}
