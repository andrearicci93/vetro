# Vetro as a shell: bundled plugins (proposal for 0.5.0)

**Status: first step done, the rest is a proposal.** The launcher runs as a bundled plugin (`plugin-launcher.js`); everything else below is not implemented. Written on 2026-11-01 against `release-0.4.0` (`601abb4`).
[Back to the plugin guide](plugins.md)

**Decided by the owner (2026-11-01):** the direction is wanted; the legacy routes (`/mqtt`, `/dock`, `/dock/icon`) stay as
aliases, because the bundled plugin is what keeps them working; the launcher goes first. The reason for all of it:
**plugins that can be updated on their own, and things like custom launchers.**

Vetro's own features (Home Assistant/MQTT, the launcher, the remapper, …) are not plugins today. This page asks
whether the core should become a small **shell** that hosts them as *bundled plugins*, what that needs, and in which
order it could be done. It also records what the code looks like today, so the decision rests on the code and not on
memory.

## Why

1. **The plugin API is too small to be useful.** `ctx` has four members (`id`, `dir`, `config`, `execute`). A plugin can
   serve a page, keep settings, run commands and use timers. It cannot react to anything, and it cannot add to the
   remapper or the launcher. Third parties cannot build most of what people would ask for.
2. **Vetro's own features are the best test of the API.** If the launcher and the MQTT link can be written against the
   same API a third party gets, the API is real. If they need a back door, it is not.
3. **Smaller default footprint** on Node 4.4 TVs, and features that can be off, updated and fixed one at a time.

Non-goals for 0.5.0: a security sandbox (see `PLUGIN-ISOLATION.md`; it is separate work and the permissions stay
labels until then), moving every feature, changing how Vetro is installed or updated.

## What the code looks like today

Measured on `release-0.4.0` (the preliminary branch that was merged into 0.5.0).

**Each feature is already one module, required only by `main.js`.**

| Feature | Module(s) | Lines in `main.js` that touch it | Routes | State on the TV | Tests |
| --- | --- | --- | --- | --- | --- |
| Launcher | `dock.js`, `dock-catalog.js` | 12 | `/dock`, `/dock/icon` | `vetro-dock.json`, `vetro-dock-apps.tsv` | 4 |
| MQTT / Home Assistant | `mqtt-bridge.js`, `mqtt.js` | 15 | `/mqtt` | `vetro-mqtt.json` (and a `/tmp` copy) | 6 |
| Remapper | `remap.js` | 22 | `/remap`, `/remap/run` | `vetro-remap.json` | 2 (shared) |
| Physical remote | `physical-input.js` + the native input helper | 17 | `/input` | preference inside `vetro-remap.json` | 2 |

So the modules can move. The tangle is in `main.js`, which wires them together, and in `dashboard.js`.

**Everything is built on the primitive plugins already have.** All of these modules receive `agentExecute`, which is
what `ctx.execute` is. The remapper launches apps with `/usr/bin/app_launcher -s <appId>` and injects keys with
`/usr/bin/input_keyevent <name>`. The key names are X keysyms (`XF86PowerOff`, `XF86AudioRaiseVolume`, `Up`, …):
`KEY_*` names are silently ignored by the TV.

**The links between features are few, and all of them go through `main.js`:**

- **MQTT is fed by `main.js`.** Telemetry through a callback given to `MqttBridge`, the foreground app by a 5 s timer
  (`presence.read()` → `bridge.publishPresence`) and the TV state by a 10 s timer (`tvState.read()` →
  `bridge.publishTvState`). Both timers run only while a broker is connected. They are *polling*, not events.
- **The remapper knows MQTT.** Rules can have a trigger and an action of type `mqtt`. `remap.js` validates the topics and
  refuses an action whose topic is also a trigger (loop guard). `main.js` hands the trigger topics to the bridge
  (`bridge.setTopics`), publishes for `mqtt` actions (`bridge.publish`), rate-limits incoming triggers (500 ms per topic)
  and writes `trigger` / `throttled` events into the bridge's log.
- **The Home Assistant page in the dashboard also edits remapper rules** (`renderMqttRules`, `saveMqttRule`).
- **The launcher is supervised by `main.js`:** a 2 s timer calls `dock.supervise()` and restarts it when the root agent
  connects. The **updater** stops it before an update (`dockStopCommand`) and restarts it afterwards, because the launcher
  is a separate process that a service restart leaves on the old binary.
