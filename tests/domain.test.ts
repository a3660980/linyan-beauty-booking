import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availableSlots,DEFAULT_SETTINGS,SERVICES,serviceDuration,priceFor,taipeiMs,overlaps,taipeiDay,withinCalendarMonths} from '../src/domain.ts';
const now=Date.parse('2026-10-07T00:00:00+08:00');
test('a full service and cleanup must fit inside an open window',()=>{
 const cfg={...DEFAULT_SETTINGS,leadHours:0};
 const slots=availableSlots('2026-10-08',120,cfg,[['10:00','18:00']],[],now);
 assert.equal(slots[0],'10:00');assert.equal(slots.at(-1),'15:30');assert.ok(!slots.includes('16:00'));
});
test('pending appointments and lunch breaks remove all overlapping starts',()=>{
 const cfg={...DEFAULT_SETTINGS,leadHours:0};
 const slots=availableSlots('2026-10-08',90,cfg,[['10:00','12:00'],['13:00','18:00']],[{start:taipeiMs('2026-10-08','14:00'),end:taipeiMs('2026-10-08','15:45')}],now);
 assert.deepEqual(slots,['10:00','16:00']);
});
test('booking horizon, lead time, closed days and exact boundary',()=>{
 const cfg={...DEFAULT_SETTINGS,bookingDays:2,leadHours:12};
 assert.deepEqual(availableSlots('2026-10-09',60,cfg,[['10:00','18:00']],[],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',60,cfg,[],[],now),[]);
 assert.equal(overlaps(1,2,2,3),false);assert.equal(overlaps(1,3,2,4),true);
 assert.equal(taipeiDay(Date.parse('2026-10-07T17:00:00Z')),'2026-10-08');
});
test('unknown durations prevent slots and addons increase the occupied duration',()=>{
 const base={...SERVICES[0],duration:null};assert.equal(serviceDuration(base,{lower:false,removal:'none'},DEFAULT_SETTINGS),null);
 assert.equal(serviceDuration({...base,duration:90},{lower:true,removal:'own'},{...DEFAULT_SETTINGS,addonDurations:{...DEFAULT_SETTINGS.addonDurations,lower:null}}),null);
 assert.equal(serviceDuration({...base,duration:90},{lower:true,removal:'own'},{...DEFAULT_SETTINGS,addonDurations:{lower:15,own:20,other:20}}),125);
});
test('price menu and invalid cross-category addons',()=>{
 assert.equal(priceFor(SERVICES[0],1,{lower:true,removal:'other'}),1400);
 assert.equal(priceFor(SERVICES.find(x=>x.id==='yy')!,0,{lower:false,removal:'none'}),900);
 assert.equal(priceFor(SERVICES.find(x=>x.id==='brows')!,1,{lower:false,removal:'none'}),4500);
 assert.throws(()=>priceFor(SERVICES.find(x=>x.id==='brows')!,0,{lower:true,removal:'none'}));
 assert.throws(()=>taipeiMs('2026-02-30','10:00'));
});
test('three-month touchup uses calendar months, including month-end dates',()=>{
 const before=taipeiMs('2026-01-31','12:00');
 assert.equal(withinCalendarMonths(before,taipeiMs('2026-04-30','12:00'),3),true);
 assert.equal(withinCalendarMonths(before,taipeiMs('2026-04-30','12:01'),3),false);
});
test('owner supplied service ranges reserve their upper bound plus 30 minutes cleanup',()=>{
 const cfg={...DEFAULT_SETTINGS,leadHours:0};
 const service=SERVICES.find(s=>s.id==='single')!;
 const duration=serviceDuration(service,{lower:false,removal:'none'},cfg)!;
 const slots=availableSlots('2026-10-08',duration,cfg,[['10:00','18:00']],[{start:taipeiMs('2026-10-08','10:00'),end:taipeiMs('2026-10-08','12:30')}],now);
 assert.equal(slots[0],'12:30');
 assert.equal(serviceDuration(service,{lower:false,removal:'own'},cfg),150);
 const lowerDuration=serviceDuration(service,{lower:true,removal:'none'},cfg)!;
 assert.deepEqual(availableSlots('2026-10-08',lowerDuration,cfg,[['10:00','13:00']],[],now),['10:00']);
 const brows=SERVICES.find(s=>s.id==='brows')!;
 assert.deepEqual(availableSlots('2026-10-08',brows.duration!,cfg,[['10:00','13:00']],[],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',brows.duration!,cfg,[['10:00','13:30']],[],now),['10:00']);
});
