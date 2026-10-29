import {test,expect,type Page} from '@playwright/test';
import {taipeiDay,weekday,SERVICES,DEFAULT_SETTINGS,bookingDates,weekDates} from '../src/domain';
const futureDay=()=>{const date=taipeiDay(Date.now()+4*86400000);return weekday(date)===3?taipeiDay(Date.now()+5*86400000):date};
async function chooseBookingDate(page:Page,date:string){
 await page.getByRole('button',{name:'預約日期',exact:true}).click();
 const calendar=page.getByRole('dialog',{name:'選擇預約日期',exact:true});
 for(let i=0;i<12;i++){const month=await calendar.getAttribute('data-month');if(month===date.slice(0,7))break;await calendar.getByRole('button',{name:month!<date.slice(0,7)?'下個月':'上個月',exact:true}).click()}
 await calendar.locator(`[data-date="${date}"]`).click();
}
async function inspectBookingDate(page:Page,date:string){
 for(let i=0;i<12;i++){const days=await page.locator('.date-strip button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-date')!));if(days.includes(date))break;await page.getByRole('button',{name:date<days[0]?'上一週':'下一週',exact:true}).click()}
 await page.locator(`.date-strip [data-date="${date}"]`).click();
}
test.beforeEach(async({page})=>{await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"測試環境未連線"}'}))});
test('demo booking keeps selected time through submission and owner approval',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#demo-booking');
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await chooseBookingDate(page,futureDay());
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
 await page.route('**/api/public',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({services:SERVICES.map(s=>({...s,duration:null,specs:s.specs.map(spec=>({...spec,duration:null}))})),settings:DEFAULT_SETTINGS,lineReady:false,lineUrl:''})}));
 await page.goto('/#booking');await expect(page.locator('.setup-banner')).toContainText('線上預約設定中');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('尚未設定此服務時間');
 await expect(page.getByRole('heading',{name:'想為自己預約什麼？'})).toBeVisible();
});

