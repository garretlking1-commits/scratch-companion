(function (root) {
  'use strict';
  const DAY = 86400000;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const setCount = value => Number.isInteger(value) && value >= 0 && value <= 100 ? value : 0;
  const mean = values => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
    return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
  };
  function dayNumber(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const time = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time / DAY : null;
  }
  const dateAt = day => new Date(day * DAY).toISOString().slice(0, 10);
  const section = (status, reason, values, samples = 0) => ({ status, reason, values, samples });
  const rows = (doc, key) => Array.isArray(doc) ? doc : Array.isArray(doc?.[key]) ? doc[key] : [];
  function dated(source, today) {
    return source.filter(row => row && !row.deleted && dayNumber(row.date) !== null && dayNumber(row.date) <= today);
  }
  function latestPerDay(source, today) {
    const days = new Map();
    source.filter(row => row && dayNumber(row.date) !== null && dayNumber(row.date) <= today).forEach(row => {
      const old = days.get(row.date);
      if (!old || String(row.updatedAt || row.capturedAt || '') >= String(old.updatedAt || old.capturedAt || '')) days.set(row.date, row);
    });
    return [...days.values()].filter(row => !row.deleted);
  }
  function weightsByDay(source, today) {
    // Identity deduplication precedes daily means; repeated weigh-ins have equal day weight.
    const ids = new Map();
    source.forEach((row, index) => {
      if (!row) return;
      const key = row.id || 'row-' + index, old = ids.get(key);
      if (!old || row.deleted || (!old.deleted && String(row.updatedAt || '') >= String(old.updatedAt || ''))) ids.set(key, row);
    });
    const days = new Map();
    dated([...ids.values()], today).forEach(row => {
      if (!finite(row.weightLb) || row.weightLb <= 0) return;
      const list = days.get(row.date) || []; list.push(row.weightLb); days.set(row.date, list);
    });
    return [...days].map(([date, values]) => ({ date, x: dayNumber(date), y: mean(values) })).sort((a, b) => a.x - b.x);
  }
  function regression(points) {
    const n = points.length;
    if (n < 2) return null;
    const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
    const xx = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
    if (!xx) return null;
    const slope = points.reduce((sum, p) => sum + (p.x - mx) * (p.y - my), 0) / xx;
    const squaredError = points.reduce((sum, p) => sum + (p.y - my - slope * (p.x - mx)) ** 2, 0);
    // Approximate descriptive slope interval, not a guaranteed forecast interval.
    const se = n > 2 ? Math.sqrt(squaredError / (n - 2) / xx) : null;
    return { slope, se, at: x => my + slope * (x - mx) };
  }
  function weightSummary(points, settings, today) {
    const window = points.filter(p => p.x >= today - 27), n = window.length;
    const values = { weeklyLb: null, weeklyPercent: null, trendLb: null, asOfDate: n ? window[n - 1].date : null, spanDays: n ? window[n - 1].x - window[0].x : 0, plateau: null, goalDate: null, goalDays: null, slopeInterval: null };
    if (n < 7 || values.spanDays < 14) return section('insufficient', 'Needs at least 7 weigh-in days spanning 14 days within the past 28 days.', values, n);
    const last = window[n - 1], fit = regression(window);
    values.weeklyLb = fit.slope * 7; values.trendLb = fit.at(last.x);
    values.weeklyPercent = values.weeklyLb / values.trendLb * 100;
    values.slopeInterval = [(fit.slope - 2 * fit.se) * 7, (fit.slope + 2 * fit.se) * 7];
    const threshold = finite(settings.plateauThresholdLbPerWeek) && settings.plateauThresholdLbPerWeek > 0 ? settings.plateauThresholdLbPerWeek : 0.2;
    values.plateauThresholdLbPerWeek = threshold;
    if (n >= 14 && values.spanDays >= 21) values.plateau = Math.abs(values.weeklyLb) < threshold;
    if (today - last.x > 7) return section('insufficient', 'Weight history is stale; add a weigh-in from the past 7 days before projecting.', values, n);
    const goal = settings.goalWeightLb;
    if (finite(goal) && goal > 0 && Math.abs(values.weeklyLb) >= 0.1 && values.slopeInterval[0] * values.slopeInterval[1] > 0) {
      const days = (goal - values.trendLb) / fit.slope;
      if (days > today - last.x && days <= 3650) { values.goalDays = last.x + Math.ceil(days) - today; values.goalDate = dateAt(last.x + Math.ceil(days)); }
    }
    return section('ok', 'Calendar-day regression over the past 28 days; goal date is conditional on the same pace, not a promise. Plateau uses a configurable descriptive threshold.', values, n);
  }
  function fresh(day, key, field) {
    const group = day.groups?.[key];
    if (group?.status !== 'ok' || group.preservedFields?.[field]) return null;
    const capture = Date.parse(group.capturedAt);
    const offset = finite(day.timezoneOffsetMinutes) ? day.timezoneOffsetMinutes : 0;
    if (!Number.isFinite(capture) || dateAt(Math.floor((capture - offset * 60000) / DAY)) !== day.date) return null;
    const value = group.value?.[field];
    return finite(value) ? value : null;
  }
  function sleepSummary(health, settings, today) {
    const target = finite(settings.sleepTargetMinutes) && settings.sleepTargetMinutes > 0 ? settings.sleepTargetMinutes : 480;
    const wake = finite(settings.wakeMinute) ? settings.wakeMinute : 420;
    const buffer = finite(settings.bedtimeBufferMinutes) ? settings.bedtimeBufferMinutes : 30;
    const recent = health.filter(d => dayNumber(d.date) >= today - 13);
    const totals = recent.map(d => ({ x: dayNumber(d.date), value: fresh(d, 'sleep', 'totalMinutes') })).filter(p => p.value !== null && p.value > 0);
    const week = totals.filter(p => p.x >= today - 6);
    const starts = recent.map(d => fresh(d, 'sleep', 'startMinute')).filter(v => v !== null);
    let regularity = null;
    if (starts.length >= 5) {
      const angles = starts.map(v => v / 1440 * 2 * Math.PI);
      const r = Math.hypot(mean(angles.map(Math.sin)), mean(angles.map(Math.cos)));
      if (r > 0.000001) regularity = Math.sqrt(-2 * Math.log(Math.min(1, r))) * 1440 / (2 * Math.PI);
    }
    const values = { shortfall7Minutes: week.length ? week.reduce((s, p) => s + Math.max(0, target - p.value), 0) : null,
      shortfall14Minutes: totals.length ? totals.reduce((s, p) => s + Math.max(0, target - p.value), 0) : null,
      observed7: week.length, observed14: totals.length, regularityMinutes: regularity, regularityN: starts.length,
      bedtimeMinute: ((wake - target - buffer) % 1440 + 1440) % 1440, targetMinutes: target };
    return section(totals.length ? 'ok' : 'insufficient', 'Shortfall sums observed nights only, not physiological sleep debt. Missing nights stay unknown; naps are not added. Regularity is circular clock-time standard deviation (5 nights minimum).', values, totals.length);
  }
  function rhrSummary(health, today) {
    const current = health.find(d => dayNumber(d.date) === today);
    const now = current ? fresh(current, 'heartRate', 'restingBpm') : null;
    const prior = health.filter(d => dayNumber(d.date) >= today - 28 && dayNumber(d.date) < today).map(d => fresh(d, 'heartRate', 'restingBpm')).filter(v => v !== null && v > 0);
    const values = { currentBpm: now, baselineBpm: null, deviationBpm: null, robustZ: null };
    if (now === null || now <= 0 || prior.length < 14) return section('insufficient', 'Needs today’s fresh resting heart rate and at least 14 fresh prior days in the past 28 days.', values, prior.length);
    values.baselineBpm = median(prior); values.deviationBpm = now - values.baselineBpm;
    const mad = median(prior.map(v => Math.abs(v - values.baselineBpm)));
    if (mad > 0) values.robustZ = values.deviationBpm / (1.4826 * mad);
    return section('ok', 'Compared with your prior 28-day median; this is a personal observation, not a diagnosis or clearance to train.', values, prior.length);
  }
  function workouts(source, today) {
    const seen = new Set();
    return dated(source, today).filter(e => {
      if (e.type !== 'workout' || e.exId === 'test-5s') return false;
      if (e.watchId) { if (seen.has(e.watchId)) return false; seen.add(e.watchId); }
      return true;
    });
  }
  function strengthSummary(entries, today) {
    const records = new Map(), sets = new Map(), exerciseSets = new Map(), volume = new Map(), estimates = new Map(), history = new Map();
    let knownReps = 0;
    entries.forEach(e => {
      const raw = e.watch || {}, plan = raw.plan;
      const completed = setCount(e.sets);
      if (dayNumber(e.date) >= today - 6) {
        const muscle = typeof plan?.primaryMuscle === 'string' && plan.primaryMuscle ? plan.primaryMuscle : 'Unmapped';
        sets.set(muscle, (sets.get(muscle) || 0) + completed);
        exerciseSets.set(e.exId, (exerciseSets.get(e.exId) || 0) + completed);
      }
      if (!plan || plan.unit !== 'lb' || plan.exerciseType !== 'reps') return;
      // Revision and unilateral setup separate incomparable configurations.
      const setup = [e.exId, plan.revision || 'unknown', plan.perLeg ? 'per-leg' : 'bilateral'].join('|');
      const loads = Array.isArray(raw.loads) ? raw.loads : [];
      const reps = Array.isArray(raw.actualReps) ? raw.actualReps : [];
      for (let i = 0; i < Math.min(completed, loads.length); i++) {
        const load = loads[i];
        if (!finite(load) || load <= 0) continue;
        const prior = records.get(setup);
        if (!prior || load > prior.loadLb) records.set(setup, { exerciseId: e.exId, setup, loadLb: load, date: e.date, perLeg: !!plan.perLeg });
        const rep = reps[i];
        if (!Number.isInteger(rep) || rep < 1 || rep > 100) continue;
        knownReps++;
        const key = e.date + '|' + setup, previous = volume.get(key);
        volume.set(key, { date: e.date, exerciseId: e.exId, setup, unit: 'lb·reps', perLeg: !!plan.perLeg, loadReps: (previous?.loadReps || 0) + load * rep });
        if (raw.strengthEligible?.[i] !== true || rep > 10 || e.pain > 0 || raw.painScore !== 0) continue;
        const estimated = rep === 1 ? load : load * (1 + rep / 30);
        const point = { exerciseId: e.exId, setup, date: e.date, estimatedLb: estimated, actualReps: rep, loadLb: load, perLeg: !!plan.perLeg };
        if (!estimates.has(setup) || estimates.get(setup).estimatedLb < estimated) estimates.set(setup, point);
        if (!history.has(key) || history.get(key).estimatedLb < estimated) history.set(key, point);
      }
    });
    return section(entries.length ? 'ok' : 'insufficient', 'Recorded working sets only. Volume uses actual reps; eligible pain-free hard sets use Epley for 2–10 reps (singles use load). Setup revisions stay separate; per-leg volume is not doubled. Unmapped sets have no invented muscle assignment.',
      { records: [...records.values()], weeklySets: [...sets].map(([muscle, count]) => ({ muscle, sets: count })),
        weeklyExerciseSets: [...exerciseSets].map(([exerciseId, count]) => ({ exerciseId, sets: count })),
        volume: [...volume.values()], estimatedMaxes: [...estimates.values()],
        estimatedHistory: [...history.values()].sort((a, b) => a.date.localeCompare(b.date) || a.setup.localeCompare(b.setup)), actualRepSets: knownReps }, entries.length);
  }
  function adherenceSummary(entries) {
    const schedules = new Map(), conflicts = new Set();
    entries.forEach(e => {
      const plan = e.watch?.plan;
      if (!Array.isArray(plan?.scheduled) || !plan.scheduled.length || plan.scheduled.length > 100) return;
      if (plan.scheduled.some(s => !s || typeof s !== 'object' || typeof s.exerciseId !== 'string' || !Number.isInteger(s.plannedSets) || s.plannedSets < 0 || s.plannedSets > 100)) return;
      if (new Set(plan.scheduled.map(s => s.exerciseId)).size !== plan.scheduled.length) return;
      const signature = JSON.stringify(plan.scheduled.slice().sort((a, b) => a.exerciseId.localeCompare(b.exerciseId)));
      if (schedules.has(e.date) && schedules.get(e.date).signature !== signature) conflicts.add(e.date);
      else schedules.set(e.date, { signature, scheduled: plan.scheduled });
    });
    let planned = 0, completed = 0, extra = 0, days = 0;
    schedules.forEach((schedule, date) => {
      if (conflicts.has(date)) return;
      days++;
      const actual = new Map();
      entries.filter(e => e.date === date).forEach(e => actual.set(e.exId, (actual.get(e.exId) || 0) + setCount(e.sets)));
      schedule.scheduled.forEach(s => { const count = actual.get(s.exerciseId) || 0; planned += s.plannedSets; completed += Math.min(count, s.plannedSets); extra += Math.max(0, count - s.plannedSets); actual.delete(s.exerciseId); });
      extra += [...actual.values()].reduce((s, n) => s + n, 0);
    });
    return section(planned ? 'ok' : 'unavailable', 'Only dates with a saved historical schedule are included. Unlogged dates and conflicting schedules are unknown; this is not whole-calendar adherence.',
      { percent: planned ? completed / planned * 100 : null, plannedSets: planned, completedSets: completed, extraSets: extra, observedDays: days, conflictingDays: conflicts.size }, days);
  }
  function effortSummary(entries, journal, today) {
    const watchDays = new Map();
    entries.forEach(e => { const list = watchDays.get(e.date) || []; list.push(e); watchDays.set(e.date, list); });
    const loads = new Map(), origins = new Map();
    watchDays.forEach((list, date) => {
      if (!list.every(e => finite(e.watch?.elapsedSec) && e.watch.elapsedSec > 0 && finite(e.watch.sessionRpe) && e.watch.sessionRpe >= 0 && e.watch.sessionRpe <= 10 && e.watch.sessionScope === 'exercise')) return;
      loads.set(date, list.reduce((sum, e) => sum + e.watch.elapsedSec / 60 * e.watch.sessionRpe, 0)); origins.set(date, 'recorded-exercise-blocks');
    });
    journal.forEach(row => {
      if (finite(row.effort) && row.effort >= 0 && row.effort <= 10 && finite(row.sessionMinutes) && row.sessionMinutes > 0) { loads.set(row.date, row.effort * row.sessionMinutes); origins.set(row.date, 'manual-day'); }
      else if (row.restDay === true && !watchDays.has(row.date)) { loads.set(row.date, 0); origins.set(row.date, 'confirmed-rest'); }
    });
    const chain = [];
    for (let x = today; x >= today - 179; x--) { if (!loads.has(dateAt(x))) break; chain.unshift({ date: dateAt(x), load: loads.get(dateAt(x)), source: origins.get(dateAt(x)) }); }
    const values = { load7: null, load42: null, balance: null, days: chain.length, latestLoad: loads.get(dateAt(today)) ?? null, history: chain };
    if (chain.length < 7) return section('insufficient', 'Needs at least 7 consecutive known days ending today. Missing days are not rest. Manual daily effort overrides watch exercise blocks.', values, chain.length);
    let short = 0, long = 0, balance = 0;
    chain.forEach(p => { balance = long - short; short += (p.load - short) / 7; long += (p.load - long) / 42; });
    values.load7 = short; values.load42 = long; values.balance = balance;
    return section(chain.length >= 42 ? 'ok' : 'insufficient', 'Effort × elapsed minutes, in arbitrary units. Recurrences start at zero; ' + (chain.length < 42 ? 'still calibrating toward 42 known days. ' : '') + 'Watch days cover recorded exercise blocks only, not a complete workout. Balance uses yesterday’s long minus short trend; no injury-risk cutoffs.', values, chain.length);
  }
  function associationsSummary(journal, health, settings, today) {
    const lookup = new Map(health.map(d => [d.date, d]));
    const tagged = [], untagged = [];
    const habitLabel = settings.habitLabel || 'Late caffeine';
    journal.filter(row => dayNumber(row.date) >= today - 90 && typeof row.habit === 'boolean' && row.habitLabel === habitLabel).forEach(row => {
      const next = lookup.get(dateAt(dayNumber(row.date) + 1));
      const sleep = next ? fresh(next, 'sleep', 'totalMinutes') : null;
      if (sleep !== null && sleep > 0) (row.habit ? tagged : untagged).push(sleep);
    });
    const values = { habitLabel, taggedN: tagged.length, untaggedN: untagged.length, nextSleepDifferenceMinutes: null };
    if (tagged.length < 7 || untagged.length < 7) return section('insufficient', 'Needs 7 tagged and 7 untagged days paired with fresh next-day sleep within 90 days.', values, tagged.length + untagged.length);
    values.nextSleepDifferenceMinutes = mean(tagged) - mean(untagged);
    return section('ok', 'Next-day sleep mean after tagged days minus untagged days. Association is not causation; routines and other factors may explain it.', values, tagged.length + untagged.length);
  }
  function nutritionSummary(points, journal, today) {
    const weight = points.filter(p => p.x >= today - 27);
    const intake = journal.filter(row => dayNumber(row.date) >= today - 27 && finite(row.caloriesKcal) && row.caloriesKcal > 0 && row.caloriesKcal <= 20000);
    const values = { estimatedKcal: null, meanIntakeKcal: null, weeklyWeightLb: null, windowDays: 28, intakeDays: intake.length, weightDays: weight.length, sensitivityKcal: null };
    if (intake.length < 26 || weight.length < 14 || weight[weight.length - 1].x - weight[0].x < 21 || today - weight[weight.length - 1].x > 3)
      return section('insufficient', 'Needs 26 of 28 intake days and 14 weigh-in days spanning 21 days, with a weigh-in in the past 3 days.', values, intake.length);
    const fit = regression(weight), calories = mean(intake.map(row => row.caloriesKcal));
    values.meanIntakeKcal = calories; values.weeklyWeightLb = fit.slope * 7;
    values.estimatedKcal = calories - 3500 * fit.slope;
    values.sensitivityKcal = [calories - 2500 * fit.slope, calories - 4500 * fit.slope].sort((a, b) => a - b);
    if (values.estimatedKcal <= 0) { values.estimatedKcal = null; return section('insufficient', 'Inputs produce an implausible energy estimate; check intake and weight coverage.', values, intake.length); }
    return section('ok', 'Rough energy-balance estimate: mean logged intake − 3,500 × daily lb trend. The fixed factor is an approximation, not long-term physiology; 2,500–4,500 sensitivity is not a confidence interval. Missing intake and water changes can bias results. No calorie prescription.', values, intake.length);
  }
  function summary({ weights, health, entries = [], journal, settings = {}, today } = {}) {
    const now = dayNumber(today);
    if (now === null) throw Error('Analytics needs a valid local today date.');
    const body = weightsByDay(rows(weights, 'records'), now);
    const healthDays = latestPerDay(rows(health, 'days'), now);
    const diary = latestPerDay(rows(journal, 'days'), now);
    const logs = workouts(Array.isArray(entries) ? entries : [], now);
    return { weight: weightSummary(body, settings, now), sleep: sleepSummary(healthDays, settings, now), restingHeartRate: rhrSummary(healthDays, now),
      strength: strengthSummary(logs, now), adherence: adherenceSummary(logs), effort: effortSummary(logs, diary, now),
      associations: associationsSummary(diary, healthDays, settings, now), nutrition: nutritionSummary(body, diary, now) };
  }
  root.ScratchAnalytics = { summary };
})(typeof globalThis !== 'undefined' ? globalThis : this);
