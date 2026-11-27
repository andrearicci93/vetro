---
title: "Will a Samsung TV firmware update remove root? What we know"
description: "A forced Samsung firmware update has already removed root from a rooted TV. What the reports show, how Vetro 0.7.1 blocks updates and what it cannot promise."
keywords: ["samsung tv firmware update remove root", "samsung tv root after update", "samsung tv firmware 1722.0 root", "keep root samsung tv update"]
date: 2026-11-10
updated: 2026-11-27
verified: "Samsung's developer FAQ and the samsung-tv-root README were checked on 2026-11-21; Vetro parts rechecked on 2026-11-27 against the 0.7.1 CHANGELOG, README compatibility table, UPDATING.md and UPDATES-WITHOUT-ROOT.md at commit cbc363f."
related: ["stop-samsung-tv-auto-update", "keep-root-after-restart", "downgrade-samsung-tv-firmware", "how-to-root-samsung-tv", "is-it-safe-to-root-samsung-tv", "what-each-vetro-switch-changes"]
---

Yes, a firmware update can remove root, and it has already happened. In Vetro [issue #223](https://github.com/andrearicci93/vetro/issues/223) the owner of a 2022 Samsung TV that rooted on firmware 1720.7 reports that a forced update to 1722.0 removed root, and Vetro 0.5.0 could not get it back. Samsung does not support going back to older firmware. If your TV still roots, the most Vetro can do is block updates before one arrives: install Vetro and turn on Block firmware and software updates. It can help keep root; it does not guarantee it.

## What happened in issue #223?

The reporter's TV, a UE43BU8075U, ran Vetro 0.5.0 on firmware 1720.7. The issue says Samsung rolled out a forced update to T-KSU2EBDEUC-1722.0 and that the TV can no longer be rooted with the tools that exist today. The owner says the update installed although automatic firmware updates were off on the TV and in Vetro. They had blocked selected DNS resolvers on the router, used DNS filtering and turned IPv6 off on the TV; they did not report cutting the TV off from the internet. The switch in 0.5.0 only changed the menu's Auto update value, and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) cites #223 for the broader switch in 0.7.0.

Firmware 1720.7 is also the firmware of several 2022 TVs on the [tested TVs list](/tested-tvs/), such as the [BU8002](/tested-tvs/bu8002/), [Q60B](/tested-tvs/q60b/) and [QN90B](/tested-tvs/qn90b/). Whether each of them gets the same update is not known.

#223 is no longer the only report. The [README compatibility table](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) now lists a QN90B on 1722.1 with root unavailable ([#223](https://github.com/andrearicci93/vetro/issues/223#issuecomment-7097349522)) and a Q60B on 1722.1 with root unavailable under Vetro 0.7.0 ([#319](https://github.com/andrearicci93/vetro/issues/319)). The README says owners of 2022 TVs on 1722.0 or 1722.1 reported losing root or being unable to connect, and that Vetro 0.7.1 can attempt recovery, which still needs confirmation on the affected TVs. Until such a report arrives, treat 1722.x as firmware where root may not come back.

There is no supported way back. Samsung's [developer FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html) says downgrading TV firmware is not supported; see [can you downgrade](/updates/downgrade-samsung-tv-firmware/).

## Does root work on Tizen 10?

On some sets, and only from Vetro 0.7.1. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) says Tizen 10 root support starts in 0.7.1. That version has a separate root route for Tizen 10. Root connected in test builds on the [S85F](/tested-tvs/s85f/) (QE65S85F), [Q70F](/tested-tvs/q70f/), [U8000F](/tested-tvs/u8000f/) and [QN900F](/tested-tvs/qn900f/), all on firmware variants ending in 2103.1; on the QN900F it connected after retries, with the launcher off during the test. The README adds that feature coverage varies by model and that field reports for the final 0.7.1 build are still pending, and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#tizen-10) says this build was not tried on a Tizen 10 TV. Read it as reported on test builds, not a guarantee.

