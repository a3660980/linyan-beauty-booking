import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/api.ts';

test('API requests stop at the deadline and tell users to verify state before retrying',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let requestSignal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  requestSignal=init!.signal!;requestSignal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
 }));
 const request=api('/bookings','POST',{serviceId:'single'});
 const rejected=assert.rejects(request,/連線逾時，請重新整理確認狀態後再試/);
 t.mock.timers.tick(15000);await rejected;
 assert.equal(requestSignal!.aborted,true);
});

test('API caller cancellation propagates without becoming a timeout error',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let requestSignal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
  requestSignal=init!.signal!;requestSignal.addEventListener('abort',()=>reject(new DOMException('Caller cancelled','AbortError')),{once:true});
 }));
 const controller=new AbortController(),request=api('/bookings','GET',undefined,controller.signal);
 const rejected=assert.rejects(request,(error:Error)=>error.name==='AbortError'&&error.message==='Caller cancelled');
 controller.abort();await rejected;assert.equal(requestSignal!.aborted,true);
 t.mock.timers.tick(15000);
});

test('API errors preserve status and successful reads return the response data',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'請先使用 LINE 登入'},{status:401}));
 await assert.rejects(api('/bookings'),(error:Error&{status?:number})=>error.status===401&&error.message==='請先使用 LINE 登入');
 t.mock.method(globalThis,'fetch',async()=>Response.json({bookings:[]}));
 assert.deepEqual(await api('/bookings'),{bookings:[]});
});