- **The launcher and MQTT report into `/status` and the diagnostic export** (`launcher`, `mqtt` sections).
- **The dashboard is one template** (`dashboard.js`, 935 lines) with a hard-coded section per feature (`#mqtt`, `#dock`, …)
  and its script inline. Plugin pages today are tabs *inside* the Plugins section, in a sandboxed frame.

**The first attempt exists in the history, and it was a decision, not a failure.** `f92f2d7` ("Plugin host API 1 with
MQTT as the first plugin") added the host and a 33-line `plugin-mqtt.js`; `cac599b` took it out again because the owner
did not want to go in that direction at the time ("Vetro's own features stay as they are"). That direction is now
wanted, so the host, `register()` and `defaultEnabled` are a starting point and not something to undo.

What that first attempt did *not* do matters for this proposal. The plugin was a wrapper: it owned only `start()`,
`stop()` and one read-only route (`/plugins/mqtt/api/config`), while `main.js` still built the bridge. The code says why:
"the bridge itself is built by main.js because rules and actions still reach into it". The coupling described above was
already visible then and was left in place. Moving the *logic* is what the steps below add.

## What "custom launcher" can mean

The launcher is not JavaScript. It is a 64 KB .NET assembly (`tvlauncher-dotnet.dll`, source in `dock/`) that the TV's own
`dotnet` runs as root in its own systemd unit and that draws with EFL. The service only starts, supervises and stops it,
and writes the list it displays: a tab-separated file (`vetro-dock-apps.tsv`: slug, label, app id, fallback, icon file;
at most 40 entries; an app id may also be `key:<XF86 key>` to inject a remote key, or `sys:<appId>` for a system pill).
A plugin bundle is text, plus any helper programs it declares with the `native` permission ([plugins.md](plugins.md#the-native-permission)), and the list's key is deliberately not the key that signs Vetro. That gives three levels:

| Level | What a plugin does | Needs |
| --- | --- | --- |
| **1. Content** | Decides *what the launcher shows*: which apps, their order, extra tiles that inject a key or open an app, profiles ("kids", "cinema"), a different list at night. | A launcher API for plugins (`ctx.launcher`). No change to the .NET code. |
| **2. Look** | Colours, sizes, radii, glow. | The dock reading a theme file at start. Today the look is compiled in (`Design.cs`, `Layout.cs`); this is a change to the C# dock, not to the plugin API. |
| **3. A different launcher** | Brings its own renderer. | A native binary in a plugin and a trust model for it. **Not planned**: the `native` permission can now carry a helper program (the screen-share Shard does), but a renderer that draws the whole shell, run as root from the plugin list, would erase the separation between the list key and the update key. |

**What can be updated separately.** The launcher *plugin* (the JavaScript: routes, supervision, catalog logic) can be a
normal versioned plugin updated from the list. The **.NET assembly stays in the Vetro package** and updates with Vetro.
The plugin states the dock version it needs, and refuses to start the dock if the package has an older one. The same
split applies to any bundled plugin that has a native part.

## Updating the parts

Three kinds of file, three ways to update, and each has a different trust root:

| Part | Updated by | Signed with | Today |
| --- | --- | --- | --- |
| Launcher **plugin** (JavaScript: routes, supervision, catalog logic) | the plugin list, like any plugin | the plugin-list key | **Not possible yet**: `install()` refuses to replace a bundled plugin. Needs a decision: how a newer version from the list takes the place of the bundled one. |
| Launcher **content** (which apps, order, profiles) | a plugin (level 1 above) | the plugin-list key | Needs `ctx.launcher`. |
| Launcher **.NET assembly** (`native/dock/tvlauncher-dotnet.dll`) and its pictures | Vetro's self-update | the Vetro **update** key (offline, different from the list's) | **Works today.** |

**How the .NET part is updated now.** `native/` is one of the paths the updater may replace (`service/*.js`, `native/`,
`payload/`, `index.html`, `icon.png`). The updater verifies the signature and every SHA-256, swaps only the files whose hash
changed, stops the launcher if one of `native/dock/*` changed and starts it again from the new files, and a watchdog puts the
old files back if the new version does not confirm itself within 4 minutes. This is why `main.js` still holds
`dockStopCommand` and `restartDockAfterUpdate`: the launcher is a separate process that a service restart would leave on the
old binary.

**Granularity.** From reading `updater.js` (not run): the mechanism already replaces *only changed files*, so a bundle in
which just the assembly changed swaps just the assembly. What is missing is process, not mechanism:
- the manifest's `version` must be higher than the installed one, and `service/build-info.js` has to be in the bundle, or
  the dashboard would keep offering the same update. A "launcher-only" update is therefore a small Vetro release;
- `rooting/release.cjs` builds a bundle from every file; a mode that builds from a chosen subset does not exist yet.

**Requirements between a plugin and the part it drives.** The launcher assembly has no version number of its own. Since it
ships with Vetro, a plugin states what it needs in terms of Vetro's version:

```json
{ "requires": { "vetro": ">=0.5.1" } }
```

If the installed Vetro is older, the dashboard says "needs Vetro 0.5.1 or newer" and the plugin does not start. (A level-2
theme file, or any new capability of the assembly, is what raises that number.)

**What this means for the goal.** The more of a "launcher update" is data or JavaScript (content now; look once the dock
reads a theme file), the less often the .NET has to change, and that is the only part that needs a Vetro release.

## Proposed architecture

**Core (the shell)**, stays in `main.js` and its modules: HTTP server and sign-in, platform adapter and root agent,
plugin host, self-update, telemetry reader, app inventory, **the remapper and the physical-remote pipeline**, and every
other feature not named below (Quick settings, privacy, debloat, leftovers, DNS filter, …).

**Bundled plugins**, shipped in the Vetro package, on by default, same API as a third party:

| Plugin | From | Notes |
| --- | --- | --- |
| `launcher` | `dock.js`, `dock-catalog.js` | needs a lifecycle that also covers the updater |
| `home-assistant` | `mqtt-bridge.js`, `mqtt.js` | needs the services and the remapper extension points below |

The **remapper stays in the core**. It owns the input pipeline (the native helper that intercepts the remote, the action
queue, the 8-action limit) and depends on root helpers. What changes is that it becomes *extensible*: plugins register
trigger sources and action types, and `mqtt` stops being hard-coded.

Other features can follow the same way later. They are not part of this proposal.

## API additions (sketch, `apiVersion: 2`)

Additive: a plugin written for API 1 keeps working. A plugin that needs more declares `"apiVersion": 2`.

```js
module.exports = function (ctx) {
    // 1. Read-only services: what main.js polls for MQTT today, available on demand.
    ctx.vetro.version                // Vetro version
    ctx.vetro.telemetry()            // the same object /status builds
    ctx.vetro.presence()             // Promise: foreground app
    ctx.vetro.tvState()              // Promise: audio, source
    ctx.vetro.apps()                 // Promise: installed apps (the inventory)

    // 2. Remapper extension points.
    ctx.remap.addTrigger({ type: 'mqtt',
        validate: function (rule) {},                 // throws on a bad rule
        start: function (emit) {}, stop: function () {} });   // emit(value, payload) fires matching rules
    ctx.remap.addAction({ type: 'mqtt',
        validate: function (action) {},
        run: function (action) { return Promise.resolve(); } });
    ctx.remap.rules()                // read-only, to compute the topics to subscribe to

    // 3. Reporting.
    ctx.report(name, function () { return {}; })     // adds a section to /status and the diagnostic export

    // 3b. The launcher's content (level 1 above).
    ctx.launcher.entries()           // the list the dock shows
    ctx.launcher.set(entries)        // a new list: validated like dock-catalog.js (40 entries, app ids, icon paths)

    // 4. What the plugin needs from Vetro: a manifest field, checked by the host before start ("requires": { "vetro": ">=0.5.1" }).

    // 5. A hook for the updater.
    return { start, stop, status, route, beforeUpdate, afterUpdate };
};
```

Notes:

- **Services are polled, not pushed.** MQTT only needs read-on-demand, so the first version needs no event bus. Real
  push events (a key pressed, an app opened) are a separate, later addition and are what third parties would want most.
- **Who gets these members?** `ctx.vetro`, `ctx.remap` and `ctx.report` are given **only to bundled plugins at first**.
  A third-party plugin sees the same four members as today. Opening them to everyone is a later decision, because until
  isolation exists a plugin that can register remapper actions is a plugin that can run them. Say so in the guide.
- **Permissions** for the new members would be new labels (for example `remap`). They are labels like `exec`: not
  enforced until a plugin runs in its own process.

## Dashboard

- **Navigation from data.** `/plugins` already lists each plugin with its `ui.label`. Bundled plugins appear as
  first-class entries in the sidebar (name, group, icon from the manifest), not as tabs inside Plugins. The hard-coded
  `#mqtt` and `#dock` sections go away.
- **Same look.** A page in a sandboxed frame cannot see the dashboard's CSS. The host can serve the design tokens itself
  (for example `GET api/_vetro.css`, answered by the host before the plugin's `route()`), so every plugin page can
  `<link href="_vetro.css">`. Bundled and third-party pages then look alike, and the sandbox is unchanged.
- **Home Assistant page and remapper rules.** The rules editor belongs to the remapper, not to MQTT. It moves into the
  Remapper page and lists every trigger/action type that is registered; the MQTT plugin's page keeps only the connection.

## Compatibility

| | Plan |
| --- | --- |
| Routes `/mqtt`, `/dock`, `/dock/icon` | Used by the dashboard and by scripts. **Decided: keep them** as aliases that forward to the plugin's routes for the whole 0.5.x series. The plugin is what makes them work. |
| State files | The plugins read the existing files (`vetro-mqtt.json`, `vetro-dock.json`, …) first and write the same format. No migration step for a user. |
| `/status`, diagnostic export | `ctx.report` keeps the `launcher` and `mqtt` sections under the same names. |
| Home Assistant discovery | Entity ids and topics must not change, or users lose their history. |
| The updater and the launcher | `beforeUpdate` / `afterUpdate` replace `dockStopCommand` and `restartDockAfterUpdate`. |

## Open questions

1. **Safe mode.** *What it is:* the host writes a `starting` marker when Vetro starts and removes it after the service has
   stayed up for 60 s (or on a deliberate stop). If the next start finds the marker, the last boot did not survive, so
   the host starts with every plugin **paused** ("Suspended"): still listed, never run, so the plugin that crashes Vetro
   can be switched off or removed. **Resume** takes effect at the next restart. It exists so that one bad plugin cannot
   put Vetro in a crash loop and lock the owner out of the dashboard. *The question:* today it pauses everything,
   bundled plugins included, so the launcher would no longer be supervised or reachable on its routes. The dock process
   itself is a separate unit and the worst case of a dead dock is Samsung's Home back, so this is safe but visible.
   **Recommendation: two levels.** The first interrupted boot pauses third-party plugins only; if the next boot is also
   interrupted, it pauses bundled ones too. A banner in the dashboard says which level is active. Not decided.
   **What the pilot does for now:** bundled plugins are simply *exempt* from safe mode (they keep running), which is no
   worse than today, where nothing protects against a crash in Vetro's own code. The two-level version can replace it
   without changing the plugin API.
2. **Trust.** Bundled plugins are signed with the Vetro release key as part of the package, not with the plugin-list
   key. They must not appear as "installed from the list", must not be removable the same way, and an update replaces
   them as part of Vetro.
3. **Switching a bundled plugin off.** A user turning the launcher off from the Plugins page should get exactly what the
   launcher's own switch does today (including the confirmation and `turnOffAutorun`).
4. **Boot order.** MQTT currently starts at the end of `main.js`, after the remap rules are loaded. A plugin starts when the
   host does. The remapper's rules and the registered types must be ready first.

## Order of work

Each step ships only when its exit criterion holds, on a real TV for anything that touches the launcher or the input.

1. **Host groundwork (done on this branch, tests only).** Bundled registration (default on, not removable, listed as bundled), the extended
   `ctx` for bundled plugins (`ctx.vetro`, `ctx.report`), the route aliases. *Exit: a bundled test plugin runs, appears
   in `/plugins`, cannot be removed, and its alias route answers; the plugin-host tests pass.*
2. **Launcher as a plugin (pilot; done on this branch, tests only, not tried on a TV).** Lifecycle, supervision timer, `/dock` routes and the updater hooks move
   into the plugin; `/dock` and `/dock/icon` become aliases. *No change to the dashboard in this step.* *Exit: the 4
   dock tests pass against the plugin; on a TV the launcher survives a reboot, a Vetro restart and a self-update.*
3. **Dashboard from data and `_vetro.css`.** Bundled plugins in the sidebar; the Launcher section stops being hard-coded.
4. **Launcher level 1 (content API) and `requires`.** `ctx.launcher`: a plugin adds, removes or reorders entries of the list the dock
   shows. First consumer: one example plugin in the plugin list. *Exit: a third-party plugin changes the launcher
   without touching Vetro.* Level 2 (theme file) is a separate change to the C# dock.
5. **Remapper extension points**, then **Home Assistant as a plugin** (moves to those points; discovery and topics unchanged;
   the 6 MQTT tests pass; a real broker shows the same entities before and after).
6. **Decide on opening the new `ctx` members to third parties**, together with the isolation work.

If step 2 shows the model does not fit, nothing after it is built and 0.5.0 ships the groundwork only.

## What exists on this branch

- `plugin-host.js`: `register()` accepts `bundled: true` (on by default); bundled plugins get `ctx.vetro` (the services the
  host was given: `agentConnected()`, `json()`, `readJson()`), are listed under `bundled` in `GET /plugins` and not in
  `plugins` (so the dashboard shows no new row), cannot be switched off, removed or replaced by an installed bundle, and
  keep running in safe mode. `dispatch(id, req, res, sub, json)` calls a bundled plugin's route for an old URL.
- `plugin-launcher.js`: the launcher plugin. It owns the supervision timer and three routes (`status`, `action`, `icon`).
  `main.js` forwards `/dock` and `/dock/icon` to them, so the dashboard and scripts are unchanged.
- Not moved yet: the `Dock` object (the updater and `/status` still use it directly), the dashboard section, the hooks for
  the updater, `ctx.report`, `_vetro.css`, `ctx.launcher`.
- Tests: `plugin-bundled.test.cjs`, `plugin-launcher.test.cjs`, and the existing `http.test.cjs`, which already exercised
  `/dock` and `/dock/icon` and passes unchanged. Full suite: 76 suites.

## Launcher test candidate — 2026-11-03

The #23/#24 launcher changes retain the bundled-plugin boundary. Supervision and actions, including
`noMotion` (Still selection), belong to `plugin-launcher.js`; `/dock` and `/dock/icon` remain aliases.
The native program and `dock.js` still ship with Vetro. Vetro's signed updater replaces these files and
restarts or rolls back the launcher with the service. This candidate does not add a separately installable
or independently updatable launcher: replacing the bundled plugin from a catalog remains future work.
The native DLL is rebuilt from the combined sources, retaining generation-based cancellation for the
multi-app Home guard. Hardware validation remains required before release.

## Next decision: replacing a bundled plugin from the list

To make the launcher plugin updatable on its own, the host must let a version from the list take the place of the bundled one.
Things to settle first: the list's signature is required for this (never Developer mode / from a file); the replacement keeps
the same `id`; the bundled copy remains as the fallback if the replacement fails to start or does not satisfy `requires`;
and the replacement never gains `ctx` members the bundled one does not have. Not implemented.

## Risks

- **Regression in features that work today and were verified on the TV.** The main one. The order above keeps the
  riskiest (input, MQTT) last and behind interfaces that are tested first on something simpler.
- **A second dashboard path** while the sections are being moved. Keep one feature per release candidate.
- **The API grows to fit Vetro's own needs** and ends up shaped by them. Third-party examples (the plugin list's
  `template/` and a few real plugins) should be written against each new member before it is declared stable.
- **Memory and start time on Node 4.4 TVs.** Not measured. Measure the service's RSS and boot time before and after
  step 2.

## Checked, and not checked

Checked in the code of `release-0.4.0` (merged into 0.5.0): the requires between modules, the lines in `main.js`, the routes, the state
paths, the timers, the updater's handling of the launcher, the contents of `ctx`, the history of `f92f2d7` / `cac599b` /
`33fa3fb`.

Not checked: anything on a TV; memory and boot time; what happens to the
launcher process when its plugin is paused; whether a frame can load the design tokens from the host without a change
to the sandbox attributes.
