import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.ts';
import {sign,verify,validLineSignature,type Env} from '../worker/security.ts';
import {DEFAULT_SETTINGS,SERVICES,taipeiDay,offsetDate,taipeiMs,type AvailabilityDates} from '../src/domain.ts';
class Statement {
 constructor(public db:DatabaseSync,public sql:string,public args:unknown[]=[]){ }
 bind(...args:unknown[]){return new Statement(this.db,this.sql,args)}
 async first(){return this.db.prepare(this.sql).get(...this.args as never[])||null}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args as never[])}}
 async run(){const r=this.db.prepare(this.sql).run(...this.args as never[]);return {success:true,meta:{changes:Number(r.changes)}}}
}
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_group_limit.sql',import.meta.url),'utf8'));db.exec('ALTER TABLE bookings ADD COLUMN service_end INTEGER');db.exec(readFileSync(new URL('../migrations/0009_booking_changes.sql',import.meta.url),'utf8'));db.exec("CREATE TABLE notification_recipients(kind TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id))");const adapter={prepare:(sql:string)=>new Statement(db,sql),batch:async(statements:Statement[])=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};const env={DB:adapter as unknown as D1Database,AUTH_SECRET:'x'.repeat(40),ADMIN_LINE_USER_IDS:'owner',APP_ORIGIN:'https://booking.test',ASSETS:{fetch:()=>new Response('static')} as unknown as Fetcher} satisfies Env;db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0,weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[i,[['10:00','18:00']]]))}));for(const s of SERVICES)db.prepare('INSERT INTO services VALUES(?,?)').run(s.id,JSON.stringify({...s,duration:90,specs:s.specs.map(spec=>({...spec,duration:90}))}));for(const id of ['customer','other','owner'])db.prepare('INSERT INTO users VALUES(?,?,1,?)').run(id,'測試使用者',Date.now());const ctx={waitUntil:(_p:Promise<unknown>)=>{}} as ExecutionContext;return {db,env,ctx};}
async function request(f:ReturnType<typeof fixture>,path:string,user:string|null=null,method='GET',body?:unknown,origin='https://booking.test'){
 const headers:Record<string,string>={Origin:origin};if(user)headers.Cookie='linyan_session='+await sign({id:user,name:'測試使用者',expires:Date.now()+3600000},f.env.AUTH_SECRET!);if(body)headers['Content-Type']='application/json';return worker.fetch(new Request('https://booking.test/api'+path,{method,headers,body:body?JSON.stringify(body):undefined}),f.env,f.ctx);
}
function calendarFixture(){const f=fixture();f.db.exec(readFileSync(new URL('../migrations/0005_calendar_subscriptions.sql',import.meta.url),'utf8'));return f}
type CalendarSubscription={enabled:boolean;httpsUrl:string;webcalUrl:string};
async function feedRequest(f:ReturnType<typeof fixture>,url:string,method='GET'){return worker.fetch(new Request(url,{method}),f.env,f.ctx)}

