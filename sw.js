// One cached shell per release. Activate only after old clients close.
var CACHE='scratch-v10-dashboard-1.8.0';
var ASSETS=['./','./index.html','./manifest.webmanifest','./weights.js','./weight-sync.js','./health-schema.js','./health-data.js','./health-view.js','./analytics-math.js','./analytics-store.js','./analytics-view.js','./bike-view.js','./accountability.js','./performance-goals.js','./routine-control.js','./today.js','./vendor/jsQR-1.4.0.js','./dashboard.js','./dashboard.css','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',function(event){event.waitUntil(caches.open(CACHE).then(function(cache){return cache.addAll(ASSETS);}));});
self.addEventListener('activate',function(event){event.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(key){return key.indexOf('scratch-')===0&&key!==CACHE;}).map(function(key){return caches.delete(key);}));}));});
self.addEventListener('fetch',function(event){
 if(event.request.method!=='GET')return;
 var url=new URL(event.request.url),scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||url.pathname.indexOf(scope.pathname)!==0)return;
 // Ignore navigation query strings; each active worker owns a coherent shell.
 var path='./'+url.pathname.slice(scope.pathname.length);
 if(ASSETS.indexOf(path)===-1)return;
 event.respondWith(caches.open(CACHE).then(function(cache){return cache.match(new URL(path,scope).href);}).then(function(hit){return hit||fetch(event.request);}));
});
