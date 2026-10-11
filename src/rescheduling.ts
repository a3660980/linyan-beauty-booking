export type ChangeView={id:string;state:string;reason:string;price:number;expiresAt:number;old:{date:string;start:number;end:number};proposed:{date:string;start:number;end:number}};
export type ChangeHold={id:string;booking_id:string;date:string;start:number;service_end:number;end:number;state:string};
export const changeLabels:Record<string,string>={pending:'等待客戶回覆',accepted:'已接受改期',declined:'維持原時段',withdrawn:'店家已撤回',expired:'提案已到期',obsolete:'提案已失效'};
export const changeTime=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(11,16);
export const changePeriod=(period:{date:string;start:number;end:number})=>`${period.date} ${changeTime(period.start)}–${changeTime(period.end)}`;
