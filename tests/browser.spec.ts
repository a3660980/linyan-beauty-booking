import {test,expect} from '@playwright/test';
import {taipeiDay,weekday,SERVICES,DEFAULT_SETTINGS,bookingDates,weekDates} from '../src/domain';
const futureDay=()=>{const date=taipeiDay(Date.now()+4*86400000);return weekday(date)===3?taipeiDay(Date.now()+5*86400000):date};
test.beforeEach(async({page})=>{await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"測試環境未連線"}'}))});
test('demo booking keeps selected time through submission and owner approval',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#demo-booking');
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await page.getByLabel('預約日期',{exact:true}).fill(futureDay());
 await page.getByRole('button',{name:'14:00',exact:true}).click();
 await page.getByRole('button',{name:'填寫資料',exact:true}).click();
 await page.getByLabel('姓名 *').fill('示範測試客人');await page.getByLabel('聯絡電話 *').fill('0900000000');
 await page.getByRole('checkbox').last().check();await page.getByRole('button',{name:'送出預約申請',exact:true}).click();
 await expect(page.getByRole('heading',{name:'示範申請已完成'})).toBeVisible();
 await expect(page.locator('.summary-box')).toContainText('14:00');
 await page.evaluate(()=>location.hash='demo-admin');
 await page.getByRole('button',{name:'審核預約',exact:true}).first().click();
 await page.getByRole('button',{name:'確認預約',exact:true}).click();
 await page.getByRole('button',{name:'已確認',exact:true}).click();
 await expect(page.locator('.admin-bookings')).toContainText('預約成功');
 expect(errors).toEqual([]);
});
test('mobile pages have no horizontal overflow and the menu works',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const route of ['home','services','demo-booking','demo-admin']){
  await page.goto('/#'+route);await expect(page.locator('main')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBe(true);
 }
 await page.goto('/#home');await page.getByRole('button',{name:'開啟選單'}).click();
 await expect(page.locator('nav.open')).toBeVisible();
});
test('unknown production service time blocks advancing to booking slots',async({page})=>{
 await page.route('**/api/me',r=>r.fulfill({status:200,contentType:'application/json',body:'{"user":null}'}));
 await page.route('**/api/public',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({services:SERVICES.map(s=>({...s,duration:null})),settings:DEFAULT_SETTINGS,lineReady:false,lineUrl:''})}));
 await page.goto('/#booking');await expect(page.locator('.setup-banner')).toContainText('線上預約設定中');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('尚未設定此服務時間');
 await expect(page.getByRole('heading',{name:'想為自己預約什麼？'})).toBeVisible();
});

