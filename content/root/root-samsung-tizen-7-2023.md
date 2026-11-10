---
title: "Root a 2023 Samsung TV (Tizen 7+): what owners reported"
description: "2023 Samsung TVs launched on Tizen 7. Owners reported Vetro on the S90C, Q65S95C and CU7179, with an installer caveat and one set that lists Tizen 9.0."
keywords: ["root samsung tizen 7", "samsung 2023 tv root", "samsung s90c root"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Vetro 0.5.0 README compatibility table, the CHANGELOG compatibility and installer entries, Samsung's TV model groups page and the SamMobile update article."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-6-5-2022", "root-samsung-tizen-8-9-2024", "samsung-tv-tizen-version-by-year", "firmware-update-remove-root", "install-vetro-apps2samsung"]
---

Samsung's 2023 TVs launched with Tizen 7.0, and Samsung's [TV model groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups) maps that year to Tizen 7.0. Three 2023 models are in the Vetro compatibility table, all reported working. One of them lists Tizen 9.0, which shows why the model year alone does not tell you which Tizen you have. Three models is a small sample, so treat the table as leads, not a compatibility guarantee.

The root comes from [Chris Ritsen's research](https://github.com/chris-ritsen/samsung-tv-root). That repository is written for researchers and can contain exploit code; this page contains none. Vetro is experimental, needs root and ships no signed installer; see [the risks](/root/is-it-safe-to-root-samsung-tv/) and [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## Which 2023 Samsung TVs have been reported?

| TV | Tizen | Firmware | Status | Report |
| --- | --- | --- | --- | --- |
| [S90C](/tested-tvs/s90c/) (TQ65S90CATXXC) | 7.0 | T-PTMCDEUC-2000.2 | Reported working | [#16](https://github.com/andrearicci93/vetro/issues/16) |
| [Q65S95C](/tested-tvs/s95c/) | not stated; 7.0 at launch | T-PTMCDEUC-0090-2220.4 | Reported working | [#13](https://github.com/andrearicci93/vetro/issues/13) |
| [GU75CU7179](/tested-tvs/cu7179/) | 9.0 | not stated (platform code `23_KSUE_UB_T09`) | Reported working, installed with Apps2Samsung | [#17](https://github.com/andrearicci93/vetro/issues/17) |

"Reported working" means the owner described what worked. The table uses the Tizen version in each report, not the launch version. The README lists `23_KSUE_UB_T09` for the CU7179 where the other rows have a firmware string. It does not have the shape of those strings, so we read it as a platform code and do not present it as a firmware version.

## What did the Q65S95C report confirm?

The Q65S95C report (Vetro 0.2.3) shows the service running on Node v18.18.2 with an authenticated UID-0 agent, 23 voice-assistant and ACR components disabled from Quick settings, button remaps in use and 29 of 29 controls confirmed, according to the [changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). The same changelog notes that the startup listing section of the diagnostic report came back unavailable in this report, as in the Q65 and S95B ones, until Vetro split the command in two. That is a report-quality fix, not a limit on the TV.

## Does the service start by itself on a 2023 TV?

Not on a new install, without one extra step. On the S90C, three clean installs registered Vetro's service without the on-boot and auto-restart settings, although the package asks for both, so the service did not start after a restart until someone opened the app. The CU7179 report ([#17](https://github.com/andrearicci93/vetro/issues/17)) shows the same registration.

Vetro puts those two settings back once the root agent has connected, and the changelog says it started 40 to 65 seconds after a restart or power cut on the S90C. A new install still needs the app opened once, because the root agent has to connect first. The [install guide](/root/install-vetro-apps2samsung/) says so too.

## Why does one 2023 TV say Tizen 9.0?

The report lists Tizen 9.0, while Samsung's model groups page gives the 2023 group Tizen 7.0. So this set is either on a later build or has updated, and the report does not say which. [SamMobile](https://www.sammobile.com/opinion/samsung-promised-7-years-of-tv-updates-still-waiting-to-see-what-happens/) quotes Samsung's seven-year promise for TVs released in 2024 or later and select 2023 models, and says 2023 sets were starting toward Tizen 9. Its examples are premium OLED and Neo QLED models, and the CU7179 is not one, so that article does not explain this report.

Check your own version in the TV's settings and compare it with [Samsung TV Tizen version by year](/root/samsung-tv-tizen-version-by-year/). A TV that updated to a newer Tizen is a different target from the same model on its launch firmware, so to avoid a surprise update read [how to stop automatic firmware updates](/updates/stop-samsung-tv-auto-update/) and [what an update does to root](/updates/firmware-update-remove-root/).

If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it. Failed attempts help too.

## Next steps

Check whether your 2023 set registered the on-boot settings by looking at the service after a restart, then open the app once if it did not. If your TV is on Tizen 9 or later, read the [2024 page](/root/root-samsung-tizen-8-9-2024/), including the Tizen 9 and 10 failures, before treating a working report as representative. Earlier sets are on the [2022 page](/root/root-samsung-tizen-6-5-2022/).