test('mobile calendar split schedules update customer slots and can be closed or restored',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 const date=futureDay();
 await page.goto('/#demo-admin');await page.getByRole('button',{name:'服務與排班',exact:true}).click();await page.getByRole('tab',{name:/每週固定排班/}).click();
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
 const customerSlots=async()=>{await page.evaluate(()=>location.hash='demo-booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();await inspectBookingDate(page,date)};
 const edit=async()=>{await page.evaluate(()=>location.hash='demo-admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();await page.getByLabel('行事曆日期').fill(date);await page.getByRole('button',{name:`設定 ${date} 的可預約時間`}).click()};
 await customerSlots();await expect(page.locator('.time-grid button')).toHaveText(['10:00','10:15','10:30','15:00','15:15','15:30','15:45','16:00','16:15','16:30']);
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
 const selected=page.getByRole('button',{name:'預約日期',exact:true});
 const expectWeek=async(date:string)=>{expect(await page.locator('.date-strip button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-date')))).toEqual(weekDates(date));await expect(page.locator(`.date-strip [data-date="${date}"]`)).toHaveAttribute('aria-pressed','true')};
 await expect(selected).toHaveAttribute('data-date','2026-10-30');await expectWeek('2026-10-30');
 await page.getByRole('button',{name:'下一週',exact:true}).click();await expect(selected).toHaveAttribute('data-date','2026-11-06');await expectWeek('2026-11-06');
 await page.getByRole('button',{name:'上一週',exact:true}).click();await expect(selected).toHaveAttribute('data-date','2026-10-30');
 await chooseBookingDate(page,'2026-11-02');await expectWeek('2026-11-02');
 await page.getByRole('button',{name:'11:00',exact:true}).click();await page.getByRole('button',{name:'填寫資料',exact:true}).click();
 await page.getByRole('button',{name:'上一步',exact:true}).click();await expect(selected).toHaveAttribute('data-date','2026-11-02');await expect(page.getByRole('button',{name:'11:00',exact:true})).toHaveClass('selected');
 await page.getByRole('button',{name:'最近可預約日'}).click();await expect(selected).toHaveAttribute('data-date','2026-10-30');await expectWeek('2026-10-30');
 await inspectBookingDate(page,dates.at(-1)!);await expect(page.getByRole('button',{name:'下一週',exact:true})).toBeDisabled();
 await inspectBookingDate(page,dates[0]);await expect(page.getByRole('button',{name:'上一週',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'上一步',exact:true}).click();await page.getByRole('checkbox',{name:/下睫毛/}).check();
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();await expect(selected).toHaveAttribute('data-date','2026-11-04');await expectWeek('2026-11-04');
 await selected.click();const month=page.getByRole('dialog',{name:'選擇預約日期',exact:true});await expect(month.locator('[data-date="2026-11-02"]')).toBeDisabled();await expect(month.locator('[data-date="2026-11-04"]')).toBeEnabled();
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

const bookingFixture={id:'test-booking',user_id:'customer',customer:'測試客人',phone:'0900000000',note:'',service_id:'single',service_name:'日式單根',spec:'100 根',date:'2026-11-02',start:Date.parse('2026-11-02T10:00:00+08:00'),end:Date.parse('2026-11-02T12:30:00+08:00'),service_end:Date.parse('2026-11-02T12:00:00+08:00'),price:900,status:'pending',version:1,paid:0,paid_amount:null};
const adminFixture={services:SERVICES,settings:DEFAULT_SETTINGS,bookings:[bookingFixture],exceptions:[],notifications:[],ready:{login:true,notifications:true,webhook:true,session:true}};

test('calendar subscription waits for data, retries and manages a private link without flashing a disabled state',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/admin',r=>r.fulfill({json:adminFixture}));
 let release:()=>void=()=>{},gate=new Promise<void>(resolve=>{release=resolve}),reads=0,writes=0,enabled=false;
 const subscription=()=>({enabled:true,httpsUrl:`https://booking.test/api/calendar/fixture-${writes}.test-signature.ics`,webcalUrl:`webcal://booking.test/api/calendar/fixture-${writes}.test-signature.ics`,createdAt:1});
 await page.route('**/api/admin/calendar-subscription',async r=>{
  const method=r.request().method();await gate;
  if(method==='GET'&&[1,3].includes(++reads)){await r.fulfill({status:503,json:{error:'訂閱查詢暫時失敗'}});return}
  if(method!=='GET'){writes++;enabled=method!=='DELETE'}
  await r.fulfill({json:enabled?subscription():{enabled:false}});
 });
 await page.goto('/#admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();
 const sync=page.locator('.calendar-sync');await sync.getByRole('button',{name:'同步到 iPhone',exact:true}).click();
 await expect(sync.getByRole('status',{name:'載入行事曆訂閱中…'})).toBeVisible();
 await expect(sync.getByText('尚未開啟你的行事曆訂閱。',{exact:true})).toHaveCount(0);
 release();await expect(sync.getByRole('alert')).toContainText('訂閱查詢暫時失敗');
 gate=new Promise<void>(resolve=>{release=resolve});await sync.getByRole('button',{name:'重新查詢',exact:true}).click();
 await expect(sync.getByRole('status',{name:'載入行事曆訂閱中…'})).toBeVisible();release();
 await expect(sync.getByRole('button',{name:'開啟訂閱',exact:true})).toBeVisible();
 gate=new Promise<void>(resolve=>{release=resolve});await sync.getByRole('button',{name:'開啟訂閱',exact:true}).click();
 await expect(sync.getByRole('status',{name:'儲存行事曆訂閱中…'})).toBeVisible();await expect(sync.locator('.calendar-sync-options')).toHaveAttribute('inert','');
  await expect(sync.getByRole('button',{name:'收起設定',exact:true})).toBeDisabled();
  release();await expect(sync.getByRole('status')).toContainText('訂閱已開啟');await expect(sync.getByRole('link',{name:'加入 iPhone 行事曆'})).toHaveAttribute('href',subscription().webcalUrl);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('clipboard unavailable')}},configurable:true}));
 await sync.getByRole('button',{name:'複製訂閱網址'}).click();await expect(sync.getByLabel('私人訂閱網址')).toHaveValue(subscription().httpsUrl);
 await expect(sync.getByRole('status')).toContainText('請長按下方網址');
 page.on('dialog',dialog=>dialog.accept());
 await sync.getByRole('button',{name:'重新產生連結'}).click();await expect(sync.getByRole('status')).toContainText('已產生新連結');
 await expect(sync.getByRole('link',{name:'加入 iPhone 行事曆'})).toHaveAttribute('href',subscription().webcalUrl);
 await expect(sync.getByLabel('私人訂閱網址')).toHaveCount(0);
  await sync.getByRole('button',{name:'收起設定',exact:true}).click();await sync.getByRole('button',{name:'同步到 iPhone',exact:true}).click();
  await expect(sync.getByRole('alert')).toContainText('訂閱查詢暫時失敗');await expect(sync.locator('.calendar-sync-options')).toHaveAttribute('inert','');
  await expect(sync.getByText('尚未開啟你的行事曆訂閱。',{exact:true})).toHaveCount(0);
  await sync.getByRole('button',{name:'重新查詢',exact:true}).click();await expect(sync.getByRole('alert')).toHaveCount(0);
  await expect(sync.getByRole('link',{name:'加入 iPhone 行事曆'})).toHaveAttribute('href',subscription().webcalUrl);
 await sync.getByRole('button',{name:'停用訂閱',exact:true}).click();await expect(sync.getByRole('status')).toContainText('已停用');
 await expect(sync.getByRole('link',{name:'加入 iPhone 行事曆'})).toHaveCount(0);
 await expect(sync.getByRole('button',{name:'開啟訂閱',exact:true})).toBeVisible();
});

test('calendar subscription layout and manual iPhone instructions fit small phones',async({page},testInfo)=>{
 const httpsUrl='https://booking.test/api/calendar/'+('test-private-fixture'.repeat(9))+'.test-signature.ics';
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/admin',r=>r.fulfill({json:adminFixture}));
 await page.route('**/api/admin/calendar-subscription',r=>r.fulfill({json:{enabled:true,httpsUrl,webcalUrl:httpsUrl.replace('https:','webcal:'),createdAt:1}}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});await page.goto('/?width='+width+'#admin');
  await page.getByRole('button',{name:'行事曆',exact:true}).click();const sync=page.locator('.calendar-sync');
  await sync.getByRole('button',{name:'同步到 iPhone',exact:true}).click();await sync.getByRole('button',{name:'顯示訂閱網址'}).click();
  await expect(sync.getByLabel('私人訂閱網址')).toHaveValue(httpsUrl);
  await sync.locator('summary').click();await expect(sync.locator('details')).toContainText('加入訂閱行事曆');
  await expect(sync.locator('details')).toContainText('非即時同步');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width)).toBe(true);
  const bounds=await sync.getByLabel('私人訂閱網址').boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
  expect(await sync.getByLabel('私人訂閱網址').evaluate(el=>Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  if(width===390)await sync.screenshot({path:testInfo.outputPath('calendar-subscription-mobile.png')});
 }
 expect(errors).toEqual([]);
});

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

