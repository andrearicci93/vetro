# Platform interface

The application imports only `service/platform.js`. The local adapter does not
provide device operations. The optional integration implements this contract:

| Method | Contract |
| --- | --- |
| `start()` | Idempotent adapter start; no TV side effects in local mode. |
| `stop()` | Stop adapter connections and scheduled retries. |
| `status()` | JSON mode, lifecycle and authenticated agent state. |
| `execute(command, timeoutMs)` | Promise of exit code, timeout, stdout/stderr; rejects when unavailable. No automatic command retry. |
| `setApplicationsEnabled(appIds, enabled)` | Platform package-state operation; application validation protects critical targets. The HTTP path separately verifies native global flags and readback. |
| `install(packageId, absoluteWgtPath)` | Platform installation submission, with manifest validation in the app. Submission alone is not verified installation. |

The source boundary separates responsibilities; the full integration still has
privileged behavior. The app-only build must not contain payloads, SDB or signing
materials. The browser management HTTP interface currently requires a trusted
LAN and has no login; agent authentication does not authenticate browser users.

### Physical remote feature

`service/physical-input.js` is a localhost HMAC-authenticated event receiver.
It uses the existing `execute` contract to start the optional integration's
`payload/SamsungTvRemoteInputAgent.dll` through the TV runtime. The standalone
package does not include that payload and reports unavailable platform access.

`GET /input` inventories input devices and shows recent events; `POST /input`
accepts `{device, mode: "observe" | "filter" | "off"}`. Only registered exact nodes of recognized remote input devices can be selected.
Names are accepted only if unique. Duplicate names are distinguished by their
node; panel keys, keyboards, mice and forwarded devices are excluded.
`{device: "auto", mode: "observe"}` observes the eligible nodes in parallel;
filter mode requires a single detected node. Observe never grabs
input. Filter requires saved enabled `physical` rules, with numeric evdev codes
0..767. The helper forwards unconfigured key and synchronization events via
uinput and withholds configured down/up/repeat events; actions execute on down.
Socket closure releases the grab. The interception switch saves its enabled state
and selected remote in the owner’s persistent remap store. Startup and helper
disconnections retry the saved policy every five seconds once the adapter is ready.
Unique device names allow event nodes to change after reboot; ambiguous names
require the saved node to match. Editing rules releases the grab and then reapplies
the saved policy with the current enabled physical rules. Observe mode temporarily
pauses interception for key capture; it is never restored at startup. Explicitly
turning the switch off persists that choice. A new installation defaults to off. Native actions use `app_launcher` and the supported
`input_keyevent` whitelist, without the LAN WebSocket client. Injected keys go
to the foreground application, not directly to arbitrary background apps.

`GET /apps` enriches the public probe with read-only package-registry metadata
and declared outgoing/reverse package dependencies. It falls back to the probe
if unavailable and labels the source. Icons use installed app IDs, approved
registry paths, PNG/JPEG signatures and a 256 KiB limit. Missing or unsupported
icons use initials. Declared dependencies are not a complete runtime graph.

## SDB developer access

`GET /sdb-access` returns `{available, enabled, active, port}`. The paired-dashboard
`POST /sdb-access` accepts only `{enabled: boolean}`. The TV adapter supplies
`sdbAccess()` and `setSdbAccess(enabled)`; app-only reports unavailable and refuses
changes. `enabled` is the persisted preference; `active` is the current LAN admission
state. Enabling requires a listening tunnel; disabling remains possible when the
tunnel is unavailable. Atomic preference writes and readback precede success.
Turning off destroys network client sockets without closing the shared upstream or
loopback streams. Restore includes this setting and blocks changes during its run.
