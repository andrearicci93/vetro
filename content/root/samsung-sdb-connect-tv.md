---
title: "Connect to a Samsung TV with sdb (port 26101)"
description: "How to run sdb connect to a Samsung TV on port 26101, why sdb shell is often closed on retail firmware, and how Vetro 0.5.0 uses the TV's own SDB with no PC."
keywords: ["samsung sdb connect tv", "sdb connect samsung tv 26101", "sdb shell closed samsung tv", "samsung sdb tizen tv"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung's command line and tv-device pages, the Jellyfin Tizen README, the samsung-tv-root page, and Vetro 0.5.0's INSTALLATION.md, SECURITY.md, rooting README and CHANGELOG."
related: ["samsung-tv-developer-mode", "install-vetro-apps2samsung", "how-to-root-samsung-tv", "keep-root-after-restart", "vetro-security-model", "samsung-developer-certificate-errors"]
---

To connect to a Samsung TV with sdb, turn on Developer Mode with your computer's IP, restart the TV, then run `sdb connect TV_IP:26101` and check it with `sdb devices`. sdb is the command line bridge that ships with Tizen Studio. Connecting is easy. Getting a shell is not: on retail TVs `sdb shell` is usually closed. This page explains the connection, what stops the shell and how Vetro uses the TV's own SDB without a computer attached.

## What is sdb and what does port 26101 do?

`sdb` is the bridge between a computer and a Tizen device, much like `adb` on Android. It comes with Tizen Studio, normally in a `tools` folder in the install directory that may not be on your `PATH`. Vetro's [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md) gives `~/tizen-studio/tools/sdb` as a typical place and says the folder may differ.

The TV listens for SDB on port 26101 once Developer Mode is on. Samsung's [tv-device page](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html) calls 26101 an internal device port that cannot be opened separately, so you switch it on through Developer Mode and no other setting.

## How do I connect to the TV?

1. Enable Developer Mode with your computer's address and restart the TV. See [how to enable Developer Mode](/root/samsung-tv-developer-mode/).
2. Put the TV and the computer on the same network.
3. Run:

```sh
export TV_IP=192.168.1.100  # replace with your TV address
sdb connect "$TV_IP:26101"
sdb devices
```

That is the form in Vetro's installation guide. The [Jellyfin Tizen README](https://github.com/jellyfin/jellyfin-tizen) shows `sdb connect YOUR_TV_IP` without a port. Samsung's [command line page](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) says `sdb devices` gives the serial number and target name, and that `tizen install -t <target>` installs a .wgt, the only file type a TV accepts. Installs go through `tizen install`, not `sdb install`: Vetro's guide cites a community report in which `sdb install` did nothing and showed no error. To check an install reached the TV, `sdb shell 0 vd_applist` lists the installed apps.

## Why is sdb shell closed on my Samsung TV?

On retail firmware the connection can work while the interactive shell does not. The [samsung-tv-root project](https://github.com/chris-ritsen/samsung-tv-root) says that on the retail firmware it tested, a plain interactive `sdb shell` prints `closed` and exits, and that this is expected and does not show whether the root route works. So being connected is not evidence of root. Vetro's own commands go through its root helper, not through `sdb shell`.

## What if sdb connect does not work?

- Port closed after enabling Developer Mode. The Jellyfin2Samsung FAQ says a full power cycle, unplugging for 10 to 15 seconds, helps the SDB port open.
- Host PC IP does not match. The TV needs the IP of the machine you connect from. The [Jellyfin2Samsung FAQ](https://github.com/Jellyfin2Samsung/Samsung-Jellyfin-Installer/wiki/FAQ) describes the TV showing it reversed, so 192.168.1.2 appears as 2.1.168.192, and says to enter it reversed.
- No restart. Developer Mode takes effect after a restart.
- Host PC IP set to 127.0.0.1. With Vetro installed this is on purpose: it lets the TV talk to itself, and by default a computer can no longer use SDB. The guide says to put the computer's IP back, restart the TV, install, and repeat the 127.0.0.1 step afterwards. Vetro's SDB switch, described below, is the other option.

## Commands at a glance

| Command | What it does | Source |
| --- | --- | --- |
| `sdb connect TV_IP:26101` | Connects to the TV | Vetro's installation guide |
| `sdb devices` | Lists connected targets | Samsung's command line page |
| `tizen install -n app.wgt -t TARGET` | Installs a .wgt on the target | Vetro's guide, Samsung's command line page |
| `sdb shell 0 vd_applist` | Lists installed apps, to confirm an install | Vetro's guide |

## How does Vetro use SDB?

After you set Host PC IP to `127.0.0.1` and restart, the Vetro service on the TV starts a small root helper through the TV's own SDB service, and the helper connects back to Vetro. No computer needs to stay connected. The dashboard shows when the root agent is connected, and startup can take up to 90 seconds. The root comes from Chris Ritsen's research; Vetro is experimental, needs root and ships no signed installer. See [does root survive a restart](/root/keep-root-after-restart/).

### Can a computer share the connection with Vetro?

In 0.5.0, yes, through an experimental SDB tunnel. The [rooting README](https://github.com/andrearicci93/vetro/blob/main/rooting/README.md) says the integration multiplexes its SDB connection through port 26201, and only loopback clients are admitted by default. The switch Quick settings, Developer settings, Developer access, Allow SDB from the local network opens it to Apps2Samsung or Samsung's SDK. It asks for confirmation, stays on across restarts and is turned off by Restore the TV ([CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md)).

The limits are in [SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md):

- SDB has no Vetro pairing, so with the switch on any reachable client gets developer access to the TV.
- Turning the switch off disconnects network clients but keeps Vetro's own local streams. Signing out of the dashboard does not revoke SDB access.
- The listener stays bound while the switch is off and rejects remote clients before it processes any SDB frame.
- The environment variable `VETRO_SDB_TUNNEL_PORT` changes the port, not the authentication.

The tunnel also holds the TV's debug connection (`sdbd`), which takes one host connection at a time. The changelog says that after a third republish of 0.5.0 it lets go three seconds after the last client disconnects so other apps can install, and that this was checked with a simulated `sdbd` and not yet tried on a TV ([#168](https://github.com/andrearicci93/vetro/issues/168)). Do not enable it on a network you do not control. The [Vetro security model](/reference/vetro-security-model/) explains the wider exposure.

## Limits

Menu names, ports and shell access differ by model and firmware. Rooting has risks: read [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/) and the main [rooting guide](/root/how-to-root-samsung-tv/). Vetro is not affiliated with Samsung.

Next: [install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/).
