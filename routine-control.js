(function(root){
  'use strict';
  const API='https://api.github.com/repos/garretlking1-commits/hq-vault/contents/projects/zepp-bip6/data/program-current.json';
  const FIELDS={sets:[1,8],reps:[1,30],holdSec:[5,120],restSec:[0,300],durationMin:[1,90]};
  function validate(program, original){
    if(!program||program.schema!==1||!Array.isArray(program.exercises)||!program.exercises.length||
      !program.sessions||typeof program.sessions!=='object'||Array.isArray(program.sessions)||
      Object.keys(program.sessions).length!==7||Object.keys(program).some(key=>!['schema','revision','exercises','sessions'].includes(key))||
      typeof program.revision!=='string'||!/^[A-Za-z0-9._-]{1,40}$/.test(program.revision))throw Error('Invalid routine. Nothing was uploaded.');
    if(original&&JSON.stringify(program.exercises)!==JSON.stringify(original.exercises))
      throw Error('Exercise definitions changed. Reload the routine.');
    const ids=new Set();
    program.exercises.forEach(ex=>{
      if(!ex||typeof ex.id!=='string'||!/^[a-z0-9-]{1,60}$/.test(ex.id)||ids.has(ex.id)||
        Object.keys(ex).some(key=>key!=='id'&&!Object.prototype.hasOwnProperty.call(FIELDS,key)))throw Error('Invalid exercise catalog.');
      ids.add(ex.id);
      Object.entries(FIELDS).forEach(([key,[min,max]])=>{
        if(ex[key]!==undefined&&(!Number.isInteger(ex[key])||ex[key]<min||ex[key]>max))throw Error('Invalid exercise target.');
      });
    });
    for(let day=0;day<7;day++){
      const row=program.sessions[String(day)];
      if(!Array.isArray(row)||row.length>20||new Set(row).size!==row.length||row.some(id=>!ids.has(id)))
        throw Error('Invalid weekday schedule. Nothing was uploaded.');
    }
    return program;
  }
  function decode(value){
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')),char=>char.charCodeAt(0))));
  }
  function encode(value){
    return btoa(Array.from(new TextEncoder().encode(JSON.stringify(value,null,2)),byte=>String.fromCharCode(byte)).join(''));
  }
  function create(options){
    let current=null,sha=null;
    const request=async(method,body)=>{
      const token=(options.getToken()||'').trim();
      if(!token)throw Error('Add your private vault token in Connection settings first.');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{return await options.fetch(API+(method==='GET'?'?ref=main':''),{
        method,cache:'no-store',signal:controller.signal,
        headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{})
      });}finally{clearTimeout(timer);}
    };
    async function load(){
      const response=await request('GET');
      if(!response.ok)throw Error('Could not load routine from the private vault (GitHub '+response.status+').');
      const body=await response.json();
      if(typeof body.sha!=='string'||typeof body.content!=='string'||body.content.length>100000)
        throw Error('Invalid routine response.');
      const parsed=validate(decode(body.content));
      current=parsed;sha=body.sha;
      return JSON.parse(JSON.stringify(current));
    }
    async function save(day,selected){
      if(!current||!sha)throw Error('Load the routine before editing.');
      if(!Number.isInteger(day)||day<0||day>6)throw Error('Choose a weekday.');
      const revised={...current,revision:'phone-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14),
        sessions:{...current.sessions,[String(day)]:[...selected]}};
      validate(revised,current);
      const response=await request('PUT',{message:'Update Scratch weekday routine',branch:'main',sha,content:encode(revised)});
      if(response.status===409||response.status===422)throw Error('The routine changed elsewhere. Reload it before saving.');
      if(!response.ok)throw Error('Routine was not saved (GitHub '+response.status+').');
      const body=await response.json();
      if(typeof body.content?.sha!=='string')throw Error('GitHub did not confirm the saved routine. Reload before editing again.');
      sha=body.content.sha;current=revised;
      return JSON.parse(JSON.stringify(current));
    }
    return {load,save};
  }
  function init(options){
    const doc=options.document||root.document,$=id=>doc.getElementById(id);
    const control=options.control||create({fetch:root.fetch.bind(root),getToken:options.getToken});
    let program=null;
    const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    function message(value,isError=false){$('routine-message').textContent=value;$('routine-message').className='msg '+(isError?'err':'ok');$('routine-message').hidden=!value;}
    function render(){
      const day=Number($('routine-day').value),holder=$('routine-exercises');holder.replaceChildren();
      if(!program)return;
      const selected=new Set(program.sessions[String(day)]);
      program.exercises.forEach(ex=>{
        const label=doc.createElement('label'),box=doc.createElement('input');box.type='checkbox';box.value=ex.id;box.checked=selected.has(ex.id);
        label.appendChild(box);label.appendChild(doc.createTextNode(' '+(options.getExerciseName?options.getExerciseName(ex.id):ex.id)));
        holder.appendChild(label);
      });
      $('routine-save').disabled=false;
      $('routine-revision').textContent='Current routine: '+program.revision+' · '+names[day];
    }
    $('routine-load').addEventListener('click',async()=>{
      $('routine-load').disabled=true;
      try{program=await control.load();render();message('Routine loaded. Choose exercises, then save this day.');}
      catch(error){message(error.message||'Could not load routine.',true);}
      finally{$('routine-load').disabled=false;}
    });
    $('routine-day').addEventListener('change',render);
    $('routine-form').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!program){message('Load the routine first.',true);return;}
      const checked=[...$('routine-exercises').querySelectorAll('input:checked')].map(box=>box.value);
      const existing=program.sessions[$('routine-day').value];
      const selected=[...existing.filter(id=>checked.includes(id)),...checked.filter(id=>!existing.includes(id))];
      $('routine-save').disabled=true;
      try{program=await control.save(Number($('routine-day').value),selected);render();message('Saved privately. On the watch, tap Sync to vault to download this routine.');}
      catch(error){message(error.message||'Could not save routine.',true);}
      finally{$('routine-save').disabled=false;}
    });
    return {render};
  }
  root.ScratchRoutineControl={create,init,validate};
})(globalThis);
