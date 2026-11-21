---
title: "How to root a Samsung TV (Tizen): what works in 2026"
description: "How rooting a Samsung Tizen TV works today: what root means and does not give you, which TVs have reports from 2018 to 2024, the risks and the research."
keywords: ["how to root samsung tv", "samsung tv root", "tizen root", "samsung tv jailbreak"]
date: 2026-11-10
updated: 2026-11-21
verified: "Checked on 2026-11-21 against the Vetro README compatibility table on main, the 0.7.0 CHANGELOG, VETRO-UI.md, UPDATES-WITHOUT-ROOT.md, the dashboard source and issue #223, plus the samsung-tv-root repository, Samsung's TV device and model groups pages and the Bishop Fox advisory."
related: ["is-it-safe-to-root-samsung-tv", "samsung-tv-developer-mode", "samsung-tv-tizen-version-by-year", "root-tizen-6-samsung-tv", "root-samsung-tizen-8-9-2024", "install-vetro-apps2samsung"]
faq:
  - q: "Can you root a Samsung TV?"
    a: "Some Tizen TVs, yes. Vetro owners' reports show root features working on Tizen 6 to 9 TVs from 2021 to 2024, a 2019 Q80R works only with a local port, and 2018 and 2020 TVs get the dashboard only. Tizen 10 has no root yet. It depends on the exact model and firmware, and there is no official or universal method."
  - q: "Is there a one-click root for Samsung TVs?"
    a: "No. The research behind Vetro needs Developer Mode and a package signed with your own certificate. We found no source that documents a USB-stick root for a Tizen TV, and Samsung says installing apps or widgets through USB is no longer supported."
  - q: "Does rooting void the Samsung warranty?"
    a: "We cannot say. Read Samsung's terms for your TV and region before you start. Nothing on this page is warranty advice."
  - q: "What does root give you on a Samsung TV?"
    a: "A process with user ID 0, which can do what the normal app sandbox blocks: stopping or disabling system services, changing launcher behavior and reading system state. It does not remove every Samsung security boundary."
---

Rooting a Samsung TV means getting a process with user ID 0 on it, which bypasses the sandbox normal apps live in. On a Samsung Tizen TV that is possible on some models and firmware versions, through public security research, and it is not a supported feature. No single method works on every set, and a firmware update can change the result.

