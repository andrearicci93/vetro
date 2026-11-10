---
title: "Root a 2019 or 2020 Samsung TV (Tizen 5): what works"
description: "Root features need Tizen 6 or newer. A 2019 Q80R works with a local port; the 2020 TU7090 and T4300 and a 2018 NU7090 get the dashboard only, no root."
keywords: ["root samsung tizen 5", "samsung q80r root", "samsung 2019 tv root", "samsung 2020 tv root"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Vetro 0.5.0 README compatibility table, the CHANGELOG Node 4.4 entry, the integration README and Samsung's TV model groups page."
related: ["how-to-root-samsung-tv", "root-tizen-6-samsung-tv", "samsung-tv-tizen-version-by-year", "is-it-safe-to-root-samsung-tv", "samsung-model-code-decoder", "samsung-sdb-connect-tv"]
---

For Vetro's root features the short answer is no, not with the stock package: the README says they work on Tizen 6 or newer. Older TVs still get something. Two 2020 models and one 2018 model are reported with the dashboard, the app list and diagnostics working and the root features unavailable, and the only 2019 report works with a personal port that was never reviewed or merged.

The linked research repository is written for researchers and can contain exploit code. This page contains none; see [how rooting works](/root/how-to-root-samsung-tv/) for the general picture. Vetro is experimental, needs root and ships no signed installer; read [the risks](/root/is-it-safe-to-root-samsung-tv/) too.

## What has been reported on 2018, 2019 and 2020 TVs?

| TV | Year | Tizen | Firmware | Status | Report |
| --- | --- | --- | --- | --- | --- |
| [Q80R](/tested-tvs/q80r/) (QN65Q80RAFXZA) | 2019 | 5.0 | T-MSMAKUC-1500.5 | Works with local changes | [#35](https://github.com/andrearicci93/vetro/issues/35) |
| [TU7090](/tested-tvs/tu7090/) (UE43TU7090UXZT) | 2020 | 5.5 | T-KTSU2DEUC-2501.1 | Dashboard, app list and diagnostics work; no root features | [#132](https://github.com/andrearicci93/vetro/issues/132) |
| [T4300](/tested-tvs/t4300/) (UN32T4300AGXZD) | 2020 | 5.5 | T-KTS2UABC-2743.0 | Dashboard, app list and diagnostics work; no root features | [#128](https://github.com/andrearicci93/vetro/issues/128) |
| [UE43NU7090](/tested-tvs/nu7090/) | 2018 | 4 | 1400.2 | Dashboard, app list and diagnostics work; no root features | [#2](https://github.com/andrearicci93/vetro/issues/2) |

Samsung's [model groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups) maps 2019 to Tizen 5.0 and 2020 to Tizen 5.5.

## What can a 2020 TV do?

Two 2020 models, the TU7090 and the T4300, are in the README. Both get the dashboard, the app list and diagnostics, and the features that need root access are unavailable. The changelog adds an app-only test on a QN55Q80TAGXZD (2020, Tizen 5.5): the dashboard, the app list, the diagnostics and the start after a cold boot work, and 45 requests ran without a crash. That package has no root on that platform, so the features that need it are not available. It was not tried on a Tizen 4 TV.

If you own a 2020 TV, that is what you can expect from the stock package: a useful read-only view of the TV, not the launcher or the privacy switches.

## What did the Q80R need?

The Q80R works with local changes, not with the stock package. The report describes a personal port with its own launcher host, app registry paths and Node.js 16.20.2. It was not reviewed or merged, so you cannot reproduce it from a Vetro download. It is the only 2019 report, and the README marks the dashboard column for 2019 as "not with the stock package" too.

## Why does the older Tizen matter?

Tizen 4 and 5.5 TVs run Vetro's web service on Node.js 4.4, where newer TVs run a newer Node. The changelog says the service, which expects a newer runtime, stopped twice on those TVs, while loading and on the first request, until a compatibility layer added the few built-ins that Node 4.4.3 lacks. The [changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) says starting the service on Node 4.4 does not make root features available there: the app-only package has no root on that platform. The [integration README](https://github.com/andrearicci93/vetro/blob/main/rooting/README.md) says the adapter is written in ES5 because of that Node version, and that when the platform cannot run the root integration it records `platformUnsupported` and the dashboard, the app list and diagnostics keep working. On such a TV the sections that need the root agent report that it is missing. That matches what the NU7090, TU7090 and T4300 reports describe.

## What can you do on an older TV?

Check the exact model and firmware with [the model code decoder](/reference/samsung-model-code-decoder/), and report the result: the [tested TVs list](/tested-tvs/) grows from reports, and failed attempts help too. If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it. For a generation that does have root reports, start with [2021 TVs](/root/root-tizen-6-samsung-tv/).

## Next steps

Read the 2020 dashboard-only reports, [#132](https://github.com/andrearicci93/vetro/issues/132) and [#128](https://github.com/andrearicci93/vetro/issues/128), before you install the stock package on a 2019 or 2020 set, so you know what to expect from it. The [install guide](/root/install-vetro-apps2samsung/) describes the two packages, and the [version by year page](/root/samsung-tv-tizen-version-by-year/) tells you which Tizen your TV has.
