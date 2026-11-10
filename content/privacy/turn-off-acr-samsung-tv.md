---
title: "Turn off ACR on a Samsung TV: menu steps and limits"
description: "Disable ACR on a Samsung TV with the Viewing Information Services switch, see what it leaves running, a 2026 opt-out test, and extra blocking on rooted TVs."
keywords: ["disable acr samsung tv", "viewing information services", "samsung tv acr opt out", "samsung automatic content recognition"]
date: 2026-11-10
updated: 2026-11-10
verified: "Re-read on 2026-11-10: Malwarebytes (2026-03-02, 2026-10-27), Techlicious and the Watching the Watchers project page (2026-10-22), Samsung's US privacy policy (effective 2026-07-20), Samsung Australia's ads notice, and the Vetro 0.5.0 README, CHANGELOG and DOMAIN-FILTER.md."
related: ["samsung-acr-texas-settlement", "what-data-samsung-tv-collects", "samsung-ads-opt-out", "block-samsung-tv-telemetry-dns", "turn-off-bixby-alexa-samsung-tv", "what-each-vetro-switch-changes"]
faq:
  - q: "How do I turn off ACR on a Samsung TV?"
    a: "Open Settings, then Support (or General & Privacy on some models), then Terms & Privacy, then Privacy Choices, and turn off Viewing Information Services. That is Samsung's name for ACR. Menu labels differ by model and year."
  - q: "Does turning off Viewing Information Services stop all data collection?"
    a: "No. It switches off Samsung's viewing-data feature. Usage logs, advertising IDs and other services are separate, and one 2026 study reported ACR-like traffic from a Samsung TV after opt-out. That result came from a single TV and software version."
  - q: "Is ACR off by default on Samsung TVs?"
    a: "Not reliably. Samsung asks for consent during setup, so the state depends on what was chosen then. Check the switch rather than assuming. In Texas, Samsung agreed in 2026 to get express consent first."
  - q: "Can I turn off ACR by keeping the TV offline?"
    a: "Keeping the TV disconnected prevents online uploads while it stays offline, and Techlicious calls disconnecting the only sure way to stop Samsung receiving viewing data. Streaming apps and internet-delivered updates will not work. We have not confirmed whether Privacy Choices can be changed offline on every model."
---

ACR (automatic content recognition) is a feature that identifies what is on your screen so the data can feed recommendations and targeted ads. Samsung calls it Viewing Information Services. To turn it off, go to Settings, then Support (General & Privacy on some models), then Terms & Privacy, then Privacy Choices, and switch Viewing Information Services off. The switch is the documented control. It is not a guarantee that nothing leaves the TV, and this article shows where it stops.

Menu names change between models and years. If your TV does not match the path below, search the settings for "viewing", "privacy" or "terms".

## What is ACR on a Samsung TV?

