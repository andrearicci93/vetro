# Shard capabilities: a secure and wide Shard system (proposal, not in 0.5.0)

[Back to the plugin guide](plugins.md) · builds on [PLUGIN-ISOLATION.md](PLUGIN-ISOLATION.md) and [PLUGIN-ARCHITECTURE.md](PLUGIN-ARCHITECTURE.md)

**Status: proposal.** Nothing here is implemented. 0.5.0 ships with API 1, in-process Shards and `permissions` as
labels, exactly as [the plugin guide](plugins.md) says. This page records the goal and a way to reach it, so the
decisions can be made on paper first.

**Goal (owner, 2026-11-06):** Vetro Shards should be a system that is both **secure** and **wide**. Wide means a Shard
can react to the TV, change the launcher, add remapper triggers and actions, and show something on the screen. Secure
means a Shard can do **only what the user accepted**, and Vetro, not the Shard's good manners, makes that true.

## The one rule

> **No capability is added to `ctx` for third parties before the Shard that holds it runs behind a boundary that Vetro
> enforces.**

[PLUGIN-ARCHITECTURE.md](PLUGIN-ARCHITECTURE.md) already says the same in its "Who gets these members?" note: until
isolation exists, a Shard that can register remapper actions can run them. Breadth and security are therefore not two
goals to trade off; breadth is built on top of the boundary, one capability at a time.

## Threat model

A Shard is **untrusted code**, reviewed by a person but not audited. It may be buggy or malicious.

**What the boundary must stop** (all measured or documented today as possible from an in-process Shard):

| Asset | Today | With the boundary |
| --- | --- | --- |
| Paired devices' key hashes (`vetro-auth.json`) | readable | not readable (`nobody`) |
| Root through Vetro's own port (`POST /exec` from loopback, no key) | reachable | unreachable (no network namespace) |
| Vetro's settings and package folder | writable | not writable |
| Other Shards' folders and config | readable | not readable |
| The internet, for data theft | open | only hosts the user accepted, through the host |
| The MQTT / Home Assistant link | reachable by going around the API | only topics the user accepted |
| Running commands as root | always possible | only with the explicit `exec` grant |

**What it does not promise.** A Shard that holds `exec` is root by definition; the dashboard says so. A Shard may abuse
a capability it was given (a `net` Shard can send what it can read). A Shard can use CPU and memory until limits exist.
Source review of the catalog stays necessary. The boundary limits the damage; it does not replace trust in the author.

## Execution model

Based on what [PLUGIN-ISOLATION.md](PLUGIN-ISOLATION.md) measured on the Q80A (firmware 2310.0, Node 12.5):

1. The host asks the root helper to start, per running Shard, a separate process: `unshare -n` (empty network
   namespace), a prelude that drops to uid/gid 99 (`nobody`), then the Shard's code from **stdin** (the TV's UEP refuses
   unsigned files, not stdin).
2. The process connects to a **Unix socket** that the host listens on and presents a per-session token.
3. The Shard sees a `ctx` that is a thin client: every call (`config`, `execute`, `fetch`, `events`, …) is a message to
   the host, which **checks the permission the user accepted** and does the work itself.
4. Switching the Shard off kills the process. A crashed Shard counts as a failure, like today (3 in a row = off).

The Shard's own page and routes keep working as now: the host proxies them to the process over the same socket.

**Fail closed.** If the TV cannot create this boundary (a missing `unshare`, an unexpected failure), the host does not
start the Shard in-process as a fallback if it asks for anything beyond the tier below. See the open question on tiers.

## Supported TVs

**Decided (owner, 2026-11-06): the isolated Shard system is not compatible with TVs that run Node 4.4**, and the
documentation says so everywhere once that system ships.

This is not only "untested". The boundary is built by the **root helper** (it starts the process, drops it to `nobody`
and gives it an empty network namespace). The CHANGELOG records that TVs on Node 4.4 (Tizen 4 and 5.5) run the service
**app-only**, and that the root helper is not available on that runtime; the README's compatibility table lists the
reported Node 4.4 TVs (UE43NU7090, UE43TU7090, UN32T4300) with "the root agent is not available". Without the root helper
there is no way to create the boundary there, so no capability that needs one can be offered, and `exec` does not work
either.