test('combined booking selects root-specific service time on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}));
 const date=futureDay();let serviceQuery='';
 await page.route('**/api/availability/dates?*',r=>{serviceQuery=new URL(r.request().url()).searchParams.get('service')||'';return r.fulfill({json:{days:[{date,slots:['10:00']}],firstAvailableDate:date,duration:280}})});
 let submitted:Record<string,unknown>|null=null;await page.route('**/api/bookings',r=>{submitted=r.request().postDataJSON();return r.fulfill({status:201,json:{id:'combo-test'}})});
 await page.goto('/#booking');await page.getByRole('button',{name:/^霧眉＋睫毛/}).click();
 await expect(page.locator('.booking-summary')).toContainText('服務 4 小時');await expect(page.locator('.booking-summary')).not.toContainText('整理');
 await page.getByRole('group',{name:'組合睫毛款式'}).getByRole('button',{name:'YY 美人魚'}).click();
 await page.getByRole('radio').last().check();await expect(page.locator('.booking-summary')).toContainText('YY 美人魚・300 根');await expect(page.locator('.booking-summary')).toContainText('服務 4 小時 40 分鐘');await expect(page.locator('.summary-total')).toContainText('6,100');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();await page.getByRole('button',{name:'10:00',exact:true}).click();expect(serviceQuery).toBe('combo-brows-lashes');
 await page.getByRole('button',{name:'填寫資料',exact:true}).click();await page.getByLabel('聯絡電話 *').fill('0900000000');await page.getByRole('checkbox').last().check();await page.getByRole('button',{name:'送出預約申請',exact:true}).click();
 await expect(page.getByRole('heading',{name:'已收到預約申請'})).toBeVisible();expect(submitted!.serviceId).toBe('combo-brows-lashes');expect(submitted!.spec).toBe(11);
});

test('invitation preserves the LINE login destination, loads before showing details and binds only on confirmation',async({page})=>{
 const token='A'.repeat(43);let loggedIn=false,claims=0;
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:'https://line.me/test'}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:loggedIn?{id:'customer',name:'測試客人',friend:true,admin:false}:null}}));
 let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/invitations/preview',async r=>{expect(r.request().postDataJSON().token).toBe(token);await gate;await r.fulfill({json:{booking:{customer:'測試客人',service:'霧眉＋睫毛',spec:'日式單根・150 根',date:futureDay(),start:bookingFixture.start,end:bookingFixture.service_end,status:'pending'}}})});
 await page.route('**/api/invitations/claim',r=>{claims++;expect(r.request().postDataJSON().token).toBe(token);return r.fulfill({json:{ok:true,status:'pending'}})});
 await page.goto('/#invite/'+token);await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toHaveAttribute('href','/api/auth/line?returnTo='+encodeURIComponent('invite/'+token));expect(claims).toBe(0);
 loggedIn=true;await page.reload();await expect(page.getByRole('status',{name:'載入邀請預約中…'})).toBeVisible();await expect(page.getByRole('button',{name:'確認並綁定這筆預約'})).toHaveCount(0);
 release();await expect(page.locator('.summary-box')).toContainText('霧眉＋睫毛');expect(claims).toBe(0);
 await page.getByRole('button',{name:'確認並綁定這筆預約'}).click();await expect(page.getByRole('heading',{name:'已綁定預約通知'})).toBeVisible();expect(claims).toBe(1);expect(page.url()).not.toContain(token);
});

