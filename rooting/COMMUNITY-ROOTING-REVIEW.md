# Community rooting review

Research snapshot: **2 November 2026**. Repository: [andrearicci93/vetro](https://github.com/andrearicci93/vetro). Local comparison: branch `feature/sdb-tunnel-experimental`, HEAD `43cf3a1cc01a224654fac780ed6eca70bb698c5e`. This is a discovery report, not a hardware validation or a proposed implementation. Only this report was written; no product code, GitHub comments, reviews, issues, branches, or PRs were changed.

## Parent verification against remote main

The parent independently fetched and inspected remote `main` at **`52b02b4cf575aae64af149b77de400c873fc14fc`**. The detailed discovery sections below describe the older local experimental branch unless explicitly marked remote. For deciding what is new to the public project, use these reconciled conclusions:

- **Already integrated in main:** [#75](https://github.com/andrearicci93/vetro/pull/75), including the unsupported-runtime guard in [`platform.js`](https://github.com/andrearicci93/vetro/blob/52b02b4cf575aae64af149b77de400c873fc14fc/rooting/service/platform.js#L119) and Node 4 crypto/API shims in `app/service/compat.js`. It enables service availability on older runtimes while deliberately stopping the unsupported root preparation; it does not provide old-TV root. The earlier #33 service compatibility and #29/#49 startup-flag repair are also already represented. #73's physical-source cache syntax and #44's extra tracking classifications are present in main and must not be proposed as new work.
- **Still absent from main:** #95's private-file broker/root-shell queue and alternative launcher host, #35's old-TV root backends and host ports, #99's independent privileged supervisor, and a coherent per-backend capability/preflight report. The production adapter still depends on local SDB injection and `/usr/bin/dotnet`.
- **#99 diagnosis corrected against main:** [`platform.js:270`](https://github.com/andrearicci93/vetro/blob/52b02b4cf575aae64af149b77de400c873fc14fc/rooting/service/platform.js#L270) already writes the token before each relaunch. The useful proposal is privileged recovery without a second SDB bootstrap, not merely preserving a consumed token. Recovery after killing one process does not establish recovery after a cold boot.
- **Concrete small compatibility work remains:** [`app-registry.js`](https://github.com/andrearicci93/vetro/blob/52b02b4cf575aae64af149b77de400c873fc14fc/app/service/app-registry.js#L10) still fails the combined registry load when `package_dependency_info` is missing. [`dock.js:123`](https://github.com/andrearicci93/vetro/blob/52b02b4cf575aae64af149b77de400c873fc14fc/app/service/dock.js#L123) still ends the status command with a `tail` that fails when the first-run log is absent. These are reusable fixes, not root exploits.
- **Runtime selection is incomplete in the active adapter:** the vendored Python [`archive_root.py`](https://github.com/andrearicci93/vetro/blob/52b02b4cf575aae64af149b77de400c873fc14fc/rooting/tools/samsung-tv-root-master/src/samsung_tv_root/archive_root.py#L88) already probes 3.1 versus 6+ and constructs corresponding runtime configs, with a Samsung-launcher fallback. The production JS adapter instead copies fixed .NET 3.1 configs. Reusing that detection pattern is an additional source-derived candidate; it is not a demonstrated fix for any particular failing TV, nor enough for .NET 2.1/3.0 ports.
- **#88 is not merged into main:** GitHub reports it open against `release-0.4.0`; do not confuse its presence on another local ref with integration into main.
- **#78 relay is local experimental work:** the local branch contains the SDB relay; the inspected main adapter/build does not. It should not be counted as an entirely new idea for this workspace, or as a released root-compatibility solution.

Recommended order: improve capability/failure-stage reporting and bounded schema/status fallbacks; design #99 as post-bootstrap recovery with explicit lifetime semantics; then review reusable source for #95 as a separate backend and #35 as a distinct older-TV port. No evidence supports announcing generic Tizen 4/5/9/10 rooting compatibility from these discussions alone. No hardware or test-suite validation was performed in this audit.

## Main findings

1. **Older-runtime service support and rooting support are separate deliverables.** PR #33 fixes the app-only Node 4 service. PR #75 subsequently fixes the integrated package's load-time failures and disables an unsupported root chain cleanly. #75 is merged remotely, but its implementation is absent from this local checkout. Neither PR gives older TVs the stock archive-root chain.
2. **There are at least two distinct community ports for older TVs.** The Q80R Tizen 5.0 port in #35 uses USB initial root and separate firmware-specific persistence; the TU7000 Tizen 5.5 port in #95 uses an adapted Remote PC/CIFS route, a private-file broker, and a shell job queue. They should not be described as stock Vetro successes or merged into one generic “Tizen 5” recipe.
3. **SDB failures need classification.** Older firmware can reject the injection payload after a connection; #91 reports a handshake failure on a Tizen 10 TV; #99 reports failure to recover an existing root agent on one Tizen 9 TV. These are different phases and do not establish a version-wide vulnerability boundary.
4. **Developer Host IP friction has a concrete local partial implementation.** #78 proposes a relay, independent root recovery, or an IP toggle. This branch already has a relay on port 26201. It still relies on TV-local SDB accepting loopback, and its listener is not protected by HTTP pairing.
5. **Boot flag repair is already integrated.** #29 and #49 address installer registration with false startup flags; local `ComponentActions.selfStartup` implements the repair after root connects. A report of read-only `/etc/systemd/user` is not evidence that this mechanism needs replacing.
6. **Root connected does not mean launcher compatible.** Runtime host, registry schema, Home cache, Home process graph, physical input path, and actual on-screen behavior vary independently. #46's platform fingerprint and capability-driven behavior proposal is highly relevant to selecting and reporting root backends too.

## Method, coverage, and limitations

- The available GitHub plugin search tools were tried first (`github_search_issues`, `github_search_prs`); both returned `Unknown tool`. Read-only `gh api` REST and GraphQL calls were used after that failure.
- Enumerated **all 102 issue/PR records** with `state=all` and REST pagination: **70 issues** (55 open, 15 closed) and **32 PRs** (16 open, 16 closed). Closed PRs include merged and unmerged items; closure is not treated as integration.
- Retrieved repository-wide issue comments across all pages: **214 comments**, comprising **177 non-bot comments** and **37 `github-actions[bot]` comments**. Reviewed rooting-related discussions in detail and screened the rest, including diagnostic summaries, for compatibility and lifecycle suggestions. Bot summaries are parsed attachment claims, not independent TV tests.
- Enumerated all 32 PRs' GraphQL `reviews` and `reviewThreads`, including resolved threads. Every connection reported `hasNextPage=false`. Result: **two submitted reviews** (#9 requests changes; #47 approval with empty body), **zero inline review threads**. The repository-wide REST pull-review-comments endpoint also returned no comments. Suggestions in top-level PR conversation comments are included below.
- Read all issue/PR descriptions for discovery; inspected relevant local source to classify integrated, partial, or missing suggestions. Did not independently inspect remote branch diffs: the parent owns that comparison. Remote merge state and local source presence are reported separately.
- No TV, exploit, installation, reboot, or performance test was performed. Test counts below are contributor claims unless explicitly stated otherwise. No local test suite was run for this documentation-only task.
- Linked diagnostic attachments, screenshots, gists, external forks, and upstream projects are leads, not an exhaustively audited second corpus. Most attachment evidence here comes from the issue text and bot summaries. A direct read of #91's attachment returned non-JSON content and could not be parsed; its exact firmware remains unknown. External compatibility assertions are attributed to their authors rather than promoted to independently verified facts.
- The report intentionally does not reproduce credentials, unique device identifiers, private paths, firmware offsets, or notification tokens embedded in quoted email replies. Repository-relative code pointers describe this checkout and may move with later parent edits.

Evidence vocabulary: **reported hardware result** means a contributor says it was checked on the TV; **source-confirmed** means visible in this checkout; **inference** means a deduction from those facts; **proposal** means not established by the evidence. No community claim becomes universal merely because several models share a Tizen version.

## Root/backend improvements

### 1. Make unsupported root runtimes degrade into a usable service

**Sources:** [#33](https://github.com/andrearicci93/vetro/pull/33), [#75](https://github.com/andrearicci93/vetro/pull/75), [#77](https://github.com/andrearicci93/vetro/issues/77), [original Tizen 4 report #2](https://github.com/andrearicci93/vetro/issues/2), [#19](https://github.com/andrearicci93/vetro/issues/19), [#65](https://github.com/andrearicci93/vetro/issues/65).

**Observed distinctions:**

| Exact report | Runtime/build and evidence | What it establishes |
| --- | --- | --- |
| QN55Q80TAGXZD, `20_NIKEM_QTV`, Tizen 5.5.0, `T-NKMUABC-2743.0` (#33) | Stock service runtime Node 4.4.3; app-only package with compatibility shims; dashboard, inventory, diagnostic download, repeated requests, and cold boot tested | App-only service can work. Root explicitly not claimed; no `/usr/bin/dotnet`, older .NET, and namespace limitations reported |
| UE43NU7090, Tizen 4.0, firmware `1400.2`, sdbd `2.2.31` (#75) | Integration package crashed on destructured `require` in `sdb.js`; temporary console sink captured a stack trace because retail logs were unavailable | #33 was insufficient for the integration build; #75 reportedly makes it stay up with `unsupported=true`, without root |
| UE50TU7100KXXU, `T-KTSU2DEUC-2743.0`, Tizen 5.5 (#77) | Catalog integration package failed; replacing only the adapter with app-only upstream adapter restored a live Node 4.4.3 service | Confirmed fallback benefit, no root; VM reproduction of `padStart` was not an on-device stack trace |
| UE43RU7400UXZT, `19_MUSEL_UHD`, `T-MSLDEUC-1500.9`, Tizen 5.0 ([#77 follow-up](https://github.com/andrearicci93/vetro/issues/77#issuecomment-6554803440)) | #75 built onto main; status, dashboard and diagnostics 200; 296 public-probe apps; stable PID | Independent older-generation service fallback confirmation; root deliberately stopped at unsupported-runtime check |
| UA50TU8500SXNZ, `T-NKLUABC-2743.0,BT-S`, Tizen 5.5 ([#77](https://github.com/andrearicci93/vetro/issues/77#issuecomment-6548161599)) | Catalog beta, exact version not recorded; still SVC DOWN after Host IP/restart | Corroborating symptom, not proof #75 was installed or failed |
| UN75NU6080, `T-KYSUAKUC-1350.7`, Tizen 4.0 (#54/#65); QE55Q6FNA, Tizen 4.0 (#65); QE32LS03TCUXXU, `T-KSU2FDEUC-2743.0` (#2) | Install/service problems; one app-only success; no matching post-#75 full validation for all these TVs | Do not generalize the NU7090 result to every older TV |

**Suggested change:** #75 makes packaged integration modules parse on Node 4, replaces unsupported built-ins, tests the files actually shipped by `collectIntegration`, and checks `generateKeyPairSync` before preparation side effects. Unsupported runtime is recorded once, the unused agent listener is closed, and the retry loop stops. #77 also asks for an explicitly app-only catalog option or runtime selection before unsupported modules are loaded.

**Local status: partially integrated overall, #75 missing.** `app/service/compat.js:12` has #33-style Promise/Buffer shims. However:

- `rooting/service/sdb.js:3` still destructures `Connection`; `adb.js` also needs the packaged syntax audit.
- `rooting/service/platform.js:42` still uses `padStart`; `:45` uses recursive mkdir; `:114` calls `crypto.generateKeyPairSync` unconditionally.
- `rooting/service/root-agent.js:149` calls `crypto.timingSafeEqual`; the local compatibility shim does not supply the #75 crypto shim.
- `rooting/tests/` lacks the `node4-syntax` and `node4-fallback` suites described by #75.

PR #75 is remotely merged (1 November); that fact must not be confused with presence in this older experimental checkout. A syntax/API fallback fixes service availability, not the missing runtime host, namespace support, or rejected SDB injection. The report's Node 10.12+ requirement concerns the current cryptographic implementation, not a fundamental requirement for every possible authenticated root backend.

### 2. Treat Tizen 5.0 USB root, runtime compatibility, and persistence as separate work

**Sources:** [Q80R report #35](https://github.com/andrearicci93/vetro/issues/35), [maintainer's requested split](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6414092666), [important persistence clarification](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6454569136).

**US Q80R:** QN65Q80RAFXZA, Tizen 5.0, `T-MSMAKUC-1500.5`; custom port based on `827b7289090708992eedaca6f2d03d264b390425`, not stock Vetro. Initial root used [Luminger/samsung-tv-usb-root](https://github.com/Luminger/samsung-tv-usb-root), `tv` profile, upstream checkout `223f1cd6cca185f93fe7db53ef71eb52963a7086`. The owner later clarified that USB-free startup required a backed-up on-disk shell-profile hook and a firmware-checked volatile UEP change on every boot. A private Node 16.20.2 runtime under `/opt/vetro/runtime` and private loader/library path ran the direct-root HTTP service; stock `/usr/bin/node` remained 4.4.3. The launcher needed a .NET Core 2.1.4 port. UI navigation, apps, Settings, and separate USB-free restart checks were reported. This is not evidence that loopback Developer Mode established persistence.

**EU sibling:** GQ55Q80RGTXZG, `T-MSMDEUC-1500.9`. [A separate contributor](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6463516103) reports using stock Node 4.4.3 with Buffer/MAC/padding/mkdir shims and a gated crypto preparation path, rather than installing Node 16. They report that this TV's customized Node aborts on `child_process` with a libuv `uv_close` assertion, so an alternate root agent executes through a bash coprocess/FIFOs. The later [limitations comment](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6465376833) says the unported .NET 3.1 dock still cannot run on their .NET 2.1.4 system. These two contributors' setups should not be merged into one result.

**Injection evidence:** the EU report says sdbd `3.7.1_TV_REL` filters package-name command injection daemon-side, tested with a raw ADB client: metacharacters close the connection and semicolons are split before shell execution. The author's conclusion is that this archive-root path cannot launch on that firmware. This is a reported firmware-specific result, not proof every Tizen 5 daemon behaves identically. They reference [upstream root issue #22](https://github.com/chris-ritsen/samsung-tv-root/issues/22).

**Further boundary evidence:** [QE55Q67RATXXH, Tizen 5.0, `T-MSMDEUC-1500.9`](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6558615950) reports initial USB root only. The [later Q80R clarification](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6553916991) points to the USB project's [firmware matrix](https://github.com/Luminger/samsung-tv-usb-root/blob/main/docs/FIRMWARE-COMPATIBILITY.md): its complete Muse.M/T-MSM profile must not be assumed to cover a Tizen 5.5 NikeL or Kant-SU2 device. The #71 LS03R Frame owner explicitly did not attempt root because their model was not listed.

**Suggested upstream work:** schema/icon fallbacks first; separate older-Home handling; separate design for .NET host selection, private runtimes, alternate agents, initial root, and persistence. Preserve current paths as defaults, detect older layouts only as fallbacks, and require source plus validation/restore logic for firmware-specific contributions. This is the maintainer's stated direction, not approval of a generic patcher.

**Local status: documented local port, not integrated backend.** `README.md:107` qualifies the Q80R entry. `rooting/service/platform.js:55` and `:249` hardcode `/usr/bin/dotnet`; `app/service/dock.js:176` does too. No generic USB bootstrap, FIFO execution backend, private Node loader selection, or old-runtime launcher selection is wired into the production adapter. Vendored research under `rooting/tools/` is not equivalent to an application-integrated backend.

### 3. Investigate the working Tizen 5.5 Remote PC/CIFS adapter as its own backend

**Sources:** [#95](https://github.com/andrearicci93/vetro/issues/95), [#77 research lead](https://github.com/andrearicci93/vetro/issues/77), linked [tiz0wn research](https://github.com/sebastianspicker/tiz0wn/tree/main/research/remotepc-cifs-root).

**Reported hardware:** UE43TU7000KXXU, `20_KANTSU2_UHD_BASIC`, Tizen 5.5, `T-KTSU2DEUC-2743.0`, stock service Node 4.4.3. Vetro 0.3.5 with local changes; no reliable base commit. Tests on 31 October; diagnostic export on 1 November. The owner reports authenticated UID/EUID 0 and SMACK `System::Privileged`, 281 inventory entries without registry failure, and three unplugged cold boots without the temporary VM or manual Remote PC/Vetro opening.

**Reusable suggestions in #95:**

- Additional Node 4 root-module and Buffer/MAC compatibility.
- A paired private-file bootstrap connecting a local authenticated broker to Vetro.
- A root-shell file queue instead of Node process spawning because this TV also hit the `uv_close` assertion.
- Persistent writable boot-UUID locks and atomic job claiming to withstand early temp-directory cleanup and avoid duplicate root workers.
- .NET 3.0 launcher variant through signed `/usr/bin/dotnet-launcher --standalone`; no `/usr/bin/dotnet` CLI. The original 3.1 reference failed to load.
- Root-owned writable HOME/runtime directory and an app catalog outside the owner's private home because the standalone host drops filesystem capabilities.
- First-run launcher status must tolerate a missing log; configurable validated button code for an old remote without Home (Info, evdev 188).

**Limits:** one exact TV/firmware and a modified build. No root SSH, account changes, unsigned native executable, or UEP patch was installed according to the reporter. MQTT/general Remapper validation is not claimed. Diagnostic launcher/settings/Quick Wins sections timed out; separate physical checks support the launcher claims. Exported persistence fields remain `unknown` despite separately observed boot tests.

**Important contrast:** #77's UE50TU7100KXXU shares `T-KTSU2DEUC-2743.0`, but its matching Remote PC mount helper and `ps_agent` hashes establish only binary similarity. The input path was not tested and UID-0 execution was not obtained there. #95 does not retrospectively prove root on the TU7100.

**Local status: missing.** The normal adapter still uses local SDB injection and a .NET 3.1 payload; there is no paired-file bootstrap or shell file queue in that adapter. `app/service/dock.js:123` ends its probe with `tail` of a possibly absent log and rejects nonzero command status at `:126`: a concrete source-level match to the reported first-run status weakness. Do not label a `dotnet-launcher` path substitution alone as a complete port.

### 4. Recover an existing privileged agent without re-exploiting SDB

**Source:** [#99, open](https://github.com/andrearicci93/vetro/issues/99).

The author reports QA65Q8FAAKXXV / `T-RSLFUABC-0090-1300.9`, Tizen 9.0. Their text calls it a 2024 model; preserve the exact code and reported OS rather than resolving that inconsistent year from the title. Repeated launches fail with `fail:sdbClosed` / “closed before handshake” after reboot/disconnection. They propose retaining an agent secret copy, restoring the consumed token when spawning the DLL directly, and a runtime systemd watcher polling status. A forced agent kill reportedly self-heals in about six seconds. They also report UEP rejects a script file passed directly to bash, while feeding it through standard input works on this TV.

**Source-confirmed local behavior:**

- `rooting/tools/samsung-tv-root-master/payloads/common/SamsungTvRootAgent.cs:520` decodes and removes the token in `finally`.
- `rooting/service/platform.js:238` **already recreates `root-agent.token` before each SDB relaunch**. Therefore the report's broad claim that deletion makes restart impossible needs qualification: deletion is not a blocker for the existing service's reinjection path; it is a blocker for a separate watcher that has no way to obtain the current secret.
- `platform.js:185`, `:207`, `:249`, `:255` recover disconnection by rerunning the archive helper through loopback SDB. No independent privileged supervisor is present.
- `platform.js:55` already detaches the DLL with redirected streams; `RootAgentServer` authenticates connection frames. This is transport/lifetime handling, not independent privilege reacquisition.

**Assessment:** a plausible separate post-bootstrap recovery path, missing locally. An ordinary unprivileged web service cannot merely spawn a UID-0 DLL because it once had a root connection; the watcher must already possess privilege and be installed while root is available. A unit in `/run/systemd/system` is volatile, so the claimed kill/restart recovery does not by itself prove recovery after a true power-loss boot. The proposal also needs service-generation/port/secret ownership, stale-stage cleanup, duplicate-worker control, and shutdown behavior designed together. Those are implications of the existing lifecycle, not reported fixes. Do not retain a plaintext `.keep` file mechanically without deciding its permissions, lifetime, and authentication consequences.

**Not established:** that all Tizen 9 TVs close local SDB. #63/#68 and other successful Tizen 9 reports contradict such a universal statement. No watcher source, review, repeated cold-boot evidence, or firmware-wide UEP guarantee accompanies #99.

### 5. Classify Tizen 10 handshake failure independently

**Source:** [#91](https://github.com/andrearicci93/vetro/issues/91).

UA55M70HAULXL, platform `26_X22U_UHD_VOX`, reported Tizen 10.0, Vetro 0.3.5 at `fb1cadc66ff52cd86358b751e17c1cfb225e0733`. Firmware is unreadable/`Unknown`. Service and dashboard on 8099 run; local SDB is reachable, but its daemon closes the connection before handshake completes, so no privileged agent launches.

**Suggested improvement:** distinguish TCP reachability, SDB handshake, injection acceptance, archive execution, and authenticated agent callback in status/diagnostics. A refusal before handshake is not evidence of the same package-injection filter as the Tizen 5.0 report. Neither is it proof Samsung fixed every stage of the underlying exploit.

**Local status:** `rooting/service/sdb.js` supplies handshake/timeout error codes and `platform.js:252` records launch attempts, but no Tizen-10-specific alternative or compatibility gating is present. This remains one failed, firmware-unknown report. Conversely #87's working S95D does not prove Tizen 10 support: its description does not establish its OS version, which is exactly why PR #88 was proposed.

### 6. Host IP coexistence, relays, and root-independent recovery

**Sources:** [#78](https://github.com/andrearicci93/vetro/issues/78), [TV-Store discussion lead](https://github.com/andrearicci93/vetro/issues/78#issuecomment-6528957103), [Apps2Samsung author's qualification](https://github.com/andrearicci93/vetro/issues/78#issuecomment-6535428930), [#96](https://github.com/andrearicci93/vetro/issues/96), [earlier installer request #38](https://github.com/andrearicci93/vetro/issues/38).

#78's rooted UA85DU7700WXXY / firmware 2130.0 proposes three alternatives: keep the root agent independent of SDB after bootstrap; relay a configured PC's SDB connection through loopback; or a UI toggle for `db/sdk/develop/ip` (and daemon restart). #96 additionally requests a Developer Mode toggle for `db/sdk/develop/mode` and the host address. #38 originally requested signed TPK/WGT installation from Vetro to avoid changing Host IP; it was closed by its author after TV-Store became available. #48/#28 also discuss upgrades and uploading signed packages, without a reviewed Vetro implementation.

**Local status: relay already present, other alternatives missing.**

- `rooting/service/sdb-tunnel.js:20` binds a raw TCP listener to `0.0.0.0`; `:21` defaults upstream to loopback; `:29` pipes it to sdbd. `rooting/service/platform.js:199` starts it alongside the adapter. `rooting/SDB-TUNNEL.md` documents default port 26201 and lifecycle/limits.
- The normal root channel already executes commands through its authenticated agent rather than sending every command through SDB (`platform.js:285`, `root-agent.js:156`). #78's option 1 should thus be interpreted as **bootstrap/recovery independence**, not a request to replace a per-command SDB transport that does not exist here.
- No production Host IP/Developer Mode toggle or PC source allowlist was found in this path. HTTP authentication would not secure this raw TCP listener. This is a local experimental implementation, not evidence a corresponding community PR was merged.
- The Apps2Samsung author says loopback does not work on some firmware and TV-Store chose the TV's LAN IP for that reason. A relay is therefore not a solution for TVs whose local upstream handshake itself fails. TV-Store accepting 127.0.0.1 in its own settings is a different question from sdbd accepting it.

**Useful evidence for setup UX:** [#62](https://github.com/andrearicci93/vetro/issues/62), QN60Q6DAAFXZA / `T-NKLAAKUC-2310.0`, initially disconnected with Host IP pointing to the PC and an SDK connection present; switching to loopback and releasing that connection resolved it without reboot. Their individual effects were not isolated. [#4](https://github.com/andrearicci93/vetro/issues/4) also reports `sdb kill-server` plus loopback. [#60](https://github.com/andrearicci93/vetro/issues/60#issuecomment-6470453836), UE55AU9000 / `T-NKLADEUC-2310.0`, was resolved simply by completing installation step 5. These are not evidence of patched firmware.

### 7. Keep the integrated boot-flag repair; make its evidence explicit

**Sources:** [#4](https://github.com/andrearicci93/vetro/issues/4), [#29](https://github.com/andrearicci93/vetro/pull/29), [stock-build power-cable retest](https://github.com/andrearicci93/vetro/pull/29#issuecomment-6406032845), [#25](https://github.com/andrearicci93/vetro/issues/25), [#26 resolution](https://github.com/andrearicci93/vetro/issues/26#issuecomment-6413195965), [#49](https://github.com/andrearicci93/vetro/pull/49).

On some installations the package requests boot/restart flags but `vetrotvapp.svc` is registered false/false. #29's S90C TQ65S90CATXXC, Tizen 7.0 / `T-PTMCDEUC-2000.2`, has controlled boot timing and a subsequent clean stock 0.3.2 AC-removal test. Public distributor signing was sufficient on those tested configurations. #4's QN85A `T-NKM2DEUC-2301.1` had an earlier manual repair; #25 QN85B and #26 QN93A corroborated startup recovery after the upstream change. #22's initially negative cold-boot answer was later revised to automatic startup.

**Local status: integrated.** `app/service/component-actions.js:37` computes repairs only for false flags on `vetrotvapp.svc`; `:32` uses backup/transaction/read-back code. `app/service/main.js:709` waits for root and applies the repair. First opening of the app is needed to start the service and obtain root before it can repair its own registration (#49). Manifest entitlement alone and “onboot=true” alone are not persistence tests.

**Do not repeat disproven explanations:** #26 included a speculative firmware-2310/EU-energy/Partner-only explanation. The maintainer explicitly treated it as unverified and identified false registration; the later successful repair is stronger evidence. Likewise [#83's comment](https://github.com/andrearicci93/vetro/issues/83#issuecomment-6556939876) attributes “Checking 6 of 10” to read-only `/etc/systemd/user` and suggests [Couchroot](https://github.com/splitcipher/couchroot) `vconftool` persistence based on a brief source read. Its author labels that lead untested. Local Vetro repairs the package registry, not that directory; #69 has direct evidence of a package-size UI stall. Preserve Couchroot as an unverified research lead, not a diagnosed Vetro boot failure or a ready persistence substitute.

## Platform-specific privileged feature improvements

These are not new root exploits, but matter because they are often misreported as rooting failures.

### 8. Registry schema, runtime host, and capability fingerprint

**Sources:** [#35 schema/runtime comments](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6463516103), [#95](https://github.com/andrearicci93/vetro/issues/95), [#46](https://github.com/andrearicci93/vetro/issues/46), [#88](https://github.com/andrearicci93/vetro/pull/88).

- Tizen 5.x is reported to lack `package_dependency_info`. **Missing locally:** `app/service/app-registry.js:12` queries it unconditionally inside `Promise.all`; `query` throws on failure, so useful inventory can be lost with the dependency table. A fallback should distinguish unavailable dependency data from unavailable app inventory, rather than quietly presenting no dependencies as verified.
- Older app registry/icon layouts need fallback readers (#35); #95's file queue and complete inventory demonstrate there is no inherent reason UID-0 app inventory must be unavailable merely because Node is old.
- .NET availability is more than a version directory inventory: detect actual usable signed host, target runtime, architecture, library path, and filesystem capabilities. #77 explicitly says directory inventory does not prove executability. #35 and #95 need different launcher targets.
- #46 proposes a startup fingerprint (Tizen, firmware family, Home generation, remote nodes), per-platform behavior, risky firmware-specific switches default off, real community fixtures, and PR templates naming on-screen tests. Maintainer accepted the direction for a future launcher release. **Missing as a coherent local capability model.** Current root status, device info, caches and remotes expose pieces independently.
- #88 targets `release-0.4.0`, reads public `http://tizen.org/feature/platform.version`, accepts 2–4 numeric components, prefers that capability over `/etc/tizen-release`, and exports a version source or unknown. It was not hardware-tested. **Partial locally:** `app/service/device-info.js:9` accepts a three-component substring only and reads through the root execution path; `diagnostic-report.js:44` exports a three-part-only version. No widget `platformVersion` is present here. Thus OS identification can be unavailable precisely when root fails.

Recommended fingerprint extension (inference): report service Node, signed host/runtime probes, schema capabilities, boot ID, privilege identity and root backend separately. Never infer OS solely from model year or firmware's `0090` segment. #14 was initially mislabeled 2024 and corrected to a 2022 platform; #70's title says Tizen 6 while its 2022 model is not an exact OS measurement; #87 deliberately leaves the Tizen 10 question open.

### 9. Home cache/layout compatibility already fixed in part

**Sources:** [#20](https://github.com/andrearicci93/vetro/pull/20), [#22](https://github.com/andrearicci93/vetro/issues/22), [#25](https://github.com/andrearicci93/vetro/issues/25), [#43](https://github.com/andrearicci93/vetro/pull/43), [#41](https://github.com/andrearicci93/vetro/issues/41), [#45](https://github.com/andrearicci93/vetro/pull/45), [#73](https://github.com/andrearicci93/vetro/pull/73).

- `csfs/data` → `home.media/data` fallback is **integrated locally** in `app/service/dock-catalog.js:12` and `home-order.js:12`. #20 was closed **unmerged**, superseded by an independent upstream fix released in 0.3.1. Its read-only Q60D test did not originally validate the whole launcher.
- `EOFCOBA` versus `EOFC OBA` parsing/preservation (#45) is **integrated locally** in `home-order.js:18`.
- Physical input entries such as `s/source.layer.hdmi@HDMI3/0` (#73) need dots in the entry type. #73 is **remotely merged, absent locally**: `home-order.js:20` still uses `[A-Za-z0-9_]+`. [The Frame 2024 retest](https://github.com/andrearicci93/vetro/issues/41#issuecomment-6536742345) reports successful read/write with the terminator preserved at `fb1cadc`.
- #43 on QE55S95BATXXC, Tizen 6.5 / T-PTMDEUC family, says the media cache contains only a recent strip; proposes completing with visible registered apps, rejecting stale registry apps absent from package manager, and optional hidden tiles. **Missing locally:** the catalog builds from the row, not a complete registry fallback. The PR remains open/deferred for launcher work; applying only the cache-path fallback does not solve this.
- #82 QN65S95BAFXZC / `T-PTMAKUC-1720.7` has UID-0 root but a launcher state probe failure. #95 independently identifies missing log behavior. The local `tail`-last probe merits a focused compatibility fix; it is not evidence of root loss.

### 10. Model-specific Home processes, key timing, and return-to-Home behavior

**Sources:** [#23](https://github.com/andrearicci93/vetro/pull/23), [#24](https://github.com/andrearicci93/vetro/pull/24), [#30](https://github.com/andrearicci93/vetro/pull/30), [#43](https://github.com/andrearicci93/vetro/pull/43), [#55](https://github.com/andrearicci93/vetro/pull/55), [#92](https://github.com/andrearicci93/vetro/pull/92), [#40](https://github.com/andrearicci93/vetro/issues/40).

| Suggestion | Hardware evidence / limitation | Local status |
| --- | --- | --- |
| #23 close csfs + sidebar + media as a validated list | S95F QE65S95FATXXN, RSM/Tizen 9, `T-RSMFDEUC-0090-REL-202607141953`; short Home previously left Samsung windows on top | Missing; `dock.js:27` has one `HOME_APP`, `:170` passes one guard ID |
| #24 raw navigation, late Home echo suppression, optional still selection | Same S95F; measured compositor delay >140 ms and Home echo ~0.66 s. #46 reports this dock broke Home on an S95B 6.5 | Missing; do not apply universally without capability selection |
| #30 physical Home to FIFO before Samsung handles it | Exact branch tested on S95C Tizen 9; independent S85F GQ55S85FAUXZG / `25_PTM_QD`, Tizen 9.0.0, `T-PTMFDEUC-0090-REL-202607141945` [confirmation](https://github.com/andrearicci93/vetro/pull/30#issuecomment-6535095079) | Missing in current native helper path; requires an already active physical filter and at least one rule; statx/FIFO validation; does not cover SmartThings Home or prove cold-boot restoration |
| #43 close 2022 media/sidebar/art hubs | S95B Tizen 6.5; reported memory recovery ~147 MB and no automatic respawn on that firmware | Missing; a different observation from newer firmware's respawn behavior |
| #55 cancel kill guard before intentionally opening Samsung Home | QN55QN90BAFXZC, Tizen 6.5 / `T-PTMAKUC-REL-202602250225`; stops the guard killing the user's requested Home | Missing; source still creates an unconditional timed shell guard |
| #40 choose the actual visible Home package | Same QN90B family: `csfs` launches/exits without UI; `home.media` visibly works [comment](https://github.com/andrearicci93/vetro/issues/40#issuecomment-6447373248) | Missing; `dock-catalog.js:40` hardcodes `sys:com.samsung.tv.csfs`; filesystem-presence heuristic is tested on one TV only |
| #92 early XF86Home debounce and multi-target Home guard | QA65Q8FAAKXXV, Tizen 9 / `T-RSLFUABC-0090-1300.9`; ~20 ms duplicate event; reported RAM recovery ~178–214 MB | Missing; `dock/src/Program.cs:48` still 0.35 s, `:603` accepts one app. [Latest update](https://github.com/andrearicci93/vetro/pull/92#issuecomment-6561301950) moves logic to `HomeGuard.cs` and includes media as well as sidebar/csfs; explicitly excludes quicklaunch |

#55 and #23 touch the same guard and require reconciliation. #24 was stacked on #23. #92's 0.5 s debounce does not automatically cover #24's later 0.66 s echo; their timing evidence differs. “Additional kills are no-ops on older firmware” does not prove the overall UI behavior is safe on every Home generation.

**Longer respawn window:** [#41's process trace](https://github.com/andrearicci93/vetro/issues/41#issuecomment-6535463812), GQ55LS03DAUXZG / Tizen 8.0 / `T-PTMDDEUC-1400.1`, finds an immediate pooled csfs instance killed again, then a new csfs around +11 s that survives. Proposes +2/+12 s kills or a bounded 20 s observation/guard. Retail dlog was almost empty and `timeout` absent. A three-second guard cannot be assumed to cover this trace; the requester of launchpad startup remains unidentified. This is not the same evidence as “sidebar restarts csfs” in #92.

**Visual validation gaps:** #79's Frame exits Art Mode to a black screen while the launcher process remains healthy; #84's QN90B says running but Home still opens Samsung; #85/#86 report ~40 s before remapping is available and a disappearing launcher. #67 reports repeated old-app launching. These are unresolved UI/input observations with root independently working, not blanket exploit failures.

### 11. Remote device identity and forwarding

**Sources:** [#32](https://github.com/andrearicci93/vetro/pull/32), [#56](https://github.com/andrearicci93/vetro/pull/56), [fork evidence on S90C Tizen 9](https://github.com/andrearicci93/vetro/pull/56#issuecomment-6498036604), [#59](https://github.com/andrearicci93/vetro/pull/59), [#100](https://github.com/andrearicci93/vetro/issues/100).

- #32's saved-node/name/key-capability rediscovery is an upstream merged improvement. Local `app/service/physical-input.js` contains sysfs-based selection; a saved `eventN` must not be treated as permanent identity. The maintainer added a tie-break keeping the saved node only among multiple key-capable matches.
- #56 proposes one helper per selectable physical remote, cross-device duplicate suppression within 300 ms while retaining same-device double presses, independent reconnects, and skipping `sdp-mcirb` only when its map is `rc-empty`. Tested on QN90B, with corroborating IR/Bluetooth observations on S90C Tizen 9. The PR remains open; do not mistake auto-observe helpers for full multi-device filtering.
- #59 uses the real remote's name for uinput forwarding and a Phys marker to exclude Vetro's own virtual device from rediscovery. S90C TQ65S90CATXXC / Tizen 7.0: fixes screen-off dialog/power-on failure. **Missing locally:** `rooting/payload/SamsungTvRemoteInputAgent.cs:93` still names the virtual device `vetro-forwarded-remote`.
- #100: QE65Q67AAUXXH, Tizen 6.0, TV-Store Node 12.4.0. Multi View code 497 remaps to Prime Video successfully but not `com.samsung.tv.coba.setting*`. Maintainer's internal-component/no-visible-screen explanation is explicitly a guess; do not treat it as a root problem or a proven package classification.

### 12. HbbTV and ACR need actual lifecycle/schema evidence

**Sources:** [#35 ACR proposal](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6465955951), [#41](https://github.com/andrearicci93/vetro/issues/41#issuecomment-6414824846), [#50 controlled Q80B test](https://github.com/andrearicci93/vetro/issues/50#issuecomment-6530731659), [#72](https://github.com/andrearicci93/vetro/issues/72), [#74](https://github.com/andrearicci93/vetro/pull/74).

- Tizen 5.0's reported ACR experiment masks `acr.service`, `acr.path` and `org.tizen.acr-service-app.service` at runtime, because `/etc` is read-only and the path unit can restart the service. The contributor asks for an ACR toggle; subjective speed improvement was not measured. Local `quick-wins.js` has telemetry process/unit handling, but no exact `acr.path`/`acr.service` masking implementation found. A runtime mask would need reapplication and restore semantics, separate from existing package disable logic.
- The same older-Tizen report says HbbTV, multiscreen and ambient vconf keys from newer firmware do not exist. Probe key existence/method support and report unsupported instead of equating a missing key with “off.” This is a platform-specific capability request, not evidence that all older root features fail.
- UA85DU7700WXXY / `T-KSU2EDUABC-0090-2130.0`, Node 18.18.2 (#72), has root and a confirmed AC-removal recovery, yet HbbTV comes back. The Frame 2024 (#41) says HbbTV restarts on TV Plus but stays off on HDMI. The Frame 2022 TQ55LS03BGUXXC / `T-PTMDEUC-1720.7` (#50) shows “Done” followed rapidly by “Partly done.”
- Strongest controlled evidence: QE55Q80BATXXC / `22_PONTUSM_QTV`, Tizen 6.5 ARMv7 / `T-PTMDEUC-1720.7`, UID 0. #50's contributor backs up registry rows, changes only HbbTV service `app_autorestart=false`, disables HbbTV, and sees both processes return with new PIDs within five seconds. Parent is launchpad; the source was not recorded; application-manager caching remains possible. A systemd unit being inactive did not mean the app framework process was absent. Values were restored. Simply flipping the registry flag is not a demonstrated fix.
- #74 adds read-only relaunch observation, filtered dlog/proc diagnostics, and honest UI messaging. **Missing locally:** no `app/service/relaunch-watch.js`. It is unmerged and not hardware-tested. Its `timeout` assumption is already contradicted by #41's actual TV, so unavailable handling matters.

### 13. Avoid disabling Home dependencies by catalog/name alone

**Sources:** [#14 catalog gaps](https://github.com/andrearicci93/vetro/issues/14#issuecomment-6388934255), [#44](https://github.com/andrearicci93/vetro/pull/44), [#79](https://github.com/andrearicci93/vetro/issues/79), [#97](https://github.com/andrearicci93/vetro/issues/97).

#14's 2022 S95B (initially misdated) had 101 unmatched packages against the Q80A catalog. #44 classifies `com.samsung.tv.iacr` and `com.samsung.tv.screen-analysis-dbmgr` as ads/tracking; it is remotely merged but **absent from local matching lists** (`app/service/debloat.js`, `app-catalog.js:35`). That classification PR did not hardware-test the effects.

#79's QN43LS03BAFXZA / Tizen 6.5 / `T-PTMAKUC-1720.7` reports native Home ads disappearing only after adding exact host `cdn-stv.adgrx.com` and reversibly moving 110 mapped cached ad images. Effects of blocking and cache removal were not isolated; this is not evidence for deleting all Home data. Personal artwork disappeared during broader testing; causation remained unknown, and restoring components did not recover it. Root and narrow ad filtering success do not validate broad component disabling.

#97's S90D/S90F / `T-RSMFAKUC-0090-1301.0` blank Home report retained working root. A [diagnostic reply](https://github.com/andrearicci93/vetro/issues/97#issuecomment-6561532050) identifies possible loaded plugin dependencies (`coba.privacy_app`, `art-app`, EdenView, Vision AI row) and stale `autorunSwitchedOff` with launcher disabled. It suggests selective restoration and preserving dependency packages. The owner recovered through reset/power procedures **before testing those instructions**, so closure does not confirm any suspect package caused it. **Local partial protection:** `debloat.js:26` protects `coba.adagent`; the newly suspected packages have no equivalent explicit protection here. They warrant read-only dependency evidence before blanket rules.

### 14. Authentication, reboot validation, and diagnostic throughput

These are relevant to exposing a privileged service safely and diagnosing recovery, though not exploit improvements.

- [#5](https://github.com/andrearicci93/vetro/issues/5), [#9](https://github.com/andrearicci93/vetro/pull/9), #28 and #62 request or locally implement LAN API authentication, including `/exec`, scripts, origin/CSRF handling and on-TV pairing. **Missing locally:** no `auth.js`/route-wide pairing in `app/service/main.js`. #9 remains open. Its [formal review](https://github.com/andrearicci93/vetro/pull/9#pullrequestreview-5631052981) requests one live pairing at a time, Origin checks on pairing endpoints, and hostname support. [Contributor follow-up](https://github.com/andrearicci93/vetro/pull/9#issuecomment-6400491301) says all were fixed, plus explicit 20-key limit and save-failure reporting. The old review state remains requested changes; it does not prove these defects persist at PR head. Q60A and Q80A tests used the module/hot-swapped code, not an exact final packaged release. This is separate from root-agent protocol authentication, which already exists locally, and from raw SDB relay access.
- [#6](https://github.com/andrearicci93/vetro/issues/6#issuecomment-6369519160) requests a dedicated confirmed reboot route, comparison of boot IDs, then waiting for root reconnection. `app/scripts/boot-test.py` is cited as existing evidence machinery. A service PID change or a warm standby cycle is not proof of a new boot.
- [#69](https://github.com/andrearicci93/vetro/pull/69) moves blocking package-size measurement from the TV UI to the service and parallelizes checks. Reported hardware: S90C Tizen 7, then [S95C Tizen 9 on release-0.4.0](https://github.com/andrearicci93/vetro/pull/69#issuecomment-6542876490). **Missing locally:** `app/index.html:71` still maps `totalSize` during the packages probe. #68/#83/#94/#101 show a working service can coexist with a very slow step 6. Do not diagnose root or startup-hook failure solely from that screen.
- Early diagnostic comments (#10/#13/#14) identify serialized startup listings exceeding 15 s, CPU sampling queued behind them, and absent Linux thermal zones. Contributors/maintainer describe longer split startup queries and SoC-specific temperature reads as upstream fixes. These improve the reliability of evidence collection; empty diagnostics are not automatically evidence of unsupported hardware.
- Installation suggestions already present locally: automatic `tizen.application.launch('vetrotvapp.svc')` in `app/index.html:27` (#2); DNS-filter fix for Certificate Manager in `INSTALLATION.md:34` (#4); explicit `tizen install`, not `sdb install`, in `:79` (#39); build-time alternate port in `:67` (#16). #61 restores Apps2Samsung's exact port-rewrite phrases and adds tests; it is merged remotely, but exact packaging tests are for the parent's comparison. Do not turn successful public/Partner certificate anecdotes into a universal entitlement guarantee.

## Other suggestions screened

- [#3](https://github.com/andrearicci93/vetro/issues/3#issuecomment-6508657117): a reported S90D TQ83S90DAEXXC / `T-PTMDDEUC-0090-2130.0` Home Assistant microphone prototype. Signed Partner .NET multi-assistant companion plus privileged Bluetooth-HID audio bridge; `libma`, native event loops, ARM32 packet layout, 16 kHz HA transport, PulseAudio playback. Distinguishes registration from audio capture, preserves/restores assistant selection, and needs shared Samsung voice framework enabled. No PC in normal use; device-specific private APIs, no network audit, not a rooting backend. Any blanket voice-service disable feature can break it. No production implementation found in the examined root adapter.
- [#8](https://github.com/andrearicci93/vetro/issues/8#issuecomment-6373150869): Q70A QE55Q70AATXXC / `T-NKM2DEUC-2301.1` LED via `libmicom` P/Invoke, no getter; **later comment confirms two-minute mains-cut persistence**, superseding the original warm-reboot-only limit. The stored factory value stayed 1; it is not a live getter. Not a rooting improvement. Disabling Enlightenment effect module did not remove Home/Settings animations; subjective speed remained after restore, so causation unproven.
- #7 custom Home metadata/icons; #34 independent HDMI artwork/source preferences; #57 editable inputs; #76 custom full-screen launcher/boot target; #80 captions/active-source indicator; #102 dock clock/sysinfo/kill shortcut are launcher work. No additional root chain in their descriptions/discussions. #57/#80 have S95C Tizen 9 feedback; #80 notes stale last-input indicator while an app is foreground. #102's body is only a truncated title fragment, limiting its research value.
- #31 direct TV tuner key and #32 input rediscovery are merged upstream; native key availability remains firmware-dependent. #53/#48 request input selection/remapper UI features. #64 brightness/picture/color values and #81 DTS/TrueHD are feature leads without a new root method. #100's Settings launch issue remains a guess pending evidence.
- [Rootless Home remapping lead in #35](https://github.com/andrearicci93/vetro/issues/35#issuecomment-6512070515) and [#98](https://github.com/andrearicci93/vetro/issues/98#issuecomment-6564072549): UE55RU7172UXXH / Tizen 5.0 / `T-MSLDEUC-1500.9` reportedly redirects FirstScreen `XF86Home` app-context through a signed native manifest. [External reference](https://github.com/chutovkatest/samsung-tizen-home-remap). Hardware route and public generic sample are distinguished; sample unvalidated, persistence unproven. **Does not connect Vetro root agent.** Same-firmware UE55RU7025KXXC (#98) remains root-disconnected; firmware match is not cross-model validation.
- #93 UA50AU7000UXTW / `T-KSU2EUABC-2310.0` is a compatibility question. “Other Tizen 6 TVs worked” is explicitly a theory, not a test result for that model.

## Compatibility evidence inventory

This inventory prevents successful snapshots from being lost while keeping them distinct from implementation proposals. “Root” below means reported connected UID 0 in narrative/export summary, not independent verification of the exploit or every control.

| Reports | Exact identity / firmware | Useful boundary |
| --- | --- | --- |
| [#1](https://github.com/andrearicci93/vetro/issues/1) | QE50Q80AATXZT / `T-NKM2DEUC-2301.1` | Disposable diagnostic-workflow test, not independent compatibility evidence |
| [#4](https://github.com/andrearicci93/vetro/issues/4), [#8](https://github.com/andrearicci93/vetro/issues/8) | QN85A GQ65QN85AATXZG and Q70A QE55Q70AATXXC / `T-NKM2DEUC-2301.1` | Root; boot-registration and LED evidence described above |
| [#10](https://github.com/andrearicci93/vetro/issues/10) | QN55Q65DAGXZS / `T-NKLDUABC-0090-2123.9` | Root summary, Node 18.18.2; unsigned build installed via Apps2Samsung; no unplug test originally |
| [#12](https://github.com/andrearicci93/vetro/issues/12) | QE85Q70BATXXH / `T-PTMDEUC-1720.7` | Root disconnected; installation explanation incomplete then; no later success established |
| [#13](https://github.com/andrearicci93/vetro/issues/13), [#101](https://github.com/andrearicci93/vetro/issues/101) | Q65S95C / `T-PTMCDEUC-0090-2220.4`; QA65S95CAWXXY / `T-PTMCUABC-0090-2220.4` | Root summaries; missing model/firmware in exports; step-6 latency and launcher caveats |
| [#14](https://github.com/andrearicci93/vetro/issues/14), [#82](https://github.com/andrearicci93/vetro/issues/82) | QN55S95BAFXZA and QN65S95BAFXZC / `T-PTMAKUC-1720.7`, Tizen 6.5 | Root does not establish launcher readiness; first report's year corrected to 2022 |
| [#15](https://github.com/andrearicci93/vetro/issues/15) | LS32BM801UNXGO Smart Monitor M8 / summary `T-PTMWWC-1720.7` | Later owner reports root/debloat/remapper and cold reboot; regular-TV Home assumptions may differ |
| [#17](https://github.com/andrearicci93/vetro/issues/17) | GU75CU7179UXZG / later `T-KSU2ECDEUC-0090-2230.0`, Tizen 9 reported | Root, later launcher/remapper and recovery; `23_KSUE_UB_T09` is platform code, not firmware |
| [#22](https://github.com/andrearicci93/vetro/issues/22), [#25](https://github.com/andrearicci93/vetro/issues/25), [#26](https://github.com/andrearicci93/vetro/issues/26), [#28](https://github.com/andrearicci93/vetro/issues/28) | UE65BU8002KXXH `T-KSU2EBDEUC-1720.7`; QE75QN85BATXXU `1720.7`; QE55QN93AATXXC `T-NKM2DEUC-2310.0`; QN70Q60AAVXZC `T-NKLAAKUC-2310.0` | Root; boot/cache/install refinements, not independent alternate root chains |
| [#36](https://github.com/andrearicci93/vetro/issues/36) | QA65S90DAULXL / `T-PTMDUABC-0090-2130.0` | Root after full restart; initial prose abbreviated firmware |
| [#39](https://github.com/andrearicci93/vetro/issues/39), [#50](https://github.com/andrearicci93/vetro/issues/50), [#79](https://github.com/andrearicci93/vetro/issues/79) | QN75LS03BAFXZA / `T-PTMAKUC-1720.7`; TQ55LS03BGUXXC / `T-PTMDEUC-1720.7`; QN43LS03BAFXZA / `T-PTMAKUC-1720.7` | Root across Frame sizes/regions; launcher/Art/HbbTV behavior still differs |
| [#41](https://github.com/andrearicci93/vetro/issues/41) | GQ55LS03DAUXZG / `T-PTMDDEUC-1400.1`, Tizen 8.0 | Root, exact cache formats and +11 s Home respawn trace |
| [#51](https://github.com/andrearicci93/vetro/issues/51) | UN50DU8000FXZA / `T-NKLDAKUC-0090-2123.9` | Root diagnostic summary; empty narrative is weaker than a feature test |
| [#58](https://github.com/andrearicci93/vetro/issues/58) | QE65QN800BTXXC / `T-OSCPBDEUC-1720.7`, `22_OSCARP_8K` | Root, reported unplug recovery, launcher/remapper/MQTT; custom port 9199 |
| [#60](https://github.com/andrearicci93/vetro/issues/60), [#62](https://github.com/andrearicci93/vetro/issues/62) | UE55AU9000KXXU `T-NKLADEUC-2310.0`; QN60Q6DAAFXZA `T-NKLAAKUC-2310.0` | Setup/Host-IP problem resolved; [#62](https://github.com/andrearicci93/vetro/issues/62) modified auth build, no cold-boot claim |
| [#63](https://github.com/andrearicci93/vetro/issues/63), [#85](https://github.com/andrearicci93/vetro/issues/85), [#97](https://github.com/andrearicci93/vetro/issues/97) | S90F RSM / `T-RSMFAKUC-0090-1301.0` | Root and cold boot reported in [#63](https://github.com/andrearicci93/vetro/issues/63); launcher latency/blank-Home reports show feature independence |
| [#66](https://github.com/andrearicci93/vetro/issues/66) | QN85QN900DFXZA / `T-RSPDAKUC-0090-2123.9`, `24_RSP_8K_T09` | Working title and sparse narrative; avoid inferring unlisted feature tests |
| [#68](https://github.com/andrearicci93/vetro/issues/68) | UN65DU6900FXZA / `T-KSU2EDAKUC-0090-2130.0`, Tizen 9 reported | Root/launcher, `vd_appinstall` workaround; repeated cold boot explicitly unverified |
| [#70](https://github.com/andrearicci93/vetro/issues/70) | QA75QN85BAWXXY / `T-PTMUABC-1720.7`, `22_PONTUSM_QTV` | Integration installed over app-only; root, launcher, multiple reboots reported |
| [#71](https://github.com/andrearicci93/vetro/issues/71) | QA55LS03RAWXXY / `T-MSMUABC-1501.1`, `19_MUSEM_FRAME` | App-only running; root not attempted |
| [#72](https://github.com/andrearicci93/vetro/issues/72) | UA85DU7700WXXY / `T-KSU2EDUABC-0090-2130.0` | Root/cold boot; renamed package installation succeeded; HbbTV relaunch unresolved |
| [#84](https://github.com/andrearicci93/vetro/issues/84) | QN75QN90BAFXZA / `T-PTMAKUC-1720.7` | Root survives two-minute unplug; launcher running but Home not intercepted |
| [#86](https://github.com/andrearicci93/vetro/issues/86), [#87](https://github.com/andrearicci93/vetro/issues/87) | QN55S90DAFXZA `T-PTMDAKUC-0090-2130.0`; QE65S95DATXXN `T-PTMDDEUC-0090-2130.0` | Root; launcher caveats; no verified Tizen 10 measurement in [#87](https://github.com/andrearicci93/vetro/issues/87) |
| [#89](https://github.com/andrearicci93/vetro/issues/89), [#90](https://github.com/andrearicci93/vetro/issues/90), [#94](https://github.com/andrearicci93/vetro/issues/94) | TQ50Q80CATXXC `T-PTMCDEUC-0090-2220.4`; QE65QN80FAUXXH `T-PTMFDEUC-0090-1301.0`; GU43CU8079UXZG `T-X22UDCDEUC-0090-2220.4` | Root summaries; [#89](https://github.com/andrearicci93/vetro/issues/89) ads inventory UI stalls; [#94](https://github.com/andrearicci93/vetro/issues/94) no Ambient app and slow probe |
| [#91](https://github.com/andrearicci93/vetro/issues/91), [#98](https://github.com/andrearicci93/vetro/issues/98) | UA55M70HAULXL / firmware unknown, Tizen 10 reported; UE55RU7025KXXC / `T-MSLDEUC-1500.9` | Root not obtained; different generations and failure evidence |
| [#35](https://github.com/andrearicci93/vetro/issues/35), [#95](https://github.com/andrearicci93/vetro/issues/95) | Q80R `T-MSMAKUC-1500.5`; TU7000 `T-KTSU2DEUC-2743.0` | Working custom ports only, with different initial root/persistence/runtime designs |

## Prioritized follow-up for the parent

1. **Reconcile remotely merged #75 with this branch**, preserving relay code while taking the packaged Node 4 compatibility and unsupported-runtime behavior. Also check #73 and #44 independently; their merge status does not imply local presence.
2. **Design backend/capability reporting before a universal version switch.** Separate service startup, privilege bootstrap, authenticated transport, post-bootstrap recovery, boot persistence, and launcher runtime capabilities. #46/#88/#77 supply the clearest diagnostic requirements.
3. **Evaluate #99 as post-bootstrap privileged supervision**, correcting its token-deletion explanation and demanding a true cold-boot story. Keep it distinct from #91's never-bootstrapped Tizen 10 failure.
4. **Request/review reusable source for #95 and #35's alternative channels** as separate backend proposals. The strongest older-TV work is currently local and firmware-specific, with no ready generic installer in these issues.
5. **Keep #78's relay contribution scoped honestly.** It improves PC coexistence only where loopback sdbd works. Its access controls and release status are separate from the HTTP API's authentication and from exploit compatibility.
6. **Take bounded, diagnostic-led lifecycle fixes.** Old schema fallback, missing-log probe tolerance, runtime host detection, and truthful unsupported states have clearer reusable evidence than broad firmware writes or indefinite kill loops.
7. **Preserve hardware distinctions in any compatibility table.** Record exact firmware family/version, reported OS source, Node/.NET host, build SHA/dirty state, backend, UID/SMACK evidence, actual boot-ID/AC-removal checks, and on-screen launcher results separately. Unknown fields should remain unknown.

## Complete discovery index

All numbered records 1–102 were included in the issue/PR enumeration. Root/backend and tightly related compatibility records are analyzed above. Remaining records were screened to avoid overlooking comments on generic titles:

- Core root/service/setup: **#2, #4, #5, #6, #9, #11, #12, #16, #19, #25, #26, #29, #33, #35, #38, #39, #42, #47, #48, #49, #54, #60, #61, #65, #71, #75, #77, #78, #83, #88, #91, #93, #95, #96, #98, #99**.
- Home/runtime/input/privileged-feature compatibility and their suggestions: **#3, #7, #8, #14, #20, #22, #23, #24, #30, #31, #32, #34, #37, #40, #41, #43, #44, #45, #46, #50, #53, #55, #56, #57, #59, #64, #67, #69, #72, #73, #74, #76, #79, #80, #81, #82, #84, #85, #86, #87, #89, #92, #94, #97, #100, #101, #102**.
- Additional compatibility snapshots/cold-boot confirmations: **#1, #10, #13, #15, #17, #27, #28, #36, #51, #58, #62, #63, #66, #68, #70, #90**.
- **#18** is an empty-body/empty-comment closed record. **#21** is attribution/credits. **#52** is the app-picker app-ID display fix. Their screening found no additional rooting method.

The only formal review with technical objections is #9, incorporated above; #47's approval has no body. There were no hidden resolved inline discussions to recover in this snapshot. Deleted, private, edited-away, or future content cannot be covered by these API results.
