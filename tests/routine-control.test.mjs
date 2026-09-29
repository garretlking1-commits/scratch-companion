import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(){
  const calls=[];
  const program={schema:1,revision:'seed',exercises:[{id:'leg-press',sets:3,reps:12,restSec:120},{id:'zone2-bike',durationMin:20}],
    sessions:{0:[],1:['leg-press'],2:['zone2-bike'],3:[],4:['leg-press'],5:[],6:[]}};
  const context={Date,Number,Array,Set,JSON,Error,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary')};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../routine-control.js',import.meta.url),'utf8'),context);
  const fetch=async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return {ok:true,status:200,json:async()=>({sha:'old',content:Buffer.from(JSON.stringify(program)).toString('base64')})};
    return {ok:true,status:200,json:async()=>({content:{sha:'new'}})};
  };
  return {program,calls,api:context.ScratchRoutineControl,fetch};
}

test('phone routine editor reads private file and saves only a selected weekday with the existing catalog',async()=>{
  const {api,calls,fetch}=setup(),control=api.create({fetch,getToken:()=> ' fixture '});
  await control.load();
  await control.save(2,['zone2-bike','leg-press']);
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/program-current\.json\?ref=main$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer fixture');
  const body=JSON.parse(calls[1].options.body);
  assert.equal(body.branch,'main');assert.equal(body.sha,'old');
  const saved=JSON.parse(Buffer.from(body.content,'base64').toString());
  assert.equal(saved.sessions[2].length,2);
  assert.deepEqual(saved.exercises.map(ex=>ex.id),['leg-press','zone2-bike']);
  assert.match(saved.revision,/^phone-/);
});

test('invalid edits and missing token never PUT a routine',async()=>{
  const {api,calls,fetch}=setup();
  const control=api.create({fetch,getToken:()=> 'fixture'});await control.load();
  await assert.rejects(control.save(1,['unknown']));
  await assert.rejects(control.save(1,['leg-press','leg-press']));
  assert.equal(calls.length,1);
  await assert.rejects(api.create({fetch,getToken:()=>''}).load(),/token/);
  assert.equal(calls.length,1);
});

test('GitHub conflict does not overwrite another routine update',async()=>{
  const {api,calls,fetch}=setup();
  const control=api.create({fetch:async(url,options)=>options.method==='PUT'?{ok:false,status:409}:fetch(url,options),getToken:()=> 'fixture'});
  await control.load();await assert.rejects(control.save(1,[]),/changed elsewhere/);
  assert.equal(calls.length,1);
});
