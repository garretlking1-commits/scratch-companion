// Network-first cache: the app always tries the live version, and falls back
// to the last cached copy when offline (e.g. at the gym with no signal).
// GitHub API calls are never cached — sync must always be live.
var CACHE = "scratch-v1";

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(["./", "./index.html", "./manifest.webmanifest"]);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.hostname === "api.github.com") return;
  e.respondWith(
    fetch(e.request)
      .then(function (r) {
        if (r.ok && (url.origin === location.origin || url.hostname.indexOf("fonts.") === 0 || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com")) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
        }
        return r;
      })
      .catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || Response.error();
        });
      })
  );
});
