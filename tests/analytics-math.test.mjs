import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const context=vm.createContext({});
const source=new URL('../analytics-math.js',import.meta.url);
vm.runInContext(fs.readFileSync(source,'utf8'),context,{filename:fileURLToPath(source)});
const summary=context.ScratchAnalytics.summary;
const today='2026-09-21';
const date=i=>new Date(Date.parse(today+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);
const weight=(i,value)=>({id:String(i),date:date(i),weightLb:value,updatedAt:date(i)+'T12:00:00.000Z',deleted:false});
function health(i,minutes=450,start=1435,rhr=60){return {date:date(i),timezoneOffsetMinutes:0,groups:{sleep:{status:'ok',capturedAt:date(i)+'T12:00:00.000Z',value:{totalMinutes:minutes,startMinute:start}},heartRate:{status:'ok',capturedAt:date(i)+'T12:00:00.000Z',value:{restingBpm:rhr}}}};}
const run=options=>summary({today,...options});
test('empty data stays unknown; bedtime guidance alone never creates measured sleep',()=>{
 const a=run({settings:{sleepTargetMinutes:480,wakeMinute:420,bedtimeBufferMinutes:30}});
 assert.equal(a.weight.status,'insufficient');assert.equal(a.sleep.samples,0);
 assert.equal(a.sleep.values.bedtimeMinute,1350);assert.equal(a.sleep.values.shortfall7Minutes,null);
 assert.equal(a.effort.values.load7,null);assert.equal(a.nutrition.status,'insufficient');
});
test('weight regression uses calendar days, excludes tombstones/future, and projects only toward goal',()=>{
 const records=Array.from({length:15},(_,i)=>weight(i*2,180+i*2/7));
 records.push({...weight(2,100),deleted:true}, {...weight(0,500),date:'2026-09-22'});
 const a=run({weights:{records},settings:{goalWeightLb:170}}).weight;
 assert.ok(Math.abs(a.values.weeklyLb+1)<1e-8);assert.ok(a.values.goalDays>0);
 assert.equal(run({weights:{records},settings:{goalWeightLb:190}}).weight.values.goalDate,null);
});
test('duplicate dates have equal day weight and stale histories cannot project',()=>{
 const records=Array.from({length:15},(_,i)=>weight(i*2,180));records.push({...weight(0,182),id:'extra'});
 assert.equal(run({weights:{records}}).weight.samples,14);
 const stale=records.map((r,i)=>({...r,date:date(40+i)}));
 assert.equal(run({weights:{records:stale},settings:{goalWeightLb:170}}).weight.values.goalDate,null);
});
test('sleep ignores missing/stale retained totals and handles midnight circularly',()=>{
 const days=Array.from({length:7},(_,i)=>health(i,450,i%2?5:1435));
 days[0].groups.sleep.preservedFields={totalMinutes:{capturedAt:date(1)+'T12:00:00.000Z'}};
 const a=run({health:{days},settings:{sleepTargetMinutes:480}}).sleep;
 assert.equal(a.values.observed7,6);assert.equal(a.values.shortfall7Minutes,180);
 assert.ok(a.values.regularityMinutes<10);
});
test('fresh resting baseline requires14 prior days and does not divide by zero MAD',()=>{
 const days=Array.from({length:15},(_,i)=>health(i,450,1435,i?60:65));
 const a=run({health:{days}}).restingHeartRate;
 assert.equal(a.values.deviationBpm,5);assert.equal(a.values.robustZ,null);
 days[0].groups.heartRate.preservedFields={restingBpm:{capturedAt:date(1)+'T12:00:00.000Z'}};
 assert.equal(run({health:{days}}).restingHeartRate.status,'insufficient');
});
function entry(id='one', overrides={}){return {type:'workout',watchId:id,date:today,exId:'curl',sets:2,load:20,pain:0,watch:{analyticsVersion:1,setsDone:2,loads:[20,25],actualReps:[10,5],strengthEligible:[true,true],painScore:0,elapsedSec:600,sessionRpe:5,sessionScope:'exercise',plan:{revision:'a',week:1,plannedSets:2,exerciseType:'reps',unit:'lb',perLeg:false,primaryMuscle:'biceps',scheduled:[{exerciseId:'curl',plannedSets:2}]}},...overrides};}
test('actual volume and eligible estimates preserve load units and dedupe native retries',()=>{
 const e=entry();const a=run({entries:[e,e]}).strength;
 assert.equal(a.values.volume[0].loadReps,325);assert.equal(a.values.weeklySets[0].sets,2);
 assert.ok(Math.abs(a.values.estimatedMaxes[0].estimatedLb-25*(1+5/30))<1e-8);
 e.watch.actualReps=[null,null];assert.equal(run({entries:[e]}).strength.values.volume.length,0);
 e.watch.actualReps=[10,5];e.pain=2;e.watch.painScore=2;
 assert.equal(run({entries:[e]}).strength.values.estimatedMaxes.length,0);
});
test('historical adherence uses saved schedule and counts extras separately',()=>{
 const e=entry();e.sets=3;e.watch.setsDone=3;
 const a=run({entries:[e]}).adherence;
 assert.equal(a.values.percent,100);assert.equal(a.values.extraSets,1);
 delete e.watch.plan;assert.equal(run({entries:[e]}).adherence.status,'unavailable');
});
test('effort uses full elapsed time; manual daily entry overrides watch and unknown day breaks history',()=>{
 const days=Array.from({length:42},(_,i)=>({date:date(i),restDay:true,deleted:false}));
 days[0]={date:today,effort:4,sessionMinutes:30,deleted:false};
 const a=run({entries:[entry()],journal:{days}}).effort;
 assert.equal(a.values.latestLoad,120);assert.equal(a.values.days,42);assert.ok(Math.abs(a.values.load7-120/7)<1e-8);
 days.splice(1,1);assert.equal(run({entries:[entry()],journal:{days}}).effort.status,'insufficient');
 const legacy={...entry(),watch:undefined,workSec:600};
 assert.equal(run({entries:[legacy]}).effort.values.latestLoad,null);
});
test('nutrition rejects partial intake and needs several weeks of independent weight days',()=>{
 const records=Array.from({length:28},(_,i)=>weight(i,180));
 const days=Array.from({length:28},(_,i)=>({date:date(i),caloriesKcal:2200,deleted:false}));
 const a=run({weights:{records},journal:{days}}).nutrition;
 assert.equal(a.status,'ok');assert.equal(a.values.estimatedKcal,2200);
 assert.equal(run({weights:{records},journal:{days:days.slice(0,10)}}).nutrition.status,'insufficient');
});
test('habit associations pair prior-day tags to next-day sleep and disclose group coverage',()=>{
 const days=Array.from({length:20},(_,i)=>({date:date(i+1),habit:i%2===0,habitLabel:'Late caffeine',deleted:false}));
 const healthDays=Array.from({length:20},(_,i)=>health(i,i%2===0?420:480));
 const a=run({journal:{days},health:{days:healthDays},settings:{habitLabel:'Late caffeine'}}).associations;
 assert.equal(a.values.nextSleepDifferenceMinutes,-60);assert.equal(a.values.taggedN,10);assert.equal(a.values.untaggedN,10);
});

test('unknown pain and incomparable setup do not become a single strength estimate',()=>{
 const a=entry('one'),b=entry('two');b.watch=structuredClone(b.watch);b.watch.plan.revision='different-machine';
 const result=run({entries:[a,b]}).strength;assert.equal(result.values.records.length,2);
 a.watch.painScore=null;assert.equal(run({entries:[a]}).strength.values.estimatedMaxes.length,0);
 a.watch.plan.unit='bodyweight';assert.equal(run({entries:[a]}).strength.values.volume.length,0);
});

test('incomplete watch blocks are not a complete daily effort and rest cannot erase known training',()=>{
 const known=entry(),legacy=entry('legacy',{watch:undefined});
 assert.equal(run({entries:[known,legacy]}).effort.values.latestLoad,null);
 assert.equal(run({entries:[legacy],journal:{days:[{date:today,restDay:true}]}}).effort.values.latestLoad,null);
 assert.equal(run({entries:[known,legacy],journal:{days:[{date:today,effort:3,sessionMinutes:20}]}}).effort.values.latestLoad,60);
});

test('sensor timestamps are interpreted in watch local time and stale capture is not a new day',()=>{
 const days=Array.from({length:15},(_,i)=>health(i));
 days[0].timezoneOffsetMinutes=420;days[0].groups.heartRate.capturedAt=today+'T01:00:00.000Z';
 assert.equal(run({health:{days}}).restingHeartRate.status,'insufficient');
 days[0].groups.heartRate.capturedAt='2026-09-22T01:00:00.000Z';
 assert.equal(run({health:{days}}).restingHeartRate.status,'ok');
});

test('conflicting historical schedules remain unknown rather than choosing a convenient denominator',()=>{
 const a=entry('one'),b=entry('two');b.watch=structuredClone(b.watch);b.watch.plan.scheduled=[{exerciseId:'curl',plannedSets:4}];
 const result=run({entries:[a,b]}).adherence;
 assert.equal(result.status,'unavailable');assert.equal(result.values.conflictingDays,1);
});

test('malformed nested schedules and huge imported set counts cannot crash or inflate totals',()=>{
 const bad=entry();bad.watch.plan.scheduled=[null];bad.sets=Number.MAX_SAFE_INTEGER;
 const result=run({entries:[bad]});
 assert.equal(result.adherence.status,'unavailable');assert.equal(result.strength.values.records.length,0);
 assert.equal(result.strength.values.weeklySets[0].sets,0);
 bad.sets=100;bad.watch.loads=[20];bad.watch.actualReps=[5];
 assert.equal(run({entries:[bad]}).strength.values.actualRepSets,1);
 bad.watch.plan.scheduled=[{exerciseId:'curl',plannedSets:2},{exerciseId:'curl',plannedSets:2}];
 assert.equal(run({entries:[bad]}).adherence.status,'unavailable');
});

test('strength retains date-level best estimates and weekly exercise counts alongside muscle counts',()=>{
 const older=entry('older',{date:date(1)}),newer=entry('newer');newer.watch=structuredClone(newer.watch);newer.watch.loads=[25,30];
 const a=run({entries:[newer,older]}).strength.values;
 assert.equal(a.estimatedHistory.length,2);assert.equal(a.estimatedHistory[0].date,date(1));
 assert.ok(a.estimatedHistory[1].estimatedLb>a.estimatedHistory[0].estimatedLb);
 assert.equal(a.weeklyExerciseSets[0].exerciseId,'curl');assert.equal(a.weeklyExerciseSets[0].sets,4);
});

test('habit renaming cannot relabel history and unlabeled legacy rows stay excluded',()=>{
 const days=Array.from({length:20},(_,i)=>({date:date(i+1),habit:i%2===0,habitLabel:'Late caffeine'}));
 const hd=Array.from({length:20},(_,i)=>health(i));
 assert.equal(run({journal:{days},health:{days:hd},settings:{habitLabel:'Alcohol'}}).associations.samples,0);
 days.forEach(row=>delete row.habitLabel);
 assert.equal(run({journal:{days},health:{days:hd},settings:{habitLabel:'Late caffeine'}}).associations.samples,0);
});
