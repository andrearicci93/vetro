---
title: "Root a 2023 Samsung TV (Tizen 7+): what owners reported"
description: "2023 Samsung TVs launched on Tizen 7. Owners reported Vetro on the S90C, Q65S95C, CU7179 and CU8070, with an installer caveat and three reports on Tizen 9."
keywords: ["root samsung tizen 7", "samsung 2023 tv root", "samsung s90c root"]
date: 2026-11-10
updated: 2026-11-27
verified: "Updated on 2026-11-27 against the Vetro 0.7.1 README (Compatibility, Report a problem) and CHANGELOG (Update lock) at commit cbc363f, and the SamMobile update article re-read on 2026-11-27. Issue #223 and Samsung's TV model groups page are as checked on 2026-11-21."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-6-5-2022", "root-samsung-tizen-8-9-2024", "samsung-tv-tizen-version-by-year", "firmware-update-remove-root", "install-vetro-apps2samsung"]
---

Samsung's 2023 TVs launched with Tizen 7.0, and Samsung's [TV model groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups) maps that year to Tizen 7.0. Four 2023 models are in the Vetro compatibility table, with five positive reports between them (two are for separate S90C sets). Three reports list Tizen 9, which shows why the model year alone does not tell you which Tizen you have. Four models is a small sample, so treat the table as leads, not a compatibility guarantee.

The root comes from [Chris Ritsen's research](https://github.com/chris-ritsen/samsung-tv-root). That repository is written for researchers and can contain exploit code; this page contains none. Vetro is experimental, needs root and ships no signed installer; see [the risks](/root/is-it-safe-to-root-samsung-tv/) and [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## Which 2023 Samsung TVs have been reported?

| TV | Tizen | Firmware | Status | Report |
| --- | --- | --- | --- | --- |
| [S90C](/tested-tvs/s90c/) (TQ65S90CATXXC) | 7.0 | T-PTMCDEUC-2000.2 | Reported working | [#16](https://github.com/andrearicci93/vetro/issues/16) |
| [S90C (QN65S90CAFXZA)](/tested-tvs/s90c-tizen-9/) | 9 | T-PTMCAKUC-0090-2220.4 | Service and root verified with Vetro 0.7.0 | [#317](https://github.com/andrearicci93/vetro/issues/317) |
| [Q65S95C](/tested-tvs/s95c/) | not stated; 7.0 at launch | T-PTMCDEUC-0090-2220.4 | Reported working | [#13](https://github.com/andrearicci93/vetro/issues/13) |
| [GU75CU7179](/tested-tvs/cu7179/) | 9.0 | not stated (platform code `23_KSUE_UB_T09`) | Reported working, installed with Apps2Samsung | [#17](https://github.com/andrearicci93/vetro/issues/17) |
| [UE43CU8070](/tested-tvs/cu8070/) (UE43CU8070UXXN) | 9.0 | 2220 | Reported working with Vetro 0.5.0, installed with Apps2Samsung: root agent with UID 0 after setting Host PC IP to 127.0.0.1 and restarting; the physical Home key opens a custom launcher, with Samsung Home kept | [#183](https://github.com/andrearicci93/vetro/issues/183) |

"Reported working" means the owner described what worked. The table uses the Tizen version in each report, not the launch version. The README lists `23_KSUE_UB_T09` for the CU7179 where the other rows have a firmware string. It does not have the shape of those strings, so we read it as a platform code and do not present it as a firmware version.

## What did the Q65S95C report confirm?

The Q65S95C report (Vetro 0.2.3) shows the service running on Node v18.18.2 with an authenticated UID-0 agent, 23 voice-assistant and ACR components disabled from Quick settings, button remaps in use and 29 of 29 controls confirmed, according to the [changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). The same changelog notes that the startup listing section of the diagnostic report came back unavailable in this report, as in the Q65 and S95B ones, until Vetro split the command in two. That is a report-quality fix, not a limit on the TV.

## Does the service start by itself on a 2023 TV?

Not on a new install, without one extra step. On the S90C, three clean installs registered Vetro's service without the on-boot and auto-restart settings, although the package asks for both, so the service did not start after a restart until someone opened the app. The CU7179 report ([#17](https://github.com/andrearicci93/vetro/issues/17)) shows the same registration.

Vetro puts those two settings back once the root agent has connected, and the changelog says it started 40 to 65 seconds after a restart or power cut on the S90C. A new install still needs the app opened once, because the root agent has to connect first. The [install guide](/root/install-vetro-apps2samsung/) says so too.

## Why do some 2023 TVs report Tizen 9?

The CU7179 and CU8070 reports list Tizen 9.0, and the second S90C report ([#317](https://github.com/andrearicci93/vetro/issues/317), [model page](/tested-tvs/s90c-tizen-9/)) lists Tizen 9, while Samsung's model groups page gives the 2023 group Tizen 7.0. So these sets are either on a later build or have updated, and the reports do not say which. The two S90C reports are separate TVs: the [S90C page](/tested-tvs/s90c/) is the Tizen 7.0 one from #16. [SamMobile](https://www.sammobile.com/opinion/samsung-promised-7-years-of-tv-updates-still-waiting-to-see-what-happens/) quotes Samsung's seven-year promise for TVs released in 2024 or later and select 2023 models, and says 2023 sets were starting toward Tizen 9. It talks about 2023's premium OLED and Neo QLED models without a full list, and its only named example is a QN90C, so it does not explain the CU7179 and CU8070 reports.

Check your own version in the TV's settings and compare it with [Samsung TV Tizen version by year](/root/samsung-tv-tizen-version-by-year/). A TV that updated to a newer Tizen is a different target from the same model on its launch firmware, and an update can also remove root: in [#223](https://github.com/andrearicci93/vetro/issues/223) a forced update to 1722.0 removed it on a 2022 TV, and Samsung does not support downgrades. Since 0.7.0, Vetro's Block firmware and software updates switch (Quick settings, General, Essential settings) stops and masks the update services Vetro knows about and is designed to block Samsung's firmware and app updates. The changelog lists the early power-on step for Tizen 6, 6.5 and 9 and says the lock was tried on a Q80A only; on other firmware it starts with Vetro's root agent. Vetro 0.7.1 extends it to Samsung's separate update mode, which starts before any app, and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#update-lock) says that extension is not tried on a TV yet. In [#308](https://github.com/andrearicci93/vetro/issues/308) an update reached a QE65S85F with the earlier block on, and what happened there is not known. Turn it on while root still works: it can help keep root, but it does not guarantee it. Read [how to stop automatic firmware updates](/updates/stop-samsung-tv-auto-update/) and [what an update does to root](/updates/firmware-update-remove-root/).

If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report has no passwords, network addresses, device ids or viewing history, but it lists app names; read it before you upload it. Failed attempts help too.

## Next steps

Check whether your 2023 set registered the on-boot settings by looking at the service after a restart, then open the app once if it did not. If your TV is on Tizen 9 or later, read the [2024 page](/root/root-samsung-tizen-8-9-2024/), including the Tizen 9 problems and the first Tizen 10 root reports from Vetro 0.7.1, before treating a working report as representative. Earlier sets are on the [2022 page](/root/root-samsung-tizen-6-5-2022/).
