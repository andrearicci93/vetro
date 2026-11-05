# Vetro 0.5.0: Security, Plugin and Launcher update

Working plan for the release. It says what is in, how far each part is checked, and what is still to do. It is
not a promise: anything marked *not tried on a TV* has only run in the test suite or on a test server.

There was no 0.4.0 release: it was preliminary work and is part of this one. Themes:

1. **Plugins, and the launcher as a plugin:** add-ons written by other people, and a launcher others can build or customise ([PLUGIN-ARCHITECTURE.md](PLUGIN-ARCHITECTURE.md)).
2. **Update from inside Vetro:** signed, with rollback ([UPDATING.md](UPDATING.md)).
3. **Better UI:** dashboard from plugin data and shared design tokens (scope to be fixed).
4. **Sign-in:** the dashboard and API answer only paired devices.
5. **Ads and privacy:** stop more of what the TV sends out.
6. **Important hotfixes** from `main`, merged.

## Consolidation — 2026-11-03

The local release work and the remote Linux CI fixes are integrated, together with PRs #88, #106, #107,
#108 and #109. This includes Restore the TV / Remove Vetro, Disable Samsung Home, performance work,
rooting diagnostics and compatibility fallbacks, the TV screen progress and root guidance, model and
Tizen version diagnostics, missing launcher log handling, app-list Retry, non-launchable Settings
components and the optional Home ad-picture host. No TV installation or device test is claimed by this consolidation.

The source is a test candidate, not a published release. The public release is still 0.3.5.

Local consolidation checks pass: 81 application suites, 11 integration suites, 19 diagnostic-parser tests,
release hygiene/architecture audit and `git diff --check`. Hosted CI on the consolidated head is separate.

## Launcher follow-up — #23 / #24

The input and CoBA Home changes are now integrated as part of the bundled launcher plugin (version 1.1.0).
Still selection is dispatched through that plugin, including the legacy `/dock` alias. The native program
is rebuilt with raw navigation and compositor-echo handling, optional instant selection, generation checks
for every guarded Home process, cancellation when Samsung Home is selected, CoBA command-line fallback,
and app/source launch after the fade-out. This is still distributed and updated with Vetro; independent
launcher updates from the plugin list are not implemented.

The rebuilt launcher passes 5,075 desktop checks, including real-shell tests of cancellation between
Home targets and the CoBA fallback. These are local checks, not hardware validation.

For tonight's launcher checks, start with Still selection **off**, then repeat with it **on**. Try single,
rapid and held navigation keys, OK/Back, short and long Home, a second real Home press, Samsung Home
selected immediately after Home and after 1–2 seconds, app launch, Settings and Source. Repeat with remote
interception on and off, after closing/reopening the launcher and after a cold boot. Check for skipped or
double navigation, unintended Home closing and a frozen exit animation. Timing gains reported by the PR
author on an S95F are not measurements of this integrated build on the Q80A.

## Q80A test session — 2026-11-03

Installed candidate: `0e633e16be8cad3e429dabc2dd683f20594d1eda` (Vetro 0.5.0, bundled launcher 1.1.0).
The signed in-place installation was checked against all 89 candidate payload file hashes, and the
launcher process was restarted to load the rebuilt DLL. Launcher choices, input preference, remap
rules and DNS configuration matched the pre-install snapshot.

Owner-reported results:

- Still selection works; the owner considers it of limited use. Normal movement, Home and Back work.
- Samsung Home opens in about 4–5 seconds; app launching works.
- Persistence, plugin operation and pairing passed the owner's tests. No separate boot-id/timing trace
  was captured here; detailed negative-pairing and plugin lifecycle cases are not individually recorded.
- Country switch needs a VPN for the intended service-country behaviour on this setup. Treat this as
  the owner's observed result, not proof that changing the value bypasses Samsung's regional checks.
- The public `tv-uptime` 1.0.1 catalog entry and package are available after vetro-plugins PR #1
  (merge `095d5ce`). The public bundle SHA-256 was verified; updating it on the TV remains to test.
- Restore the TV and deleting Vetro's saved data are explicitly deferred by the owner; do not run them.
- Signed self-update and rollback remain to test and need a build with the update public key configured.

The owner-provided diagnostic export identifies a QE50Q80AATXZT, firmware T-NKM2DEUC-2310.0,
Tizen 6.0, service Node v12.4.0 and the expected source revision. All 17 sections are `ok`; the
root agent is connected with UID 0, rooting phase is `connected` with no failure, and the launcher
is running with zero failures and no error. The widget completed all nine reported steps in about
4 seconds, with no slow steps. Its probe was about 19 minutes old at export time. The method probe
confirmed 29 controls; exporting this does not test writing them.