test('calendar management requires admin identity and same-origin writes; enabling is idempotent',async()=>{
 const f=calendarFixture();
 try{
  assert.equal((await request(f,'/admin/calendar-subscription')).status,401);
  assert.equal((await request(f,'/admin/calendar-subscription','customer')).status,403);
  assert.equal((await request(f,'/admin/calendar-subscription','owner','POST',{},'https://evil.test')).status,403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM calendar_subscriptions').get()?.n,0);
  assert.deepEqual(await (await request(f,'/admin/calendar-subscription','owner')).json(),{enabled:false});
  const enabled=await request(f,'/admin/calendar-subscription','owner','POST',{}),data=await enabled.json() as CalendarSubscription;
  assert.ok(data.enabled);assert.equal(data.webcalUrl,data.httpsUrl.replace('https:','webcal:'));
  assert.equal(enabled.headers.get('referrer-policy'),'no-referrer');assert.match(enabled.headers.get('cache-control')!,/no-store/);
  assert.deepEqual(await (await request(f,'/admin/calendar-subscription','owner','POST',{})).json(),data);
  assert.deepEqual(await (await request(f,'/admin/calendar-subscription','owner')).json(),data);
  const token=new URL(data.httpsUrl).pathname.split('/').at(-1)!.slice(0,-4);
  const decoded=await verify<{purpose:string;id:string}>(token,f.env.AUTH_SECRET);
  assert.equal(decoded?.purpose,'calendar');assert.deepEqual(Object.keys(decoded!).sort(),['id','purpose']);
  assert.notEqual(decoded?.id,'owner');assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM audit').all()).includes(token));
  assert.equal((await feedRequest(f,data.httpsUrl)).status,200);
  assert.equal((await feedRequest(f,data.httpsUrl.replace(token,token+'x'))).status,404);
  const loginToken=await sign({id:'owner',name:'測試店家',expires:Date.now()+3600000},f.env.AUTH_SECRET!);
  assert.equal((await feedRequest(f,`https://booking.test/api/calendar/${loginToken}.ics`)).status,404);
 }finally{f.db.close()}
});

test('each administrator owns a separately revocable subscription and current authorization is checked on every fetch',async()=>{
 const f=calendarFixture();f.env.ADMIN_LINE_USER_IDS=' owner, other ';
 try{
  const enable=async(user:string,method='POST')=>await (await request(f,'/admin/calendar-subscription',user,method,{})).json() as CalendarSubscription;
  const owner=await enable('owner'),other=await enable('other');assert.notEqual(owner.httpsUrl,other.httpsUrl);
  const newer=await enable('owner','PUT');assert.notEqual(newer.httpsUrl,owner.httpsUrl);
  assert.equal((await feedRequest(f,owner.httpsUrl)).status,404);assert.equal((await feedRequest(f,newer.httpsUrl)).status,200);
  assert.equal((await feedRequest(f,other.httpsUrl)).status,200);
  assert.deepEqual(await (await request(f,'/admin/calendar-subscription','owner','DELETE',{})).json(),{enabled:false});
  assert.equal((await feedRequest(f,newer.httpsUrl)).status,404);assert.equal((await feedRequest(f,other.httpsUrl)).status,200);
  f.env.ADMIN_LINE_USER_IDS='owner';assert.equal((await feedRequest(f,other.httpsUrl)).status,404);
  f.env.ADMIN_LINE_USER_IDS='owner,other';assert.equal((await feedRequest(f,other.httpsUrl)).status,200);
  f.env.AUTH_SECRET='rotated test signing value with sufficient length';assert.equal((await feedRequest(f,other.httpsUrl)).status,404);
 }finally{f.db.close()}
});

test('the cookie-free calendar tracks confirmed and completed bookings with stable identity, buffer and limited personal data',async(t)=>{
 const f=calendarFixture();
 try{
  const booking=await (await request(f,'/bookings','customer','POST',{...payload(),customer:'私人測試客人',note:'不公開的備註'})).json() as {id:string};
  const data=await (await request(f,'/admin/calendar-subscription','owner','POST',{})).json() as CalendarSubscription;
  assert.ok(!(await (await feedRequest(f,data.httpsUrl)).text()).includes('BEGIN:VEVENT'));
  const update=async(version:number,status:string)=>assert.equal((await request(f,`/admin/bookings/${booking.id}`,'owner','PATCH',{version,status,price:900,paid:false})).status,200);
  await update(1,'confirmed');
  const response=await feedRequest(f,data.httpsUrl),ics=await response.text();
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^text\/calendar/);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('cache-control')!,/no-store/);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.ok(ics.includes('SUMMARY:私人測試客人 · 日式單根'));assert.ok(ics.includes(`UID:${booking.id}@booking.test`));
  const b=f.db.prepare('SELECT end FROM bookings WHERE id=?').get(booking.id)!;
  assert.ok(ics.includes('DTEND:'+new Date(Number(b.end)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')));
  for(const privateValue of ['0900000000','不公開的備註','user_id','NT$900'])assert.ok(!ics.includes(privateValue));
  assert.equal(await (await feedRequest(f,data.httpsUrl)).text(),ics);
  const head=await feedRequest(f,data.httpsUrl,'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.match(head.headers.get('content-type')!,/^text\/calendar/);
  const realNow=Date.now(),completedAt=taipeiMs(payload().date,'23:00');t.mock.method(Date,'now',()=>completedAt);await update(2,'completed');t.mock.method(Date,'now',()=>realNow);const completed=await (await feedRequest(f,data.httpsUrl)).text();
  assert.ok(completed.includes('（已完成）'));assert.ok(completed.includes('SEQUENCE:3'));assert.ok(completed.includes(`UID:${booking.id}@booking.test`));
  const cancelled=await (await request(f,'/bookings','customer','POST',{...payload(),date:offsetDate(payload().date,1)})).json() as {id:string};
  assert.equal((await request(f,`/admin/bookings/${cancelled.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,200);
  assert.ok((await (await feedRequest(f,data.httpsUrl)).text()).includes(`UID:${cancelled.id}`));
  assert.equal((await request(f,`/admin/bookings/${cancelled.id}`,'owner','PATCH',{version:2,status:'cancelled',price:900,paid:false})).status,200);
  assert.ok(!(await (await feedRequest(f,data.httpsUrl)).text()).includes(`UID:${cancelled.id}`));
 }finally{f.db.close()}
});

test('calendar excludes rejected or distant bookings and returns an error rather than an incomplete oversized feed',async()=>{
 const f=calendarFixture();
 try{
  const insert=f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at) VALUES(?,'測試客人','0900000000','single','日式單根','100 根','{}',?,?,?,900,?,1,1)");
  const base=taipeiDay();
  for(const [id,offset,status] of [['old',-31,'completed'],['far',181,'confirmed'],['rejected',1,'rejected'],['no-show',2,'no_show'],['expired',3,'expired']] as const){
   const day=offsetDate(base,offset),start=taipeiMs(day,'10:00');insert.run(id,day,start,start+9000000,status);
  }
  const data=await (await request(f,'/admin/calendar-subscription','owner','POST',{})).json() as CalendarSubscription;
  assert.ok(!(await (await feedRequest(f,data.httpsUrl)).text()).includes('BEGIN:VEVENT'));
  const date=offsetDate(base,1),start=taipeiMs(date,'10:00');
  for(let i=0;i<2001;i++)insert.run('many-'+i,date,start,start+9000000,'completed');
  const response=await feedRequest(f,data.httpsUrl);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'3600');
  assert.ok(!(await response.text()).includes('BEGIN:VCALENDAR'));
 }finally{f.db.close()}
});
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
test('customers cannot read or cancel another user booking; approval is not payment',async()=>{const f=fixture();const created=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};const rows=await (await request(f,'/bookings','other')).json() as {bookings:unknown[]};assert.equal(rows.bookings.length,0);assert.equal((await request(f,`/bookings/${created.id}/cancel`,'other','POST',{})).status,404);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,200);const b=f.db.prepare('SELECT * FROM bookings').get();assert.equal(b?.status,'confirmed');assert.equal(b?.paid,0);assert.equal(f.db.prepare('SELECT state FROM notifications').get()?.state,'queued');assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:true,paidAmount:900})).status,409);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:2,status:'confirmed',price:900,paid:true,paidAmount:900})).status,409);f.db.close();});
test('expired requests release slots and cannot be approved',async()=>{const f=fixture();const c=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};f.db.prepare('UPDATE bookings SET expires_at=1 WHERE id=?').run(c.id);assert.equal((await request(f,`/admin/bookings/${c.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,409);const available=await (await request(f,`/availability?service=single&date=${payload().date}`)).json() as {slots:string[]};assert.ok(available.slots.includes('10:00'));assert.equal(f.db.prepare('SELECT status FROM bookings').get()?.status,'expired');f.db.close();});
test('unset durations, unverified friendships and invalid settings block writes',async()=>{const f=fixture();f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],duration:null,specs:SERVICES[0].specs.map(s=>({...s,duration:null}))}),'single');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,409);f.db.prepare('UPDATE users SET friend=0 WHERE id=?').run('customer');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,403);assert.equal((await request(f,'/admin/settings','owner','PUT',{...DEFAULT_SETTINGS,stepMinutes:0})).status,400);f.db.close();});
test('webhook body signatures are validated',async()=>{const secret='test webhook signing value';const raw='{"events":[]}';const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw)));const sig=btoa(String.fromCharCode(...bytes));assert.equal(await validLineSignature(raw,sig,secret),true);assert.equal(await validLineSignature(raw+' ',sig,secret),false);const f=fixture();assert.equal((await request(f,'/line/webhook',null,'POST',{events:[]})).status,401);f.db.close();});

test('nearest available dates respect full duration, occupied slots, expiry and booking horizon without exposing customers',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-07T00:00:00+08:00'));
 const f=fixture(),first=taipeiDay(),blocked=offsetDate(first,2),open=offsetDate(first,10);
 try{
  f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0,bookingDays:12}));
  f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],specs:SERVICES[0].specs.map(s=>({...s,duration:undefined}))}),'single');
  for(const [date,windows] of [[offsetDate(first,1),[['10:00','12:00']]],[blocked,[['10:00','12:30']]],[open,[['10:00','13:00']]],[offsetDate(first,12),[['10:00','18:00']]]] as const){
   f.db.prepare('INSERT INTO exceptions VALUES(?,?)').run(date,JSON.stringify(windows));
  }
  f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at) VALUES('occupied','秘密客人','0900000000','single','日式單根','100 根','{}',?,?,?,900,'confirmed',1,1)").run(blocked,taipeiMs(blocked,'10:00'),taipeiMs(blocked,'12:30'));
  const get=async(query='')=>await (await request(f,'/availability/dates?service=single'+query)).json() as AvailabilityDates;
  const result=await get();
  assert.equal(result.days.length,12);assert.equal(result.firstAvailableDate,open);
  assert.deepEqual(result.days.find(d=>d.date===offsetDate(first,1))?.slots,[]);
  assert.deepEqual(result.days.find(d=>d.date===blocked)?.slots,[]);
  assert.deepEqual(result.days.find(d=>d.date===open)?.slots,['10:00','10:15','10:30']);
  assert.ok(result.days.every(d=>Object.keys(d).sort().join(',')==='date,slots'));
  assert.ok(!JSON.stringify(result).includes('秘密客人'));
  assert.equal(result.days.at(-1)?.date,offsetDate(first,11));
  const single=await (await request(f,`/availability?service=single&date=${open}`)).json() as {slots:string[]};
  assert.deepEqual(single.slots,result.days.find(d=>d.date===open)?.slots);
  assert.deepEqual((await get('&lower=true')).days.find(d=>d.date===open)?.slots,['10:00']);
  assert.equal((await get('&lower=true&removal=own')).firstAvailableDate,null);
  f.db.prepare("UPDATE bookings SET status='pending',expires_at=1 WHERE id='occupied'").run();
  assert.equal((await get()).firstAvailableDate,blocked);
  assert.equal(f.db.prepare("SELECT status FROM bookings WHERE id='occupied'").get()?.status,'expired');
  assert.equal((await request(f,'/availability/dates?service=missing')).status,404);
  assert.equal((await request(f,'/availability/dates?service=brows&lower=true')).status,400);
  f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],duration:null,specs:SERVICES[0].specs.map(s=>({...s,duration:null}))}),'single');
  const unset=await get();assert.equal(unset.firstAvailableDate,null);assert.deepEqual(unset.days,[]);assert.ok(unset.reason);
 }finally{f.db.close();}
});