test('mobile calendar split schedules update customer slots and can be closed or restored',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 const date=futureDay();
 await page.goto('/#demo-admin');await page.getByRole('button',{name:'服務與排班',exact:true}).click();
 const remove=page.getByRole('button',{name:'刪除營業區段',exact:true});while(await remove.count())await remove.first().click();
 await page.getByRole('button',{name:'儲存服務與固定排班'}).click();
 await page.getByRole('button',{name:'行事曆',exact:true}).click();
 await page.getByLabel('行事曆日期').fill(date);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const cell=page.locator(`[data-date="${date}"]`);
 await cell.getByRole('button',{name:`設定 ${date} 的可預約時間`}).click();
 const dialog=page.getByRole('dialog',{name:'當日可預約時間'});
 await dialog.getByRole('checkbox',{name:'全天休息'}).uncheck();
 await dialog.getByLabel('區段 1 開始時間').fill('10:00');await dialog.getByLabel('區段 1 結束時間').fill('12:00');
 await dialog.getByRole('button',{name:'新增時間區段'}).click();
 await dialog.getByLabel('區段 2 開始時間').fill('15:00');await dialog.getByLabel('區段 2 結束時間').fill('18:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await dialog.getByRole('button',{name:'儲存當日排班'}).click();await expect(dialog).toHaveCount(0);
 await expect(cell).toContainText('10:00–12:00');await expect(cell).toContainText('15:00–18:00');
 const customerSlots=async()=>{await page.evaluate(()=>location.hash='demo-booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();await page.getByLabel('預約日期',{exact:true}).fill(date)};
 const edit=async()=>{await page.evaluate(()=>location.hash='demo-admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();await page.getByLabel('行事曆日期').fill(date);await page.getByRole('button',{name:`設定 ${date} 的可預約時間`}).click()};
 await customerSlots();await expect(page.locator('.time-grid button')).toHaveText(['15:00','15:30']);
 await edit();await dialog.getByRole('checkbox',{name:'全天休息'}).check();await dialog.getByRole('button',{name:'儲存當日排班'}).click();
 await expect(cell).toContainText('全天休息');await customerSlots();await expect(page.getByRole('heading',{name:'目前沒有可預約日期'})).toBeVisible();
 await edit();await dialog.getByRole('button',{name:'恢復固定排班'}).click();await expect(cell).toContainText('未開放');
 await customerSlots();await expect(page.getByRole('heading',{name:'目前沒有可預約日期'})).toBeVisible();
 expect(errors).toEqual([]);
});
test('calendar rejects overlaps, warns about affected bookings and navigates calendar months',async({page})=>{
 await page.goto('/#demo-admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();
 const date=taipeiDay(Date.now()+86400000);await page.getByRole('button',{name:'新增可預約時間'}).click();
 const dialog=page.getByRole('dialog',{name:'當日可預約時間'});
 await dialog.getByRole('checkbox',{name:'全天休息'}).uncheck();
 await dialog.getByLabel('區段 1 結束時間').fill('12:00');await expect(dialog).toContainText('示範客人');
 await dialog.getByRole('button',{name:'新增時間區段'}).click();await dialog.getByLabel('區段 2 開始時間').fill('11:00');
 await dialog.getByRole('button',{name:'儲存當日排班'}).click();await expect(dialog.getByRole('alert')).toContainText('不能重疊');
 await expect(page.locator(`[data-date="${date}"]`)).not.toContainText('指定排班');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByLabel('行事曆日期').fill('2026-01-31');await page.getByRole('button',{name:'下一段日期'}).click();await expect(page.getByLabel('行事曆日期')).toHaveValue('2026-02-01');
 await page.getByRole('button',{name:'前一段日期'}).click();await expect(page.getByLabel('行事曆日期')).toHaveValue('2026-01-01');
});

test('booking opens on the nearest date, follows week navigation and preserves a chosen date when returning',async({page})=>{
 const now=Date.parse('2026-10-20T04:00:00Z');await page.clock.setFixedTime(now);
 const dates=bookingDates(30,now);
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 await page.route('**/api/availability/dates?*',r=>{
  const lower=new URL(r.request().url()).searchParams.get('lower')==='true';
  const first=lower?'2026-11-04':'2026-10-30';
  r.fulfill({json:{days:dates.map(date=>({date,slots:(lower?[first,'2026-11-06']:[first,'2026-11-02','2026-11-06']).includes(date)?['10:00','11:00']:[]})),firstAvailableDate:first,duration:lower?150:120}});
 });
 await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 const selected=page.getByLabel('預約日期',{exact:true});
 const expectWeek=async(date:string)=>{expect(await page.locator('.date-strip button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-date')))).toEqual(weekDates(date));await expect(page.locator(`.date-strip [data-date="${date}"]`)).toHaveAttribute('aria-pressed','true')};
 await expect(selected).toHaveValue('2026-10-30');await expectWeek('2026-10-30');
 await page.getByRole('button',{name:'下一週',exact:true}).click();await expect(selected).toHaveValue('2026-11-06');await expectWeek('2026-11-06');
 await page.getByRole('button',{name:'上一週',exact:true}).click();await expect(selected).toHaveValue('2026-10-30');
 await selected.fill('2026-11-02');await expectWeek('2026-11-02');
 await page.getByRole('button',{name:'11:00',exact:true}).click();await page.getByRole('button',{name:'填寫資料',exact:true}).click();
 await page.getByRole('button',{name:'上一步',exact:true}).click();await expect(selected).toHaveValue('2026-11-02');await expect(page.getByRole('button',{name:'11:00',exact:true})).toHaveClass('selected');
 await page.getByRole('button',{name:'最近可預約日'}).click();await expect(selected).toHaveValue('2026-10-30');await expectWeek('2026-10-30');
 await selected.fill(dates.at(-1)!);await expect(page.getByRole('button',{name:'下一週',exact:true})).toBeDisabled();
 await selected.fill(dates[0]);await expect(page.getByRole('button',{name:'上一週',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'上一步',exact:true}).click();await page.getByRole('checkbox',{name:/下睫毛/}).check();
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();await expect(selected).toHaveValue('2026-11-04');await expectWeek('2026-11-04');
});

test('a fully closed booking horizon shows no dates instead of selecting an unavailable day',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 await page.route('**/api/availability/dates?*',r=>r.fulfill({json:{days:bookingDates(30).map(date=>({date,slots:[]})),firstAvailableDate:null,duration:120}}));
 await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await expect(page.getByRole('heading',{name:'目前沒有可預約日期'})).toBeVisible();
 await expect(page.getByRole('button',{name:'最近可預約日'})).toBeDisabled();
 await page.getByRole('button',{name:'填寫資料',exact:true}).click();await expect(page.getByRole('alert')).toContainText('請選擇可預約時段');
});

test('refreshing an authenticated admin shows only loading until the session is confirmed',async({page})=>{
 await page.addInitScript(()=>{
  const state=window as unknown as {loginFlashes:number};state.loginFlashes=0;
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&(node.matches('a[href^="/api/auth/line"]')||node.querySelector('a[href^="/api/auth/line"]')))state.loginFlashes++}).observe(document,{subtree:true,childList:true});
 });
 let release:()=>void=()=>{};let pending=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',async r=>{await pending;await r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}})});
 await page.route('**/api/admin',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,bookings:[],exceptions:[],notifications:[],ready:{login:true,notifications:true,webhook:true,session:true}}}));
 await page.goto('/#admin');await expect(page.getByRole('status',{name:'確認登入狀態'})).toBeVisible();
 await expect(page.getByRole('link',{name:'LINE 店家登入'})).toHaveCount(0);
 release();await expect(page.locator('.admin-layout')).toBeVisible();
 pending=new Promise<void>(resolve=>{release=resolve});
 await page.reload();await expect(page.getByRole('status',{name:'確認登入狀態'})).toBeVisible();
 await expect(page.getByRole('link',{name:'LINE 店家登入'})).toHaveCount(0);
 release();await expect(page.locator('.admin-layout')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {loginFlashes:number}).loginFlashes)).toBe(0);
});

