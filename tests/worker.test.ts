import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.ts';
import {sign,verify,validLineSignature,type Env} from '../worker/security.ts';
import {DEFAULT_SETTINGS,SERVICES,taipeiDay} from '../src/domain.ts';
class Statement {
 constructor(public db:DatabaseSync,public sql:string,public args:unknown[]=[]){ }
 bind(...args:unknown[]){return new Statement(this.db,this.sql,args)}
 async first(){return this.db.prepare(this.sql).get(...this.args as never[])||null}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args as never[])}}
 async run(){const r=this.db.prepare(this.sql).run(...this.args as never[]);return {success:true,meta:{changes:Number(r.changes)}}}
}
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_group_limit.sql',import.meta.url),'utf8'));const adapter={prepare:(sql:string)=>new Statement(db,sql),batch:async(statements:Statement[])=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};const env={DB:adapter as unknown as D1Database,AUTH_SECRET:'x'.repeat(40),ADMIN_LINE_USER_IDS:'owner',APP_ORIGIN:'https://booking.test',ASSETS:{fetch:()=>new Response('static')} as unknown as Fetcher} satisfies Env;db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({...DEFAULT_SETTINGS,leadHours:0,weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[i,[['10:00','18:00']]]))}));for(const s of SERVICES)db.prepare('INSERT INTO services VALUES(?,?)').run(s.id,JSON.stringify({...s,duration:90}));for(const id of ['customer','other','owner'])db.prepare('INSERT INTO users VALUES(?,?,1,?)').run(id,'測試使用者',Date.now());const ctx={waitUntil:(_p:Promise<unknown>)=>{}} as ExecutionContext;return {db,env,ctx};}
async function request(f:ReturnType<typeof fixture>,path:string,user:string|null=null,method='GET',body?:unknown,origin='https://booking.test'){
 const headers:Record<string,string>={Origin:origin};if(user)headers.Cookie='linyan_session='+await sign({id:user,name:'測試使用者',expires:Date.now()+3600000},f.env.AUTH_SECRET!);if(body)headers['Content-Type']='application/json';return worker.fetch(new Request('https://booking.test/api'+path,{method,headers,body:body?JSON.stringify(body):undefined}),f.env,f.ctx);
}
const payload=()=>({serviceId:'single',spec:0,addons:{lower:false,removal:'none'},date:taipeiDay(Date.now()+86400000),time:'10:00',customer:'測試客人',phone:'0900000000',note:''});
test('LINE login uses the same canonical callback through authorization, token exchange and session return',async(t)=>{
 const f=fixture();
 try{
  let authorization:URL|undefined,oauthCookie:string|undefined;
  const env={...f.env,LINE_LOGIN_CHANNEL_ID:'test-login-id',LINE_LOGIN_CHANNEL_SECRET:'test-login-secret'};
  for(const origin of ['https://booking.test','https://booking.test/','https://booking.test///']){
   env.APP_ORIGIN=origin;
   const response=await request({...f,env},'/auth/line?returnTo=admin');
   assert.equal(response.status,302);
   authorization=new URL(response.headers.get('location')!);
   assert.equal(authorization.origin,'https://access.line.me');
   assert.equal(authorization.searchParams.get('redirect_uri'),'https://booking.test/api/auth/line/callback');
   assert.equal(authorization.searchParams.get('client_id'),env.LINE_LOGIN_CHANNEL_ID);
   oauthCookie=response.headers.get('set-cookie')!.split(';')[0];
  }
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);calls.push(url);
   if(url==='https://api.line.me/oauth2/v2.1/token'){
    const params=init!.body as URLSearchParams;
    assert.equal(params.get('redirect_uri'),'https://booking.test/api/auth/line/callback');
    assert.equal(params.get('client_id'),env.LINE_LOGIN_CHANNEL_ID);
    assert.equal(params.get('client_secret'),env.LINE_LOGIN_CHANNEL_SECRET);
    return Response.json({id_token:'test-id-token',access_token:'test-access-token'});
   }
   if(url==='https://api.line.me/oauth2/v2.1/verify')return Response.json({sub:'owner',name:'測試店家',nonce:authorization!.searchParams.get('nonce')});
   if(url==='https://api.line.me/friendship/v1/status')return Response.json({friendFlag:true});
   throw new Error('Unexpected outbound request');
  });
  const callback=new URL('https://booking.test/api/auth/line/callback');
  callback.searchParams.set('state',authorization!.searchParams.get('state')!);
  callback.searchParams.set('code','test-authorization-code');
  const response=await worker.fetch(new Request(callback,{headers:{Cookie:oauthCookie!}}),env,f.ctx);
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'https://booking.test/#admin');
  assert.deepEqual(calls,['https://api.line.me/oauth2/v2.1/token','https://api.line.me/oauth2/v2.1/verify','https://api.line.me/friendship/v1/status']);
  const sessionCookie=response.headers.getSetCookie().find(value=>value.startsWith('linyan_session='))!.split(';')[0];
  const me=await worker.fetch(new Request('https://booking.test/api/me',{headers:{Cookie:sessionCookie}}),env,f.ctx);
  assert.deepEqual(await me.json(),{user:{id:'owner',name:'測試店家',friend:true,admin:true}});
  const logout=await worker.fetch(new Request('https://booking.test/api/logout',{method:'POST',headers:{Origin:'https://booking.test',Cookie:sessionCookie}}),env,f.ctx);
  assert.equal(logout.status,200);
 }finally{f.db.close();}
});
test('signed sessions reject tampering, expired sessions and untrusted identity',async()=>{const f=fixture();const t=await sign({id:'test'},f.env.AUTH_SECRET!);assert.deepEqual(await verify(t,f.env.AUTH_SECRET),{id:'test'});assert.equal(await verify(t+'x',f.env.AUTH_SECRET),null);assert.equal((await request(f,'/admin','customer')).status,403);assert.equal((await request(f,'/bookings')).status,401);assert.equal((await request(f,'/bookings','customer','POST',payload(),'https://evil.test')).status,403);f.db.close();});
test('two clients cannot reserve the same full occupied interval',async()=>{const f=fixture();const first=await request(f,'/bookings','customer','POST',payload());assert.equal(first.status,201);const second=await request(f,'/bookings','other','POST',{...payload(),time:'10:30'});assert.equal(second.status,409);const r=f.db.prepare('SELECT status,paid FROM bookings').get();assert.equal(r?.status,'pending');assert.equal(r?.paid,0);f.db.close();});
test('SQLite overlap trigger prevents a race even without availability precheck',()=>{const f=fixture();const insert=f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at) VALUES(?, '測試', '0900000000','single','單根','100根','{}','2026-10-08',?,?,900,'pending',1,1)");insert.run('one',1000,2000);assert.throws(()=>insert.run('two',1500,2500),/SLOT_TAKEN/);insert.run('three',2000,3000);assert.throws(()=>f.db.prepare('UPDATE bookings SET start=1500 WHERE id=?').run('three'),/SLOT_TAKEN/);f.db.close();});
test('customers cannot read or cancel another user booking; approval is not payment',async()=>{const f=fixture();const created=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};const rows=await (await request(f,'/bookings','other')).json() as {bookings:unknown[]};assert.equal(rows.bookings.length,0);assert.equal((await request(f,`/bookings/${created.id}/cancel`,'other','POST',{})).status,404);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,200);const b=f.db.prepare('SELECT * FROM bookings').get();assert.equal(b?.status,'confirmed');assert.equal(b?.paid,0);assert.equal(f.db.prepare('SELECT state FROM notifications').get()?.state,'queued');assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:true,paidAmount:900})).status,409);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:2,status:'confirmed',price:900,paid:true,paidAmount:900})).status,200);f.db.close();});
test('expired requests release slots and cannot be approved',async()=>{const f=fixture();const c=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};f.db.prepare('UPDATE bookings SET expires_at=1 WHERE id=?').run(c.id);assert.equal((await request(f,`/admin/bookings/${c.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,409);const available=await (await request(f,`/availability?service=single&date=${payload().date}`)).json() as {slots:string[]};assert.ok(available.slots.includes('10:00'));assert.equal(f.db.prepare('SELECT status FROM bookings').get()?.status,'expired');f.db.close();});
test('unset durations, unverified friendships and invalid settings block writes',async()=>{const f=fixture();f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],duration:null}),'single');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,409);f.db.prepare('UPDATE users SET friend=0 WHERE id=?').run('customer');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,403);assert.equal((await request(f,'/admin/settings','owner','PUT',{...DEFAULT_SETTINGS,stepMinutes:0})).status,400);f.db.close();});
test('webhook body signatures are validated',async()=>{const secret='test webhook signing value';const raw='{"events":[]}';const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw)));const sig=btoa(String.fromCharCode(...bytes));assert.equal(await validLineSignature(raw,sig,secret),true);assert.equal(await validLineSignature(raw+' ',sig,secret),false);const f=fixture();assert.equal((await request(f,'/line/webhook',null,'POST',{events:[]})).status,401);f.db.close();});

test('date schedules open split windows without weekly shifts, and closure preserves existing bookings',async()=>{
 const f=fixture(),date=payload().date;
 const cfg={...DEFAULT_SETTINGS,leadHours:0};
 assert.equal((await request(f,'/admin/settings','owner','PUT',cfg)).status,200);
 const availability=async()=>await (await request(f,`/availability?service=single&date=${date}`)).json() as {slots:string[]};
 assert.deepEqual((await availability()).slots,[]);
 const windows=[['15:00','18:00'],['10:00','12:00']];
 assert.equal((await request(f,'/admin/exceptions','customer','PUT',{date,windows})).status,403);
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,windows})).status,200);
 assert.deepEqual((await availability()).slots,['10:00','15:00','15:30','16:00']);
 assert.equal((await request(f,'/bookings','customer','POST',{...payload(),time:'12:00'})).status,409);
 assert.equal((await request(f,'/bookings','customer','POST',payload())).status,201);
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,windows:[]})).status,200);
 assert.deepEqual((await availability()).slots,[]);
 assert.equal(f.db.prepare('SELECT status FROM bookings').get()?.status,'pending');
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,remove:true})).status,200);
 assert.deepEqual((await availability()).slots,[]);
 const weekly=Object.fromEntries(Array.from({length:7},(_,i)=>[i,[['10:00','18:00']]]));
 assert.equal((await request(f,'/admin/settings','owner','PUT',{...cfg,weekly})).status,200);
 assert.ok((await availability()).slots.includes('14:00'));
 assert.ok(!(await availability()).slots.includes('10:00'));
 f.db.close();
});
test('invalid date schedule writes leave the saved schedule unchanged',async()=>{
 const f=fixture(),date=payload().date,windows=[['10:00','12:00'],['15:00','18:00']];
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,windows})).status,200);
 for(const invalid of [[['10:00','12:00'],['11:00','13:00']],[['18:00','10:00']],[['10:00','10:00']],[['10:00','24:00']],Array.from({length:6},()=>['10:00','12:00'])]){
  assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,windows:invalid})).status,400);
 }
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date:'2026-02-30',windows})).status,400);
 assert.equal(f.db.prepare('SELECT windows FROM exceptions WHERE date=?').get(date)?.windows,JSON.stringify(windows));
 f.db.close();
});

test('remaining-duration migration updates saved settings while preserving bookings and other fields',async()=>{
 const f=fixture();
 const touchup={...SERVICES.find(s=>s.id==='touchup')!,description:'自訂補色說明',duration:null};
 const removal={...SERVICES.find(s=>s.id==='color-removal')!,duration:null,specs:[{label:'現場評估',price:2500}]};
 f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify(touchup),'touchup');
 f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify(removal),'color-removal');
 const settings=JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string);
 settings.addonDurations.lower=null;settings.address='測試地址';
 f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(settings));
 assert.equal((await request(f,'/bookings','customer','POST',payload())).status,201);
 const booking=f.db.prepare('SELECT * FROM bookings').get();
 f.db.exec(readFileSync(new URL('../migrations/0003_remaining_service_durations.sql',import.meta.url),'utf8'));
 const publicData=await (await request(f,'/public')).json() as {settings:typeof DEFAULT_SETTINGS;services:typeof SERVICES};
 assert.equal(publicData.services.find(s=>s.id==='touchup')?.duration,180);
 assert.equal(publicData.services.find(s=>s.id==='color-removal')?.duration,60);
 assert.equal(publicData.services.find(s=>s.id==='touchup')?.description,touchup.description);
 assert.equal(publicData.services.find(s=>s.id==='color-removal')?.specs[0].price,2500);
 assert.deepEqual(publicData.settings,{...settings,addonDurations:{...settings.addonDurations,lower:30}});
 assert.deepEqual(f.db.prepare('SELECT * FROM bookings').get(),booking);
 f.db.close();
});
