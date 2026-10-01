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

The visible `Dashboard 1.8.0` label identifies the dashboard release, retaining native-watch sync compatibility. Close and reopen older Safari/home-screen copies before syncing. Updating does not clear local data or tokens.

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
## Bike comparison (1.4.0)

Scratch 1.0.22 adds optional reported bike resistance level, selected target duration and active
recorded duration, plus seconds below/within/above the configured heart-rate range and seconds
with unknown HR. The dashboard shows dated ride history and average HR over time, with a
reported-level filter. Missing resistance is not inferred from effort or load. Compare the same
machine with similar duration and cadence; machine level numbers are not universal power units.
Partial rides remain labeled. Scratch's recorded duration does not include time after the app
has stopped running. A software checkpoint is not continued background recording.

## Weekly commitment and performance goals (1.6.0)

Choose planned workout weekdays on the dashboard. The current Monday–Sunday week shows
days with at least one completed Scratch exercise or ride, upcoming planned days, and
planned days missed after they end. A plan starts when saved, so earlier days are not
marked missed. Dated plan changes retain earlier missed days.
The first week's target includes only planned dates from that day forward. Plan settings
sync in the existing private `analytics-journal.json` file. No workouts or targets are
preselected.

The performance section shows baselines from completed sets with actual reps and from
manually reported bike distance. Optional strength goals require a logged exercise,
target pounds, and actual reps. Bike distance goals use miles, converting reported km.
Goals sync in the same private journal. The dashboard reports recorded progress; it does
not set a rehabilitation schedule or imply clearance to perform an exercise.

## Phone routine control (1.7.0)

Open **Change your watch routine**, load the private `program-current.json`, choose a
weekday and select from the routine's existing exercise catalog. Saving writes only
that day's schedule to the private vault with a GitHub SHA check. Another change
made in the meantime causes a conflict message and requires a reload, so an older
phone copy cannot silently overwrite a newer routine. Existing exercise definitions
and the watch's recovery-phase filter remain in force. Saving on the phone is not a
watch install: tap **Sync to vault** in Scratch to download the revision. The phone
routine and the dashboard commitment are separate choices.

## Reliability and Today (1.8.0)

The default view now offers one device-local next step, an optional smaller step,
a ten-minute start timer, self-reported completion, a rest choice, and restart.
Today choices are stored only on this browser/device; they do not create workout
records, sync to GitHub, or appear in Day Coach. The timer uses a saved deadline
across reloads; it is an on-screen cue, not a background notification.

History, analytics, routine controls and connection tools remain under **History,
insights & settings**. The QR hash flow opens this section automatically.

Weekly tracking distinguishes unknown records, started/partial work, a saved native
exercise, and a completed historical session. Only matching historical schedules
and sufficient completed native sets can confirm a full session. QR-only records
cannot certify completion. Off-plan activity is counted separately. Rest choices
never hide existing watch activity. Clear every weekday to pause from today, with
an optional future date to restore the last active weekdays. Saving a plan replaces
future scheduled plan changes; past dates are retained. Old dashboard versions
may reject a paused plan rather than overwrite it: close all old dashboard copies
and reopen the 1.8.0 release before editing.

Legacy workout import/sync now validates dates and numeric fields, escapes displayed
values, preserves corrupt storage for recovery, and exposes persistence failures.
Native stable-session migrations and partial-to-complete updates retain identity.
Request deadlines cover response bodies. Edits during upload remain visibly pending.
Cross-tab storage merges are best-effort, not an atomic multi-device database.
**Download local backup** exports Scratch browser data and pending workout drafts,
excluding token keys. This is a recovery export; there is no full backup restore UI.
**Disconnect this device** forgets the token without deleting records. Keep backups
private. The QR dependency is vendored from the verified jsqr 1.4.0 npm archive, with its license and pinned subresource integrity. The previous CDN URL returned 404.

Pages deployment runs regression tests first. The service worker caches a release
shell and activates after old clients close; close all Scratch tabs/home-screen
copies and reopen to receive an update. GitHub requests remain uncached. Initial
installation and external fonts require network access; the QR scanner script is
now part of the offline shell. Camera permissions remain browser-dependent.

Verification commands:

```sh
node --test tests/*.test.mjs
node --test --experimental-test-coverage tests/accountability.test.mjs tests/today.test.mjs tests/service-worker.test.mjs
node tests/browser-smoke.cjs
```

The browser smoke script requires Playwright and system Chrome, uses only synthetic
local data and blocks external requests. Set PLAYWRIGHT_MODULE to an installed
package path when it is not in normal Node resolution, and optionally SCRATCH_QA_DIR
for screenshots. It starts and stops its own loopback-only server.
