import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = {Date, Array, Number, Set};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../accountability.js', import.meta.url), 'utf8'), context);
const weekly = context.ScratchAccountability.week;

test('shows Monday week, counts completed dates once, and marks only elapsed planned days missed', () => {
  const entries = [
    {type:'workout',date:'2026-09-28',exId:'leg-press',sets:2},
    {type:'workout',date:'2026-09-28',exId:'calf-raise',sets:3},
    {type:'workout',date:'2026-09-29',exId:'bike',workSec:1200,watch:{partial:true}}
  ];
  const result = weekly(entries,{trainingPlans:[{from:'2026-09-28',weekdays:[1,2,4]}]},'2026-09-30');
  assert.equal(result.start,'2026-09-28');
  assert.equal(result.completed,1);
  assert.equal(result.target,3);
  assert.deepEqual(Array.from(result.missed, day=>day.date),['2026-09-29']);
  assert.equal(result.days[3].status,'upcoming');
});

test('does not call past days missed before the plan was saved', () => {
  const result = weekly([],{trainingPlans:[{from:'2026-09-30',weekdays:[1,2,4]}]},'2026-09-30');
  assert.equal(result.missed.length,0);
  assert.equal(result.days[0].planned,false);
  assert.equal(result.days[1].planned,false);
  assert.equal(result.target,1);
});

test('ignores test entries and incomplete records', () => {
  const result = weekly([
    {type:'workout',date:'2026-09-29',exId:'test-5s',sets:1},
    {type:'workout',date:'2026-09-29',exId:'bike',partial:true,sets:1},
    {type:'workout',date:'2026-09-29',exId:'bike',sets:0,workSec:0}
  ],{trainingPlans:[{from:'2026-09-29',weekdays:[2]}]},'2026-09-30');
  assert.equal(result.completed,0);
  assert.equal(result.missed.length,1);
});

test('changing the plan keeps earlier missed days',()=>{
  const result=weekly([],{trainingPlans:[
    {from:'2026-09-28',weekdays:[1,2]},
    {from:'2026-09-30',weekdays:[4]}
  ]},'2026-10-01');
  assert.deepEqual(Array.from(result.missed,day=>day.date),['2026-09-28','2026-09-29']);
  assert.equal(result.target,3);
});
