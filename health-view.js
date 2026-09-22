(function (root) {
  'use strict';

  const GROUPS = [
    ['activity', 'Daily activity'], ['heartRate', 'Heart rate'], ['sleep', 'Sleep'],
    ['oxygen', 'Blood oxygen'], ['stress', 'Stress'], ['pai', 'PAI'], ['training', 'Training']
  ];
  const missing = 'Not available';
  const FIELD_LABELS = {
    steps: 'Steps', stepTarget: 'Step goal', caloriesKcal: 'Calories', calorieTargetKcal: 'Calorie goal',
    standingHours: 'Standing hours', standingTargetHours: 'Standing goal', lastBpm: 'Latest heart rate',
    restingBpm: 'Resting heart rate', todayBpm: 'Minute heart rate readings', score: 'Sleep score',
    deepMinutes: 'Deep sleep', totalMinutes: 'Total sleep', startMinute: 'Sleep start', endMinute: 'Sleep end',
    stages: 'Sleep stages', naps: 'Naps', recent: 'Oxygen readings', current: 'Stress reading',
    sourceTimeRaw: 'Stress source time', todayHourly: 'Hourly stress', lastWeek: 'Weekly readings',
    total: 'Total PAI', today: 'Today’s PAI', vo2MaxRaw: 'VO₂ max', trainingLoadRaw: 'Training load',
    fullRecoveryTimeRaw: 'Full recovery time'
  };
  const present = value => typeof value === 'number' && Number.isFinite(value);
  const reading = (value, unit = '') => present(value) ? String(value) + (unit ? ' ' + unit : '') : missing;
  const utc = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : missing;
  };
  const clock = minute => {
    if (!present(minute)) return missing;
    const normalized = ((minute % 1440) + 1440) % 1440;
    return String(Math.floor(normalized / 60)).padStart(2, '0') + ':' + String(Math.floor(normalized % 60)).padStart(2, '0') +
      (minute < 0 || minute >= 1440 ? ' (offset ' + minute + ' min)' : '');
  };
  function dayBefore(date, days) {
    const value = new Date(date + 'T12:00:00Z');
    value.setUTCDate(value.getUTCDate() - days);
    return value.toISOString().slice(0, 10);
  }
  function timezone(offset) {
    const ahead = -offset;
    return 'UTC' + (ahead < 0 ? '−' : '+') + String(Math.floor(Math.abs(ahead) / 60)).padStart(2, '0') + ':' + String(Math.abs(ahead) % 60).padStart(2, '0');
  }

  function init({ document, reader }) {
    const status = document.getElementById('health-status');
    const sync = document.getElementById('health-sync');
    const dates = document.getElementById('health-date');
    const content = document.getElementById('health-content');
    let selected = '';
    let syncing = false;
    function el(tag, text, className) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    function add(parent, tag, text, className) { const node = el(tag, text, className); parent.appendChild(node); return node; }
    function field(parent, label, value) {
      const line = add(parent, 'p');
      add(line, 'strong', label + ': ');
      add(line, 'span', value);
    }
    function table(parent, title, headings, rows) {
      const details = add(parent, 'details', undefined, 'health-details');
      add(details, 'summary', title + ' (' + rows.length + ')');
      if (!rows.length) { add(details, 'p', 'No readings in this snapshot.'); return; }
      const tab = add(details, 'table');
      add(tab, 'caption', title);
      const head = add(add(tab, 'thead'), 'tr');
      headings.forEach(heading => { const th = add(head, 'th', heading); th.setAttribute('scope', 'col'); });
      const body = add(tab, 'tbody');
      rows.forEach(row => { const tr = add(body, 'tr'); row.forEach(value => add(tr, 'td', String(value))); });
    }
    function heartChart(parent, values) {
      if (!values.some(present)) { add(parent, 'p', 'No minute readings available.'); return; }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 600 130');
      svg.setAttribute('class', 'health-chart');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Heart rate from midnight. Gaps are missing readings; exact values are in Minute readings below.');
      const finite = values.filter(present);
      const low = Math.min(...finite) - 5, high = Math.max(...finite) + 5;
      let segment = [];
      function flush() {
        if (!segment.length) return;
        const line = document.createElementNS('http://www.w3.org/2000/svg', segment.length === 1 ? 'circle' : 'polyline');
        if (segment.length === 1) {
          line.setAttribute('cx', segment[0][0]); line.setAttribute('cy', segment[0][1]); line.setAttribute('r', '2'); line.setAttribute('fill', '#d8bc78');
        } else {
          line.setAttribute('points', segment.map(point => point.join(',')).join(' '));
          line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#d8bc78'); line.setAttribute('stroke-width', '2');
        }
        svg.appendChild(line); segment = [];
      }
      values.forEach((value, index) => {
        if (!present(value)) { flush(); return; }
        segment.push([10 + index / Math.max(1, values.length - 1) * 580, 115 - (value - low) / (high - low) * 100]);
      });
      flush(); parent.appendChild(svg);
      add(parent, 'p', '00:00 to ' + clock(values.length - 1) + ' · ' + finite.length + ' readings · ' + Math.min(...finite) + '–' + Math.max(...finite) + ' bpm. Gaps mean no reading.');
    }
    function renderValue(card, key, v, date) {
      if (key === 'activity') {
        field(card, 'Steps', reading(v.steps)); field(card, 'Step goal', reading(v.stepTarget));
        field(card, 'Calories', reading(v.caloriesKcal, 'kcal')); field(card, 'Calorie goal', reading(v.calorieTargetKcal, 'kcal'));
        field(card, 'Standing hours', reading(v.standingHours, 'hours')); field(card, 'Standing goal', reading(v.standingTargetHours, 'hours'));
      } else if (key === 'heartRate') {
        field(card, 'Latest reading', reading(v.lastBpm, 'bpm')); field(card, 'Resting', reading(v.restingBpm, 'bpm'));
        const values = v.todayBpm || [];
        heartChart(card, values);
        table(card, 'Minute readings', ['Watch time', 'Heart rate'], values.map((value, i) => [clock(i), reading(value, 'bpm')]));
      } else if (key === 'sleep') {
        field(card, 'Score', reading(v.score)); field(card, 'Total sleep', reading(v.totalMinutes, 'min')); field(card, 'Deep sleep', reading(v.deepMinutes, 'min'));
        field(card, 'Sleep start / end', clock(v.startMinute) + ' / ' + clock(v.endMinute));
        add(card, 'p', 'Times are watch clock offsets from midnight. The watch does not specify which date applies across midnight.');
        table(card, 'Sleep stages', ['Stage', 'Start', 'End'], (v.stages || []).map(row => [row.stage, clock(row.startMinute), clock(row.endMinute)]));
        table(card, 'Naps', ['Duration', 'Start', 'End'], (v.naps || []).map(row => [reading(row.durationMinutes, 'min'), clock(row.startMinute), clock(row.endMinute)]));
      } else if (key === 'oxygen') {
        const recent = (v.recent || []).slice().sort((a, b) => a.utcSeconds - b.utcSeconds);
        const latest = recent[recent.length - 1];
        field(card, 'Latest recorded oxygen', latest ? reading(latest.percent, '%') : missing);
        if (latest) field(card, 'Reading time', utc(latest.utcSeconds * 1000));
        add(card, 'p', 'Available readings from the requested past 24 hours.');
        table(card, 'Oxygen readings', ['Time (UTC)', 'Oxygen'], recent.map(row => [utc(row.utcSeconds * 1000), reading(row.percent, '%')]));
      } else if (key === 'stress') {
        field(card, 'Latest reading', reading(v.current));
        add(card, 'p', 'Stress is the watch’s score. Missing readings are not zero.');
        table(card, 'Hourly stress', ['Watch hour', 'Score'], (v.todayHourly || []).map((value, index) => [clock(index * 60), reading(value)]));
        table(card, 'Seven-day stress', ['Watch date', 'Score'], (v.lastWeek || []).map((value, index) => [dayBefore(date, 6 - index), reading(value)]));
        if (present(v.sourceTimeRaw)) table(card, 'Source time', ['Raw value', 'Time unit'], [[v.sourceTimeRaw, 'Not documented by the watch API']]);
      } else if (key === 'pai') {
        field(card, 'Total PAI', reading(v.total)); field(card, 'Today', reading(v.today));
        table(card, 'Seven-day PAI', ['Watch date', 'PAI'], (v.lastWeek || []).map((value, index) => [dayBefore(date, index), reading(value)]).reverse());
      } else if (key === 'training') {
        add(card, 'p', 'Raw watch values. Recovery units and VO₂ max scaling are not documented, so no conversion is applied.');
        field(card, 'Training load (raw)', reading(v.trainingLoadRaw));
        field(card, 'VO₂ max (raw)', reading(v.vo2MaxRaw));
        field(card, 'Full recovery time (raw)', reading(v.fullRecoveryTimeRaw));
      }
      if (v.truncated) {
        add(card, 'p', 'Some history was shortened to fit this snapshot.');
        const labels = { todayBpm: 'Minute readings', stages: 'Sleep stages', naps: 'Naps', recent: 'Oxygen readings', todayHourly: 'Hourly stress', lastWeek: 'Weekly readings' };
        Object.keys(v.originalCounts || {}).forEach(key => {
          if (labels[key] && Array.isArray(v[key])) add(card, 'p', labels[key] + ': ' + v[key].length + ' of ' + v.originalCounts[key] + ' records retained.');
        });
      }
    }
    function refresh() {
      const snapshot = reader.snapshot();
      const days = snapshot.data.days.slice().sort((a, b) => b.date.localeCompare(a.date));
      const messages = {
        local: days.length ? 'Showing health data saved on this phone. Connect GitHub to refresh.' : 'Connect GitHub to retrieve watch health data.',
        syncing: 'Fetching health data from GitHub…',
        synced: 'Health data synced with GitHub.',
        missing: 'Health data was not found or is not accessible on GitHub. ' + (snapshot.error || 'Check access, then use Sync on the latest Scratch watch app.'),
        error: 'Health sync failed. ' + (snapshot.error || 'Try again.')
      };
      status.textContent = (messages[snapshot.status] || messages.local) + (snapshot.lastSync ? ' Last successful check: ' + utc(snapshot.lastSync) + '.' : '');
      status.dataset.state = snapshot.status;
      sync.disabled = syncing || snapshot.status === 'syncing';
      if (!days.some(day => day.date === selected)) selected = days.length ? days[0].date : '';
      dates.replaceChildren();
      days.forEach(day => { const option = el('option', day.date); option.value = day.date; dates.appendChild(option); });
      dates.value = selected; dates.disabled = !days.length;
      content.replaceChildren();
      const day = days.find(item => item.date === selected);
      if (!day) { add(content, 'p', 'No watch health snapshots yet. Use Sync on the watch, then refresh here.'); return; }
      add(content, 'p', 'Watch date ' + day.date + ' · Collected ' + utc(day.capturedAt) + ' · Watch timezone ' + timezone(day.timezoneOffsetMinutes) + '.');
      if (snapshot.status === 'error' || snapshot.status === 'missing') add(content, 'p', 'Showing the last health data saved on this phone.');
      const grid = add(content, 'div', undefined, 'health-grid');
      GROUPS.forEach(([key, title]) => {
        const group = day.groups[key];
        const card = add(grid, 'section', undefined, 'health-card');
        add(card, 'h3', title);
        if (group.status !== 'ok') {
          add(card, 'p', group.status === 'error' ? 'Could not read this metric.' : 'Not available from this watch snapshot.');
          if (group.reason) add(card, 'p', group.reason);
        } else {
          renderValue(card, key, group.value, day.date);
          if (group.reason) add(card, 'p', group.reason);
          Object.keys(group.preservedFields || {}).forEach(fieldName => {
            const previous = group.preservedFields[fieldName];
            add(card, 'p', (FIELD_LABELS[fieldName] || fieldName) + ' retained from ' + utc(previous.capturedAt) +
              '. ' + previous.reason, 'health-warning');
          });
        }
        add(card, 'p', (group.latestAttempt ? 'Last good reading: ' : 'Collected: ') + utc(group.capturedAt));
        if (group.latestAttempt) add(card, 'p', 'Latest attempt ' + utc(group.latestAttempt.capturedAt) + ': ' + group.latestAttempt.status + '. ' + group.latestAttempt.reason + '. Previous reading retained.');
      });
    }
    dates.addEventListener('change', () => { selected = dates.value; refresh(); });
    sync.addEventListener('click', async () => {
      if (syncing) return;
      syncing = true; sync.disabled = true;
      try { await reader.sync(); refresh(); }
      catch (error) { status.textContent = 'Health sync failed. ' + (error.message || 'Try again.'); status.dataset.state = 'error'; }
      finally { syncing = false; sync.disabled = false; }
    });
    reader.subscribe(refresh);
    refresh();
    return { refresh };
  }
  root.ScratchHealthView = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
