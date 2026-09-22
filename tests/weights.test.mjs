import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
function load(name, injected = {}) {
  const ctx = {
    ...injected,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    Error,
  };
  vm.createContext(ctx);
  if (fs.existsSync(new URL("../" + name, import.meta.url)))
    vm.runInContext(
      fs.readFileSync(new URL("../" + name, import.meta.url), "utf8"),
      ctx,
      { filename: name },
    );
  return ctx;
}
const M = load("weights.js").ScratchMetrics || {};
const now = "2026-09-21T12:00:00.000Z";
const record = (id, date, value = 180, unit = "lb", stamp = now) =>
  M.makeRecord({ id, date, value, unit, updatedAt: stamp }, "2026-09-21");
test("weights validate actual dates, finite values and units; pounds default and kg round-trips", () => {
  assert.equal(record("a", "2026-09-21").weightLb, 180);
  const kg = record("kg", "2026-09-20", "80.5", "kg");
  assert.ok(Math.abs(kg.weightLb - 177.47212) < 0.00001);
  for (const input of [
    { date: "2026-02-30" },
    { date: "2026-09-22" },
    { value: "NaN" },
    { value: "1e3" },
    { value: "0" },
    { value: "1501" },
    { unit: "stone" },
  ])
    assert.throws(() =>
      M.makeRecord(
        {
          id: "bad",
          date: "2026-09-21",
          value: 180,
          unit: "lb",
          updatedAt: now,
          ...input,
        },
        "2026-09-21",
      ),
    );
});
test("merge retains edits, distinct readings and tombstones without resurrecting stale updates", () => {
  const a = record("a", "2026-09-18"),
    b = record("b", "2026-09-19");
  const edited = {
    ...a,
    value: 181,
    inputValue: 181,
    weightLb: 181,
    updatedAt: "2026-09-21T12:00:01.000Z",
  };
  delete edited.value;
  const deleted = {
    ...b,
    deleted: true,
    updatedAt: "2026-09-21T12:00:02.000Z",
  };
  const first = M.merge(M.document([a, b]), M.document([edited, deleted]));
  assert.equal(first.records.find((r) => r.id === "a").weightLb, 181);
  assert.equal(M.visible(first).length, 1);
  assert.equal(M.visible(M.merge(first, M.document([b]))).length, 1);
  assert.equal(
    JSON.stringify(M.merge(first, M.document([b]))),
    JSON.stringify(M.merge(M.document([b]), first)),
  );
});
test("statistics use actual calendar gaps and daily averages, with honest empty states", () => {
  assert.equal(M.stats(M.document([])).latest, null);
  const data = M.document([
    record("a", "2026-09-01", 190),
    record("b", "2026-09-19", 180),
    record("c", "2026-09-21", 178),
  ]);
  const stats = M.stats(data);
  assert.equal(stats.change, -12);
  assert.equal(stats.average7, 179);
  assert.equal(stats.averageDays, 2);
  const points = M.chartPoints(data);
  assert.ok(points[1].x > 0.8);
  assert.equal(points[0].x, 0);
  assert.equal(points[2].x, 1);
});
test("malformed metrics schema rejects instead of dropping unknown records", () => {
  assert.throws(() => M.validate({ schema: 2, records: [] }));
  assert.throws(() =>
    M.validate({ schema: 1, records: [{}], updatedAt: null }),
  );
});
export { load, M, record, now };
const S = () =>
  load("weight-sync.js", {
    ScratchMetrics: M,
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  }).ScratchWeightSync || {};
function storage() {
  const values = {};
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}
function remoteStore(initial = null) {
  let data = initial,
    puts = 0,
    gets = 0;
  const fetch = async (url, options) => {
    assert.match(url, /body-metrics\.json/);
    assert.doesNotMatch(url, /companion-log/);
    if (options.method === "PUT") {
      puts++;
      data = JSON.parse(
        Buffer.from(JSON.parse(options.body).content, "base64").toString(),
      );
      return { ok: true, status: 200 };
    }
    gets++;
    return data
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            sha: "s" + gets,
            content: Buffer.from(JSON.stringify(data)).toString("base64"),
          }),
        }
      : { ok: false, status: 404 };
  };
  return {
    fetch,
    get: () => data,
    puts: () => puts,
    set: (value) => {
      data = value;
    },
  };
}
const options = (store, fetch) => ({
  storage: store,
  fetch,
  getToken: () => "fixture",
  api: "https://api.github.com/repos/test/private/contents/projects/zepp-bip6/data/body-metrics.json",
  now: () => new Date(now),
  makeId: () => "local",
});
test("separate metrics file handles404 and persists correction/deletion across reloads", async () => {
  const local = storage(),
    remote = remoteStore();
  const tracker = S().createTracker(options(local, remote.fetch));
  tracker.save({ date: "2026-09-21", value: "180.5", unit: "lb" });
  await tracker.sync();
  assert.equal(remote.puts(), 1);
  assert.equal(tracker.snapshot().status, "synced");
  tracker.save({ id: "local", date: "2026-09-20", value: 82, unit: "kg" });
  await tracker.sync();
  assert.equal(remote.get().records.length, 1);
  tracker.remove("local");
  await tracker.sync();
  assert.equal(remote.get().records[0].deleted, true);
  const reloaded = S().createTracker(options(local, remote.fetch));
  assert.equal(M.visible(reloaded.snapshot().data).length, 0);
});
test("conflict retry re-GET merges remote tombstones and never resurrects a deletion", async () => {
  const a = record("a", "2026-09-19"),
    remote = remoteStore(M.document([a]));
  let attempts = 0;
  const tracker = S().createTracker(
    options(storage(), async (url, opts) => {
      if (opts.method === "PUT" && ++attempts === 1) {
        remote.set(
          M.document([
            { ...a, deleted: true, updatedAt: "2026-09-21T13:00:00.000Z" },
          ]),
        );
        return { status: 409, ok: false };
      }
      return remote.fetch(url, opts);
    }),
  );
  tracker.save({ date: "2026-09-21", value: 180, unit: "lb" });
  await tracker.sync();
  assert.equal(remote.get().records.find((r) => r.id === "a").deleted, true);
  assert.equal(remote.get().records.length, 2);
  assert.equal(tracker.snapshot().status, "synced");
});
test("editing while PUT is pending stays unsynced until next successful upload", async () => {
  const remote = remoteStore(),
    local = storage();
  let resolvePut;
  const wait = new Promise((resolve) => {
    resolvePut = resolve;
  });
  const tracker = S().createTracker(
    options(local, async (url, opts) => {
      const reply = await remote.fetch(url, opts);
      if (opts.method === "PUT") await wait;
      return reply;
    }),
  );
  tracker.save({ date: "2026-09-21", value: 180, unit: "lb" });
  const syncing = tracker.sync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tracker.save({ id: "local", date: "2026-09-21", value: 181, unit: "lb" });
  resolvePut();
  await syncing;
  assert.equal(tracker.snapshot().status, "pending");
  assert.equal(tracker.snapshot().dirty, true);
  assert.equal(remote.get().records[0].weightLb, 180);
});
test("local failure remains visible and malformed remote cannot be overwritten", async () => {
  const local = storage();
  local.setItem = () => {
    throw Error("quota");
  };
  const tracker = S().createTracker(
    options(local, async () => {
      throw Error("no");
    }),
  );
  assert.throws(
    () => tracker.save({ date: "2026-09-21", value: 180, unit: "lb" }),
    /local|phone|storage/i,
  );
  assert.equal(tracker.snapshot().status, "error");
  assert.equal(tracker.snapshot().data.records.length, 0);
  let puts = 0;
  const corrupt = S().createTracker(
    options(storage(), async (url, opts) => {
      if (opts.method === "PUT") puts++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: "s",
          content: Buffer.from("{}").toString("base64"),
        }),
      };
    }),
  );
  await corrupt.sync();
  assert.equal(puts, 0);
  assert.equal(corrupt.snapshot().status, "error");
});
test("daily average balances dates, accepts leap day and omitted unit, and strictly validates remote records", () => {
  const first = M.makeRecord(
    { id: "default", date: "2024-02-29", value: 180, updatedAt: now },
    "2026-09-21",
  );
  assert.equal(first.inputUnit, "lb");
  const data = M.document([
    record("a", "2026-09-20", 180),
    record("b", "2026-09-20", 184),
    record("c", "2026-09-21", 178),
  ]);
  assert.equal(M.stats(data).average7, 180);
  const a = record("a", "2026-09-20");
  for (const records of [
    [a, a],
    [{ ...a, inputUnit: undefined }],
    [{ ...a, weightLb: 181 }],
    [{ ...a, inputValue: "180" }],
  ])
    assert.throws(() => M.validate(M.document(records)));
  const tomb = { ...a, deleted: true };
  const newer = { ...a, updatedAt: "2026-09-21T14:00:00.000Z" };
  assert.equal(
    M.merge(M.document([tomb]), M.document([newer])).records[0].deleted,
    true,
  );
  assert.equal(
    M.activity(
      [{ type: "workout", exId: "test-5s", date: "2026-09-21", workSec: 5 }],
      "2026-09-21",
    ).exercises,
    0,
  );
});
test("GET concurrent edits survive, callback reports errors, token is trimmed and retry count is bounded", async () => {
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const remote = remoteStore();
  const changes = [];
  const tracker = S().createTracker({
    ...options(storage(), async (url, opts) => {
      assert.equal(opts.headers.Authorization, "Bearer fixture");
      assert.equal(opts.cache, "no-store");
      if (opts.method === "GET") await hold;
      return remote.fetch(url, opts);
    }),
    getToken: () => " fixture ",
    onChange: (s) => changes.push(s.status),
  });
  const syncing = tracker.sync();
  tracker.save({ date: "2026-09-21", value: 183 });
  release();
  await syncing;
  assert.equal(remote.get().records[0].weightLb, 183);
  assert.equal(changes.at(-1), "synced");
  let requests = 0;
  const broken = S().createTracker(
    options(storage(), async () => {
      requests++;
      throw Error("offline");
    }),
  );
  await broken.sync();
  assert.equal(requests, 3);
  assert.equal(broken.snapshot().status, "error");
});
test("unreadable local data is retained and empty synced account does not create a needless file", async () => {
  const local = storage();
  local.values["scratch-body-metrics-v1"] = "bad";
  let calls = 0;
  const broken = S().createTracker(
    options(local, async () => {
      calls++;
    }),
  );
  await broken.sync();
  assert.equal(calls, 0);
  assert.equal(local.values["scratch-body-metrics-v1"], "bad");
  assert.equal(broken.snapshot().status, "error");
  const remote = remoteStore();
  const empty = S().createTracker(options(storage(), remote.fetch));
  await empty.sync();
  assert.equal(remote.puts(), 0);
  assert.equal(empty.snapshot().status, "synced");
});
test("two open trackers preserve each other local-only records and in-flight sync completion", async () => {
  const local = storage(),
    remote = remoteStore();
  const a = S().createTracker({
    ...options(local, remote.fetch),
    makeId: () => "a",
  });
  const b = S().createTracker({
    ...options(local, remote.fetch),
    makeId: () => "b",
  });
  a.save({ date: "2026-09-21", value: 180 });
  b.save({ date: "2026-09-21", value: 181 });
  assert.equal(
    JSON.parse(local.values["scratch-body-metrics-v1"]).data.records.length,
    2,
  );
  a.remove("a");
  b.save({ id: "b", date: "2026-09-21", value: 182 });
  assert.equal(
    JSON.parse(local.values["scratch-body-metrics-v1"]).data.records.find(
      (r) => r.id === "a",
    ).deleted,
    true,
  );
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const c = S().createTracker({
    ...options(local, async (url, opts) => {
      const reply = await remote.fetch(url, opts);
      if (opts.method === "PUT") await wait;
      return reply;
    }),
    makeId: () => "c",
  });
  const syncing = c.sync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  b.save({ id: "b", date: "2026-09-21", value: 183 });
  release();
  await syncing;
  assert.equal(
    c.snapshot().data.records.find((r) => r.id === "b").weightLb,
    183,
  );
  assert.equal(c.snapshot().dirty, true);
});
test("stalled response body is timed out and active sync is released after bounded attempts", async () => {
  let attempts = 0;
  const engine = load("weight-sync.js", {
    ScratchMetrics: M,
    AbortController,
    TextEncoder,
    TextDecoder,
    setTimeout: (fn) => setTimeout(fn, 1),
    clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  }).ScratchWeightSync;
  const tracker = engine.createTracker(
    options(storage(), async () => {
      attempts++;
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    }),
  );
  await tracker.sync();
  assert.equal(attempts, 3);
  assert.equal(tracker.snapshot().status, "error");
  assert.match(tracker.snapshot().error, /timed out/);
  await tracker.sync();
  assert.equal(attempts, 6);
});
