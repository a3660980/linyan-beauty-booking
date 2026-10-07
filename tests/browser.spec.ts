import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"測試環境未連線"}'}))});
test('demo booking keeps selected time through submission and owner approval',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#demo-booking');
 await page.getByRole('button',{name:'選擇日期',exact:true}).click();
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
 await page.goto('/#booking');await page.getByRole('button',{name:'選擇日期',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('尚未設定此服務時間');
 await expect(page.getByRole('heading',{name:'想為自己預約什麼？'})).toBeVisible();
});
