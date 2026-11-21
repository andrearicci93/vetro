---
title: "Root a 2024 Samsung TV (Tizen 8, 9): what is confirmed"
description: "What is confirmed for 2024 Samsung TVs on Tizen 8 and 9: Q65D, S90D and DUE77 owner reports, the Tizen 9 problems, why Tizen 10 has no root yet."
keywords: ["root samsung tizen 9", "samsung 2024 tv root", "samsung tizen 8 root"]
date: 2026-11-10
updated: 2026-11-21
verified: "Checked on 2026-11-21 against the Vetro README compatibility table on main, the 0.7.0 CHANGELOG, the community rooting review, issue #223, the Bishop Fox advisory and the samsung-tv-root and commit-regrets repositories."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-7-2023", "samsung-tv-tizen-version-by-year", "keep-root-after-restart", "firmware-update-remove-root", "is-it-safe-to-root-samsung-tv"]
---

For 2024 Samsung TVs the confirmed evidence is thin and comes from owners, not from the Vetro maintainers. Three 2024 models, the Q65D, the S90D and the DUE77, are reported working, and a Q60D is reported working in a Reddit comment with no details. Two 2023 sets are included because they report the same Tizen 9 generation. The README also records root problems on other Tizen 9 sets and no root yet on Tizen 10. Public security research covers more, and the owner reports and the outside research are kept separate below.

