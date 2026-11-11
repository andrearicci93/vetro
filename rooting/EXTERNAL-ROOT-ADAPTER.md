# External-root adapter: first integration slice

This opt-in backend connects Vetro to an **already authorized privileged
bootstrap**. It implements `start`, `stop`, `status` and authenticated `execute`
using the existing root-agent protocol, signed system Node and a private shell
worker. It does not obtain root, install boot persistence, change firmware or
accounts, select a different backend on failure, or start an SDB tunnel.

## Build and trust boundary

```sh
VETRO_ROOT_METHOD=external-root node rooting/build.cjs
```

Use the existing signing environment described in `README.md`. The default
build remains archive-root; app-only is unchanged. The external build contains
the Node agent/worker rather than the archive-root payloads. This is not a
complete Q74T port of the UI or native helpers.

Each lifecycle publishes a fresh `/tmp/vq-*` rendezvous, with a 0600 one-use
secret and a complete `launch` file published last by atomic rename. **The
external root launcher must independently authorize the service and its files.**
Finding this path is not authorization; world-writable queues are not supported.
The bootstrap runs the `launch` body through a signed shell. It creates a
root-owned 0700 worker directory and launches the signed system Node agent by
inline module loading. The Node agent never spawns processes itself.

The service accepts authenticated UID/GID-0 identity and then checks a harmless
shell round trip before exposing `agent.connected`. Commands have bounded
timeouts/output; an interrupted command is not replayed. A disconnect prepares
a new rendezvous/secret after one second. `stop` cancels this retry and closes
the channel, but does not remove the separately installed root mechanism.

`VETRO_EXTERNAL_AUTO_RENEW=1` explicitly opts into new 15-minute windows.
Without it, expiry stops preparation. There is no Remote PC credential trigger
in this adapter. Installation and native package activation return unavailable;
launcher/input capabilities are unverified, not implied by a root connection.

## SMACK candidates, not hardware conclusions

SMACK policy is untouched by default. `VETRO_EXTERNAL_SMACK=agent-write` opts
into one `_ -> service` write rule, the direction reported by the original
Q74T denial. `both-write` adds the reverse write rule for a controlled comparison.
Neither mode grants `r`, `x`, `a` or `t`. These reduced policies need clean-boot
hardware tests; pre-existing broad rules can otherwise produce a false pass.
Even a write-only rule applies to the label pair, not just this agent/socket.

## Evidence and remaining work

Runtime code is adapted from the MIT Q74T port at `082559e`; command, SMACK and
deadline helpers originate in PRs #147, #148 and #149. Their extraction alone
did not create an integration; this backend is their first call site.

Offline fixtures use simulated root identity and real host-user shell jobs.
They cover authenticated protocol interop, private staging, timeout/output
bounds, uncertain outcomes without replay, fresh reconnect, explicit stop,
renewal and package boundaries. They are not hardware attestation.

`tools/external-root-probe.js` is a bounded TV test harness: run it as the actual
service UID and SMACK label, from a private temporary staging directory. It
checks identity and a temporary file round trip, stops after success or 90 s,
and writes a private report. It does not start Vetro, its plugins or restores.
Staging/launching it still requires the owner's authorization.

Pending: new hardware execution, minimum-SMACK clean boots, genuine service
restart and cold boot, isolation from other packages sharing a UID, durable
association/revocation and update/rollback. Fresh session secrets are not a
replacement for the persistent association in the upstream
[external-root design](https://github.com/andrearicci93/vetro/blob/release-0.5.0/rooting/EXTERNAL-ROOT-DESIGN.md).
Do not announce general Tizen 5.5 support or install over a working custom
widget based on these offline results.

## Q74T hardware baseline, 11 November 2026

The bounded probe was run on QE55Q74TATXZT / `20_NIKEM_QTV`, firmware
`T-NKMDEUC-2743.0`, using the signed system Node v4.4.3. Its separate service-side
process ran as UID/EUID 5001, GID 100 and `User::Pkg::vetrotvapp`, matching the
installed service identity. The new authenticated agent reported UID/EUID/GID/
EGID 0, full effective capabilities and `_`. Both the readiness round trip and
the identity/temporary-file checks succeeded through the new adapter. A second
run stopped and restarted the adapter inside the probe: two distinct rendezvous
paths and root agent processes completed the same checks. This tests an adapter
restart, not a restart of the installed Vetro service.

No WGT was installed and no existing app files, settings or boot hook changed.
The existing root connection remained available and the probe staging directory
was removed. This is a new runtime/channel test, **not** a full-app or cold-boot
test. The TV already had the old broad SMACK rules loaded: the successful probe
used `smack: none` and does not validate either reduced rule candidate.

Offline validation on upstream base `aa37060`: 105 app suites, 22 integration
suites, 19 diagnostic parser tests and release audit passed. The Node 4 guard
checks 123 packaged JavaScript entries across the default and external builds.
App tests ran through a temporary path without spaces because the upstream
updater rejects the workstation's project path. Native code was not changed.
