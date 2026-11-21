---
title: "Install Vetro on a Samsung TV with Apps2Samsung"
description: "Step by step: Developer Mode, Apps2Samsung, the root package, pairing, Host PC IP 127.0.0.1 and a restart, then the Vetro dashboard on port 8099."
keywords: ["install app samsung tv apps2samsung", "install vetro samsung tv", "apps2samsung vetro", "sideload app samsung tizen tv"]
date: 2026-11-10
updated: 2026-11-21
verified: "Checked on 2026-11-21 against Vetro's INSTALLATION.md, UPDATING.md and SIGN-IN.md, the 0.7.0 CHANGELOG and dashboard labels, the README compatibility table on main, and the Apps2Samsung README."
related: ["samsung-tv-developer-mode", "samsung-developer-certificate-errors", "keep-root-after-restart", "uninstall-vetro-samsung-tv", "how-to-root-samsung-tv", "is-it-safe-to-root-samsung-tv"]
---

To install Vetro with Apps2Samsung: turn on Developer Mode on the TV, run Apps2Samsung on a computer or phone on the same network, pick Vetro from its catalog and confirm the root badge, open Vetro once on the TV, then set Host PC IP to `127.0.0.1`, restart the TV and open the dashboard at `http://TV_IP:8099/`. There is no signed installer to download, because a Samsung certificate belongs to its owner. Vetro is experimental and needs root, and Vetro UI (the launcher, live TV and on-screen displays it draws on the TV) is in preview, so read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/) first. Already on Vetro 0.5.0? You don't need to reinstall: [update from the dashboard](#can-i-update-vetro-without-reinstalling).

## What is Apps2Samsung?

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is an MIT-licensed installer for Samsung Tizen TVs. Its README says it runs on Windows, Linux, macOS, Android and iPhone, ships a command line tool (`apps2samsung-cli`) and has a community catalog of 130+ apps. The first install signs you in to Samsung once to make a signing certificate, which is then reused. It reports what is still wrong when a TV is not ready, such as Developer Mode off, a Host PC IP pointing elsewhere or a restart needed.

