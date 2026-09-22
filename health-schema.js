(function(root){"use strict";
const HEALTH_GROUPS = [
  "activity",
  "heartRate",
  "sleep",
  "oxygen",
  "stress",
  "pai",
  "training",
];
const HEALTH_MAX = 40960;
function iso(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw Error("Invalid health timestamp");
}
function number(value, min, max) {
  if (value !== null && (!Number.isFinite(value) || value < min || value > max))
    throw Error("Invalid health value");
}
function array(value, max, check) {
  if (!Array.isArray(value) || value.length > max)
    throw Error("Health array too large");
  value.forEach(check);
}
function valueCheck(key, v) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Invalid health group");
  const limits = {
    activity: {
      steps: [0, 200000],
      stepTarget: [0, 200000],
      caloriesKcal: [0, 50000],
      calorieTargetKcal: [0, 50000],
      standingHours: [0, 24],
      standingTargetHours: [0, 24],
    },
    heartRate: { lastBpm: [1, 300], restingBpm: [1, 300] },
    sleep: {
      score: [0, 100],
      deepMinutes: [0, 2880],
      totalMinutes: [0, 2880],
      startMinute: [-1440, 2880],
      endMinute: [-1440, 2880],
    },
    stress: { current: [1, 100], sourceTimeRaw: [0, 1e15] },
    pai: { total: [0, 10000], today: [0, 10000] },
    training: {
      vo2MaxRaw: [0, 1e9],
      trainingLoadRaw: [0, 1e9],
      fullRecoveryTimeRaw: [0, 1e12],
    },
  };
  Object.keys(limits[key] || {}).forEach((k) => {
    if (k in v) number(v[k], ...limits[key][k]);
  });
  if (key === "heartRate" && v.todayBpm)
    array(v.todayBpm, 1440, (n) => number(n, 1, 300));
  if (key === "sleep") {
    if (v.stages)
      array(v.stages, 128, (r) => {
        if (!["wake", "rem", "light", "deep", "unknown"].includes(r.stage))
          throw Error("Invalid sleep stage");
        number(r.startMinute, -1440, 2880);
        number(r.endMinute, -1440, 2880);
      });
    if (v.naps)
      array(v.naps, 24, (r) => {
        number(r.durationMinutes, 0, 1440);
        number(r.startMinute, -1440, 2880);
        number(r.endMinute, -1440, 2880);
      });
    if (
      v.timeBasis !== "minutes-from-midnight" ||
      v.overnightConvention !== "undocumented"
    )
      throw Error("Invalid sleep time basis");
  }
  if (key === "oxygen") {
    array(v.recent, 96, (r) => {
      number(r.percent, 1, 100);
      number(r.utcSeconds, 0, 1e12);
    });
    if (v.hoursRequested !== 24) throw Error("Invalid oxygen period");
  }
  if (key === "stress") {
    if (v.todayHourly) array(v.todayHourly, 24, (n) => number(n, 1, 100));
    if (v.lastWeek) array(v.lastWeek, 7, (n) => number(n, 1, 100));
  }
  if (key === "pai" && v.lastWeek)
    array(v.lastWeek, 7, (n) => number(n, 0, 10000));
  if (key === "training" && v.units !== "undocumented")
    throw Error("Invalid training units");
}
function groupCheck(key, g) {
  if (!g || !["ok", "unavailable", "error"].includes(g.status))
    throw Error("Invalid health status");
  iso(g.capturedAt);
  if (
    g.reason !== undefined &&
    (typeof g.reason !== "string" || g.reason.length > 160)
  )
    throw Error("Invalid health reason");
  if (g.status === "ok") valueCheck(key, g.value);
  else if (g.value !== null) throw Error("Invalid unavailable health value");
  if (
    g.missingFields &&
    (!Array.isArray(g.missingFields) ||
      g.missingFields.length > 16 ||
      g.missingFields.some((k) => typeof k !== "string" || k.length > 40))
  )
    throw Error("Invalid missing health fields");
  if (g.preservedFields) {
    if (
      typeof g.preservedFields !== "object" ||
      Array.isArray(g.preservedFields) ||
      Object.keys(g.preservedFields).length > 16
    )
      throw Error("Invalid preserved health fields");
    Object.keys(g.preservedFields).forEach((k) => {
      const p = g.preservedFields[k];
      if (
        !g.value ||
        !(k in g.value) ||
        !p ||
        typeof p.reason !== "string" ||
        p.reason.length > 160
      )
        throw Error("Invalid field provenance");
      iso(p.capturedAt);
    });
  }
  if (g.latestAttempt) {
    const a = g.latestAttempt;
    if (!["unavailable", "error"].includes(a.status))
      throw Error("Invalid health attempt");
    iso(a.capturedAt);
    if (typeof a.reason !== "string" || a.reason.length > 160)
      throw Error("Invalid health attempt");
  }
}
function validateHealthDay(day) {
  if (
    !day ||
    typeof day.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
    !Number.isFinite(Date.parse(day.date + "T00:00:00Z")) ||
    new Date(day.date + "T00:00:00Z").toISOString().slice(0, 10) !== day.date
  )
    throw Error("Invalid health date");
  iso(day.capturedAt);
  number(day.timezoneOffsetMinutes, -840, 840);
  if (
    !Number.isInteger(day.timezoneOffsetMinutes) ||
    typeof day.source !== "string" ||
    day.source.length > 40
  )
    throw Error("Invalid health source");
  if (!day.groups) throw Error("Missing health groups");
  HEALTH_GROUPS.forEach((k) => groupCheck(k, day.groups[k]));
  if (JSON.stringify(day).length > 20480)
    throw Error("Health snapshot too large");
  return day;
}
function validateHealth(doc) {
  if (
    !doc ||
    doc.schema !== 1 ||
    !Array.isArray(doc.days) ||
    doc.days.length > 3660
  )
    throw Error("Invalid health file");
  const dates = {};
  doc.days.forEach((d) => {
    validateHealthDay(d);
    if (dates[d.date]) throw Error("Duplicate health day");
    dates[d.date] = true;
  });
  if (doc.updatedAt !== null) iso(doc.updatedAt);
  return doc;
}

root.ScratchHealthSchema={validateHealth,validateHealthDay,HEALTH_GROUPS};})(globalThis);
