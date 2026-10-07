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

test('studio notices and combinable offers are readable on mobile with original posters',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/#policies');
 await expect(page.locator('.policy-content')).toContainText('NT$500 訂金');
 await expect(page.locator('.policy-content')).toContainText('預約保留 15 分鐘');
 await expect(page.locator('.policy-content')).toContainText('現金或當下匯款');
 await page.getByRole('button',{name:'美睫須知',exact:true}).click();
 await expect(page.locator('.care-section').first()).toContainText('費用為 NT$100');
 await expect(page.locator('.care-section').last()).toContainText('完成後 1 小時內避免碰水');
 await expect(page.locator('.care-section').last()).toContainText('2 週內回補');
 await page.getByText('查看原始美睫施作後注意事項',{exact:true}).click();
 await expect(page.locator('img[src="/assets/lashes-aftercare.jpg"]')).toBeVisible();
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
