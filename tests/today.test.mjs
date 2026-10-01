import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function setup(storage){const c={Date,JSON,Number,Error};vm.createContext(c);const f=new URL('../today.js',import.meta.url);if(fs.existsSync(f))vm.runInContext(fs.readFileSync(f,'utf8'),c,{filename:fileURLToPath(f)});return c.ScratchToday?.createStore({storage,now:()=>1000});}
function memory(){const values={};return {values,getItem:k=>values[k]??null,setItem:(k,v)=>{values[k]=v;}};}
test('today requires a chosen action; restart retains it and never creates workout evidence',()=>{
 const s=setup(memory());assert.ok(s,'Today store exists');assert.throws(()=>s.change('2026-09-30','start'),/action/i);
 s.plan('2026-09-30','Open assignment','Read first line');s.change('2026-09-30','start');assert.equal(s.get('2026-09-30').state,'started');
 s.change('2026-09-30','minimum');assert.equal(s.get('2026-09-30').state,'minimum');s.change('2026-09-30','reset');assert.equal(s.get('2026-09-30').action,'Open assignment');assert.equal(s.get('2026-09-30').state,'ready');assert.equal(s.get('2026-10-01').action,'');
});
test('save failure and corrupt data do not claim success or overwrite recovery bytes',()=>{
 const m=memory(),s=setup(m);assert.ok(s);m.setItem=()=>{throw Error('quota');};assert.throws(()=>s.plan('2026-09-30','A','B'),/save/i);
 const broken={getItem:()=>'{broken',setItem:()=>assert.fail('must not overwrite')};assert.throws(()=>setup(broken).plan('2026-09-30','A','B'),/stored|read/i);
});
test('two tabs preserve other dates and timed starts survive reopening',()=>{
 const m=memory(),a=setup(m),b=setup(m);assert.ok(a);a.plan('2026-09-30','A','B');b.plan('2026-10-01','C','D');a.change('2026-09-30','start');assert.equal(b.get('2026-09-30').until,601000);assert.equal(a.get('2026-10-01').action,'C');
});
test('rest cancels timer, user-reported completion stays separate and invalid input rejects',()=>{
 const s=setup(memory());assert.ok(s);s.plan('2026-09-30','A','B');s.change('2026-09-30','start');s.change('2026-09-30','rest');assert.equal(s.get('2026-09-30').until,null);s.change('2026-09-30','done');assert.equal(s.get('2026-09-30').state,'done');assert.throws(()=>s.plan('not-a-date','x','y'));assert.throws(()=>s.plan('2026-09-30','x'.repeat(201),'y'));
});

function ui(storage=memory()){
 const els=new Map(),events={},listeners={},state={now:Date.parse('2026-09-30T12:00:00Z'),changes:0};
 function element(){return {value:'',textContent:'',open:false,hidden:false,listeners:{},addEventListener(k,f){this.listeners[k]=f;},querySelector(){return this.summary||(this.summary=element());}};}
 const doc={hidden:false,getElementById(id){if(!els.has(id))els.set(id,element());return els.get(id);},addEventListener:(k,f)=>events[k]=f};
 const ctx={Date,JSON,Number,Error,setInterval:f=>{state.tick=f;return 1;},clearInterval:()=>{state.stopped=true;},addEventListener:(k,f)=>listeners[k]=f};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../today.js',import.meta.url),'utf8'),ctx,{filename:fileURLToPath(new URL('../today.js',import.meta.url))});
 const api=ctx.ScratchToday.init({document:doc,storage,now:()=>state.now,onChange:()=>state.changes++});
 return {state,doc,api,events,listeners,$:id=>doc.getElementById(id),click:id=>doc.getElementById(id).listeners.click(),submit:()=>doc.getElementById('today-form').listeners.submit({preventDefault(){}})};
}
test('Today controls keep typed edits through timer refresh and render saved feedback',()=>{
 const p=ui();assert.equal(p.$('today-editor').open,true);p.submit();assert.match(p.$('today-message').textContent,/Write one/);p.click('today-start');assert.match(p.$('today-message').textContent,/Choose/);
 p.$('today-input').value='Read first question';p.$('today-fallback').value='Open document';p.submit();assert.match(p.$('today-action').textContent,/Read first/);
 p.click('today-small');p.click('today-start');p.$('today-editor').querySelector('summary').listeners.click();p.$('today-editor').open=true;p.$('today-input').value='Unsaved draft';p.state.now+=1000;p.state.tick();assert.equal(p.$('today-input').value,'Unsaved draft');
 p.state.now+=600000;p.state.tick();assert.match(p.$('today-timer').textContent,/Ten minutes are up/);
 p.click('today-minimum');assert.match(p.$('today-state').textContent,/Small step complete/);p.click('today-done');assert.match(p.$('today-state').textContent,/reported by you/);p.click('today-rest');assert.match(p.$('today-state').textContent,/Rest chosen/);p.click('today-reset');assert.match(p.$('today-state').textContent,/Ready/);
 p.listeners.storage({key:'scratch-today-v1'});p.events.visibilitychange();assert.ok(p.state.changes>0);
 p.doc.hidden=true;p.state.tick();p.doc.hidden=false;p.state.now+=86400000;p.state.tick();assert.equal(p.$('today-action').textContent,'What is one small next step?');p.api.stop();assert.equal(p.state.stopped,true);
});
test('Today storage denial remains visible without erasing typed input',()=>{
 const m=memory(),p=ui(m);p.$('today-input').value='Keep this draft';m.setItem=()=>{throw Error('denied')};p.submit();assert.match(p.$('today-message').textContent,/Could not save/);assert.equal(p.$('today-input').value,'Keep this draft');
 m.getItem=()=>'{broken';p.api.render();assert.match(p.$('today-message').textContent,/Cannot read/);p.$('today-editor').open=false;p.$('today-editor').querySelector('summary').listeners.click();assert.match(p.$('today-message').textContent,/Cannot read/);p.state.tick();
});
