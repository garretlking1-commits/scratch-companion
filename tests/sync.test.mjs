import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
function app(
  entries = [],
  fetcher = async () => {
    throw Error("unexpected network");
  },
) {
  const state = { entries, notes: [], updated: "now" };
  const ctx = {
    state,
    AbortController,setTimeout,clearTimeout,
    storageError: "",
    refreshLocal: () => {},
    fetch: fetcher,
    GH_API:
      "https://api.github.com/repos/example/private/contents/companion-log.json",
    GH_BRANCH: "main",
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    getToken: () => "test-token",
    localStorage: { setItem: () => {} },
    LS_SYNC: "test",
    renderSaveState: () => {},
    renderAll: () => {},
    showMsg: () => {},
    saveLocal: () => {},
    $: () => ({}),
  };
  const start = html.indexOf("  function entryKey("),
    end = html.indexOf("  // Save locally, re-render");
  vm.runInNewContext(html.slice(start, end), ctx, {
    filename: "companion-sync-extracted.js",
  });
  return ctx;
}
const qr = {
  type: "workout",
  date: "2026-09-21",
  exId: "wall-sit",
  sets: 5,
  load: 0,
  hrAvg: 100,
  hrDelta: null,
  pain: 0,
  sleep: null,
  workSec: 225,
  tod: 600,
};
const native = (id, tod = 600) => ({
  ...qr,
  tod,
  watchId: id,
  watch: { exerciseId: "wall-sit", hrMin: 80, partial: true },
});
test("QR-first merge upgrades one record then retains distinct native repeats and richer data", () => {
  const a = app([{ ...qr, localDetail: "keep" }]);
  a.mergeEntries([native("one"), native("two")]);
  assert.equal(a.state.entries.length, 2);
  assert.equal(a.state.entries[0].watchId, "one");
  assert.equal(a.state.entries[0].localDetail, "keep");
  assert.equal(a.state.entries[0].watch.hrMin, 80);
  a.mergeEntries([native("one"), native("two")]);
  assert.equal(a.state.entries.length, 2);
});
test("native-first QR scans do not add duplicates; different time and sets survive", () => {
  const a = app([native("one"), native("two")]);
  a.mergeEntries([qr]);
  assert.equal(a.state.entries.length, 2);
  assert.equal(a.state.entries[0].watchId, "one");
  a.mergeEntries([
    { ...qr, tod: 700 },
    { ...qr, sets: 6 },
  ]);
  assert.equal(a.state.entries.length, 4);
});
test("daily sleep stays single and gains raw watch details; distinct same-time notes survive", () => {
  const a = app([{ type: "sleep", date: "2026-09-21", score: 80 }]);
  a.mergeEntries([
    {
      type: "sleep",
      date: "2026-09-21",
      score: 80,
      watchId: "sleep",
      watch: { deepMin: 40 },
    },
  ]);
  assert.equal(a.state.entries.length, 1);
  assert.equal(a.state.entries[0].watch.deepMin, 40);
  a.state.notes = [{ ts: "now", text: "A", done: true, local: "keep" }];
  a.mergeNotes([
    { ts: "now", text: "A", done: false, remote: "keep" },
    { ts: "now", text: "B", done: false },
  ]);
  assert.equal(a.state.notes.length, 2);
  assert.equal(a.state.notes[0].done, true);
  assert.equal(a.state.notes[0].local, "keep");
  assert.equal(a.state.notes[0].remote, "keep");
});
test("actual sync and SHA conflict retry never PUT a payload missing native repeats", async () => {
  const writes = [];
  let gets = 0;
  const a = app([qr], async (url, options) => {
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      writes.push(JSON.parse(Buffer.from(body.content, "base64").toString()));
      return { ok: writes.length > 1, status: writes.length === 1 ? 409 : 200 };
    }
    gets++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sha: "sha" + gets,
        content: Buffer.from(
          JSON.stringify({
            entries: [
              native("one"),
              native("two"),
              ...(gets > 1 ? [native("three", 700)] : []),
            ],
            notes: [{ ts: "a", text: "retain", done: true }],
            updated: "now",
          }),
        ).toString("base64"),
      }),
    };
  });
  // Force a write so the conflict path runs rather than sameData skipping it.
  a.state.notes.push({ ts: "local", text: "local request", done: false });
  await a.syncNow(false);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].entries.length, 2);
  assert.equal(writes[1].entries.length, 3);
  assert.equal(writes[1].notes.length, 2);
  assert.equal(
    writes[1].entries.every((e) => e.watchId && e.watch),
    true,
  );
});
test("malformed remote file cannot be replaced with a local-only payload", async () => {
  let puts = 0;
  const a = app([qr], async (url, options) => {
    if (options.method === "PUT") {
      puts++;
      return { ok: true, status: 200 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sha: "bad",
        content: Buffer.from("{}").toString("base64"),
      }),
    };
  });
  await a.syncNow(false);
  assert.equal(puts, 0);
});
test("paste and URL QR import both detect existing native records without duplicating them", () => {
  const a = app([native("one")]);
  const elements = {};
  let saves = 0;
  a.$ = (id) => elements[id] || (elements[id] = { value: "payload" });
  a.parsePaste = () => ({ entries: [qr], pages: ["1"], errors: [] });
  a.location = { hash: "#SCRATCH1|p1/1|test", pathname: "/", search: "" };
  a.history = { replaceState: () => {} };
  a.persist = () => {
    saves++;
  };
  a.pending = [];
  const parseStart = html.indexOf("  function parseNow()"),
    parseEnd = html.indexOf('  $("parsebtn").addEventListener', parseStart);
  const hashStart = html.indexOf("  function importFromHash()"),
    hashEnd = html.indexOf("  function backupPayload()", hashStart);
  vm.runInNewContext(
    html.slice(parseStart, parseEnd) + html.slice(hashStart, hashEnd),
    a,
  );
  a.parseNow();
  assert.equal(a.pending.length, 0);
  assert.equal(elements.savebtn.hidden, true);
  a.importFromHash();
  assert.equal(saves, 0);
  assert.equal(a.state.entries.length, 1);
  a.parsePaste = () => ({
    entries: [
      { ...qr, tod: 700 },
      { ...qr, tod: 700 },
    ],
    pages: ["1"],
    errors: [],
  });
  a.parseNow();
  assert.equal(a.pending.length, 1);
  a.importFromHash();
  assert.equal(saves, 1);
  assert.equal(a.state.entries.length, 2);
});
test("complete inline app and worker parse; refreshed copy has a visible version", () => {
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const worker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  new vm.Script(worker);
  assert.match(html, /Dashboard 1\.8\.0/);
  assert.match(worker, /scratch-v\d+-dashboard-1\.[78]\.0/);
});

