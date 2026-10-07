import {test,expect} from '@playwright/test';
import {taipeiDay,weekday,SERVICES,DEFAULT_SETTINGS} from '../src/domain';
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
 await expect(cell).toContainText('全天休息');await customerSlots();await expect(page.getByRole('heading',{name:'這天目前沒有可預約時段'})).toBeVisible();
 await edit();await dialog.getByRole('button',{name:'恢復固定排班'}).click();await expect(cell).toContainText('未開放');
 await customerSlots();await expect(page.getByRole('heading',{name:'這天目前沒有可預約時段'})).toBeVisible();
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
