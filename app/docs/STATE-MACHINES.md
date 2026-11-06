# Vetro state machines

Pre-release review of 0.5.0, 2026-11-06. The review started on a 0.4.0 working tree and was then ported bug by bug to the 0.5.0 line, checking each one against the 0.5.0 code first (it has sign-in, signed plugins, the updater and the bundled launcher plugin). Where 0.5.0 already handled a case, or handles it differently, the entry says so. One file for every explicit and implicit state machine in the service, the root-agent adapter, the native dock and the dashboard page: states, invariants, transitions, the invalid states the code could actually reach, and what was done about each.

How to read the evidence tags:

- **Confirmed**: reproduced by a test that fails on the code before the fix (the test file is named), or by a trace through the code where every step is a line that exists.
- **Plausible**: the sequence is possible from the code, but it depends on a TV, a browser or a timing that could not be run here.
- **Open**: not fixed. Section 6 says why.

Sections: 1 inventory, 2 service and adapter machines, 3 native dock, 4 persisted state files, 5 dashboard page machines, 6 bug catalog, issue groups and what needs a TV, 7 dock performance review, 8 how to keep this file current.

Priority: **P0** the service or the TV's data is lost or the TV is worn (service crash, flash-write loop, shortcut wipe, loss of the Autorun record); **P1** a feature stays broken until restart or reinstall, or sends the TV a wrong request; **P2** wrong or stale display, cosmetic, or a rare sequence with a self-healing end.

Tests live in `app/tests`, `rooting/tests` and `dock/tests`. Run them with `node app/tests/run.cjs`, `node rooting/tests/run.cjs` and `cd dock/tests && dotnet run`.

---

## 1. Inventory

| ID | Machine | Where | Kind |
|---|---|---|---|
| SM-1 | Root-agent launch lifecycle | `rooting/service/platform.js`, `retry-policy.js` | explicit (`phase`) + implicit (`launching`, `agentConnected`, timers) |
| SM-2 | SDB tunnel and command queue | `rooting/service/sdb-tunnel.js`, `platform.js` `agentExecute` | implicit (serial queue, max 32) |
| SM-3 | MQTT bridge | `app/service/mqtt-bridge.js` | explicit (`state`) |
| SM-4 | Plugin host | `app/service/plugin-host.js` | explicit (`state`, safe mode marker) |
| SM-5 | Physical input bridge | `app/service/main.js` + `physical-input.js` | implicit (flags, generation tokens) |
| SM-6 | Service-wide busy flags | `main.js` (`debloatBusy`, `winsBusy`, ...) | implicit |
| SM-7 | DNS filter, HbbTV, Home order, TV settings | `local-dns.js`, `hbbtv.js`, `home-order.js`, `tv-settings.js` | implicit (`busy` + verified rollback) |
| SM-8 | Dock supervisor | `app/service/dock.js` | implicit (`busy`, `failures`, `nextTry`, `autorunWas`) |
| SM-9 | Quick wins | `app/service/quick-wins.js` | implicit (`busy`, persisted choice, boot marker) |
| SM-10 | Boot tasks | `main.js` (`dnsRestore`, `winsBoot`, `selfStartup`, `restoreInput`) | implicit (retry counters) |
| SM-11 | Native dock controller | `dock/src/Program.cs`, `dock/src/Core` | explicit (`Hidden/Showing/Shown/Hiding`) + timers |
| SM-12 | Dashboard navigation and live monitor | `app/service/dashboard.js` | implicit |
| SM-13 | Dashboard Remapper | `dashboard.js` | implicit |
| SM-14 | Dashboard Quick tab | `dashboard.js` | implicit |
| SM-15 | Dashboard TV settings and HbbTV | `dashboard.js` | implicit |
| SM-16 | Dashboard plugins page | `dashboard.js` | implicit |
| SM-17 | Dashboard process list | `dashboard.js` | implicit |

---

## 2. Service and adapter machines

### SM-1 Root-agent launch lifecycle

State: `phase` (`stopped`, `preparing`, `preflight`, `sdb-handshake`, `launch-command`, `agent-callback`, `connected`, `retrying`) plus the flags `launching`, `agentConnected`, the counter `launchFailures`, the generation `launchGen` and two timers (relaunch, callback wait).

