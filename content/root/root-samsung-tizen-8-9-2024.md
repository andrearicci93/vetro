---
title: "Root a 2024 Samsung TV (Tizen 8, 9): what is confirmed"
description: "What is confirmed for 2024 Samsung TVs on Tizen 8 and 9: Q65D and S90D owner reports, failed Tizen 9 and 10 reports, a 2023 CU7179 and outside research."
keywords: ["root samsung tizen 9", "samsung 2024 tv root", "samsung tizen 8 root"]
date: 2026-11-10
updated: 2026-11-10
verified: "Checked on 2026-11-10 against the Vetro 0.5.0 README compatibility table and CHANGELOG, the Bishop Fox advisory and the samsung-tv-root and commit-regrets repositories."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-7-2023", "samsung-tv-tizen-version-by-year", "keep-root-after-restart", "firmware-update-remove-root", "is-it-safe-to-root-samsung-tv"]
---

For 2024 Samsung TVs the confirmed evidence is thin and comes from owners, not from the Vetro maintainers. Two 2024 models, the Q65D and the S90D, are reported working, a 2023 CU7179 is included because it reports the same Tizen 9 generation, and the README also records root failures on other Tizen 9 and 10 sets. Public security research covers more, and the owner reports and the outside research are kept separate below.

The linked research repositories are written for researchers and can contain exploit code. This page contains none and is not a guide to running any of it. Vetro is experimental, needs root and ships no signed installer; see [the risks](/root/is-it-safe-to-root-samsung-tv/) and [how to root a Samsung TV](/root/how-to-root-samsung-tv/).

## What have Vetro owners reported on 2024 TVs?

| TV | Year | Tizen | Firmware | What was reported |
| --- | --- | --- | --- | --- |
| [QN55Q65D](/tested-tvs/q65d/) | 2024 | 8 at launch | T-NKLDUABC-0090-2123.9 | Reported working, installed with Apps2Samsung; authenticated UID-0 agent and 29 confirmed controls; cold-boot persistence not reported ([#10](https://github.com/andrearicci93/vetro/issues/10)) |
| [S90D](/tested-tvs/s90d/) (QA65S90DAULXL) | 2024 | 9 | T-PTMDUABC-0090-2130.0 | Reported working, with the root agent back after a full restart, in the owner's account ([#36](https://github.com/andrearicci93/vetro/issues/36)) |
| [GU75CU7179](/tested-tvs/cu7179/) | 2023 | 9.0 | not stated | Reported working, installed with Apps2Samsung ([#17](https://github.com/andrearicci93/vetro/issues/17)) |

The CU7179 is a 2023 model. It is in this table because its report lists Tizen 9.0; the [2023 page](/root/root-samsung-tizen-7-2023/) covers its launch version and the installer caveat.

The Q65D row has the contrast to read carefully. The changelog records an authenticated agent and 29 confirmed controls there, but says cold-boot persistence was not reported, while the S90D owner said the agent came back after a full restart. A Q65D owner should not assume the same persistence.

## Which Tizen 9 and 10 TVs failed?

The README's Tizen 9 and 10 row says root features are reported working on some TVs, and records two kinds of problem. Some TVs block apps from reaching the service on the TV itself ([#122](https://github.com/andrearicci93/vetro/issues/122)), and root problems are reported on others ([#91](https://github.com/andrearicci93/vetro/issues/91), [#99](https://github.com/andrearicci93/vetro/issues/99)). A working report on one model does not mean every Tizen 9 set works; the model and firmware still matter. The README also lists no model on Tizen 10, although the changelog notes Tizen 10 service startup fixes.

Tizen 9 also ships on 2025 models, and the next two reports are 2025 sets. A report from The Frame 2025 says loopback is blocked for apps on Tizen 9. One contributor proposed reaching the service through the TV's own address, and that fallback in 0.5.0 has not been tried on a TV. A Q8F on Tizen 9 could not reach the service in the first 0.5.0 build, so the pairing code never appeared. The republished 0.5.0 changes pairing to automatic; it has not yet been tried on a Q8F.

The changelog also says Tizen 9 behaves differently for the Launcher: it still closes only Samsung's Home, so the memory it frees may be smaller than on the Q80A.

## What does other public research say?

Two examples follow. This is not a survey of every public route.

- Bishop Fox published an [advisory](https://bishopfox.com/blog/samsung-tizen-os-version-through-9-0) on an arbitrary command injection in the Samsung Debug Bridge (SDB) service. It needs Developer Mode and an attacker on the host IP address set in that mode. Bishop Fox demonstrated it on Tizen 5.5, 7.0, 8.0 and 9.0 (physical TVs on 5.5, 7.0 and 8.0, an emulator for 9.0) and believes every Tizen version with SDB is likely affected.
- Public repositories, such as [commit-regrets/samsung_tizen_tv_root](https://github.com/commit-regrets/samsung_tizen_tv_root), describe work on a 2024 Neo QLED running Tizen 9. Its README says the route needs no sdb and no Developer Mode.

We have not tested those routes and Vetro does not use them. Samsung can patch the issues they describe, and a firmware update can change what works.

## What should a 2024 TV owner do?

Compare your exact model and firmware with the table and send a [diagnostic report](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) either way. Failed attempts help too. Then read [how to stop automatic updates](/updates/stop-samsung-tv-auto-update/), because new firmware can remove what works today, and [does root survive a restart](/root/keep-root-after-restart/).

## Next steps

Read [#91](https://github.com/andrearicci93/vetro/issues/91) and [#99](https://github.com/andrearicci93/vetro/issues/99) before treating a Tizen 9 report as representative of your TV. The previous generation is on the [2023 page](/root/root-samsung-tizen-7-2023/), and the [install guide](/root/install-vetro-apps2samsung/) covers how a package gets onto a TV.
