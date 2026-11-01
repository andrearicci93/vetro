# Experimental SDB tunnel

This branch imports the implementation from
[thalesv6/vetro PR #1](https://github.com/thalesv6/vetro/pull/1), commit
`b8c46df9e0c9d8ee5db031ca8ece7016914d4a11`, by Thales Silva (`thalesv6`).
It preserves that experimental implementation, including its current limitations.

## How it works

Developer Mode's Host PC IP stays set to `127.0.0.1`. Vetro continues to bootstrap
its root agent through the TV's local SDB daemon. A TCP relay in the same Node
service exposes another port, default `26201`, to PC clients:

```text
PC SDB client -> TV_LAN_IP:26201 -> Vetro TCP relay -> 127.0.0.1:26101 -> sdbd
```

For each incoming connection, the relay opens a separate loopback connection to
sdbd and pipes bytes in both directions. sdbd therefore sees the relay's
loopback source address, rather than the PC's LAN address. There is no SDB
protocol translation, iptables rule or change to Developer Mode configuration.
The relay itself does not require root; it runs inside Vetro's Node service.

This solves access from the PC while retaining Vetro's existing SDB bootstrap.
It does not implement an SDB-independent root agent. It still requires sdbd to
accept connections from `127.0.0.1` on that TV/firmware.

## Use after building and installing this integration

Keep Host PC IP set to `127.0.0.1` and connect the PC to the relay port:

```sh
sdb connect TV_LAN_IP:26201
sdb devices
```

Replace `TV_LAN_IP` with the TV's LAN address. With multiple devices connected,
select the serial shown by `sdb devices` using `sdb -s SERIAL ...`.
Push, installation and other SDB operations then travel over that connection.
Tools that hard-code port 26101 must support a custom port or an existing SDB
connection to use the relay; their compatibility needs testing separately.

`VETRO_SDB_TUNNEL_PORT` changes the listening port in the service's environment.
The default implementation binds to `0.0.0.0` and starts automatically with the
TV platform adapter. It is included by `rooting/build.cjs`, not the app-only
builder. `/status` includes `sdbTunnel.listening`, the assigned port, or a listen
error. A listening status proves neither upstream authorization nor installation.

## Lifecycle and current limitations

`platform.start()` starts the listener alongside the root-agent server.
`platform.stop()` calls the relay's `close()` and reports it as not listening.
Closing either endpoint of an individual connection destroys the other endpoint.

In this version, `close()` calls Node's `server.close()` but does not track or
destroy accepted sockets. Existing relayed sessions can survive an adapter stop
until their endpoints disconnect. Consequently, status `listening: false` does
not prove every session has been terminated. A complete shutdown requires a
follow-up change and a regression test.

The listener has no authentication, source-IP allowlist or opt-in switch. Every
LAN client that can reach its port can attempt SDB operations through the TV's
trusted loopback address. Treat that exposure explicitly; dashboard access
controls do not protect this raw TCP listener. Before release, add explicit
enable/disable controls and client restrictions, and validate the configured
port. The current expression falls back to 26201 for zero or invalid numeric
input and does not reject out-of-range numbers before calling `listen()`.

## Validation scope

The upstream author reports a successful real-device SDB CNXN handshake through
the tunnel and refusal of a direct connection to port 26101 from an unauthorized
source. That report is not independent verification on the Q80A or DU7700.

```sh
node rooting/tests/sdb-tunnel.test.cjs
node rooting/tests/package-boundary.test.cjs
```

The tunnel tests exercise byte forwarding and upstream cleanup after the client
disconnects using local fake servers. They do not test package installation,
real SDB forwarding, active-session shutdown, cold boots, concurrent Vetro use,
or Apps2Samsung's custom-port support. Hardware acceptance should cover those
cases with Host PC IP remaining on loopback. This branch was prepared without
installing or launching anything on the TV.
