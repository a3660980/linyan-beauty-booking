import {useEffect,useState} from 'react';
import {api} from './api';
import {availableSlots,bookingDates,serviceDuration,windowsForDate,type Addons,type AvailabilityDates,type DateSchedule,type Service,type Settings} from './domain';
type Occupied={date:string;start:number;end:number;status:string};
type Options={enabled:boolean;service:Service;addons:Addons;settings:Settings;demo:boolean;exceptions:DateSchedule[];bookings:Occupied[]};

export function useBookingAvailability({enabled,service,addons,settings,demo,exceptions,bookings}:Options){
 const key=`${service.id}:${addons.lower}:${addons.removal}`;
 const [result,setResult]=useState<{key:string;data:AvailabilityDates}|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  setPending(true);setError('');setResult(null);
  async function load(){
   try{
    let data:AvailabilityDates;
    if(demo){
     const now=Date.now(),duration=serviceDuration(service,addons,settings);
     const days=bookingDates(settings.bookingDays,now).map(date=>({date,slots:duration?availableSlots(date,duration,settings,windowsForDate(date,settings.weekly,exceptions),bookings.filter(b=>b.date===date&&['pending','confirmed'].includes(b.status)),now):[]}));
     data={days,firstAvailableDate:days.find(d=>d.slots.length)?.date??null,duration};
    }else{
     const query=new URLSearchParams({service:service.id,lower:String(addons.lower),removal:addons.removal});
     data=await api<AvailabilityDates>(`/availability/dates?${query}`,'GET',undefined,controller.signal);
    }
    if(!controller.signal.aborted)setResult({key,data});
   }catch(e){if(!controller.signal.aborted)setError((e as Error).message)}
   finally{if(!controller.signal.aborted)setPending(false)}
  }
  void load();
  return()=>controller.abort();
 },[enabled,key,service.duration,settings,demo,exceptions,bookings,attempt]);
 const data=result?.key===key?result.data:null;
 return {key,data,pending:enabled&&(pending||(!data&&!error)),error:enabled?error:'',retry:()=>setAttempt(n=>n+1)};
}