Invariants:

1. At most one launch attempt owns `launching`. A stale attempt (older `launchGen`) never changes it.
2. `launching` is false whenever no attempt is in flight. Otherwise nothing can relaunch the agent after a disconnect.
3. `launchFailures` is zero while the agent is connected and counts consecutive failures otherwise. The delay before the next attempt is `relaunchDelay(launchFailures)`.
4. The diagnostic files (`/opt/usr/home/owner/share/vetro.jsonl`, `/tmp/vetro.jsonl`) never exceed 256 KiB.

| From | Event | To | Notes |
|---|---|---|---|
| stopped | `start()` | preparing → preflight → sdb-handshake | `launching=true`, `launchGen++` |
| sdb-handshake | SDB connect fails | retrying | `launchFailures++`, relaunch timer `relaunchDelay(n)` |
| launch-command | exec fails | retrying | same |
| launch-command | exec ok | agent-callback | callback timer `callbackWait(n)` (≥ 30 s) |
| agent-callback | agent connects (`onConnect`) | connected | `launching=false`, `launchFailures=0` |
| agent-callback | callback timer fires | retrying | `launchFailures++` |
| any in-flight phase | agent connects | connected | the connect handler wins even if an older attempt is mid-handshake |
| connected | agent socket closes | retrying | relaunch after `relaunchDelay(0)` = 8 s |
| any | `stop()` | stopped | counters and timers cleared |

Reachable invalid states found:

- **B1** Fixed 8 s retry forever, and each failure appended the whole adapter state to two files (one on flash, one in RAM). A TV where the agent can never start (Developer Mode off, unsupported .NET runtime) wrote to flash every 8 s for as long as the service ran. Confirmed (`rooting/tests/lifecycle-states.test.cjs`: backoff and bounded log). Fixed: delay 8 s, 16 s, 32 s … up to 5 min; `appendBounded` trims to the newest whole lines.
- **B2** `launching` stayed true when the agent connected while an older handshake was still failing: the failure handler returned early on the stale generation and never cleared the flag, so after the next disconnect nothing relaunched the agent. Confirmed (same test, "launching flag" block). Fixed: `onConnect` clears it, and the catch handler clears it before the stale-generation return.

### SM-2 SDB tunnel and command queue

`agentExecute` runs commands one at a time through a serial queue (max 32 pending). States: queue empty, command running, queue full (new calls rejected with "TV is busy; try again in a few seconds"). A command that exceeds its timeout rejects and the queue continues. The tunnel (`sdb-tunnel.js`) is a TCP relay with one upstream sdbd connection per client; closing the client closes the upstream (tested in `rooting/tests`, "closing the client tears down its upstream sdbd connection"). No invalid state reached.

### SM-3 MQTT bridge

States: `disabled`, `connecting`, `connected`, `reconnecting`. Config is read from `/tmp/vetro-mqtt.json` and `/opt/usr/home/owner/share/vetro-mqtt.json`.

| From | Event | To |
|---|---|---|
| disabled | config enabled | connecting |
| connecting | CONNACK ok | connected |
| connecting / connected | socket error or close | reconnecting |
| reconnecting | timer | connecting |
| any | config disabled | disabled |

Invariant: at most one socket. No invalid state reached (covered by the existing `mqtt-*.test.cjs` suites). The dashboard polls it every 3 s only while the MQTT tab is current.

### SM-4 Plugin host

States per plugin: `stopped`, `running`, `failed`, `suspended` (safe mode), `invalid`. Host-level: `safeMode`, and the `starting` boot marker written before plugins load and removed after a clean start (or a deliberate stop).

| From | Event | To |
|---|---|---|
| stopped | switch on, load ok | running |
| stopped | load throws | failed |
| running | error count reaches `maxErrors` | failed (`_halt`) |
| running | async exception whose stack is inside the plugin folder | failed (`handleCrash`) |
| running | switch off | stopped |
| any | boot marker found at start | suspended (safe mode) until "Resume plugins" |
| any | remove | gone (folder deleted, module cache purged) |

Reachable invalid states found:

