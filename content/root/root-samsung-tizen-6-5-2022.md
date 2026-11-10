---
title: "Root a 2022 Samsung TV (Tizen 6.5): models and firmware"
description: "2022 Samsung TVs run Tizen 6.5. Five models have Vetro reports (Q67B, BU8002, QN85B, S95B, The Frame), the Home cache fix and what stayed unconfirmed."
keywords: ["root samsung tizen 6.5", "samsung 2022 tv root", "root samsung the frame 2022"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Vetro 0.5.0 README compatibility table and the CHANGELOG compatibility and Launcher entries."
related: ["how-to-root-samsung-tv", "root-tizen-6-samsung-tv", "custom-launcher-samsung-tv", "samsung-tv-tizen-version-by-year", "root-samsung-tizen-7-2023", "install-vetro-apps2samsung"]
---

Samsung's 2022 TVs launched with Tizen 6.5. Five have reports in Vetro's compatibility table: four are reported working, and the QN85B had working core functions with a Launcher that failed until Vetro 0.3.1. The firmware in these reports is in the 1720.7 family. Vetro is experimental, needs root and ships no signed installer; read [the risks](/root/is-it-safe-to-root-samsung-tv/) first.

The root comes from [Chris Ritsen's research](https://github.com/chris-ritsen/samsung-tv-root). That repository is written for researchers and can contain exploit code; this page contains none. For the overview, see [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## Which 2022 Samsung TVs have been reported?

| TV | Firmware | Status | Report |
| --- | --- | --- | --- |
| [Q67B](/tested-tvs/q67b/) (QE43Q67BAUXXH) | T-NKLBDEUC-1720.7 | Reported working; 32 components disabled through the registry; cold-boot persistence and the system service listing not confirmed | no issue number |
| [UE65BU8002](/tested-tvs/bu8002/) | T-KSU2EBDEUC-1720.7 | Reported working; the Launcher needed the 0.3.1 fix | [#22](https://github.com/andrearicci93/vetro/issues/22) |
| [QE75QN85B](/tested-tvs/qn85b/) | 1720.7 | Core functions reported working; the Launcher failed before 0.3.1 | [#25](https://github.com/andrearicci93/vetro/issues/25) |
| [QN55S95B](/tested-tvs/s95b/) (QN55S95BAFXZA) | T-PTMAKUC-1720.7 | Reported working; 15 of 17 ad and analytics packages disabled and verified; only 267 of its 368 packages are in the Q80A-based catalog | [#14](https://github.com/andrearicci93/vetro/issues/14) |
| [The Frame LS03B](/tested-tvs/ls03b/) (QN75LS03BAFXZA) | T-PTMAKUC-1720.7 | Reported working; the service started by itself after a cold boot; the Launcher was not tried | [#39](https://github.com/andrearicci93/vetro/issues/39) |

## What was the Home cache fix?

Samsung keeps the Home order cache in a different folder on TVs that ship the newer Home. On the BU8002 and the QN85B, turning the Launcher on failed with the message that the Home row was empty or unreadable. Vetro 0.3.1 looks in both folders, so nothing changes where the old one worked, and the Home order tool (reorder and restore) got the same fix. The changelog says it was tested against copies of the real folders, not on a TV that has the newer Home.

The first 0.3.1 note said the Home cache moved on 2022 TVs. The changelog later corrected that: the newer Home is also on models up to 2025 running Tizen 9. The fix is the same. If your Launcher does not start on a 2022 TV, make sure you run a current Vetro. The [custom launcher article](/speed/custom-launcher-samsung-tv/) explains what the Launcher does.

## What is not confirmed on these TVs?

The Q67B report is the clearest example of a limit. The app, the service and an authenticated UID-0 agent were running, but cold-boot persistence and the system service listing, which was unavailable in that report, were not confirmed. An owner who relies on Vetro starting by itself should not read "reported working" as proof of that.

The S95B report is the clearest example of a catalog limit. Root worked on the first try after the Host PC IP step, and 15 of 17 ad and analytics packages were disabled and verified. Only 267 of the TV's 368 packages are in the catalog Vetro built from the Q80A, so on a TV that is not a Q80A the dashboard can describe less of what is installed.

The Frame report says the Launcher was not tried, and the QN85B and BU8002 reports predate the fix. A report is a snapshot of one TV on one firmware, so compare your firmware string with the one above using [the model code decoder](/reference/samsung-model-code-decoder/). A firmware update can change the result; see [will a firmware update remove root](/updates/firmware-update-remove-root/). If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it.

## Does the service start by itself on a new install?

Not always. The install guide asks you to open Vetro once after installing, because on some TVs the installer registers the service without the on-boot and auto-restart settings, as the QN85B report ([#25](https://github.com/andrearicci93/vetro/issues/25)) showed. Since 0.3.2 Vetro sets them back, but only once the app has been opened and the root agent has connected. The [install guide](/root/install-vetro-apps2samsung/) has the order of steps.

## Next steps

If your Launcher fails on a 2022 TV, check that you run 0.3.1 or newer, then compare your firmware with [#22](https://github.com/andrearicci93/vetro/issues/22) and [#25](https://github.com/andrearicci93/vetro/issues/25). The previous generation is on the [2021 page](/root/root-tizen-6-samsung-tv/) and the next on the [2023 page](/root/root-samsung-tizen-7-2023/).
