---
title: "Samsung TV Tizen version by year, 2017 to 2026"
description: "Which Tizen version a Samsung TV shipped with, year by year from 2017 to 2026, why your TV may run a newer one now, and how the version relates to rooting."
keywords: ["samsung tv tizen version by year", "samsung tizen version", "which tizen version is my samsung tv", "tizen 6.5 samsung tv year"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung's TV model groups page, Wikipedia's Tizen article, SamMobile's update report and the Vetro 0.5.0 README compatibility table."
related: ["how-to-root-samsung-tv", "samsung-model-code-decoder", "root-samsung-tizen-6-5-2022", "root-samsung-tizen-7-2023", "root-samsung-tizen-8-9-2024", "root-tizen-6-samsung-tv"]
---

Samsung's developer page maps model years to Tizen versions like this: 2019 is Tizen 5.0, 2020 is 5.5, 2021 is 6.0, 2022 is 6.5, 2023 is 7.0, 2024 is 8.0, 2025 is 9.0 and 2026 is 10.0. That is the version a TV launched with. A newer TV can have moved up since, so the version on your screen may be higher than the one in the table. This page gives the table, explains the exceptions and says what the version means if you are thinking about [rooting a Samsung TV](/root/how-to-root-samsung-tv/).

## Samsung TV Tizen version by year

The table comes from [Samsung's TV model groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups).

| Model year | Tizen version at launch | Notes |
| --- | --- | --- |
| 2026 | 10.0 | |
| 2025 | 9.0 | |
| 2024 | 8.0 | |
| 2023 | 7.0 | |
| 2022 | 6.5 | |
| 2021 | 6.0 | |
| 2020 | 5.5 | |
| 2019 | 5.0 | |
| 2018 | 4.0 | |
| 2017 | 3.0 | Samsung lists 3.0 for the premium group and 2.4 for one entry-level group (17TV_ENTRY_CN1); the standard group has no separate entry |
| 2016 | Not shown | Samsung's page states no version for 2016 |

## Does Wikipedia agree?

Wikipedia's [Tizen article](https://en.wikipedia.org/wiki/Tizen) lists releases of the Tizen platform with dates, for example 9.0 on 31 May 2024. It does not say which TV year uses which release. A TV's version is set by Samsung's firmware, so Samsung's table is the one to use for TVs.

## Why can my TV run a newer Tizen than its year?

Samsung updates the operating system on some TVs. [SamMobile](https://www.sammobile.com/opinion/samsung-promised-7-years-of-tv-updates-still-waiting-to-see-what-happens/) reports that in mid-2024 Samsung said TVs released in 2024 or later, plus select 2023 models, would get seven years of Tizen OS updates. Its article says premium 2023 models got Tizen 8.0 in November 2024, and its October 2025 update says Samsung confirmed those 2023 models would start moving to Tizen 9 the following week, possibly in stages and not in every region at once. It names no full model list.

The Vetro README table shows the same pattern from the owners' side. A 2023 [CU7179](/tested-tvs/cu7179/) is reported on Tizen 9.0, a 2023 [S90C](/tested-tvs/s90c/) on Tizen 7.0 and a 2024 [S90D](/tested-tvs/s90d/) on Tizen 9. Two TVs from the same year can sit on different versions, so treat the table as a starting guess and check the real value.

## How do I see which Tizen version my TV runs?

The Vetro README says to look under Settings, Support, About this TV, and adds that menu names differ by model, year and region. The same screen shows the firmware string, for example `T-NKM2DEUC-2301.1`, which the [tested TVs](/tested-tvs/) pages list per model. The model code also tells you the year; see the [model code decoder](/reference/samsung-model-code-decoder/). If you run Vetro, its diagnostic report lists model, firmware and Tizen version, and the project asks for it in compatibility reports.

## How does the table fit real TVs?

Rows from the [Vetro compatibility table](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility), set beside Samsung's launch version for the same year:

| TV | Year | Launch version (Samsung) | Version in the README |
| --- | --- | --- | --- |
| [Q80A](/tested-tvs/q80a/) | 2021 | 6.0 | Listed under Tizen 6; firmware 2301.1 |
| [S90C](/tested-tvs/s90c/) | 2023 | 7.0 | Tizen 7.0 |
| [CU7179](/tested-tvs/cu7179/) | 2023 | 7.0 | Tizen 9.0 |
| [S90D](/tested-tvs/s90d/) | 2024 | 8.0 | Tizen 9 |
| [Q80R](/tested-tvs/q80r/) | 2019 | 5.0 | Tizen 5.0 |
| [NU7090](/tested-tvs/nu7090/) | 2018 | 4.0 | Tizen 4 |

The 2023 and 2024 rows are the ones that moved.

## What does the Tizen version mean for rooting?

It is a clue, not a rule. Vetro's root route comes from [Chris Ritsen's samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root), which reports results for exact models and firmware builds. It lists one Tizen 10 TV, a UN50M75HAGXZD, where SDB connected but rejected the injection, and calls that an exact-build failure, not proof about all Tizen 10 TVs.

For Vetro itself the [README](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) says root features need Tizen 6 or newer. On Tizen 6 to 8 the reports are positive. On Tizen 9 and 10 they are mixed: some TVs block apps from reaching the service on the TV itself ([#122](https://github.com/andrearicci93/vetro/issues/122), and the 0.5.0 fallback is not yet tried on a TV), and root problems are reported on others ([#91](https://github.com/andrearicci93/vetro/issues/91), [#99](https://github.com/andrearicci93/vetro/issues/99)). Tizen 5.5 and Tizen 4 TVs get the dashboard, app list and diagnostics but not root features. A Tizen 5.0 Q80R works only with a personal port that has not been merged ([#35](https://github.com/andrearicci93/vetro/issues/35)). The README says there is no confirmed range and that a firmware update can change the result inside one model family.

Other reports exist for the [Q70A](/tested-tvs/q70a/), [Q67B](/tested-tvs/q67b/), [S95C](/tested-tvs/s95c/) and [Q65D](/tested-tvs/q65d/). The Q80A is the only TV Vetro is developed and tested on. Vetro is experimental, needs root and ships no signed installer; see [Vetro's root requirements](/root/install-vetro-apps2samsung/) and [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/).

Pages by year:

- [2019 and 2020, Tizen 5](/root/root-samsung-2019-2020-tizen-5/)
- [2021, Tizen 6](/root/root-tizen-6-samsung-tv/)
- [2022, Tizen 6.5](/root/root-samsung-tizen-6-5-2022/)
- [2023, Tizen 7](/root/root-samsung-tizen-7-2023/)
- [2024, Tizen 8 and 9](/root/root-samsung-tizen-8-9-2024/)

This is a reference for launch versions. It says nothing about regional firmware, and Samsung can change a TV's version with an update. Vetro is not affiliated with Samsung.