- **B11** Reinstalling or removing a plugin left its modules in `require.cache`, so a new version kept running the old code until the service restarted. Confirmed (`plugin-states.test.cjs`, run against a real temp folder; macOS `/var` → `/private/var` needed a realpath-aware purge). Fixed: `forgetModules` before a new load and in `remove()`.
- **B12** An exception thrown later (timer, socket) by plugin code reached the process-level handler and took the whole service down. Confirmed. Fixed: `process.on('uncaughtException')` asks `plugins.handleCrash(e)` first; only an error that is not the plugin's still exits.

### SM-5 Physical input bridge

State: `inputObservers`, `inputPaused` (the user's own "listening" pause), `inputFaultUntil` (temporary pause after a failed rule action), `inputRestoring`, `inputRequest` (generation of the newest `/input` request), `inputSeenAt` (last time a client asked).

Invariants:

1. Helpers (observers or the filter) are started and stopped only by the newest request.
2. A fault pause ends by itself (60 s). A listening pause ends when the user stops it, or when nobody has asked about the input for 5 min.
3. `restoreInput` (every 5 s) restarts the saved interception only when none of `inputPaused`, `inputFaultUntil`, `inputRestoring`, connected is set.

| From | Event | To |
|---|---|---|
| filter running | rule action fails | paused 60 s (`pauseInputFault`) → helpers stopped |
| paused 60 s | time passes, `restoreInput` | filter running |
| any | `POST /input observe` | listening (`inputPaused=true`, observers started) |
| listening | `POST /input filter` ok | filter running (`inputPaused=false`) |
| listening | `POST /input off` | off (`inputPaused=false`) |
| listening | `POST /remap` | off (`inputPaused=false`) |
| listening | no `/input` request for 5 min | filter running again (`stopInput`, `inputPaused=false`) |

Reachable invalid states found:

- **B5** A failed rule action stopped interception with no way back until restart. Confirmed (`service-states.test.cjs`: "a failed remote action pauses interception for a while, not for good"). Fixed with the 60 s fault pause.
- **B6** Two overlapping `/input` requests (double click, retry) left two sets of helpers, or let the older request cancel the newer one. Confirmed on the original `main.js` (stashed it, test failed). Fixed with `inputRequest` and `superseded()` (HTTP 409).
- **B7** The user pressed "Start listening" and closed the page or changed tab: the shortcuts stayed dead for good, because `inputPaused` only cleared on a successful `/input` or `/remap` call. Confirmed by the dashboard trace and `service-states.test.cjs` ("a listening session that nobody ends stops pausing interception"). Fixed on both sides: the page stops listening when leaving the Remapper tab (SM-13), and the service drops a pause nobody has touched for 5 min (the page polls every 1.5 s while the Remapper is open and listening, so a live session never reaches the limit; a hidden tab sends nothing, because the timer is gated on `document.hidden`, so it is released after 5 min, which is intended).

### SM-6 Service-wide busy flags

`debloatBusy` is shared by `/quick`, `/wins`, `/debloat` and `/components/action`: a second request while it is set gets 409 "App change already in progress". Others are per feature: DNS `busy`, HbbTV `busy`, Home order `busy`, TV settings `busy`, dock `busy`, `winsBusy`. Invariant: every flag is cleared on every path, including a synchronous throw.

- **B3, B8** `QuickWins.apply` set `busy=true` and then built the task; a synchronous throw while building left `busy` set for good (B3). Separately, an exception thrown by the callback of `readJsonBody` (any POST handler) escaped to the process and crashed the service (B8). Confirmed (`quick-wins-states.test.cjs`, `service-states.test.cjs`). Fixed: try/catch around task creation; `readJsonBody` turns a throwing callback into HTTP 500; `handleQuick`/`handleWins` call through `Promise.resolve().then(...)`.

### SM-7 DNS filter, HbbTV, Home order, TV settings

Each has `busy` plus a verified change: write, read back, and roll back on mismatch (Home order restores the previous caches and reports "previous caches restored"; TV settings and HbbTV send `expected` and reject with a message when the live value differs). States: idle, applying, verifying, rolling back, idle. Invariant: `busy` is cleared in `finally`. No invalid state reached on the service side. The page-side handling of a rejected `expected` is B26 below.

### SM-8 Dock supervisor

State: `busy`, `failures`, `nextTry`, `lastError`, and the file `vetro-dock.json` (`enabled`, `since`, `fixTizenTube`, `autorunWas`). `autorunWas=1` is the only record that Samsung's Autorun Smart Hub was switched off by Vetro, so it is written before the change and cleared after the restore.

| From | Event | To |
|---|---|---|
| idle | enable / disable / fix / launch | busy (rejects a second call: "Another dock change is in progress") |
| busy | done or failed | idle (`finally`) |
| idle (enabled) | supervisor tick, agent connected, `now ≥ nextTry`, not running | busy → launch; success `failures=0`; failure `failures++`, `nextTry` backs off |
| idle (enabled) | process running | idle, `failures=0` |

- **B13** Several state files were written in place: a power cut (or a full disk) in the middle could leave truncated JSON. In 0.5.0 `vetro-remap.json` (every shortcut and the saved input choice) and the sign-in session file (`auth.js`, every paired browser) were plain in-place writes, and so were the dock's app, input and custom-launcher lists. `Dock.writeState` (which holds `autorunWas`, so Autorun Smart Hub would never be switched back on if it were lost) already wrote a temp file and renamed it, but left the temp file behind when the rename failed. All of them now go through `atomic-file.js` (write `file.tmp`, `renameSync`, remove the tmp file on failure). Confirmed (`state-files.test.cjs`, `input-persistence.test.cjs`). Already atomic and untouched: `hbbtv.js`, `mqtt-bridge.js` `saveConfig`, `quick-wins.js` `save`, `plugin-host.js` state, `keep-removed.js`, `updater.js`.

### SM-9 Quick wins

State: `busy`, the persisted choice per win (`vetro-quick-wins.json`), and a boot marker per `boot_id` so a win is not reapplied twice in one boot.

Invariants: a win that the user switched off is never reapplied by a boot task; the boot marker is set only if a pass really ran.

- **B4** `bootTelemetry` and `bootAmbient` captured the choice at the start and kept applying it after the user changed their mind; `telemetryBoot` was marked even when the pass did not run, so the next boot skipped it. Confirmed (`quick-wins-states.test.cjs`). Fixed: re-read the choice before each poll and each action; `pass()` returns a boolean; mark only if wanted and a pass ran.

### SM-10 Boot tasks

`dnsRestore`, `winsBoot` and `selfStartup` wait for the root agent and retry on a timer; `BOOT_RETRIES = 60` (every 5 s, about 5 min). `restoreInput` runs forever, every 5 s. All three boot timers tick every 5 s.

- **B9** `dnsRestore` gave up after 12 tries (about 60 s). A TV where the agent takes longer to come up (first boot after power loss) never got its domain filter back. Confirmed (`service-states.test.cjs`, "the DNS filter is restored when the root agent connects late"). Fixed: 60 tries like the others.

---

## 3. Native dock (SM-11)

Single main-loop thread (EFL via P/Invoke). Shell commands run as separate processes and never touch the UI.

### Controller phases

`Hidden → Showing → Shown → Hiding → Hidden`. Invariants: one animator tick source; the dock window is shown only after `_dock.Apply(_ctl)` has laid out the current state (no stale first frame); a pending key is cancelled when the dock is shown again.

### Timers and watchers

Animator, idle, clock (only when `Design.ShowClock`), pre-map, key repeat (`_keyTimer`, tracked and cancelled), rescan of `/dev/input` (`WatchNewNodes`), evdev fd handlers. Invariants: every timer is cancelled on hide or exit; an fd slot is reused when freed and closed when `ecore_main_fd_handler_add` fails.

### Home paths

Two ways the user can press Home, and two guards against Samsung's own Home:

| Path | Today (0.5.0) |
|---|---|
| XF86Home reaches the dock (evas key) | `HandleKey` hides the dock and arms the guard (B15, fixed in this review) |
| Home from evdev (the user app owns Home) | same function; a press that follows an evas one within 1.5 s is debounced, so the guard is armed once |
| Guard | one process per Home press that kills Samsung Home at 0.15, 0.3, 0.45, 0.7, 1.2 s; every kill first checks the generation stored in `tvlauncher.guard` |
| User launches Samsung Home (or another guarded target) from the dock | `CancelGuard()` bumps the generation (`LaunchApp`, `Activate`, `HomeGuard.ShouldCancel`), so the remaining kills of the chain do nothing; covers several app ids and the CoBA fallback |

- **B14** After a Home press armed the kill chain, launching Samsung's own Home from the dock was still killed by the remaining steps. In 0.5.0 this is already covered, by a generation counter in `tvlauncher.guard` instead of the cancel file the 0.4.0 tree used (real-shell test "multi-app Home guard…" in `dock/tests/Program.cs`). Nothing was ported.
- **B15** A Home key that reached the dock through evas (not evdev) never armed the guard, so Samsung Home came up over the dock. Fixed: `OnKey` XF86Home arms it.
- **B16** First frame after reopening showed the previous layout. Fixed: `_dock.Apply(_ctl)` before `evas_object_show`.
- **B17** A pending key (waiting for repeat) was delivered into the reopened dock. Fixed: `CancelPendingKey()` in `ShowDock`.
- **B18** The log file grew without bound while the process stayed resident. Fixed: `LogLock` and a 256 KiB trim.
- **B19** `WatchNewNodes` appended to the evdev slot lists on every rescan and logged the same failing node on every pass. Fixed: reuse freed slots, log a failing node once, close the fd when registration fails.

Tests: `dock/tests/Program.cs` (the guard, the controller, "hot paths allocate nothing"): 5130 checks. B15 to B19 are in `Program.cs` (EFL calls, no unit test) and were reviewed by reading; `Program.cs` (EFL calls) is not unit-testable and was reviewed by reading.

**Open (Plausible):** a dock instance that is alive but hung (no frames, still holding the fifo) is not replaced: the supervisor sees "running" and the new launch is skipped. It needs a heartbeat from the dock to the service. Not changed here because it adds a cross-process protocol on a path that cannot be tested without the TV.

---

## 4. Persisted state files

All under `/opt/usr/home/owner/share` unless noted. "Atomic" means written through `atomic-file.js`.

| File | Writer | Atomic | Notes |
|---|---|---|---|
| `vetro-remap.json` | `saveRemap` (main.js) | yes (B13) | remap rules and the saved input preference |
| `vetro-dock.json` | `Dock.writeState` | yes (B13) | `enabled`, `since`, `fixTizenTube`, `autorunWas`; an unreadable file reads as disabled with `autorunWas=null` (`readState` catch) |
| `vetro-quick-wins.json` | `QuickWins.save` | yes (already tmp + rename) | choices and boot marker per `boot_id` |
| `vetro-hbbtv.json` | `hbbtv.js` | yes (already tmp + rename) | the menu value to restore when HbbTV is switched back on |
| `vetro-mqtt.json` (also `/tmp/vetro-mqtt.json`) | `mqtt-bridge.js` `saveConfig` | yes (writes `.tmp` first) | broker config |
| `vetro-probe.json` | `probe.js` | no (plain write, errors swallowed) | cached probe report; regenerated by the next probe |
| `vetro.jsonl` (also `/tmp/vetro.jsonl`) | `platform.js persist()` | append, bounded (B1) | diagnostics only |
| `tvlauncher.log` | native dock | append, bounded (B18) | diagnostics only |
| `tvlauncher.guard` | native dock | write | the current guard generation; a kill of the chain runs only if it still matches |
| plugin boot marker, `plugins/*` | `plugin-host.js` | marker is deliberately a single write | a marker left by a crash starts safe mode |

Invariant for every file whose loss changes what the TV does: write to a temp file and rename. The remap and dock files were the two that were plain writes while losing them changes what the TV does; the rest already used a temp file. `vetro-probe.json` is still a plain write: it only caches a report that the next probe rebuilds.

---

## 5. Dashboard page machines

The page is one inline script. Four module-level timers exist and each is created once: MQTT status (3 s, MQTT tab), plugins list (5 s, plugins tab or an open plugin page), input events (1.5 s, Remapper while listening), clock and monitor (1 s, monitor only on dashboard, processes or apps). None is cleared; each gates on `currentPanel` and `document.hidden`. No duplicated pollers.

### SM-12 Navigation and live monitor

`currentPanel` selects what is shown; entering a tab triggers its loader. Live monitor: `liveUntil` (120 s window), `monitorBusy`, `monitorLastAt[scope]` (5 s summary, 10 s full). Invariant: at most one poll at a time. Calls from `runComponentAction` and `refreshDetail` bypass `monitorBusy`; since they can land out of order, `drawMonitor` drops a sample older than the one on screen (B31, fixed).

### SM-13 Remapper

Client copy `rules`, flags `inputListening`, `inputPreferenceState`, `polling`, `uiOperationBusy.rules`. Every save posts the full list.

Invariants: a save is built from a list that has just been compared with the TV; leaving the tab while listening ends listening.

- **B22** Saves replaced the whole rule list from a client copy that was loaded only at boot: a second browser tab, or a failed first load, made the next save erase the shortcuts saved elsewhere. Confirmed by trace; regression test `dashboard-client-states.test.cjs`. Fixed: `saveRuleSet` reads `/remap` first and refuses (and reloads) if the TV list differs; `loadRules` runs on entering the Remapper and shows an error instead of failing silently.
- **B23** Leaving the Remapper with "Stop listening" not pressed left interception paused (see B7). Fixed: `switchPanel` stops listening when leaving the tab.

Every request goes through `api()`, which cancels it after `API_TIMEOUT_MS` (2 min) and reports "The TV did not answer in time". Before, a half-open connection left `monitorBusy`, `polling`, the MQTT save or a quick-win flag set until the page was reloaded (B35, fixed). Loaders that can be overtaken (`loadDock`, `loadWins`) carry a sequence number, and a write bumps it, so an older GET cannot replace newer data (B34, fixed).

### SM-14 Quick tab

Flags `quickBusy` (groups and leftovers), `winsBusy`, `settingBusy`, confirm flags. Each switch is: native toggle → POST → re-render from the model. Invariant: only one of group, win and leftovers runs at a time (the server has one `debloatBusy`).

- **B27** A group switch while a win was applying, and "clear leftovers" during a group, were sent anyway, got HTTP 409, and the history said "Result not confirmed". Confirmed (test). Fixed: `applyQuick` and `clearLeftovers` check `winsBusy`/`quickBusy`; the switches render disabled while a win runs.
- **B28** If the first app list failed at boot, the Quick tab stayed on "Reading apps…" with the switches disabled, and nothing retried. Confirmed (test). Fixed: `loadQuick` reloads an empty list.

Domain filter (part of this tab and the DNS tab): `dnsDirty` is set when the box is edited or a domain button is pressed, so a reply no longer overwrites unsaved text (B32, fixed); saving clears it. If the TV saves the filter but does not apply it, the switch now shows what the TV holds instead of the old state (B33, fixed).

### SM-15 TV settings and HbbTV

`settingsSection`, `settingBusy`, `hbbtvData`, `tvSettingsData`. Writes send `expected` (the value on screen).

- **B26** A rejected write ("Value changed; refresh before editing") never refreshed the data, so every retry sent the same stale `expected`. Confirmed (test). Fixed: a failed write re-reads the HbbTV value or the TV settings before reporting.
- **B21** `renderPrivacy` called `yes()`, which an earlier commit had removed. It threw whenever the TV reported consent rows, which broke the whole Privacy panel and skipped the HbbTV switch. Confirmed (test). Fixed.

### SM-16 Plugins page

`pluginData`, `pluginBusy`, `pluginView`, `pluginError`, `registryData`. The list reloads every 5 s while the plugins tab or a plugin page is current.

- **B25** The 5 s reload rebuilt the list, which destroyed the file input while its OS dialog was open, so the chosen file installed nothing. Fixed: the reload is skipped while the file input has focus.
- **B29** In 0.5.0 a plugin page is a tab inside the Plugins panel (there is no separate panel or menu entry). Leaving it only removed the iframe's `src` attribute, which does not unload the page, so the plugin kept running hidden. The frame is now set to `about:blank` on the Manage tab and before the next plugin's session is requested, and leaving the Plugins panel returns to Manage. The 5 s refresh already ran while a page was open.

### SM-17 Process list and component drawer

`liveData` is the last sample of any scope; `processData` is the last sample that contains processes. The process list reads `processData` only.

- **B24** The list read `liveData`, so a summary sample (no `processes`) made searching, sorting or clicking a row throw until the next full sample. Confirmed (test). Fixed.
- **B30** Confirming a component action and then opening the process drawer left `operationUpdate` writing to a progress element that no longer existed (TypeError, and the follow-up refresh never ran). Fixed: the progress line is optional.

---

## 6. Bug catalog and issue groups

Impact order within a group. "Test" is the regression test that fails without the fix.

| Group | Issue | Bugs | Priority | Status | Test |
|---|---|---|---|---|---|
| G1 Root agent lifecycle | A TV where the agent cannot start writes the whole adapter state to flash every 8 s; `launching` can stay set so the agent is never relaunched | B1, B2 | **P0** (B1, flash wear and RAM growth), P1 (B2) | fixed | `rooting/tests/lifecycle-states.test.cjs` |
| G2 Service robustness | A throwing handler or a plugin's async error kills the service; boot retries too short | B3, B8, B9, B12 | **P0** (B8, B12, whole service down), P1 (B3, B9) | fixed | `service-states.test.cjs`, `plugin-states.test.cjs` |
| G5 State files | A cut in the middle of a write loses the Autorun record (Smart Hub never switched back on) or every shortcut | B13 | **P0** (low likelihood, unrecoverable) | fixed | `state-files.test.cjs` |
| G3 Input bridge | Shortcuts stay dead after a fault, a double click, or a forgotten listening session | B5, B6, B7, B23 | P1 | fixed | `service-states.test.cjs`, `dashboard-client-states.test.cjs` |
| G4 Quick wins and boot tasks | Stale choices re-applied at boot; false boot markers; stuck `busy` | B3, B4 | P1 | fixed | `quick-wins-states.test.cjs` |
| G7 Native dock | Home guard kills the launched Home, evas Home does not arm it (P1); stale frame, pending key, unbounded log, leaking slots (P2) | B14–B19 | P1 (B14, B15), P2 (rest) | B14 already covered by 0.5.0; B15 to B19 fixed; DLL rebuilt with `dock/build.sh`; **not yet run on the TV** | `dock/tests/Program.cs` (Core only) |
| G8 Dashboard page | Shortcut overwrite from a stale list (P1); broken Privacy panel (P1); busy flags that never clear when a request hangs (P1); processes, stale `expected`, plugin page, drawer, DNS box, late answers (P2) | B21–B35 | P1 (B21, B22, B35), P2 (rest) | fixed | `dashboard-client-states.test.cjs`, `control-feedback.test.cjs` (its mock now models server state) |
| G6 Plugins | Old code survives reinstall | B11 | P2 | fixed | `plugin-states.test.cjs` |

Separate items found while verifying:

- **Test-list update (not a bug):** `app/tests/build.test.cjs` holds an explicit list of packaged files; `package-info.js` already carried the new `service/atomic-file.js`, so only the expected list was stale. The test now also checks that every `require('./x')` of a packaged service file is itself packaged, because a missing sibling crashes the service at start.

### Needs a TV (cannot be proven here)

The unit tests prove the logic with fakes. These need the Q80A. Add them to the 0.5.0 test session (section "TV test session" of `RELEASE-0.5.0.md`), together with what that session already lists:

1. **Dock package.** `app/native/dock/tvlauncher-dotnet.dll` was rebuilt with `dock/build.sh` (netcoreapp3.1, 0 errors; the runtimeconfig is byte-identical). Check the package SHA-256 and that the rebuilt DLL is the one running on the TV.
2. Home guard (already designed in 0.5.0): press Home, then pick Samsung Home from the dock within 1 to 2 s; it must stay open and `tvlauncher.log` must show the chain was cancelled. Press Home with the dock closed, then open it again.
3. B15: with the dock open, a Home key that reaches the dock through evas (for example remote interception on and no evdev Home code) must not let Samsung Home come up over the dock, and the guard command must appear once for that press.
4. B16 and B17: close the inputs panel with Home and reopen it, the first frame starts from the entrance state; pick an app and press Home within 0.3 s, no key lands in the reopened dock.
5. B18 and B19: `tvlauncher.log` stays under 256 KiB; after the remote sleeps and wakes a few times the log has one "lost" and one "watching" line per cycle, no repeated "cannot open", and the open fd count does not climb.
6. B1: with Developer Mode off, `vetro.jsonl` shows attempts at 8, 16, 32 s and stops growing at 256 KiB; after a reboot the agent comes back in about 8 s.
7. B7: start listening in the Remapper, close the page; after 5 min the saved shortcuts work again.
8. B12: a plugin that throws from a timer is marked failed and the service keeps running.

### Open (not fixed)

| ID | What | Why not fixed | Evidence |
|---|---|---|---|
| B10 | Dock instance alive but hung (no frames, still holding the fifo) is not replaced: the supervisor sees "running" and skips the launch | Needs a heartbeat from the dock to the service, a new cross-process protocol that cannot be tested without the TV. Nothing in the logs of the test TV shows it happening | Plausible |
| B37 | `applyQuick`, `setWin` and `clearLeftovers` do not check `keepBusy` (the "Keep removed" operation); the server shares `debloatBusy` with it, so the result is a 409 "App change already in progress" warning, not corrupted state | Cosmetic | Confirmed by reading |
| B38 | `/plugins/install`, `/update/apply`, the registry download and the GitHub update calls use `fetch` directly, so they have no timeout; a hang leaves `pluginBusy` or `updateBusy` set until reload | Needs a shared wrapper for calls that carry a body larger than JSON; not small | Plausible |
| B39 | Startup runs `Promise.all([loadApps(), api('/remap')])` unhandled: a failed or non-array answer leaves `rules` undefined until the Remapper tab reloads it | Self-heals on entering the Remapper (B22) | Confirmed by reading |
| B40 | `loadPlugins` has no sequence guard | Self-heals within 5 s | Confirmed by reading |

Fixed in the second pass, listed so the numbering stays stable: B31 out-of-order monitor samples, B32 DNS box overwritten, B33 unapplied filter shown as off, B34 late loader answers, B35 requests without timeout. B36 (launcher toast timer) belongs to the older `launcher/` page, which 0.5.0 does not have: not applicable.

Extra defects found while porting to 0.5.0 (each fixed with a test): `runRestore` and `eraseVetroData` had no busy guard (a second call cleared `quickBusy` while the first still ran); the `refreshDetail` failure handler wrote to `#componentProgress` unguarded; the sign-in session file (`auth.js`) and the dock app, input and custom-launcher lists were written in place and now go through `atomic-file.js`; the Clear leftovers button is disabled while a quick win runs.

---

## 7. Dock performance review

Goal: minimum lag on the Q80A. What the code already does, what changed, and what only a measurement on the TV can settle.

Already in place (verified by reading and by the allocation tests): the animation frame, key handling and the evdev read path allocate nothing (`hot paths allocate nothing`); linear focus movement at constant speed, no easing allocations; icon dominant colour computed once at load; the dock window is pre-mapped, so showing it is a visibility change, not a window creation; the clock timer runs only when the clock is shown.

Changed in this pass (all reduce work or remove a stall; none changes the look):

- `ShowDock` lays out (`_dock.Apply`) before the window becomes visible: no first frame with the old layout, and no second frame to correct it.
- The log is trimmed at 256 KiB under a lock instead of growing for as long as the process stays resident.
- `WatchNewNodes` reuses slots and does not log on every rescan.
- The key-repeat timer is tracked and cancelled, so a held key does not keep ticking in a hidden dock.

Needs a `--perf` measurement on the Q80A before changing (do not guess):

- Tiered JIT settings of the .NET 3.1 runtime (`TieredCompilation`, `TieredPGO`, ReadyToRun): startup against steady frame time.
- Replacing the `/dev/input` rescan timer with inotify (saves a wakeup per second, but needs another fd handler).
- The remaining blocking `system()` calls in launch and kill paths: time them; they are rare and off the draw path, so the gain may be nil.

---

## 8. Keeping this file current

When a machine changes, change its table here in the same commit and add the test that fails without the change. A new service file under `app/service` needs a line in `app/tests/build.test.cjs` (explicit list) and, for the adapter, in `rooting/build.cjs` and `rooting/tests/package-boundary.test.cjs`. The test files name the machine they cover in their first comment; keep those IDs stable.
