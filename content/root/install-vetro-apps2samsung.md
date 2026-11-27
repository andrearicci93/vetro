---
title: "Install Vetro on a Samsung TV with Apps2Samsung"
description: "Step by step: Developer Mode, Apps2Samsung, the root package, pairing, Host PC IP 127.0.0.1 and a restart, then the Vetro dashboard on port 8099."
keywords: ["install app samsung tv apps2samsung", "install vetro samsung tv", "apps2samsung vetro", "sideload app samsung tizen tv"]
date: 2026-11-10
updated: 2026-11-27
verified: "Updated on 2026-11-27 against the Vetro 0.7.2 README (Install) and CHANGELOG and UPDATING.md at tag v0.7.2 (commit 2ee0456); the 0.7.1 parts (Compatibility, Update lock, Settings file) and INSTALLATION.md as checked on 2026-11-27 at commit cbc363f. SIGN-IN.md and the Apps2Samsung README are as checked on 2026-11-21."
related: ["samsung-tv-developer-mode", "samsung-developer-certificate-errors", "keep-root-after-restart", "uninstall-vetro-samsung-tv", "how-to-root-samsung-tv", "is-it-safe-to-root-samsung-tv"]
---

To install Vetro with Apps2Samsung: turn on Developer Mode on the TV, run Apps2Samsung on a computer or phone on the same network, pick Vetro from its catalog and confirm the root badge, open Vetro once on the TV, then set Host PC IP to `127.0.0.1`, restart the TV and open the dashboard at `http://TV_IP:8099/`. There is no signed installer to download, because a Samsung certificate belongs to its owner. Vetro is experimental and needs root, and Vetro UI (the launcher, live TV and on-screen displays it draws on the TV) is in preview, so read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/) first. Already on Vetro 0.7.0 or 0.7.1 with root connected? [Use Software update in the dashboard](#can-i-update-vetro-without-reinstalling); if root is unavailable, use Apps2Samsung. On 0.5.0, install 0.7.2 with Apps2Samsung.

## What is Apps2Samsung?

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is an MIT-licensed installer for Samsung Tizen TVs. Its README says it runs on Windows, Linux, macOS, Android and iPhone, ships a command line tool (`apps2samsung-cli`) and has a community catalog of 130+ apps. The first install signs you in to Samsung once to make a signing certificate, which is then reused. It reports what is still wrong when a TV is not ready, such as Developer Mode off, a Host PC IP pointing elsewhere or a restart needed.

The Vetro README lists it as the recommended way to install, and several community reports used it: [#10](https://github.com/andrearicci93/vetro/issues/10) on a 2024 [Q65D](/tested-tvs/q65d/), [#17](https://github.com/andrearicci93/vetro/issues/17) on a 2023 [CU7179](/tested-tvs/cu7179/), and with Vetro 0.5.0 [#158](https://github.com/andrearicci93/vetro/issues/158) on a 2022 [QN90B](/tested-tvs/qn90b/) and [#183](https://github.com/andrearicci93/vetro/issues/183) on a 2023 [CU8070](/tested-tvs/cu8070/), all listed as reported working. Apps2Samsung is a separate project and not affiliated with Vetro or Samsung.

## What do I need before I start?

- A TV you own or are allowed to administer, listed in the README [compatibility table](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) or the [tested TVs](/tested-tvs/). Vetro is developed on a [Q80A](/tested-tvs/q80a/); other models are reports, not guarantees. Root features are reported on selected Tizen 6 to 9 TVs. On four Tizen 10 models, root connected in Vetro 0.7.1 test builds: an [S85F](/tested-tvs/s85f/), a [Q70F](/tested-tvs/q70f/), a [U8000F](/tested-tvs/u8000f/) and a [QN900F](/tested-tvs/qn900f/). The README says feature coverage varies by model, field reports for the final 0.7.1 build are pending, and other Tizen 10 models are still unconfirmed.
- A computer or phone on the same trusted network. The dashboard uses plain HTTP; see the [security notes](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md).
- The package with the root integration. The app-only package shows the TV's apps but cannot change anything and reports "TV platform adapter unavailable".

You never run C# files or DLLs yourself; they are parts of the root integration and start by themselves. On Tizen 6 to 9 the root comes from [Chris Ritsen's samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root); Vetro 0.7.1 uses a separate route for Tizen 10.

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
4. Allow time for startup, then open the dashboard. It can take more than a minute, sometimes more than 90 seconds, and it worked when the dashboard says Root agent: connected.

On Tizen 6 to 9, Vetro starts its root helper through the TV's own SDB service, which is why the TV has to talk to itself; Vetro 0.7.1 has a separate route for Tizen 10. The guide says this step is tested on a Q80A and that reports from other models describe it as the step that made the TV root itself. While it is set, a computer cannot use SDB on that TV by default. To reinstall by hand from a computer, put the computer's IP back, restart, install, and repeat the step, unless the computer goes through Vetro's SDB tunnel (Allow SDB from the local network, below). Updating from Vetro 0.7.0 or later with root connected needs none of this: Quick settings, General, Software update keeps Host PC IP at `127.0.0.1`. Do not change the TV's custom DNS for this. More in [connecting with sdb](/root/samsung-sdb-connect-tv/).

If the dashboard does not say connected, open `http://TV_IP:8099/status` (if pairing is on, pair the browser first):

| You see | Meaning |
| --- | --- |
| `"mode": "app-only"` | The package has no root integration |
| `"mode": "tv-integration"` and agent not connected | Check Developer Mode, Host PC IP `127.0.0.1` and a restart; just after a restart, give it more than a minute |
| The page does not load | The background service is not running; open Vetro once and reload |

## What should I turn on after installing?

Two settings in Quick settings, General, Essential settings matter right after a first install.

- Block firmware and software updates. Samsung firmware can close the route Vetro uses to get root: in [#223](https://github.com/andrearicci93/vetro/issues/223) a forced update to 1722.0 removed root from a 2022 TV, and Samsung does not support going back. Turn the switch on while root still works. It stops and masks the update services Vetro knows about and applies the lock again at each boot; it is designed to block Samsung's firmware and app updates, and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) says the 0.7.0 lock was tried on a Q80A only. It can help keep root, but it does not guarantee it. Vetro 0.7.1 extends it to Samsung's separate update mode, and a TV that already had the switch on gets the extension by itself at the first start of 0.7.1; the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#update-lock) says this extension is not tried on a TV yet, and that a USB update from the TV menu needs the switch off. In [#308](https://github.com/andrearicci93/vetro/issues/308) an update reached a QE65S85F with the earlier block on, for a reason not known yet. The details are in [what a firmware update does to root](/updates/firmware-update-remove-root/).
- Allow SDB from the local network, if you want to keep installing apps from Apps2Samsung or TV-Store. The dashboard says turning it on improves compatibility with both, and turning it off disconnects them. It opens Vetro's SDB tunnel to clients on your network, and the tunnel does not use Vetro pairing ([the security model](/reference/vetro-security-model/)). It moved here from Developer settings in 0.7.0.

Vetro UI's parts, the launcher with its Control center, live TV, the volume bar and the number pad, each have their own switch on the Vetro UI page. They are new in 0.7.0 and marked Preview; if one misbehaves, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the report from Quick settings, Developer settings, Diagnostic report.

## How do I check that it starts by itself?

The guide's test is to fully power off the TV, unplug it for 30 seconds, turn it on and check `/status` and `/monitor?scope=summary` without opening Vetro. You are looking for a new boot, a running service and an authenticated UID-0 agent. Standby is not a cold boot. Details are in [does root survive a restart](/root/keep-root-after-restart/).

## Can I update Vetro without reinstalling?

Yes, from Vetro 0.7.0 on, while root is connected; if root is unavailable, install the new version with Apps2Samsung. [Quick settings, General, Software update](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md) checks GitHub when you press Check for update, verifies a signed bundle and replaces the files when you press Update, with no computer attached and Host PC IP staying at `127.0.0.1`. If the new version does not start, Vetro puts the previous one back within four minutes. On a Tizen 6.5 or later TV, 0.7.0's updater still restarts its old service, so the [README](https://github.com/andrearicci93/vetro/blob/main/README.md#install) says to restart the whole TV within 3 minutes once the dashboard says Updating… (hold the remote's power button until it restarts, or unplug it for 30 seconds; standby is not enough), or to install with Apps2Samsung instead. That restart is for 0.7.0's updater. From 0.7.1 the updater restarts Vetro's service itself on Tizen 6.5 to 9; the [0.7.1 changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#071--2026-11-26) says no such TV had run that restart yet, and that if the new version is not there 2 minutes after Updating…, you restart the whole TV. A TV on 0.5.0 cannot take 0.7.1 or a later version and refuses it before anything changes, says [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md#which-versions-can-update), so install 0.7.2 with Apps2Samsung there. Version 0.7.2 changes nothing in `config.xml` that needs a reinstall.

| You have | How to get 0.7.2 |
| --- | --- |
| Vetro 0.7.1, root connected | Quick settings, General, Software update; if the new version is not there 2 minutes after Updating…, restart the whole TV |
| Vetro 0.7.0, root connected | Quick settings, General, Software update; on Tizen 6.5 or later, restart the whole TV within 3 minutes of Updating… |
| Vetro 0.7.0 or 0.7.1, root not connected | Install with Apps2Samsung as above |
| Vetro 0.5.0 | Install with Apps2Samsung as above; its updater refuses 0.7.1 and later |
| Vetro 0.3.x or older | Install with Apps2Samsung as above; those versions have no self-update |
| No Vetro yet | Install with Apps2Samsung as above |

Version 0.7.0 adds an Update Vetro tile on the Vetro screen of the TV, which offers the same signed update without a browser while root is connected; UPDATING.md says this path has not been tried on a TV yet. Update notices, in Developer settings and off by default, makes the dashboard look for new versions while it is open; installing stays manual. Self-update cannot change what `config.xml` declares; when a version does, you install again with Apps2Samsung. Before a reinstall, Save settings in Quick settings, General, Settings file (new in 0.7.1) keeps your Vetro choices in a file you can load again; the CHANGELOG says loading was not tried on a TV yet.

## What if I would rather sign it myself?

The installation guide has two other routes. A coding agent with a terminal can follow the guide for you; the guide names Codex or Gemini CLI, says not Claude because its cybersecurity safeguards stop it on the root steps, and says to type passwords yourself and never paste them into the chat. The manual route needs Tizen Studio's TV extension and Samsung Certificate Extension, your own certificate profile bound to your TV, and the root builder in the `rooting` folder with your certificate paths and passwords in environment variables. Install with `tizen install`, not `sdb install`, which a community report found did nothing without an error. The steps are in [INSTALLATION.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md).

## Limits

Compatibility is by model and firmware, not by year, and a firmware update can change it. To remove Vetro, see [uninstall Vetro and clean up](/root/uninstall-vetro-samsung-tv/). The main walkthrough is [how to root a Samsung TV](/root/how-to-root-samsung-tv/). Vetro is not affiliated with Samsung.
