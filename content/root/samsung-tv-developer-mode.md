---
title: "How to enable Developer Mode on a Samsung TV"
description: "Turn on Samsung TV Developer Mode: open Apps, enter 12345, switch it on, type the host IP and restart. Fixes for a remote that will not take the code."
keywords: ["samsung tv developer mode", "samsung tv 12345 developer mode", "host pc ip samsung tv", "enable developer mode samsung tizen"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung's tv-device developer page, the Apps2Samsung and Jellyfin2Samsung FAQs, and the Vetro 0.5.0 installation guide and SECURITY.md."
related: ["install-vetro-apps2samsung", "samsung-sdb-connect-tv", "samsung-developer-certificate-errors", "how-to-root-samsung-tv", "keep-root-after-restart"]
faq:
  - q: "What is the Samsung TV developer mode code?"
    a: "Samsung's developer guide says to enter 12345 in the Apps settings panel. A popup appears where you set Developer mode to On and enter the IP address of your computer."
  - q: "My remote will not enter 12345. What do I do?"
    a: "Press the 123 button on the remote to open the on-screen number pad and type 12345 there. Apps2Samsung's FAQ gives this fix for remotes without number buttons."
  - q: "Why does the TV show my IP address backwards?"
    a: "Apps2Samsung's FAQ says the TV can read the address left to right and convert 192.168.1.2 into 2.1.168.192. Its fix is to turn Developer Mode on again and enter the address in reversed order."
  - q: "How do I turn Developer Mode off?"
    a: "Open the same Apps settings screen and switch it off, or set the host IP back. Samsung's page does not describe turning it off; this step comes from Vetro's installation guide."
  - q: "Does Developer Mode void the warranty?"
    a: "We do not know. Check Samsung's terms for your TV and region before you change anything."
---

To enable Developer Mode on a Samsung TV, open Smart Hub, go to **Apps**, open the Apps settings, enter **12345** with the remote, set Developer mode to On, type the IP address of your computer and restart the TV. After the restart, "Develop Mode" shows at the top of the Apps panel. That is the whole procedure in [Samsung's developer guide](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html). The rest of this page covers what to type in the IP field, what goes wrong and how to switch it off.

## How do I enable Developer Mode step by step?

1. Press Home and open Smart Hub, then the Apps panel.
2. Scroll to App Settings.
3. In the Apps Settings panel, enter 12345 with the remote or the on-screen keypad. A developer mode popup appears.
4. Set Developer mode to On.
5. Enter the IP address of the computer you will install from, then select OK. Samsung's page does not name the field; Apps2Samsung and Vetro call it Host PC IP.
6. Restart the TV. The Developer Mode entry shows only after the restart.

Menu names and the place of the Apps settings differ between years and regions, so expect small differences. Vetro's guide says the same about its tested Q80A.

## What if the remote will not take 12345?

Some remotes have no number keys. Press the 123 button to open the on-screen keypad and type the code there. The [Apps2Samsung FAQ](https://github.com/Apps2Samsung/Apps2Samsung/wiki/FAQ) and the [Jellyfin2Samsung FAQ](https://github.com/Jellyfin2Samsung/Samsung-Jellyfin-Installer/wiki/FAQ) both give this fix.

## What IP address goes in the field?

It depends on who talks to the TV.

| When | What to enter | Why |
| --- | --- | --- |
| Installing from a computer or phone | That device's LAN address | The TV accepts developer connections from the address you give it |
| After Vetro is installed | `127.0.0.1` | The TV connects to its own SDB service |

During installation the field holds the address of the computer. The [Vetro installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md) then has you change it to `127.0.0.1` and restart, which lets Vetro start its root helper from the TV itself with no computer attached. While it is set, a computer cannot use SDB on that TV by default, so to install a newer build you put the computer's address back first. The one documented exception is Vetro's Allow SDB from the local network switch (Quick settings, Developer settings, Developer access), which is off by default and gives any reachable client developer access without pairing; see [SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md) and [connecting with sdb](/root/samsung-sdb-connect-tv/).

The guide also says not to change the TV's custom DNS for this. It is a different setting.

## Why does the TV show my IP backwards?

Both FAQs describe it: the TV can read the address left to right and turn 192.168.1.2 into 2.1.168.192. The fix is to turn Developer Mode on again and type the address with the octets in reverse order. The host IP has to match the machine you install from, so check it with `ipconfig` on Windows or `ifconfig` or `ip addr` on macOS and Linux.

## What other problems come up?

- No connection after setup. The Jellyfin2Samsung FAQ says that if the connection fails after a restart, a full power cycle (unplug the TV, wait 10 to 15 seconds, plug it back in) helps the SDB port open. Apps2Samsung's FAQ lists "TV Name could not be found" for a TV that is off, on another network, without Developer Mode, or with a host IP that does not match.
- Samsung account. Both FAQs say a Samsung developer account is needed on Tizen 7 or newer in developer mode. That affects signing, not the Developer Mode screen. See [certificate errors](/root/samsung-developer-certificate-errors/).
- Port 26101. Samsung's page says it is an internal device port that cannot be opened separately.

## Which messages does Samsung document?

Samsung's page lists a few. Error 1010, "App install fail", is often a signing certificate problem; see [certificate errors](/root/samsung-developer-certificate-errors/). Error 1009, "App uninstall fail", is fixed by uninstalling from the TV's Apps panel instead of Tizen Studio. Error 1013, "App run fail", means retry the launch or reboot the device. "You are not an authorized user!" and null pointer errors usually come from older firmware or SDK, so update both. "Failed to get a device information" appears only on 2015 devices and does not affect running the app. The page also says installing apps over USB is no longer supported, so a USB stick will not replace this route.

## How do I turn Developer Mode off?

Samsung's page does not describe it. The Vetro guide's [uninstall section](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md#uninstalling) says to switch it off, or set Host PC IP back, in the same Apps screen if you turned it on only for Vetro. Vetro needs Developer Mode with `127.0.0.1` to keep working, so turning it off stops its root helper from starting. See [does root survive a restart](/root/keep-root-after-restart/).

## Limits

This page covers the TV side only. A TV from a different year may show a different Apps screen, field name or confirmation; Samsung's page and the Apps2Samsung FAQ are the two places to check first. It says nothing about warranty. Developer Mode is a Samsung feature, but rooting is a separate step with real risks; read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/). Vetro is experimental, needs root and ships no signed installer. Vetro is not affiliated with Samsung.

Next: [install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/) or the full [rooting guide](/root/how-to-root-samsung-tv/).
