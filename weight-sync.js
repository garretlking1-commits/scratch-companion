(function (root) {
  "use strict";
  const M = root.ScratchMetrics;
  const KEY = "scratch-body-metrics-v1";
  function createTracker(options) {
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
          "Stored weight data could not be read. It has not been replaced.",
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
          "Could not save weight on this device. Check browser storage and try again.",
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
      error = "Stored weight data could not be read. It has not been replaced.";
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
        ...data.records.map((r) => Date.parse(r.updatedAt)),
      );
      return new Date(Math.max(clock().getTime(), prior + 1)).toISOString();
    }
    function save(input) {
      edit(() => {
        const id =
          input.id ||
          (options.makeId ? options.makeId() : root.crypto.randomUUID());
        const previous = data.records.find((r) => r.id === id);
        if (input.id && (!previous || previous.deleted))
          throw new Error(
            "This reading is no longer available. Add a new reading.",
          );
        const record = M.makeRecord(
          { ...input, id, updatedAt: stamp() },
          M.localDate(clock()),
        );
        return M.document([...data.records.filter((r) => r.id !== id), record]);
      });
    }
    function remove(id) {
      edit(() => {
        if (!data.records.some((r) => r.id === id && !r.deleted))
          throw new Error("Reading not found.");
        const updatedAt = stamp();
        return M.document(
          data.records.map((r) =>
            r.id === id ? { ...r, deleted: true, updatedAt } : r,
          ),
        );
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
            .fetch(options.api + (method === "GET" ? "?ref=main" : ""), {
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
                new Error("GitHub timed out. Weight remains saved locally."),
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
              file.content.length > 8000000
            )
              throw new Error(
                "GitHub weight file is invalid. Nothing was overwritten.",
              );
            sha = file.sha;
            try {
              remote = M.validate(decode(file.content));
            } catch (_) {
              throw new Error(
                "GitHub weight schema is invalid. Nothing was overwritten.",
              );
            }
          } else if (response.status !== 404) {
            if (response.status >= 500 && attempt < 2) continue;
            throw new Error(
              "Weight download failed (GitHub " +
                response.status +
                "). Check connection and token permissions.",
            );
          }
          const merged = M.merge(remote, data);
          persist(merged);
          const sent = fingerprint(merged);
          if (sent !== fingerprint(remote)) {
            let put;
            try {
              put = await request(token, "PUT", {
                message: "Update private body metrics",
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
                "Weight upload failed (GitHub " +
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
          "Stored weight data could not be read. It has not been replaced.";
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
      save,
      remove,
      sync,
      snapshot,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }
  root.ScratchWeightSync = { createTracker };
})(globalThis);