The Vetro README lists it as the recommended way to install, and several community reports used it: [#10](https://github.com/andrearicci93/vetro/issues/10) on a 2024 [Q65D](/tested-tvs/q65d/), [#17](https://github.com/andrearicci93/vetro/issues/17) on a 2023 [CU7179](/tested-tvs/cu7179/), and with Vetro 0.5.0 [#158](https://github.com/andrearicci93/vetro/issues/158) on a 2022 [QN90B](/tested-tvs/qn90b/) and [#183](https://github.com/andrearicci93/vetro/issues/183) on a 2023 [CU8070](/tested-tvs/cu8070/), all listed as reported working. Apps2Samsung is a separate project and not affiliated with Vetro or Samsung.

## What do I need before I start?

- A TV you own or are allowed to administer, listed in the README [compatibility table](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) or the [tested TVs](/tested-tvs/). Vetro is developed on a [Q80A](/tested-tvs/q80a/); other models are reports, not guarantees. Root features need Tizen 6 to 9. On Tizen 10 there is no root yet, so Vetro gives you the dashboard, app list and diagnostics only.
- A computer or phone on the same trusted network. The dashboard uses plain HTTP; see the [security notes](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md).
- The package with the root integration. The app-only package shows the TV's apps but cannot change anything and reports "TV platform adapter unavailable".

You never run C# files or DLLs yourself; they are parts of the root integration and start by themselves. The root comes from [Chris Ritsen's samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root).

## How do I install Vetro with Apps2Samsung?

1. Get Apps2Samsung from its [releases page](https://github.com/Apps2Samsung/Apps2Samsung/releases): desktop app, Android app or command line.
2. Turn on Developer Mode on the TV: open Apps, enter 12345, switch it on, enter the address of the computer or phone running Apps2Samsung in Host PC IP and restart. Fixes are in [how to enable Developer Mode](/root/samsung-tv-developer-mode/).
3. Find Vetro in the catalog under Tools. It has a root badge; confirm when Apps2Samsung asks. From the command line: `apps2samsung-cli install "Vetro" --tv TV_IP --allow-root`.
4. Sign in to Samsung when asked, on the first install only, to create the certificate for your TV. Certificate problems are covered in [certificate errors when installing](/root/samsung-developer-certificate-errors/).
5. Change the port only if needed. Vetro uses 8099, and the guide says to change it only if another app on the TV uses the same port, for example tizen-youtube. A [Q60A](/tested-tvs/q60a/) report ([#28](https://github.com/andrearicci93/vetro/issues/28)) did. The port is written into the package, so changing it later means installing again. Since 0.7.0 a port chosen in Apps2Samsung survives Vetro's own updates.

## What are the last steps after the install?

The guide ends every route with the same two steps.

1. Open Vetro on the TV once. The guide calls this required: on some TVs the installer registers the service with start at boot and auto-restart off, and Vetro turns them on by itself only after it has run once and the root agent has connected ([#25](https://github.com/andrearicci93/vetro/issues/25)). A visible icon or an accepted install is not proof that the background service works.
2. Open `http://TV_IP:8099/` from a browser on the same network. Pairing is automatic: once the Vetro app on the TV has been seen, a browser pairs with a six-digit code shown on the TV ([sign-in guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/SIGN-IN.md)).
3. Open the Developer Mode screen again (Apps, then 12345), set Host PC IP to `127.0.0.1` and restart the TV.
4. Wait up to 90 seconds, then open the dashboard. It says Root agent: connected when it worked.

Root helper startup goes through the TV's own SDB service, which is why the TV has to talk to itself. The guide says this step is tested on a Q80A and that reports from other models describe it as the step that made the TV root itself. While it is set, a computer cannot use SDB on that TV by default. To install a new build from a computer, put the computer's IP back, restart, install, and repeat the step. Do not change the TV's custom DNS for this. More in [connecting with sdb](/root/samsung-sdb-connect-tv/).

If the dashboard does not say connected, open `http://TV_IP:8099/status` (if pairing is on, pair the browser first):

| You see | Meaning |
| --- | --- |
| `"mode": "app-only"` | The package has no root integration |
| `"mode": "tv-integration"` and agent not connected | Check Developer Mode, Host PC IP `127.0.0.1`, a restart and 90 seconds |
| The page does not load | The background service is not running; open Vetro once and reload |

## What should I turn on after installing?

Two settings in Quick settings, General, Essential settings matter right after a first install.

- Block firmware and software updates. Samsung firmware can close the route Vetro uses to get root: in [#223](https://github.com/andrearicci93/vetro/issues/223) a forced update to 1722.0 removed root from a 2022 TV, and Samsung does not support going back. Turn the switch on while root still works. It stops every update service and applies the lock again at each boot; the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) says it was tried on a Q80A only. It can help keep root, it does not guarantee it, and while it is on Samsung's firmware and app updates do not install. The details are in [what a firmware update does to root](/updates/firmware-update-remove-root/).
- Allow SDB from the local network, if you want to keep installing apps from Apps2Samsung or TV-Store. The dashboard says turning it on improves compatibility with both, and turning it off disconnects them. It moved here from Developer settings in 0.7.0.

Vetro UI's parts, the launcher with its Control center, live TV, the volume bar and the number pad, each have their own switch on the Vetro UI page. They are new in 0.7.0 and marked Preview; if one misbehaves, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the report from Quick settings, Developer settings, Diagnostic report.

## How do I check that it starts by itself?

The guide's test is to fully power off the TV, unplug it for 30 seconds, turn it on and check `/status` and `/monitor?scope=summary` without opening Vetro. You are looking for a new boot, a running service and an authenticated UID-0 agent. Standby is not a cold boot. Details are in [does root survive a restart](/root/keep-root-after-restart/).

## Can I update Vetro without reinstalling?

Yes, from Vetro 0.5.0 on. [Quick settings, General, Software update](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md) checks GitHub when you press Check for update, verifies a signed bundle and replaces the files when you press Update, with no computer attached and Host PC IP staying at `127.0.0.1`. If the new version does not start, Vetro puts the previous one back within four minutes. This is how a TV on 0.5.0 moves to 0.7.0: the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) says updating from 0.5.0 was checked end to end, and four problems found on the way were fixed.

| You have | How to get 0.7.0 |
| --- | --- |
| Vetro 0.5.0 | Quick settings, General, Software update |
| Vetro 0.3.x or older | Install with Apps2Samsung as above; those versions have no self-update |
| No Vetro yet | Install with Apps2Samsung as above |

Version 0.7.0 adds an Update Vetro tile on the Vetro screen of the TV, which downloads and installs a signed update without a browser; UPDATING.md says this path has not been tried on a TV yet. Update notices, in Developer settings and off by default, makes the dashboard look for new versions while it is open; installing stays manual. Self-update cannot change what `config.xml` declares; when a version does, you install again with Apps2Samsung.

## What if I would rather sign it myself?

The installation guide has two other routes. A coding agent with a terminal can follow the guide for you; the guide names Codex or Gemini CLI, says not Claude because its cybersecurity safeguards stop it on the root steps, and says to type passwords yourself and never paste them into the chat. The manual route needs Tizen Studio's TV extension and Samsung Certificate Extension, your own certificate profile bound to your TV, and the root builder in the `rooting` folder with your certificate paths and passwords in environment variables. Install with `tizen install`, not `sdb install`, which a community report found did nothing without an error. The steps are in [INSTALLATION.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md).

## Limits

Compatibility is by model and firmware, not by year, and a firmware update can change it. To remove Vetro, see [uninstall Vetro and clean up](/root/uninstall-vetro-samsung-tv/). The main walkthrough is [how to root a Samsung TV](/root/how-to-root-samsung-tv/). Vetro is not affiliated with Samsung.
