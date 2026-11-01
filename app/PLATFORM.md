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
filter mode intercepts every eligible node, one helper each, and skips an IR
receiver whose key map is `rc-empty`. The same key from a different node within
300 ms runs once. Observe never grabs
input. Filter requires saved enabled `physical` rules, with numeric evdev codes
0..767. The helper forwards unconfigured key and synchronization events via
uinput and withholds configured down/up/repeat events; actions execute on down.
Socket closure releases the grab. The interception switch saves its enabled state
in the owner’s persistent remap store. Startup and helper disconnections retry
every five seconds once the adapter is ready: remotes without a connected helper
are started, including ones added after boot, and helpers whose remote has gone
are dropped. Editing rules releases the grab and then reapplies
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
