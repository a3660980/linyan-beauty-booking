export async function api<T=Record<string,unknown>>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const controller=new AbortController();let timedOut=false;
 const abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(()=>{timedOut=true;controller.abort()},15000);
 try{
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
  let data:Record<string,unknown>;try{data=await response.json()}catch{if(controller.signal.aborted)throw new Error('請求已中止');throw new Error('系統尚未連接正式預約服務')}
  if(!response.ok){if(response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('linyan:auth-expired'));throw Object.assign(new Error(String(data.error||'操作失敗，請稍後再試')),{status:response.status})}return data as T;
 }catch(e){if(timedOut&&!signal?.aborted)throw new Error('連線逾時，請重新整理確認狀態後再試');throw e}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}