test('date schedules open split windows without weekly shifts, and closure preserves existing bookings',async()=>{
 const f=fixture(),date=payload().date;
 const cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 assert.equal((await request(f,'/admin/settings','owner','PUT',cfg)).status,200);
 const availability=async()=>await (await request(f,`/availability?service=single&date=${date}`)).json() as {slots:string[]};
 assert.deepEqual((await availability()).slots,[]);
 const windows=[['15:00','18:00'],['10:00','12:00']];
 assert.equal((await request(f,'/admin/exceptions','customer','PUT',{date,windows})).status,403);
 assert.equal((await request(f,'/admin/exceptions','owner','PUT',{date,windows})).status,200);
 assert.deepEqual((await availability()).slots,['10:00','15:00','15:15','15:30','15:45','16:00']);
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

test('new studio policy migration updates the old default and preserves owner-written notices',()=>{
 const f=fixture(),sql=readFileSync(new URL('../migrations/0004_studio_booking_policy.sql',import.meta.url),'utf8');
 const settings=JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string);
 const previous='預約須經店家確認後才正式成立。到店以現金付款。取消、改期與遲到規則請於預約前向店家確認。';
 f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...settings,policies:previous}));
 f.db.exec(sql.split('CREATE TABLE IF NOT EXISTS notification_recipients')[0]);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string),settings);
 f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...settings,policies:'店家自行填寫的規則'}));
 f.db.exec(sql.split('CREATE TABLE IF NOT EXISTS notification_recipients')[0]);
 assert.equal(JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string).policies,'店家自行填寫的規則');
 f.db.close();
});

test('LINE authentication errors return to the website with a safe prompt instead of a JSON error page',async(t)=>{
 const f=fixture(),env={...f.env,LINE_LOGIN_CHANNEL_ID:'test-login-id',LINE_LOGIN_CHANNEL_SECRET:'test-login-secret',APP_ORIGIN:'https://booking.test/'};
 try{
  const invalid=await request({...f,env},'/auth/line/callback?state=invalid&code=invalid');
  assert.equal(invalid.status,302);assert.equal(invalid.headers.get('location'),'https://booking.test/?authError=expired#booking');
  assert.equal(await invalid.text(),'');assert.match(invalid.headers.get('set-cookie')!,/linyan_oauth=;.*Max-Age=0/);
  const expired=await sign({state:'state',nonce:'nonce',returnTo:'admin',expires:Date.now()-1},env.AUTH_SECRET!);
  const response=await worker.fetch(new Request('https://booking.test/api/auth/line/callback?state=state&code=test',{headers:{Cookie:'linyan_oauth='+expired}}),env,f.ctx);
  assert.equal(response.headers.get('location'),'https://booking.test/?authError=expired#admin');
  const cancelled=await request({...f,env},'/auth/line/callback?error=access_denied');
  assert.equal(cancelled.headers.get('location'),'https://booking.test/?authError=cancelled#booking');
  const unavailable=await request(f,'/auth/line?returnTo=admin');
  assert.equal(unavailable.headers.get('location'),'https://booking.test/?authError=unavailable#admin');
  const valid=await sign({state:'state',nonce:'nonce',returnTo:'my',expires:Date.now()+60000},env.AUTH_SECRET!);
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:401}));
  const failed=await worker.fetch(new Request('https://booking.test/api/auth/line/callback?state=state&code=test',{headers:{Cookie:'linyan_oauth='+valid}}),env,f.ctx);
  assert.equal(failed.headers.get('location'),'https://booking.test/?authError=failed#my');
  assert.equal((await request(f,'/bookings')).status,401);
 }finally{f.db.close()}
});