`sourceDirty: true` reflects the three untracked research notes present at package-build time;
those notes were excluded and the installed payload hashes matched the candidate. The component
section reports registered boot/restart flags enabled for `vetrotvapp.svc`, differing from the manifest
values it read. Keep that distinction when interpreting the export. Its own persistence fields remain
`unknown`, as expected for a single snapshot; the separate owner report supplies the persistence result.
Raw diagnostics and pairing credentials are kept outside tracked source.

## Settings and preview follow-up

The current UI opens Quick settings on General; Software update has moved there
from Diagnostic report, alongside cleanup, firmware updates and restore/removal.
Pairing and SDB controls are in the final Developer settings tab. Samsung Home
changes are locked while Vetro's launcher is enabled, including the backend paths.
Plugins now links to its repository/guide and separates the catalog, installed
plugins and file-install instructions. The confusing Task manager role label was
removed; commercial components remain in their area.

Still selection is now called Reduce motion and also disables native show/hide,
cascade and page transitions. The compatibility fields remain `noMotion` and
`--no-motion`. The launcher DLL was rebuilt and passes 5,124 desktop checks. Local
preview Settings/Samsung Home pills work without a TV catalog. These changes have
not been installed on a TV; earlier candidate observations below remain historical.

## Hardening after the candidate — 2026-11-04

See [HARDENING-0.5.0.md](HARDENING-0.5.0.md) for corrections, regression coverage,
PR attribution and release gates. The SDB tunnel now admits only loopback clients by default;
LAN access requires the persistent switch in Quick settings → Maintenance → Developer access. The earlier
LAN tunnel checks below refer to the previous installed candidate, not this default.
Unsigned plugin installs now require Developer mode even without a catalog key.

## Q80A SDB tunnel validation — 2026-11-03

Installed and verified candidate: `55cbb9fd001ac854ebe92eed68c1bf08238b49c2`.
All 90 installed payload hashes match the signed package. The service, root agent (UID 0) and
multiplexed tunnel on port 26201 are online; Developer Mode Host PC IP remains `127.0.0.1`.
Dock, input, DNS, remap and plugin configuration match their pre-install snapshots.

The real SDK exposed two transfer failures: the initial decoder rejected file-sync envelopes larger
than 4096 bytes, and accepting those envelopes alone still failed at the TV's SDB daemon. The tunnel
now splits client writes into 4096-byte upstream fragments and returns one client acknowledgement
only after all fragments have been acknowledged. A strict upstream fixture verifies this behaviour,
binary contents and acknowledgement count. All 12 integration suites pass.

Actual-TV verification with Samsung's SDK passed all 12 checks: capability and installed-app queries,
SHA-256 checked push/pull at 0, 1, 4095, 4096, 4097, 262144 and 4194304 bytes, three concurrent
roughly 1 MiB round trips alongside capability/app-list queries, root availability and ten reconnect
cycles. Sampled service/root availability stayed healthy. A separate TCP forwarding test reached
Vetro HTTP through a temporary SDK forwarding rule, which was then removed.

The original Apps2Samsung desktop beta attempted direct port 26101 and failed to read installed apps
with “Remote closed stream while reading”. Updating from the official `v3.2.0-beta` macOS arm64 DMG
asset dated 2026-11-03 resolved this. The actual desktop interface now lists 16 apps including
**Vetro v0.5.0**, in addition to successful standalone Core-engine checks. The DMG SHA-256 matched
the release asset digest: `ea8e04195859d9a20ba3c95676068d2d1eaf34e29a3cd670340411bc824c3cbc`.
The previous desktop bundle was retained locally for rollback.

These checks did not launch a foreground TV app, install a test app through SDB, exercise reverse
forwarding or reboot the TV. They do not establish those behaviours or replace the deferred restore,
data-erasure and signed self-updater tests. Raw app lists, credentials, signed packages and detailed
operational artifacts remain outside tracked source.

## State

