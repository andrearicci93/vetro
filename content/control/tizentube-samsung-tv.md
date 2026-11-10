---
title: "TizenTube on Samsung TV: install steps and requirements"
description: "How to install TizenTube on a Samsung Tizen TV with Developer Mode and Apps2Samsung, which build to pick, the proxy DNS prerequisite and common errors."
keywords: ["tizentube samsung tv", "youtube without ads samsung tv", "tizenbrew", "tizentube install apps2samsung"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the TizenTube README and installation guide, the TizenBrew guide, the Apps2Samsung README, and the Vetro README, CHANGELOG and release audit."
related: ["samsung-tv-developer-mode", "install-vetro-apps2samsung", "samsung-developer-certificate-errors", "jellyfin-samsung-tv", "custom-launcher-samsung-tv", "how-to-root-samsung-tv"]
---

TizenTube is a community YouTube app for Samsung Tizen TVs whose developers describe ad blocking and SponsorBlock support. It needs Tizen 3 (2017) or later. The documented install is Developer Mode plus Apps2Samsung, a sideloading tool, and it needs no root. Vetro is not required; its only link to TizenTube is a launcher icon fix and a port clash described below. The steps on this page follow the [upstream installation guide](https://github.com/reisxd/TizenTube/blob/main/docs/README.md), which is the page to trust if the two ever differ.

## What is TizenTube?

According to its [GitHub repository](https://github.com/reisxd/TizenTube), TizenTube is a TizenBrew module that removes ads and adds SponsorBlock support. The README also lists picture-in-picture, playback speed control and DeArrow support, says it "now works as a standalone app", and names the GPL-3.0 license. The README does not explain how the ad blocking works, and we found no independent test of it, so read "no ads" as the project's claim. Check YouTube's terms of service yourself.

## How do I install TizenTube on a Samsung TV?

The upstream guide gives this sequence for Apps2Samsung. Menu names vary by model and year.

1. Download the latest [Apps2Samsung release](https://github.com/Apps2Samsung/Apps2Samsung/releases) and install it on a computer or Android phone. It runs on Windows, Linux, macOS and Android, and on iPhone through SideStore.
2. On the TV, open the Apps panel and enter `12345`. Switch Developer mode on, enter the IP address of the computer or phone as Host PC IP, and restart the TV. If the TV uses a right-to-left language, enter the address in reverse (`192.168.1.5` becomes `5.1.168.192`). The [Developer Mode guide](/root/samsung-tv-developer-mode/) covers the usual snags, and [Samsung's TV device page](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html) documents the same steps.
3. Open Apps2Samsung and pick your TV from the list, or enter its IP address.
4. Download the TizenTube build that matches your TV from the TizenTube release page. The guide lists three:
   - `TizenTubeCobalt.wgt` for Tizen 6 (2021) and later.
   - `TizenTubeCobaltTizenTubeProxyAddress.wgt` for Tizen 6 and later, for TVs that have problems with the default proxy address. See the next section for its extra requirement.
   - `TizenTubeOld.wgt` for Tizen 3, 4, 5 and 5.5.
5. In the Apps2Samsung settings (the gear icon), enable "Force Samsung Certificate" and "Partner Signing". On Android, open Certificate, choose the Partner type and enable "Force Samsung Certificate".
6. In the Release list choose "Custom WGT File", select the file from step 4 and click Install. A success message appears when it finishes.
7. On an older Tizen version, the guide says to set the Host PC IP to `127.0.0.1` and reboot after installing, to avoid playback problems.
8. Start TizenTube from the TV's app row. If you see "A network error has occured", go to the troubleshooting section below.

A refused install is usually a signing problem; see [Samsung TV certificate errors](/root/samsung-developer-certificate-errors/). The same tool installs other apps, for example [Jellyfin](/control/jellyfin-samsung-tv/).

## What does the proxy-address build need?

`TizenTubeCobaltTizenTubeProxyAddress.wgt` sets the proxy address to `http://tizentube:8101`. The guide says your DNS must resolve the name `tizentube` to the TV's IP address, either through a DNS entry in your router or a DNS service that allows custom entries, and that the TV's address must be static because it can change. Without that entry the TV cannot find the proxy, so choose this build only if you can add the record.

## What does a TizenTube network error mean?

The guide says a "network error" at launch means the TV cannot reach the TizenTube proxy server. Its listed causes:

- "Force Samsung Certificate" and "Partner Signing" were not enabled while installing.
- The TV cannot resolve the default proxy address `http://127.0.0.2:8101`. Try the proxy-address build, with the DNS entry and static IP described above.
- The TV runs Tizen 5.5 or earlier, which cannot run the Cobalt build. Use `TizenTubeOld.wgt`.
- The TV has no internet connection.
- After a cold boot the proxy can take a few seconds to start; wait and try again.

## What about TizenBrew?

[TizenBrew](https://github.com/reisxd/TizenBrew) is the loader TizenTube was built as a module for. Its [guide](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md) says it needs Tizen 3.0 or newer and describes these routes:

- The TizenBrew Installer on a desktop is the preferred route. On Tizen 7 and above it asks you to sign in to a Samsung account to create a certificate.
- A command-line route uses Tizen Studio and `tizen install`, then Host PC IP `127.0.0.1`.
- The USB demo package is deprecated, because Samsung shut down the service needed to make those packages.

For TizenTube itself the standalone Apps2Samsung route above is the one the TizenTube guide documents. [Samsung TV launcher tools compared](/compare/vetro-vs-aerotizen-free-my-tv-tizenbrew/) shows where TizenBrew fits among the other tools.

## Does TizenTube work with Vetro?

Vetro is a launcher, debloater and remapper for rooted Samsung Tizen TVs. It is experimental, needs root and ships no signed installer; read [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) and the [Apps2Samsung install guide](/root/install-vetro-apps2samsung/) first. Three documented points touch TizenTube:

- A Fix TizenTube switch in the Launcher tab gives the TizenTube tile the YouTube icon and closes Samsung's own YouTube just before TizenTube starts, according to the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). The launcher is in beta and was developed on the [Q80A](/tested-tvs/q80a/); see [a custom launcher for a Samsung TV](/speed/custom-launcher-samsung-tv/).
- TizenTube and tizen-youtube use the same port as Vetro's default, 8099. A [Q60A](/tested-tvs/q60a/) owner hit this ([#28](https://github.com/andrearicci93/vetro/issues/28)), and Vetro's [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md) explains how to build the package with another port.
- The Remapper can open an app from a remote button. In an earlier build's [release audit](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-AUDIT.md), the TizenTube key was blocked and its launch action reported no error, but the TV opened YouTube instead; TizenTube behavior was not validated. See [remap Samsung remote buttons](/control/remap-samsung-remote-buttons/).

## Limits

We have not run the TizenTube installer for this page; the steps come from the upstream guide, which can change. Behavior varies by model, year and firmware. Not affiliated with Samsung, Google or the TizenTube authors.