function inviteFixture(){const f=fixture();f.db.exec(readFileSync(new URL('../migrations/0006_combo_and_invitations.sql',import.meta.url),'utf8').split('CREATE TABLE IF NOT EXISTS notification_recipients')[0]);return f}
async function manualInvite(f:ReturnType<typeof fixture>,confirmed=false){
 const response=await request(f,'/admin/bookings','owner','POST',payload());assert.equal(response.status,201);
 const {id}=await response.json() as {id:string};
 // Existing pending manual bookings still support invitations after the new direct-confirm flow.
 if(!confirmed)f.db.prepare("UPDATE bookings SET status='pending',expires_at=? WHERE id=?").run(Date.now()+86400000,id);
 const invite=await request(f,'/admin/bookings/'+id+'/invitation','owner','POST',{});assert.equal(invite.status,200);
 const {url}=await invite.json() as {url:string};return {id,token:new URL(url).hash.slice('#invite/'.length)};
}
test('manual invitation only binds after verified LINE login and approval sends to the bound customer',async()=>{
 const f=inviteFixture();try{
  const {id,token}=await manualInvite(f);
  assert.equal(token.length,43);assert.equal(f.db.prepare('SELECT user_id FROM bookings WHERE id=?').get(id)?.user_id,null);
  assert.equal((await request(f,'/admin/bookings/'+id+'/invitation','customer','POST',{})).status,403);
  assert.equal((await request(f,'/invitations/preview',null,'POST',{token})).status,401);
  const preview=await (await request(f,'/invitations/preview','customer','POST',{token})).json() as Record<string,unknown>;
  assert.ok(preview.booking);for(const value of ['phone','note','user_id','0900000000'])assert.ok(!JSON.stringify(preview).includes(value));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM booking_invitations').all()).includes(token));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM audit').all()).includes(token));
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token},'https://evil.test')).status,403);
  f.db.prepare("UPDATE users SET friend=0 WHERE id='customer'").run();
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,403);
  assert.equal(f.db.prepare('SELECT claimed_at FROM booking_invitations').get()?.claimed_at,null);
  f.db.prepare("UPDATE users SET friend=1 WHERE id='customer'").run();
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,200);
  const b=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;assert.equal(b.user_id,'customer');assert.equal(b.version,2);assert.equal(b.status,'pending');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,0);
  assert.equal((await request(f,'/invitations/claim','other','POST',{token})).status,404);
  assert.equal((await request(f,'/admin/bookings/'+id+'/invitation','owner','POST',{})).status,409);
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:2,status:'confirmed',price:900,paid:false})).status,200);
  assert.equal(f.db.prepare('SELECT user_id FROM notifications').get()?.user_id,'customer');
  assert.equal(f.db.prepare('SELECT kind FROM notifications').get()?.kind,'confirmed');
 }finally{f.db.close()}
});
test('rotated, expired, cancelled and already claimed invitations cannot bind a booking',async()=>{
 const f=inviteFixture();try{
  const {id,token}=await manualInvite(f);
  const updated=await (await request(f,'/admin/bookings/'+id+'/invitation','owner','POST',{})).json() as {url:string};
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,404);
  const newer=new URL(updated.url).hash.slice(8);
  f.db.prepare('UPDATE booking_invitations SET expires_at=1').run();
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token:newer})).status,404);
  f.db.prepare('UPDATE booking_invitations SET expires_at=?').run(Date.now()+86400000);
  f.db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(id);
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token:newer})).status,404);
  assert.equal(f.db.prepare('SELECT user_id FROM bookings WHERE id=?').get(id)?.user_id,null);
 }finally{f.db.close()}
});
test('binding a previously approved manual booking queues exactly one confirmation and does not change payment',async()=>{
 const f=inviteFixture();try{
  const {id,token}=await manualInvite(f,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,0);
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,200);
  assert.equal(f.db.prepare('SELECT kind,user_id FROM notifications').get()?.kind,'confirmed');
  assert.equal(f.db.prepare('SELECT paid FROM bookings WHERE id=?').get(id)?.paid,0);
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,404);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,1);
 }finally{f.db.close()}
});
test('LINE login round trips an invitation route and rejects untrusted destinations',async(t)=>{
 const f=fixture(),env={...f.env,LINE_LOGIN_CHANNEL_ID:'test-login-id',LINE_LOGIN_CHANNEL_SECRET:'test-login-secret'};
 try{
  const route='invite/'+'A'.repeat(43),entry=await request({...f,env},'/auth/line?returnTo='+encodeURIComponent(route));
  const token=entry.headers.get('set-cookie')!.split(';')[0].split('=')[1];
  const oauth=await verify<{state:string;nonce:string;returnTo:string}>(token,env.AUTH_SECRET);assert.equal(oauth?.returnTo,route);
  const wrong=await request({...f,env},'/auth/line?returnTo='+encodeURIComponent('https://evil.test'));
  assert.equal((await verify<{returnTo:string}>(wrong.headers.get('set-cookie')!.split(';')[0].split('=')[1],env.AUTH_SECRET))?.returnTo,'booking');
  let calls=0;t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(++calls===1?{id_token:'test',access_token:'test'}:calls===2?{sub:'customer',name:'測試客人',nonce:oauth!.nonce}:{friendFlag:true}),{headers:{'Content-Type':'application/json'}}));
  const callback=await worker.fetch(new Request('https://booking.test/api/auth/line/callback?state='+oauth!.state+'&code=test',{headers:{Cookie:'linyan_oauth='+token}}),env,f.ctx);
  assert.equal(callback.headers.get('location'),'https://booking.test/#'+route);
  const expired=await sign({...oauth,expires:1},env.AUTH_SECRET);
  const error=await worker.fetch(new Request('https://booking.test/api/auth/line/callback?state='+oauth!.state+'&code=test',{headers:{Cookie:'linyan_oauth='+expired}}),env,f.ctx);
  assert.equal(error.headers.get('location'),'https://booking.test/?authError=expired#'+route);
 }finally{f.db.close()}
});
test('combined menu migration uses saved prices, preserves existing records and is idempotent',()=>{
 const f=fixture();try{
  f.db.prepare("DELETE FROM services WHERE id='combo-brows-lashes'").run();
  f.db.prepare("UPDATE services SET data=json_set(data,'$.specs[1].price',1300,'$.duration',155) WHERE id='single'").run();
  f.db.prepare("UPDATE services SET data=json_set(data,'$.specs[0].price',5500) WHERE id='brows'").run();
  const before=f.db.prepare('SELECT * FROM services ORDER BY id').all();
  const sql=readFileSync(new URL('../migrations/0006_combo_and_invitations.sql',import.meta.url),'utf8');f.db.exec(sql.split('CREATE TABLE IF NOT EXISTS notification_recipients')[0]);
  const service=JSON.parse(f.db.prepare("SELECT data FROM services WHERE id='combo-brows-lashes'").get()!.data as string);
  assert.equal(service.duration,270);assert.equal(service.specs.length,12);assert.equal(service.specs.find((s:{label:string})=>s.label==='日式單根・150 根').price,6800);
  assert.deepEqual(f.db.prepare("SELECT * FROM services WHERE id<>'combo-brows-lashes' ORDER BY id").all(),before);
  f.db.exec(sql.split('-- Invitations')[0]);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM services WHERE id='combo-brows-lashes'").get()?.n,1);
 }finally{f.db.close()}
});

test('new customer bookings notify only the configured current admin without confirming the reservation',async()=>{
 const f=fixture();f.env.ADMIN_LINE_USER_IDS='owner,other';f.db.prepare("INSERT INTO notification_recipients VALUES('review_requested','owner')").run();
 try{
  const response=await request(f,'/bookings','customer','POST',payload());assert.equal(response.status,201);
  const {id}=await response.json() as {id:string};
  const notices=f.db.prepare('SELECT * FROM notifications').all();assert.equal(notices.length,1);assert.equal(notices[0].user_id,'owner');assert.equal(notices[0].kind,'review_requested');assert.match(String(notices[0].text),/請審核/);assert.match(String(notices[0].text),/https:\/\/booking.test\/#admin/);
  assert.equal(f.db.prepare('SELECT status FROM bookings WHERE id=?').get(id)?.status,'pending');
  assert.equal((await request(f,'/bookings','customer','POST',payload())).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,1);
  assert.equal((await request(f,'/admin/bookings','owner','POST',{...payload(),time:'14:00'})).status,201);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,1);
 }finally{f.db.close()}
});
test('review notifications never fall back to a different admin or trust a client supplied recipient',async()=>{
 const f=fixture();f.db.prepare("INSERT INTO notification_recipients VALUES('review_requested','customer')").run();
 try{
  assert.equal((await request(f,'/bookings','customer','POST',{...payload(),reviewRecipient:'other'})).status,201);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n,0);
 }finally{f.db.close()}
});