| | Node 4.4 TVs (Tizen 4 and 5.5, app-only) | TVs with the root helper (measured: Q80A, Node 12.5) |
| --- | --- | --- |
| **0.5.0, API 1, in-process** | unchanged: Shards without `exec` still run, as the CHANGELOG and CI (Node 4.4.7) say | unchanged |
| **Isolated system, capabilities (API 2)** | **not supported** | supported if the probe passes |

Consequences, to apply when the isolated system becomes the default (step 2 below) and not before:

- The guide, the catalog README, `CONTRIBUTING.md` and the dashboard say "Shards need a TV with the root helper (Node 12
  or newer); TVs running Node 4.4 are not supported".
- The ES5-only rule can be relaxed for new Shards (Node 12 runs modern syntax); `build.cjs` stops checking ES5 and the
  Node 4.4.7 lifecycle job is dropped from the catalog's CI. Until then both stay, because 0.5.0 still promises Node 4.4.
- The in-process mode is removed. A Shard on an unsupported TV is listed as "not supported on this TV" and never started.

## Capabilities

Permissions are strings in the manifest's `permissions` list; some take an argument after a colon. Everything the user
accepted is shown at install and enabling time, and is **part of the signed bundle** (the manifest is inside it, so the
catalog's signature covers it).

| Permission | What it lets a Shard do | Host needs | Risk |
| --- | --- | --- | --- |
| *(always)* | its own page and routes, `ctx.config`, timers while running | exists | low |
| `exec` | `ctx.execute(cmd)` as **root** | exists | **high**: shown as "can run any command as root" |
| `net:<host>` | HTTPS/HTTP requests to that host (and port) only, made **by the host**: it resolves the name, refuses loopback and link-local addresses, enforces size and time limits | new: `ctx.fetch` | medium: data can leave to that host |
| `net:lan` | requests to the local network | new | medium-high: other devices at home |
| `tv:read` | read-only `ctx.vetro.version`, `telemetry()`, `presence()`, `tvState()`, `apps()` | new: expose services (sketched in PLUGIN-ARCHITECTURE.md) | low-medium: reveals what is watched |
| `events:tv` | pushed events: TV on/off, app opened/closed, source changed | new: event bus fed by `tv-state.js` and `presence.js` | medium |
| `events:input` | pushed remote key events | new: tap on the input pipeline | medium-high: a keylogger for the remote |
| `launcher` | `ctx.launcher.entries()` / `set()` (validated like `dock-catalog.js`) | new | medium |
| `remap:trigger` | register a remapper trigger source | new: extension point | medium |
| `remap:action` | register a remapper action type | new: extension point | **high**: actions launch apps and inject keys |
| `notify` | show a message on the TV screen | new: a channel from the service to the Tizen app (does not exist) | medium: can mislead (fake prompts) |
| `mqtt:<topic>` | publish/subscribe under that topic prefix, through Vetro's broker connection | new: needs the Home Assistant Shard first (step 5 of PLUGIN-ARCHITECTURE.md) | medium |
| `report` | add a section to `/status` and the diagnostic export | new | low |

Notes:

- **No wildcard.** `net:*` does not exist. A Shard that needs "any host" is not a good fit for the catalog.
- **Narrow by default.** `events:input` and `remap:action` are separate from their read-only neighbours on purpose.
- **Dependencies.** `launcher`, `remap:*` and `mqtt` depend on the bundled Shards in PLUGIN-ARCHITECTURE.md and cannot ship
  before them.
- **Updates.** A new version that asks for **more** permissions than the installed one is not applied silently: it is
  installed off and the dashboard asks again.

## Manifest and compatibility

```json
{ "apiVersion": 2, "permissions": ["net:api.example.org", "events:tv", "notify"],
  "requires": { "vetro": ">=0.6.0" } }
```

- **API 1 Shards keep working**, in the isolated process, with the capabilities they could use in API 1: `exec` if they
  listed it, nothing else. `tv-uptime` is such a Shard.
- An API 1 Shard that `require`s `child_process`, `fs` outside its own folder or `http` will **stop working** under
  isolation, by design: that is exactly what the boundary removes. The catalog should be checked for this before
  isolation ships (today it holds one Shard).
- Under API 1, `exec` stays the only permission; unknown permissions are refused, as now.

## The catalog (vetro-plugins)

- `scripts/build.cjs`: `PERMISSIONS` becomes a grammar (`name` or `name:argument`) with a list of valid names, updated
  together with each Vetro release that supports them. Until then the catalog keeps refusing everything but `exec`.
- The README of each Shard must say, for every permission, **what it is used for** (today only `exec` has a section).
  `net:<host>` must match the hosts named in `description`.
- CI cannot enforce what a Shard does with a permission; review still does.
- Nothing in the signing pipeline changes: the signature already covers the bundle, and the bundle contains the manifest.

## Order of work

Each step ships only when its exit criterion holds, on a real TV.

1. **Probe instead of a list of models.** The isolation was measured on one TV (Q80A, Node 12.5) and the owner has no
   other. So the host does not assume it works: at start it **tries** to build the boundary (empty network namespace,
   drop to `nobody`, connect to the socket) and records "can isolate" or "cannot isolate" with the reason. A TV nobody
   has measured lands in the "cannot isolate" tier of open question 1 by default (Node 4.4 TVs are excluded outright, see
   "Supported TVs"). The result is
   added to the diagnostic export ([DIAGNOSTIC-EXPORT.md](DIAGNOSTIC-EXPORT.md)), so users with other TVs can report it.
   The prelude and the socket client are written in ES5 and run in the catalog's Node 4.4.7 lifecycle tests; that checks
   the code, not the TV (`setuid`, `unshare` and the UEP block on unsigned files must be seen on a TV).
   Still to measure on the Q80A: memory per extra process, behaviour across standby and a service restart, `ulimit` and
   cgroup limits.
   *Exit: the probe exists and reports correctly on the Q80A; a table of reported TVs starts to fill in.*
2. **Isolated runner, API 1 only.** Run Shards in the process described above, behind a switch, with `ctx` as a client
   of the host. *Exit: `tv-uptime` and the template pass its lifecycle on a TV; a Shard that reads `vetro-auth.json` or
   calls `127.0.0.1` fails.*
3. **Permission broker, `net` and `tv:read`.** The first two capabilities, because they need no new Vetro internals.
   The install dialog lists permissions. *Exit: a Shard with `net:a.example` reaches only that host.*
4. **Events (`events:tv`), then `report`.**
5. **`launcher`, then the remapper points and `mqtt`**, after the bundled Shards in PLUGIN-ARCHITECTURE.md exist.
6. **`notify`** last: it needs a new channel to the Tizen app and a design for what may appear on screen.
7. **Update the catalog tooling and the guide** with each capability as it ships. Retire the "permissions are labels"
   warning only when step 2 is the default.

## Open questions

1. **Tiers on TVs that cannot isolate** (not Node 4.4 TVs, which are unsupported; a TV with the root helper where the probe
   fails, or one nobody has measured). Options: (a) fail closed for everything (an API 1 Shard with `exec` stops working
   on those TVs); (b) fail closed only for the new capabilities, and keep API 1 Shards running in-process as today,
   marked "not isolated" in the dashboard. **Recommendation: (b)**, because it keeps 0.5.0 behaviour for what exists and
   never grants a new power without a boundary. Not decided.
2. **Who enforces `net` on a TV with no `unshare`?** Without a network namespace the process can open sockets itself.
   (b) above covers it: no `net` Shard runs there.
3. **Cost.** One extra Node process per running Shard, about the size of the service. A limit on running Shards may be
   needed on small TVs.
4. **The loopback rule.** A request from the TV itself with no `Origin` is treated as a TV app and needs no pairing.
   The namespace hides it from Shards, but any other local process still has it. A separate decision.
5. **Granting at install or at first use?** Install-time lists are simple; first-use prompts need a way to ask on a
   device that may not be open. Recommendation: install-time.
6. **Revoking.** Should the user be able to turn off one permission of an installed Shard without removing it?

## Checked, and not checked

Checked: the measurements in PLUGIN-ISOLATION.md, the `ctx` members and the bundled-only `ctx.vetro` in
`plugin-host.js`, the API sketch and ordering in PLUGIN-ARCHITECTURE.md, the catalog's `build.cjs` limits.

Not checked: any of the new behaviour on a TV; Node 4.4 TVs (the owner has none; excluded by decision, on the CHANGELOG's statement that they have no root helper, which I read but did not re-test); memory, standby and restart behaviour; whether the Tizen app
can receive messages from the service for `notify`; how the install dialog fits the dashboard.
