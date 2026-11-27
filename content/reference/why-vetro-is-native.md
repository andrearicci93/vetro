---
title: "Why Vetro's launcher is native, not a web app"
description: "Why Vetro's Samsung TV launcher is a native .NET program, not a web app: the memory numbers from one Q80A run, how the Home key works, and what native costs."
keywords: ["vetro launcher native", "samsung tv native launcher", "samsung tv launcher memory", "vetro dock"]
date: 2026-11-10
updated: 2026-11-27
verified: "Vetro parts checked on 2026-11-27 against the 0.7.2 README and CHANGELOG at tag v0.7.2 (commit 2ee0456), with the 0.7.1 CHANGELOG and PERFORMANCE.md as checked the same day at commit cbc363f, plus VETRO-UI.md, TUNER.md, the dock README and STATE-MACHINES.md as checked on 2026-11-21; the EFL project page was checked on 2026-11-10."
related: ["custom-launcher-samsung-tv", "remove-ads-samsung-tv-home-screen", "samsung-tv-memory-usage", "what-each-vetro-switch-changes", "vetro-vs-aerotizen-free-my-tv-tizenbrew", "vetro-security-model"]
---

Vetro's launcher is a native program, not a web page in a browser engine. It is written in C#, draws with the TV's own EFL graphics libraries and runs under the TV's own `dotnet`, as the [dock README](https://github.com/andrearicci93/vetro/blob/main/dock/README.md) describes. The reason is memory. On a Samsung [Q80A](/tested-tvs/q80a/), Samsung's Home process held about 152 MB resident, the launcher about 22 MB, and available RAM went from 533 MB to 662 MB when the launcher replaced it. That is one run, and it measures memory only.

