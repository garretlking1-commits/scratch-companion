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

The visible `Dashboard 1.3.0` label identifies the dashboard release, retaining native-watch sync compatibility. Close and reopen older Safari/home-screen copies before syncing. Updating does not clear local data or tokens.

## Dashboard and body weight

Tap **Sync to vault** in Scratch on the watch, then **Sync dashboard** on the phone. The dashboard retrieves workout and sleep records and independently syncs manual body-weight entries. QR import remains available as a collapsed backup.

Weight entry defaults to pounds and supports kilograms. Readings retain their entered value/unit and measurement date. The chart uses daily averages spaced by calendar date; the seven-day average ends on the latest measured date and excludes unmeasured days. Corrections keep a stable record ID. Deletions require confirmation and retain tombstones so offline copies cannot resurrect them.

Weight records use a separate private `projects/zepp-bip6/data/body-metrics.json` file in the vault, alongside the unchanged workout log file. The existing browser token is sent only to GitHub. No personal readings or credentials belong in this public repository. Weight and workout sync statuses are separate; a successful local save does not mean a successful remote backup.

Run all regressions:

```sh
node --test tests/*.test.mjs
```

For browser QA, use an isolated local origin and synthetic data, without a real token. The service worker precaches the local dashboard and weight modules for offline entry. Watch metrics retain collection times and unavailable states.


## Watch health (1.2.0)

Scratch 1.0.20 captures available passive readings during manual watch sync: activity,
heart rate, sleep stages/naps, recent oxygen, stress, PAI and raw training metrics.
Allow the requested watch permissions, keep Zepp open on the iPhone, use Sync to vault,
then refresh this dashboard. This does not enable continuous background upload.

`health-data.js` reads only `projects/zepp-bip6/data/watch-health.json` in the private
hq-vault repository. It never writes health data or tokens into this public site.
Weights, workouts and watch health have independent sync outcomes. Local cached
readings survive download failures; collection times remain distinct from fetch times.
A missing file can also mean the token lacks repository access.

`health-schema.js` mirrors the watch snapshot validator; update both contracts together.
Heart rate gaps are missing readings. Sleep clock offsets retain the watch's undocumented
overnight convention. Stress week order differs from PAI and is normalized for display.
Recovery and VO2 values remain raw because API units/scaling are undocumented.
Unsupported or denied sensors display unavailable. Sensor availability and permissions
must still be checked on a physical watch after installing the new build.

Run all tests with `node --test tests/*.test.mjs`.


## Patterns and progress (1.3.0)

The dashboard now computes weight pace, flat trends and conditional goal dates; target-based
sleep shortfall, bedtime variation and bedtime guidance; fresh resting-heart-rate comparisons;
recorded load records, weekly exercise/primary-muscle sets, actual lifting volume and eligible
estimated-strength history; adherence on dates with historical plans; 7/42-day effort trends;
optional habit/sleep associations; and a rough intake/weight-based expenditure estimate.
Each card explains its calculation and reports usable observations. These are descriptive
estimates, not automatic exercise progression. HRV is not inferred from stress or sleep scores.

Scratch 1.0.21 adds optional actual reps after each set, explicit hard-set eligibility, elapsed
exercise time including rests/pauses, final effort (0–10), and a snapshot of the recorded plan.
Unknown reps remain unknown. The current watch timer records one exercise block, not an entire
multi-exercise workout. Watch effort totals therefore describe recorded blocks. Enter total daily
workout time and overall effort in the optional journal to replace that day's watch total.
Confirmed rest days count as zero only when no workout contradicts them; missing days stay unknown.

`analytics-journal.json` in the private vault holds dated optional calorie intake, effort/time,
rest confirmation, habit answers, energy ratings and targets. It syncs separately with the
existing token, conflict retries and deletion tombstones. Calorie entries mean a complete day's
intake. Habit names are saved with each answer so renaming a habit does not relabel history.
Local drafts survive background refresh; corrupt remote files are never overwritten.

Coverage gates include 7 weigh-in days spanning 14 days for pace; 5 nights for bedtime variation;
today plus 14 prior fresh days for resting HR; 7 consecutive known days for effort averages
(the long-term baseline is still calibrating before 42); 7 yes and 7 no paired days for habit
comparisons; and 26 intake days plus 14 weigh-ins across the 28-day expenditure window.
Older workout records remain available but cannot supply missing actual reps or historical plans.

Verification: Node tests cover formula boundaries, missing/stale readings, corrections, private
GitHub merge/conflict/error behavior, watch transport and journal controls. Browser checks use
synthetic local data. Physical 1.0.21 watch entry/permission/sync validation remains a user checkpoint.
