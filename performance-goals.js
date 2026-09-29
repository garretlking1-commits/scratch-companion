(function (root) {
  'use strict';
  function progress(entries, goal) {
    let best = null, bestDate = null;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || entry.type !== 'workout' || entry.partial === true || entry.watch?.partial === true) continue;
      let result = null;
      if (goal.kind === 'strength' && entry.exId === goal.exerciseId) {
        const loads = entry.watch?.loads, reps = entry.watch?.actualReps;
        if (Array.isArray(loads) && Array.isArray(reps)) {
          loads.forEach((load, index) => {
            if (Number.isFinite(load) && load > 0 && Number.isInteger(reps[index]) && reps[index] >= goal.reps)
              result = Math.max(result || 0, load);
          });
        }
      } else if (goal.kind === 'bike-distance' && ['zone2-bike','sat-bike'].includes(entry.exId)) {
        const distance = entry.watch?.bikeDistance;
        const unit = entry.watch?.bikeDistanceUnit;
        if (Number.isFinite(distance) && distance > 0 && ['mi','km'].includes(unit))
          result = unit === 'km' ? distance / 1.609344 : distance;
      }
      if (result !== null && (best === null || result > best)) {best=result;bestDate=entry.date;}
    }
    return {best, bestDate, target:goal.target, percent:best === null ? null : Math.min(100, Math.round(best / goal.target * 100)), reached:best !== null && best >= goal.target};
  }
  function baselines(entries) {
    const strength = new Map();
    let bike = null;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || entry.type !== 'workout' || entry.partial === true || entry.watch?.partial === true) continue;
      if (['zone2-bike','sat-bike'].includes(entry.exId)) {
        const distance=entry.watch?.bikeDistance,unit=entry.watch?.bikeDistanceUnit;
        if (Number.isFinite(distance) && distance > 0 && ['mi','km'].includes(unit)) {
          const miles=unit==='km'?distance/1.609344:distance;
          if (!bike || miles>bike.miles) bike={miles,date:entry.date};
        }
      }
      if (typeof entry.exId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(entry.exId)) continue;
      const loads=entry.watch?.loads,reps=entry.watch?.actualReps;
      if (!Array.isArray(loads) || !Array.isArray(reps)) continue;
      loads.forEach((load,index)=>{
        if (!Number.isFinite(load) || load<=0 || !Number.isInteger(reps[index]) || reps[index]<1) return;
        const old=strength.get(entry.exId);
        if (!old || load>old.load) strength.set(entry.exId,{exerciseId:entry.exId,load,reps:reps[index],date:entry.date});
      });
    }
    return {strength:[...strength.values()].sort((a,b)=>a.exerciseId.localeCompare(b.exerciseId)),bike};
  }
  root.ScratchPerformanceGoals = {progress,baselines};
})(globalThis);