test('session errors allow retry without treating a signed-in customer as logged out',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('bookingDraft',JSON.stringify({serviceId:'single',spec:0,addons:{lower:false,removal:'none'},date:'2026-11-02',time:'11:00'})));
 await page.route('**/api/public',r=>r.fulfill({status:503,json:{error:'資料暫時無法查詢'}}));
 let ready=false;
 await page.route('**/api/me',r=>r.fulfill(ready?{json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}:{status:503,json:{error:'連線中斷'}}));
 await page.goto('/#booking');await expect(page.getByRole('heading',{name:'連線暫時中斷'})).toBeVisible();
 await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toHaveCount(0);
 ready=true;await page.getByRole('button',{name:'重新載入',exact:true}).click();
 await expect(page.getByLabel('姓名 *')).toHaveValue('測試客人');
 await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toHaveCount(0);
 await expect(page.locator('.booking-summary')).toContainText('2026-11-02 11:00');
});

test('mobile schedule controls stay inside the dialog and start/end fields do not overlap',async({page},testInfo)=>{
 await page.goto('/#demo-admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();
 await page.getByRole('button',{name:'新增可預約時間'}).click();
 const dialog=page.getByRole('dialog',{name:'當日可預約時間'});
 await dialog.getByRole('checkbox',{name:'全天休息'}).uncheck();await dialog.getByRole('button',{name:'新增時間區段'}).click();
 for(const width of [320,375,390,430]){
  await page.setViewportSize({width,height:844});
  expect(await dialog.evaluate(el=>{
   const bounds=el.getBoundingClientRect();
   return [...el.querySelectorAll('input[type=date],input[type=time],.schedule-window-heading button')].every(input=>{const rect=input.getBoundingClientRect();return rect.left>=bounds.left+10&&rect.right<=bounds.right-10&&rect.height>=44})&&el.scrollWidth<=el.clientWidth;
  }),`schedule controls at ${width}px`).toBe(true);
  const start=await dialog.getByLabel('區段 1 開始時間').boundingBox(),end=await dialog.getByLabel('區段 1 結束時間').boundingBox();
  expect(start!.y+start!.height).toBeLessThan(end!.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});await dialog.screenshot({path:testInfo.outputPath('schedule-mobile.png')});
});

test('studio notices and combinable offers are readable on mobile',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/#policies');
 await expect(page.locator('.policy-content')).toContainText('NT$500 訂金');
 await expect(page.locator('.policy-content')).toContainText('預約保留 15 分鐘');
 await expect(page.locator('.policy-content')).toContainText('現金或當下匯款');
 await page.getByRole('button',{name:'美睫須知',exact:true}).click();
 await expect(page.locator('.care-section').first()).toContainText('費用為 NT$100');
 await expect(page.locator('.care-section').last()).toContainText('完成後 1 小時內避免碰水');
 await expect(page.locator('.care-section').last()).toContainText('2 週內回補');
 await page.getByRole('button',{name:'霧眉須知',exact:true}).click();
 await expect(page.locator('.care-section').first().locator('li')).toHaveCount(6);
 await expect(page.locator('.care-section').last().locator('li')).toHaveCount(11);
 await expect(page.locator('.care-section').last()).toContainText('施作後 3 小時可正常洗臉碰水');
 await page.goto('/#offers');
 await expect(page.locator('.offer-cards')).toContainText('保留滿 24 小時');
 await expect(page.locator('.offer-cards')).toContainText('已有 2 次消費以上');
 await expect(page.locator('.offers-combine')).toContainText('可與兩人同行等其他優惠併用');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('offers-mobile.png'),fullPage:true});
});

