# Tizen 10 root backend (`vddebugmenu`)

Status: ported to the release-0.7.1 line on branch `tizen10-root-071` (commit on top of `c48e56c`, from PR #309 by
MaomaoADHD, plus the OS→payload rule below). The unit suites pass (`node rooting/tests/run.cjs`,
`node app/tests/run.cjs`). No new field run was made from this branch; the mechanism is the one three retail
Tizen 10 sets already reached `uid 0` with.

This document is the reference for anyone (human or agent) working on the root integration. It is written so the
non-root parts can be done without a TV and without touching the privileged path.

## 1. What selects what

Two independent choices:

| choice | values | decided by |
|---|---|---|
| **backend** (how the agent is launched) | `sdb-archive` (default, Tizen 4–9) or `vddebugmenu` (Tizen 10) | platform **major** version |
| **payload** (which .NET agent bundle) | `payload/net6` (`rollForward: Major`) or `payload/` (netcoreapp3.1) | OS generation; the archive backend confirms it with a preflight, the vddebugmenu backend derives it from the same version |

### 1.1 Backend

`detectRootBackend()` in `rooting/service/platform.js`, first match wins:

1. `VETRO_ROOT_BACKEND=vddebugmenu` or `VETRO_ROOT_BACKEND=sdb-archive` (manual override, for tests/rollout).
2. The stored widget probe, `/opt/usr/home/owner/share/vetro-probe.json` → `settings.platformVersion`
   (`POST /probe` writes it; the TV page sends the Tizen capability version).
3. `/etc/tizen-release` → `VERSION = 10.0.0` (or `Tizen10/TV ...`).
4. Fallback `sdb-archive` (legacy default, i.e. never silently move an unknown TV onto the new path).

Mapping (`backendForPlatformVersion`): major **10 → `vddebugmenu`**; any other numeric major → `sdb-archive`;
not a version → `null` (no decision). If the widget probe arrives later with a different version,
`setRootBackendFromPlatformVersion()` stops and restarts the agent on the new backend without a service restart.
`GET /status` reports `rooting.backend`, `rooting.phase`, `rooting.failure`, and `rootBackendDetection`
(`{backend, source, platformVersion}`) so a report tells which rule fired.

### 1.2 Payload

`payloadRuntimeForPlatform()` (`platform.js`): major **≥ 9 → `6.0`** (net6 bundle, `rollForward: Major`),
otherwise **`3.1`**; `null` for an unknown version.

- Tizen 9 ships .NET 6.0.9; Tizen 10 ships **only 8.0.11**. A net6 assembly with `rollForward: Major` runs on
  both, so `payload/net6/` is the correct agent on 9/10. Tizen 6–8 use the netcoreapp3.1 bundle in `payload/`.
- On the archive backend the preflight still decides the runtime, because it can ask the TV
  (`/usr/bin/dotnet --list-runtimes`, else the `/usr/share/dotnet.tizen/netcoreapp` symlink); it must
  succeed before staging.
- On the vddebugmenu backend the preflight is **skipped by design** (the Tizen 10 local-SDB path rejects the
  `appinstall tpk` probe). The payload runtime therefore comes from `payloadRuntimeForPlatform()`; with an
  unknown version it falls back to `6.0`, which is the only case this backend serves.
- `prepare()` writes the payload into the staging directory, rewrites each `.runtimeconfig.json` with
  `rollForward` = `Major` (6.0) or `LatestPatch` (3.1), and writes `public.pem` + `passwd`.

## 2. The vddebugmenu bootstrap, step by step

Backend `vddebugmenu`, service running on the TV (`rooting/service/vddebugmenu.js` + `platform.js`):

1. **Listener**: the root-agent server binds a **fixed port 26202** (archive mode uses an ephemeral port).
2. **Staging**: `prepare(port, 6.0)` writes the net6 agent and the token to
   `/home/owner/share/tmp/sdk_tools/<pkg>/` (`STAGE/<pkg>`), mode 0600 for the token.
3. **Host bootstrap**: `prepareHostBootstrap()` writes `<stage>/l.sh` (0755):
   `/usr/bin/dotnet <stage>/SamsungTvRootAgent.dll 127.0.0.1 26202 <stage>/root-agent.token <stage> &`, then
   `sleep 3`. It also points the symlink **`/tmp/vetro` → `<stage>`**, so the submitted command is the short,
   UEP-safe `cat /tmp/vetro/l.sh|/bin/sh` (the TV refuses unsigned script files opened by path).
4. **SDB target**: for this backend the service dials the TV-local daemon directly, `127.0.0.1:26101`, not the
   Vetro LAN tunnel (26101 is what the TV's own sdbd listens on; the tunnel is 26201 and causes a local
   `sdbClosed`). Developer mode must be on, which is what makes `sdbd_tcp.socket` listen at all.