The linked research repositories are written for researchers and can contain exploit code. This page contains none and is not a guide to running any of it. Vetro is experimental, needs root and ships no signed installer; see [the risks](/root/is-it-safe-to-root-samsung-tv/) and [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## What have Vetro owners reported on 2024 TVs?

| TV | Year | Tizen | Firmware | What was reported |
| --- | --- | --- | --- | --- |
| [QN55Q65D](/tested-tvs/q65d/) | 2024 | 8 at launch | T-NKLDUABC-0090-2123.9 | Reported working, installed with Apps2Samsung; authenticated UID-0 agent and 29 confirmed controls; cold-boot persistence not reported ([#10](https://github.com/andrearicci93/vetro/issues/10)) |
| [S90D](/tested-tvs/s90d/) (QA65S90DAULXL) | 2024 | 9 | T-PTMDUABC-0090-2130.0 | Reported working, with the root agent back after a full restart, in the owner's account ([#36](https://github.com/andrearicci93/vetro/issues/36)) |
| [DUE77](/tested-tvs/due77/) (UA55DUE77AKLXL) | 2024 | 9 | T-KSU2EDUABC-0090-2130.0 | Reported working with Vetro 0.3.5: root agent with UID 0 after a full restart without opening Vetro; the bundled launcher opens from the physical Home key ([#180](https://github.com/andrearicci93/vetro/issues/180)) |
| [Q60D](/tested-tvs/q60d/) | 2024 | not reported | not reported | Reported working in a Reddit comment; no model code, firmware, Tizen or Vetro version given |
| [GU75CU7179](/tested-tvs/cu7179/) | 2023 | 9.0 | not stated | Reported working, installed with Apps2Samsung ([#17](https://github.com/andrearicci93/vetro/issues/17)) |
| [UE43CU8070](/tested-tvs/cu8070/) (UE43CU8070UXXN) | 2023 | 9.0 | 2220 | Reported working with Vetro 0.5.0, installed with Apps2Samsung: root agent with UID 0 after setting Host PC IP to 127.0.0.1 and restarting; the physical Home key opens a custom launcher, with Samsung Home kept ([#183](https://github.com/andrearicci93/vetro/issues/183)) |

The CU7179 and CU8070 are 2023 models. They are in this table because their reports list Tizen 9.0; the [2023 page](/root/root-samsung-tizen-7-2023/) covers their launch version and the installer caveat.

The Q65D row has the contrast to read carefully. The changelog records an authenticated agent and 29 confirmed controls there, but says cold-boot persistence was not reported, while the S90D owner said the agent came back after a full restart. A Q65D owner should not assume the same persistence.

## Which Tizen 9 TVs had problems?

The README's Tizen 9 row says root features are reported working on some TVs, and records two kinds of problem. Some TVs block apps from reaching the service on the TV itself ([#122](https://github.com/andrearicci93/vetro/issues/122), with a fallback in 0.5.0 that is not yet tried), and root problems are reported on others ([#99](https://github.com/andrearicci93/vetro/issues/99)). A working report on one model does not mean every Tizen 9 set works; the model and firmware still matter.

Tizen 9 also ships on 2025 models, and the next two reports are 2025 sets. A report from The Frame 2025 says loopback is blocked for apps on Tizen 9. One contributor proposed reaching the service through the TV's own address, and that fallback in 0.5.0 has not been tried on a TV. A Q8F on Tizen 9 could not reach the service in the first 0.5.0 build, so the pairing code never appeared. The republished 0.5.0 changes pairing to automatic; it has not yet been tried on a Q8F.

The 0.3.2 changelog notes that on Tizen 9 the Launcher closed only one of Samsung's Home packages, so it may free less memory than on the Q80A.

## Why is there no root on Tizen 10?

The README says Tizen 10 has no root yet: the firmware blocks the method Vetro uses to get root ([#91](https://github.com/andrearicci93/vetro/issues/91), [#140](https://github.com/andrearicci93/vetro/issues/140), [#177](https://github.com/andrearicci93/vetro/issues/177), [#178](https://github.com/andrearicci93/vetro/issues/178)). On an [M70H](/tested-tvs/m70h/) on Tizen 10 (#91), the service and dashboard ran, but the TV's local SDB daemon closed the connection before the handshake, so no root agent started. A [QN80F](/tested-tvs/qn80f/) lost root when a firmware update moved it to Tizen 10 ([#181](https://github.com/andrearicci93/vetro/issues/181)). The dashboard, app list and diagnostics are reported working on Tizen 10, and the README says Vetro will support it as soon as a root method for Tizen 10 exists.

## What does other public research say?

Two examples follow. This is not a survey of every public route.

- Bishop Fox published an [advisory](https://bishopfox.com/blog/samsung-tizen-os-version-through-9-0) on an arbitrary command injection in the Samsung Debug Bridge (SDB) service. It needs Developer Mode and an attacker on the host IP address set in that mode. Bishop Fox demonstrated it on Tizen 5.5, 7.0, 8.0 and 9.0 (physical TVs on 5.5, 7.0 and 8.0, an emulator for 9.0) and believes every Tizen version with SDB is likely affected.
- Public repositories, such as [commit-regrets/samsung_tizen_tv_root](https://github.com/commit-regrets/samsung_tizen_tv_root), describe work on a 2024 Neo QLED running Tizen 9. Its README says the route needs no sdb and no Developer Mode.

We have not tested those routes and Vetro does not use them. Samsung can patch the issues they describe, and a firmware update can change what works.

## What does Vetro 0.7.0 change on 2024 TVs?

Several 0.7.0 changes target 2024 and later TVs, and none of them has been tried on such a TV yet, according to the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md). Samsung Home opening from the launcher and the launcher at power-on were read from the 2022 and 2024 firmware and are not yet tried on those TVs. The programmes and TV guide of Vetro's live TV screen needed a change for the TV client of 2024 firmware, found in the firmware and not yet tried on a Tizen 9 TV. Hide remote key guides, for the remote pictures that come back after every power-on, was read from the Tizen 9 firmware and is not yet tried on such a TV. A Vision AI switch on the Disable tab turns off the AI screens that holding Home opens on 2024 and later TVs that have them; it also comes from reading the firmware. One launcher fix applies to every model: the row now redraws while you move a tile, which the changelog says was checked in a preview and not yet on a TV. Vetro UI, which holds the launcher and live TV, is marked Preview in the dashboard; a [diagnostic report](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) from a 2024 TV is the way to show what works.

## What should a 2024 TV owner do?

Compare your exact model and firmware with the table and send a [diagnostic report](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) either way. Failed attempts help too. Then think about updates before they happen. In [#223](https://github.com/andrearicci93/vetro/issues/223) a forced update to 1722.0 removed root on a 2022 TV, and Samsung does not support going back to older firmware. If root works on your TV, install Vetro and turn on Block firmware and software updates (Quick settings, General, Essential settings) while it still works. On Tizen 9 the lock is applied early at power-on through the TV's AT-HUB boot step; the changelog says this was read from the Tizen 9 firmware and tried on a Q80A only. It can help keep root, it does not guarantee it, and while it is on Samsung's firmware and app updates do not install. Without root, Vetro's [guide to blocking updates without root](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATES-WITHOUT-ROOT.md) says the network is the only reliable block. Read [how to stop automatic updates](/updates/stop-samsung-tv-auto-update/) and [does root survive a restart](/root/keep-root-after-restart/).

## Next steps

Read [#99](https://github.com/andrearicci93/vetro/issues/99) and [#122](https://github.com/andrearicci93/vetro/issues/122) before treating a Tizen 9 report as representative of your TV, and [#181](https://github.com/andrearicci93/vetro/issues/181) before you let a Tizen 9 TV update to Tizen 10. The previous generation is on the [2023 page](/root/root-samsung-tizen-7-2023/), and the [install guide](/root/install-vetro-apps2samsung/) covers how a package gets onto a TV.
