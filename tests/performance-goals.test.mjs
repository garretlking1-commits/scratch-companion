import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = {Number,Array};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../performance-goals.js',import.meta.url),'utf8'),context);
const progress = context.ScratchPerformanceGoals.progress;

test('strength goal uses actual set reps and load, ignoring incomplete records',()=>{
  const entries=[
    {type:'workout',date:'2026-09-20',exId:'leg-press',watch:{loads:[100,120],actualReps:[8,6]}},
    {type:'workout',date:'2026-09-22',exId:'leg-press',watch:{loads:[125],actualReps:[8],partial:true}},
    {type:'workout',date:'2026-09-24',exId:'leg-press',watch:{loads:[110],actualReps:[9]}}
  ];
  const result=progress(entries,{kind:'strength',exerciseId:'leg-press',target:200,reps:8});
  assert.equal(result.best,110);assert.equal(result.percent,55);assert.equal(result.bestDate,'2026-09-24');
});

test('bike goal converts km to miles and does not mistake missing distance for zero',()=>{
  const entries=[
    {type:'workout',date:'2026-09-20',exId:'zone2-bike',watch:{bikeDistance:8.04672,bikeDistanceUnit:'km'}},
    {type:'workout',date:'2026-09-21',exId:'zone2-bike',watch:{}}
  ];
  const result=progress(entries,{kind:'bike-distance',target:5});
  assert.equal(result.best,5);assert.equal(result.reached,true);
  assert.equal(progress(entries.slice(1),{kind:'bike-distance',target:5}).best,null);
});

test('baseline lists actual completed strength sets and a reported bike distance',()=>{
  const values=context.ScratchPerformanceGoals.baselines([
    {type:'workout',date:'2026-09-20',exId:'leg-press',watch:{loads:[100,120],actualReps:[8,null]}},
    {type:'workout',date:'2026-09-21',exId:'zone2-bike',watch:{bikeDistance:4,bikeDistanceUnit:'mi'}}
  ]);
  assert.equal(values.strength[0].load,100);
  assert.equal(values.strength[0].reps,8);
  assert.equal(values.bike.miles,4);
});
