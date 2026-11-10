---
title: "What each Vetro switch changes on a Samsung TV (0.5.0)"
description: "What each Vetro 0.5.0 Quick settings switch, Launcher option and Task manager action changes on a Samsung TV, how to undo it, and what is untested."
keywords: ["vetro quick settings", "vetro switches", "vetro task manager", "vetro debloater"]
date: 2026-11-10
updated: 2026-11-10
verified: "Rebuilt on 2026-11-10 against the published Vetro 0.5.0 README, CHANGELOG, DOMAIN-FILTER.md, SIGN-IN.md, HARDENING-0.5.0.md and RELEASE-0.5.0.md on GitHub."
related: ["remove-ads-samsung-tv-home-screen", "turn-off-acr-samsung-tv", "stop-samsung-tv-auto-update", "remap-samsung-remote-buttons", "vetro-security-model", "uninstall-vetro-samsung-tv"]
---

Each Vetro switch does one specific thing on the TV: it sets a disable flag on a group of components, writes a file that a Samsung service checks, stops a process, or changes one menu value. This page describes Vetro 0.5.0, released on 2026-11-06 and republished twice on 7 November (there was never a 0.4.0 release; its work is part of 0.5.0). It lists what each switch does, how to undo it, and what the project says is not yet verified, using the [README](https://github.com/andrearicci93/vetro/blob/main/README.md), the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) and the documents they link.

Vetro is experimental and needs root, and it ships no signed installer: [Vetro's root requirements](/root/how-to-root-samsung-tv/) and [the risks of rooting](/root/is-it-safe-to-root-samsung-tv/) come first, and [Apps2Samsung](/root/install-vetro-apps2samsung/) does the signing. Most effects were tried on one Samsung [Q80A](/tested-tvs/q80a/). Where the changelog says a part was not tried on a TV, the table says so.

![Vetro dashboard, Quick settings: HbbTV, advertising and tracking, domain blocking and voice assistant switches](/assets/img/dashboard-quick-settings.jpg)

## What do the Quick settings switches do?

Quick settings opens on General, followed by Privacy and ads, Voice, Disable and Developer settings. Every switch shows Done or Partly done. The undo column uses only behavior the changelog or README documents; where none is documented, it says so.

### General

| Switch | What it does on the TV | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Software update | Checks GitHub when you ask, verifies the signed bundle, replaces Vetro's files and restarts the launcher if needed | Goes back to the previous version by itself if the new one does not start within four minutes; you can also roll back by hand | Tried on a Q80A with the release key: update, refusal of a tampered bundle, both rollbacks. Changes to `config.xml` still need a reinstall |
| Disable automatic firmware update | Changes the menu value Support > Software Update > Auto update from 1 to 0, with read-back and rollback | Switch off: the old value is kept and restored | Menu names vary by model and year |
| Keep removed apps removed | On by default. Keeps apps you remove in the Task manager off the TV and checks every 10 minutes for ones that came back | Select Allow again before reinstalling an app yourself. Turning the switch off stops the checks but keeps the list | Tried on a Q80A |
| Clear leftovers | Deletes install files left in the staging folder, one at a time, and refused while an installation runs. The extended cleanup also removes old network logs, temporary Prime Video pictures and caches of apps that are not running | Deleted files are not restored | The extended cleanup has not been checked on a TV. Settings, logins and other app data are not touched |
| Restore the TV and Remove Vetro | Shows the changes Vetro recorded and puts them back after one confirmation, with a result for each step. Deleting saved data and pairing is a separate confirmation | This is the undo | Uninstalled apps, settings without a saved previous value and changes made by plugins need manual recovery. Not tried on a TV |
| Turn off the factory test | Appears only when Samsung's factory colour test was left on. Turns it off | None documented | Tried only against a simulated TV |

### Privacy and ads

| Switch | What it does on the TV | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Disable advertising and tracking services | Disables every component the Task manager files under Advertising and tracking, including the viewing-recognition (ACR) services, and stops those that run | Switch off: the components are enabled again and their start-at-boot and auto-restart settings are restored. A failed change is rolled back | Components with the role Keep (Smart Hub's ad agent, which Home loads) and Vetro itself are left alone. The list differs by model |
| Enable DNS blocking | A filter on the TV writes full hostnames to the TV's hosts file and keeps your DNS servers | Switch off (the README says every switch can be turned back on) | Exact names only; it cannot guarantee that every app's ads or telemetry are blocked. See the domain filter note below |
| Stop viewing-data collection | Stops the services that recognise what is on screen, log remote key presses and send usage logs, now and after every restart | Switch off. An undo you make during startup is respected: pending retries no longer apply the change again. No other undo detail is documented | Effects on recognition and suggestions have not been verified |

### Voice

| Switch | What it does on the TV | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Disable all voice assistants, or Alexa, Google Assistant, Bixby and the other voice services one by one | Disables the voice components. The all-in switch takes its members from what the Task manager lists under Voice assistants on your TV | Switch off | Also turns off the remote's microphone button, Voice Guide (read-aloud) and voice suggestions in search. Vetro asks you to confirm |

### Disable

| Switch | What it does on the TV | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Disable HbbTV | Sets the menu value, creates Samsung's own brake file, stops the HbbTV restart service where the TV has one, then stops the app, again after every restart | Switch on again: it removes the two flag files and starts the service and the app | In 0.3.0 the Q80A showed about 22 MB freed (one process survey). Standby, wake, cold boot and the red-button deeplink were not checked |
| Disable Multi View autostart | Creates a file that Samsung's start-up unit checks, and stops the app | Switch off | About 15 MB on the Q80A (0.3.0 survey). Multi View still starts on demand |
| Stop Ambient | Stops Ambient now and after each restart. Samsung's screen daemon can start it again, so the dashboard calls it a partial block | Switch off. You can also open Ambient yourself at any time | About 59 MB on the Q80A (0.3.0 survey). The effect on a running TV was only timed with the stop commands |
| Disable AirPlay | Stops the AirPlay receiver now and after restarts, so casting from Apple devices does not work while it is on | Included in Restore the TV | Appears only on TVs whose AirPlay setup supports it. Tried on a Q80A |

The memory figures come from a process survey of one TV, not from a speed test. The project's [performance record](https://github.com/andrearicci93/vetro/blob/main/app/docs/PERFORMANCE.md) measured memory only, not frame rate or input latency; see [what uses memory on a Samsung TV](/speed/samsung-tv-memory-usage/).

### Developer settings

| Switch | What it does on the TV | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Require pairing | Chooses automatic (default), always on or always off for the dashboard and API sign-in | Choose another mode. Turning it off asks for confirmation. Restore the TV does not change it | See [the security model](/reference/vetro-security-model/) |
| Allow SDB from the local network | Lets developer tools install apps and run commands through Samsung Debug Bridge without Vetro pairing | Off by default, asks for confirmation, stays on after restarts until you switch it off. Restore the TV turns it off | See the security model |
| Diagnostic report | Downloads a redacted JSON report to your computer. Reading changes no flags, processes, settings or services | Nothing to undo | Optional setting Include details about unrecognised components is off by default |

## How does the domain filter choose its names?

The filter matches exact hostnames: blocking `samsungads.com` does not block `rtb-config.samsungads.com`. The candidate names come in three groups, described in [DOMAIN-FILTER.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/DOMAIN-FILTER.md).

- Firmware-derived names are strings found in the Q80A firmware image, each tied to the component that references it. Whether a name is reached at run time, and what happens when it is blocked, was not tested on a TV.
- Reported names come from public reports. None of them is in the firmware.
- One probable name, `gpm.samsungqbe.com`, is a guess at where the viewing-data service learns its servers. It is not in the firmware and not confirmed in traffic, so the dashboard labels it unverified.

The filter refuses the names the TV uses for its internet check, its clock and Samsung's Certificate Manager. The software-update servers are not on that list, but blocking them stops firmware updates, so the project points to the auto-update switch as the easier one to undo. The usage-log domain that Stop viewing-data collection adds to your saved list does not turn the filter on: DNS blocking stays your choice, and the data service can still run until it is on.

## What do the Launcher options change?

The launcher is off until you turn it on in the Launcher tab, after an in-page warning. Turning it on closes Samsung's Home and switches off the Autorun Smart Hub setting so the TV no longer powers on to Samsung's Home. Vetro remembers the old value and puts it back only if it changed it. Nothing is removed: if the launcher stops, the Home key goes back to Samsung's Home. [Why the launcher is native](/reference/why-vetro-is-native/) explains the design.

| Option | What it does | How to undo it | Status and caveats |
| --- | --- | --- | --- |
| Reduce motion | Turns off all launcher animations | Switch off | |
| Fix TizenTube | Gives the TizenTube tile the YouTube icon and closes Samsung's YouTube just before TizenTube starts | Switch off | Greyed out when TizenTube is not in the app list. See [TizenTube on a Samsung TV](/control/tizentube-samsung-tv/) |
| HDMI sources on Home | Shows the HDMI tiles already in Samsung's Home row, in the same positions | Switch off (off by default) | Tested by a contributor on an S95C |
| HDMI source images | Uses Samsung's artwork instead of generic icons | Switch off (off by default) | |
| Custom launcher | Pick any installed app and the Home key opens it. Samsung's Home stays enabled and Vetro closes it after each Home press | Switch off undoes all of it. If the app keeps failing to start, the mode turns itself off | Not yet tried by hand on a TV. It does not cover an app on the home screen at power-on ([#127](https://github.com/andrearicci93/vetro/issues/127)) |
| Samsung Home switch | Bottom of the Custom launcher tab; asks for confirmation | Switch Samsung Home back on | Keep Samsung's Home enabled: on the Q80A, disabling it can keep the TV from finishing its boot (see [RELEASE-0.5.0.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-0.5.0.md)) |

## What do the Task manager actions do?

The Task manager lists every app and service on the TV with a plain description and a role: Tracking, Optional or Keep. The Not used at home role was removed in 0.5.0. Hotel, shop and factory apps open only after a warning.

| Action | Effect | Undo |
| --- | --- | --- |
| Disable | Sets a disable flag. The component stays installed | Enable it again |
| Stop | Ends the running process | It may start again by itself; a stopped service returns after a restart unless something holds it off |
| Uninstall | Removes the package | Needs an installer to recover. Keep removed apps removed will keep it off until you select Allow again |

Protected system components cannot be touched, and uninstalling a package also protects its siblings. Quick settings and the Task manager share one inventory, so an assistant disabled in one shows as disabled in the other.

## What do the other tabs change?

The Remapper turns a remote key into an app launch. Shortcuts survive restarts, and a key can also send an MQTT message ([remapping Samsung remote buttons](/control/remap-samsung-remote-buttons/)). Settings and controls writes supported picture and advanced settings with read-back, and restore of saved values. The Home Assistant tab publishes the TV's state and accepts actions on exact topics ([Home Assistant and Samsung TV](/control/home-assistant-samsung-tv/)). Vetro Shards (plugins) are third-party code with the same access as Vetro, off until you switch them on.

## Is every switch reversible?

Turning a switch back is the documented undo, but it only works while Vetro and its root helper stay reachable, and it is not a promise to recover from every failure, such as lost network access or a TV that stalls its boot. Restore the TV puts back what Vetro recorded and lists what needs manual recovery. The dashboard now asks for a six-digit code shown on the TV once the Vetro app has been seen; see [the security model](/reference/vetro-security-model/), and the [uninstall guide](/root/uninstall-vetro-samsung-tv/) for removal.

Next steps: [remove ads from the home screen](/speed/remove-ads-samsung-tv-home-screen/), [turn off ACR](/privacy/turn-off-acr-samsung-tv/), or check your model in the [tested TVs index](/tested-tvs/).