test('owner can generate a private invitation for an unbound booking in the review dialog',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,bookings:[{...bookingFixture,user_id:null}]}}));
 let writes=0;await page.route('**/api/admin/bookings/test-booking/invitation',r=>{writes++;return r.fulfill({json:{url:'https://booking.test/#invite/'+'B'.repeat(43),expiresAt:Date.now()+3600000}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'審核預約',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'產生邀請連結',exact:true}).click();await expect(dialog.getByLabel('此筆預約專屬網址')).toHaveValue('https://booking.test/#invite/'+'B'.repeat(43));expect(writes).toBe(1);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

 test('customer and owner see separate service and cleanup end times',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/bookings',r=>r.fulfill({json:{bookings:[bookingFixture]}}));
 await page.route('**/api/admin',r=>r.fulfill({json:adminFixture}));
 await page.goto('/#my');await expect(page.locator('.reservation-info')).toContainText('10:00–12:00');await expect(page.locator('.reservation-info')).not.toContainText('12:30');await expect(page.locator('.reservation-info')).not.toContainText('整理');
 await page.goto('/#admin');await expect(page.locator('.admin-booking')).toContainText('服務 10:00 — 12:00');await expect(page.locator('.admin-booking')).toContainText('整理至 12:30');
 await page.getByRole('button',{name:'審核預約',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('10:00–12:00');await expect(page.getByRole('dialog')).toContainText('整理至 12:30');
});

test('manual booking selects an existing customer and confirms immediately without requesting approval',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/admin',r=>r.fulfill({json:adminFixture}));
 const date=futureDay();await page.route('**/api/availability/dates?*',r=>r.fulfill({json:{days:[{date,slots:['10:00']}],firstAvailableDate:date,duration:120}}));
 await page.route('**/api/admin/customers',r=>r.fulfill({json:{customers:[{id:'known-customer',customer:'舊客人',phone:'0911111111',lineBound:true}]}}));
 let submitted:Record<string,unknown>|null=null;await page.route('**/api/admin/bookings',r=>{submitted=r.request().postDataJSON();return r.fulfill({status:201,json:{id:'manual-test',status:'confirmed',lineBound:true,notificationQueued:true}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'新增預約',exact:true}).click();await page.getByRole('button',{name:'選擇日期',exact:true}).click();await page.getByRole('button',{name:'10:00',exact:true}).click();await page.getByRole('button',{name:'填寫資料',exact:true}).click();
 await page.getByRole('button',{name:'選擇現有客人',exact:true}).click();await page.getByRole('combobox',{name:'現有客人',exact:true}).selectOption('known-customer');
 await expect(page.getByLabel('姓名 *',{exact:true})).toHaveValue('舊客人');await expect(page.getByLabel('聯絡電話 *',{exact:true})).toHaveValue('0911111111');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'建立並確認預約',exact:true}).click();await expect(page.getByRole('heading',{name:'已建立並確認預約'})).toBeVisible();await expect(page.locator('.completion')).not.toContainText('預約尚未正式成立');await expect(page.locator('.completion')).toContainText('已為客戶排程 LINE 確認通知');await expect(page.getByText('給客戶的邀請訊息',{exact:true})).toHaveCount(0);
 expect(submitted!.existingCustomerId).toBe('known-customer');expect(submitted!.customer).toBe('舊客人');
});

test('a new manual customer gets an automatically generated invitation message with a copy action',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 await page.route('**/api/admin',r=>r.fulfill({json:adminFixture}));
 const date=futureDay();await page.route('**/api/availability/dates?*',r=>r.fulfill({json:{days:[{date,slots:['10:00']}],firstAvailableDate:date,duration:120}}));
 await page.route('**/api/admin/customers',r=>r.fulfill({json:{customers:[]}}));
 await page.route('**/api/admin/bookings',r=>r.fulfill({status:201,json:{id:'new-manual',status:'confirmed',lineBound:false}}));
 let invitations=0;await page.route('**/api/admin/bookings/new-manual/invitation',r=>{invitations++;return r.fulfill({json:{url:'https://booking.test/#invite/'+'C'.repeat(43),expiresAt:Date.now()+3600000}})});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as unknown as {copied:string}).copied=text}}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'新增預約',exact:true}).click();await page.getByRole('button',{name:'選擇日期',exact:true}).click();await page.getByRole('button',{name:'10:00',exact:true}).click();await page.getByRole('button',{name:'填寫資料',exact:true}).click();await page.getByLabel('姓名 *',{exact:true}).fill('新客人');await page.getByLabel('聯絡電話 *',{exact:true}).fill('0922222222');await page.getByRole('button',{name:'建立並確認預約',exact:true}).click();
 await expect(page.getByLabel('給客戶的邀請訊息')).toContainText('新客人 您好');await expect(page.getByLabel('給客戶的邀請訊息')).toContainText('10:00–11:20');await expect(page.getByLabel('給客戶的邀請訊息')).not.toContainText('整理');
 await page.getByRole('button',{name:'複製邀請訊息與連結',exact:true}).click();const copied=await page.evaluate(()=>(window as unknown as {copied:string}).copied);expect(copied).toContain('新客人 您好');expect(copied).toContain('https://booking.test/#invite/');expect(invitations).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('binding a confirmed manual invitation tells the customer the booking is already confirmed',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}));
 await page.route('**/api/invitations/preview',r=>r.fulfill({json:{booking:{customer:'測試客人',service:'日式單根',spec:'100 根',date:futureDay(),start:bookingFixture.start,end:bookingFixture.service_end,status:'confirmed'}}}));
 await page.route('**/api/invitations/claim',r=>r.fulfill({json:{ok:true,status:'confirmed'}}));
 await page.goto('/#invite/'+'D'.repeat(43));await page.getByRole('button',{name:'確認並綁定這筆預約',exact:true}).click();await expect(page.getByRole('heading',{name:'已綁定預約通知'})).toBeVisible();await expect(page.locator('.invitation-page')).toContainText('預約已正式成立');await expect(page.locator('.invitation-page')).not.toContainText('仍需等候店家確認');
});

