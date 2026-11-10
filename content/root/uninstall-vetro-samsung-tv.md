---
title: "Uninstall Vetro from a Samsung TV and clean up leftovers"
description: "Remove Vetro from a Samsung TV: restore its changes first, delete the app, turn Developer Mode off, and know what a plain uninstall leaves behind on the TV."
keywords: ["uninstall app samsung tv leftovers", "uninstall vetro samsung tv", "remove sideloaded app samsung tizen", "restore samsung tv after vetro"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the uninstalling section of Vetro 0.5.0's published INSTALLATION.md, its README, CHANGELOG, SECURITY.md, Samsung's command line page and the Apps2Samsung README."
related: ["install-vetro-apps2samsung", "samsung-tv-developer-mode", "is-it-safe-to-root-samsung-tv", "keep-root-after-restart", "what-each-vetro-switch-changes", "samsung-developer-certificate-errors"]
---

To uninstall Vetro cleanly, restore what it changed first, then delete the app, then undo Developer Mode. Deleting the app alone leaves some changes behind: the domain filter keeps hiding names from the hosts file and the saved settings stay in the share folder. The steps below follow the uninstalling section of Vetro's published [installation guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md#uninstalling), which covers 0.5.0. The guide is the only published uninstall procedure; this page adds the context around it.

## What does a plain uninstall leave behind?

The guide says Vetro changes the TV in several places: it can replace Home, stop services, disable components and block domains. A package uninstall does not reverse that.

- The domain filter. Names Vetro added to the hosts file stay hidden.
- Saved settings. They stay in the share folder, and they hold the values used to restore, which is why you restore first.
- Disabled components and stopped services, if you used the Task manager or Quick settings.

Vetro cannot remove itself: its own package is protected from the Task manager on purpose.

## How do I uninstall Vetro step by step?

1. Restore the TV. In the dashboard open Quick settings, Maintenance, Restore the TV (the 0.5.0 changelog lists it under General). Press Review what will change to see the list, then Restore everything. Nothing changes before you confirm, and the report says what could not be put back.
2. Optionally remove Vetro's saved data. In Remove Vetro, choose to remove the saved data. It is offered only when nothing is left to put back, because those files hold the values used to restore. A package uninstall does not remove them.
3. Restart the TV. This clears temporary changes and reloads Home.
4. Remove the app on the TV. Open Apps, go to the settings icon of the Apps screen, select Vetro and choose Delete. Menu names vary by model and year.
5. Or use Apps2Samsung. The guide says its desktop and Android apps list installed apps and can remove them, for use if the TV menu does not offer Delete, and that its command line tool documents no uninstall. The guide adds that this route has been used less than the TV menu. The [Apps2Samsung README](https://github.com/Apps2Samsung/Apps2Samsung) lists uninstall among what the app does.
6. Developer Mode. If you turned it on only for Vetro, switch it off, or set Host PC IP back, in the same Apps screen. See [Developer Mode](/root/samsung-tv-developer-mode/). Without Vetro's service there is nothing on the TV to get root back after a restart; see [does root survive a restart](/root/keep-root-after-restart/).
7. Home Assistant. If you used the MQTT bridge, delete the TV device there. Its entities stay until you do.

## What can Restore the TV not put back?

The [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) and the [README](https://github.com/andrearicci93/vetro/blob/main/README.md) give these limits:

- Apps you uninstalled with the Task manager, settings without a saved previous value and changes made by plugins need manual recovery.
- If Vetro cannot read its saved state, it keeps its backups and blocks data removal.
- Deleting saved data and pairing is a separate confirmation. Restore the TV does not change the Require pairing choice ([SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md)).
- Restore the TV turns off Allow SDB from the local network, if you had enabled it.

If your Vetro version has no Restore the TV button, turn off the switches you used before deleting the app; the README says every Quick settings switch can be turned back on. See [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/).

## What does Restore the TV cover?

The changelog says it shows the changes Vetro recorded and puts them back after one confirmation, with a result for each step. The 0.5.0 notes and hardening review name some of what is included: the Disable AirPlay switch, the original Autorun Smart Hub value that the custom launcher changed, and Allow SDB from the local network. If any step fails or cannot be read, the result says so instead of reporting complete. Read the per-step results before you delete the app, because anything marked as needing manual recovery will not be fixed by the uninstall.

## How do I check that the TV is back to normal?

The guide gives no checklist, so these are checks drawn from its steps. After the restart, confirm the Home key opens Samsung's Home, that the Apps screen no longer lists Vetro, and that the Developer Mode entry is off if you switched it off. If you used the domain filter, check that the apps you rely on still reach their servers. If something stays changed, the Restore report names it, and the [switch reference](/reference/what-each-vetro-switch-changes/) says what each one does.

## Can I uninstall from the command line?

Samsung's [command line page](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) says that to uninstall TV applications the `-p` option requires the application ID, not the package ID, and that the ID is in the app's `config.xml`. We do not give Vetro's ID here, and the guide's TV menu route is simpler. Use the command only with an ID you have read from your own TV. Connecting is covered in [connecting with sdb](/root/samsung-sdb-connect-tv/).

## What about the port and reinstalling?

Vetro listens on port 8099 unless it was built with another one, a build-time choice, so reinstalling with a different port means installing again. See [install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/). If a reinstall is refused because of a different author certificate, see [certificate errors](/root/samsung-developer-certificate-errors/).

## Limits

The published guide covers Vetro's own uninstall; it does not cover removing other apps' leftover Home tiles or files. Rooting has risks that an uninstall does not erase; see [is it safe to root a Samsung TV](/root/is-it-safe-to-root-samsung-tv/). Vetro is experimental, needs root and ships no signed installer. Vetro is not affiliated with Samsung.
