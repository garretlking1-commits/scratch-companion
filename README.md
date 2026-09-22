# Scratch Companion

Phone companion PWA for **Scratch**, a Zepp OS workout app for the Amazfit Bip 6.

- Retrieves native watch records from the private vault; QR scanning remains a backup
- Tracks dated manual body-weight entries in pounds or kilograms, with correction and deletion
- Charts load, heart-rate-vs-usual, and sleep trends
- Syncs the training log to a private vault repo via the GitHub Contents API
  (the token is stored locally and sent only to GitHub, never included in this repo)
- Installable: manifest + service worker, offline-capable

Hosted on GitHub Pages from `main`. No build step — plain HTML/CSS/JS.


Sync compatibility regressions (Node.js built-in test runner):

```sh
node --test tests/sync.test.mjs
```

The visible `Dashboard 1.1.0` label identifies the dashboard release, retaining native-watch sync compatibility. Close and reopen older Safari/home-screen copies before syncing. Updating does not clear local data or tokens.

## Dashboard and body weight

Tap **Sync to vault** in Scratch on the watch, then **Sync dashboard** on the phone. The dashboard retrieves workout and sleep records and independently syncs manual body-weight entries. QR import remains available as a collapsed backup.

Weight entry defaults to pounds and supports kilograms. Readings retain their entered value/unit and measurement date. The chart uses daily averages spaced by calendar date; the seven-day average ends on the latest measured date and excludes unmeasured days. Corrections keep a stable record ID. Deletions require confirmation and retain tombstones so offline copies cannot resurrect them.

Weight records use a separate private `projects/zepp-bip6/data/body-metrics.json` file in the vault, alongside the unchanged workout log file. The existing browser token is sent only to GitHub. No personal readings or credentials belong in this public repository. Weight and workout sync statuses are separate; a successful local save does not mean a successful remote backup.

Run all regressions:

```sh
node --test tests/*.test.mjs
```

For browser QA, use an isolated local origin and synthetic data, without a real token. The service worker precaches the local dashboard and weight modules for offline entry. Additional watch metrics are described as future capabilities, not displayed as current measurements.
