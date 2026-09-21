# Scratch Companion

Phone companion PWA for **Scratch**, a Zepp OS workout app for the Amazfit Bip 6.

- Scans the watch's `SCRATCH1` data-QR exports with the phone camera (jsQR)
- Charts load, heart-rate-vs-usual, and sleep trends
- Syncs the training log to a private vault repo via the GitHub Contents API
  (the token lives only in the phone's localStorage — never in this repo)
- Installable: manifest + service worker, offline-capable

Hosted on GitHub Pages from `main`. No build step — plain HTML/CSS/JS.


Sync compatibility regressions (Node.js built-in test runner):

```sh
node --test tests/sync.test.mjs
```

The page's visible `Sync 1.0.18` label identifies the native-watch-compatible merge. Close and reopen older Safari/home-screen copies before syncing. Updating does not clear local data or tokens.