test('remote HTML numeric fields and invalid dates are rejected before import', async () => {
  for (const entry of [{...qr,sets:'<img src=x onerror=alert(1)>'},{...qr,date:'2026-02-31'},{type:'sleep',date:'2026-09-21',score:'<svg/onload=alert(1)>'}]) {
    const a=app([], async()=>({ok:true,status:200,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify({entries:[entry],notes:[]})).toString('base64')})}));
    await assert.rejects(a.ghFetchRemote('fixture'));
    assert.equal(a.state.entries.length,0);
  }
});

test('older partial revision cannot replace a completed native workout',()=>{
  const a=app([{...native('stable'),sets:5,watch:{partial:false,revision:3}}]);
  a.mergeEntries([{...native('stable'),sets:2,watch:{partial:true,revision:1}}]);
  assert.equal(a.state.entries[0].sets,5);
  assert.equal(a.state.entries[0].watch.partial,false);
});

test('edits made while PUT is pending remain explicitly unsynced',async()=>{
  let finish,started;
  const waiting=new Promise(resolve=>started=resolve);
  const a=app([qr],async(url,options)=>{
    if(options.method==='PUT'){started();await new Promise(resolve=>finish=resolve);return {ok:true,status:200};}
    return {ok:true,status:200,json:async()=>({sha:'sha',content:Buffer.from(JSON.stringify({entries:[],notes:[]})).toString('base64')})};
  });
  const syncing=a.syncNow(false);await waiting;
  a.state.notes.push({ts:'later',text:'preserve this edit',done:false});
  finish();await syncing;
  assert.equal(a.syncStatus,'local');
  assert.equal(a.syncing,false);
});

function withStorage(a,raw){
  const values=new Map(raw===undefined?[]:[['state',raw]]);
  a.LS_STATE='state';a.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const start=html.indexOf('  // ---------- local persistence ----------'),end=html.indexOf('  function entryKey(',start);
  vm.runInNewContext(html.slice(start,end),a);
  return values;
}

test('corrupt storage is preserved and blocks saves, but recovery after repair works',()=>{
  const a=app();const values=withStorage(a,'{broken');
  a.loadState();assert.match(a.storageError,/preserved/);
  assert.throws(()=>a.saveLocal());assert.equal(values.get('state'),'{broken');
  values.set('state',JSON.stringify({entries:[qr],notes:[]}));
  a.saveLocal();assert.equal(a.state.entries.length,1);assert.equal(a.storageError,'');
});