[Techlicious](https://www.techlicious.com/blog/samsung-tv-still-watching-after-acr-opt-out/) describes ACR as taking snapshots of the screen, turning them into digital fingerprints and sending them to a company that matches them against known shows and films. Samsung's own wording is less specific. [Samsung Australia's ads notice](https://www.samsung.com/au/info/ads-privacy/) says TV viewing history is collected if you have agreed to both "Interest-Based Advertisement Services" and "Viewing Information Services", and that Samsung "may use automatic content recognition ("ACR") and other technologies to capture TV viewing history". That notice took effect on 1 April 2021.

[Samsung's current US privacy policy](https://www.samsung.com/us/account/privacy-policy/) (effective 2026-07-20) does not use the words "viewing information" or "ACR" in the text we read. The TV's own consent screens and your regional notice are the better guide to what the switch covers.

## How do I turn off ACR on a Samsung TV?

[Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/samsung-tvs-stop-spying-on-viewers-in-texas-heres-how-to-disable-acr-anywhere) gives the path Settings, Support, Terms & Privacy, Privacy Choices, and lists an alternative route under All Settings for newer sets. Samsung's menus move between model years, so use these steps as a map, not a script:

1. Press Home on the remote and open Settings.
2. Find Terms & Privacy (under Support on many sets, under General & Privacy on some recent ones).
3. Open Privacy Choices.
4. Turn off Viewing Information Services.
5. If you want less targeted advertising, turn off Interest-Based Advertisements on the same screen. [Samsung Ads and interest-based advertising](/privacy/samsung-ads-opt-out/) explains what that switch does and does not change.
6. If you do not use voice control, check Voice Recognition Services too. The [voice and microphone guide](/privacy/turn-off-bixby-alexa-samsung-tv/) covers it.

Switching a feature off changes what happens from now on. Samsung Australia's notice says only that data will no longer be used for customised ads after you opt out; neither it nor the US policy text we read describes deleting data already collected.

## What does turning off Viewing Information Services leave running?

Quite a lot sits outside this one switch.

- Samsung's US policy lists diagnostic, technical and usage information, such as the time and duration of use of its services, and device identifiers including the Personalized Service ID and the Tizen Identifier for Advertising. Our [inventory of what a Samsung TV collects](/privacy/what-data-samsung-tv-collects/) goes through these.
- Voice recordings are collected "when you enable this function" and use voice commands, according to the same policy. That is a separate setting.
- Samsung Australia's notice says opting out of customised ads "does not prevent the delivery of all ads from Samsung".
- Promotional content on the home screen is not governed by this switch. See [removing ads from the Samsung TV home screen](/speed/remove-ads-samsung-tv-home-screen/).

## Does the opt-out really stop ACR traffic?

One published study says it may not. The Northeastern University project ["Watching the Watchers"](https://watchingthewatchers.github.io/watchingthewatchers/) tested 12 smart TVs from ten manufacturers and ran each scenario 30 times with ACR on and 30 times after opting out through the TV's settings. For the Samsung TV, the project reports traffic consistent with ACR after opt-out in 41 of 60 antenna runs, 18 of 30 HDMI runs and 6 of 30 Tubi runs. [Techlicious's account](https://www.techlicious.com/blog/samsung-tv-still-watching-after-acr-opt-out/), published on 2026-10-22, quotes the finding as "After the opt-out, the Samsung TV kept sending traffic consistent with ACR" and states that the results come from one Samsung TV and its software version at the time of testing.

Most of that traffic is encrypted, so the researchers inferred its purpose from timing, volume, destinations and protocol details. They say they cannot confirm what the data contains or whether it is processed or kept. Read it as strong evidence about one TV, not proof about yours.

On 2026-10-27 [Malwarebytes](https://www.malwarebytes.com/blog/news/2026/10/samsung-tvs-without-mics-may-listen-through-soundbars-researcher-says) also covered claims by an online researcher about audio and viewing-habit collection. It says the claims have not been independently verified and that Samsung did not appear to have commented.

The practical conclusion is modest. Use the menu switch, because it is the documented control. If you want more, block at the network or on the TV, and accept that you may not be able to prove the result.

## How does the Texas settlement change this?

It changes what Samsung must do for Texas consumers, not what the menu does for you elsewhere. The [Texas Attorney General's release](https://www.texasattorneygeneral.gov/news/releases/attorney-general-paxton-secures-major-agreement-samsung-ensure-texans-are-protected-smart-tvs) of 2026-02-26 says Samsung must halt any collection or processing of ACR viewing data without obtaining Texas consumers' express consent. Malwarebytes writes that users elsewhere can adjust the settings manually. The dates and scope are in [the Texas settlement explained](/privacy/samsung-acr-texas-settlement/).

## What can I add on top of the menu switch?

### Can I block the names at my router?

A DNS blocker such as Pi-hole or AdGuard Home can refuse the names that ad and ACR services use. Some TVs may ignore the local resolver, and no list is complete. See [blocking Samsung TV telemetry with Pi-hole or AdGuard](/privacy/block-samsung-tv-telemetry-dns/).

### Can I disconnect the TV?

Techlicious says the only sure way to stop Samsung receiving your viewing data is to disconnect the TV from Wi-Fi or unplug its Ethernet cable and watch through a streaming stick. That costs you the TV's apps and anything else that needs the internet. We have not confirmed whether Privacy Choices can be changed offline on every model.

### Can I stop the services on a rooted TV?

Vetro is a launcher, debloater and remapper for rooted Samsung Tizen TVs. It is experimental, needs root and ships no signed installer; see [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) and [the Apps2Samsung install route](/root/install-vetro-apps2samsung/) before deciding.

The Vetro 0.5.0 [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) lists a Stop viewing-data collection switch. It stops recognition, analytics, ad and usage-log services now and after restarts. The [0.5.0 release notes](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-0.5.0.md) count ten services, with brake files that survive a restart and a boot step for the others. The project's limits are in the same changelog entry:

- The usage-log domain is added to your saved domain list, but DNS blocking is not turned on for you.
- The data service can still run, so uploads may continue unless DNS blocking is on.
- Effects on recognition and suggestions have not been verified.
- The release notes list the viewing-data stop as checked on a Q80A (see the [Q80A page](/tested-tvs/q80a/)) in earlier restart tests, and "consolidated package and other models" as still to be tested.

![Vetro Quick settings with advertising, tracking and domain blocking switches](/assets/img/dashboard-quick-settings.jpg)

Domain filtering on the TV matches exact hostnames, and the README states that it does not guarantee every app's ads or telemetry are blocked. The viewing-data service asks a control server for the servers it uses, so its real names are visible only in traffic ([DOMAIN-FILTER.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/DOMAIN-FILTER.md)). The project has not captured traffic to prove that nothing leaves the TV. The full list of switches is in [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/).

## Does ACR also see what comes from HDMI devices?

The Watching the Watchers results include HDMI scenarios, and the Samsung TV kept sending ACR-like traffic in 18 of 30 HDMI runs after opt-out. A game console or laptop on HDMI is not outside the TV's reach just because it is not a Samsung app. That is one TV in one test.

## How do I check the current state?

Do not assume the setting is off. Samsung asks for consent during setup, so the state depends on what was chosen then. Open Terms & Privacy and read the switches as they are today. If you bought the TV second-hand, or someone else set it up, check it once.

Start with the menu opt-out; add the DNS guide if you also want network filtering, and the rooted-TV switch only if you accept its caveats.

## What this article does not cover

It gives no legal or warranty advice; check Samsung's terms for your region before changing a TV's software. It does not cover other brands, where the menu names and the evidence differ, and it cannot tell you what your specific model sends, because that needs a packet capture on your network.

Next steps: [what data a Samsung TV collects](/privacy/what-data-samsung-tv-collects/), [the Texas settlement](/privacy/samsung-acr-texas-settlement/), and [DNS blocking](/privacy/block-samsung-tv-telemetry-dns/).
