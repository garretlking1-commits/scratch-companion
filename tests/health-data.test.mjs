import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const timestamp='2026-09-21T12:00:00.000Z';
function fixture() {
  const groups={};
  for(const key of ['activity','heartRate','sleep','oxygen','stress','pai','training']) groups[key]={status:'unavailable',capturedAt:timestamp,value:null,reason:'Not available'};
  groups.activity={status:'ok',capturedAt:timestamp,value:{steps:0,standingHours:2,caloriesKcal:150}};
  return {schema:1,updatedAt:timestamp,days:[{date:'2026-09-21',capturedAt:timestamp,timezoneOffsetMinutes:420,source:'scratch-1.0.20',groups}]};
}
function setup({fetch,storage,token='test-token',timeoutMs=100}={}) {
  const saved=new Map(),calls=[];
  const context={Date,JSON,Number,Set,Promise,Error,SyntaxError,AbortController,setTimeout,clearTimeout};vm.createContext(context);
  for(const file of ['health-schema.js','health-data.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
  const reader=context.ScratchHealthData.createReader({storage:storage||{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
    getToken:()=>token,timeoutMs,fetch:async(...args)=>{calls.push(args);return fetch ? fetch(...args) : {ok:true,status:200,text:async()=>JSON.stringify(fixture())};}});
  return {reader,calls,saved,validate:context.ScratchHealthSchema.validateHealth};
}
test('reads the fixed private file with GET only and preserves real zero counters',async()=>{
  const {reader,calls,saved}=setup();await reader.sync();const state=reader.snapshot();
  assert.equal(state.status,'synced');assert.equal(state.data.days[0].groups.activity.value.steps,0);
  assert.match(calls[0][0],/hq-vault\/contents\/projects\/zepp-bip6\/data\/watch-health.json\?ref=main$/);
  assert.equal(calls[0][1].method,'GET');assert.equal(saved.size,1);
  assert.doesNotMatch([...saved.values()][0],/test-token/);
});
test('no token makes no request; unavailable file does not create anything',async()=>{
  const local=setup({token:''});await local.reader.sync();assert.equal(local.calls.length,0);
  const missing=setup({fetch:async()=>({ok:false,status:404})});await missing.reader.sync();assert.equal(missing.reader.snapshot().status,'missing');assert.equal(missing.saved.size,0);
});
test('invalid downloaded values retain last good data and fetch time',async()=>{
  let bad=false;const p=setup({fetch:async()=>({ok:true,status:200,text:async()=>{const data=fixture();if(bad)data.days[0].groups.activity.value.steps=-1;return JSON.stringify(data);}})});
  await p.reader.sync();const before=p.reader.snapshot();bad=true;await p.reader.sync();
  assert.equal(p.reader.snapshot().status,'error');assert.equal(p.reader.snapshot().lastSync,before.lastSync);assert.equal(p.reader.snapshot().data.days[0].groups.activity.value.steps,0);
});
test('body read deadline and duplicate sync calls are bounded and share one request',async()=>{
  const p=setup({timeoutMs:10,fetch:async()=>({ok:true,status:200,text:()=>new Promise(()=>{})})});
  const first=p.reader.sync(),second=p.reader.sync();assert.equal(first,second);await first;
  assert.equal(p.calls.length,1);assert.equal(p.reader.snapshot().status,'error');assert.match(p.reader.snapshot().error,/timed out/);
});
test('quota errors and corrupted cached data are surfaced without replacing prior data',async()=>{
  const p=setup({storage:{getItem:()=>'{broken',setItem:()=>{throw Error('quota');}}});assert.equal(p.reader.snapshot().status,'error');
  await p.reader.sync();assert.equal(p.reader.snapshot().status,'error');assert.match(p.reader.snapshot().error,/storage/);assert.equal(p.reader.snapshot().data.days.length,0);
});
test('malformed date, duplicate day, invalid sensor arrays and source units are rejected',()=>{
  const p=setup();
  for(const mutate of [d=>d.days.push(d.days[0]),d=>d.days[0].date='2026-02-31',d=>d.days[0].groups.heartRate={status:'ok',capturedAt:timestamp,value:{todayBpm:[0]}},d=>d.days[0].groups.training={status:'ok',capturedAt:timestamp,value:{units:'hours'}}]) {const d=fixture();mutate(d);assert.throws(()=>p.validate(d));}
});
test('failed later attempt retains original capture time, and caller cannot mutate cache',async()=>{
  const d=fixture();d.days[0].groups.activity.latestAttempt={status:'error',capturedAt:'2026-09-21T14:00:00.000Z',reason:'Unavailable'};
  const p=setup({fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify(d)})});await p.reader.sync();const state=p.reader.snapshot();state.data.days.length=0;
  assert.equal(p.reader.snapshot().data.days[0].groups.activity.capturedAt,timestamp);
});
