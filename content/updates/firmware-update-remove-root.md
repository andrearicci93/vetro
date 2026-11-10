---
title: "Will a Samsung TV firmware update remove root? What we know"
description: "Can a firmware update remove root on a Samsung TV? What the root research and Vetro's public records say, what to do before updating, and what is unknown."
keywords: ["samsung tv firmware update remove root", "samsung tv root after update", "samsung tv firmware 2310.0 root", "keep root samsung tv update"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the samsung-tv-root README, Samsung's Auto Update support page and developer FAQ, and the Vetro README, CHANGELOG, UPDATING.md and PERFORMANCE.md for release 0.5.0."
related: ["stop-samsung-tv-auto-update", "keep-root-after-restart", "downgrade-samsung-tv-firmware", "how-to-root-samsung-tv", "is-it-safe-to-root-samsung-tv", "what-each-vetro-switch-changes"]
---

A firmware update can change whether root works, and nobody outside Samsung can promise otherwise. The root research Vetro builds on records results for exact models and firmware, not whole series, and Vetro's README says a firmware update can change the result even within one model family. Vetro's public files mention two firmware versions on one TV, the Q80A. This page gives them and says what they don't show.

## What does the root research say?

Chris Ritsen's [samsung-tv-root](https://github.com/chris-ritsen/samsung-tv-root) README says its root results are "for exact models and firmware, not every size or regional variant in a series". It never mentions firmware updates or whether one removes root. It does say root and UEP changes remain volatile: a controller reacquires root from another computer after a TV reboot, and the project installs no boot service on the TV. Its author also writes that his TVs are blocked from the internet after Developer Mode is enabled. The research doesn't answer the question, so the honest answer is that it depends on the firmware.

## What do Vetro's public records show?

Vetro's files record two firmware strings on the Q80A ([model page](/tested-tvs/q80a/)):

| Record | Firmware | What it covers |
| --- | --- | --- |
| [PERFORMANCE.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md), measurements of 2026-10-11 and 2026-10-23 | T-NKM2DEUC-2301.1 | Performance and memory tests |
| [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md), tests of 2026-10-30 | firmware 2310.0 | Signed self-update test through the root agent |

The README table still lists 2301.1 for the Q80A. The files don't say how the TV went from one version to the other, so they don't record a test of the update itself. What they do show is that the root agent worked on 2310.0, because the self-update test replaced files with it. A different model, the Q60A ([model page](/tested-tvs/q60a/), [#28](https://github.com/andrearicci93/vetro/issues/28)), is reported working on 2310.0.

That is two firmware versions on one TV. It is not a guarantee for any other model. See the [tested TVs index](/tested-tvs/).

## Does root come back after a restart?

Root from this route is volatile: it is gained again at each start. That is separate from a firmware update, and [does root survive a restart](/root/keep-root-after-restart/) covers it. After a cold boot, the install guide says startup and root can take up to 90 seconds.

## Does Vetro's own update change the firmware?

No. Vetro's self-update replaces Vetro's files, not the TV's firmware. Per [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md), Check for update asks GitHub for a signed bundle, the TV verifies it and replaces files with the root agent. If the new version doesn't confirm itself within four minutes, a watchdog puts the old files back, and you can roll back by hand. It cannot change what `config.xml` declares; that needs a reinstall.

UPDATING.md describes an end-to-end test on a Q80A with a throw-away key, and the 0.5.0 changelog says a signed update with the release key was tried by hand on a Q80A. UPDATING.md lists what is still not measured, including a reboot after a file swap.

## What should I do before updating?

Vetro has no tested procedure for this, so this is cautious practice, not a guarantee.

1. Write down your exact model code and firmware. Vetro's diagnostic report records them, and [the model code decoder](/reference/samsung-model-code-decoder/) explains the string.
2. Check the README compatibility table and the issues for your model and for the newer firmware.
3. Decide whether you want updates at all. [Stopping automatic updates](/updates/stop-samsung-tv-auto-update/) removes one trigger, and Vetro has a switch for it. Samsung's [Auto Update page](https://www.samsung.com/us/support/answer/ANS10002051/) says updates install while you watch TV and take effect the next time the TV is turned on.
4. Assume going back is not possible. Samsung's [developer FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html) says downgrading is not supported; see [can you downgrade](/updates/downgrade-samsung-tv-firmware/).
5. Know how to remove Vetro if root is lost: [uninstalling Vetro](/root/uninstall-vetro-samsung-tv/).

## Why must I check the exact model and firmware?

The README lists reports for specific model and firmware combinations. It does not say what an update does to other combinations. The 2021 [Q70A](/tested-tvs/q70a/) ([#8](https://github.com/andrearicci93/vetro/issues/8)) and [QN85A](/tested-tvs/qn85a/) are listed on firmware 2301.1 and the [Q60A](/tested-tvs/q60a/) on 2310.0. The 2022 [BU8002](/tested-tvs/bu8002/) ([#22](https://github.com/andrearicci93/vetro/issues/22)) and [QN85B](/tested-tvs/qn85b/) ([#25](https://github.com/andrearicci93/vetro/issues/25)) are on 1720.7. Each is a separate report, not a before-and-after comparison. Not every report is full support: a 2018 [UE43NU7090](/tested-tvs/nu7090/) ([#2](https://github.com/andrearicci93/vetro/issues/2)) has the dashboard, app list and diagnostics working and the features that need root unavailable.

## What should I send if something changes?

Open a diagnostic report issue with your exact model and firmware, what worked or failed and the report from Quick settings, Developer settings, Diagnostic report. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history, and asks you to read it before you upload it. A report with the firmware before and after an update is more useful than one that says it stopped.

## Limits

Vetro's public files contain no record of what changes inside a firmware update, no test of a Q80A moving between those versions and no data on most other models. Vetro is experimental, needs root and ships no signed installer; start with [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [how to install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/).

## Next steps

Read [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/) for the firmware-update switch.
