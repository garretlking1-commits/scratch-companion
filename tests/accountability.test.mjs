import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={Date,Array,Number,Set,Map};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../accountability.js',import.meta.url),'utf8'),context,{filename:fileURLToPath(new URL('../accountability.js',import.meta.url))});
const week=context.ScratchAccountability.week;
const prefs={trainingPlans:[{from:'2026-09-28',weekdays:[1,2,4]}]};
test('missing records stay unknown even after a planned day passes',()=>{
 const r=week([],prefs,'2026-09-30');assert.equal(r.days[0].status,'unknown');assert.equal(r.missed.length,0);
});
test('partial progress earns started credit and off-plan activity does not fill planned target',()=>{
 const r=week([{type:'workout',date:'2026-09-28',exId:'bike',workSec:10,watch:{partial:true}}, {type:'workout',date:'2026-09-30',exId:'bike',sets:1,watchId:'one'}],prefs,'2026-09-30');
 assert.equal(r.days[0].status,'started');assert.equal(r.completed,0);assert.equal(r.extraDays,1);
});
function record(exId,sets,id){return {type:'workout',date:'2026-09-28',exId,sets,watchId:id,watch:{plan:{scheduled:[{exerciseId:'a',plannedSets:2},{exerciseId:'b',plannedSets:1}]}}};}
test('only a matching complete historical schedule earns session complete',()=>{
 assert.equal(week([record('a',2,'a')],prefs,'2026-09-30').days[0].status,'recorded');
 assert.equal(week([record('a',2,'a'),record('b',1,'b')],prefs,'2026-09-30').days[0].status,'complete');
});
test('QR-only records have unknown completion and duplicates cannot complete a session',()=>{
 assert.equal(week([{type:'workout',date:'2026-09-28',exId:'a',sets:2}],prefs,'2026-09-30').days[0].status,'started');
 const a=record('a',1,'same');assert.notEqual(week([a,a,record('b',1,'b')],prefs,'2026-09-30').days[0].status,'complete');
});
test('pausing keeps past plans and rest does not conceal recorded activity',()=>{
 const p={trainingPlans:[...prefs.trainingPlans,{from:'2026-09-30',weekdays:[]},{from:'2026-10-02',weekdays:[1,2,4]}]};
 const r=week([],p,'2026-10-01',[{date:'2026-09-29',restDay:true}]);assert.equal(r.days[0].planned,true);assert.equal(r.days[1].status,'rest');assert.equal(r.days[3].planned,false);assert.equal(r.target,1);
 const active=week([record('a',2,'a')],prefs,'2026-09-30',[{date:'2026-09-28',restDay:true}]);assert.equal(active.days[0].status,'recorded');
});
test('conflicting snapshots cannot certify whole session completion',()=>{
 const a=record('a',2,'a'),b=record('b',1,'b');b.watch.plan.scheduled=[{exerciseId:'b',plannedSets:1}];
 assert.notEqual(week([a,b],prefs,'2026-09-30').days[0].status,'complete');
});

test('dated pause validates and restores prior weekdays without altering the past',()=>{
 const change=context.ScratchAccountability.changePlan;assert.equal(typeof change,'function');
 const plans=change(prefs.trainingPlans,[],'2026-09-30','2026-10-05');assert.deepEqual(Array.from(plans,p=>[p.from,Array.from(p.weekdays)]),[['2026-09-28',[1,2,4]],['2026-09-30',[]],['2026-10-05',[1,2,4]]]);
 assert.throws(()=>change(prefs.trainingPlans,[],'2026-09-30','2026-09-29'));
});