| Part | In the branch | Checked | Still to check |
| --- | --- | --- | --- |
| Plugin host, install, update, remove, safe mode | yes | host, install, signature and bundled-launcher fixtures | full cycle on the TV, including a reboot |
| Plugin pages under sign-in | yes | session/routing fixtures; owner reports plugin works on TV | update and detailed lifecycle cases |
| Plugin list and signing | public repository exists: `andrearicci93/vetro-plugins`, with `tv-uptime` | [first signed publication passed](https://github.com/andrearicci93/vetro-plugins/actions/runs/42027804668); live signature/hash and real PluginHost lifecycle verified locally and on Node 4.4.7 | public key configured and catalog PR #2 merged; test installation without Developer mode and full lifecycle on TV |
| Sign-in (PR #9, zerodevb) | yes | fixtures, live script pairing and owner-reported pairing pass on this Q80A | negative and expiry cases not individually recorded |
| Signed updates and rollback | yes | fixtures; earlier Q80A update and deliberately broken-update rollback with a test key | dashboard download/apply and reboot after swap with the release key, which is now configured (`update-key.js`); the private half is offline |
| Restore the TV / Remove Vetro; Disable Samsung Home | yes | restore, Quick settings and UI fixtures | read-only restore plan and reversible actions on a TV; data erasure only after other tests |
| TV screen and diagnostic fixes (#88, #106, #107, #108, #109) | yes | dedicated app, shell and parser fixtures | progress, root guidance, model/Tizen version, launcher status and app-list behaviour on the TV |
| Viewing-data stop, Stop Ambient, domain filter, ad list | yes | earlier Q80A restart checks (see CHANGELOG) | consolidated package and other models |
| Tizen 4 / Node 4.4 | syntax checks and fallbacks included | integration fixtures, including packaged ES5 syntax | real hardware; unsupported root remains app-only, not a claim that the root agent works on Node 4.4 |

## TV test session

Record the package SHA-256 and source revision, TV model, firmware, Tizen version and actual results.
Keep raw diagnostic exports and tokens outside the repository. An unchecked item is not a pass.
The complete unsigned integration WGT is for an installer that supplies signing, such as Apps2Samsung;
`vetro-app-only.wgt` does not contain the TV root integration.

1. **Baseline.** Export diagnostics from the current installation and note launcher, remaps, Quick settings,
   DNS and boot/restart choices before installing. Keep the previously working WGT available.
2. **Install and first launch.** Install the consolidated integration package. If the installer needs a PC
   connection, restore Host PC IP to `127.0.0.1` afterwards. Check the TV screen's steps and elapsed time,
   service availability and authenticated UID-0 agent. Confirm version `0.5.0` and the expected source revision.
3. **Pairing.** Use an unpaired/private browser: API requests must get 401. Request a code, check it appears
   on the TV, try a wrong code then the right one; in a separate attempt let it expire. Reload a pending
   pairing. Confirm the paired browser works and a second unpaired browser still gets 401. Pair scripts
   separately following [SIGN-IN.md](SIGN-IN.md); keep `VETRO_TOKEN` private.
4. **Diagnostics and dashboard.** Export a new report: check model, firmware, Tizen version and their sources,
   root state and probe progress. Read launcher status before its first log exists. Confirm Settings components
   are absent from Remapper targets. If an app-list read fails or stalls, check the reason and Retry.
5. **Launcher and plugin cycle.** Check Home, Samsung Home, Back, Settings, Source and launching an app.
   Check Remapper and saved interception. Install `tv-uptime`, enable it, open its page, restart the service,
   then disable/remove it. Use the example/scaffolder for a local plugin update cycle. This build's unsigned
   catalog does not establish signature enforcement. Keep Disable Samsung Home for a separate reversible
   test with another launcher and a Home mapping already working.
6. **Restart and cold boot.** Close the foreground app: service and root agent must keep running. Power-cycle
   the TV and wait without opening Vetro from the TV or PC. Check root recovery, pairing, launcher/plugins,
   saved remaps and settings; record whether plugin safe mode triggered. Run [boot-test.py](BOOT-TEST.md)
   with `VETRO_TOKEN` to capture startup timing and evidence of a changed boot.
7. **Restore.** First review the read-only Restore the TV plan and its limitations. After the persistence tests,
   exercise Restore on the intended test configuration, inspect each result and verify the state on the TV.
   Remove saved data only as a final, deliberate cleanup: it deletes pairing, plugins and restore records.
8. **Updater.** The package carries the release public key and accepts only bundles signed with the matching
   private key (`VETRO_UPDATE_KEY=<update-private.pem> node rooting/release.cjs build <folder>`). Install the
   candidate built from the final revision, then exercise a signed update, a tampered bundle (must be refused),
   a second apply while the first is pending (must be refused, #116) and a deliberately broken update with its
   rollback. Follow [UPDATING.md](UPDATING.md). Do not count the earlier Q80A result, made with a test key, as
   validation of this package.

## Before publication

- Complete and record the TV session above, including a cold boot.
- Configure the update public key; the separately signed Shards catalog is published and its public key is configured. Retain private keys outside Git.
- Re-run the complete CI checks on the final source and build the final package from that revision.
- Resolve remaining overlapping PR scope and update release notes. README now credits zerodevb, Firaenix and Merennor for the included work.

## Ads and privacy: what exists, what could go further

Exists in 0.5.0: stop viewing-data collection (ten services, with the brake files that survive a restart and a boot step for the others), Stop Ambient, the domain filter with the firmware's hosts and the reported ACR names, the Observe requests view, the ad and tracking categories of the Debloater, and the diagnostic export that shows what starts at boot.

A scan of the strings in the Q80A firmware (all `*.samsung*` host names in programs and apps, about 190 names) found **one advertising host that the list lacked, now added** (`rtb-config-canary.samsungads.com`, named by the ad agent itself), and **no viewing-data host** beyond the ones already listed. What it found that is not on the list, and what is known about it:

| Host (all unverified: no traffic seen) | Where | Decision |
| --- | --- | --- |
| `rtb-config-canary.samsungads.com` | ad agent, ad framework, Samsung TV Plus | **added to the Advertising group** |
| `osb-v2.samsungqbe.com`, `osb-apps.samsungqbe.com`, `gpms.samsungqbe.com`, `pubsub.scs.samsungqbe.com` | QBE services | not added: the list has `osb`, `rm`, `scs`, `gpm`; these look like the next API generation, which nothing proves |
| `netdiag-v2.samsungcloudsolution.com` | network diagnostics | not added: purpose inferred from the name |
| `rscmapi.samsungcloud.tv`, `dpiapi-2w.samsungcloud.tv`, `tvpnlogoseu.samsungcloud.tv` | Samsung TV Plus and platform | not added: the third is channel logos, blocking it breaks pictures, not privacy |
| `rmus/rmeu/rmch.samsungcsportal.com` | remote management portals | not added: support, not telemetry |
| `api.samsungconsent.com`, `policy.samsungrs.com` | consent (the second is stored in the consent database) | not added: blocking could break the consent screens |
| `oempprd.samsungcloudsolution.com` | list of accessory firmware images (camera, smart control), downloaded over plain HTTP | not added: it is firmware download for accessories, not telemetry; blocking it stops their updates |
| `sas.samsungqbe.cn`, `sas.samsungcloudsolution.com/.net` | software update | already discussed in DOMAIN-FILTER.md: a decision for the owner |

The scan reads strings only: a name built at run time, or served by a control server (the ACR service does that), is not in it. Staging and development names are left out.

Candidate work, in the order of value over risk. Each needs a test on a TV before it is written down as done:

1. **Observe, then list.** Use Observe requests on the Q80A for a day and add the hosts that were really asked for, with `evidence: observed`. This replaces guesses with traffic and is the safest way to strengthen the list.
2. **Consent switches.** About 45 programs read the Smart Hub consent values (`db/menu/smart_hub/homedatacontrol/defaultdisclaimeragree`, `db/homedatacontrol/disclaimeragrees`). Turning them off is Samsung's own mechanism, reversible, and survives restarts. Not tried; the effect on features that need the consent is unknown.
3. **The other services.** `homedatacontrol-service` (consent and home usage logs), `connman-logger`, and the Samsung Health / voice / presence units found by name (`farfieldvoice`, `aov-service`, `wifi-presence`, `abnormal_user_behavior`, `issue_report_agent`, `slive-provider-daemon`) have not been analysed. Do not stop one without reading what it does first; `data-provider-master` is a Tizen platform service and stays.
4. **Make the domain filter harder to bypass:** it matches exact names and the hosts file is only honoured by programs that use the system resolver. A program with a built-in resolver or a fixed address ignores it. Check which of the stopped services do that before promising more.
5. **Show the result.** A single view in Quick settings that says what is stopped and what still talks (running services, hosts asked for in the last hour) would make the privacy claims checkable by the user.

Not planned: Netflix (investigated, no durable switch, see CHANGELOG notes), anything that needs a firmware change.

## Other pull requests and scope

The five PRs consolidated here target `release-0.5.0`: #88 (Tizen version), #106 (screen progress and model),
#107 (root guidance), #108 (launcher status), #109 (dashboard fixes). #23 and #24 are integrated
with the launcher adaptations documented above. #105 (Linux CI fixes) was already
on the remote release branch. #75 (Tizen 4 startup) is also already integrated.

#9's pairing implementation is integrated, but its PR remains open against `main`; close it when the
release reaches `main`, and credit zerodevb. #69 (TV screen redesign fixes), #74 (relaunch diagnostics)
and the remaining launcher/remote PRs have not been included by this consolidation. Assess their overlap
separately rather than treating them as requirements for tonight's test candidate.