const changeFixture={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',state:'pending',reason:'調整當日排班',price:900,expiresAt:Date.now()+12*3600000,old:{date:bookingFixture.date,start:bookingFixture.start,end:bookingFixture.service_end},proposed:{date:futureDay(),start:Date.parse(futureDay()+'T14:00:00+08:00'),end:Date.parse(futureDay()+'T15:40:00+08:00')}};

test('root-specific service minutes change the availability query and keep the private buffer off customer summaries',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 const specs:string[]=[];await page.route('**/api/availability/dates?*',r=>{const spec=new URL(r.request().url()).searchParams.get('spec')!;specs.push(spec);const date=futureDay();return r.fulfill({json:{days:[{date,slots:spec==='2'?['14:00']:['10:00']}],firstAvailableDate:date,duration:spec==='2'?100:90}})});
 await page.goto('/#booking');await expect(page.locator('.booking-summary')).toContainText('服務 80 分鐘');await page.getByRole('radio').last().check();await expect(page.locator('.booking-summary')).toContainText('服務 100 分鐘');await expect(page.locator('.booking-summary')).not.toContainText('整理');
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();await expect(page.getByRole('button',{name:'14:00',exact:true})).toBeVisible();expect(specs.at(-1)).toBe('2');
 await page.getByRole('button',{name:'上一步',exact:true}).click();await page.getByRole('radio').nth(1).check();await page.getByRole('button',{name:'選擇日期',exact:true}).click();await expect(page.getByRole('button',{name:'10:00',exact:true})).toBeVisible();expect(specs.at(-1)).toBe('1');
});

test('owner proposes and withdraws a move in a mobile dialog with clear service and private cleanup times',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));
 let pending=false;await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,changes:pending?[{id:changeFixture.id,booking_id:bookingFixture.id,date:changeFixture.proposed.date,start:changeFixture.proposed.start,service_end:changeFixture.proposed.end,end:changeFixture.proposed.end+30*60000,state:'pending'}]:[]}}));
 let submitted:Record<string,unknown>|null=null;await page.route('**/api/admin/bookings/test-booking/changes',r=>{if(r.request().method()==='POST'){submitted=r.request().postDataJSON();pending=true;return r.fulfill({status:201,json:{change:changeFixture,lineBound:true,notificationQueued:true}})}return r.fulfill({json:{changes:[]}})});
 await page.route('**/api/admin/changes/*/withdraw',r=>{pending=false;return r.fulfill({json:{ok:true}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'審核預約',exact:true}).click();await page.getByRole('button',{name:'調整日期／服務時間',exact:true}).click();await page.getByLabel('改期日期',{exact:true}).fill(changeFixture.proposed.date);await page.getByLabel('改期開始時間',{exact:true}).fill('14:00');await page.getByLabel('服務時間（分鐘）',{exact:true}).fill('100');await page.getByLabel('改期原因',{exact:true}).fill('調整當日排班');
 await expect(page.locator('.reschedule-fields')).toContainText('客戶服務至 15:40，店家整理至 15:50');
 expect(await page.locator('.reschedule-fields').evaluate(el=>[...el.querySelectorAll('input,textarea')].every(input=>{const r=input.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}))).toBe(true);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'提出改期並詢問客戶',exact:true}).click();await expect(page.locator('.reschedule-panel')).toContainText('等待客戶回覆');await expect(page.getByLabel('改期詢問訊息')).toContainText('15:40');await expect(page.getByLabel('改期詢問訊息')).not.toContainText('16:10');expect(submitted!.duration).toBe(100);expect(submitted!.version).toBe(1);
 await page.getByRole('dialog').screenshot({path:'/tmp/linyan-reschedule-mobile.png'});await page.getByRole('button',{name:'撤回改期提案',exact:true}).click();await expect(page.locator('.change-history')).toContainText('店家已撤回');
});

test('customer reschedule link keeps the LINE login destination, waits for data and only confirms after accepting',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));let loggedIn=false;await page.route('**/api/me',r=>r.fulfill({json:{user:loggedIn?{id:'customer',name:'測試客人',friend:true,admin:false}:null}}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});await page.route('**/api/changes/'+changeFixture.id,async r=>{await gate;return r.fulfill({json:{change:changeFixture,booking:{customer:'測試客人',service:'日式單根',spec:'100 根',status:'confirmed'}}})});
 let responses=0;await page.route('**/api/changes/*/respond',r=>{expect(r.request().postDataJSON().decision).toBe('accept');responses++;return r.fulfill({json:{ok:true,state:'accepted'}})});
 await page.goto('/#reschedule/'+changeFixture.id);await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toHaveAttribute('href','/api/auth/line?returnTo='+encodeURIComponent('reschedule/'+changeFixture.id));
 loggedIn=true;await page.reload();await expect(page.getByRole('status',{name:'載入改期提案中…'})).toBeVisible();await expect(page.getByRole('button',{name:'接受改期',exact:true})).toHaveCount(0);release();await expect(page.locator('.change-period.proposed')).toContainText('15:40');await expect(page.locator('.change-card')).not.toContainText('16:10');await page.getByRole('button',{name:'接受改期',exact:true}).click();await expect(page.locator('.change-card')).toContainText('已接受改期');await expect(page.getByRole('status')).toContainText('改期已成功');expect(responses).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('my bookings let a customer decline a proposal while preserving their original reservation',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'customer',name:'測試客人',friend:true,admin:false}}}));
 let declined=false;await page.route('**/api/bookings',r=>r.fulfill({json:{bookings:[{...bookingFixture,reschedule:declined?undefined:changeFixture}]}}));await page.route('**/api/changes/*/respond',r=>{expect(r.request().postDataJSON().decision).toBe('decline');declined=true;return r.fulfill({json:{ok:true,state:'declined'}})});
 await page.goto('/#my');await expect(page.getByRole('button',{name:'維持原時段',exact:true})).toBeVisible();await page.getByRole('button',{name:'維持原時段',exact:true}).click();await expect(page.locator('.change-card')).toHaveCount(0);await expect(page.locator('.reservation-info')).toContainText('10:00–12:00');await expect(page.getByRole('status')).toContainText('已告知店家維持原時段');
});

