(function(root){
 'use strict';
 const KEY='scratch-today-v1',STATES=['ready','started','minimum','done','rest'];
 function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
 function blank(){return {action:'',fallback:'',state:'ready',small:false,until:null};}
 function valid(row){return row&&typeof row.action==='string'&&row.action.length<=200&&typeof row.fallback==='string'&&row.fallback.length<=200&&STATES.includes(row.state)&&typeof row.small==='boolean'&&(row.until===null||(Number.isFinite(row.until)&&row.until>0));}
 /** Device-local, user-reported actions. Never writes workout or health records. */
 function createStore({storage,now=()=>Date.now()}){
  function read(){
   try{const text=storage.getItem(KEY);if(!text)return {};
    const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data)||Object.entries(data).some(([date,row])=>!validDate(date)||!valid(row)))throw Error();return data;
   }catch(error){throw Error('Cannot read stored Today actions. Existing data was kept. Export a backup before clearing browser storage.');}
  }
  function get(date){if(!validDate(date))throw Error('Choose a valid date.');return {...(read()[date]||blank())};}
  function write(date,row){
   if(!validDate(date)||!valid(row))throw Error('Invalid action. Use up to 200 characters.');
   const data={...read(),[date]:row},text=JSON.stringify(data);
   try{storage.setItem(KEY,text);if(storage.getItem(KEY)!==text)throw Error();}catch(error){throw Error('Could not save on this device. Keep this page open and retry.');}
   return {...row};
  }
  function plan(date,action,fallback){return write(date,{...blank(),action:action.trim(),fallback:fallback.trim()});}
  function change(date,event){
   const row=get(date);if(!['start','small','minimum','done','rest','reset'].includes(event))throw Error('Unknown action.');
   if(event!=='rest'&&!row.action)throw Error('Choose your next action first.');
   if(event==='small'&&!row.fallback)throw Error('Choose a smaller step first.');
   const state={start:'started',small:'ready',minimum:'minimum',done:'done',rest:'rest',reset:'ready'}[event];
   return write(date,{...row,state,small:event==='small'?true:event==='reset'?false:row.small,until:event==='start'?now()+10*60000:null});
  }
  return {get,plan,change,read};
 }
 function init({document:doc=root.document,storage=root.localStorage,now=()=>Date.now(),onChange=()=>{}}={}){
  const $=id=>doc.getElementById(id),store=createStore({storage,now});
  let shownDate='';
  function date(){const d=new Date(now());return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function error(message){$('today-message').textContent=message;}
  function render(){
   try{
    const key=date(),r=store.get(key),newDay=shownDate!==key;shownDate=key;
    $('today-date').textContent=new Date(now()).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    $('today-action').textContent=r.small?r.fallback:r.action||'What is one small next step?';
    const labels={ready:r.action?'Ready when you are.':'Choose something concrete, like opening your assignment or reviewing your watch routine.',started:'You started. One step is enough to begin.',minimum:'Small step complete. That is progress.',done:'Action complete, reported by you.',rest:'Rest chosen for today. No catch-up list.'};
    $('today-state').textContent=labels[r.state];
    $('today-controls').hidden=!r.action;
    $('today-small').disabled=!r.fallback;
    if(newDay){$('today-editor').open=!r.action&&r.state!=='rest';$('today-input').value=r.action;$('today-fallback').value=r.fallback;}
    $('today-timer').hidden=r.until===null;
    if(r.until!==null){const sec=Math.max(0,Math.ceil((r.until-now())/1000));$('today-timer').textContent=sec?Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')+' left in your 10-minute start':'Ten minutes are up. Continue, take a break, or finish here.';}
   }catch(e){error(e.message);}
  }
  $('today-form').addEventListener('submit',event=>{
   event.preventDefault();try{const action=$('today-input').value.trim();if(!action)throw Error('Write one next step.');store.plan(date(),action,$('today-fallback').value);error('Saved on this device.');$('today-editor').open=false;render();onChange();}catch(e){error(e.message);}
  });
  for(const event of ['start','small','minimum','done','rest','reset'])$('today-'+event).addEventListener('click',()=>{
   try{store.change(date(),event);error('Saved on this device.');render();onChange();}catch(e){error(e.message);}
  });
  $('today-editor').querySelector('summary').addEventListener('click',()=>{if(!$('today-editor').open){try{const r=store.get(date());$('today-input').value=r.action;$('today-fallback').value=r.fallback;}catch(e){error(e.message);}}});
  const tick=root.setInterval(()=>{if(doc.hidden)return;if(date()!==shownDate){render();onChange();return;}try{if(store.get(date()).until!==null)render();}catch(e){error(e.message);}},1000);
  root.addEventListener('storage',event=>{if(event.key===KEY){render();onChange();}});
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden){render();onChange();}});
  render();
  return {render,store,stop:()=>root.clearInterval(tick)};
 }
 root.ScratchToday={createStore,init,KEY};
})(globalThis);
