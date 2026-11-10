---
title: "Block Samsung TV telemetry with Pi-hole or AdGuard"
description: "Which Samsung domains community Pi-hole lists block, what breaks, why some TVs bypass your DNS, and the on-TV DNS blocking in Vetro. No list blocks all."
keywords: ["samsung tv pihole blocklist", "block samsung tv telemetry", "adguard home samsung tv", "samsung tv hardcoded dns"]
date: 2026-11-10
updated: 2026-11-10
verified: "Re-read on 2026-11-10: the hkamran80 Smart TV gist and its comments, the LazyAdmin smart TV guide, a Pi-hole forum thread on hard-coded DNS, and the Vetro 0.5.0 DOMAIN-FILTER.md, README and CHANGELOG."
related: ["turn-off-acr-samsung-tv", "what-data-samsung-tv-collects", "samsung-ads-opt-out", "stop-samsung-tv-auto-update", "remove-ads-samsung-tv-home-screen", "what-each-vetro-switch-changes"]
---

You can block a Samsung TV's advertising and telemetry names with Pi-hole, AdGuard Home or your router, and it can cut some traffic. It will not cut all of it. A TV may use its own DNS servers and ignore yours, some Samsung hostnames are needed for the TV to work, and the public lists carry warnings from people whose devices broke. Block in small steps, keep the TV's menu opt-outs on, and expect to undo some entries.

## Which Samsung domains do community lists block?

