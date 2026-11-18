import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationText} from '../worker/bookingMessages.ts';
import {STUDIO_ADDRESS,STUDIO_MAP_URL,STUDIO_NAVIGATION_NAME} from '../src/studio.ts';

test('booking confirmations include the supplied navigation link even when a saved address is empty, and keep cleanup private',()=>{
 const b={date:'2026-11-20',start:Date.parse('2026-11-20T13:45:00+08:00'),service_end:Date.parse('2026-11-20T15:25:00+08:00'),end:Date.parse('2026-11-20T15:35:00+08:00'),service_name:'日式單根',spec:'200 根'};
 for(const address of ['', '  ',STUDIO_ADDRESS]){const text=confirmationText(b,1100,address);for(const value of [STUDIO_ADDRESS,STUDIO_MAP_URL,STUDIO_NAVIGATION_NAME,'13:45–15:25'])assert.ok(text.includes(value));assert.ok(!text.includes('15:35'));assert.ok(!text.includes('整理'))}
 assert.ok(confirmationText(b,1100,'店家更新的地址').includes('工作室地址：店家更新的地址'));
});
