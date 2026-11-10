---
title: "Jellyfin on a Samsung TV: official app or sideloading"
description: "Jellyfin reached Samsung's app store in February 2026 for some TVs. If yours is not eligible, here is how sideloading works and why it needs no root."
keywords: ["jellyfin samsung tv", "jellyfin tizen", "install jellyfin samsung tv", "sideload jellyfin samsung"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Android Authority's 2026-02-04 report, the jellyfin-tizen and Apps2Samsung READMEs, Samsung's TV device page and the Vetro 0.5.0 README."
related: ["samsung-tv-developer-mode", "samsung-developer-certificate-errors", "install-vetro-apps2samsung", "tizentube-samsung-tv", "remap-samsung-remote-buttons", "how-to-root-samsung-tv"]
---

Jellyfin now has an app in Samsung's Tizen app store, but only some TVs can install it. If yours cannot, you can sideload Jellyfin with a desktop tool such as Apps2Samsung or build it yourself with Tizen Studio. Neither route needs root or Vetro. For sideloading you need Developer Mode on the TV, a signing certificate that your TV accepts, and a computer or phone on the same network. Check the store first, because it is the least effort.

## Is there an official Jellyfin app for Samsung TVs?

Yes, for some models. [Android Authority reported on 4 February 2026](https://www.androidauthority.com/jellyfin-samsung-tvs-3637724/) that Jellyfin had appeared in the Tizen app store and that a Jellyfin developer confirmed the release. The same article says the app needs Tizen 6.0 or higher, quotes the developer as saying "It's not all models that are eligible yet, just some", and notes that some users in Brazil, Canada and France did not see it.

That is a February snapshot, so open the Apps store on your TV and search for Jellyfin. If it is there, install it and stop reading; it is the supported route and updates through the store.

The article says owners of older Samsung TVs still need to sideload. Not sure which Tizen your TV runs? See [Tizen version by year](/root/samsung-tv-tizen-version-by-year/).

## How do you sideload Jellyfin without Tizen Studio?

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is a community tool that installs apps on Samsung Tizen TVs, projectors and smart monitors. According to its README it finds the device, creates a signing certificate and installs the app, so you do not need Tizen Studio. Jellyfin is in its catalog, next to other apps and your own `.wgt` or `.tpk` files. Apps2Samsung asks for the server address before installing it. A Tizen certificate from the SDK's own authority, which needs no Samsung account, is the README's alternative to the Samsung sign-in.

What you need (for sideloading, not for the store app):

1. Developer Mode on the TV. Samsung's [TV device page](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html) describes it: open the Apps panel, enter `12345`, switch Developer mode on, enter the IP address of your computer and reboot. See our [Developer Mode guide](/root/samsung-tv-developer-mode/) for the usual snags.
2. A computer or phone on the same network. The README lists Windows, Linux, macOS, Android, and iPhone through SideStore.
3. A signing certificate. The default flow asks for a one-time Samsung sign-in to create it, and the certificate is then reused. The README also offers a Tizen certificate that needs no Samsung account. Which one your TV accepts depends on the model.

The steps:

1. Download Apps2Samsung from its [releases page](https://github.com/Apps2Samsung/Apps2Samsung/releases) for your computer or phone.
2. Turn on Developer Mode on the TV, enter the IP address of the device that runs the tool, and restart the TV.
3. Open Apps2Samsung and select your TV.
4. Choose Jellyfin in the catalog and enter your server address when it asks.
5. Install, then open Jellyfin from the TV's app list. If the install is refused, read [our certificate errors guide](/root/samsung-developer-certificate-errors/).

The tool reports when Developer Mode is off, the host PC IP is wrong or a restart is needed. It also flags apps that need a newer Tizen than your TV has. Orsay TVs from before 2015 are not supported.

Certificate trouble is the most common failure. The [certificate errors guide](/root/samsung-developer-certificate-errors/) covers how author and distributor certificates work and what to try when an install is refused.

## How do you build Jellyfin with Tizen Studio?

The [jellyfin-tizen README](https://github.com/jellyfin/jellyfin-tizen) is the official route and the most work. Its prerequisites are Tizen Studio 4.6 or later (the IDE or the CLI, with the TV SDK), Git, Node.js 20 or later and a Tizen certificate made in Certificate Manager. If the Tizen certificate causes install problems, the README suggests a Samsung certificate, which needs a Samsung account.

In outline, from the README:

1. Build `jellyfin-web`, ideally on a branch that matches your server version.
2. Run `npm ci` in `jellyfin-tizen` with `JELLYFIN_WEB_DIR` pointing at that build.
3. Pick the certificate profile, since it decides which devices can install the widget.
4. Run `tizen build-web` and `tizen package` to produce `Jellyfin.wgt`.
5. Install it with `tizen install`, after connecting to the TV with Device Manager or `sdb connect`.

The README says to repeat the build when jellyfin-web changes. It does not list install error codes, so we do not list any here either.

## Which route should you pick?

| Route | Effort | Needs | Updates |
| --- | --- | --- | --- |
| Store app | Lowest | An eligible TV and region | Through the store |
| Apps2Samsung | Medium | Developer Mode, a computer or phone, a signing certificate (Samsung sign-in or Tizen certificate) | Manual |
| Tizen Studio build | Highest | Tizen Studio, Node.js 20+, a certificate | You rebuild |

Android Authority also describes a community tool, Samsung-Jellyfin-Installer, that automates some sideloading steps such as creating a certificate. We have not reviewed it.

## Does Jellyfin need a rooted TV or Vetro?

No. Both sideload routes use Samsung's own Developer Mode and signing. Root is a separate step, and [how to root a Samsung TV](/root/how-to-root-samsung-tv/) explains what it involves and why you would not do it only for Jellyfin.

Vetro, a launcher and remapper for rooted TVs, can sit beside a sideloaded Jellyfin. The Remapper can assign a remote button to open an app you choose; see [remap Samsung remote buttons](/control/remap-samsung-remote-buttons/). We have not tested Jellyfin with it. Vetro is experimental, needs root and ships no signed installer; read [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) and the [Apps2Samsung install guide](/root/install-vetro-apps2samsung/) first. The same tooling installs other apps: [TizenTube](/control/tizentube-samsung-tv/) goes on with Apps2Samsung too.

## Limits

We did not run these routes on a TV for this page; the steps come from the projects' documentation and one news report. Menu names and Developer Mode behavior vary by model and year. Check Samsung's terms if you are unsure what Developer Mode does to your warranty.
