---
title: "Root a 2024 Samsung TV (Tizen 8, 9): what is confirmed"
description: "What is confirmed for 2024 Samsung TVs on Tizen 8 and 9: Q65D, S90D and DUE77 owner reports, the Tizen 9 problems and the first Tizen 10 root reports."
keywords: ["root samsung tizen 9", "samsung 2024 tv root", "samsung tizen 8 root"]
date: 2026-11-10
updated: 2026-11-27
verified: "Updated on 2026-11-27 against the Vetro 0.7.1 README (What's new, Compatibility) and CHANGELOG (Tizen 10, Update lock, Quick settings, Launcher, Updates) and UPDATING.md at commit cbc363f. The community rooting review, issue #223, the Bishop Fox advisory and the samsung-tv-root and commit-regrets repositories are as checked on 2026-11-21."
related: ["how-to-root-samsung-tv", "root-samsung-tizen-7-2023", "samsung-tv-tizen-version-by-year", "keep-root-after-restart", "firmware-update-remove-root", "is-it-safe-to-root-samsung-tv"]
---

For 2024 Samsung TVs the confirmed evidence is thin and comes from owners, not from the Vetro maintainers. The table below covers reports for the Q65D, S90D and DUE77, plus a Q60D Reddit comment without firmware details; the README lists more 2024 owner reports, such as the QN90D, DU6900 and DU7700. Two 2023 sets are included because they report the same Tizen 9 generation. The README also records root problems on other Tizen 9 sets. Tizen 10 root starts in Vetro 0.7.1 and so far comes from test builds on four 2025 models. Public security research covers more, and the owner reports and the outside research are kept separate below.

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

The 0.3.2 changelog noted that on Tizen 9 the Launcher closed only one of Samsung's Home packages. In 0.7.1, Close idle Samsung Home closes Samsung Home whole after a boot, its media hub and sidebar included ([CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#launcher)). The published measurements vary by TV: the changelog gives 63 to 118 MiB for the media hub in the diagnostics of 2022 and later TVs.

## Does Vetro 0.7.1 root Tizen 10 TVs?

