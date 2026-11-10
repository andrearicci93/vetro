---
title: "Vetro security model: pairing, plain HTTP, trusted LAN"
description: "Vetro 0.5.0 pairs browsers with a six-digit code shown on the TV, but traffic stays plain HTTP. What pairing covers, what stays open, SDB, plugins, reports."
keywords: ["vetro security", "vetro pairing", "samsung tv root security", "vetro diagnostic report privacy"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against Vetro 0.5.0 SECURITY.md, SIGN-IN.md, HARDENING-0.5.0.md, DIAGNOSTIC-EXPORT.md and the CHANGELOG on GitHub, and GitHub and MDN documentation."
related: ["is-it-safe-to-root-samsung-tv", "what-each-vetro-switch-changes", "why-vetro-is-native", "how-to-root-samsung-tv", "install-vetro-apps2samsung"]
---

Vetro 0.5.0 asks every browser or script to pair with the TV using a six-digit code shown on the TV screen, but the dashboard still runs over plain HTTP, and pairing switches on by itself only after the Vetro app on the TV has been seen. Until then the dashboard is open to anyone on your network. The project's advice is unchanged: use a trusted, isolated LAN, never forward its ports and never expose it to the Internet. This page explains what pairing protects, what stays open, and how to report a vulnerability.

Vetro is experimental, privileged software for a rooted TV, and it ships no signed installer. Start with [Vetro's root requirements](/root/how-to-root-samsung-tv/) and [the risks of rooting](/root/is-it-safe-to-root-samsung-tv/). The source for this page is [SECURITY.md](https://github.com/andrearicci93/vetro/blob/main/SECURITY.md), the [sign-in guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/SIGN-IN.md) and the [0.5.0 hardening record](https://github.com/andrearicci93/vetro/blob/main/app/docs/HARDENING-0.5.0.md).

## Is the Vetro dashboard protected by a password?

It is protected by pairing, not a password. With pairing on, the service answers only devices that have paired with the TV, because its routes can run commands as root.

Pairing is automatic by default. It switches on the first time the Vetro app on the TV is seen, which shows the TV can display the code. Until then, and on a TV whose app is never recognised, the service behaves like Vetro 0.3.5: any device on the home network can use the dashboard and API, including root commands, and the dashboard says so while it waits.

This matters because of what happened to the first 0.5.0 build. It had pairing always on, and on a Samsung Q8F (Tizen 9) the TV app could not reach the service, so the code never appeared and nobody could open the dashboard. The [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) records the republish with the automatic mode, which has not yet been tried on a Q8F. If you installed 0.5.0 before the 7 November republish, reinstall it with Apps2Samsung (see the [install guide](/root/install-vetro-apps2samsung/)): Check for update will not offer the new build, because its version number is the same. The two builds can be told apart by the source revision in the diagnostic report.

You can choose yourself in Quick settings > Developer settings > Pairing: Require pairing can be automatic, always on or always off. Turning it on from an unpaired browser first pairs that browser, so nobody is locked out. Turning it off asks for confirmation. Restore the TV does not change it, and existing paired keys stay valid in every mode.

## How does pairing work?

1. Open the dashboard at the TV's address and choose Show a code on the TV. The Vetro app on the TV shows a six-digit code for two minutes, with the name the sign-in page sent.
2. Type the code in the browser. The browser receives a random key in an `HttpOnly`, `SameSite=Strict` cookie valid for a year. [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) explains the two attributes: the first hides the cookie from page JavaScript, the second stops the browser sending it on cross-site requests.
3. Sign out from the side menu, for this device only or for all devices.

Scripts pair through the same two-step exchange and then send the key as a bearer token. Up to 20 devices can be paired. The sign-in guide lists what the service enforces:

- Unpaired LAN clients get an error on every route except the pairing routes, and only apps on the TV can read the current code, so the code proves physical access to the TV.
- One pairing runs at a time, five wrong codes end it, and a new pairing is allowed at most every 10 seconds.
- A browser Origin must match the Host on pairing and paired requests, so other web pages cannot start a pairing or reuse a paired browser's cookie.
- Keys are 32 random bytes and only SHA-256 hashes are stored on the TV.

## What is still open?

Several things are outside what pairing covers.

- Traffic is plain HTTP. A device that can watch your LAN traffic could copy a key, so a paired browser is only as safe as the network.
- Other apps installed on the TV are trusted like the Vetro widget and need no pairing.
- Until the TV app has been seen, or when you choose Off, the dashboard is open to the LAN.
- The developer connection is separate. The experimental SDB tunnel accepts only loopback clients by default. A paired user can switch on Allow SDB from the local network, and from then on any reachable client gets developer access to the TV, with no Vetro pairing. Signing out in HTTP does not revoke it. Turning the switch off disconnects network clients, and Restore the TV turns it off. The tunnel listens on port 26201, and changing the port does not add authentication.
- The root helper uses its own internal protocol, which does not protect the browser interface.

Keep the TV on a trusted network, do not forward 8099 or any other Vetro port, and think about whether guests on your Wi-Fi should reach the TV at all. That last point is general networking advice, not a Vetro feature.

## What can a plugin or an update do?

Vetro Shards are third-party code that runs inside Vetro's service. There is no sandbox: the host guards failures, but a plugin can do what Vetro can, including running commands as root, whatever permissions it declares. Plugins are off until you switch them on and can be installed only by a paired device. The public list is signed and spot-checked, not audited; a signature shows that a file is the one the list published, not that its code is safe. Plugins outside the list need Developer mode, which is off by default. Install only plugins you trust.

Software update replaces Vetro's files through the root helper. An update is accepted only if its manifest is signed with the Vetro release key, whose public half ships in the package, and the previous version is restored if the new one does not start. The [update guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md) has the details.

## What does the diagnostic report contain?

The report is built from an allowlist and downloaded to your own computer; Vetro does not upload it or record watched content. The [export documentation](https://github.com/andrearicci93/vetro/blob/main/app/docs/DIAGNOSTIC-EXPORT.md) lists what is excluded: credentials, IP and MAC addresses, the hostname, serial, boot, machine and MQTT identities, custom display names, SSIDs, configured DNS addresses, MQTT topics and payloads, process arguments, URLs, raw error strings, user actions and consent records.

Included are package and component IDs and versions, running process names, TV setting values, and the state of the launcher, quick settings and MQTT counters. Installed package IDs can reveal which software you have, so read the file before posting it. The optional Include details about unrecognised components setting is off by default. When on, it adds manifest details of unrecognised packages: whether a manifest was found, its SHA-256, a shortened privilege list and start-up flags, plus checksums of up to 40 boot executables.

## How do I report a vulnerability?

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) if the repository maintainer has enabled it. SECURITY.md says that if no private channel is configured, you should ask for one in an issue without credentials, exploits, device identifiers, raw logs or sensitive reproduction data. Check the [Vetro repository](https://github.com/andrearicci93/vetro) for what is available when you read this.

## Limits

This page describes the documented 0.5.0 behavior and is not an audit of the code. The hardening record says its checks are source and fixture audits, that no changes from it had been installed on a TV when it was written, and that MQTT was not validated against a live broker. It does not cover the upstream root research or Samsung's own security. For installation see [installing Vetro with Apps2Samsung](/root/install-vetro-apps2samsung/); for the switches that pairing protects, see [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/); for the launcher, [why it is native](/reference/why-vetro-is-native/).
