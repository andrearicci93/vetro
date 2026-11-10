---
title: "Root a Tizen 6 Samsung TV (2021): models and firmware"
description: "2021 Samsung TVs run Tizen 6. Four are reported working with Vetro (Q80A, Q70A, Q60A, QN85A); an AU7000 report failed at the root agent. Firmware and caveats."
keywords: ["root tizen 6 tv", "samsung q80a root", "samsung 2021 tv root"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Vetro 0.5.0 README compatibility table, the CHANGELOG compatibility entries and the install guide."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-6-5-2022", "samsung-tv-tizen-version-by-year", "install-vetro-apps2samsung", "keep-root-after-restart", "samsung-model-code-decoder"]
---

Samsung's 2021 TVs run Tizen 6.0, and this is the generation Vetro is built on: the project's reference TV is a [Q80A](/tested-tvs/q80a/). Five 2021 models are in the compatibility table. Four are reported working; the fifth, the [AU7000](/tested-tvs/au7000/), got the dashboard but its root agent did not connect. Vetro is experimental, needs root and ships no signed installer (see [the risks](/root/is-it-safe-to-root-samsung-tv/)).

The root comes from [Chris Ritsen's research](https://github.com/chris-ritsen/samsung-tv-root). That repository is written for researchers and can contain exploit code. This page contains none; for the general picture see [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## Which 2021 Samsung TVs have been reported?

| TV | Firmware | Status | Report |
| --- | --- | --- | --- |
| [Q80A](/tested-tvs/q80a/) (QE50Q80AATXZT) | T-NKM2DEUC-2301.1 | Developed and tested | the project's own TV |
| [Q70A](/tested-tvs/q70a/) (QE55Q70AATXXC) | T-NKM2DEUC-2301.1 | Reported working | [#8](https://github.com/andrearicci93/vetro/issues/8) |
| [Q60A](/tested-tvs/q60a/) (QN70Q60AAVXZC) | T-NKLAAKUC-2310.0 | Reported working; listen port changed to avoid a clash | [#28](https://github.com/andrearicci93/vetro/issues/28) |
| [QN85A](/tested-tvs/qn85a/) (GQ65QN85AATXZG) | T-NKM2DEUC-2301.1 | Reported working; back after a reboot once the owner enabled the service's on-boot and auto-restart flags | no issue number |
| [AU7000](/tested-tvs/au7000/) (UA50AU7000UXTW) | T-KSU2EUABC-2310.0 | Service and dashboard work; the root agent did not connect, so root features stay off | [#134](https://github.com/andrearicci93/vetro/issues/134) |

## What did each report actually confirm?

The Q70A report (firmware 2301.1) says setup with root access completed, that Quick settings, the Debloater and domain blocking were used, and that the diagnostic export confirmed 29 controls against the TV's own method list, according to the [changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). It is the most complete 2021 report apart from the reference TV.

The QN85A report has no public issue, so the only evidence is the changelog entry: the app, the service and the UID-0 agent were working and recovered after a reboot, once the owner had enabled the service's on-boot and auto-restart flags. A new owner should not assume that recovery is automatic. The changelog also records that a DNS filter blocking one Samsung certificate host made Certificate Manager fail on that TV.

A contributor's test on a Q60A used a personal certificate; the changelog says the service started on every launch of the app there. "Reported working" always means the owner said what worked, not that every feature was tried.

## Why did the Q60A need a different port?

The Q60A owner changed the listen port to avoid a clash with tizen-youtube, which uses the same default port. The changelog says the same about TizenTube. If another app already holds the port, Vetro says so in its service log and retries instead of taking over. The [TizenTube article](/control/tizentube-samsung-tv/) covers the interaction.

## What went wrong on the AU7000?

The AU7000 report ([#134](https://github.com/andrearicci93/vetro/issues/134)) is the one failed 2021 result in the README. The service and dashboard ran, but the root agent did not connect because the Host PC IP step was not confirmed, so everything that needs root stayed off. The README's 2021 row says one TV needs that step confirmed. The install guide has the step as its own part and a troubleshooting table that starts from what the status page shows, so read it before concluding a TV cannot be rooted.

If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it.

## What should I check before I try a 2021 TV?

- Your exact model code and firmware string, using [the model code decoder](/reference/samsung-model-code-decoder/).
- That the TV is on Tizen 6. [Samsung TV Tizen version by year](/root/samsung-tv-tizen-version-by-year/) lists the versions.
- That Developer Mode works and that you can enter an IP address. The [Developer Mode guide](/root/samsung-tv-developer-mode/) lists the usual snags.
- That you allow time: after a cold boot, startup and root can take up to 90 seconds, according to the [install guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md). [Does root survive a restart](/root/keep-root-after-restart/) says what has been measured.

## Next steps

If your TV is a 2021 set that behaves like the AU7000, read the [install guide](/root/install-vetro-apps2samsung/) troubleshooting table before assuming the Host PC IP step was enough. For the next generation, see the [2022 TVs on Tizen 6.5](/root/root-samsung-tizen-6-5-2022/); for the older ones, the [2019 and 2020 page](/root/root-samsung-2019-2020-tizen-5/).