test('owner calendar clearly displays the proposed hold before the customer accepts',async({page})=>{
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));await page.route('**/api/admin/calendar-subscription',r=>r.fulfill({json:{enabled:false}}));await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,changes:[{id:changeFixture.id,booking_id:bookingFixture.id,date:changeFixture.proposed.date,start:changeFixture.proposed.start,service_end:changeFixture.proposed.end,end:changeFixture.proposed.end+30*60000,state:'pending'}]}}));
 await page.goto('/#admin');await page.getByRole('button',{name:'行事曆',exact:true}).click();await expect(page.locator('.calendar-event.change_pending')).toContainText('改期待同意');await expect(page.locator('.calendar-event.change_pending')).toContainText('整理至 16:10');
});

test('LINE account identity stays visible and logout removes protected navigation only after a successful response',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let signedIn=true,failLogout=true;
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:signedIn?{id:'owner',name:'測試店家帳號',friend:true,admin:true}:null}}));
 await page.route('**/api/logout',r=>{expect(r.request().method()).toBe('POST');if(failLogout)return r.fulfill({status:503,json:{error:'暫時無法登出，請重試'}});signedIn=false;return r.fulfill({json:{}})});
 await page.goto('/#home');await expect(page.locator('.signed-in-identity')).toContainText('測試店家帳號');await expect(page.locator('.signed-in-identity')).toContainText('管理員');
 await page.locator('.signed-in-bar').getByRole('button',{name:'登出',exact:true}).click();await expect(page.getByRole('status')).toContainText('暫時無法登出');await expect(page.locator('.signed-in-identity')).toContainText('測試店家帳號');
 failLogout=false;await page.locator('.signed-in-bar').getByRole('button',{name:'登出',exact:true}).click();await expect(page.locator('.signed-in-bar')).toHaveCount(0);await expect(page.getByRole('link',{name:'後台管理',exact:true})).toHaveCount(0);await page.reload();await expect(page.locator('.signed-in-bar')).toHaveCount(0);
});

test('invitation shows the current LINE account before details load and logout preserves the invitation without claiming',async({page})=>{
 await page.setViewportSize({width:320,height:780});
 const token='E'.repeat(43);let user:{id:string;name:string;friend:boolean;admin:boolean}|null={id:'first',name:'第一個 LINE 帳號',friend:true,admin:false},claims=0;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user}}));
 await page.route('**/api/invitations/preview',async r=>{await gate;return r.fulfill({json:{booking:{customer:'測試客人',service:'日式單根',spec:'100 根',date:futureDay(),start:bookingFixture.start,end:bookingFixture.service_end,status:'confirmed'}}})});
 await page.route('**/api/invitations/claim',r=>{claims++;return r.fulfill({json:{ok:true,status:'confirmed'}})});
 await page.route('**/api/logout',r=>{user=null;return r.fulfill({json:{}})});
 await page.goto('/#invite/'+token);await expect(page.locator('.invitation-account')).toContainText('第一個 LINE 帳號');await expect(page.getByRole('status',{name:'載入邀請預約中…'})).toBeVisible();
 await page.locator('.invitation-account').getByRole('button',{name:'登出',exact:true}).click();release();await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toHaveAttribute('href','/api/auth/line?returnTo='+encodeURIComponent('invite/'+token));await expect(page.locator('.invitation-account')).toHaveCount(0);await expect(page.getByRole('button',{name:'確認並綁定這筆預約'})).toHaveCount(0);expect(claims).toBe(0);expect(page.url()).toContain('#invite/'+token);
 user={id:'second',name:'第二個 LINE 帳號',friend:true,admin:false};await page.reload();await expect(page.locator('.invitation-account')).toContainText('第二個 LINE 帳號');await expect(page.locator('.signed-in-identity')).toContainText('第二個 LINE 帳號');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(claims).toBe(0);
});

test('future confirmed reservations expose only cancellation and rescheduling, and a proposal requires date confirmation',async({page})=>{
 const date=futureDay(),start=Date.parse(date+'T10:00:00+08:00'),booking={...bookingFixture,date,start,status:'confirmed',service_end:start+120*60000,end:start+130*60000};
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,bookings:[booking]}}));let proposals=0;
 await page.route('**/api/admin/bookings/test-booking/changes',r=>{if(r.request().method()==='POST'){proposals++;return r.fulfill({status:201,json:{change:changeFixture}})}return r.fulfill({json:{changes:[]}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'已確認',exact:true}).click();await page.getByRole('button',{name:'查看／更新',exact:true}).click();const modal=page.getByRole('dialog');
 await expect(modal.getByRole('button',{name:'標記服務完成',exact:true})).toHaveCount(0);await expect(modal.getByRole('button',{name:'儲存收款'})).toHaveCount(0);await expect(modal.getByRole('button',{name:'標記未到店'})).toHaveCount(0);await expect(modal.getByRole('button',{name:/^取消預約/})).not.toBeVisible();await modal.locator('.booking-more-actions summary').click();await expect(modal.getByRole('button',{name:/^取消預約/})).toBeVisible();await expect(modal.getByText('預約日期尚未到', {exact:false})).toBeVisible();
 await modal.getByRole('button',{name:'調整日期／服務時間'}).click();await page.getByLabel('改期開始時間',{exact:true}).fill('14:30');page.once('dialog',d=>{expect(d.message()).toContain('14:30');return d.dismiss()});await page.getByRole('button',{name:'提出改期並詢問客戶'}).click();expect(proposals).toBe(0);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'提出改期並詢問客戶'}).click();await expect(page.locator('.reschedule-panel')).toContainText('等待客戶回覆');expect(proposals).toBe(1);
});


