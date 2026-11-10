---
title: "Samsung TV model number decoder: model code and firmware"
description: "Read a Samsung TV model number letter by letter, from QE50Q80AATXZT to the year letter, and learn what a firmware string like T-NKM2DEUC-2301.1 can tell you."
keywords: ["samsung tv model number decoder", "samsung tv model code", "samsung tv firmware version", "samsung model year letter"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung's US and Canada model-code support pages, Samsung's TV Model Groups and ProductInfo developer pages, and the Vetro 0.5.0 README and diagnostic export notes."
related: ["samsung-tv-tizen-version-by-year", "root-tizen-6-samsung-tv", "firmware-update-remove-root", "keep-root-after-restart", "how-to-root-samsung-tv"]
---

Many Samsung TV model codes encode the display family, sales region, screen size, series, model year and market suffix. The layout varies by product family; the Q80A example below follows one common pattern. QE50Q80AATXZT is a 50-inch QLED sold in Europe, series Q80A, from 2021. The firmware string is a separate thing. It looks like T-NKM2DEUC-2301.1, and Samsung does not publish a decoder for it that we could find. This page reads both, and says which parts Samsung documents.

## Where do you find the model code and firmware?

On the back of the TV there is usually a sticker. In the menus, [Samsung's Canada support page](https://www.samsung.com/ca/support/tv-audio-video/tv-decipher-model-code/) gives Settings > Support > About this TV for older sets and Settings > All Settings > Support > About this TV for newer ones. Menu names vary by model and year. The same page says that holding the Play/Pause button on the remote for about ten seconds while the TV is on opens About this TV on any Samsung TV.

The firmware version is shown on that screen too. Samsung's [ProductInfo API](https://developer.samsung.com/tv/develop/api-references/samsung-product-api-references/productinfo-api) documents `getFirmware()` and `getModel()` for apps, so the same values exist outside the menu. Note that `getModel()` returns a short model name, and the full name comes from a separate call.

## How do you read a Samsung model number?

[Samsung's US page](https://www.samsung.com/us/support/answer/ANS10006944/) and the Canada page describe eight positions. Here is QE50Q80AATXZT, the Samsung [Q80A](/tested-tvs/q80a/) that Vetro is developed and tested on:

| Part | Letters | Meaning |
| --- | --- | --- |
| Type | Q | QLED. Samsung lists U = LED, P = Plasma, L = LCD, H = DLP, K = OLED |
| Region | E | Europe. N = North America, A = Asia |
| Size | 50 | Screen size in inches |
| Series | Q80A | Series name. Its last letter often carries the year, here A = 2021 |
| Generation | A | Release generation. A = first, B = second |
| Tuner | T | T = 2 x DVB. F = ATSC/QAM, U = DVB, G = ISDB-T |
| Design | X | Usually X |
| Country | ZT | Not listed on the Samsung pages we read |

Samsung's two pages list different country codes and do not fully agree. The US page lists ZA (USA), RU (Russia), UA (Ukraine), ZC (Chile), XU (Europe/UK) and XY (Australia). The Canada page gives ZA (USA) and ZC (Canada). Neither lists ZT, XC, XH or XL, which appear in other codes in the [Vetro compatibility table](https://github.com/andrearicci93/vetro/blob/main/README.md). Treat the country group as a market tag whose meaning is not confirmed for those codes.

## Which letter is the model year?

The year letter sits inside the series name. The US page gives these examples:

| Year | Letter | Examples on Samsung's US page |
| --- | --- | --- |
| 2023 | C | QN***C (8K Neo QLED), LS03C (The Frame) |
| 2022 | B | Q**B, QN**B, S**B (OLED), LS03B |
| 2021 | A | Q**A, QN**A, AU (UHD), LS03A |
| 2020 | T | Q***T, Q**T, TU (UHD) |
| 2019 | R | Q**R, RU (UHD) |
| 2018 | N | NU (UHD) |
| 2017 | M | MU (UHD) |

The page we opened stops at 2023. The 2024 sets in the Vetro README, the [QN55Q65D](/tested-tvs/q65d/) and the [S90D](/tested-tvs/s90d/), carry a D, which fits the pattern, but Samsung's pages did not state it. Samsung's own page is not fully consistent either: it lists Q900R as 2018 while the R series is 2019 elsewhere on the page. Use the letter as a strong hint, then confirm the year on the TV's spec sheet.

Some codes do not follow the table. TQ65S90CATXXC (an [S90C](/tested-tvs/s90c/), 2023) starts with a TQ prefix that Samsung's pages do not describe. In UE65BU8002KXXH (the [BU8002](/tested-tvs/bu8002/), 2022) the generation slot holds K, not A or B, so "A means first generation" is not a rule you can lean on. The US page lists no BU or CU UHD codes, so the [CU7179](/tested-tvs/cu7179/) in the README (2023) cannot be dated from Samsung's page alone.

## What does a firmware string like T-NKM2DEUC-2301.1 mean?

Samsung does not document it. What we can say comes from the Vetro reports in the [README table](https://github.com/andrearicci93/vetro/blob/main/README.md):

- The part after the last hyphen (2301.1, 2310.0, 1720.7) is the build number. It changes when the TV updates. The Q80A is listed at 2301.1 in the README and at 2310.0 in the [0.5.0 release record](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-0.5.0.md), so one model can carry different builds.
- The prefix (T-NKM2DEUC, T-PTMAKUC, T-NKLBDEUC) is shared by TVs of the same period. The Q80A, [Q70A](/tested-tvs/q70a/) and [QN85A](/tested-tvs/qn85a/), all 2021, are listed under T-NKM2DEUC. Two 2022 sets, the [QN55S95B](/tested-tvs/s95b/) and The Frame [LS03B](/tested-tvs/ls03b/), are both T-PTMAKUC. That is an observation from a small table, not a rule.
- The firmware number does not map to a Tizen version. Samsung's [TV Model Groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups) ties Tizen to the model year instead: 2021 is Tizen 6.0, 2022 is 6.5, 2023 is 7.0, 2024 is 8.0 and 2025 is 9.0. A TV that has taken later updates can report a newer Tizen than its launch year suggests, as the README notes for a 2023 set shown as Tizen 9.0. The [Tizen version by year](/root/samsung-tv-tizen-version-by-year/) page covers this.

## Why does the exact string matter?

Rooting reports are only comparable when they name the exact model and firmware. The README says a firmware update can change the result, and Vetro's report form asks for both. A report that says "Samsung 55 inch, works" is difficult to compare. An exact model and firmware identify the configuration, but reproducing the result also requires the Vetro version and test steps.

Vetro's diagnostic report records the firmware and Tizen version and says where each came from. If the widget on the TV never posted its probe, the service reads the firmware and Tizen version itself, and, since 0.5.0, falls back to the TV's own remote-control API for a model name. The commercial model and platform code can still come only from the widget, so type the model into your report by hand if it is missing. The rules are in the [export documentation](https://github.com/andrearicci93/vetro/blob/main/app/docs/DIAGNOSTIC-EXPORT.md).

## Limits

This page does not decode every Samsung suffix, and it does not say which TVs can be rooted. Compatibility is a separate question: see [how to root a Samsung TV](/root/how-to-root-samsung-tv/), [whether it is safe](/root/is-it-safe-to-root-samsung-tv/), and the pages for [2021 Tizen 6 models](/root/root-tizen-6-samsung-tv/) and the [Q80A](/tested-tvs/q80a/). To see whether an update could undo a result, read [will a firmware update remove root](/updates/firmware-update-remove-root/).

Next steps: look up your code in the [tested TVs index](/tested-tvs/), then check [Tizen version by year](/root/samsung-tv-tizen-version-by-year/).