test('customers see the service end while occupancy reserves at least thirty minutes, independent of later settings',async()=>{
 const f=fixture();try{
  const p=payload(),start=taipeiMs(p.date,p.time);
  const created=await request(f,'/bookings','customer','POST',{...p,note:'owner-private note'});
  assert.equal(created.status,201);const {id}=await created.json() as {id:string};
  const db=f.db.prepare('SELECT start,end,service_end FROM bookings WHERE id=?').get(id)!;
  assert.equal(db.service_end,start+90*60000);assert.equal(db.end,start+120*60000);
  const bookings=async()=>((await (await request(f,'/bookings','customer')).json()) as {bookings:{end:number;service_end:number}[]}).bookings;
  assert.equal((await bookings())[0].end,db.service_end);
  const customerText=JSON.stringify(await (await request(f,'/bookings','customer')).json());assert.ok(!customerText.includes('owner-private note'));assert.ok(!customerText.includes('bufferMinutes'));
  assert.equal((await request(f,'/bookings','other','POST',{...p,time:'11:30'})).status,409);
  for(const bufferMinutes of [0,9])assert.equal((await request(f,'/admin/settings','owner','PUT',{...DEFAULT_SETTINGS,bufferMinutes})).status,400);
  const cfg=JSON.parse(String(f.db.prepare('SELECT data FROM settings WHERE id=1').get()!.data));cfg.bufferMinutes=45;f.db.prepare('UPDATE settings SET data=?').run(JSON.stringify(cfg));
  assert.equal((await bookings())[0].end,db.service_end);
  const next=await request(f,'/bookings','other','POST',{...p,time:'12:00'});assert.equal(next.status,201);
  const later=f.db.prepare('SELECT end,service_end FROM bookings WHERE id<>?').get(id)!;assert.equal(Number(later.end)-Number(later.service_end),45*60000);
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,200);
  const message=String(f.db.prepare("SELECT text FROM notifications WHERE booking_id=? AND kind='confirmed'").get(id)!.text);
  assert.match(message,/時間：10:00–11:30/);assert.ok(!message.includes('12:00'));assert.ok(!message.includes('整理'));
 }finally{f.db.close()}
});

test('service-end migration retains exceptional arrangements and occupied intervals without modifying status, price or version',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({...DEFAULT_SETTINGS,bufferMinutes:30}));
  const oldDescription='一次完成眉眼的美好。服務 4.5 小時，另保留 30 分鐘整理；可選擇睫毛款式與根數。';
  const service=SERVICES.find(s=>s.category==='combo')!;db.prepare('INSERT INTO services VALUES(?,?)').run(service.id,JSON.stringify({...service,description:oldDescription}));
  const date=offsetDate(taipeiDay(),10),start=taipeiMs(date,'16:30'),end=taipeiMs(date,'20:30');
  db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('exception','測試客人','0900000000',service.id,service.name,'測試規格','{}',date,start,end,6000,'pending',1,1,2);
  db.exec(readFileSync(new URL('../migrations/0007_service_end.sql',import.meta.url),'utf8'));
  const row=db.prepare('SELECT service_end,end,status,price,version FROM bookings').get()!;
  assert.equal(row.service_end,taipeiMs(date,'20:00'));assert.equal(row.end,end);assert.equal(row.status,'pending');assert.equal(row.price,6000);assert.equal(row.version,2);
  assert.ok(!String(db.prepare('SELECT data FROM services').get()!.data).includes('整理'));
 }finally{db.close()}
});

test('manual creation is confirmed immediately, preserves cleanup and reuses only an explicitly selected customer LINE identity',async()=>{
 const f=fixture();try{
  assert.equal((await request(f,'/admin/customers','customer')).status,403);
  assert.equal((await request(f,'/admin/customers')).status,401);
  const first=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};
  const customers=await (await request(f,'/admin/customers','owner')).json() as {customers:{id:string;lineBound:boolean}[]};
  assert.equal(customers.customers.length,1);assert.equal(customers.customers[0].id,first.id);assert.equal(customers.customers[0].lineBound,true);
  const manual=await request(f,'/admin/bookings','owner','POST',{...payload(),time:'12:00',existingCustomerId:first.id,user_id:'other',manualPrice:850});
  assert.equal(manual.status,201);const created=await manual.json() as {id:string;status:string;lineBound:boolean;notificationQueued:boolean};
  assert.equal(created.status,'confirmed');assert.equal(created.lineBound,true);assert.equal(created.notificationQueued,true);
  const b=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(created.id)!;
  assert.equal(b.user_id,'customer');assert.equal(b.price,850);assert.equal(b.price_confirmed,1);assert.equal(b.expires_at,null);assert.equal(Number(b.end)-Number(b.service_end),30*60000);
  const notice=f.db.prepare('SELECT * FROM notifications WHERE booking_id=?').get(created.id)!;assert.equal(notice.kind,'confirmed');assert.equal(notice.user_id,'customer');assert.match(String(notice.text),/12:00–13:30/);assert.ok(!String(notice.text).includes('整理'));
  const fresh=await (await request(f,'/admin/bookings','owner','POST',{...payload(),time:'14:00',user_id:'customer'})).json() as {id:string;status:string;lineBound:boolean};
  assert.equal(fresh.status,'confirmed');assert.equal(fresh.lineBound,false);assert.equal(f.db.prepare('SELECT user_id FROM bookings WHERE id=?').get(fresh.id)!.user_id,null);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE booking_id=?').get(fresh.id)!.n,0);
  assert.equal((await request(f,'/admin/bookings','owner','POST',{...payload(),time:'16:00',existingCustomerId:'unknown'})).status,404);
 }finally{f.db.close()}
});

test('directly confirmed manual bookings require eligible refill/touchup records and customer requests cannot bypass review',async()=>{
 const f=fixture();try{
  assert.equal((await request(f,'/admin/bookings','owner','POST',{...payload(),serviceId:'refill',previousId:'missing',manualPrice:500})).status,409);
  assert.equal((await request(f,'/admin/bookings','owner','POST',{...payload(),serviceId:'touchup',previousId:'missing'})).status,409);
  const response=await request(f,'/bookings','customer','POST',{...payload(),status:'confirmed',manualPrice:1,existingCustomerId:'owner'});assert.equal(response.status,201);
  const b=f.db.prepare('SELECT status,price,user_id FROM bookings').get()!;assert.equal(b.status,'pending');assert.equal(b.price,900);assert.equal(b.user_id,'customer');
 }finally{f.db.close()}
});

type ChangeResult={id:string;state:string;price:number;expiresAt:number;old:{date:string;start:number;end:number};proposed:{date:string;start:number;end:number}};
async function booked(f:ReturnType<typeof fixture>,user='customer',time='10:00'){
 const p={...payload(),time};const response=await request(f,'/bookings',user,'POST',p);assert.equal(response.status,201);const {id}=await response.json() as {id:string};
 assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:true,paidAmount:900})).status,200);return {id,p};
}
async function proposed(f:ReturnType<typeof fixture>,id:string,version=2,overrides:Record<string,unknown>={}){
 const response=await request(f,'/admin/bookings/'+id+'/changes','owner','POST',{version,date:offsetDate(payload().date,1),time:'14:00',duration:100,price:900,reason:'調整當日排班',...overrides});
 assert.equal(response.status,201,await response.clone().text());return (await response.json() as {change:ChangeResult}).change;
}
test('root-duration migration changes only lash specs; availability and booking use the selected duration and settings edits retain it',async()=>{
 const f=fixture();try{
  const original=await booked(f);const before=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(original.id);
  f.db.exec(readFileSync(new URL('../migrations/0008_lash_spec_durations.sql',import.meta.url),'utf8'));
  assert.deepEqual(f.db.prepare('SELECT * FROM bookings WHERE id=?').get(original.id),before);
  const s=JSON.parse(String(f.db.prepare("SELECT data FROM services WHERE id='single'").get()!.data));assert.deepEqual(s.specs.map((x:{duration:number})=>x.duration),[80,90,100]);assert.deepEqual(s.specs.map((x:{price:number})=>x.price),[900,1000,1100]);
  const date=offsetDate(payload().date,1);f.db.prepare('INSERT INTO exceptions VALUES(?,?)').run(date,JSON.stringify([['10:00','12:00']]));
  const availability=async(spec:number)=>await (await request(f,`/availability?service=single&spec=${spec}&date=${date}`)).json() as {duration:number;slots:string[]};
  assert.equal((await availability(0)).duration,80);assert.deepEqual((await availability(0)).slots,['10:00']);assert.equal((await availability(1)).duration,90);assert.deepEqual((await availability(1)).slots,['10:00']);assert.equal((await availability(2)).duration,100);assert.deepEqual((await availability(2)).slots,[]);
  assert.equal((await request(f,`/availability?service=single&spec=99&date=${date}`)).status,400);
  const created=await request(f,'/bookings','other','POST',{...payload(),date,spec:1});assert.equal(created.status,201);const row=f.db.prepare('SELECT start,service_end,end FROM bookings WHERE user_id=?').get('other')!;assert.equal(Number(row.service_end)-Number(row.start),90*60000);assert.equal(Number(row.end)-Number(row.service_end),30*60000);
  const items=SERVICES.map(x=>({...x}));assert.equal((await request(f,'/admin/services','owner','PUT',{services:items})).status,200);assert.deepEqual(JSON.parse(String(f.db.prepare("SELECT data FROM services WHERE id='single'").get()!.data)).specs.map((x:{duration:number})=>x.duration),[80,90,100]);
 }finally{f.db.close()}
});