5. **Dispatch**: create the SDB stream with the **wire service name** `shell:0 hyperuart_vddebugmenu` (with the
   `shell:` prefix; without it the TV closes the stream before OKAY/open). Then send, waiting 1 s between
   writes, the published one-shot sequence:
   `20089999` → `94` → `7` → `1` → `x;pkill -f dlogd_sdb;#` → `1` →
   `x;echo VB<id>;<command>;echo VE<id>;echo VD<id>;#` → `99` → `99` → `99`.
6. **Wait**: the menu echoes input, so the success test is a line that **starts with `VD<id>`** (the TV may
   append the menu separator on the same line). A marker that only appears after `echo ` in the echoed input
   is not success. Timeout 60 s → `vddebugTimeout`.
7. The launched `l.sh` starts the agent, which connects back to `127.0.0.1:26202` with the token; the
   authenticated connection is the only thing that sets `rooting.phase = connected`.

Why this shape: the Launcher branch passes `--add-bypass %s` to `logger-mgr` through `system()` **unquoted**,
so `x;<cmd>;#` runs as the uid `vddebugmenu` has (root under its `System::Privileged` unit); the 27-byte
`echo IsRootCmd > /dev/null;` prefix from `libsdbd_plugin` is what makes sdbd treat the converted command as a
root command. The `pkill -f dlogd_sdb` step avoids a competing SDB logger; the earlier `1` re-registers the
bypass after the kill.

## 3. Diagnostics and failure codes

`platform.js` keeps a bounded `bootstrapLog` (80 entries, 1200 chars each) and a `bootstrap` object
(`step`, `status`, `detail`, `at`). Steps: `service`, `preparation`, `host-bootstrap`, `local-sdb`,
`preflight` (`bypassed`), `vddebugmenu` (`dispatching`), `agent-listener`, `agent-authentication`.
`rooting.failure` stays one of the fixed transport/preflight codes used by 0.7.0
(`sdb-handshake`, `launch-command`, `preparation`, `agent-authentication`, …); the vddebugmenu module adds
`vddebugTimeout`, `vddebugClosed`, `vddebugStreamError`. Nothing here contains raw output, addresses or tokens;
the diagnostic export keeps the allowlist from `app/docs/DIAGNOSTIC-EXPORT.md`.

## 4. Running it

```sh
node rooting/tests/run.cjs    # 22 suites, includes backend selection, host bootstrap, wire sequence, Node 4.4 syntax
node app/tests/run.cjs        # 149 suites
```

- Backend/payload rules and the wire sequence are covered headlessly; `VETRO_ROOT_BACKEND` is the override used
  by those tests.
- What still needs a TV: a real `uid 0` on a firmware you are about to support, the timing (3 s / 21 s on two
  retail boards) and that the menu ids/password are unchanged (94/7/1, `20089999`). The static source for those
  is the PTMH 01204 dump; the wiki holds the full trace.
- Field evidence: three Tizen 10 sets reached `uid 0` with this backend (Q70F `25_RSL_QTV_T10`,
  U8000F `25_KSUE_UB_T10`, and the PR reports on `T-PTMFDEUC-2103.1`).

## 5. Boundaries

- **Do not change the sequence, markers, menu ids or port without a Tizen 10 TV.** They are firmware-specific;
  a wrong step leaves the TV in a menu state and no agent.
- The archive backend, its preflight, tar/`--to-command` path and the 3.1 payload are untouched; Tizen 4–9 keep
  exactly the 0.7.0 behaviour.
- Nothing here touches partitions, certificates, the trust store or system files: the agent runs from `/tmp` +
  staging, as root, and disappears with the process. `sdbd` is stopped by the TV at standby, so root is
  reacquired at wake through the same path.
- Certificates and signing are the release process (`rooting/build.cjs`), not this backend. No keys or device
  artifacts live in the repo.
- The public compatibility table still says "no root on Tizen 10" until 0.7.1 ships and the field reports are in;
  this backend is documented here, not announced.

## 6. Files

- `rooting/service/vddebugmenu.js` — the transport: stream create, one-shot sequence, marker handling, timeouts.
- `rooting/service/platform.js` — `detectRootBackend`, `backendForPlatformVersion`,
  `payloadRuntimeForPlatform`, `prepareHostBootstrap`, vddebugmenu branch of `relaunch()`,
  `setRootBackend[FromPlatformVersion]`, bootstrap log/steps.
- `rooting/tests/backend-selection.test.cjs`, `host-bootstrap.test.cjs`, `vddebugmenu-generic.test.cjs`,
  `sdb-wire-vddebug.test.cjs` — the regression coverage.
- `app/service/main.js` — the probe handler that applies `settings.platformVersion`.
