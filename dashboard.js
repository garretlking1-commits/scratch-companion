(function (root) {
  "use strict";
  const M = root.ScratchMetrics;
  const API = "https://api.github.com/repos/garretlking1-commits/hq-vault/contents/projects/zepp-bip6/data/body-metrics.json";
  const SVG = "http://www.w3.org/2000/svg";
  function number(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }); }
  function enteredNumber(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function dateLabel(value) {
    return new Date(value + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  /** Connects the existing workout journal to a separate body-weight tracker. */
  function init(options) {
    const doc = options.document || root.document;
    const $ = id => doc.getElementById(id);
    let editing = null, deleting = null, deleteReturnFocus = null;
    const tracker = options.tracker || root.ScratchWeightSync.createTracker({
      storage: root.localStorage, fetch: root.fetch.bind(root), getToken: options.getToken,
      api: API, onChange: () => refresh()
    });
    const health = options.healthReader || (root.ScratchHealthData && root.ScratchHealthData.createReader({storage:root.localStorage,fetch:root.fetch.bind(root),getToken:options.getToken}));
    if (health && root.ScratchHealthView) root.ScratchHealthView.init({document:doc,reader:health});
    function text(id, value) { $(id).textContent = value; }
    function message(value, error = false) {
      text("weight-message", value); $("weight-message").hidden = !value;
      $("weight-message").className = "msg " + (error ? "err" : "ok");
    }
    function resetForm() {
      editing = null; $("weight-date").value = M.localDate();
      $("weight-date").max = M.localDate(); $("weight-value").value = "";
      $("weight-unit").value = "lb"; text("weight-save", "Save weigh-in");
      $("weight-cancel").hidden = true;
    }
    function renderStatus(snapshot) {
      const labels = {
        local: "Weight: on this phone. Connect GitHub to back up.",
        pending: "Weight: saved on this phone; GitHub sync pending.",
        syncing: "Weight: syncing with GitHub…",
        synced: "Weight: synced with GitHub" + (snapshot.lastSync ? " · " + new Date(snapshot.lastSync).toLocaleString() : ""),
        error: "Weight: " + (snapshot.error || "Sync failed. Try again.")
      };
      text("weight-status", labels[snapshot.status] || labels.local);
      $("weight-status").dataset.state = snapshot.status;
      $("weight-sync").disabled = snapshot.status === "syncing";
      const workout = options.getWorkoutStatus();
      const workoutLabels = {local:"Workouts & sleep: connect GitHub to sync.",busy:"Workouts & sleep: syncing…",fail:"Workouts & sleep: sync failed. Retry below.",ok:"Workouts & sleep: synced with GitHub"};
      text("workout-status", (workoutLabels[workout.status] || workoutLabels.local) + (workout.status === "ok" && workout.lastSync ? " · " + new Date(workout.lastSync).toLocaleString() : ""));
      $("workout-status").dataset.state = workout.status;
    }
    function renderOverview(data) {
      const stats = M.stats(data), recent = M.activity(options.getEntries());
      text("latest-weight", stats.latest ? number(stats.latest.weightLb) + " lb" : "No weigh-ins");
      text("latest-weight-date", stats.latest ? "Measured " + dateLabel(stats.latest.date) : "Add your first reading below.");
      text("weight-change", stats.change === null ? "—" : (stats.change > 0 ? "+" : "") + number(stats.change) + " lb");
      text("weight-change-date", stats.first && stats.change !== null ? "Since " + dateLabel(stats.first.date) : "Change appears after two readings.");
      text("training-days", recent.days + " / 7 days");
      text("training-minutes", Math.round(recent.minutes) + " work min · " + dateLabel(recent.start) + " to " + dateLabel(recent.end));
      const sleep = recent.latestSleep;
      text("latest-sleep", sleep && Number.isFinite(sleep.totalMin) ? Math.floor(sleep.totalMin / 60) + "h " + Math.round(sleep.totalMin % 60) + "m" : "No sleep data");
      text("latest-sleep-date", sleep ? dateLabel(sleep.date) + (Number.isFinite(sleep.score) ? " · score " + sleep.score : "") : "Open Scratch on the watch, then sync.");
      text("weight-average", stats.average7 === null ? "—" : number(stats.average7) + " lb");
      text("weight-average-date", stats.latest ? "7-day window ending " + dateLabel(stats.latest.date) + " · " + stats.averageDays + " measured day" + (stats.averageDays === 1 ? "" : "s") : "Average of measured days, not missing days.");
    }
    function svgElement(name, attributes, label) {
      const node = doc.createElementNS(SVG, name);
      Object.entries(attributes).forEach(([key,value]) => node.setAttribute(key, String(value)));
      if (label !== undefined) node.textContent = label;
      return node;
    }
    function renderChart(data) {
      const rows = M.chartPoints(data), holder = $("weight-chart");
      holder.replaceChildren(); $("weight-chart-empty").hidden = rows.length > 0;
      text("weight-chart-empty", "Your first weigh-in starts the chart. Each point is a day's average.");
      if (!rows.length) return;
      const values = rows.map(row => row.weightLb), low = Math.min(...values), high = Math.max(...values);
      const padding = Math.max((high-low) * 0.25, 1), min = low-padding, max = high+padding;
      const x = row => 56 + row.x * 594, y = row => 182 - (row.weightLb-min)/(max-min) * 150;
      const chart = svgElement("svg", {viewBox:"0 0 700 230",role:"img","aria-label":"Body weight in pounds over calendar dates. Daily averages; exact readings are in Weight history below."});
      for (let i=0;i<3;i++) {
        const value=min+(max-min)*i/2, yy=182-i*75;
        chart.appendChild(svgElement("line", {x1:56,x2:650,y1:yy,y2:yy,stroke:"#2e3946","stroke-dasharray":"3 5"}));
        chart.appendChild(svgElement("text", {x:44,y:yy+4,"text-anchor":"end",fill:"#aeb8c3","font-size":12}, number(value)));
      }
      const coords = rows.map(row => x(row)+","+y(row)).join(" ");
      if(rows.length>1) chart.appendChild(svgElement("polyline", {points:coords,fill:"none",stroke:"#f2b63c","stroke-width":2.5}));
      rows.forEach(row => {
        const point=svgElement("circle",{cx:x(row),cy:y(row),r:4,fill:"#f2b63c",stroke:"#141b24","stroke-width":2});
        point.appendChild(svgElement("title",{},dateLabel(row.date)+": "+number(row.weightLb)+" lb"));chart.appendChild(point);
      });
      chart.appendChild(svgElement("text", {x:56,y:218,fill:"#aeb8c3","font-size":12},dateLabel(rows[0].date)));
      if(rows.length>1) chart.appendChild(svgElement("text", {x:650,y:218,"text-anchor":"end",fill:"#aeb8c3","font-size":12},dateLabel(rows[rows.length-1].date)));
      holder.appendChild(chart);
    }
    function edit(id) {
      const record = M.visible(tracker.snapshot().data).find(row => row.id === id);
      if (!record) return;
      editing=id; $("weight-date").value=record.date; $("weight-value").value=String(record.inputValue);
      $("weight-unit").value=record.inputUnit; text("weight-save","Save correction");
      $("weight-cancel").hidden=false; message("Editing the reading from " + dateLabel(record.date) + ".");
      $("weight-form").scrollIntoView({behavior:"smooth",block:"center"}); $("weight-value").focus();
    }
    function requestDelete(id) {
      const record=M.visible(tracker.snapshot().data).find(row=>row.id===id);
      if(!record)return;
      deleting=id; deleteReturnFocus=doc.activeElement;
      text("delete-question","Delete the " + enteredNumber(record.inputValue) + " " + record.inputUnit + " reading from " + dateLabel(record.date) + "?");
      $("delete-box").hidden=false; $("delete-cancel").focus();
      $("delete-box").scrollIntoView({behavior:"smooth",block:"center"});
    }
    function renderHistory(data) {
      const body=$("weight-history-body"), rows=M.visible(data).reverse(); body.replaceChildren();
      $("weight-history-empty").hidden=rows.length>0; $("weight-table").hidden=rows.length===0;
      text("weight-history-count", rows.length + " reading" + (rows.length===1 ? "" : "s"));
      rows.forEach(record=>{
        const tr=doc.createElement("tr");
        [dateLabel(record.date),enteredNumber(record.inputValue)+" "+record.inputUnit,number(record.weightLb)+" lb"].forEach(value=>{const td=doc.createElement("td");td.textContent=value;tr.appendChild(td);});
        const actions=doc.createElement("td"); actions.className="history-actions";
        [["Edit",()=>edit(record.id)],["Delete",()=>requestDelete(record.id)]].forEach(([label,handler])=>{
          const button=doc.createElement("button");button.type="button";button.className="ghost";button.textContent=label;
          button.setAttribute("aria-label",label+" weight reading from "+dateLabel(record.date));button.addEventListener("click",handler);actions.appendChild(button);
        });tr.appendChild(actions);body.appendChild(tr);
      });
    }
    function refresh() {
      const snapshot=tracker.snapshot(); renderOverview(snapshot.data);renderChart(snapshot.data);renderHistory(snapshot.data);renderStatus(snapshot);
    }
    async function syncWeights() { await tracker.sync(); refresh(); }
    async function syncAll() {
      $("dashboard-sync").disabled=true;
      try { await Promise.allSettled([options.syncWorkouts(),syncWeights(),health ? health.sync() : Promise.resolve()]); }
      finally { $("dashboard-sync").disabled=false;refresh(); }
    }
    $("weight-form").addEventListener("submit",async event=>{
      event.preventDefault();
      try {
        tracker.save({...(editing ? {id:editing} : {}),date:$("weight-date").value,value:$("weight-value").value,unit:$("weight-unit").value});
        resetForm();message("Weigh-in saved on this phone.");refresh();await syncWeights();
      } catch(error) {message(error.message || "Could not save this reading.",true);refresh();}
    });
    $("weight-cancel").addEventListener("click",()=>{resetForm();message("");});
    $("delete-cancel").addEventListener("click",()=>{deleting=null;$("delete-box").hidden=true;if(deleteReturnFocus && deleteReturnFocus.focus)deleteReturnFocus.focus();});
    $("delete-confirm").addEventListener("click",async()=>{
      if(!deleting)return;
      try {tracker.remove(deleting);if(editing===deleting)resetForm();deleting=null;$("delete-box").hidden=true;message("Reading deleted. Other devices will receive the deletion on sync.");refresh();await syncWeights();}
      catch(error){message(error.message || "Could not delete this reading.",true);}
    });
    $("weight-sync").addEventListener("click",syncWeights);
    $("dashboard-sync").addEventListener("click",syncAll);
    resetForm();refresh();
    return {refresh,syncAll,syncWeights,edit,requestDelete};
  }
  root.ScratchDashboard={init};
})(globalThis);
