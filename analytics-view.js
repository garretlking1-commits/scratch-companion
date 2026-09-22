(function(root){
  'use strict';
  const TITLES={weight:'Weight pace & goal',sleep:'Sleep patterns',restingHeartRate:'Your resting heart rate',strength:'Strength & weekly sets',adherence:'Routine follow-through',effort:'Training effort over time',associations:'Your habits & sleep',nutrition:'Energy expenditure estimate'};
  const METHODS={
    weight:'A straight-line fit across dated daily weight averages estimates weekly change. Goal timing assumes that pace continues. A flat trend is descriptive, not a recommendation to eat less.',
    sleep:'Shortfall adds time below your chosen sleep target on recorded days. Clock-time variation handles midnight. This is target-based shortfall, not a measurement of biological sleep debt. Naps are not added separately to avoid double counting.',
    restingHeartRate:'Today’s fresh resting heart rate is compared with the median of previous recorded days. Older retained readings do not become new measurements.',
    strength:'Volume sums load × actual completed reps. Estimated strength uses eligible hard sets with actual reps, not prescribed reps. Compare the same exercise and equipment. Primary-muscle set counts describe recorded work, not muscle recovery.',
    adherence:'Completed sets are compared with the plan saved when the exercise was recorded. Extra sets are shown separately. Days without a historical plan cannot be scored.',
    effort:'Load = elapsed session minutes × reported effort (0–10). Short- and long-term weighted averages use 7- and 42-day time constants. These are effort units, not TrainingPeaks TSS or a medical readiness score. A manual daily total replaces watch effort for that day.',
    associations:'Compares next-night recorded sleep after days tagged Yes versus No. Unanswered days are excluded. Associations do not show that a habit caused a change.',
    nutrition:'Uses logged calorie intake and trend-weight change to estimate expenditure. Weight-to-energy conversion is approximate; water and body-composition changes affect it. This is not the watch calorie counter or a prescribed calorie target.'
  };
  const numeric=v=>typeof v==='number'&&Number.isFinite(v);
  const fmt=(v,d=1)=>numeric(v)?v.toLocaleString(undefined,{maximumFractionDigits:d}):'Not available';
  const clock=v=>numeric(v)?String(Math.floor(((v%1440)+1440)%1440/60)).padStart(2,'0')+':'+String(((v%60)+60)%60).padStart(2,'0'):'Not available';
  const optional=v=>String(v).trim()===''?null:Number(v);
  function init(options){
    const doc=options.document||root.document,$=id=>doc.getElementById(id),store=options.store;
    let deleting=null,lastSettingsFields=null,lastDayFields=null,habitEdited=false,displayedHabitLabel='';
    const settingsFields=()=>JSON.stringify(['analytics-goal','analytics-sleep','analytics-wake','analytics-buffer','analytics-habit'].map(id=>$(id).value));
    const dayFields=()=>JSON.stringify(['journal-date','journal-calories','journal-effort','journal-minutes','journal-habit','journal-energy'].map(id=>$(id).value).concat($('journal-rest').checked));
    function el(tag,value){const n=doc.createElement(tag);if(value!==undefined)n.textContent=String(value);return n;}
    function add(parent,tag,value){const n=el(tag,value);parent.appendChild(n);return n;}
    function field(parent,label,value){const p=add(parent,'p');add(p,'strong',label+': ');add(p,'span',value);}
    function table(parent,title,headers,rows){
      if(!rows.length)return;
      const detail=add(parent,'details');detail.className='analytics-detail';add(detail,'summary',title+' ('+rows.length+')');
      const wrap=add(detail,'div');wrap.className='table-scroll';const t=add(wrap,'table');add(t,'caption',title);
      const tr=add(add(t,'thead'),'tr');headers.forEach(h=>{const th=add(tr,'th',h);th.setAttribute('scope','col');});
      const body=add(t,'tbody');rows.forEach(row=>{const r=add(body,'tr');row.forEach(v=>add(r,'td',v===null||v===undefined?'Not available':String(v)));});
    }
    function showValues(card,key,v){
      if(key==='weight'){
        field(card,'Weekly pace',numeric(v.weeklyLb)?fmt(v.weeklyLb)+' lb/week ('+fmt(v.weeklyPercent)+'%)':'Not enough weigh-ins');
        field(card,'Trend weight',numeric(v.trendLb)?fmt(v.trendLb)+' lb':'Not available');
        if(v.plateau!==null&&v.plateau!==undefined)field(card,'Trend',v.plateau?'Little change in this window':'Changing in this window');
        field(card,'Projected goal date',v.goalDate||'No reliable projection');
        if(numeric(v.spanDays))field(card,'History span',v.spanDays+' days');
        if(v.asOfDate)field(card,'Last measured date',v.asOfDate);
        if(v.slopeInterval)field(card,'Approximate pace range',fmt(v.slopeInterval[0])+' to '+fmt(v.slopeInterval[1])+' lb/week');
      }else if(key==='sleep'){
        field(card,'7-day shortfall',numeric(v.shortfall7Minutes)?fmt(v.shortfall7Minutes/60)+' hours across '+v.observed7+' recorded days':'Not available');
        field(card,'14-day shortfall',numeric(v.shortfall14Minutes)?fmt(v.shortfall14Minutes/60)+' hours across '+v.observed14+' recorded days':'Not available');
        field(card,'Bedtime variation',numeric(v.regularityMinutes)?fmt(v.regularityMinutes)+' minutes':'More nights needed');
        field(card,'Bedtime for your target',clock(v.bedtimeMinute));
      }else if(key==='restingHeartRate'){
        field(card,'Latest fresh resting rate',numeric(v.currentBpm)?fmt(v.currentBpm,0)+' bpm':'Not available');
        field(card,'Personal baseline',numeric(v.baselineBpm)?fmt(v.baselineBpm)+' bpm':'More days needed');
        field(card,'Difference',numeric(v.deviationBpm)?(v.deviationBpm>0?'+':'')+fmt(v.deviationBpm)+' bpm':'Not available');
      }else if(key==='strength'){
        table(card,'Recorded load records',['Exercise / setup','Best load'],(v.records||[]).map(r=>[r.setup||r.exerciseId,fmt(r.loadLb)+' lb']));
        table(card,'Sets this week',['Exercise / muscle','Sets'],(v.weeklySets||[]).map(r=>[r.name||r.muscle||r.exerciseId||r.exId,fmt(r.sets,0)]));
        table(card,'Exercise sets this week',['Exercise','Sets'],(v.weeklyExerciseSets||[]).map(r=>[r.exerciseId,fmt(r.sets,0)]));
        table(card,'Measured lifting volume',['Date','Exercise / setup','Load × reps'],(v.volume||[]).map(r=>[r.date,r.setup||r.exerciseId,fmt(r.loadReps)+' '+r.unit]));
        table(card,'Estimated strength records',['Exercise / setup','Estimated single-rep load'],(v.estimatedMaxes||[]).map(r=>[r.setup||r.exerciseId,fmt(r.estimatedLb)+' lb']));
        table(card,'Estimated strength history',['Date','Exercise / setup','Estimated single-rep load'],(v.estimatedHistory||[]).map(r=>[r.date,r.setup||r.exerciseId,fmt(r.estimatedLb)+' lb']));
      }else if(key==='adherence'){
        field(card,'Recorded plan completed',numeric(v.percent)?fmt(v.percent)+'%':'Historical plans needed');
        field(card,'Sets completed / planned',fmt(v.completedSets,0)+' / '+fmt(v.plannedSets,0));field(card,'Extra sets',fmt(v.extraSets,0));
      }else if(key==='effort'){
        field(card,'Recent effort average',numeric(v.load7)?fmt(v.load7)+' units':'Not available');field(card,'Longer-term effort average',numeric(v.load42)?fmt(v.load42)+' units':'Not available');
        field(card,'Balance',numeric(v.balance)?fmt(v.balance)+' units':'Not available');if(numeric(v.days))field(card,'Recorded history',v.days+(v.days===1?' day':' days'));
        table(card,'Daily effort history',['Date','Effort units','Source'],(v.history||[]).map(r=>[r.date,fmt(r.load),r.source]));
      }else if(key==='associations'){
        field(card,'Habit',v.habitLabel||store.snapshot().data.settings.habitLabel);
        field(card,'Compared days',fmt(v.taggedN,0)+' yes / '+fmt(v.untaggedN,0)+' no');
        field(card,'Difference in next sleep',numeric(v.nextSleepDifferenceMinutes)?fmt(v.nextSleepDifferenceMinutes)+' minutes':'More matched days needed');
      }else if(key==='nutrition'){
        field(card,'Estimated expenditure',numeric(v.estimatedKcal)?fmt(v.estimatedKcal,0)+' kcal/day':'More complete records needed');
        field(card,'Average logged intake',numeric(v.meanIntakeKcal)?fmt(v.meanIntakeKcal,0)+' kcal/day':'Not available');
        if(numeric(v.windowDays))field(card,'Observation window',v.windowDays+' days');
        if(v.sensitivityKcal)field(card,'Conversion sensitivity',fmt(v.sensitivityKcal[0],0)+'–'+fmt(v.sensitivityKcal[1],0)+' kcal/day (not a confidence interval)');
      }
    }
    function refresh(){
      const snapshot=store.snapshot();
      // Apply remote changes only to pristine forms; never erase a user's draft.
      if(lastSettingsFields!==null&&settingsFields()===lastSettingsFields)setSettings(snapshot.data.settings);
      if(lastDayFields!==null&&dayFields()===lastDayFields&&!deleting)fillDay();
      const labels={local:'Insights journal: on this device. Connect GitHub to back up.',pending:'Insights journal: saved on this device; sync pending.',syncing:'Insights journal: syncing…',synced:'Insights journal: synced with GitHub.',error:'Insights journal: '+snapshot.error};
      $('analytics-status').textContent=(labels[snapshot.status]||labels.local)+(snapshot.lastSync?' Last sync: '+new Date(snapshot.lastSync).toLocaleString():'');
      $('analytics-status').dataset.state=snapshot.status;$('analytics-sync').disabled=snapshot.status==='syncing';
      const result=root.ScratchAnalytics.summary({weights:options.getWeights(),health:options.getHealth(),entries:options.getEntries(),journal:snapshot.data,settings:snapshot.data.settings,today:root.ScratchMetrics.localDate()});
      $('analytics-results').replaceChildren();
      Object.entries(TITLES).forEach(([key,title])=>{
        const section=result[key]||{status:'unavailable',reason:'No data',values:{},samples:0};
        const card=add($('analytics-results'),'article');card.className='analytics-card';card.dataset.state=section.status;
        add(card,'h3',title);add(card,'p',section.reason||'Based on recorded data.');
        showValues(card,key,section.values||{});add(card,'p','Usable observations: '+fmt(section.samples,0)).className='hint';
        const details=add(card,'details');add(details,'summary','How this is calculated');add(details,'p',METHODS[key]);
      });
      renderHistory(snapshot.data.days||[]);
    }
    function message(value,isError=false){$('analytics-message').textContent=value;$('analytics-message').hidden=!value;$('analytics-message').className='msg '+(isError?'err':'ok');}
    function setSettings(s){
      $('analytics-goal').value=s.goalWeightLb===null?'':String(s.goalWeightLb);
      $('analytics-sleep').value=String(s.sleepTargetMinutes/60);$('analytics-wake').value=clock(s.wakeMinute);
      $('analytics-buffer').value=String(s.bedtimeBufferMinutes);$('analytics-habit').value=s.habitLabel;
      lastSettingsFields=settingsFields();
    }
    function fillDay(){
      const row=(store.snapshot().data.days||[]).find(r=>r.date===$('journal-date').value&&!r.deleted)||{};
      [['journal-calories','caloriesKcal'],['journal-effort','effort'],['journal-minutes','sessionMinutes'],['journal-energy','energy']].forEach(([id,key])=>{$(id).value=row[key]===null||row[key]===undefined?'':String(row[key]);});
      const label=store.snapshot().data.settings.habitLabel;
      displayedHabitLabel=label;
      const sameHabit=row.habitLabel===label;
      $('journal-rest').checked=!!row.restDay;$('journal-habit').value=sameHabit?(row.habit===true?'yes':row.habit===false?'no':''):'';
      $('journal-habit-label').textContent='Did “'+label+'” happen?';
      $('journal-habit-note').textContent=typeof row.habit==='boolean'&&!sameHabit?'This entry has an older habit ('+(row.habitLabel||'name not recorded')+'). It stays unchanged unless you choose an answer here.':'';
      habitEdited=false;
      $('journal-delete').disabled=!row.date;deleting=null;$('journal-delete-box').hidden=true;
      lastDayFields=dayFields();
    }
    function renderHistory(days){
      const holder=$('journal-history');holder.replaceChildren();
      const rows=days.filter(r=>!r.deleted).sort((a,b)=>b.date.localeCompare(a.date));
      if(!rows.length){add(holder,'p','No optional daily entries yet.');return;}
      rows.slice(0,60).forEach(row=>{
        const p=add(holder,'p');const b=add(p,'button','Edit '+row.date);b.type='button';b.className='ghost';
        b.addEventListener('click',()=>{$('journal-date').value=row.date;fillDay();$('journal-calories').focus();});
        add(p,'span',' · '+(numeric(row.caloriesKcal)?row.caloriesKcal+' kcal':'Calories not entered')+' · '+(row.restDay?'Rest day':numeric(row.effort)?'Effort '+row.effort+'/10':'Effort not entered'));
      });
      if(rows.length>60)add(holder,'p','Showing the latest 60 entries. Choose an earlier date above to view or correct it.');
    }
    async function sync(){try{await store.sync();}catch(e){message(e.message||'Sync failed.',true);}refresh();}
    $('analytics-settings').addEventListener('submit',async e=>{
      e.preventDefault();try{
        const time=$('analytics-wake').value.split(':').map(Number);
        if(time.length!==2||!time.every(Number.isFinite))throw Error('Choose a wake-up time.');
        const sleep=optional($('analytics-sleep').value),buffer=optional($('analytics-buffer').value);
        if(sleep===null||buffer===null)throw Error('Enter a sleep target and bedtime buffer.');
        store.saveSettings({goalWeightLb:optional($('analytics-goal').value),sleepTargetMinutes:Math.round(sleep*60),wakeMinute:time[0]*60+time[1],bedtimeBufferMinutes:buffer,habitLabel:$('analytics-habit').value.trim()});
        setSettings(store.snapshot().data.settings);
        message('Targets saved on this device.');refresh();await sync();
      }catch(error){message(error.message||'Could not save targets.',true);}
    });
    $('journal-form').addEventListener('submit',async e=>{
      e.preventDefault();try{
        const habit=$('journal-habit').value==='yes'?true:$('journal-habit').value==='no'?false:null;
        store.saveDay({date:$('journal-date').value,caloriesKcal:optional($('journal-calories').value),effort:optional($('journal-effort').value),sessionMinutes:optional($('journal-minutes').value),restDay:$('journal-rest').checked,...(habitEdited?{habit,habitLabel:habit===null?null:displayedHabitLabel}:{}),energy:optional($('journal-energy').value)});
        message('Daily entry saved on this device.');fillDay();refresh();await sync();
      }catch(error){message(error.message||'Could not save this day.',true);}
    });
    $('journal-date').addEventListener('change',fillDay);
    $('journal-habit').addEventListener('change',()=>{habitEdited=true;});
    $('journal-delete').addEventListener('click',()=>{deleting=$('journal-date').value;$('journal-delete-question').textContent='Delete the optional journal entry for '+deleting+'? Weight and watch records stay separate.';$('journal-delete-box').hidden=false;});
    $('journal-delete-cancel').addEventListener('click',()=>{deleting=null;$('journal-delete-box').hidden=true;});
    $('journal-delete-confirm').addEventListener('click',async()=>{if(!deleting)return;try{store.removeDay(deleting);message('Daily entry deleted.');fillDay();refresh();await sync();}catch(e){message(e.message,true);}});
    $('analytics-sync').addEventListener('click',sync);
    $('analytics-settings-reload').addEventListener('click',()=>{setSettings(store.snapshot().data.settings);message('Loaded the saved targets.');});
    $('journal-date').value=root.ScratchMetrics.localDate();$('journal-date').max=root.ScratchMetrics.localDate();
    setSettings(store.snapshot().data.settings);fillDay();store.subscribe(refresh);refresh();
    return {refresh,sync};
  }
  root.ScratchAnalyticsView={init};
})(globalThis);