const bookingFixture={id:'test-booking',user_id:'customer',customer:'測試客人',phone:'0900000000',note:'',service_id:'single',service_name:'日式單根',spec:'100 根',date:'2026-11-02',start:Date.parse('2026-11-02T10:00:00+08:00'),end:Date.parse('2026-11-02T12:30:00+08:00'),price:900,status:'pending',version:1,paid:0,paid_amount:null};
const adminFixture={services:SERVICES,settings:DEFAULT_SETTINGS,bookings:[bookingFixture],exceptions:[],notifications:[],ready:{login:true,notifications:true,webhook:true,session:true}};

test('my bookings wait before showing empty, preserve rows during refresh and recover from failed queries',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}));
 let release:()=>void=()=>{},gate=new Promise<void>(resolve=>{release=resolve}),call=0;
 await page.route('**/api/bookings',async r=>{const current=++call;await gate;await r.fulfill(current===2?{status:503,json:{error:'暫時無法查詢預約'}}:{json:{bookings:current===1?[bookingFixture]:[]}})});
 await page.goto('/#home');await page.getByRole('button',{name:'開啟選單'}).click();await page.locator('.nav a[href="#my"]').click();
 await expect(page.getByRole('status',{name:'載入預約紀錄中…'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'還沒有預約紀錄'})).toHaveCount(0);
 release();await expect(page.locator('.reservation')).toContainText('test-booking');
 gate=new Promise<void>(resolve=>{release=resolve});
 await page.getByRole('button',{name:'重新整理',exact:true}).click();
 await expect(page.getByRole('status',{name:'更新預約紀錄中…'})).toBeVisible();
 await expect(page.locator('.reservation')).toContainText('test-booking');
 await expect(page.getByRole('button',{name:'取消預約',exact:true})).toBeDisabled();
 release();await expect(page.getByRole('alert')).toContainText('暫時無法查詢預約');
 await expect(page.locator('.reservation')).toHaveCount(1);
 gate=new Promise<void>(resolve=>{release=resolve});
 await page.getByRole('button',{name:'重新查詢',exact:true}).click();
 await expect(page.getByRole('status',{name:'更新預約紀錄中…'})).toBeVisible();
 release();await expect(page.getByRole('heading',{name:'還沒有預約紀錄'})).toBeVisible();
 await expect(page.locator('.reservation')).toHaveCount(0);
});

