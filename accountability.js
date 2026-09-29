(function (root) {
  'use strict';
  const DAY = 86400000;
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const iso = value => new Date(value).toISOString().slice(0, 10);
  function week(entries, settings, today) {
    const now = Date.parse(today + 'T00:00:00Z');
    const weekday = new Date(now).getUTCDay();
    const start = now - ((weekday + 6) % 7) * DAY;
    const plans = Array.isArray(settings.trainingPlans) ? settings.trainingPlans : [];
    const completed = new Set((Array.isArray(entries) ? entries : []).filter(entry =>
      entry && entry.type === 'workout' && entry.exId !== 'test-5s' &&
      entry.partial !== true && entry.watch?.partial !== true &&
      typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
      entry.date <= today && (Number(entry.sets) > 0 || Number(entry.workSec) > 0)
    ).map(entry => entry.date));
    const days = Array.from({length: 7}, (_, index) => {
      const date = iso(start + index * DAY);
      const day = new Date(start + index * DAY).getUTCDay();
      const applicable = plans.filter(plan=>plan.from<=date);
      const active = applicable[applicable.length-1];
      const planned = !!active && active.weekdays.includes(day);
      return {date, name: NAMES[day], planned, completed: completed.has(date),
        status: !planned ? 'open' : completed.has(date) ? 'done' : date < today ? 'missed' : date === today ? 'today' : 'upcoming'};
    });
    return {configured: plans.length > 0, start: days[0].date,
      end: days[6].date, target: days.filter(day => day.planned).length, completed: days.filter(day => day.completed).length,
      missed: days.filter(day => day.status === 'missed'), days};
  }
  root.ScratchAccountability = {week};
})(globalThis);
