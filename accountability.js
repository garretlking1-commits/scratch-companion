(function(root){
 'use strict';
 const DAY=86400000,NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 function evidence(rows){
  const unique=new Map();
  rows.forEach((r,i)=>{const key=r.watchId||'legacy:'+i;const old=unique.get(key);if(!old||old.watch?.partial===true)unique.set(key,r);});
  const all=[...unique.values()];
  const finished=all.filter(r=>r.watchId&&r.partial!==true&&r.watch?.partial!==true);
  let schedule=null,signature=null,conflict=false;
  all.forEach(r=>{
   const s=r.watch?.plan?.scheduled;
   if(!Array.isArray(s)||!s.length||s.length>100)return;
   if(s.some(x=>!x||typeof x.exerciseId!=='string'||!Number.isInteger(x.plannedSets)||x.plannedSets<1||x.plannedSets>100)||new Set(s.map(x=>x.exerciseId)).size!==s.length)return;
   const next=JSON.stringify(s.map(x=>({exerciseId:x.exerciseId,plannedSets:x.plannedSets})).sort((a,b)=>a.exerciseId.localeCompare(b.exerciseId)));
   if(signature&&signature!==next)conflict=true;else{signature=next;schedule=s;}
  });
  const complete=!!schedule&&!conflict&&schedule.every(s=>finished.filter(r=>r.exId===s.exerciseId).reduce((n,r)=>n+(Number.isInteger(r.sets)&&r.sets>0&&r.sets<=100?r.sets:0),0)>=s.plannedSets);
  return {started:all.length>0,recorded:finished.length>0,complete};
 }
 function week(entries,settings,today,journalDays=[]){
  const now=Date.parse(today+'T00:00:00Z');
  const start=now-((new Date(now).getUTCDay()+6)%7)*DAY;
  const plans=Array.isArray(settings.trainingPlans)?settings.trainingPlans:[];
  const rows=(Array.isArray(entries)?entries:[]).filter(r=>r&&r.type==='workout'&&r.exId!=='test-5s'&&typeof r.date==='string'&&r.date<=today&&(positive(r.sets)||positive(r.workSec)));
  const days=Array.from({length:7},(_,i)=>{
   const stamp=start+i*DAY,date=new Date(stamp).toISOString().slice(0,10),weekday=new Date(stamp).getUTCDay();
   const active=plans.filter(p=>p.from<=date).at(-1);
   const proof=evidence(rows.filter(r=>r.date===date));
   const rest=journalDays.some(r=>r.date===date&&r.restDay===true&&!r.deleted)&&!proof.started;
   const planned=!!active&&active.weekdays.includes(weekday)&&!rest;
   const status=proof.complete?'complete':proof.recorded?'recorded':proof.started?'started':rest?'rest':!planned?'open':date<today?'unknown':date===today?'today':'upcoming';
   return {date,name:NAMES[weekday],planned,completed:proof.complete,...proof,status};
  });
  return {configured:plans.length>0,start:days[0].date,end:days[6].date,target:days.filter(d=>d.planned).length,
   completed:days.filter(d=>d.planned&&d.complete).length,startedDays:days.filter(d=>d.planned&&d.started).length,
   extraDays:days.filter(d=>!d.planned&&d.started).length,unknown:days.filter(d=>d.status==='unknown'),missed:[],days};
 }
 function changePlan(plans,weekdays,today,resume=''){
  const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  if(!valid(today)||!Array.isArray(weekdays)||new Set(weekdays).size!==weekdays.length||weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Choose valid weekdays.');
  if(resume&&(!valid(resume)||resume<=today||weekdays.length))throw Error('For a pause, clear the weekdays and choose a future resume date.');
  const earlier=plans.filter(p=>p.from<today).map(p=>({from:p.from,weekdays:[...p.weekdays]}));
  const next=[...earlier,{from:today,weekdays:[...weekdays]}];
  if(resume){const previous=plans.filter(p=>p.from<=today&&p.weekdays.length).at(-1);if(!previous)throw Error('Save your usual workout days before a timed pause.');next.push({from:resume,weekdays:[...previous.weekdays]});}
  return next;
 }
 root.ScratchAccountability={week,changePlan};
})(globalThis);