Firmware updates are part of the Tizen 10 story too. A [QN80F](/tested-tvs/qn80f/) lost root after a firmware update under Vetro 0.5.0 ([#181](https://github.com/andrearicci93/vetro/issues/181)), and root is still unconfirmed on it with 0.7.1. The [M70H](/tested-tvs/m70h/), M73H and U8000H had root failures with earlier builds and remain unconfirmed ([#91](https://github.com/andrearicci93/vetro/issues/91), [#140](https://github.com/andrearicci93/vetro/issues/140), [#177](https://github.com/andrearicci93/vetro/issues/177), [#178](https://github.com/andrearicci93/vetro/issues/178)). For the S85F, the README also records an earlier report of root lost after a Samsung firmware update ([#308](https://github.com/andrearicci93/vetro/issues/308)). The 2103.1 results say nothing about the firmware Samsung ships next.

## How does Vetro block updates?

The switch is Block firmware and software updates, in Quick settings, General, Essential settings. It is off until you turn it on, and it needs root. Vetro's dashboard describes it with a warning that Samsung is trying to block root with remote firmware updates; #223 is the documented case.

The TV's own Auto update setting only decides what the TV does with a firmware image it has already found. Vetro's [guide to blocking updates without root](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATES-WITHOUT-ROOT.md) lists four update paths that run on their own: over-the-air firmware, app and package updates, app-binary downloads and system components. According to the CHANGELOG, the 0.7.0 switch:

1. Stops and masks the update services: the background firmware loop with its downloader and installer, the background app and package updates, the app-binary manager, the system component updater and the preview updater.
2. Turns the Auto update setting and the app-binary switch off and removes the download markers.
3. Applies the lock again after every restart. On TVs that run the AT-HUB boot step (Tizen 6, 6.5 and 9) it does so at power-on, before the update services start. On other firmware it starts with Vetro's root agent, later in the boot.
4. Leaves USB recovery working. Turning the switch off unmasks the services and restores the previous Auto update value.

The CHANGELOG's own caution: the behavior was read from the Tizen 6, 6.5 and 9 firmware. On a Q80A (firmware 2310.0) the masks on the update services were in place after a cold reboot, before Vetro's service started. No TV was tested against a forced update like the one in #223, and other models are not tried. The lock is designed to delay firmware and app updates, security fixes included. An update got through the earlier lock on an S85F, and the 0.7.1 additions have not been tried on a TV. A firmware update that lands anyway replaces everything the switch does.

### What does 0.7.1 add to the lock?

In [#308](https://github.com/andrearicci93/vetro/issues/308) a Samsung firmware update reached an S85F that had the earlier block on. The [0.7.1 CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#update-lock) says what happened there is not known yet; the lock was re-checked against 2021, 2022 and 2024 firmware and these gaps were closed:

- Samsung's update software can ask the TV to restart into a separate update mode that starts before any app, Vetro included, and installs from Samsung's servers. The switch now removes that request when it is turned on, at every restart and as soon as it is written.
- Samsung's own setting that lets an update too big for the TV's storage be downloaded in that mode is kept off, also at every restart. It is off in the factory settings of the 2021, 2022 and 2024 TVs checked.
- One more update service is stopped.
- Two update servers one owner reported are added to Vetro's DNS blocking list, blocked only while Enable DNS blocking is on and Vetro runs.
- A TV that had the switch on before 0.7.1 gets all of this at the first start of 0.7.1, without turning it off and on.

A USB update from the TV menu now needs the switch off. None of the 0.7.1 changes has been tried on a TV yet, so they close gaps found in the firmware, not gaps proven on a set.

## What if Vetro has no root on my TV?

Then Vetro cannot stop any of these services, and the dashboard shows Root required where the switch would be. The [without-root guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATES-WITHOUT-ROOT.md) says the only reliable block is then the network: deny the TV internet access on your router for IPv4 and IPv6, or put it on a network without internet access. A complete cutoff like that blocks the updates that come over the network, which is more than the owner in #223 reported doing. A DNS blocklist alone is not enough, because the TV can reach a host by its address, use another resolver or go over IPv6. A firmware file on a USB stick still installs without any network. [Stopping automatic updates](/updates/stop-samsung-tv-auto-update/) compares the options.

## What do Vetro's records show for the Q80A?

Vetro's files record two firmware strings on the Q80A ([model page](/tested-tvs/q80a/)):

| Record | Firmware | What it covers |
| --- | --- | --- |
| [PERFORMANCE.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md), measurements of 2026-10-11 and 2026-10-23 | T-NKM2DEUC-2301.1 | Performance and memory tests |
| [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md), tests of 2026-10-30 | firmware 2310.0 | Signed self-update test through the root agent |
| 0.7.0 CHANGELOG, update lock | firmware 2310.0 | The update-service masks after a cold reboot |

The README table still lists 2301.1 for the Q80A. The files don't say how the TV went from one version to the other, so they don't record a test of the update itself. They do show that root worked on 2310.0. The [Q60A](/tested-tvs/q60a/) ([#28](https://github.com/andrearicci93/vetro/issues/28)) is also reported working on 2310.0. That is two firmware versions on one TV, not a guarantee for any other model.

## Does root come back after a restart?

Root from this route is volatile: it is gained again at each start. That is separate from a firmware update, and [does root survive a restart](/root/keep-root-after-restart/) covers it. The install guide says startup and root can take more than a minute after a restart, sometimes more than 90 seconds; wait until the dashboard says the root agent is connected.

## Does Vetro's own update change the firmware?

No. Vetro's self-update replaces Vetro's files, not the TV's firmware. Per [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md), Quick settings, General, Software update asks GitHub for a signed bundle, the TV verifies it and the root agent replaces the files. If the new version doesn't confirm itself within four minutes, a watchdog puts the old files back, and you can roll back by hand. It cannot change what `config.xml` declares; that needs a reinstall.

A TV on Vetro 0.5.0 updated itself to 0.7.0 this way; the CHANGELOG says updating from 0.5.0 was checked end to end. Version 0.7.0 adds an Update Vetro tile on the TV that does the same without a browser; UPDATING.md says that path has not been tried on a TV yet. For 0.7.1, UPDATING.md lists [which versions can update](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md#which-versions-can-update): a TV on 0.5.0 cannot take it and needs Apps2Samsung, and a TV on 0.7.0 updates from Quick settings. On a Tizen 6.5 or later TV the [README](https://github.com/andrearicci93/vetro/blob/main/README.md#install) says the 0.7.0 updater still restarts its old service, so restart the whole TV within 3 minutes once the dashboard says Updating (hold the power button or unplug it for 30 seconds; standby is not enough), or install with Apps2Samsung.

## What should I do before updating?

Vetro has no tested procedure for a firmware update, so this is cautious practice, not a guarantee.

1. Write down your exact model code and firmware. Vetro's diagnostic report records them, and [the model code decoder](/reference/samsung-model-code-decoder/) explains the string.
2. Check the README compatibility table and the issues for your model and for the newer firmware, including #223, #319 and #308.
3. Save your Vetro settings. Since 0.7.1, Quick settings, General, Settings file, Save settings writes one file with your Vetro choices (launcher, Remapper rules, Quick settings groups you switched off, DNS blocking, MQTT and more), never passwords or pairing, so you can load it after an update, a Smart Hub reset or on another TV ([CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#settings-file)). Quick settings and DNS blocking are saved only while Root access is connected, and on a load those parts are listed as not loaded while root is away, so the file does not bring root back. The changelog says the feature has not been tried on a TV yet.
4. Decide whether you want updates at all. If your TV is rooted and you want to keep root, turn on Block firmware and software updates now rather than after an update is offered. [Stopping automatic updates](/updates/stop-samsung-tv-auto-update/) explains why the menu toggle alone is not enough.
5. Assume going back is not possible, as Samsung's FAQ says.
6. Know how to remove Vetro if root is lost: [uninstalling Vetro](/root/uninstall-vetro-samsung-tv/).

## Why must I check the exact model and firmware?

The README lists reports for specific model and firmware combinations. It does not say what an update does to other combinations. The 2021 [Q70A](/tested-tvs/q70a/) ([#8](https://github.com/andrearicci93/vetro/issues/8)) and [QN85A](/tested-tvs/qn85a/) are listed on firmware 2301.1 and the Q60A on 2310.0. The 2022 BU8002 ([#22](https://github.com/andrearicci93/vetro/issues/22)) and [QN85B](/tested-tvs/qn85b/) ([#25](https://github.com/andrearicci93/vetro/issues/25)) are on 1720.7, the firmware #223 moved away from. Each is a separate report, not a before-and-after comparison. Not every report is full support: a 2018 [UE43NU7090](/tested-tvs/nu7090/) ([#2](https://github.com/andrearicci93/vetro/issues/2)) has the dashboard, app list and diagnostics working and the features that need root unavailable.

## What should I send if something changes?

Open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with your exact model and firmware, what worked or failed and the report from Quick settings, Developer settings, Diagnostic report. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history, and asks you to read it before you upload it. A report with the firmware before and after an update is more useful than one that says it stopped.

## Limits

Vetro's public files contain no record of what changes inside a firmware update and no data on most models. The 0.7.0 update lock was checked after a cold reboot on one Q80A and has not been tested against a forced update like the one in #223 on any TV; the 0.7.1 additions have not been tried on a TV at all. Tizen 10 root rests on test-build reports from four sets. Vetro is experimental, needs root and ships no signed installer; start with [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [how to install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/).

## Next steps

Read [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/) for the full switch reference.
