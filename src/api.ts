export async function api<T=Record<string,unknown>>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal});
 let data:Record<string,unknown>;try{data=await response.json()}catch{throw new Error('系統尚未連接正式預約服務')}
 if(!response.ok)throw new Error(String(data.error||'操作失敗，請稍後再試'));return data as T;
}