test('admin tabs wait for their shared data and LINE quota has its own loading and retry',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 let release:()=>void=()=>{},gate=new Promise<void>(resolve=>{release=resolve}),calls=0;
 await page.route('**/api/admin',async r=>{const call=++calls;await gate;await r.fulfill({json:{...adminFixture,bookings:call===1?[bookingFixture]:[]}})});
 let quotaRelease:()=>void=()=>{},quotaGate=new Promise<void>(resolve=>{quotaRelease=resolve}),quotaCalls=0;
 await page.route('**/api/admin/quota',async r=>{const call=++quotaCalls;await quotaGate;await r.fulfill(call===1?{status:503,json:{error:'額度查詢暫時中斷'}}:{json:{available:true,used:2,remaining:198,limit:200}})});
 await page.goto('/#admin');
 for(const tab of ['預約管理','行事曆','客人紀錄','收款管理','服務與排班','LINE 通知']){
  await page.getByRole('button',{name:tab,exact:true}).click();
  await expect(page.getByRole('status',{name:'載入後台資料中…'})).toBeVisible();
  await expect(page.locator('.stat-grid,.calendar-panel,.admin-bookings,.client-record,.cash-row')).toHaveCount(0);
 }
 release();await expect(page.locator('.stat-grid')).toContainText('1');
 await expect(page.getByRole('status',{name:'查詢 LINE 額度中…'})).toBeVisible();
 await expect(page.getByText('LINE 推播金鑰尚未設定。示範操作不發送訊息。',{exact:true})).toHaveCount(0);
 quotaRelease();await expect(page.getByRole('alert')).toContainText('額度查詢暫時中斷');
 quotaGate=new Promise<void>(resolve=>{quotaRelease=resolve});
 await page.getByRole('button',{name:'重新查詢',exact:true}).click();await expect(page.getByRole('status',{name:'查詢 LINE 額度中…'})).toBeVisible();
 quotaRelease();await expect(page.locator('.notice-box')).toContainText('本月已使用 2 則・剩餘 198 則');
 await page.getByRole('button',{name:'預約管理',exact:true}).click();
 gate=new Promise<void>(resolve=>{release=resolve});await page.getByRole('button',{name:'重新整理',exact:true}).click();
 await expect(page.getByRole('status',{name:'更新後台資料中…'})).toBeVisible();
 await expect(page.locator('.admin-booking')).toContainText('測試客人');
 await expect(page.locator('.admin-data')).toHaveAttribute('inert','');
 release();await expect(page.getByRole('heading',{name:'目前沒有這類預約'})).toBeVisible();
});