test('a proposal reserves both intervals, only the owner customer may accept, and the move atomically preserves identity and payment',async()=>{
 const f=calendarFixture();f.db.prepare("INSERT INTO notification_recipients VALUES('review_requested','owner')").run();try{
  const {id,p}=await booked(f);const original=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
  const feed=await (await request(f,'/admin/calendar-subscription','owner','POST',{})).json() as CalendarSubscription;const before=await (await feedRequest(f,feed.httpsUrl)).text();
  const c=await proposed(f,id);assert.deepEqual(f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id),original);assert.equal(await (await feedRequest(f,feed.httpsUrl)).text(),before);
  assert.equal(c.old.end,original.service_end);assert.equal(c.proposed.end,taipeiMs(c.proposed.date,'15:40'));
  const msg=String(f.db.prepare('SELECT text FROM notifications WHERE kind=?').get('reschedule_requested:'+c.id)!.text);assert.ok(msg.includes('/#reschedule/'+c.id));assert.ok(!msg.includes('整理'));assert.ok(!msg.includes('16:10'));
  const visible=JSON.stringify(await (await request(f,'/changes/'+c.id,'customer')).json());for(const privateField of ['0900000000','base_version','created_by','16:10','booking_id'])assert.ok(!visible.includes(privateField));
  assert.equal((await request(f,'/changes/'+c.id,'other')).status,404);assert.equal((await request(f,'/changes/'+c.id+'/respond','owner','POST',{decision:'accept'})).status,404);assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'},'https://evil.test')).status,403);
  assert.equal((await request(f,'/bookings','other','POST',{...p,date:c.proposed.date,time:'14:00'})).status,409);assert.equal((await request(f,'/bookings','other','POST',p)).status,409);
  assert.throws(()=>f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at) VALUES('race','競爭客人','0900000000','single','日式單根','100 根','{}',?,?,?,900,'confirmed',1,1)").run(c.proposed.date,c.proposed.start,c.proposed.end+30*60000),/SLOT_TAKEN/);
  const responses=await Promise.all([request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'}),request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const moved=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;assert.equal(moved.date,c.proposed.date);assert.equal(moved.start,c.proposed.start);assert.equal(moved.service_end,c.proposed.end);assert.equal(Number(moved.end)-Number(moved.service_end),30*60000);assert.equal(moved.status,'confirmed');assert.equal(moved.version,3);assert.equal(moved.paid,1);assert.equal(moved.paid_amount,900);assert.equal(moved.user_id,'customer');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE kind=?').get('reschedule_confirmed:'+c.id)!.n,1);assert.equal(f.db.prepare('SELECT user_id FROM notifications WHERE kind=?').get('reschedule_response:'+c.id)!.user_id,'owner');
  const after=await (await feedRequest(f,feed.httpsUrl)).text();assert.ok(after.includes('UID:'+id+'@booking.test'));assert.ok(after.includes('SEQUENCE:3'));assert.notEqual(after,before);
  assert.equal((await request(f,'/bookings','other','POST',p)).status,201);
 }finally{f.db.close()}
});

test('decline, withdrawal and expiry release the proposed hold and keep the original reservation',async()=>{
 for(const action of ['decline','withdraw','expire']){
  const f=fixture();try{
   const {id,p}=await booked(f);const before=f.db.prepare('SELECT date,start,end,service_end,status,version FROM bookings WHERE id=?').get(id)!;const c=await proposed(f,id);
   if(action==='decline')assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'decline'})).status,200);
   if(action==='withdraw'){
    assert.equal((await request(f,'/admin/changes/'+c.id+'/withdraw','customer','POST',{})).status,403);
    assert.equal((await request(f,'/admin/changes/'+c.id+'/withdraw','owner','POST',{})).status,200);
   }
   if(action==='expire'){f.db.prepare('UPDATE booking_changes SET expires_at=1 WHERE id=?').run(c.id);await request(f,'/changes/'+c.id,'customer');}
   assert.deepEqual(f.db.prepare('SELECT date,start,end,service_end,status,version FROM bookings WHERE id=?').get(id),before);assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(c.id)!.state,action==='decline'?'declined':action==='withdraw'?'withdrawn':'expired');
   assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})).status,409);
   assert.equal((await request(f,'/bookings','other','POST',{...p,date:c.proposed.date,time:'14:00'})).status,201);
  }finally{f.db.close()}
 }
});

test('pending customer bookings become confirmed only when they accept; proposals block approving the original time',async()=>{
 const f=fixture();try{
  const {id}=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};const c=await proposed(f,id,1);
  assert.equal(f.db.prepare('SELECT status FROM bookings WHERE id=?').get(id)!.status,'pending');assert.ok(c.expiresAt<=Number(f.db.prepare('SELECT expires_at FROM bookings WHERE id=?').get(id)!.expires_at));
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:1,status:'confirmed',price:900})).status,409);
  assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})).status,200);assert.equal(f.db.prepare('SELECT status FROM bookings WHERE id=?').get(id)!.status,'confirmed');
 }finally{f.db.close()}
});

test('two proposals cannot hold the same time and cancellation or version changes invalidate stale replies',async()=>{
 const f=fixture();try{
  const a=await booked(f),b=await booked(f,'other','12:00'),proposal={version:2,date:offsetDate(payload().date,1),time:'14:00',duration:90,price:900};
  const replies=await Promise.all([request(f,'/admin/bookings/'+a.id+'/changes','owner','POST',proposal),request(f,'/admin/bookings/'+b.id+'/changes','owner','POST',proposal)]);assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
  const c=f.db.prepare("SELECT * FROM booking_changes WHERE state='pending'").get()!;const row=f.db.prepare('SELECT user_id FROM bookings WHERE id=?').get(String(c.booking_id))!;
  assert.equal((await request(f,'/admin/bookings/'+c.booking_id,'owner','PATCH',{version:2,status:'cancelled',price:900})).status,200);assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(String(c.id))!.state,'obsolete');assert.equal((await request(f,'/changes/'+c.id+'/respond',String(row.user_id),'POST',{decision:'accept'})).status,409);
 }finally{f.db.close()}
});

