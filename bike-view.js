(function (root) {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";
  function number(value, min, max) {
    return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
      ? value
      : null;
  }
  function extract(entries) {
    const rows = [],
      identities = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (
        !entry ||
        entry.type !== "workout" ||
        !["zone2-bike", "sat-bike"].includes(entry.exId)
      )
        return;
      if (
        typeof entry.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
      )
        return;
      const day = Date.parse(entry.date + "T00:00:00Z");
      if (
        !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== entry.date
      )
        return;
      const workSec = number(entry.workSec, 0, 86400);
      if (workSec === null) return;
      const watch =
        entry.watch && typeof entry.watch === "object" ? entry.watch : {};
      const minute = number(entry.tod, 0, 1439.999),
        zone = watch.bikeZone;
      let coverage = null,
        inSec = null,
        lo = null,
        hi = null;
      if (
        zone &&
        number(zone.lo, 1, 300) !== null &&
        number(zone.hi, zone.lo, 300) !== null &&
        zone.hi > zone.lo &&
        ["belowSec", "inSec", "aboveSec", "unknownSec"].every(
          (k) => number(zone[k], 0, 86400) !== null,
        )
      ) {
        const total =
          zone.belowSec + zone.inSec + zone.aboveSec + zone.unknownSec;
        if (total > 0 && total === workSec) {
          coverage = (total - zone.unknownSec) / total;
          inSec = zone.inSec;
          lo = zone.lo;
          hi = zone.hi;
        }
      }
      const row = {
        date: entry.date,
        minute,
        timestamp: day + (minute === null ? 0 : minute * 60000),
        workSec,
        minutes: workSec / 60,
        level: number(watch.bikeResistanceLevel, 0, 1000),
        hrAvg: number(entry.hrAvg, 1, 300),
        coverage,
        inSec,
        lo,
        hi,
        partial: watch.partial === true,
      };
      const keys = [];
      if (typeof watch.sessionId === "string" && watch.sessionId)
        keys.push("session:" + watch.sessionId);
      if (typeof entry.watchId === "string" && entry.watchId)
        keys.push("watch:" + entry.watchId);
      const known = keys.find((k) => identities.has(k));
      let index;
      if (known) {
        index = identities.get(known);
        const previous = rows[index];
        if (
          (previous.partial && !row.partial) ||
          (previous.partial === row.partial && row.workSec > previous.workSec)
        )
          rows[index] = row;
      } else {
        index = rows.length;
        rows.push(row);
      }
      keys.forEach((k) => identities.set(k, index));
    });
    return rows.sort((a, b) => a.timestamp - b.timestamp);
  }
  function init(options) {
    const doc = options.document || root.document,
      $ = (id) => doc.getElementById(id),
      filter = $("bike-level-filter");
    const fmt = (value) =>
      Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
    function element(tag, text) {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function svgElement(tag, attrs, text) {
      const node = doc.createElementNS(SVG, tag);
      Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function table(rows) {
      const wrapper = $("bike-history");
      wrapper.replaceChildren();
      const table = element("table");
      table.appendChild(
        element(
          "caption",
          "Recorded bike rides. Resistance is the level you reported on the machine.",
        ),
      );
      const head = element("thead"),
        headers = element("tr");
      [
        "Date / time",
        "Actual minutes",
        "Resistance level",
        "Average HR",
        "Zone coverage",
        "Record",
      ].forEach((label) => {
        const th = element("th", label);
        th.setAttribute("scope", "col");
        headers.appendChild(th);
      });
      head.appendChild(headers);
      table.appendChild(head);
      const body = element("tbody");
      rows
        .slice()
        .reverse()
        .forEach((row) => {
          const tr = element("tr"),
            time =
              row.minute === null
                ? "Time unknown"
                : String(Math.floor(row.minute / 60)).padStart(2, "0") +
                  ":" +
                  String(Math.floor(row.minute % 60)).padStart(2, "0");
          const cells = [
            row.date + " " + time,
            fmt(row.minutes),
            row.level === null ? "Unknown" : fmt(row.level),
            row.hrAvg === null ? "Unknown" : fmt(row.hrAvg) + " bpm",
            row.coverage === null
              ? "Unknown"
              : Math.round(row.coverage * 100) +
                "% known; " +
                fmt(row.inSec / 60) +
                " min in " +
                row.lo +
                "–" +
                row.hi +
                " bpm",
            row.partial ? "Partial" : "Recorded",
          ];
          cells.forEach((text) => tr.appendChild(element("td", text)));
          body.appendChild(tr);
        });
      table.appendChild(body);
      wrapper.appendChild(table);
    }
    function chart(rows) {
      const wrapper = $("bike-chart");
      wrapper.replaceChildren();
      const svg = svgElement("svg", {
        viewBox: "0 0 720 260",
        role: "img",
        "aria-label":
          "Recorded bike average heart rate over time; missing readings are not connected",
      });
      wrapper.appendChild(svg);
      const measured = rows.filter((row) => row.hrAvg !== null);
      if (!measured.length) {
        svg.appendChild(
          svgElement(
            "text",
            { x: 360, y: 125, "text-anchor": "middle", fill: "currentColor" },
            "No heart-rate readings for these rides.",
          ),
        );
        return;
      }
      const start = rows[0].timestamp,
        end = rows[rows.length - 1].timestamp;
      const rates = measured.map((row) => row.hrAvg),
        min = Math.max(0, Math.min(...rates) - 10),
        max = Math.max(...rates) + 10;
      const x = (row) =>
          start === end
            ? 380
            : 60 + ((row.timestamp - start) / (end - start)) * 620,
        y = (row) => 215 - ((row.hrAvg - min) / (max - min)) * 175;
      svg.appendChild(
        svgElement("line", {
          x1: 60,
          y1: 215,
          x2: 680,
          y2: 215,
          stroke: "currentColor",
          opacity: 0.4,
        }),
      );
      [min, max].forEach((value) =>
        svg.appendChild(
          svgElement(
            "text",
            {
              x: 50,
              y: value === min ? 215 : 40,
              "text-anchor": "end",
              fill: "currentColor",
            },
            fmt(value),
          ),
        ),
      );
      svg.appendChild(
        svgElement(
          "text",
          { x: 60, y: 18, fill: "currentColor" },
          "Average HR (bpm)",
        ),
      );
      svg.appendChild(
        svgElement(
          "text",
          { x: 60, y: 245, fill: "currentColor" },
          rows[0].date,
        ),
      );
      svg.appendChild(
        svgElement(
          "text",
          { x: 680, y: 245, "text-anchor": "end", fill: "currentColor" },
          rows[rows.length - 1].date,
        ),
      );
      let segment = [];
      function draw() {
        if (segment.length > 1)
          svg.appendChild(
            svgElement("polyline", {
              points: segment.map((row) => x(row) + "," + y(row)).join(" "),
              fill: "none",
              stroke: "#d6b568",
              "stroke-width": 2,
            }),
          );
        segment = [];
      }
      rows.forEach((row) => {
        if (row.hrAvg === null) {
          draw();
          return;
        }
        segment.push(row);
      });
      draw();
      measured.forEach((row) => {
        const point = svgElement("circle", {
          cx: x(row),
          cy: y(row),
          r: 4,
          fill: "#d6b568",
        });
        point.appendChild(
          svgElement(
            "title",
            {},
            row.date +
              ": " +
              fmt(row.hrAvg) +
              " bpm, " +
              fmt(row.minutes) +
              " min, resistance " +
              (row.level === null ? "unknown" : fmt(row.level)),
          ),
        );
        svg.appendChild(point);
      });
    }
    function refresh() {
      const all = extract(options.getEntries());
      let selected = filter ? filter.value : "all";
      if (filter) {
        const levels = [
          ...new Set(all.filter((r) => r.level !== null).map((r) => r.level)),
        ].sort((a, b) => a - b);
        filter.replaceChildren();
        [
          ["all", "All rides"],
          ["unknown", "Unknown resistance"],
          ...levels.map((level) => [String(level), "Level " + fmt(level)]),
        ].forEach(([value, label]) => {
          const option = element("option", label);
          option.value = value;
          filter.appendChild(option);
        });
        if (!["all", "unknown", ...levels.map(String)].includes(selected))
          selected = "all";
        filter.value = selected;
      }
      const rows = all.filter(
        (row) =>
          selected === "all" ||
          (selected === "unknown"
            ? row.level === null
            : row.level === Number(selected)),
      );
      $("bike-summary").textContent = rows.length
        ? rows.length +
          " ride" +
          (rows.length === 1 ? "" : "s") +
          " · " +
          fmt(rows.reduce((sum, r) => sum + r.minutes, 0)) +
          " recorded minutes · " +
          rows.filter((r) => r.hrAvg !== null).length +
          " with average HR. Partial rides are included."
        : "No recorded bike rides for this selection.";
      table(rows);
      chart(rows);
    }
    if (filter) filter.addEventListener("change", refresh);
    refresh();
    return { refresh };
  }
  root.ScratchBikeView = { extract, init };
})(globalThis);