Two public sources are easy to compare. The [hkamran80 Smart TV gist](https://gist.github.com/hkamran80/779019103fcd306979411d44c8d38459) is a long Pi-hole list, and [LazyAdmin's smart TV guide](https://lazyadmin.nl/home-network/how-to-block-ads-on-your-smart-tv/) gives a short list and an extended one. The names below appear in both, or are the ones each source highlights. They are community-reported, not verified by Samsung or by us.

| Domain | In the gist | In LazyAdmin | Commonly attributed to |
| --- | --- | --- | --- |
| `samsungads.com` | `ads.`, `config.` and `events.samsungads.com` | `samsungads.com`, `events.` and `config.` | Advertising |
| `samsungacr.com` | yes, with `log-config.` and `log-ingestion.` | extended list, with `log-config.` | ACR viewing data |
| `acr0.samsungcloudsolution.com` | yes | no | ACR, per the Vetro project's notes |
| `samsungotn.net`, `samsungrm.net` | yes | yes | Over-the-air and remote management services |
| `samsungcloudsolution.com`, `.net` | yes | extended list | Cloud services, many of them needed by the TV |

The "commonly attributed" column is our reading, not a claim from either source. The gist header says "THIS FILE IS NO LONGER BEING MAINTAINED" and points to a newer file in the author's [blocklists repository](https://github.com/hkamran80/blocklists). The Vetro project's [DOMAIN-FILTER.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/DOMAIN-FILTER.md) lists `samsungads.com`, `config.samsungads.com`, `ads.samsung.com`, `samsungacr.com`, `log-config.samsungacr.com`, `log-ingestion.samsungacr.com` and `acr0.samsungcloudsolution.com` as a reported group and says none of these names is in the Q80A firmware. The viewing-data service asks a control server which servers to use, so its real names show up only in traffic.

## What breaks when I block them?

The gist's own header warns: "It could be that the TV does not receive any more updates or other services no longer work." Its comments are about several device brands, and the Samsung-specific ones are thin. One commenter said `samsungqbe.com` and its subdomains seemed to be required for smart TV functions, and those entries are now commented out in the list. A Pi-hole forum thread, ["Samsung TV Apps won't open with PiHole on"](https://discourse.pi-hole.net/t/samsung-tv-apps-wont-open-with-pihole-on/29621/3), shows the same pattern from the user side, though it names no domain. Its advice is to tail the Pi-hole log to find what is blocked.

The parent-domain entries `samsungcloudsolution.com` and `.net` are the riskiest: they catch hostnames the TV uses for basic functions.

### Which names does Vetro refuse to block?

From reading the firmware image of one TV, the Vetro project keeps a never-block list: `cdn.samsungcloudsolution.com` and `cdn.samsungqbe.cn` (the online check), `time.samsungcloudsolution.com`, `time.samsungcloudsolution.net` and `time.samsungqbe.cn` (clock sync), and `svdca.samsungqbe.com` (the developer certificate). The same document says `sas.samsungcloudsolution.com` and `sas.samsungcloudsolution.net` are the software-update servers, which Vetro does not refuse: blocking them stops firmware updates, which is a decision for the owner. See [stopping Samsung TV automatic updates](/updates/stop-samsung-tv-auto-update/) for the less drastic route.

That is why this page does not publish a copy-and-paste mega-list.

## Why does my TV ignore Pi-hole?

Pi-hole sees only the queries that reach it. In a [Pi-hole forum thread on hard-coded DNS](https://discourse.pi-hole.net/t/recommended-strategy-for-clients-with-hard-coded-dns/22103), a Pi-hole community member explains that if a device does not use the Pi-hole's address, the Pi-hole "will never be aware of the devices DNS queries". The thread lists several consumer devices that do this; Samsung TVs are not among the devices named in the post we read, so treat it as the general mechanism, not a Samsung finding. We did not find a Samsung-specific capture we could verify.

The router-level fixes discussed there are:

1. Intercept outbound port 53 traffic from the TV and give it to the Pi-hole, catching both TCP and UDP.
2. Check IPv6 separately, because a rule written for IPv4 does not cover it.
3. Read the query log afterwards to see whether the TV is asking.

Router support varies; one commenter calls it "100% router device dependent". A device that moves to DNS over HTTPS defeats port 53 interception, and the thread offers no remedy beyond blocking known resolver addresses at the firewall, which can break legitimate traffic.

## How does the on-TV DNS blocking in Vetro differ?

Vetro is a launcher, debloater and remapper for rooted Samsung Tizen TVs. It is experimental, needs root and ships no signed installer; see [Vetro's root requirements](/root/how-to-root-samsung-tv/), [whether rooting is safe](/root/is-it-safe-to-root-samsung-tv/) and [the Apps2Samsung install route](/root/install-vetro-apps2samsung/).

Its DNS blocking switch (called domain blocking before 0.5.0 in the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md)) writes full hostnames to the TV's hosts file and keeps your DNS servers. DOMAIN-FILTER.md says it matches exact names only: blocking `samsungads.com` does not block `rtb-config.samsungads.com`. The candidate list therefore holds hostnames found in the Q80A firmware, grouped as advertising, analytics and KPI, and diagnostic logs, plus a reported group and one group the project labels probable and unverified. Our own reasoning, not something the project tested, is that a hosts-file entry does not depend on which DNS server the TV asks.

DOMAIN-FILTER.md also says whether a firmware-derived name is reached at run time, and what happens when it is blocked, has not been tested on a TV. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md) says plainly that domain filtering does not guarantee that every app's ads or telemetry are blocked. The project's own test TV is the [Q80A](/tested-tvs/q80a/).

![Vetro Quick settings with the DNS blocking switch](/assets/img/dashboard-quick-settings.jpg)

The same document says the filter refuses the never-block names above, and that `GET /blocklist` exports full hostnames for external blockers, without the parent domain of any name the TV needs.

## Should I rely on blocking?

Not alone. Use the TV's own opt-outs first ([ACR](/privacy/turn-off-acr-samsung-tv/) and [interest-based ads](/privacy/samsung-ads-opt-out/)), then add DNS or on-TV blocking if you accept some breakage. A 2026 study reported ACR-like traffic from a Samsung TV after opt-out ([Watching the Watchers](https://watchingthewatchers.github.io/watchingthewatchers/)), which is one reason to treat a blocklist as a second layer and not a replacement. What the TV sends in the first place is listed in [what data a Samsung TV collects](/privacy/what-data-samsung-tv-collects/).

Home screen promotions have their own limits: see [removing ads from the Samsung TV home screen](/speed/remove-ads-samsung-tv-home-screen/).

## What this article does not cover

We have not captured this traffic ourselves, and we do not guarantee any domain's purpose. YouTube and app-level ads come from other hosts. Check every list against your own query log before trusting it.
