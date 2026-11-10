---
title: "Stop Samsung TV automatic firmware updates: options"
description: "How to turn off Samsung TV Auto Update, what Samsung says keeps installing anyway, what router blocking does, and what Vetro's switch changes on a rooted TV."
keywords: ["disable samsung tv auto update", "stop samsung tv automatic updates", "samsung tv software update off", "samsung tv auto update keeps turning on"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Samsung US's Auto Update support page, the samsung-tv-root README, and the Vetro README, CHANGELOG, DOMAIN-FILTER.md and UPDATING.md for release 0.5.0."
related: ["firmware-update-remove-root", "downgrade-samsung-tv-firmware", "what-each-vetro-switch-changes", "keep-root-after-restart", "block-samsung-tv-telemetry-dns", "how-to-root-samsung-tv"]
faq:
  - q: "How do I turn off automatic updates on a Samsung TV?"
    a: "On Samsung's US support page the path is Settings, All Settings, Support, Software Update, then Auto Update. If it is on, select it once to turn it off. Menu names vary by model and year."
  - q: "Does turning off Auto Update stop all Samsung TV updates?"
    a: "No. Samsung's page says other app updates or Smart Hub updates will still download and install automatically, and you can still check by hand with Update Now."
  - q: "Can I block Samsung TV updates on my router?"
    a: "Vetro's domain notes identify sas.samsungcloudsolution.com and sas.samsungcloudsolution.net as the software-update servers, taken from Q80A firmware, and say blocking them stops firmware updates. Those notes do not claim a tested blocklist for other models, and blocking can have side effects."
  - q: "Does turning off auto update keep root on a Samsung TV?"
    a: "It removes one way for the firmware to change, so it may help, but it is no guarantee. Vetro offers a switch for exactly this reason, and its README says a firmware update can change the result even within one model family."
---

To stop Samsung TV automatic firmware updates, open Settings, go to Support, then Software Update, and if Auto Update is on, select it once to turn it off. That covers firmware installs only: Samsung says app and Smart Hub updates continue. On a rooted TV a firmware change can alter the rooting result, which is why Vetro adds its own switch. This page gives Samsung's menu path, the router option and what Vetro's switch does.

## How do I turn off Auto Update in the menu?

[Samsung's US support page](https://www.samsung.com/us/support/answer/ANS10002051/) gives these steps. Menu names and layout differ between models and years.

1. Open Settings, choose All Settings, then Support.
2. Select Software Update.
3. Look at Auto Update. If it is on, select it once to turn it off. If it is already off, leave it.

Samsung says that agreeing to the Smart Hub terms during first setup turns Auto Updates on automatically, and that after an update your video and audio settings might be reset to defaults. You can still check by hand with Update Now.

If Software Update is greyed out, Samsung says a streaming app is running in the background; switch to the TV input or press the Samsung TV Plus button on the remote.

## Why does the TV still update some things?

Samsung's page states that "other app updates or Smart Hub updates will download and install automatically." The Auto Update toggle is about the TV software; app and Smart Hub updates are separate.

## Can I block updates on my router?

You can block hostnames, but treat it as a decision with side effects. Vetro's [domain filter notes](https://github.com/andrearicci93/vetro/blob/main/app/docs/DOMAIN-FILTER.md) identify `sas.samsungcloudsolution.com` and `sas.samsungcloudsolution.net` as the software-update servers, from strings in the Q80A firmware, and say that blocking them stops firmware updates. They also say Vetro does not refuse these names, because it is a decision for the owner, and that the Quick settings switch is easier to undo.

Those two names come from Q80A firmware ([model page](/tested-tvs/q80a/)). They are not a tested blocklist for other Samsung TVs, and a router or DNS rule only affects the devices it covers. Filters can also break features, so read [blocking Samsung TV telemetry with DNS](/privacy/block-samsung-tv-telemetry-dns/) before you edit lists.

The root research behind Vetro mentions that its author's TVs are blocked from the internet after Developer Mode is enabled ([samsung-tv-root README](https://github.com/chris-ritsen/samsung-tv-root)). That is the author's setup, not advice.

## What does Vetro's switch do?

Vetro's Quick settings has a Disable automatic firmware update switch, in the General group. According to the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md), it sets the TV's `db/menu/support/softwareupdate/autoupdate` value from 1 to 0, reads it back and rolls back if the read-back fails. The value that was there is kept and restored when you switch it off. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md) gives the reason: a new firmware does not remove root behind your back.

![Vetro Quick settings, with switches for HbbTV, advertising and tracking, domain blocking and the voice assistant](/assets/img/dashboard-quick-settings.jpg)

It is the same menu setting written from the dashboard, with a read-back and a record of the old value. Vetro's notes don't say how it behaves on a TV where the menu toggle is missing or ignored, or whether a TV with the switch on still checks for updates.

Vetro is experimental, needs root and ships no signed installer. Read [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [how to install Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/) before relying on it, and see [Vetro's root requirements](/root/how-to-root-samsung-tv/) for the route.

## Which option is for whom?

| Option | Needs root | What it covers | Caveat |
| --- | --- | --- | --- |
| Menu toggle (Support, Software Update, Auto Update) | No | Automatic firmware installs | App and Smart Hub updates continue |
| Router or DNS block | No | Traffic to the hosts you block, for devices covered by the rule | Side effects; hosts taken from Q80A firmware, not a tested list |
| Vetro switch | Yes | The same menu value, with read-back and restore | Behavior against silent checks not documented |

Most people should stop at the first row. A rooted TV with a result you want to keep is the case for the others. A manual Update Now is still there, and so is any prompt the TV shows.

## Is turning it off a good idea?

Turning Auto Update off lets you review updates before installing them, but delaying them also delays security fixes. If you rely on root, read [will a firmware update remove root](/updates/firmware-update-remove-root/) to see what Vetro's records show, and [can you downgrade firmware](/updates/downgrade-samsung-tv-firmware/), because going back is usually not possible.

## Limits

Samsung's US page is the source for the menu path, and your TV's wording may differ, especially outside the US or on older models. We haven't tested whether a firmware prompt can still appear with the toggle off. Nothing here is warranty or legal advice.

## Next steps

See [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/) and [how root behaves after a restart](/root/keep-root-after-restart/).