Vetro is experimental, needs root and ships no signed installer: see [Vetro's root requirements](/root/how-to-root-samsung-tv/) and [the risks of rooting](/root/is-it-safe-to-root-samsung-tv/). The launcher is part of Vetro UI, which the dashboard still marks Preview in 0.7.2, and the dashboard you use to turn it on is web, not native.

## What is native and what is web in Vetro?

Four parts, built differently on purpose.

| Part | Built as | What it does |
| --- | --- | --- |
| Launcher (the bar on the Home key) | Native: C# in `dock/`, run by the TV's `dotnet` | Draws the apps, the Control center, and since 0.7.0 Vetro's volume bar and number pad; reads the remote, opens apps |
| Live TV (Vetro TV Tuner, new in 0.7.0) | Native: C# in `tuner/`, its own resident process | Draws the Banner, Channel list, TV guide and its other screens over Samsung's live TV app, which it never replaces ([tuner guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/TUNER.md)) |
| Dashboard (Quick settings, Vetro UI, Apps and processes, Remapper) | Web page served by Vetro's service | Lets you configure everything from a computer or phone |
| Small page on the TV | Web | Reports the TV's model and firmware, shows pairing codes and refusals, and since 0.7.0 has tiles such as Update Vetro |

The dashboard is not meant to be fast on the TV. You open it in a browser on another device, so its cost falls on that device. The launcher has to run on the TV all the time, so it is where memory matters. Since 0.5.0 the launcher is also the first bundled plugin: it updates and rolls back together with Vetro, and it cannot be removed or replaced from the plugin catalog ([plugin architecture](https://github.com/andrearicci93/vetro/blob/main/app/docs/PLUGIN-ARCHITECTURE.md)).

![The Vetro launcher at the bottom of the TV screen in an earlier version: the apps from Samsung's Home, a Source hint, and Settings and Samsung Home buttons](/assets/img/launcher-on-tv.jpg)

## How much memory does the native launcher use?

From the project's [performance record](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md), on a Samsung QE50Q80AATXZT with firmware T-NKM2DEUC-2301.1:

| Measurement | Samsung Home running | Launcher on, Samsung Home closed |
| --- | ---: | ---: |
| Available RAM | 533 MB | 662 MB |
| Samsung Home (`com.samsung.tv.csfs`), resident memory | about 152 MB (PSS about 100 MB) | closed |
| Launcher process, resident memory | none | about 22 MB (about 30 MB in a later read, PSS 5.7 MB) |

Available RAM rose by about 129 MB, or 24%. The record is explicit that this was a single run taken by hand during development, not an A/B test, not repeated, and dependent on what else was running. Nothing there shows a change in frame rate, input latency or the time to open an app. The claim is only that the launcher leaves more memory free, and the README says other TVs will differ.

There is no measurement of a web launcher in the project's files, so this page makes no comparison with one. The only measurement of web content on the TV is the small Vetro page that reports the model. The [0.3.0 changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) says its web app and web process held about 100 MiB resident (RSS, which includes shared pages) in a benchmark sample on the Q80A, and that the page then closed itself 5 seconds after the report reached the service. See the [comparison of Vetro, AeroTizen, free-my-tv and TizenBrew](/compare/vetro-vs-aerotizen-free-my-tv-tizenbrew/) for the other tools.

## How does it start on the Home key?

Vetro runs the launcher process and starts it again after a restart or a crash, backing off for up to five minutes between tries (0.3.0). If the launcher stops, the Home key goes back to Samsung's Home, and nothing is disabled or removed. Turning it on also switches off the Autorun Smart Hub setting, which Vetro restores if it was the one that changed it.

The awkward part is that the system also sends Home to Samsung's own Home app. The launcher therefore closes that app again. According to [STATE-MACHINES.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/STATE-MACHINES.md), a Home press arms one guard process that kills Samsung Home at 0.15, 0.3, 0.45, 0.7 and 1.2 seconds, and every kill first checks a generation counter. If you choose Samsung Home from the bar, the guard is cancelled so the remaining kills do nothing. A Home press seen by both the display server and the input device within 1.5 seconds is counted once.

That guard is how the memory is held. Since 0.5.0 the guard also handles Samsung's Home panels that overlap the launcher, adapted from community pull requests [#23](https://github.com/andrearicci93/vetro/pull/23) and [#24](https://github.com/andrearicci93/vetro/pull/24).

Version 0.7.0 changes that. According to the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md), the launcher now claims the Home key from the TV after the first press it reads from the remote, so from the second press on only the launcher answers and Samsung's Home no longer starts first. It was tried on a Q80A (Tizen 6.0); the call exists in the 2022 and 2024 firmware but was not yet tried there, and it does not apply in custom launcher mode. Vetro also closes Samsung's Home after a boot once the launcher runs and the TV has been up five minutes, about 130 MB on a Q80A.

Vetro 0.7.1 adds Close idle Samsung Home (Vetro UI → Launcher, on by default). While Vetro's launcher is on, Samsung Home and its background parts are closed 25 seconds after the TV wakes from standby, or after 10 minutes unused, and never while Samsung Home is on screen, according to the [0.7.1 changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#launcher-1). The Samsung Home closed after a boot is now closed whole, media hub and sidebar included. The same release moves the checks that started a shell on the launcher's own loop beside it, so an opening no longer waits for them.

## What does native cost?

The first cost is fewer visual options. The dock README lists what could not be ported from the design page: the blurred background behind the bar, label fonts, the brightness boost on a selected pill and desaturation of unselected icons. The shipped look has no name labels and no clock.

The second is a tighter tie to the firmware. The launcher calls the TV's [EFL](https://www.enlightenment.org/about-efl) libraries directly and is built for the .NET Core 3.1 runtime on the TV. The 0.3.2 changelog notes that on Tizen 9 TVs the launcher then closed only `com.samsung.tv.csfs`, so the memory freed may be smaller than on the Q80A; 0.5.0 added the multi-app guard above, and no measurement of the memory freed on a Tizen 9 TV is documented.

The third is narrow testing. The README reports the launcher working on 2022 sets only from 0.3.1 onward (the Home cache folder fix), the HDMI options were tested on an S95C by their author, and the first report from The Frame ([LS03B](/tested-tvs/ls03b/)) did not try the launcher, which a later LS03B report did ([#200](https://github.com/andrearicci93/vetro/issues/200)). Tizen 10 root support starts in Vetro 0.7.1, with root reported on test builds only ([README](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility)); on the [QN900F](/tested-tvs/qn900f/) the launcher was off during the test. The [0.7.1 changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#tizen-10) says Tizen 10 keeps Samsung Home's row in a database of its own app, which Vetro does not read, so where no cache file is found the launcher's row is the list of installed apps. The changelog also says the 0.7.1 build itself was not tried on a Tizen 10 TV. Compatibility is listed per model in the README and the [tested TVs index](/tested-tvs/).

The fourth is that a guard racing a slow app is a workaround, not an official Samsung switch. If you want any app on the Home key instead, Vetro's Custom launcher (Vetro UI, Launcher tab) does that without drawing a bar; see [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/) for its caveats, and [a custom launcher for a Samsung TV](/speed/custom-launcher-samsung-tv/) for the general idea. For removing Samsung's ads from Home, see [removing ads from the home screen](/speed/remove-ads-samsung-tv-home-screen/), and for memory in general, [what uses memory on a Samsung TV](/speed/samsung-tv-memory-usage/).

## Limits

This is a design note, not a benchmark. The Q80A memory run measured RAM only. Separate [changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) reports cover boot-to-launcher time on a Q80A with the experimental Quick boot switch (from about 103 s to 42-45 s, Q80A only; it saved no time on a 2024 The Frame) and one opening step on an [S90C](/tested-tvs/s90c/), whose longest step went from up to 1 s to under 8 ms in 0.7.1. Input latency and frame rate have not been measured, and the [performance record](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md) says so. Since 0.5.0 the dashboard asks for a pairing code but still runs over plain HTTP, which the [security model](/reference/vetro-security-model/) covers. The upstream root that Vetro builds on before Tizen 10 is [Chris Ritsen's samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root); Tizen 10 has a separate route that starts in 0.7.1.
