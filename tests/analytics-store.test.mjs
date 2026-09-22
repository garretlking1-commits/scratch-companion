import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const now = "2026-09-21T12:00:00.000Z";
function load(timers = {}) {
  const c = {
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    Error,
    AbortController,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    ...timers,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(c);
  if (fs.existsSync(new URL("../analytics-store.js", import.meta.url)))
    vm.runInContext(
      fs.readFileSync(
        new URL("../analytics-store.js", import.meta.url),
        "utf8",
      ),
      c,
      {
        filename: fileURLToPath(
          new URL("../analytics-store.js", import.meta.url),
        ),
      },
    );
  return c.ScratchAnalyticsStore || {};
}
function storage() {
  const values = {};
  return {
    values,
    getItem: (k) => values[k] ?? null,
    setItem: (k, v) => {
      values[k] = v;
    },
  };
}
function remote() {
  let data = null,
    puts = 0;
  return {
    get: () => data,
    set: (d) => {
      data = d;
    },
    puts: () => puts,
    fetch: async (url, o) => {
      assert.equal(
        url.split("?")[0],
        "https://api.github.com/repos/garretlking1-commits/hq-vault/contents/projects/zepp-bip6/data/analytics-journal.json",
      );
      assert.equal(o.cache, "no-store");
      assert.equal(o.headers.Authorization, "Bearer fixture");
      if (o.method === "PUT") {
        puts++;
        data = JSON.parse(
          Buffer.from(JSON.parse(o.body).content, "base64").toString(),
        );
        return { ok: true, status: 200 };
      }
      return data
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              sha: "s",
              content: Buffer.from(JSON.stringify(data)).toString("base64"),
            }),
          }
        : { ok: false, status: 404 };
    },
  };
}
const opts = (s, r) => ({
  storage: s,
  fetch: r.fetch,
  getToken: () => " fixture ",
  now: () => new Date(now),
});
test("defaults create no remote file; blank values stay null and invalid/rest-day values reject", async () => {
  const r = remote(),
    t = load().create(opts(storage(), r));
  await t.sync();
  assert.equal(r.puts(), 0);
  assert.equal(t.snapshot().data.settings.sleepTargetMinutes, 480);
  t.saveDay({
    date: "2026-09-21",
    caloriesKcal: "",
    effort: 0,
    sessionMinutes: 30,
    restDay: false,
  });
  assert.equal(t.snapshot().data.days[0].caloriesKcal, null);
  for (const row of [
    { date: "2026-02-30" },
    { date: "2026-09-22" },
    { date: "2026-09-21", restDay: true, effort: 3 },
    { date: "2026-09-21", energy: 0 },
    { date: "2026-09-21", sessionMinutes: 0 },
  ])
    assert.throws(() => t.saveDay(row));
  await t.sync();
  assert.equal(r.puts(), 1);
});
test("two tabs preserve days/settings, tombstones and newer intentional corrections", async () => {
  const s = storage(),
    r = remote(),
    a = load().create(opts(s, r)),
    b = load().create(opts(s, r));
  a.saveDay({ date: "2026-09-20", energy: 5 });
  b.saveDay({ date: "2026-09-21", habit: true });
  a.saveSettings({ habitLabel: "Evening walk" });
  b.removeDay("2026-09-20");
  await a.sync();
  assert.equal(r.get().days.length, 2);
  assert.equal(r.get().days[0].deleted, true);
  assert.equal(r.get().settings.habitLabel, "Evening walk");
  a.saveDay({ date: "2026-09-20", energy: 6 });
  await a.sync();
  assert.equal(r.get().days[0].deleted, false);
});
test("SHA conflict rereads and malformed remote never overwrites", async () => {
  const r = remote();
  let conflict = true;
  const t = load().create({
    ...opts(storage(), r),
    fetch: async (u, o) => {
      if (o.method === "PUT" && conflict) {
        conflict = false;
        const foreign = load().create(opts(storage(), r));
        foreign.saveDay({ date: "2026-09-19", energy: 4 });
        r.set(foreign.snapshot().data);
        return { ok: false, status: 409 };
      }
      return r.fetch(u, o);
    },
  });
  t.saveDay({ date: "2026-09-21", habit: false });
  await t.sync();
  assert.equal(r.get().days.length, 2);
  const count = r.puts();
  r.set({ schema: 1, days: [], settings: { unknown: 1 }, updatedAt: null });
  await t.sync();
  assert.equal(r.puts(), count);
  assert.equal(t.snapshot().status, "error");
});
test("in-flight edits stay dirty and quota failures do not discard the entered data", async () => {
  const s = storage(),
    r = remote();
  let release;
  const wait = new Promise((res) => {
    release = res;
  });
  const t = load().create({
    ...opts(s, r),
    fetch: async (u, o) => {
      const reply = await r.fetch(u, o);
      if (o.method === "PUT") await wait;
      return reply;
    },
  });
  t.saveDay({ date: "2026-09-21", energy: 4 });
  const sync = t.sync();
  await new Promise((r) => setTimeout(r, 0));
  t.saveDay({ date: "2026-09-21", energy: 6 });
  release();
  await sync;
  assert.equal(t.snapshot().dirty, true);
  assert.equal(r.get().days[0].energy, 4);
  const bad = storage();
  bad.setItem = () => {
    throw Error("quota");
  };
  const fail = load().create(opts(bad, r));
  assert.throws(
    () => fail.saveDay({ date: "2026-09-21", energy: 3 }),
    /storage/,
  );
  assert.equal(fail.snapshot().data.days.length, 0);
});
test("body deadline bounds retries and releases active sync", async () => {
  let calls = 0;
  const t = load({ setTimeout: (fn) => setTimeout(fn, 1) }).create({
    ...opts(storage(), remote()),
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    },
  });
  await t.sync();
  assert.equal(calls, 3);
  assert.equal(t.snapshot().status, "error");
  await t.sync();
  assert.equal(calls, 6);
});
test("strict remote schemas reject unknown fields and tie tombstones merge deterministically", () => {
  const A = load(),
    t = A.create(opts(storage(), remote()));
  t.saveDay({
    date: "2026-09-21",
    effort: 0,
    sessionMinutes: 40,
    energy: 10,
    caloriesKcal: 0,
  });
  t.saveSettings({ goalWeightLb: 175.5, wakeMinute: 390, habitLabel: "Walk" });
  const good = t.snapshot().data;
  for (const mutate of [
    (d) => (d.days[0].energy = 11),
    (d) => (d.days[0].sessionMinutes = 0),
    (d) => (d.days[0].restDay = true),
    (d) => (d.days[0].caloriesKcal = "0"),
    (d) => d.days.push(d.days[0]),
    (d) => (d.settings.secret = "bad"),
    (d) => (d.settings.sleepTargetMinutes = null),
    (d) => (d.unknown = true),
  ]) {
    const bad = JSON.parse(JSON.stringify(good));
    mutate(bad);
    assert.throws(() => A.validate(bad));
  }
  const tomb = JSON.parse(JSON.stringify(good));
  tomb.days[0].deleted = true;
  assert.equal(A.merge(good, tomb).days[0].deleted, true);
  assert.equal(
    JSON.stringify(A.merge(good, tomb)),
    JSON.stringify(A.merge(tomb, good)),
  );
});
test("token stays in GitHub auth header, missing token avoids network, and unreadable local data is not replaced", async () => {
  let calls = 0;
  const t = load().create({
    ...opts(storage(), remote()),
    getToken: () => "",
    fetch: async () => {
      calls++;
    },
  });
  t.saveDay({ date: "2026-09-21", habit: true });
  await t.sync();
  assert.equal(calls, 0);
  assert.equal(t.snapshot().status, "local");
  assert.equal(t.snapshot().dirty, true);
  const s = storage();
  s.values["scratch-analytics-journal-v1"] = "corrupt";
  const broken = load().create({
    ...opts(s, remote()),
    fetch: async () => {
      calls++;
    },
  });
  await broken.sync();
  assert.equal(calls, 0);
  assert.equal(broken.snapshot().status, "error");
  assert.equal(s.values["scratch-analytics-journal-v1"], "corrupt");
  assert.throws(() => broken.saveSettings({ habitLabel: "Walk" }));
  const auth = load().create({
    ...opts(storage(), remote()),
    fetch: async () => {
      calls++;
      return { ok: false, status: 401 };
    },
  });
  await auth.sync();
  assert.equal(calls, 1);
  assert.match(auth.snapshot().error, /401/);
});
test("local edit during GET is included and another tab edit during PUT remains dirty", async () => {
  const s = storage(),
    r = remote();
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  let phase = "get";
  const a = load().create({
    ...opts(s, r),
    fetch: async (u, o) => {
      if (o.method === "GET" && phase === "get") await hold;
      return r.fetch(u, o);
    },
  });
  const p = a.sync();
  a.saveDay({ date: "2026-09-21", energy: 7 });
  release();
  await p;
  assert.equal(r.get().days[0].energy, 7);
  let finish;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const b = load().create({
    ...opts(s, r),
    fetch: async (u, o) => {
      const result = await r.fetch(u, o);
      if (o.method === "PUT") await waiting;
      return result;
    },
  });
  b.saveSettings({ habitLabel: "Fresh" });
  const uploading = b.sync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  a.saveDay({ date: "2026-09-20", energy: 4 });
  finish();
  await uploading;
  assert.equal(b.snapshot().data.days.length, 2);
  assert.equal(b.snapshot().dirty, true);
});
test("habit tags retain identity across rename, full-form resave, explicit retag and remote settings transition", async () => {
  const s = storage(),
    r = remote(),
    a = load().create(opts(s, r)),
    b = load().create(opts(s, r));
  a.saveDay({ date: "2026-09-20", habit: true, energy: 5 });
  a.saveSettings({ habitLabel: "Evening walk" });
  b.saveDay({ date: "2026-09-21", habit: false });
  assert.equal(b.snapshot().data.days[1].habitLabel, "Evening walk");
  b.saveDay({ date: "2026-09-20", habit: true, energy: 6 });
  assert.equal(b.snapshot().data.days[0].habitLabel, "Late caffeine");
  b.saveDay({ date: "2026-09-20", habit: true, habitLabel: "Evening walk" });
  assert.equal(b.snapshot().data.days[0].habitLabel, "Evening walk");
  b.saveDay({ date: "2026-09-20", habit: null });
  assert.equal(b.snapshot().data.days[0].habitLabel, undefined);
  await b.sync();
  const next = load().create(opts(storage(), r));
  await next.sync();
  next.saveDay({ date: "2026-09-19", habit: true });
  assert.equal(next.snapshot().data.days[0].habitLabel, "Evening walk");
  const legacy = next.snapshot().data;
  delete legacy.days[0].habitLabel;
  assert.doesNotThrow(() => load().validate(legacy));
  legacy.days[0].habitLabel = "x".repeat(61);
  assert.throws(() => load().validate(legacy));
});
