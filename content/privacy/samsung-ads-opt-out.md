---
title: "Samsung TV ads opt-out: turn off interest-based ads"
description: "Turn off Interest-Based Advertisements on a Samsung TV, reset the advertising ID, and learn what Samsung's notices say you will still see. Menu paths vary."
keywords: ["samsung tv ads opt out", "interest based advertisements samsung tv", "samsung ads privacy", "reset psid samsung tv"]
date: 2026-11-10
updated: 2026-11-10
verified: "Re-read on 2026-11-10: Samsung's US privacy policy (effective 2026-07-20), Samsung Australia's ads notice (effective 2021-04-01), Malwarebytes (2026-03-02) and the Vetro 0.5.0 README, CHANGELOG and DOMAIN-FILTER.md."
related: ["turn-off-acr-samsung-tv", "what-data-samsung-tv-collects", "remove-ads-samsung-tv-home-screen", "block-samsung-tv-telemetry-dns", "samsung-acr-texas-settlement"]
---

To opt out of Samsung's interest-based advertising on the TV, open Terms & Privacy (Settings, Support on many sets), go to Privacy Choices and turn off Interest-Based Advertisements. You will still see ads: [Samsung Australia's notice](https://www.samsung.com/au/info/ads-privacy/) says opting out of customised ads "does not prevent the delivery of all ads from Samsung". What changes is how much the ads are based on your viewing history and interests. Menus differ by model, year and region, so treat the paths below as a starting point.

## How do I turn off interest-based advertising on a Samsung TV?

[Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/samsung-tvs-stop-spying-on-viewers-in-texas-heres-how-to-disable-acr-anywhere) (2026-03-02) gives Settings, Support, Terms & Privacy, Privacy Choices, with an alternative route under All Settings, and presents Interest-Based Advertising as an optional extra step. It says menu names differ by model.

1. Press Home and open Settings.
2. Open Terms & Privacy, then Privacy Choices.
3. Switch off Interest-Based Advertisements.
4. Check Viewing Information Services on the same screen. It is Samsung's ACR switch; see [how to turn off ACR](/privacy/turn-off-acr-samsung-tv/).

Samsung Australia's notice describes the connection between the two: TV viewing history is collected if you have agreed to both "Interest-Based Advertisement Services" and "Viewing Information Services".

## What will I still see?

Ads. Samsung Australia's notice says a TV user who opts out may still see ads based on generalised location information and other estimated or inferred information. We did not find a Samsung page that describes how much less targeted the ads become.

Home screen promotions are a separate matter. The [home screen ads guide](/speed/remove-ads-samsung-tv-home-screen/) covers what the menu can and cannot do there.

## What does resetting the advertising ID do?

Samsung Australia's notice describes the TV identifier as a "Personalised Service ID" or "PSID" and says "You can reset your PSID at any time by selecting "Reset PSID" on the settings menu". After a reset, the notice says, viewing history will not be linked to the previous PSID, and if you stay opted in, ads will not be based on information associated with the previous ID.

Two limits matter. First, this is a regional notice dated 2021. [Samsung's current US policy](https://www.samsung.com/us/account/privacy-policy/) (effective 2026-07-20) lists the Personalized Service ID and the Tizen Identifier for Advertising among the device identifiers it collects, but the text we read does not describe a TV reset step. Second, the Australian notice does not say that data already collected is deleted. It says it will no longer be used to deliver customised ads. Where "Reset PSID" sits on your TV varies, and we found no Samsung page with a menu path for it.

## Are there opt-outs outside the TV?

The US policy offers these, with no mention of a TV menu:

- A browser opt-out preference signal for targeted advertising on Samsung.com, which you must turn on in each browser and on each device.
- The ad-industry opt-outs at aboutads.info/choices and networkadvertising.org/choices, which the policy lists.
- A privacy request through [Samsung's rights page](https://www.samsung.com/us/privacy/rights/) or by calling 1-800-SAMSUNG (1-800-726-7864).

Browser and ad-industry opt-outs do not replace the TV's own switch. Samsung's privacy-request process is broader and can cover personal information from its devices and services, subject to the applicable rights and exceptions.

## What about Texas?

In February 2026 the [Texas Attorney General announced](https://www.texasattorneygeneral.gov/news/releases/attorney-general-paxton-secures-major-agreement-samsung-ensure-texans-are-protected-smart-tvs) that Samsung must halt collection or processing of ACR viewing data without Texas consumers' express consent. That is about viewing data, not the advertising switch, and it covers Texas consumers. See [the Texas settlement explained](/privacy/samsung-acr-texas-settlement/).

## Can a rooted TV go further?

Vetro is a launcher, debloater and remapper for rooted Samsung Tizen TVs. It is experimental, needs root and ships no signed installer; read [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting a Samsung TV is safe](/root/is-it-safe-to-root-samsung-tv/) and [the Apps2Samsung install route](/root/install-vetro-apps2samsung/) before deciding.

Its Disable all advertising and tracking switch disables the components the Task manager files under advertising and tracking, except those with the role Keep (Smart Hub's ad agent, which Home loads), according to the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). Vetro also has DNS blocking that writes ad and tracking hostnames to the TV's hosts file; the [domain notes](https://github.com/andrearicci93/vetro/blob/main/app/docs/DOMAIN-FILTER.md) say it matches exact names and that whether firmware-derived names are reached at run time has not been tested on a TV. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md) states that domain filtering does not guarantee that every app's ads or telemetry are blocked, so this reduces ad services rather than removing all ads. The project is developed on the [Q80A](/tested-tvs/q80a/).

Network-level blocking is the other route: [block Samsung TV telemetry with Pi-hole or AdGuard](/privacy/block-samsung-tv-telemetry-dns/).

## What this article does not cover

Third-party app ads (YouTube, streaming apps) follow their own settings. The notices we quote are regional and dated, and Samsung can change them. This is not legal advice; for a rights request, use Samsung's own page.

Next steps: [turn off ACR](/privacy/turn-off-acr-samsung-tv/), [see what a Samsung TV collects](/privacy/what-data-samsung-tv-collects/).
