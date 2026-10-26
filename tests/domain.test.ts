import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availableSlots,DEFAULT_SETTINGS,SERVICES,serviceDuration,formatDuration,priceFor,taipeiMs,overlaps,taipeiDay,withinCalendarMonths} from '../src/domain.ts';
const now=Date.parse('2026-10-07T00:00:00+08:00');
test('a full service and cleanup must fit inside an open window',()=>{
 const cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 const slots=availableSlots('2026-10-08',120,cfg,[['10:00','18:00']],[],now);
 assert.equal(slots[0],'10:00');assert.equal(slots.at(-1),'15:30');assert.ok(!slots.includes('16:00'));
});
test('pending appointments and lunch breaks remove all overlapping starts',()=>{
 const cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 const slots=availableSlots('2026-10-08',90,cfg,[['10:00','12:00'],['13:00','18:00']],[{start:taipeiMs('2026-10-08','14:00'),end:taipeiMs('2026-10-08','15:45')}],now);
 assert.deepEqual(slots,['10:00','15:45','16:00']);
});
test('booking horizon, lead time, closed days and exact boundary',()=>{
 const cfg={...DEFAULT_SETTINGS,bookingDays:2,leadHours:12};
 assert.deepEqual(availableSlots('2026-10-09',60,cfg,[['10:00','18:00']],[],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',60,cfg,[],[],now),[]);
 assert.equal(overlaps(1,2,2,3),false);assert.equal(overlaps(1,3,2,4),true);
 assert.equal(taipeiDay(Date.parse('2026-10-07T17:00:00Z')),'2026-10-08');
});
test('unknown durations prevent slots and addons increase the occupied duration',()=>{
 const base={...SERVICES[0],duration:null,specs:SERVICES[0].specs.map(s=>({...s,duration:undefined}))};assert.equal(serviceDuration(base,{lower:false,removal:'none'},DEFAULT_SETTINGS),null);
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
 const cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 const source=SERVICES.find(s=>s.id==='single')!,service={...source,specs:source.specs.map(s=>({...s,duration:undefined}))};
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
test('combined brows and lashes follows root count and retains lash addon rules',()=>{
 const service=SERVICES.find(s=>s.id==='combo-brows-lashes')!,cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 assert.equal(service.duration,240);assert.equal(service.specs.length,12);
 const spec=service.specs.findIndex(s=>s.label==='日式單根・150 根');
 assert.equal(priceFor(service,spec,{lower:false,removal:'none'}),6000);
 assert.equal(priceFor(service,spec,{lower:true,removal:'other'}),6400);
 assert.deepEqual(availableSlots('2026-10-08',240,cfg,[['16:30','20:59']],[],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',240,cfg,[['16:30','21:00']],[],now),['16:30']);
 assert.equal(serviceDuration(service,{lower:true,removal:'own'},cfg),300);
});

test('an outdated zero-buffer setting still requires ten minutes before the next customer',()=>{
 const cfg={...DEFAULT_SETTINGS,leadHours:0,bufferMinutes:0};
 assert.deepEqual(availableSlots('2026-10-08',120,cfg,[['10:00','12:00']],[],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',120,cfg,[['10:00','12:10']],[],now),['10:00']);
});

test('lash root counts choose service minutes independently of cleanup and addons, while the combo follows its own root-count rule',()=>{
 for(const s of SERVICES.filter(s=>['single','3d','6d','yy'].includes(s.id))){
  for(const [i,spec] of s.specs.entries()){
   const roots=Number(spec.label.replace(' 根','')),minutes=roots===100?80:roots===200?100:roots===300?120:90;
   assert.equal(serviceDuration(s,{lower:false,removal:'none'},DEFAULT_SETTINGS,i),minutes);
   assert.equal(serviceDuration(s,{lower:true,removal:'own'},DEFAULT_SETTINGS,i),minutes+60);
  }
 }
 const combo=SERVICES.find(s=>s.category==='combo')!;assert.equal(serviceDuration(combo,{lower:false,removal:'none'},DEFAULT_SETTINGS,0),240);
 const single=SERVICES[0],cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 assert.deepEqual(availableSlots('2026-10-08',serviceDuration(single,{lower:false,removal:'none'},cfg,1)!,cfg,[['10:00','12:00']],[],now),['10:00']);
 assert.deepEqual(availableSlots('2026-10-08',serviceDuration(single,{lower:false,removal:'none'},cfg,2)!,cfg,[['10:00','12:00']],[],now),[]);
});


test('quarter-hour starts align with clock minutes and preserve the full cleanup gap',()=>{
 const cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 assert.equal(cfg.stepMinutes,15);
 assert.deepEqual(availableSlots('2026-10-08',80,cfg,[['10:10','13:00']],[{start:taipeiMs('2026-10-08','10:00'),end:taipeiMs('2026-10-08','11:50')}],now),[]);
 assert.deepEqual(availableSlots('2026-10-08',80,cfg,[['10:10','13:00']],[],now),['10:15','10:30','10:45','11:00']);
 assert.equal(availableSlots('2026-10-08',80,cfg,[['10:00','18:00']],[{start:taipeiMs('2026-10-08','10:00'),end:taipeiMs('2026-10-08','11:50')}],now)[0],'12:00');
});


test('all combo styles use four hours at 100 roots and add ten minutes per fifty roots, with readable labels',()=>{
 const service=SERVICES.find(s=>s.id==='combo-brows-lashes')!,cfg={...DEFAULT_SETTINGS,bufferMinutes:30,leadHours:0};
 for(const [spec,item] of service.specs.entries()){
  const roots=Number(item.label.split('・')[1].replace(' 根','')),expected=240+(roots-100)/50*10;
  assert.equal(serviceDuration(service,{lower:false,removal:'none'},cfg,spec),expected);
  assert.equal(serviceDuration(service,{lower:true,removal:'other'},cfg,spec),expected+60);
  assert.deepEqual(availableSlots('2026-10-08',expected,cfg,[['10:00','14:30']],[],now),roots===100?['10:00']:[]);
 }
 assert.equal(formatDuration(240),'4 小時');assert.equal(formatDuration(250),'4 小時 10 分鐘');assert.equal(formatDuration(260),'4 小時 20 分鐘');assert.equal(formatDuration(280),'4 小時 40 分鐘');
});


test('new default cleanup is ten minutes and existing longer settings remain valid',()=>{
 const cfg={...DEFAULT_SETTINGS,leadHours:0};assert.equal(cfg.bufferMinutes,10);
 assert.deepEqual(availableSlots('2026-10-08',90,cfg,[['10:00','11:40']],[],now),['10:00']);
 assert.deepEqual(availableSlots('2026-10-08',90,{...cfg,bufferMinutes:30},[['10:00','11:40']],[],now),[]);
 const occupied=[{start:taipeiMs('2026-10-08','10:00'),end:taipeiMs('2026-10-08','11:40')}];
 assert.equal(availableSlots('2026-10-08',90,cfg,[['10:00','18:00']],occupied,now)[0],'11:45');
});
