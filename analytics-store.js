(function (root) {
  "use strict";
  const API =
    "https://api.github.com/repos/garretlking1-commits/hq-vault/contents/projects/zepp-bip6/data/analytics-journal.json";
  const DEFAULTS = {
    goalWeightLb: null,
    sleepTargetMinutes: 480,
    wakeMinute: 420,
    bedtimeBufferMinutes: 30,
    habitLabel: "Late caffeine",
    updatedAt: null,
  };
  const DAY_FIELDS = [
    "id",
    "date",
    "updatedAt",
    "deleted",
    "caloriesKcal",
    "effort",
    "sessionMinutes",
    "restDay",
    "habit",
    "habitLabel",
    "energy",
  ];
  function iso(v) {
    if (
      typeof v !== "string" ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString() !== v
    )
      throw Error("Invalid journal timestamp");
  }
  function date(v) {
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      v < "1900-01-01" ||
      !Number.isFinite(Date.parse(v + "T00:00:00Z")) ||
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v
    )
      throw Error("Choose a valid journal date.");
  }
  function localDate(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function keys(obj, allowed) {
    if (
      !obj ||
      typeof obj !== "object" ||
      Array.isArray(obj) ||
      Object.keys(obj).some((k) => !allowed.includes(k))
    )
      throw Error("Unknown or invalid journal fields");
  }
  function numeric(v, min, max, nullable = true) {
    if (nullable && v === null) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw Error("Journal number is outside the allowed range.");
  }
  function row(r) {
    keys(r, DAY_FIELDS);
    date(r.date);
    if (
      r.id !== r.date ||
      typeof r.deleted !== "boolean" ||
      typeof r.restDay !== "boolean" ||
      (r.habit !== null && typeof r.habit !== "boolean")
    )
      throw Error("Invalid journal day");
    if (
      r.habitLabel !== undefined &&
      (typeof r.habitLabel !== "string" ||
        !r.habitLabel.trim() ||
        r.habitLabel.length > 60)
    )
      throw Error("Invalid journal habit label");
    iso(r.updatedAt);
    numeric(r.caloriesKcal, 0, 20000);
    numeric(r.effort, 0, 10);
    numeric(r.sessionMinutes, Number.MIN_VALUE, 1440);
    numeric(r.energy, 1, 10);
    if (r.restDay && (r.effort !== null || r.sessionMinutes !== null))
      throw Error("A rest day cannot include session effort or duration.");
    return r;
  }
  function settings(v) {
    keys(v, Object.keys(DEFAULTS));
    numeric(v.goalWeightLb, 1, 1500);
    numeric(v.sleepTargetMinutes, 60, 1440, false);
    numeric(v.wakeMinute, 0, 1439, false);
    numeric(v.bedtimeBufferMinutes, 0, 240, false);
    if (
      !Number.isInteger(v.sleepTargetMinutes) ||
      !Number.isInteger(v.wakeMinute) ||
      !Number.isInteger(v.bedtimeBufferMinutes) ||
      typeof v.habitLabel !== "string" ||
      v.habitLabel.trim().length < 1 ||
      v.habitLabel.length > 60
    )
      throw Error("Invalid journal settings");
    if (v.updatedAt !== null) iso(v.updatedAt);
    return v;
  }
  function document(days = [], prefs = { ...DEFAULTS }) {
    const sorted = days.slice().sort((a, b) => a.date.localeCompare(b.date));
    return {
      schema: 1,
      days: sorted,
      settings: { ...prefs },
      updatedAt: sorted.reduce(
        (last, r) => (!last || r.updatedAt > last ? r.updatedAt : last),
        prefs.updatedAt,
      ),
    };
  }
  function validate(doc) {
    keys(doc, ["schema", "days", "settings", "updatedAt"]);
    if (doc.schema !== 1 || !Array.isArray(doc.days) || doc.days.length > 36600)
      throw Error("Invalid journal schema");
    const seen = new Set();
    doc.days.forEach((r) => {
      row(r);
      if (r.date > localDate(new Date()))
        throw Error("Journal date cannot be in the future.");
      if (seen.has(r.date)) throw Error("Duplicate journal day");
      seen.add(r.date);
    });
    settings(doc.settings);
    if (doc.updatedAt !== null) iso(doc.updatedAt);
    return document(doc.days, doc.settings);
  }
  function choose(a, b) {
    if (!a) return b;
    if (a.updatedAt !== b.updatedAt)
      return (a.updatedAt || "") > (b.updatedAt || "") ? a : b;
    if (a.deleted !== b.deleted) return a.deleted ? a : b;
    return JSON.stringify(a) > JSON.stringify(b) ? a : b;
  }
  function merge(a, b) {
    validate(a);
    validate(b);
    const days = new Map();
    [...a.days, ...b.days].forEach((r) =>
      days.set(r.date, choose(days.get(r.date), r)),
    );
    return document([...days.values()], choose(a.settings, b.settings));
  }
  const M = { document, validate, merge };
  const KEY = "scratch-analytics-journal-v1";
  function create(options) {
    const listeners = new Set();
    if (typeof options.onChange === "function") listeners.add(options.onChange);
    const clock = options.now || (() => new Date());
    let data = M.document([]),
      acked = JSON.stringify(data),
      lastSync = null;
    let status = "local",
      error = "",
      blocked = false,
      active = null;
    const fingerprint = (value) => JSON.stringify(value);
    function snapshot() {
      return {
        data: JSON.parse(fingerprint(data)),
        dirty: fingerprint(data) !== acked,
        status,
        error,
        lastSync,
      };
    }
    function emit() {
      listeners.forEach((fn) => fn(snapshot()));
    }
    function latestLocal() {
      const raw = options.storage.getItem(KEY);
      return raw ? M.validate(JSON.parse(raw).data) : M.document([]);
    }
    function persist(next, nextAck = acked, nextSync = lastSync) {
      // Merge another open tab's saved readings before every write.
      try {
        next = M.merge(next, latestLocal());
      } catch (_) {
        throw new Error(
          "Stored journal data could not be read. It has not been replaced.",
        );
      }
      const value = JSON.stringify({
        data: next,
        acked: nextAck,
        lastSync: nextSync,
      });
      try {
        options.storage.setItem(KEY, value);
        if (options.storage.getItem(KEY) !== value)
          throw new Error("Verification failed");
      } catch (_) {
        throw new Error(
          "Could not save journal on this device. Check browser storage and try again.",
        );
      }
      data = next;
      acked = nextAck;
      lastSync = nextSync;
    }
    try {
      const raw = options.storage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        data = M.validate(saved.data);
        acked = typeof saved.acked === "string" ? saved.acked : "";
        lastSync = saved.lastSync || null;
        status = fingerprint(data) === acked ? "synced" : "pending";
      }
    } catch (_) {
      blocked = true;
      status = "error";
      error =
        "Stored journal data could not be read. It has not been replaced.";
    }
    function edit(action) {
      try {
        if (blocked) throw new Error(error);
        data = M.merge(data, latestLocal());
        persist(action());
        status = "pending";
        error = "";
        emit();
      } catch (err) {
        status = "error";
        error = err.message;
        emit();
        throw err;
      }
    }
    function stamp() {
      const prior = Math.max(
        0,
        Date.parse(data.settings.updatedAt) || 0,
        ...data.days.map((r) => Date.parse(r.updatedAt)),
      );
      return new Date(Math.max(clock().getTime(), prior + 1)).toISOString();
    }
    function inputNumber(value) {
      if (value === null || value === undefined || String(value).trim() === "")
        return null;
      if (typeof value === "number") return value;
      if (!/^\d+(\.\d+)?$/.test(String(value).trim()))
        throw Error("Enter a valid journal number.");
      return Number(value);
    }
    function saveDay(input) {
      edit(() => {
        keys(input, DAY_FIELDS);
        date(input.date);
        if (input.date > localDate(clock()))
          throw Error("Journal date cannot be in the future.");
        const previous = data.days.find((r) => r.date === input.date);
        const r = {
          caloriesKcal: null,
          effort: null,
          sessionMinutes: null,
          restDay: false,
          habit: null,
          energy: null,
          ...(previous && !previous.deleted ? previous : {}),
          ...input,
          id: input.date,
          date: input.date,
          deleted: false,
          updatedAt: stamp(),
        };
        ["caloriesKcal", "effort", "sessionMinutes", "energy"].forEach((k) => {
          r[k] = inputNumber(r[k]);
        });
        if (r.habit === null) delete r.habitLabel;
        else if (Object.prototype.hasOwnProperty.call(input, "habitLabel"))
          r.habitLabel = input.habitLabel;
        else if (!previous || previous.deleted || previous.habit !== r.habit)
          r.habitLabel = data.settings.habitLabel;
        else if (previous.habitLabel === undefined) delete r.habitLabel;
        row(r);
        return document(
          [...data.days.filter((d) => d.date !== r.date), r],
          data.settings,
        );
      });
    }
    function removeDay(value) {
      edit(() => {
        date(value);
        const old = data.days.find((r) => r.date === value);
        if (!old || old.deleted) throw Error("Journal day not found.");
        const r = { ...old, deleted: true, updatedAt: stamp() };
        return document(
          data.days.map((d) => (d.date === value ? r : d)),
          data.settings,
        );
      });
    }
    function saveSettings(input) {
      edit(() => {
        keys(
          input,
          Object.keys(DEFAULTS).filter((k) => k !== "updatedAt"),
        );
        const next = { ...data.settings, ...input, updatedAt: stamp() };
        [
          "goalWeightLb",
          "sleepTargetMinutes",
          "wakeMinute",
          "bedtimeBufferMinutes",
        ].forEach((k) => {
          next[k] = inputNumber(next[k]);
        });
        next.habitLabel = next.habitLabel.trim();
        settings(next);
        return document(data.days, next);
      });
    }
    function encode(value) {
      return btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(value)), (byte) =>
          String.fromCharCode(byte),
        ).join(""),
      );
    }
    function decode(value) {
      return JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(value.replace(/\s/g, "")), (c) =>
            c.charCodeAt(0),
          ),
        ),
      );
    }
    async function request(token, method, body) {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          options
            .fetch(API + (method === "GET" ? "?ref=main" : ""), {
              method,
              cache: "no-store",
              signal: controller.signal,
              headers: {
                Authorization: "Bearer " + token,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            })
            .then(async (response) => {
              if (method === "GET" && response.ok) {
                const file = await response.json();
                return {
                  ok: response.ok,
                  status: response.status,
                  json: async () => file,
                };
              }
              return response;
            }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(
                new Error("GitHub timed out. Journal remains saved locally."),
              );
            }, 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    async function perform() {
      try {
        if (blocked) throw new Error(error);
        const token = options.getToken().trim();
        if (!token) {
          status = "local";
          error = "";
          emit();
          return snapshot();
        }
        if (/[\r\n]/.test(token))
          throw new Error("Check your GitHub token in Settings.");
        status = "syncing";
        error = "";
        emit();
        for (let attempt = 0; attempt < 3; attempt++) {
          let response;
          try {
            response = await request(token, "GET");
          } catch (err) {
            if (attempt < 2) continue;
            throw err;
          }
          let remote = M.document([]),
            sha;
          if (response.ok) {
            const file = await response.json();
            if (
              typeof file.sha !== "string" ||
              typeof file.content !== "string" ||
              file.content.length > 1300000
            )
              throw new Error(
                "GitHub journal file is invalid. Nothing was overwritten.",
              );
            sha = file.sha;
            try {
              remote = M.validate(decode(file.content));
            } catch (_) {
              throw new Error(
                "GitHub journal schema is invalid. Nothing was overwritten.",
              );
            }
          } else if (response.status !== 404) {
            if (response.status >= 500 && attempt < 2) continue;
            throw new Error(
              "Journal download failed (GitHub " +
                response.status +
                "). Check connection and token permissions.",
            );
          }
          let merged = M.merge(remote, data);
          persist(merged);
          merged = data;
          const sent = fingerprint(merged);
          if (sent.length > 900000)
            throw Error(
              "Journal history is too large to sync. Local history has been retained.",
            );
          if (sent !== fingerprint(remote)) {
            let put;
            try {
              put = await request(token, "PUT", {
                message: "Update private analytics journal",
                content: encode(merged),
                branch: "main",
                ...(sha ? { sha } : {}),
              });
            } catch (err) {
              if (attempt < 2) continue;
              throw err;
            }
            if (!put.ok) {
              if ([409, 422].includes(put.status) || put.status >= 500) {
                if (attempt < 2) continue;
              }
              throw new Error(
                "Journal upload failed (GitHub " +
                  put.status +
                  "). Your changes remain on this device.",
              );
            }
          }
          persist(data, sent, clock().toISOString());
          status = fingerprint(data) === acked ? "synced" : "pending";
          error = "";
          emit();
          return snapshot();
        }
      } catch (err) {
        status = "error";
        error = err.message;
        emit();
      }
      return snapshot();
    }
    function sync() {
      if (active) return active;
      active = perform().finally(() => {
        active = null;
      });
      return active;
    }
    function refresh(event) {
      if (event && event.key !== KEY) return;
      try {
        data = M.merge(data, latestLocal());
        if (status !== "syncing")
          status = fingerprint(data) === acked ? "synced" : "pending";
        error = "";
      } catch (_) {
        status = "error";
        error =
          "Stored journal data could not be read. It has not been replaced.";
      }
      emit();
    }
    if (root.addEventListener) root.addEventListener("storage", refresh);
    return {
      refresh,
      destroy() {
        if (root.removeEventListener)
          root.removeEventListener("storage", refresh);
        listeners.clear();
      },
      saveDay,
      removeDay,
      saveSettings,
      sync,
      snapshot,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }
  root.ScratchAnalyticsStore = {
    create,
    validate,
    merge,
    defaults: () => document(),
  };
})(globalThis);
