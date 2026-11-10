---
title: "Does root survive a restart on a Samsung TV?"
description: "What happens to Samsung TV root after a restart, standby, a full power cycle or a firmware update, and how Vetro gets root back by itself in up to 90 seconds."
keywords: ["samsung tv root persistent reboot", "does root survive restart samsung tv", "samsung tv root after power cycle", "vetro root agent boot"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Vetro 0.5.0's published BOOT-TEST.md, RELEASE-AUDIT.md, INSTALLATION.md, rooting README, README and CHANGELOG, and the samsung-tv-root project page."
related: ["how-to-root-samsung-tv", "firmware-update-remove-root", "stop-samsung-tv-auto-update", "samsung-sdb-connect-tv", "install-vetro-apps2samsung", "is-it-safe-to-root-samsung-tv"]
---

Root on a Samsung TV does not stay switched on across a restart; it has to be obtained again. The research Vetro builds on describes root as volatile. What Vetro does is get it back automatically: after the TV starts, its background service uses the TV's own SDB service to launch a root helper, and the helper connects back. The installation guide says this can take up to 90 seconds. Evidence comes from one Q80A and a few community reports, not from every model, so treat it as likely rather than guaranteed.

## What is "persistent" root here?

Not kernel-level or firmware-level. Chris Ritsen's [samsung-tv-root project](https://github.com/chris-ritsen/samsung-tv-root) says "Root and UEP changes remain volatile". Its own host controller reacquires root from another computer after a TV reboot, which the page says makes root appear semi-persistent, and it states that it does not install a TV-side boot service.

Vetro changes where that happens. Its root agent is a small helper that runs as UID 0 on the TV. The Vetro service starts with the TV, reaches the TV's own SDB service through Developer Mode with Host PC IP set to `127.0.0.1`, starts the helper, and the helper connects back. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md#install) says no computer needs to stay connected. The dashboard shows Root agent: connected when it worked. See [connecting with sdb](/root/samsung-sdb-connect-tv/) and the [install guide](/root/install-vetro-apps2samsung/).

## How long does it take after a restart?

The [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md#check-that-it-starts-by-itself) says startup and root can take up to 90 seconds after a cold boot, and to wait before treating an unavailable dashboard or agent as a failure. Several diagnostic report sections say "unavailable: no root agent connected" until the helper is up, which is expected in that window.

The project's [release audit](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-AUDIT.md), a document from 11 October 2026 about the 0.2.x builds, records two results on a [Q80A](/tested-tvs/q80a/). After a complete power cycle without opening Vetro, the service and an authenticated UID-0 agent were back; the audit calls this one cold boot of the then-installed package, not proof across firmware or repeated boots. After a later reboot without opening Vetro, two distinct boots were verified, with the DNS filter seen connected at roughly 115 and 118 seconds of uptime. The audit says native key behavior stays in place until Vetro and the helper are ready, and that this is not a guarantee for all firmware or an unplugged cold boot.

## What about standby, a full power cycle and a firmware update?

| Event | What the published files say |
| --- | --- |
| Standby | Not a reboot. [BOOT-TEST.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/BOOT-TEST.md) says standby alone may not reboot the system, so the tool checks the boot ID |
| Restart from the menu | Two reboots verified on one Q80A in the 0.2.x audit |
| Full power cycle (unplugged) | One unattended cold boot confirmed on the Q80A in the audit; repeat checks on newer builds were listed as outstanding |
| Firmware update | Listed as outstanding validation in the audit. The README says an update can change the result, even inside one model family |

The README adds a switch, Disable automatic firmware update, so a new firmware does not remove root behind your back. More in [what a firmware update does to root](/updates/firmware-update-remove-root/) and [stopping automatic updates](/updates/stop-samsung-tv-auto-update/).

## What do community reports say?

These come from the README table and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md), and are the reporters' own accounts:

- A 2024 [S90D](/tested-tvs/s90d/) ([#36](https://github.com/andrearicci93/vetro/issues/36)): the root agent was back after a full restart.
- A 2022 The Frame, the [LS03B](/tested-tvs/ls03b/) ([#39](https://github.com/andrearicci93/vetro/issues/39)): once Host PC IP was `127.0.0.1`, the service started by itself after a cold boot.
- A 2021 [QN85A](/tested-tvs/qn85a/): back after a reboot, once the reporter had enabled the service's on-boot and auto-restart flags.
- A 2024 [Q65D](/tested-tvs/q65d/) ([#10](https://github.com/andrearicci93/vetro/issues/10)): cold-boot persistence was not reported.
- A 2023 [S90C](/tested-tvs/s90c/) ([#29](https://github.com/andrearicci93/vetro/pull/29)): three clean installs registered the service with on-boot and auto-restart off, so it did not start after a restart until the app was opened. Since 0.3.2 Vetro puts the two flags back once the root agent connects, and the changelog says the service then started 40 to 65 seconds after a restart or power cut on that TV.

The pattern is that it works on models that reported it, and the first install may need the app opened once.

## Why is boot-time root not guaranteed?

The installation guide notes that the on-boot service has been investigated with Partner-level distribution privileges and that ordinary public signing is not evidence that boot execution is supported. Signing does not prove root compatibility either, and the rooting README says the same. Firmware, not the Tizen number, decides; see [Tizen version by year](/root/samsung-tv-tizen-version-by-year/).

## How can I test it on my TV?

BOOT-TEST.md describes `scripts/boot-test.py` in the `app` folder, which records startup from a computer without installing anything or rebooting the TV. It needs the key from pairing in `VETRO_TOKEN` (see the [sign-in guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/SIGN-IN.md)). Run `preflight`, then `record --mode passive`, mark the reboot, and do not open Vetro while the TV starts. A result counts when it shows a new boot, a new service and a connected agent. Keep boot identifiers private.

## What if root does not come back?

The installation guide's table starts from `http://TV_IP:8099/status` (pair the browser first if pairing is on):

- `"mode": "app-only"`: the package has no root integration.
- `"mode": "tv-integration"` with the agent not connected: check that Developer Mode is on, Host PC IP is `127.0.0.1`, you restarted the TV afterwards and you waited 90 seconds.
- The page does not load: the background service is not running. Open Vetro once, wait 10 seconds and reload.
- Launches that end without `agent-connected`: root did not work on this firmware or SDB refused the connection. The guide asks for the diagnostic report in a new issue.

A TV where the Host PC IP step was skipped shows the same missing-agent picture; one 2021 TV in the README is in that state ([#134](https://github.com/andrearicci93/vetro/issues/134)).

## Limits

The evidence is one TV's measurements plus reports. Do not rely on root being back for anything critical. Vetro is experimental, needs root and ships no signed installer. Read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/) and the main [rooting guide](/root/how-to-root-samsung-tv/). Vetro is not affiliated with Samsung.
