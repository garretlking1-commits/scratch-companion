import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function page(healthReader) {
  const elements = new Map();
  function element() {
    return {value:'',hidden:false,textContent:'',children:[],listeners:{},dataset:{},
      addEventListener(type,fn){this.listeners[type]=fn;},
      appendChild(child){this.children.push(child);return child;},
      replaceChildren(...children){this.children=children;},
      setAttribute(){},focus(){},scrollIntoView(){},
      emit(type){return this.listeners[type]?.({preventDefault(){}});}};
  }
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,createElementNS:element};
  const records=[],calls=[];
  const tracker={snapshot:()=>({data:{schema:1,records,updatedAt:null},status:'local',dirty:false}),
    save(input){calls.push(['save',input]);},remove(id){calls.push(['remove',id]);},sync:async()=>{calls.push(['sync']);}};
  const ctx={document,Date,Intl,Math,Number,String,Promise,Error,localStorage:{},fetch:async()=>{},ScratchWeightSync:{createTracker:()=>tracker}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../weights.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(new URL('../dashboard.js',import.meta.url),'utf8'),ctx);
  const api=ctx.ScratchDashboard.init({document,tracker,healthReader,getEntries:()=>[],getToken:()=>'',syncWorkouts:async()=>{calls.push(['workouts']);},getWorkoutStatus:()=>({status:'local'})});
  return {api,records,calls,tracker,get:id=>document.getElementById(id)};
}

test('weight form defaults to pounds and submits the selected date and unit',async()=>{
  const p=page();assert.equal(p.get('weight-unit').value,'lb');
  p.get('weight-date').value='2026-09-20';p.get('weight-value').value='180.5';
  await p.get('weight-form').emit('submit');
  assert.equal(p.calls[0][0],'save');assert.equal(p.calls[0][1].unit,'lb');assert.equal(p.calls[0][1].date,'2026-09-20');
  assert.equal(p.calls[0][1].value,'180.5');
});

test('editing preserves identity and deletion requires confirmation; cancel does not remove',async()=>{
  const p=page();p.records.push({id:'a',date:'2026-09-20',inputValue:80,inputUnit:'kg',weightLb:176.36981,updatedAt:'2026-09-20T12:00:00.000Z',deleted:false});
  p.api.edit('a');assert.equal(p.get('weight-unit').value,'kg');assert.equal(p.get('weight-value').value,'80');
  p.get('weight-value').value='81';await p.get('weight-form').emit('submit');assert.equal(p.calls[0][1].id,'a');
  p.api.requestDelete('a');assert.equal(p.calls.filter(c=>c[0]==='remove').length,0);
  p.get('delete-cancel').emit('click');assert.equal(p.calls.filter(c=>c[0]==='remove').length,0);
  p.api.requestDelete('a');await p.get('delete-confirm').emit('click');assert.deepEqual(p.calls.find(c=>c[0]==='remove'),['remove','a']);
});

test('empty dashboard shows missing readings and independent weight/workout statuses',()=>{
  const p=page();assert.equal(p.get('latest-weight').textContent,'No weigh-ins');
  assert.match(p.get('weight-status').textContent,/phone|GitHub/i);
  assert.match(p.get('workout-status').textContent,/GitHub|sync/i);
  assert.match(p.get('weight-chart-empty').textContent,/weigh-in/i);
});

test('history retains the exact entered two-decimal reading while summaries round',()=>{
  const p=page();p.records.push({id:'precise',date:'2026-09-20',inputValue:181.25,inputUnit:'lb',weightLb:181.25,updatedAt:'2026-09-20T12:00:00.000Z',deleted:false});
  p.api.refresh();
  assert.equal(p.get('weight-history-body').children[0].children[1].textContent,'181.25 lb');
  assert.equal(p.get('latest-weight').textContent,'181.3 lb');
});

test('dashboard sync requests both independent data sources and re-enables refresh',async()=>{
  const p=page();await p.get('dashboard-sync').emit('click');
  assert.ok(p.calls.some(c=>c[0]==='workouts'));assert.ok(p.calls.some(c=>c[0]==='sync'));
  assert.equal(p.get('dashboard-sync').disabled,false);
});

test('health sync failure does not block weight or workout refresh',async()=>{
  let attempts=0;
  const p=page({sync:async()=>{attempts++;throw Error('health unavailable');}});
  await p.api.syncAll();
  assert.equal(attempts,1);assert.ok(p.calls.some(c=>c[0]==='workouts'));assert.ok(p.calls.some(c=>c[0]==='sync'));
  assert.equal(p.get('dashboard-sync').disabled,false);
});

test('failed local save keeps entered values and displays the failure',async()=>{
  const p=page();p.tracker.save=()=>{throw Error('Phone storage is full.');};
  p.get('weight-value').value='181.25';p.get('weight-date').value='2026-09-20';
  await p.get('weight-form').emit('submit');
  assert.equal(p.get('weight-value').value,'181.25');assert.equal(p.get('weight-date').value,'2026-09-20');
  assert.match(p.get('weight-message').textContent,/storage is full/);assert.equal(p.calls.length,0);
});