test('an unbound manual customer can bind their invitation without losing the proposed hold or accepting automatically',async()=>{
 const f=inviteFixture();try{
  const {id,token}=await manualInvite(f,true),before=f.db.prepare('SELECT date,start,end FROM bookings WHERE id=?').get(id);const c=await proposed(f,id,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE kind=?').get('reschedule_requested:'+c.id)!.n,0);
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,200);assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(c.id)!.state,'pending');assert.equal(f.db.prepare('SELECT base_version FROM booking_changes WHERE id=?').get(c.id)!.base_version,2);assert.deepEqual(f.db.prepare('SELECT date,start,end FROM bookings WHERE id=?').get(id),before);
  const mine=await (await request(f,'/bookings','customer')).json() as {bookings:{reschedule:ChangeResult}[]};assert.equal(mine.bookings[0].reschedule.id,c.id);assert.equal(f.db.prepare('SELECT user_id FROM notifications WHERE kind=?').get('reschedule_requested:'+c.id)!.user_id,'customer');
  assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})).status,200);
 }finally{f.db.close()}
});

test('accepting a proposal rechecks open hours and a safe LINE login return preserves the proposal route',async()=>{
 const f=fixture();try{
  const {id}=await booked(f),c=await proposed(f,id);f.db.prepare('INSERT INTO exceptions VALUES(?,?)').run(c.proposed.date,'[]');
  assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})).status,409);assert.equal(f.db.prepare('SELECT date FROM bookings WHERE id=?').get(id)!.date,payload().date);assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(c.id)!.state,'pending');
  const env={...f.env,LINE_LOGIN_CHANNEL_ID:'test-login',LINE_LOGIN_CHANNEL_SECRET:'test-secret'};const response=await worker.fetch(new Request('https://booking.test/api/auth/line?returnTo='+encodeURIComponent('reschedule/'+c.id)),env,f.ctx);assert.equal(response.status,302);
  const token=response.headers.get('set-cookie')!.split(';')[0].slice('linyan_oauth='.length);assert.equal((await verify<{returnTo:string}>(token,env.AUTH_SECRET))!.returnTo,'reschedule/'+c.id);
 }finally{f.db.close()}
});


test('quarter-hour migration preserves bookings and settings, and API creates valid fifteen-minute starts only',async()=>{
 const f=fixture();try{
  const original=await booked(f),before=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(original.id);
  const saved={...DEFAULT_SETTINGS,bufferMinutes:30,stepMinutes:30,address:'測試店址',leadHours:0,weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[i,[['10:00','18:00']]]))};
  f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(saved));
  f.db.exec(readFileSync(new URL('../migrations/0010_quarter_hour_starts.sql',import.meta.url),'utf8'));
  assert.deepEqual(JSON.parse(String(f.db.prepare('SELECT data FROM settings').get()!.data)),{...saved,stepMinutes:15});
  assert.deepEqual(f.db.prepare('SELECT * FROM bookings WHERE id=?').get(original.id),before);
  const date=offsetDate(payload().date,1),slots=await(await request(f,`/availability?service=single&date=${date}`)).json() as {slots:string[]};
  for(const time of ['10:00','10:15','10:30','10:45'])assert.ok(slots.slots.includes(time));
  assert.equal((await request(f,'/bookings','other','POST',{...payload(),date,time:'10:10'})).status,409);
  assert.equal((await request(f,'/bookings','other','POST',{...payload(),date,time:'10:15'})).status,201);
  const next=await(await request(f,`/availability?service=single&date=${date}`)).json() as {slots:string[]};assert.equal(next.slots[0],'12:15');
 }finally{f.db.close()}
});


test('binding a LINE invitation cannot revive a proposal invalidated by a concurrent owner update',async()=>{
 const f=inviteFixture();try{
  const {id,token}=await manualInvite(f,true),c=await proposed(f,id,1),db=f.env.DB,originalBatch=db.batch.bind(db);let intercepted=false;
  db.batch=async statements=>{
   if(!intercepted){intercepted=true;f.db.prepare('UPDATE bookings SET price=950,version=version+1,updated_at=? WHERE id=?').run(Date.now(),id)}
   return originalBatch(statements);
  };
  assert.equal((await request(f,'/invitations/claim','customer','POST',{token})).status,200);
  assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(c.id)!.state,'obsolete');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE kind=?').get('reschedule_requested:'+c.id)!.n,0);
  const row=f.db.prepare('SELECT user_id,price,version FROM bookings WHERE id=?').get(id)!;assert.equal(row.user_id,'customer');assert.equal(row.price,950);assert.equal(row.version,3);
 }finally{f.db.close()}
});

test('combo root-duration migration preserves saved prices, standalone services and booked snapshots while new reservations use full cleanup',async()=>{
 const f=fixture();try{
  const original=SERVICES.find(service=>service.id==='combo-brows-lashes')!;
  const legacy={...original,description:'一次完成眉眼的美好。服務 4.5 小時；可選擇睫毛款式與根數。',duration:270,specs:original.specs.map((spec,i)=>({label:spec.label,price:i===1?6800:spec.price}))};
  f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
  const booked=await request(f,'/bookings','customer','POST',{...payload(),serviceId:legacy.id});assert.equal(booked.status,201);
  const snapshots=f.db.prepare('SELECT * FROM bookings ORDER BY id').all(),standalone=f.db.prepare("SELECT * FROM services WHERE id<>'combo-brows-lashes' ORDER BY id").all();
  const migration=readFileSync(new URL('../migrations/0011_combo_root_durations.sql',import.meta.url),'utf8');f.db.exec(migration);
  assert.deepEqual(f.db.prepare('SELECT * FROM bookings ORDER BY id').all(),snapshots);assert.deepEqual(f.db.prepare("SELECT * FROM services WHERE id<>'combo-brows-lashes' ORDER BY id").all(),standalone);
  const saved=JSON.parse(String(f.db.prepare('SELECT data FROM services WHERE id=?').get(legacy.id)!.data));assert.equal(saved.duration,240);assert.ok(saved.description.includes('每增加 50 根加 10 分鐘'));assert.deepEqual(saved.specs.map((spec:{price:number})=>spec.price),legacy.specs.map(spec=>spec.price));
  for(const spec of saved.specs as {label:string;duration:number}[]){const roots=Number(spec.label.split('・')[1].replace(' 根',''));assert.equal(spec.duration,240+(roots-100)/50*10)}
  const date=offsetDate(payload().date,1);f.db.prepare('INSERT INTO exceptions VALUES(?,?)').run(date,JSON.stringify([['10:00','14:30']]));
  const availability=async(spec:number)=>await(await request(f,`/availability?service=${legacy.id}&spec=${spec}&date=${date}`)).json() as {duration:number;slots:string[]};
  assert.deepEqual(await availability(0),{slots:['10:00'],duration:240});assert.deepEqual(await availability(1),{slots:[],duration:250});assert.equal((await availability(11)).duration,280);
  const created=await request(f,'/bookings','other','POST',{...payload(),serviceId:legacy.id,date});assert.equal(created.status,201);const row=f.db.prepare('SELECT start,service_end,end FROM bookings WHERE user_id=?').get('other')!;assert.equal(Number(row.service_end)-Number(row.start),240*60000);assert.equal(Number(row.end)-Number(row.service_end),30*60000);
  const unchanged=f.db.prepare('SELECT * FROM services WHERE id=?').get(legacy.id);f.db.exec(migration);assert.deepEqual(f.db.prepare('SELECT * FROM services WHERE id=?').get(legacy.id),unchanged);
  f.db.prepare("UPDATE services SET data=json_set(data,'$.description','店家自訂組合說明') WHERE id=?").run(legacy.id);f.db.exec(migration);assert.equal(JSON.parse(String(f.db.prepare('SELECT data FROM services WHERE id=?').get(legacy.id)!.data)).description,'店家自訂組合說明');
 }finally{f.db.close()}
});

