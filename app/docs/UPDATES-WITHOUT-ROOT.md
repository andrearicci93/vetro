# Blocking updates without root

A Samsung firmware update can remove root and close the path Vetro uses to get it ([#223](https://github.com/andrearicci93/vetro/issues/223) is one such case). This page says what protects a TV from updates when Vetro has **no root**: the app-only build, or a TV where root is not available.

## Why the TV's Auto update setting is not enough

Settings → Support → Software Update → Auto update looks like the switch for updates, but it only decides what the TV does with a firmware image it has already found. The TV has several update paths that run on their own:

1. **Firmware updates** (over the air): a background loop checks for new firmware, downloads it and installs it.
2. **App and package updates**: Samsung's web app service updates installed apps and system packages in the background.
3. **App-binary downloads**: a separate service fetches and replaces app binaries.
4. **System components**: another service updates parts of the system outside the firmware image.

Turning Auto update off leaves all four able to run. The background loop still starts, and the other three never look at that setting.

## What Vetro does with root, and what it cannot do without

With root, Quick settings → General → **Essential settings** → **Block firmware and software updates** stops and masks those update services and sets Auto update off. The block lasts until the next boot, so Vetro applies it again after every restart. Turning the switch off puts everything back. The USB recovery path is left alone.

Samsung's update software can also ask the TV to restart into a separate update mode, which starts before any app (Vetro included) and downloads and installs from Samsung's servers by itself. Nothing Vetro masks is in effect there, so while the switch is on Vetro does not let that request stay: it removes it when the switch is turned on, at every restart, and as soon as it is written. It also keeps off Samsung's own setting that lets an update too big for the TV's storage be downloaded in that mode (off in the factory settings of the 2021, 2022 and 2024 firmware we checked); the TV keeps that setting, so it holds in the update mode too. The switch also adds two update servers one owner reported (`otn2.samsungcloudcdn.com`, `qoe.samsungcloud.tv`) to Vetro's DNS blocking list. They are blocked only while **Enable DNS blocking** is on and Vetro is running, so add them to your router or Pi-hole as well. This has not been tried on a TV yet: a router rule is still the only hard barrier.

Without root, Vetro cannot stop or mask any of these services, and the dashboard shows **Root required** instead of the switch. The only reliable block is then the network.

## Block it on the network

1. **Deny internet access for the TV on your router, for IPv4 and IPv6.** Give the TV a fixed address (a DHCP reservation for its MAC address) and add a rule that drops its traffic to the internet. Check IPv6 as well: many routers apply such rules to IPv4 only, and the TV reaches the internet over IPv6 if it can.
2. **A VLAN or network without internet is the surest way.** Put the TV on a network that can reach your home devices but not the internet (some routers call it an IoT or isolated network, but check that it really has no internet access). Vetro's dashboard keeps working from devices on that network; anything that streams from the internet does not.
3. **If you need streaming apps, allow only the hosts they use**: the streaming service and its content delivery network, nothing else. Any Samsung service you allow can still be an update path.
4. **Log the TV's DNS queries and connections** on your router or DNS server before the next update window, so you know which hosts it asks for and what it would reach.

**Blocking DNS alone is not enough.** A DNS blocklist (Vetro's own DNS blocking, or a Pi-hole) only stops names the TV looks up through the resolver you control. The TV can reach a host by its address, use another resolver, or go over IPv6. Use it together with the router rules, not instead of them.

## Recovery

A firmware file on a USB stick still installs without any network, so a TV kept offline can always be recovered or updated by hand when you choose.

## If an update gets through

A firmware update that reaches the TV anyway replaces the system software: root goes, and every block Vetro had in place goes with it. The network block is the one that survives, because it lives on your router and not on the TV.
