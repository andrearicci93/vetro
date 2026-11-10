---
title: "Vetro vs AeroTizen, free-my-tv and TizenBrew"
description: "Vetro, AeroTizen, free-my-tv and TizenBrew compared on root, install route, what each changes on a Samsung TV, and who should pick which."
keywords: ["samsung tv launcher debloat tools compared", "aerotizen vs vetro", "free-my-tv samsung", "tizenbrew alternative"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the AeroTizen, free-my-tv and TizenBrew READMEs, the TizenBrew guide, and the Vetro 0.5.0 README, CHANGELOG, SECURITY.md and PERFORMANCE.md."
related: ["custom-launcher-samsung-tv", "remove-ads-samsung-tv-home-screen", "why-vetro-is-native", "tizentube-samsung-tv", "how-to-root-samsung-tv", "what-each-vetro-switch-changes"]
---

These four projects solve different problems. AeroTizen and free-my-tv give you a nicer home screen without root. TizenBrew is a loader for modded web apps such as TizenTube, not a launcher. Vetro needs root, and in exchange it can replace Samsung's Home, switch off tracking services and remap the remote. If you want a better-looking app row and nothing else, you probably do not need Vetro. This page compares them from each project's own documentation. This site is published by the Vetro project, so weigh that.

## The short comparison

| | Vetro | AeroTizen | free-my-tv | TizenBrew |
| --- | --- | --- | --- | --- |
| What it is | Launcher, debloater, remapper, MQTT | Home screen replacement | Home screen app | Loader for modded sites and apps |
| Root needed | Yes | No (optional root guide) | No | No |
| Install route | Build and sign a package, Developer Mode, Apps2Samsung or your own certificate | `aerotizen` CLI on macOS, Windows or Linux, Developer Mode, Samsung sign-in | TizenBrew Installer, or a Python script, Developer Mode | Desktop installer or CLI, Developer Mode |
| Replaces Samsung Home | Yes, by a native launcher on the Home key | Optional "Native Home", or a watcher that reopens it | No, Samsung Home stays | No |
| Debloat or tracking switches | Yes | Links to guides; README does not clearly describe removing packages itself | Not documented for Samsung | No |
| License | MIT | MIT | MIT | GPL-3.0 |
| Status in the docs | Experimental, launcher in beta | Native Home experimental | Compatibility notes per year | Needs Tizen 3.0 or later |

## What does Vetro offer?

[Vetro](https://github.com/andrearicci93/vetro) runs on the TV with root and serves a dashboard you open from a computer or phone. Per its [README](https://github.com/andrearicci93/vetro/blob/main/README.md), the launcher shows the same apps as Samsung's Home, in the same order, and returns after a restart or standby, with Samsung's Home one press away. In a single run on the [Q80A](/tested-tvs/q80a/), available RAM went from 533 MB to 662 MB with the launcher on, about 24% more. [PERFORMANCE.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md) says that is a memory figure only: nothing there shows a change in frame rate, input latency or time to open an app.

The rest of Vetro is the debloater (Quick settings and a Task manager that lists every app and service), a Remapper for remote buttons, MQTT for Home Assistant and diagnostics. The README says every switch can be turned back on. The root comes from [Chris Ritsen's samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root), and Vetro is experimental and ships no signed installer: you use a package signed for your TV, for example with Apps2Samsung (see [Vetro's root requirements](/root/how-to-root-samsung-tv/) and the [install guide](/root/install-vetro-apps2samsung/)). The dashboard runs over plain HTTP; since 0.5.0 it uses a pairing code, but pairing is automatic and the dashboard is open until the Vetro app on the TV has been seen ([SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md)). Vetro was developed on the Q80A and community reports cover other models; see the [tested TVs](/tested-tvs/).

Pick it if you want the debloater and the remapper as well as a launcher, and you accept [the risks of rooting](/root/is-it-safe-to-root-samsung-tv/). Do not pick it if you only want a different home screen, or if you cannot get root on your TV.

## AeroTizen

[AeroTizen](https://github.com/helalaou/AeroTizen) puts your favourite apps and HDMI inputs in one place and adds Continue Watching, weather and automatic location. Its README says both Home options work without root and links a separate, optional root setup guide.

You install it with the `aerotizen` command-line tool, which runs on macOS, Windows x64 and Linux x64: enable Developer Mode, set the host PC IP, then `discover`, `status`, `certs` (Samsung sign-in) and `install launcher`. There are two ways to reach it from Home. "Native Home" sends Home presses to AeroTizen and tries to open it at power-on, after the CLI backs up the original Home and startup settings. It is marked experimental, and the README says it is reported not to work on Tizen 10, where you should use the watcher. The watcher, the default option, reopens AeroTizen when it sees the TV return to Samsung Home. The README warns that some apps, including YouTube and Prime Video, can leave you on Samsung Home.

The repository is tagged "debloat" and credits a debloat project for identifying which Samsung packages are safe to remove, and it links guides for ads and DNS blocklists, but the README does not clearly say AeroTizen removes packages itself. It says to use it at your own risk and that it is not affiliated with Samsung. Pick it for a home screen with no root.

## What is free-my-tv?

[free-my-tv](https://github.com/simbasjungles/free-my-tv) is a fast home screen for Google TV, LG webOS and Samsung Tizen. On Samsung it is an app you open; Samsung's home screen stays in place and nothing is rooted. You turn on Developer Mode, install through TizenBrew Installer (or build it and run a Python script), and optionally enable Autorun Last App so the TV opens into it. The README lists trending picks that need your own TMDB key, a shelf of apps, an inputs drawer, weather, a theme and a screensaver.

Its Samsung compatibility notes say: it needs a Samsung TV from 2015 or newer; 2015 and 2016 TVs cannot run TizenBrew and need a self-built install; TV Settings is missing from the drawer on 2015 and 2016 sets and freezes on 2017 and 2018 ones; and autorun does not reopen the app on 2019 and 2020 TVs. The README has a `hide_apps` setting that hides built-in apps from its own shelf, and its list of system changes has no Samsung entries. Pick it for a simple shelf of apps; it does not document any tracking switches.

## What is TizenBrew?

[TizenBrew](https://github.com/reisxd/TizenBrew) runs modded websites such as TizenTube and installs newer apps without going through Tizen Studio each time. Its [getting started guide](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md) says it needs Tizen 3.0 or later. The preferred route is a desktop installer, with a Samsung account sign-in on Tizen 7 and above; a command-line route exists; the USB demo package is deprecated because Samsung shut down the service needed to make it. It is GPL-3.0 licensed.

It is not a launcher and not a debloater. It is a loader, and the apps it loads are the point: [TizenTube](/control/tizentube-samsung-tv/) is the example in its README. free-my-tv uses it as an install route. Pick it if you want modded YouTube or similar and nothing more.

## Can I combine them?

Some pairings are documented. free-my-tv installs through TizenBrew Installer. Vetro's [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md) names [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) as the fastest way to install Vetro. We have not tested Vetro's launcher together with AeroTizen's Native Home, and both want the Home key, so do not assume they coexist.

## Which tool should I choose?

- For a nicer home screen without root, use AeroTizen or free-my-tv.
- For YouTube with the ad blocking TizenTube describes, and no root, use TizenBrew with TizenTube, or the Apps2Samsung route in the [TizenTube guide](/control/tizentube-samsung-tv/).
- For lower memory use, tracking services switched off and remapped remote buttons, use Vetro on a rooted TV, accepting a beta launcher and an HTTP dashboard. Read [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) first.
- For fewer ads on the home screen only, read [remove ads from the Samsung TV home screen](/speed/remove-ads-samsung-tv-home-screen/) first. A launcher may be more than you need.

For how the native launcher differs from web ones, see [why Vetro's launcher is native](/reference/why-vetro-is-native/) and [a custom launcher for a Samsung TV](/speed/custom-launcher-samsung-tv/). What each Vetro switch does is in [the switch reference](/reference/what-each-vetro-switch-changes/).

## Limits

This comparison comes from each project's documentation, not its code, and we did not run AeroTizen, free-my-tv or TizenBrew for this page. Supported TVs and maintenance status in those repositories change, so check them before you decide. Other projects exist in this space and are not covered.