test('only signed-in admins see management links and home service cards contain generated images',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 let role='guest';
 await page.route('**/api/me',r=>r.fulfill({json:{user:role==='guest'?null:{id:role,name:'測試使用者',friend:true,admin:role==='owner'}}}));
 for(const mode of ['guest','customer','owner']){
  role=mode;await page.goto('/?role='+mode+'#home');await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('a[href="#admin"]')).toHaveCount(mode==='owner'?2:0);
  await expect(page.locator('a[href="#demo-admin"]')).toHaveCount(0);
  await page.getByRole('button',{name:'開啟選單'}).click();
  if(mode==='owner')await expect(page.locator('.nav a[href="#admin"]')).toBeVisible();
  await page.getByRole('button',{name:'開啟選單'}).click();
 }
 const images=page.locator('.service-photo img');await expect(images).toHaveCount(4);
 await page.locator('.service-grid').scrollIntoViewIfNeeded();
 for(const img of await images.all()){await img.scrollIntoViewIfNeeded();await expect(img).toHaveJSProperty('naturalWidth',1448);await img.evaluate(el=>(el as HTMLImageElement).decode())}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.service-grid').screenshot({path:testInfo.outputPath('service-images-mobile.png')});
 role='guest';await page.goto('/#admin');await expect(page.getByRole('link',{name:'LINE 店家登入'})).toBeVisible();
 await expect(page.getByRole('link',{name:'體驗示範後台'})).toHaveCount(0);
});

test('expired LINE callbacks show a login prompt inside the website and preserve the booking draft',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('bookingDraft',JSON.stringify({serviceId:'single',spec:0,addons:{lower:false,removal:'none'},date:'2026-11-02',time:'11:00'})));
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 await page.goto('/?authError=expired#booking');
 await expect(page.locator('.site-header')).toBeVisible();
 await expect(page.locator('.auth-notice')).toContainText('登入驗證已失效，請重新登入');
 await expect(page.getByRole('link',{name:'重新登入 LINE'})).toHaveAttribute('href','/api/auth/line?returnTo=booking');
 await expect(page.locator('.booking-summary')).toContainText('2026-11-02 11:00');
 expect(new URL(page.url()).searchParams.has('authError')).toBe(false);
 await page.getByRole('button',{name:'關閉登入提示'}).click();await expect(page.locator('.auth-notice')).toHaveCount(0);
 await page.goto('/?authError=expired#admin');
 await expect(page.getByRole('link',{name:'重新登入 LINE'})).toHaveAttribute('href','/api/auth/line?returnTo=admin');
});

test('availability requests show loading and retry instead of flashing a closed day',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 let release:()=>void=()=>{},gate=new Promise<void>(resolve=>{release=resolve}),calls=0;
 await page.route('**/api/availability/dates?*',async r=>{const call=++calls;await gate;const date=bookingDates(30)[2];await r.fulfill(call===1?{status:503,json:{error:'時段查詢暫時失敗'}}:{json:{days:bookingDates(30).map(d=>({date:d,slots:d===date?['10:00']:[]})),firstAvailableDate:date,duration:120}})});
 await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await expect(page.getByText('查詢時段中…',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'目前沒有可預約日期'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'填寫資料',exact:true})).toBeDisabled();
 release();await expect(page.getByRole('alert')).toContainText('時段查詢暫時失敗');
 gate=new Promise<void>(resolve=>{release=resolve});await page.getByRole('button',{name:'重新查詢',exact:true}).click();
 await expect(page.getByText('查詢時段中…',{exact:true})).toBeVisible();
 release();await expect(page.getByRole('button',{name:'10:00',exact:true})).toBeVisible();
});

test('an expired session during a query returns to the in-page login prompt',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}));
 let expired=false;
 await page.route('**/api/bookings',r=>r.fulfill(expired?{status:401,json:{error:'請先使用 LINE 登入'}}:{json:{bookings:[bookingFixture]}}));
 await page.goto('/#my');await expect(page.locator('.reservation')).toHaveCount(1);
 expired=true;await page.getByRole('button',{name:'重新整理',exact:true}).click();
 await expect(page.locator('.auth-notice')).toContainText('登入驗證已失效');
 await expect(page.getByRole('heading',{name:'登入後查看你的預約'})).toBeVisible();
 await expect(page.getByRole('link',{name:'重新登入 LINE'})).toHaveAttribute('href','/api/auth/line?returnTo=my');
 await expect(page.locator('.reservation')).toHaveCount(0);
});
