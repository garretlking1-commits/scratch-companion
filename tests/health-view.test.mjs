import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const collected = '2026-09-21T18:00:00.000Z';
function day(date = '2026-09-21') {
  const values = {
    activity: { steps: 0, stepTarget: 8000, caloriesKcal: 420, standingHours: 4 },
    heartRate: { lastBpm: 72, restingBpm: 55, todayBpm: [60, 65, null, 70, 72] },
    sleep: { score: 82, totalMinutes: 440, deepMinutes: 70, startMinute: -60, endMinute: 380,
      stages: [{ stage: 'rem', startMinute: -60, endMinute: 20 }], naps: [{ durationMinutes: 20, startMinute: 800, endMinute: 820 }] },
    oxygen: { recent: [{ percent: 98, utcSeconds: 1790010000 }, { percent: 97, utcSeconds: 1790000000 }] },
    stress: { current: 20, todayHourly: [null, 12], lastWeek: [1, 2, 3, 4, 5, 6, 7] },
    pai: { total: 100, today: 7, lastWeek: [7, 6, 5, 4, 3, 2, 1] },
    training: { vo2MaxRaw: 4500, trainingLoadRaw: 38, fullRecoveryTimeRaw: 120 }
  };
  return { date, capturedAt: collected, timezoneOffsetMinutes: 420, groups: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { status: 'ok', capturedAt: collected, value }])) };
}
function text(node) { return node.textContent + node.children.map(text).join(' '); }
function all(node, tag) { return [ ...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => all(child, tag)) ]; }
function page(days = [day()]) {
  const elements = new Map();
  function element(tag) {
    return { tag, textContent: '', value: '', children: [], attributes: {}, listeners: {}, dataset: {},
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      emit(type) { return this.listeners[type]?.(); }
    };
  }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element('div')); return elements.get(id); },
    createElement: element, createElementNS: (_, tag) => element(tag) };
  const state = { data: { schema: 1, days, updatedAt: collected }, status: 'synced', error: '', lastSync: collected };
  let notify, calls = 0;
  const reader = { snapshot: () => state, subscribe(callback) { notify = callback; }, async sync() { calls++; notify(); } };
  const ctx = vm.createContext({ Date, console });
  vm.runInContext(fs.readFileSync(new URL('../health-view.js', import.meta.url), 'utf8'), ctx);
  const api = ctx.ScratchHealthView.init({ document, reader });
  return { api, state, reader, notify: () => notify(), calls: () => calls, get: id => document.getElementById(id),
    cards: () => all(document.getElementById('health-content'), 'section') };
}

test('all metric cards show valid zero activity, missing fields and watch timezone', () => {
  const p = page();
  assert.equal(p.cards().length, 7);
  assert.match(text(p.cards()[0]), /Steps:  0/);
  assert.match(text(p.cards()[0]), /Not available/);
  assert.match(text(p.get('health-content')), /UTC−07:00/);
  assert.match(text(p.cards()[6]), /4500/);
  assert.match(text(p.cards()[6]), /scaling are not documented/);
  assert.doesNotMatch(text(p.cards()[6]), /120 hours|45 ml/);
});

test('date selection survives reader updates and empty history offers watch sync', () => {
  const p = page([day('2026-09-20'), day()]);
  assert.equal(p.get('health-date').value, '2026-09-21');
  p.get('health-date').value = '2026-09-20'; p.get('health-date').emit('change');
  p.state.data.days.push(day('2026-09-22')); p.notify();
  assert.equal(p.get('health-date').value, '2026-09-20');
  assert.match(text(p.get('health-content')), /Watch date 2026-09-20/);
  p.state.data.days = []; p.notify();
  assert.equal(p.get('health-date').disabled, true);
  assert.match(text(p.get('health-content')), /Use Sync on the watch/);
  p.state.status = 'local'; p.notify();
  assert.match(text(p.get('health-status')), /Connect GitHub/);
  assert.doesNotMatch(text(p.get('health-status')), /data is saved/);
  assert.equal(p.get('health-status').dataset.state, 'local');
});

test('heart rate chart never connects across missing readings and exposes exact accessible rows', () => {
  const p = page(); const card = p.cards()[1];
  assert.equal(all(card, 'polyline').length, 2);
  assert.match(all(card, 'svg')[0].attributes['aria-label'], /Gaps are missing/);
  const rows = all(all(card, 'tbody')[0], 'tr').map(text);
  assert.match(rows[2], /00:02.*Not available/);
  assert.match(rows[4], /00:04.*72 bpm/);
});

test('sleep retains offset context, oxygen sorts UTC readings, and weekly series align despite opposite API ordering', () => {
  const p = page(); const cards = p.cards();
  assert.match(text(cards[2]), /23:00 \(offset -60 min\)/);
  assert.match(text(cards[2]), /does not specify which date/);
  assert.match(text(cards[3]), /Latest recorded oxygen:  98 %/);
  assert.match(text(cards[3]), /UTC/);
  const stress = all(cards[4], 'tbody')[1].children.map(text);
  const pai = all(cards[5], 'tbody')[0].children.map(text);
  assert.match(stress[0], /2026-09-15.*1/);
  assert.match(stress[6], /2026-09-21.*7/);
  assert.deepEqual(stress, pai);
});

test('failed attempts retain last-good context and untrusted reasons remain literal text', () => {
  const data = day();
  data.groups.activity.latestAttempt = { status: 'error', capturedAt: '2026-09-21T20:00:00.000Z', reason: '<img src=x onerror=alert(1)>' };
  data.groups.oxygen = { status: 'unavailable', capturedAt: collected, value: null, reason: 'Not supported' };
  const p = page([data]); p.state.status = 'error'; p.state.error = 'Network unavailable'; p.notify();
  assert.match(text(p.get('health-status')), /Network unavailable/);
  assert.match(text(p.get('health-content')), /last health data saved on this phone/);
  assert.match(text(p.cards()[0]), /Last good reading/);
  assert.match(text(p.cards()[0]), /<img src=x/);
  assert.equal(all(p.get('health-content'), 'img').length, 0);
  assert.match(text(p.cards()[3]), /Not supported/);
});

test('individually retained readings show their own last-good time and readable label', () => {
  const data = day();
  data.groups.heartRate.preservedFields = { restingBpm: { capturedAt: '2026-09-21T07:00:00.000Z', reason: 'New reading unavailable' } };
  const p = page([data]);
  assert.match(text(p.cards()[1]), /Resting heart rate retained from 2026-09-21 07:00:00 UTC/);
  assert.match(text(p.cards()[1]), /New reading unavailable/);
  assert.match(text(p.cards()[1]), /Collected: 2026-09-21 18:00:00 UTC/);
});

test('refresh prevents duplicate requests and recovers button after rejected sync', async () => {
  const p = page(); let reject;
  p.reader.sync = () => new Promise((_, fail) => { reject = fail; });
  const pending = p.get('health-sync').emit('click');
  assert.equal(p.get('health-sync').disabled, true);
  assert.equal(await p.get('health-sync').emit('click'), undefined);
  reject(Error('Connection lost')); await pending;
  assert.equal(p.get('health-sync').disabled, false);
  assert.match(text(p.get('health-status')), /Connection lost/);
  p.reader.sync = async () => { p.state.status = 'synced'; p.notify(); };
  await p.get('health-sync').emit('click');
  assert.match(text(p.get('health-status')), /synced with GitHub/);
});
