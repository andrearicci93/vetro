---
title: "Samsung TV certificate errors when installing an app"
description: "Why a sideloaded app fails on a Samsung TV: author vs distributor certificates, the DUID, a leftover build with another certificate, account and DNS blocks."
keywords: ["samsung tv certificate error install", "tizen author certificate not match", "samsung distributor certificate duid", "tizen app install fail 1010"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung's creating-certificates, tv-device and command-line pages, the Apps2Samsung and Jellyfin2Samsung FAQs, the jellyfin-tizen README and Vetro 0.5.0's INSTALLATION.md."
related: ["install-vetro-apps2samsung", "samsung-tv-developer-mode", "samsung-sdb-connect-tv", "uninstall-vetro-samsung-tv", "how-to-root-samsung-tv", "jellyfin-samsung-tv"]
---

A Samsung TV refuses a sideloaded app when its signature does not fit the TV: the certificate profile is missing, was made for another TV, belongs to a different author than an app already installed, or was never created because an earlier step failed. The usual fixes are to check the certificate profile and the DUID, remove the older build that another certificate signed, and finish the Samsung account sign-in. This page explains the pieces and the errors Samsung and the installer projects document.

## What are author and distributor certificates?

Samsung's [certificate guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html) says a certificate profile "consists of an author certificate and 1 or more distributor certificates".

- The author certificate identifies who published the app. Back it up: updates to an app must use the same author certificate as the original, or the update may be treated as a different app.
- The distributor certificate sets the privilege level, and you add the DUID of each target device when you create it.
- The DUID is the device's unique ID. Samsung gives the path Menu, Support, Contact Samsung, Unique Device ID. Vetro's guide cites a community report that found it under Smart Hub Information, Unique Device ID. Menu names vary by model and year.

You also need a Samsung Developers Portal account and the Samsung Certificate Extension, which comes with the TV SDK.

This is why there is no universal signed installer for Vetro. Its [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md) says a Samsung certificate belongs to its owner and is tied to your TV, so you must not reuse someone else's signed package or certificates. Apps2Samsung creates your own certificate at the first install; see [install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/).

## Why does installing say the author certificate does not match?

The [Apps2Samsung FAQ](https://github.com/Apps2Samsung/Apps2Samsung/wiki/FAQ) says "Author certificate not match" usually means a Jellyfin app is already installed, and the [Jellyfin2Samsung FAQ](https://github.com/Jellyfin2Samsung/Samsung-Jellyfin-Installer/wiki/FAQ) says the same. Their fix is to delete the existing app on the TV: highlight it, hold the Enter button until a menu appears, and delete it.

The reason is the author rule above: the TV treats a build signed by another author as a different app. For leftovers after a removal, see [uninstall Vetro and clean up](/root/uninstall-vetro-samsung-tv/).

## What does a failed install with no clear message mean?

Samsung's [tv-device page](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html) lists these messages:

- 1010, "App install fail": often a signing certificate problem; check the certificates and retry.
- 1009, "App uninstall fail": uninstall from the TV's Apps panel instead of Tizen Studio.
- 1013, "App run fail": retry the launch or reboot the device.
- "You are not an authorized user!" and null pointer errors: usually older firmware or SDK; update both.

For error 1010, check in this order:

1. Developer Mode and restart. The TV has to be in Developer Mode, pointing at the installing machine. See [how to enable Developer Mode](/root/samsung-tv-developer-mode/).
2. Permit installs. The [jellyfin-tizen README](https://github.com/jellyfin/jellyfin-tizen) gives two ways: in Device Manager, right-click the connected device and choose Permit to install applications, or run `tizen install-permit -t <target>`. Samsung's [command line page](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) describes the Device Manager route.
3. Right profile. The same README says to select the appropriate profile in Certificate Manager, because it decides which devices you can install on, and to try a Samsung certificate if the Tizen certificate gives trouble. Rebuild the .wgt after you change certificates.
4. Expiry. Apps2Samsung's FAQ says existing certificates can be reused when found and not expired.
5. The right command. Samsung's page says only .wgt files install on a TV. Vetro's guide says to use `tizen install`, because `sdb install` did nothing and showed no error in a community report.

## Do I need a Samsung account on newer TVs?

The Jellyfin2Samsung FAQ and the Apps2Samsung FAQ both say a Samsung developer account is required for Tizen 7 or later in developer mode. Apps2Samsung's first install signs you in to Samsung once to create a certificate, which it then reuses. See the [Tizen version by year](/root/samsung-tv-tizen-version-by-year/) table to check whether your TV is in that group.

## Why does Certificate Manager crash or save a block page?

Vetro's guide records a community report where Certificate Manager failed with `ArrayIndexOutOfBoundsException`. A DNS filter or ad blocker on the computer was blocking `svdca.samsungqbe.com`, and the plugin had saved the block page as `author.crt`. Allowing the domain made the official certificate flow work. Samsung's certificate page also says Certificate Manager in Tizen Studio 2.0 and lower can freeze while Tizen Studio is running, so close Tizen Studio after launching Certificate Manager.

## What should I include when I ask for help?

Say your exact TV model and firmware, which tool you used (Tizen Studio, Apps2Samsung or another), the exact message it printed and whether the TV already had an older build of the same app. Leave out your DUID, IP address, certificate files and passwords. Vetro's diagnostic reports follow the same rule: no credentials, addresses or serial numbers. Vetro's guide says to type signing passwords yourself and never paste them into a chat with an AI assistant.

## Limits

Install failures have causes beyond certificates, and different TVs and firmware behave differently. This page does not tell you how to get root, and Vetro does not ship certificates. Vetro is experimental, needs root and ships no signed installer: read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/), then the [install guide](/root/install-vetro-apps2samsung/) and the main [rooting guide](/root/how-to-root-samsung-tv/). Vetro is not affiliated with Samsung.