test('future confirmed appointments only allow cancellation or a proposal; completion works on the service date',async()=>{
 const f=fixture();try{
  const {id}=await booked(f),before=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
  for(const status of ['completed','no_show','confirmed']){
   const denied=await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:before.version,status,price:1000,paid:true,paidAmount:1000});assert.equal(denied.status,409);assert.match((await denied.json() as {error:string}).error,/日期尚未到/);
   assert.deepEqual(f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id),before);
  }
  const c=await proposed(f,id);assert.equal(c.state,'pending');
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:before.version,status:'cancelled',price:900,paid:true,paidAmount:900})).status,200);
  const today=taipeiDay(),start=taipeiMs(today,'10:00');f.db.prepare("UPDATE bookings SET date=?,start=?,service_end=?,end=?,status='confirmed',version=version+1 WHERE id=?").run(today,start,start+90*60000,start+120*60000,id);
  const current=f.db.prepare('SELECT version FROM bookings WHERE id=?').get(id)!;
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:current.version,status:'completed',price:900,paid:true,paidAmount:900})).status,200);
 }finally{f.db.close()}
});

test('ten-minute migration preserves service snapshots and proposal history, updates future occupancy and prevents future completion',async()=>{
 const f=fixture();try{
  const {id}=await booked(f),c=await proposed(f,id),before=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
  const historyDate=offsetDate(taipeiDay(),-2),historyStart=taipeiMs(historyDate,'10:00');
  f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,service_end,end,price,status,created_at,updated_at,version) VALUES('history','測試歷史','0900000000','single','日式單根','100 根','{}',?,?,?,?,900,'completed',1,1,1)").run(historyDate,historyStart,historyStart+90*60000,historyStart+120*60000);
  const history=f.db.prepare("SELECT * FROM bookings WHERE id='history'").get();
  f.db.exec(readFileSync(new URL('../migrations/0012_ten_minute_cleanup.sql',import.meta.url),'utf8'));
  const after=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;
  for(const key of ['start','service_end','date','price','paid','paid_amount','status','user_id'])assert.equal(after[key],before[key]);
  assert.equal(after.end,Number(after.service_end)+10*60000);assert.equal(after.version,Number(before.version)+1);
  assert.deepEqual(f.db.prepare("SELECT * FROM bookings WHERE id='history'").get(),history);
  const hold=f.db.prepare('SELECT * FROM booking_changes WHERE id=?').get(c.id)!;assert.equal(hold.state,'pending');assert.equal(hold.base_version,after.version);assert.equal(hold.end,Number(hold.service_end)+10*60000);
  assert.throws(()=>f.db.prepare("UPDATE bookings SET status='completed' WHERE id=?").run(id),/FUTURE_BOOKING/);
  assert.equal((await request(f,'/changes/'+c.id+'/respond','customer','POST',{decision:'accept'})).status,200);
  const moved=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;assert.equal(Number(moved.end)-Number(moved.service_end),10*60000);assert.equal(moved.price,before.price);assert.equal(moved.paid,before.paid);
  assert.equal(f.db.prepare('SELECT state FROM booking_changes WHERE id=?').get(c.id)!.state,'accepted');
 }finally{f.db.close()}
});

test('new bookings and proposals reserve ten-minute cleanup, protect overlaps and accept the new settings minimum',async()=>{
 const f=fixture();try{
  f.db.exec(readFileSync(new URL('../migrations/0012_ten_minute_cleanup.sql',import.meta.url),'utf8'));
  const first=await request(f,'/bookings','customer','POST',payload());assert.equal(first.status,201);const {id}=await first.json() as {id:string};
  const b=f.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)!;assert.equal(Number(b.end)-Number(b.service_end),10*60000);
  assert.equal((await request(f,'/bookings','other','POST',{...payload(),time:'11:30'})).status,409);
  assert.equal((await request(f,'/bookings','other','POST',{...payload(),time:'11:45'})).status,201);
  const c=await proposed(f,id,1,{time:'14:00',duration:100});const hold=f.db.prepare('SELECT end,service_end FROM booking_changes WHERE id=?').get(c.id)!;assert.equal(Number(hold.end)-Number(hold.service_end),10*60000);
  const cfg=JSON.parse(String(f.db.prepare('SELECT data FROM settings WHERE id=1').get()!.data));
  assert.equal((await request(f,'/admin/settings','owner','PUT',{...cfg,bufferMinutes:10})).status,200);
  assert.equal((await request(f,'/admin/settings','owner','PUT',{...cfg,bufferMinutes:9})).status,400);
 }finally{f.db.close()}
});

test('status changes preserve existing payments even when an older page submits edited financial fields',async()=>{
 const f=fixture();try{
  const {id}=await booked(f),date=taipeiDay(),start=taipeiMs(date,'10:00'),paidAt=Date.now()-86400000;
  f.db.prepare('UPDATE bookings SET date=?,start=?,service_end=?,end=?,paid_at=? WHERE id=?').run(date,start,start+90*60000,start+120*60000,paidAt,id);
  const response=await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:2,status:'completed',price:9999,paid:false,paidAmount:0});assert.equal(response.status,200);
  const row=f.db.prepare('SELECT status,price,paid,paid_amount,paid_at FROM bookings WHERE id=?').get(id)!;assert.equal(row.status,'completed');assert.equal(row.price,900);assert.equal(row.paid,1);assert.equal(row.paid_amount,900);assert.equal(row.paid_at,paidAt);
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:3,status:'completed',price:900,paid:true,paidAmount:900})).status,200);assert.equal(f.db.prepare('SELECT paid_at FROM bookings WHERE id=?').get(id)!.paid_at,paidAt);
  assert.equal((await request(f,'/admin/bookings/'+id,'owner','PATCH',{version:4,status:'completed',price:900,paid:false})).status,200);const unpaid=f.db.prepare('SELECT paid,paid_amount,paid_at FROM bookings WHERE id=?').get(id)!;assert.equal(unpaid.paid,0);assert.equal(unpaid.paid_amount,null);assert.equal(unpaid.paid_at,null);
 }finally{f.db.close()}
});