On some models, in test builds so far. Tizen 10 root support starts in Vetro 0.7.1, through a separate route from the one Vetro uses on Tizen 6 to 9, and this page does not describe how it works. The [README](https://github.com/andrearicci93/vetro/blob/main/README.md#compatibility) records root connected in test builds on four 2025 models, all on firmware variants ending in 2103.1:

| TV | Firmware | What the README records |
| --- | --- | --- |
| [S85F](/tested-tvs/s85f/) (QE65S85FAEXXH) | T-PTMFDEUC-0100-2103.1 | Root connected in the contributor's test build; an earlier report records root loss after a Samsung firmware update ([#308](https://github.com/andrearicci93/vetro/issues/308)) |
| [Q70F](/tested-tvs/q70f/) | T-RSLFDEUC-0100-2103.1 | Root connected in a test build |
| [U8000F](/tested-tvs/u8000f/) | T-KSU2EFAKUC-0100-2103.1 | Root connected in a test build |
| [QN900F](/tested-tvs/qn900f/) (QA65QN900FWXXY) | T-OSCPFUABC-0100-2103.1 | Root connected after retries in a test build, with the launcher off during the test; earlier builds failed on this model ([#193](https://github.com/andrearicci93/vetro/issues/193), [#194](https://github.com/andrearicci93/vetro/issues/194)) |

The README says these reports confirm that root connected on those sets, that feature coverage varies by model, and that field reports for the final 0.7.1 build are still pending. Read them as a start, not a guarantee for your TV.

Root is still unconfirmed with 0.7.1 on a [QN80F](/tested-tvs/qn80f/) on 2103.1, which stopped connecting with Vetro 0.5.0 after a firmware update ([#181](https://github.com/andrearicci93/vetro/issues/181)), and on the 2026 [M70H](/tested-tvs/m70h/), M73H and U8000H, where earlier builds had service or dashboard reports and root failures ([#91](https://github.com/andrearicci93/vetro/issues/91), [#140](https://github.com/andrearicci93/vetro/issues/140), [#177](https://github.com/andrearicci93/vetro/issues/177), [#178](https://github.com/andrearicci93/vetro/issues/178)).

For the rest of Vetro, the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#tizen-10) describes selected checks against the firmware of a 2026 TV and earlier diagnostic reports of the Q70F, U8000F and QN900F: Samsung Home starts, the remote interception holds the remote, the Volume bar draws and the picture modes read as on Tizen 9. The final 0.7.1 build still needs testing on a Tizen 10 TV. Two changes follow from those reports. After two reports came back with empty network sections, Vetro 0.7.1 changes how the diagnostic report finds the network tool. And Tizen 10 keeps Samsung Home's row in a database of its own app that Vetro does not read, so where no cache file is found the launcher's row is the list of installed apps, as on a 2022 TV; the diagnostic report now says where the row comes from.

## What does other public research say?

Two examples follow. This is not a survey of every public route.

- Bishop Fox published an [advisory](https://bishopfox.com/blog/samsung-tizen-os-version-through-9-0) on an arbitrary command injection in the Samsung Debug Bridge (SDB) service. It needs Developer Mode and an attacker on the host IP address set in that mode. Bishop Fox demonstrated it on Tizen 5.5, 7.0, 8.0 and 9.0 (physical TVs on 5.5, 7.0 and 8.0, an emulator for 9.0) and believes every Tizen version with SDB is likely affected.
- Public repositories, such as [commit-regrets/samsung_tizen_tv_root](https://github.com/commit-regrets/samsung_tizen_tv_root), describe work on a 2024 Neo QLED running Tizen 9. Its README says the route needs no sdb and no Developer Mode.

We have not tested those routes and Vetro does not use them. Samsung can patch the issues they describe, and a firmware update can change what works.

## What do Vetro 0.7.0 and 0.7.1 change on 2024 TVs?

Several 0.7.0 changes target 2024 and later TVs. On TVs with Vision AI, the Disable tab has a switch for the AI screens opened by holding Home. The others carry a caveat in the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md) that they are not yet tried on such a TV. Samsung Home opening from the launcher and the launcher at power-on were read from the 2022 and 2024 firmware and are not yet tried on those TVs. The programmes and TV guide of Vetro's live TV screen needed a change for the TV client of 2024 firmware, found in the firmware and not yet tried on a Tizen 9 TV. Hide remote key guides, for the remote pictures that come back after every power-on, was read from the Tizen 9 firmware and is not yet tried on such a TV. One launcher fix applies to every model: the row now redraws while you move a tile, which the changelog says was checked in a preview and not yet on a TV. Vetro UI, which holds the launcher and live TV, is marked Preview in the dashboard; a [diagnostic report](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) from a 2024 TV is the way to show what works.

Vetro 0.7.1 also changes how the service restarts after a dashboard update on Tizen 6.5 to 9 TVs, where Vetro's service runs inside Samsung's shared web service process ([#296](https://github.com/andrearicci93/vetro/issues/296)). [UPDATING.md](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATING.md) says this restart path has passed tests only and no Tizen 6.5 or later TV has run it yet. Coming from 0.7.0, the [install guide](/root/install-vetro-apps2samsung/) has the one full restart that step still needs.

## What should a 2024 TV owner do?

Compare your exact model and firmware with the table and send a [diagnostic report](https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml) either way. Failed attempts help too. Then think about updates before they happen. In [#223](https://github.com/andrearicci93/vetro/issues/223) a forced update to 1722.0 removed root on a 2022 TV, and Samsung does not support going back to older firmware. If root works on your TV, install Vetro and turn on Block firmware and software updates (Quick settings, General, Essential settings) while it still works. On Tizen 9 the lock is applied early at power-on through the TV's AT-HUB boot step; the changelog says this was read from the Tizen 9 firmware and tried on a Q80A only. Vetro 0.7.1 extends it to Samsung's separate update mode after a re-check against 2024 (Tizen 9) firmware, and the [CHANGELOG](https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md#update-lock) says that extension is not tried on a TV yet; in [#308](https://github.com/andrearicci93/vetro/issues/308) an update reached a QE65S85F with the earlier block on, and what happened there is not known. The switch is designed to block Samsung's firmware and app updates. It can help keep root, but it does not guarantee it. Without root, Vetro's [guide to blocking updates without root](https://github.com/andrearicci93/vetro/blob/main/app/docs/UPDATES-WITHOUT-ROOT.md) says the network is the only reliable block. Read [how to stop automatic updates](/updates/stop-samsung-tv-auto-update/) and [does root survive a restart](/root/keep-root-after-restart/).

## Next steps

Read [#99](https://github.com/andrearicci93/vetro/issues/99) and [#122](https://github.com/andrearicci93/vetro/issues/122) before treating a Tizen 9 report as representative of your TV, and [#181](https://github.com/andrearicci93/vetro/issues/181) and [#308](https://github.com/andrearicci93/vetro/issues/308) before you let a TV take a firmware update. The previous generation is on the [2023 page](/root/root-samsung-tizen-7-2023/), and the [install guide](/root/install-vetro-apps2samsung/) covers how a package gets onto a TV.
