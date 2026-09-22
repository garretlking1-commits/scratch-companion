import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
function load() {
  const c = { Date, Math, Number, Object, Array, String, JSON };
  vm.createContext(c);
  if (fs.existsSync(new URL("../bike-view.js", import.meta.url)))
    vm.runInContext(
      fs.readFileSync(new URL("../bike-view.js", import.meta.url), "utf8"),
      c,
      { filename: fileURLToPath(new URL("../bike-view.js", import.meta.url)) },
    );
  return c.ScratchBikeView || {};
}
const ride = (date, hr = 125, level = 4, id = date) => ({
  type: "workout",
  exId: "zone2-bike",
  date,
  tod: 600,
  workSec: 600,
  hrAvg: hr,
  watchId: id,
  load: 99,
  watch: {
    sessionId: id,
    bikeResistanceLevel: level,
    partial: true,
    bikeZone: {
      lo: 118,
      hi: 140,
      belowSec: 100,
      inSec: 300,
      aboveSec: 100,
      unknownSec: 100,
      staleAfterSec: 10,
    },
  },
});
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.value = "all";
    this.events = {};
    this._text = "";
  }
  set textContent(t) {
    this._text = String(t);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set innerHTML(v) {
    throw Error("Unsafe HTML");
  }
  appendChild(v) {
    this.children.push(v);
    return v;
  }
  replaceChildren(...v) {
    this.children = v;
    this._text = "";
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  addEventListener(k, v) {
    this.events[k] = v;
  }
}
function ui(entries) {
  const ids = {
    "bike-history": new Element("div"),
    "bike-chart": new Element("svg"),
    "bike-summary": new Element("p"),
    "bike-level-filter": new Element("select"),
  };
  const document = {
    getElementById: (id) => ids[id],
    createElement: (t) => new Element(t),
    createElementNS: (ns, t) => new Element(t),
  };
  const api = load().init({ document, getEntries: () => entries });
  return { ids, api };
}
function all(node, tag) {
  return [
    ...(node.tagName === tag ? [node] : []),
    ...node.children.flatMap((c) => all(c, tag)),
  ];
}
test("bike extraction dedupes native identities and preserves distinct repeats, unknown resistance and partial records", () => {
  const a = ride("2026-09-20"),
    final = { ...a, workSec: 900, watch: { ...a.watch, partial: false } };
  const b = ride("2026-09-20", 0, null, "second");
  const rows = load().extract([
    a,
    final,
    b,
    { ...a, exId: "leg-press" },
    { ...a, date: "2026-02-30" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].workSec, 900);
  assert.equal(rows[1].hrAvg, null);
  assert.equal(rows[1].level, null);
  assert.equal(rows[1].partial, true);
  assert.equal(rows[0].coverage, null);
  assert.equal(rows[1].coverage, 5 / 6);
});
test("SVG uses true calendar spacing and breaks lines at missing HR; table renders unknowns without unsafe HTML", () => {
  const entries = [
    ride("2026-09-01"),
    ride("2026-09-02", 0, null),
    ride("2026-09-20", 130),
    ride("2026-09-21", 135),
  ];
  const p = ui(entries);
  const circles = all(p.ids["bike-chart"], "circle");
  assert.equal(circles.length, 3);
  assert.ok(Number(circles[1].attrs.cx) - Number(circles[0].attrs.cx) > 500);
  assert.equal(all(p.ids["bike-chart"], "polyline").length, 1);
  assert.match(p.ids["bike-history"].textContent, /Unknown/);
  assert.match(p.ids["bike-history"].textContent, /Partial/);
  assert.equal(all(p.ids["bike-history"], "table").length, 1);
});
test("reported resistance filter refreshes records without deriving level from load or effort", () => {
  const a = ride("2026-09-20", 120, 0),
    b = ride("2026-09-21", 130, 8),
    c = ride("2026-09-22", 140, null);
  c.watch.sessionRpe = 8;
  const p = ui([a, b, c]);
  const filter = p.ids["bike-level-filter"];
  filter.value = "0";
  filter.events.change();
  assert.match(p.ids["bike-summary"].textContent, /1 ride/);
  assert.equal(all(p.ids["bike-chart"], "circle").length, 1);
  filter.value = "unknown";
  filter.events.change();
  assert.match(p.ids["bike-history"].textContent, /Unknown/);
  assert.equal(all(p.ids["bike-chart"], "circle").length, 1);
});
test("empty and malformed readings produce descriptive empty state and reject injected numeric values", () => {
  const p = ui([]);
  assert.match(p.ids["bike-summary"].textContent, /No recorded bike rides/);
  assert.match(p.ids["bike-chart"].textContent, /No heart-rate/);
  const row = ride("2026-09-22", "<img src=x>", "<svg>");
  const result = load().extract([row])[0];
  assert.equal(result.hrAvg, null);
  assert.equal(result.level, null);
});
