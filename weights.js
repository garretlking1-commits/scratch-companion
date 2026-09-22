(function (root) {
  "use strict";
  const LB_PER_KG = 2.20462262185;
  const DAY = 86400000;
  function localDate(date = new Date()) {
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }
  function dateNumber(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw Error("Choose a valid date.");
    const value = Date.parse(date + "T00:00:00Z");
    if (
      !Number.isFinite(value) ||
      new Date(value).toISOString().slice(0, 10) !== date ||
      date < "1900-01-01"
    )
      throw Error("Choose a valid date.");
    return value;
  }
  function timestamp(value) {
    if (
      typeof value !== "string" ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    )
      throw Error("Invalid measurement timestamp.");
    return value;
  }
  function toLb(value, unit) {
    const text = String(value).trim();
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(text) || !["lb", "kg"].includes(unit))
      throw Error("Enter a number with up to 2 decimal places in lb or kg.");
    const input = Number(text);
    if (
      (unit === "lb" && (input < 1 || input > 1500)) ||
      (unit === "kg" && (input < 0.5 || input > 680))
    )
      throw Error("Use 1–1,500 lb or 0.5–680 kg.");
    return (
      Math.round(input * (unit === "kg" ? LB_PER_KG : 1) * 1000000) / 1000000
    );
  }
  function makeRecord(input, today = localDate()) {
    dateNumber(input.date);
    if (input.date > today)
      throw Error("The measurement date cannot be in the future.");
    if (typeof input.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id))
      throw Error("Invalid measurement ID.");
    const unit = input.unit || "lb";
    return {
      id: input.id,
      date: input.date,
      inputValue: Number(input.value),
      inputUnit: unit,
      weightLb: toLb(input.value, unit),
      updatedAt: timestamp(input.updatedAt),
      deleted: false,
    };
  }
  function document(records) {
    const sorted = records.slice().sort((a, b) => a.id.localeCompare(b.id));
    return {
      schema: 1,
      records: sorted,
      updatedAt: sorted.reduce(
        (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
        null,
      ),
    };
  }
  function validate(data) {
    if (
      !data ||
      data.schema !== 1 ||
      !Array.isArray(data.records) ||
      data.records.length > 20000
    )
      throw Error("Invalid body-metrics file. No data was overwritten.");
    const seen = new Set();
    data.records.forEach((record) => {
      if (
        !record ||
        typeof record.deleted !== "boolean" ||
        !["lb", "kg"].includes(record.inputUnit) ||
        typeof record.inputValue !== "number" ||
        seen.has(record.id)
      )
        throw Error("Invalid or duplicate weight record.");
      const normalized = makeRecord(
        {
          id: record.id,
          date: record.date,
          value: record.inputValue,
          unit: record.inputUnit,
          updatedAt: record.updatedAt,
        },
        "9999-12-31",
      );
      if (
        !Number.isFinite(record.weightLb) ||
        record.weightLb !== normalized.weightLb
      )
        throw Error("Inconsistent weight units in remote file.");
      seen.add(record.id);
    });
    if (data.updatedAt !== null) timestamp(data.updatedAt);
    return document(data.records.map((record) => ({ ...record })));
  }
  function merge(left, right) {
    const records = new Map();
    [...validate(left).records, ...validate(right).records].forEach(
      (record) => {
        const old = records.get(record.id);
        if (!old) {
          records.set(record.id, record);
          return;
        }
        // Delete wins over edits from stale/offline copies. Tombstones are never purged.
        if (old.deleted !== record.deleted) {
          if (record.deleted) records.set(record.id, record);
          return;
        }
        const a = old.updatedAt + JSON.stringify(old),
          b = record.updatedAt + JSON.stringify(record);
        if (b > a) records.set(record.id, record);
      },
    );
    return document([...records.values()]);
  }
  function visible(data) {
    return data.records
      .filter((record) => !record.deleted)
      .slice()
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.updatedAt.localeCompare(b.updatedAt) ||
          a.id.localeCompare(b.id),
      );
  }
  function daily(data) {
    const days = new Map();
    visible(data).forEach((record) => {
      const row = days.get(record.date) || {
        date: record.date,
        sum: 0,
        count: 0,
      };
      row.sum += record.weightLb;
      row.count++;
      days.set(record.date, row);
    });
    return [...days.values()].map((row) => ({
      date: row.date,
      weightLb: row.sum / row.count,
      count: row.count,
    }));
  }
  function stats(data) {
    const readings = visible(data),
      latest = readings[readings.length - 1] || null;
    if (!latest)
      return {
        latest: null,
        change: null,
        average7: null,
        averageDays: 0,
        first: null,
      };
    const cutoff = dateNumber(latest.date) - 6 * DAY;
    const week = daily(data).filter((row) => dateNumber(row.date) >= cutoff);
    return {
      latest,
      first: readings[0],
      change:
        readings.length > 1 ? latest.weightLb - readings[0].weightLb : null,
      average7: week.reduce((sum, row) => sum + row.weightLb, 0) / week.length,
      averageDays: week.length,
    };
  }
  function chartPoints(data) {
    const rows = daily(data);
    if (!rows.length) return [];
    const start = dateNumber(rows[0].date),
      span = dateNumber(rows[rows.length - 1].date) - start;
    return rows.map((row) => ({
      ...row,
      x: span ? (dateNumber(row.date) - start) / span : 0.5,
    }));
  }
  function activity(entries, today = localDate()) {
    const end = dateNumber(today),
      start = end - 6 * DAY;
    const safe = entries.filter((e) => {
      try {
        dateNumber(e.date);
        return true;
      } catch (error) {
        return false;
      }
    });
    const workouts = safe.filter(
      (e) =>
        e.type === "workout" &&
        e.exId !== "test-5s" &&
        dateNumber(e.date) >= start &&
        dateNumber(e.date) <= end,
    );
    const sleeps = safe
      .filter((e) => e.type === "sleep" && e.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      days: new Set(workouts.map((e) => e.date)).size,
      exercises: workouts.length,
      minutes: workouts.reduce(
        (sum, e) =>
          sum +
          (Number.isFinite(e.workSec) && e.workSec > 0 ? e.workSec / 60 : 0),
        0,
      ),
      latestSleep: sleeps[sleeps.length - 1] || null,
      start: new Date(start).toISOString().slice(0, 10),
      end: today,
    };
  }
  root.ScratchMetrics = {
    LB_PER_KG,
    localDate,
    dateNumber,
    makeRecord,
    document,
    validate,
    merge,
    visible,
    stats,
    chartPoints,
    activity,
  };
})(globalThis);
