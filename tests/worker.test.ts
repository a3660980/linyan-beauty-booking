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
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_group_limit.sql',import.meta.url),'utf8'));const adapter={prepare:(sql:string)=>new Statement(db,sql),batch:async(statements:Statement[])=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};const env={DB:adapter as unknown as D1Database,AUTH_SECRET:'x'.repeat(40),ADMIN_LINE_USER_IDS:'owner',APP_ORIGIN:'https://booking.test',ASSETS:{fetch:()=>new Response('static')} as unknown as Fetcher} satisfies Env;db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({...DEFAULT_SETTINGS,leadHours:0,weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[i,[['10:00','18:00']]]))}));for(const s of SERVICES)db.prepare('INSERT INTO services VALUES(?,?)').run(s.id,JSON.stringify({...s,duration:90}));for(const id of ['customer','other','owner'])db.prepare('INSERT INTO users VALUES(?,?,1,?)').run(id,'測試使用者',Date.now());const ctx={waitUntil:(_p:Promise<unknown>)=>{}} as ExecutionContext;return {db,env,ctx};}
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

test('the cookie-free calendar tracks confirmed and completed bookings with stable identity, buffer and limited personal data',async()=>{
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
  await update(2,'completed');const completed=await (await feedRequest(f,data.httpsUrl)).text();
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
test('customers cannot read or cancel another user booking; approval is not payment',async()=>{const f=fixture();const created=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};const rows=await (await request(f,'/bookings','other')).json() as {bookings:unknown[]};assert.equal(rows.bookings.length,0);assert.equal((await request(f,`/bookings/${created.id}/cancel`,'other','POST',{})).status,404);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,200);const b=f.db.prepare('SELECT * FROM bookings').get();assert.equal(b?.status,'confirmed');assert.equal(b?.paid,0);assert.equal(f.db.prepare('SELECT state FROM notifications').get()?.state,'queued');assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:true,paidAmount:900})).status,409);assert.equal((await request(f,`/admin/bookings/${created.id}`,'owner','PATCH',{version:2,status:'confirmed',price:900,paid:true,paidAmount:900})).status,200);f.db.close();});
test('expired requests release slots and cannot be approved',async()=>{const f=fixture();const c=await (await request(f,'/bookings','customer','POST',payload())).json() as {id:string};f.db.prepare('UPDATE bookings SET expires_at=1 WHERE id=?').run(c.id);assert.equal((await request(f,`/admin/bookings/${c.id}`,'owner','PATCH',{version:1,status:'confirmed',price:900,paid:false})).status,409);const available=await (await request(f,`/availability?service=single&date=${payload().date}`)).json() as {slots:string[]};assert.ok(available.slots.includes('10:00'));assert.equal(f.db.prepare('SELECT status FROM bookings').get()?.status,'expired');f.db.close();});
test('unset durations, unverified friendships and invalid settings block writes',async()=>{const f=fixture();f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],duration:null}),'single');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,409);f.db.prepare('UPDATE users SET friend=0 WHERE id=?').run('customer');assert.equal((await request(f,'/bookings','customer','POST',payload())).status,403);assert.equal((await request(f,'/admin/settings','owner','PUT',{...DEFAULT_SETTINGS,stepMinutes:0})).status,400);f.db.close();});
test('webhook body signatures are validated',async()=>{const secret='test webhook signing value';const raw='{"events":[]}';const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw)));const sig=btoa(String.fromCharCode(...bytes));assert.equal(await validLineSignature(raw,sig,secret),true);assert.equal(await validLineSignature(raw+' ',sig,secret),false);const f=fixture();assert.equal((await request(f,'/line/webhook',null,'POST',{events:[]})).status,401);f.db.close();});

test('nearest available dates respect full duration, occupied slots, expiry and booking horizon without exposing customers',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-07T00:00:00+08:00'));
 const f=fixture(),first=taipeiDay(),blocked=offsetDate(first,2),open=offsetDate(first,10);
 try{
  f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...DEFAULT_SETTINGS,leadHours:0,bookingDays:12}));
  f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify(SERVICES[0]),'single');
  for(const [date,windows] of [[offsetDate(first,1),[['10:00','12:00']]],[blocked,[['10:00','12:30']]],[open,[['10:00','13:00']]],[offsetDate(first,12),[['10:00','18:00']]]] as const){
   f.db.prepare('INSERT INTO exceptions VALUES(?,?)').run(date,JSON.stringify(windows));
  }
  f.db.prepare("INSERT INTO bookings(id,customer,phone,service_id,service_name,spec,addons,date,start,end,price,status,created_at,updated_at) VALUES('occupied','秘密客人','0900000000','single','日式單根','100 根','{}',?,?,?,900,'confirmed',1,1)").run(blocked,taipeiMs(blocked,'10:00'),taipeiMs(blocked,'12:30'));
  const get=async(query='')=>await (await request(f,'/availability/dates?service=single'+query)).json() as AvailabilityDates;
  const result=await get();
  assert.equal(result.days.length,12);assert.equal(result.firstAvailableDate,open);
  assert.deepEqual(result.days.find(d=>d.date===offsetDate(first,1))?.slots,[]);
  assert.deepEqual(result.days.find(d=>d.date===blocked)?.slots,[]);
  assert.deepEqual(result.days.find(d=>d.date===open)?.slots,['10:00','10:30']);
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
  f.db.prepare('UPDATE services SET data=? WHERE id=?').run(JSON.stringify({...SERVICES[0],duration:null}),'single');
  const unset=await get();assert.equal(unset.firstAvailableDate,null);assert.deepEqual(unset.days,[]);assert.ok(unset.reason);
 }finally{f.db.close();}
});

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

test('new studio policy migration updates the old default and preserves owner-written notices',()=>{
 const f=fixture(),sql=readFileSync(new URL('../migrations/0004_studio_booking_policy.sql',import.meta.url),'utf8');
 const settings=JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string);
 const previous='預約須經店家確認後才正式成立。到店以現金付款。取消、改期與遲到規則請於預約前向店家確認。';
 f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...settings,policies:previous}));
 f.db.exec(sql);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT data FROM settings WHERE id=1').get()?.data as string),settings);
 f.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify({...settings,policies:'店家自行填寫的規則'}));
 f.db.exec(sql);
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
