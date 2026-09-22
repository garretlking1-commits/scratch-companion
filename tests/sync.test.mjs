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
    hashEnd = html.indexOf("  // ---------- boot ----------", hashStart);
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
  assert.match(html, /Dashboard 1\.4\.0/);
  assert.match(worker, /scratch-v6-dashboard-1\.4\.0/);
});
