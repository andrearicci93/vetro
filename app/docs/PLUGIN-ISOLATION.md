# Plugin isolation: what was measured (not in this release)

[Back to the plugin guide](plugins.md)

Today a plugin runs inside Vetro's own process, so it can do what Vetro can do (see "What a plugin can do" in the guide).
A real boundary means running the plugin's code in a separate, unprivileged process. This page records what the Q80A
(firmware 2310.0, `/usr/bin/node` 12.5) allows. Everything below was run on that TV on 2026-10-30; the older Node 4.4 TVs
were not tried.

## What works

- **Unsigned JavaScript can run as a separate process, from stdin.** The TV's protection against unsigned programs (UEP)
  refuses `node file.js`, `node -e` and `node -p` (`the file is NOT signed`), whatever the folder, including a copy inside the
  signed package. `echo "code" | node` runs. So the host can pass a plugin's code on stdin.
- **A process started by the root helper can drop to an unprivileged user.** `runuser` fails on this TV ("failure setting user
  credentials"), but `process.setgid(99); process.setuid(99)` at the top of the script works (user `nobody`).
- **What that process cannot do:** read `vetro-auth.json` (the paired devices' key hashes), list or read the root helper's
  staging folder, write the package folder or Vetro's settings folder. The Smack label is the same (`User`).
- **What it can still do:** read the service source (world readable, nothing secret), reach the network, write `/tmp`.
- **For comparison, the same code as the service's own user (`owner`, uid 5001):** reads the auth file, lists the helper's
  folder, writes Vetro's settings folder. So running plugins as `owner` would isolate nothing.
- **No network at all:** `unshare -n` in front of the program leaves it with only an empty loopback: both the internet and
  Vetro's own port fail with `ENETUNREACH`.
- **A Unix socket in the file system still works across that boundary** (uid 99, no network, connected to a socket made by
  another process and got an answer), so a plugin can talk to the host without any network.

## Why the network matters

On loopback, a request without a browser `Origin` is treated as coming from a TV app and needs no pairing (that is how the
Vetro widget works). Measured: from the TV itself, `GET /status` answers 200 and `POST /exec` answers `root` with no key.
A plugin process that kept the network (even as `nobody`) could therefore run commands as root through Vetro's own API.
The isolation needs the empty network namespace, or a change to that rule.

## A possible design

The host asks the root helper to start, per plugin, `systemd-run ... unshare -n node` (own unit, like the launcher, so
it survives standby; killed when the plugin is switched off) with a short prelude that drops to `nobody`, connects to a
Unix socket the host listens on and answers with a per-session token; the plugin's code follows on stdin. Everything a plugin
may do is then a call to the host (storage in its own folder, a page, an HTTP request to a listed host, a launcher tile…),
checked against the permissions the user accepted. `exec` would stay possible but only as an explicit "run as root"
grant that the user sees for what it is.

## Not measured

Node 4.4 TVs (the prelude and the socket code must run there); memory and CPU limits per plugin (`ulimit` exists, cgroups
`cpu` and `cpuset` are present, memory not checked); behaviour across standby and a service restart; the cost of one extra
Node process (about the size of the service itself) per running plugin.