test('save merges another tab before writing and retains new native completion',()=>{
  const a=app();const values=withStorage(a,JSON.stringify({entries:[{...native('same'),sets:2,watch:{partial:true}}],notes:[]}));
  a.loadState();
  a.mergeEntries([{...native('same'),sets:5,watch:{partial:false}}]);
  values.set('state',JSON.stringify({entries:[{...native('same'),sets:2,watch:{partial:true}}],notes:[{ts:'other',text:'another tab',done:false}]}));
  a.saveLocal();const saved=JSON.parse(values.get('state'));
  assert.equal(saved.entries[0].sets,5);assert.equal(saved.notes[0].text,'another tab');
});

test('local storage write failure is reported and does not claim success',()=>{
  const a=app([qr]);withStorage(a);
  a.localStorage.setItem=()=>{throw Error('quota');};
  assert.throws(()=>a.saveLocal());assert.equal(a.syncStatus,'fail');assert.match(a.storageError,/draft is still open/);
  assert.equal(a.state.entries.length,1);
});

test('legacy deadline rejects a stalled response body and aborts the request',async()=>{
  let signal;
  const a=app([],async(url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(()=>{})};});
  await assert.rejects(a.ghRequest('fixture',{},true,10));assert.equal(signal.aborted,true);
});

test('new remote sleep value is not replaced by the unchanged local cache during save',()=>{
  const a=app();const values=withStorage(a,JSON.stringify({entries:[{type:'sleep',date:qr.date,score:50}],notes:[]}));
  a.loadState();a.mergeEntries([{type:'sleep',date:qr.date,score:80}]);a.saveLocal();
  assert.equal(JSON.parse(values.get('state')).entries[0].score,80);
});

test('completed native revision with omitted partial flag replaces partial status permanently',()=>{
  const a=app([{...native('stable'),sets:2,watch:{partial:true}}]);
  a.mergeEntries([{...native('stable'),sets:5,watch:{sessionId:'run'}}]);
  assert.notEqual(a.state.entries[0].watch.partial,true);
  a.mergeEntries([{...native('stable'),sets:2,watch:{partial:true}}]);
  assert.equal(a.state.entries[0].sets,5);assert.notEqual(a.state.entries[0].watch.partial,true);
});

test('native session identity migrates a legacy watch ID without duplicating its record',()=>{
  const a=app([{...native('legacy'),watch:{sessionId:'run',partial:true},sets:2}]);
  a.mergeEntries([{...native('scratch-session:run'),watch:{sessionId:'run'},sets:5}]);
  assert.equal(a.state.entries.length,1);assert.equal(a.state.entries[0].watchId,'scratch-session:run');
  assert.equal(a.state.entries[0].sets,5);assert.notEqual(a.state.entries[0].watch.partial,true);
});

test('backup includes raw corrupt storage and open drafts but excludes saved credentials',()=>{
  const a=app([qr]);a.pending=[qr];
  const values=new Map([['scratch-state-v1','{broken'],['scratch-today-v1','today'],['scratch-gh-token','secret-fixture'],['scratch-secret','secret-fixture'],['unrelated','other']]);
  a.localStorage={length:values.size,key:index=>[...values.keys()][index],getItem:key=>values.get(key)};
  a.$=id=>({value:id==='notebox'?'unsaved note':'unsaved QR'});
  vm.runInNewContext(html.slice(html.indexOf('  function backupPayload()'),html.indexOf('  function downloadBackup()')),a);
  const backup=a.backupPayload();assert.equal(backup.storage['scratch-state-v1'],'{broken');
  assert.equal(backup.storage['scratch-today-v1'],'today');assert.equal(backup.noteDraft,'unsaved note');
  assert.equal(backup.openWorkoutState.entries.length,1);assert.doesNotMatch(JSON.stringify(backup),/secret-fixture|unrelated/);
});

test('disconnect removes only the saved credential and retains local records',()=>{
  const a=app([qr]);const values=new Map([['token','fixture'],['state','retain']]);
  a.LS_TOKEN='token';a.localStorage={removeItem:key=>values.delete(key),getItem:key=>values.get(key)};
  vm.runInNewContext(html.slice(html.indexOf('  function disconnectToken()'),html.indexOf('  if ($("backup-download"))')),a);
  a.disconnectToken();assert.equal(values.has('token'),false);assert.equal(values.get('state'),'retain');assert.equal(a.syncStatus,'local');
});

test('rendered HTML values escape markup and attribute delimiters',()=>{
  const a=app();assert.equal(a.escapeHTML('<img src="x" onerror=\'alert(1)\'>&'),'&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
});