The root used by Vetro builds on [Chris Ritsen and contributors' samsung-tv-root research](https://github.com/chris-ritsen/samsung-tv-root); the details are in that repository, not here. The linked research repositories are written for researchers and can contain exploit code. This page contains none and is not a guide to running any of it.

## What does root mean on a Samsung TV?

Tizen is a Linux-based system. Apps on the TV run in a sandbox with limited rights. Root, in practice a process with user ID 0, can do what that sandbox forbids: stop or disable system services, change which app starts on the Home key, read process and memory information, and edit system settings.

That is why privacy and speed tools need it. Switching off a component that sends viewing data, or closing Samsung's Home to free memory, is not possible from a normal app.

## What does root not give you?

Root on a TV is broad access, not a permanent unlock. The upstream project says that the agent still has Samsung's `User` SMACK label and that UID 0 is not proof that every security boundary is gone. It also describes root and its changes as volatile, so the root agent has to come back after each start.

The same access can break the TV if used carelessly. Our [risk guide](/root/is-it-safe-to-root-samsung-tv/) lists what has actually gone wrong. Two cases are documented in the [Vetro changelog](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md), and both involve booting:

- On the [Q80A](/tested-tvs/q80a/), disabling Samsung's Home app can keep the TV from finishing its boot. Vetro's custom launcher leaves Home enabled and closes it after each Home press; the separate Samsung Home switch, on the Launcher tab of the dashboard's Vetro UI page, asks for confirmation.
- Opening Samsung's AgingApp could leave a TV starting a factory colour test at every boot, even after a factory reset ([#135](https://github.com/andrearicci93/vetro/issues/135)). Since 0.5.0 Vetro no longer opens that app, and Quick settings offers Turn off the factory test. The changelog says this guard was tried only against a simulated TV.

## Which Samsung TVs have been rooted?

Vetro is developed on a Samsung [Q80A](/tested-tvs/q80a/) (2021, Tizen 6). Every other TV in the project's compatibility table is there because an owner reported it, usually with a diagnostic export. "Reported working" means the owner said what worked; it is not a test of every feature. The [tested TVs list](/tested-tvs/) has the firmware string and issue behind each report.

| Model year | Tizen at launch | Reports |
| --- | --- | --- |
| 2025 and 2026 | 9.0 (2025), 10.0 (2026) | Tizen 10, on 2026 TVs and on some 2025 TVs after an update, has no root yet: the README says its firmware blocks the method Vetro uses ([#91](https://github.com/andrearicci93/vetro/issues/91), [#140](https://github.com/andrearicci93/vetro/issues/140), [#177](https://github.com/andrearicci93/vetro/issues/177), [#178](https://github.com/andrearicci93/vetro/issues/178)), and a [QN80F](/tested-tvs/qn80f/) lost root when a firmware update moved it to Tizen 10 ([#181](https://github.com/andrearicci93/vetro/issues/181)). The dashboard, app list and diagnostics are reported working on Tizen 10 TVs such as an [M70H](/tested-tvs/m70h/) |
| 2024 | 8.0 | [Q65D](/tested-tvs/q65d/), [S90D](/tested-tvs/s90d/) and [DUE77](/tested-tvs/due77/) (the last two reported on Tizen 9); a [Q60D](/tested-tvs/q60d/) in a Reddit comment with no model code or firmware; on some Tizen 9 TVs apps cannot reach the service on the TV itself ([#122](https://github.com/andrearicci93/vetro/issues/122)), and root problems are reported on others ([#99](https://github.com/andrearicci93/vetro/issues/99)) |
| 2023 | 7.0 | [S90C](/tested-tvs/s90c/), [S95C](/tested-tvs/s95c/), [CU7179](/tested-tvs/cu7179/) and [CU8070](/tested-tvs/cu8070/) (the last two reported on Tizen 9.0) |
| 2022 | 6.5 | [Q60B](/tested-tvs/q60b/), [Q67B](/tested-tvs/q67b/), [BU8002](/tested-tvs/bu8002/), [QN85B](/tested-tvs/qn85b/), [QN90B](/tested-tvs/qn90b/), [S95B](/tested-tvs/s95b/), [The Frame LS03B](/tested-tvs/ls03b/) |
| 2021 | 6.0 | [Q80A](/tested-tvs/q80a/), [Q70A](/tested-tvs/q70a/), [Q60A](/tested-tvs/q60a/), [QN85A](/tested-tvs/qn85a/); an [AU7172](/tested-tvs/au7172/) with a diagnostic report only; the [AU7000](/tested-tvs/au7000/) got the dashboard but its root agent did not connect ([#134](https://github.com/andrearicci93/vetro/issues/134)) |
| 2020 | 5.5 | [TU7090](/tested-tvs/tu7090/) ([#132](https://github.com/andrearicci93/vetro/issues/132)) and [T4300](/tested-tvs/t4300/) ([#128](https://github.com/andrearicci93/vetro/issues/128)): dashboard, app list and diagnostics work; root features unavailable |
| 2019 | 5.0 | [Q80R](/tested-tvs/q80r/) works only with a personal port, not the stock package |
| 2018 | 4.0 | [NU7090](/tested-tvs/nu7090/): dashboard, app list and diagnostics work; root features unavailable |

The README says Vetro's root features work on Tizen 6 to 9, most 2021 to 2025 TVs. Older TVs get the dashboard, app list and diagnostics only, and so does Tizen 10 for now, because its firmware blocks the way Vetro gets root; the README adds that Vetro will support it as soon as a root method for Tizen 10 exists. It lists the confirmed reports and says there is no confirmed range outside them. The QN90F, where the upstream root route has been demonstrated, has not been tried with Vetro; the QN90B is now a report ([#158](https://github.com/andrearicci93/vetro/issues/158)). If your TV is not listed, open a [diagnostic report issue](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) with the exact model, firmware and what worked or failed. The README says the report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it. Read [Samsung TV Tizen version by year](/root/samsung-tv-tizen-version-by-year/) to find out which version your TV has, because a 2023 or 2024 set can run a newer Tizen than it launched with.

## Where do I find the report for my model year?

Each model year has its own page with the firmware strings and the caveats from the changelog:

- [2021 TVs, Tizen 6](/root/root-tizen-6-samsung-tv/): the reference generation, with the AU7000 that did not connect.
- [2022 TVs, Tizen 6.5](/root/root-samsung-tizen-6-5-2022/): the Home cache fix and what the Q67B and S95B reports left unconfirmed.
- [2023 TVs, Tizen 7 and later](/root/root-samsung-tizen-7-2023/): the installer flags caveat and a 2023 TV on Tizen 9.
- [2024 TVs, Tizen 8 and 9](/root/root-samsung-tizen-8-9-2024/): owner reports next to the Tizen 9 problems, why Tizen 10 has no root yet, and outside research.
- [2019 and 2020 TVs, Tizen 5](/root/root-samsung-2019-2020-tizen-5/): the Q80R port, the two 2020 dashboard-only reports and why older Tizen differs.

## What do you need before you start?

Developer Mode on the TV comes first. Samsung documents it on its [TV device page](https://developer.samsung.com/SmartTV/develop/getting-started/using-sdk/tv-device.html), and our [Developer Mode guide](/root/samsung-tv-developer-mode/) covers the usual problems.

You also need a signed package. Vetro is experimental, needs root and ships no signed installer: you build the package and sign it with your own Samsung certificate, or use a community tool such as [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung). The [install guide](/root/install-vetro-apps2samsung/) has the steps, and [the risk guide](/root/is-it-safe-to-root-samsung-tv/) says what you accept.

Know your exact model and firmware, and compare them with the table above. [How to read a model code and firmware string](/reference/samsung-model-code-decoder/) explains what each part means. Then allow some time: after a cold boot, startup and root can take up to 90 seconds, according to the [install guide](https://github.com/andrearicci93/vetro/blob/main/app/docs/INSTALLATION.md).

## Does root survive a restart or an update?

Root is volatile, so the root agent has to come back after each start. The project's [release audit](https://github.com/andrearicci93/vetro/blob/main/app/docs/RELEASE-AUDIT.md) records one cold boot on the Q80A where root came back, and the README gives an S90D owner's account of the agent returning after a full restart. Neither is a guarantee for other models. The changelog says cold-boot persistence was not confirmed in the 2022 Q67B report and not reported for the 2024 Q65D. On a 2022 Q60B the README records service, root and launcher coming back after a software restart, with power-cut recovery not tested. See [does root survive a restart](/root/keep-root-after-restart/).

Firmware updates can change the result even within a model family, and they can remove root. In [#223](https://github.com/andrearicci93/vetro/issues/223), the owner of a 2022 TV on firmware 1720.7 reports a forced update to 1722.0, after which Vetro 0.5.0 could no longer get root. Samsung's [developer FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html) says downgrading TV firmware is not supported, so there is no supported way back. Vetro 0.7.0's Block firmware and software updates switch (Quick settings, General, Essential settings) stops and masks every update service, not only the menu's Auto update, and applies the lock again at every boot. If you plan to use Vetro, install it and turn the switch on while root still works: it can help keep root, it does not guarantee it, and while it is on Samsung's firmware and app updates do not install. The changelog says the lock was read from the Tizen 6, 6.5 and 9 firmware and tried on a Q80A only. Read [will a firmware update remove root](/updates/firmware-update-remove-root/) and [how to stop automatic updates](/updates/stop-samsung-tv-auto-update/).

## What about newer TVs and other public research?

Security researchers have published work on Tizen well beyond Vetro's compatibility table. Bishop Fox's [advisory](https://bishopfox.com/blog/samsung-tizen-os-version-through-9-0) describes an arbitrary command injection in the Samsung Debug Bridge (SDB) service. It needs Developer Mode and an attacker on the host IP address set in that mode. Bishop Fox demonstrated it on Tizen 5.5, 7.0, 8.0 and 9.0, and believes every Tizen version with SDB is likely affected.

Other repositories describe routes for specific 2024 models, one of which says it needs no Developer Mode. That is other people's research, not a Vetro feature, and we do not describe or test those routes here. A diagnostic report from someone with the same model and firmware is the best evidence you can get without trying it yourself.

## What can go wrong?

- A privileged change can break a TV feature or keep a Q80A from finishing its boot, as described above.
- Vetro's dashboard runs over plain HTTP, so it belongs on a trusted network. Pairing is automatic once the TV app has been seen; see the [security model](/reference/vetro-security-model/).
- You can undo most changes, but not all. [Uninstalling Vetro](/root/uninstall-vetro-samsung-tv/) lists what stays behind.

### Does rooting void the warranty?

We cannot say. Read Samsung's terms for your TV and region before you start. Nothing on this page is warranty advice.

## Do the "root any Samsung TV with a USB stick" guides work?

We found no source that documents a USB-stick root for a Tizen TV. Samsung's TV device page says that for security reasons, installing applications or widgets through USB is no longer supported. The routes that do work need Developer Mode or a browser exploit, not a USB stick.

Samsung's [model groups page](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups) starts its Tizen list with a 2015 group, and guides that promise a USB stick and a rooting app are usually about Android TV boxes or older SamyGO-era Samsung sets, not Tizen. Treat them as unreliable.

Next steps: check your model in the [tested TVs](/tested-tvs/), read the [risks](/root/is-it-safe-to-root-samsung-tv/), then follow the [install guide](/root/install-vetro-apps2samsung/). For what you can do afterwards, see [what each Vetro switch changes](/reference/what-each-vetro-switch-changes/).
