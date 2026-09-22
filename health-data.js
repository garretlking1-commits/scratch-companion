(function (root) {
  "use strict";
  const KEY = "scratch-watch-health-v1";
  const API = "https://api.github.com/repos/garretlking1-commits/hq-vault/contents/projects/zepp-bip6/data/watch-health.json?ref=main";
  const MAX_BYTES = 950000;
  function createReader(options) {
    const validate = root.ScratchHealthSchema.validateHealth;
    const empty = () => ({schema:1,days:[],updatedAt:null});
    let data = empty(), status = "local", error = "", lastSync = null, running = null;
    const listeners = new Set();
    try {
      const cached = options.storage.getItem(KEY);
      if (cached) {
        if (cached.length > MAX_BYTES) throw Error("Saved watch data is too large.");
        const parsed = JSON.parse(cached); data = validate(parsed.data);
        lastSync = typeof parsed.lastSync === "string" && Number.isFinite(Date.parse(parsed.lastSync)) ? parsed.lastSync : null;
      }
    } catch (_) { status = "error"; error = "Saved watch data could not be read. Sync to reload it."; }
    function snapshot() { return {data:JSON.parse(JSON.stringify(data)),status,error,lastSync}; }
    function notify() { listeners.forEach(fn => fn(snapshot())); }
    async function load() {
      const token = options.getToken();
      if (!token) {status="local";error="";notify();return snapshot();}
      status="syncing";error="";notify();
      const controller = new AbortController();
      let timer;
      try {
        const request = async () => {
          const response = await options.fetch(API, {method:"GET",cache:"no-store",signal:controller.signal,
            headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github.raw+json","X-GitHub-Api-Version":"2022-11-28"}});
          if (response.status === 404) return null;
          if (!response.ok) throw Error(response.status===401 || response.status===403 ? "GitHub access failed. Check the saved token and repository access." : "Watch data could not be downloaded (HTTP "+response.status+").");
          const text = await response.text();
          if (text.length > MAX_BYTES) throw Error("Watch history is too large to load safely.");
          return validate(JSON.parse(text));
        };
        const next = await Promise.race([request(),new Promise((_,reject)=>{
          timer=setTimeout(()=>{controller.abort();reject(Error("Watch data request timed out. Try syncing again."));},options.timeoutMs || 20000);
        })]);
        if (next===null) { status="missing";error="No watch health file found, or the token cannot access it."; }
        else {
          const fetched = new Date().toISOString();
          // Persist first: a quota failure must not masquerade as a durable download.
          try { options.storage.setItem(KEY,JSON.stringify({data:next,lastSync:fetched})); }
          catch (_) { throw Error("Phone storage is full or blocked. Watch data was not saved; your previous readings are retained."); }
          data=next;lastSync=fetched;status="synced";
        }
      } catch (failure) {status="error";error=failure instanceof SyntaxError ? "Watch data is malformed. Previous readings are retained." : failure.message || "Watch data sync failed.";}
      finally {clearTimeout(timer);notify();}
      return snapshot();
    }
    function sync() {
      if (!running) running=load().finally(()=>{running=null;});
      return running;
    }
    return {snapshot,sync,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  }
  root.ScratchHealthData={createReader};
})(globalThis);