test('service completion requires a separate review and acknowledgement and never saves unfinished payment edits',async({page})=>{
 const date=taipeiDay(),start=Date.parse(date+'T10:00:00+08:00'),booking={...bookingFixture,date,start,status:'confirmed',service_end:start+120*60000,end:start+130*60000};
 await page.setViewportSize({width:390,height:844});await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,today:date,bookings:[booking]}}));await page.route('**/api/admin/bookings/test-booking/changes',r=>r.fulfill({json:{changes:[]}}));
 let submitted:Record<string,unknown>|null=null;await page.route('**/api/admin/bookings/test-booking',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{ok:true}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'已確認',exact:true}).click();await page.getByRole('button',{name:'查看／更新',exact:true}).click();const modal=page.getByRole('dialog');
 await modal.getByLabel('確認服務金額',{exact:true}).fill('1200');await modal.getByLabel('已收到款項',{exact:true}).check();await modal.getByLabel('實收金額',{exact:true}).fill('1200');
 await modal.getByRole('button',{name:'標記服務完成',exact:true}).click();const review=modal.getByRole('group',{name:'確認服務已完成'});await expect(review).toContainText(date);await expect(review.getByRole('button',{name:'確認完成服務',exact:true})).toBeDisabled();expect(submitted).toBeNull();
 await review.getByRole('button',{name:'返回修改'}).click();await expect(modal.getByLabel('確認服務金額',{exact:true})).toHaveValue('1200');expect(submitted).toBeNull();
 await modal.getByRole('button',{name:'標記服務完成',exact:true}).click();await modal.getByLabel('我已確認這位客人已完成服務').check();await modal.getByRole('button',{name:'確認完成服務',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(submitted!.status).toBe('completed');expect(submitted!.price).toBe(booking.price);expect(submitted!.paid).toBe(false);expect(submitted!.paidAmount).toBeNull();
});

test('payment and cancellation have distinct confirmation screens and no status write happens on the first tap',async({page})=>{
 const date=taipeiDay(),booking={...bookingFixture,date,status:'confirmed'};let submitted:Record<string,unknown>[]=[];
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,today:date,bookings:[booking]}}));await page.route('**/api/admin/bookings/test-booking/changes',r=>r.fulfill({json:{changes:[]}}));await page.route('**/api/admin/bookings/test-booking',r=>{submitted.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}})});
 await page.goto('/#admin');await page.getByRole('button',{name:'已確認',exact:true}).click();const open=async()=>{await page.getByRole('button',{name:'查看／更新',exact:true}).click()};await open();let modal=page.getByRole('dialog');
 await modal.getByLabel('已收到款項',{exact:true}).check();await modal.getByLabel('實收金額',{exact:true}).fill('850');await modal.getByRole('button',{name:'儲存收款',exact:true}).click();await expect(modal.getByRole('group',{name:'核對收款資料'})).toContainText('850');expect(submitted).toHaveLength(0);await modal.getByRole('button',{name:'確認儲存收款',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(submitted[0].status).toBe('confirmed');expect(submitted[0].paid).toBe(true);expect(submitted[0].paidAmount).toBe(850);
 await open();modal=page.getByRole('dialog');await expect(modal.getByRole('button',{name:/^取消預約/})).not.toBeVisible();await modal.locator('.booking-more-actions summary').click();await modal.getByRole('button',{name:/^取消預約/}).click();await expect(modal.getByRole('group',{name:'確認取消這筆預約'})).toContainText(date);await expect(modal.getByRole('button',{name:'確認取消預約',exact:true})).toBeDisabled();expect(submitted).toHaveLength(1);await modal.getByLabel('我已核對客人與日期，確認取消這筆預約').check();await modal.getByRole('button',{name:'確認取消預約',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(submitted[1].status).toBe('cancelled');
});

test('future booking actions follow the server date even when the phone clock is ahead',async({page})=>{
 const date='2026-11-22',today='2026-10-26',booking={...bookingFixture,date,status:'confirmed'};
 await page.addInitScript(()=>{Date.now=()=>Date.parse('2030-12-31T12:00:00+08:00')});await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'owner',name:'測試店家',friend:true,admin:true}}}));await page.route('**/api/admin',r=>r.fulfill({json:{...adminFixture,today,bookings:[booking]}}));await page.route('**/api/admin/bookings/test-booking/changes',r=>r.fulfill({json:{changes:[]}}));
 await page.goto('/#admin');await page.getByRole('button',{name:'已確認',exact:true}).click();await page.getByRole('button',{name:'查看／更新',exact:true}).click();const modal=page.getByRole('dialog');await expect(modal.getByRole('button',{name:'標記服務完成'})).toHaveCount(0);await expect(modal.getByRole('button',{name:'儲存收款'})).toHaveCount(0);await expect(modal.locator('.future-booking-note')).toContainText('預約日期尚未到');
});

