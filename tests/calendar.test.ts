import {test} from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {calendarIcs,type CalendarBooking} from '../worker/calendar.ts';

test('generated ICS round-trips through an independent parser with Chinese, emoji and escaped user content',()=>{
 const customer='林小姐🌸'.repeat(20)+'\\,;\r\nBEGIN:VEVENT\r\nSUMMARY:注入測試';
 const booking:CalendarBooking={id:'test-calendar-booking',customer,service_name:'日式單根',spec:'100 根；自然款',start:Date.parse('2026-11-02T10:00:00+08:00'),end:Date.parse('2026-11-02T12:30:00+08:00'),status:'confirmed',created_at:Date.parse('2026-10-08T00:00:00Z'),updated_at:Date.parse('2026-10-08T01:00:00Z'),version:2};
 const address='測試路 1 號, 2 樓;\n請按門鈴',ics=calendarIcs([booking],'https://booking.test',address);
 assert.ok(ics.endsWith('\r\n'));assert.ok(!ics.replace(/\r\n/g,'').includes('\n'));
 for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
 const calendar=new ICAL.Component(ICAL.parse(ics)),components=calendar.getAllSubcomponents('vevent');
 assert.equal(components.length,1);assert.equal(calendar.getFirstPropertyValue('version'),'2.0');
 const event=new ICAL.Event(components[0]);
 assert.equal(event.uid,'test-calendar-booking@booking.test');
 assert.equal(event.summary,customer.replace(/\r\n/g,'\n')+' · 日式單根');assert.equal(event.location,address);
 assert.equal(event.startDate.toJSDate().getTime(),booking.start);assert.equal(event.endDate.toJSDate().getTime(),booking.end);
 assert.equal(components[0].getFirstPropertyValue('sequence'),2);
 assert.equal((components[0].getFirstPropertyValue('last-modified') as ICAL.Time).toJSDate().getTime(),booking.updated_at);
 assert.match(event.description,/時段包含服務與整理時間。/);assert.match(event.description,/預約編號：test-calendar-booking/);
 assert.equal(components[0].getFirstPropertyValue('status'),'CONFIRMED');assert.equal(components[0].getFirstPropertyValue('transp'),'OPAQUE');
});

test('empty ICS remains a valid subscription calendar with a stable name and no invitation method',()=>{
 const calendar=new ICAL.Component(ICAL.parse(calendarIcs([],'https://booking.test','')));
 assert.equal(calendar.getFirstPropertyValue('x-wr-calname'),'琳顏美學・預約');
 assert.equal(calendar.getFirstPropertyValue('x-wr-timezone'),'Asia/Taipei');
 assert.equal(calendar.getAllSubcomponents('vevent').length,0);assert.equal(calendar.getFirstPropertyValue('method'),null);
});