test('custom booking month calendar marks availability across years, keeps the week in sync and fits a narrow phone',async({page})=>{
 await page.setViewportSize({width:320,height:780});const now=Date.parse('2026-12-28T04:00:00Z');await page.clock.setFixedTime(now);const dates=bookingDates(30,now),open=['2026-12-31','2027-01-07'];
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));
 let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve});await page.route('**/api/availability/dates?*',async r=>{await pending;await r.fulfill({json:{days:dates.map(date=>({date,slots:open.includes(date)?['10:00']:[]})),firstAvailableDate:open[0],duration:80}})});
 await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();const trigger=page.getByRole('button',{name:'預約日期',exact:true});await expect(trigger).toBeDisabled();release();await expect(trigger).toHaveAttribute('data-date',open[0]);await trigger.click();
 const calendar=page.getByRole('dialog',{name:'選擇預約日期',exact:true});await expect(page.locator('.booking-date-picker input[type=date]')).toHaveCount(0);await expect(calendar).toContainText('2026 年 12 月');await expect(calendar.getByRole('button',{name:'上個月',exact:true})).toBeDisabled();await expect(calendar.locator('[data-date="2026-12-30"]')).toBeDisabled();await expect(calendar.locator('[data-date="2026-12-31"]')).toHaveClass(/available is-chosen/);await expect(calendar.locator('[data-date="2026-12-31"]')).toBeFocused();
 await calendar.getByRole('button',{name:'下個月',exact:true}).click();await expect(calendar).toContainText('2027 年 1 月');await expect(calendar.getByRole('button',{name:'下個月',exact:true})).toBeDisabled();await expect(calendar.locator('[data-date="2027-01-07"]')).toBeEnabled();await expect(calendar.locator('[data-date="2027-01-08"]')).toBeDisabled();await expect(calendar.locator('[data-date="2027-01-27"]')).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await calendar.locator('[data-date="2027-01-07"]').click();await expect(calendar).toHaveCount(0);await expect(trigger).toHaveAttribute('data-date',open[1]);await expect(trigger).toBeFocused();expect(await page.locator('.date-strip button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-date')))).toEqual(weekDates(open[1]));await expect(page.locator('.date-strip [data-date="2027-01-07"]')).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'10:00',exact:true})).toBeVisible();
 await trigger.click();await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(trigger).toBeFocused();
 await page.setViewportSize({width:1280,height:900});await trigger.click();const triggerBounds=await trigger.boundingBox(),calendarBounds=await calendar.boundingBox();expect(triggerBounds!.width).toBeGreaterThan(200);expect(calendarBounds!.x).toBeGreaterThanOrEqual(16);expect(calendarBounds!.y).toBeGreaterThanOrEqual(16);expect(calendarBounds!.y+calendarBounds!.height).toBeLessThanOrEqual(884);
});

test('booking calendar floats on desktop and opens as a dismissible phone sheet without moving the form',async({page})=>{
 const now=Date.parse('2026-11-01T04:00:00Z');await page.clock.setFixedTime(now);const dates=bookingDates(30,now);
 await page.route('**/api/public',r=>r.fulfill({json:{services:SERVICES,settings:DEFAULT_SETTINGS,lineReady:true,lineUrl:''}}));await page.route('**/api/me',r=>r.fulfill({json:{user:null}}));await page.route('**/api/availability/dates?*',r=>r.fulfill({json:{days:dates.map(date=>({date,slots:['2026-11-02','2026-11-05'].includes(date)?['10:00']:[]})),firstAvailableDate:'2026-11-02',duration:80}}));
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:844});await page.goto('/#home');await expect(page.locator('.hero')).toBeVisible();await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();const trigger=page.getByRole('button',{name:'預約日期',exact:true});await expect(trigger).toBeEnabled();await trigger.evaluate(n=>n.scrollIntoView({block:'center'}));
  const before=await page.locator('.time-grid').boundingBox(),scroll=await page.evaluate(()=>scrollY);await trigger.click();const calendar=page.getByRole('dialog',{name:'選擇預約日期',exact:true});await expect(calendar).toHaveAttribute('open','');await expect(page.locator('body')).toHaveCSS('position','fixed');const after=await page.locator('.time-grid').boundingBox();expect(Math.abs(after!.y-before!.y)).toBeLessThan(2);
  const box=await calendar.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);if(width<=600){expect(Math.abs(box!.y+box!.height-844)).toBeLessThan(2)}else{expect(box!.width).toBeLessThan(420)}
  await calendar.getByRole('button',{name:'收起月曆',exact:true}).focus();await page.keyboard.press('Tab');await expect(calendar.getByRole('button',{name:'關閉月曆',exact:true})).toBeFocused();await calendar.getByRole('button',{name:'關閉月曆',exact:true}).click();await expect(calendar).toHaveCount(0);await expect(trigger).toBeFocused();expect(Math.abs((await page.evaluate(()=>scrollY))-scroll)).toBeLessThan(2);
  await trigger.click();await page.mouse.click(8,8);await expect(calendar).toHaveCount(0);await expect(trigger).toBeFocused();await trigger.click();await calendar.locator('[data-date="2026-11-05"]').click();await expect(calendar).toHaveCount(0);await expect(trigger).toHaveAttribute('data-date','2026-11-05');await expect(page.locator('body')).not.toHaveCSS('position','fixed');
 }
});
