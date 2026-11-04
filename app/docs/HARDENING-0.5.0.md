# Vetro 0.5.0 hardening — 2026-11-04

Reviewed checkout: `87ddaa6` plus the local hardening changes. This is a source and
fixture audit, not a claim that every firmware or interaction is bug-free. No TV
commands, package installs, settings changes, pushes or publication were performed.
The three pre-existing untracked rooting review documents were left untouched.

## Corrected behaviour

| Trigger | Problem | Correction and regression |
| --- | --- | --- |
| Erase after an unreadable restore source | Backups could be deleted while changes were unknown | Unknown items block erase; unknown or manual final readback cannot report complete. `restore.test.cjs` |
| Unreadable disabled-component ledger or individual Quick win | Plan could mark a source clean | Preserve unknown; refuse data removal. `restore.test.cjs` |
| Launcher off, Autorun Smart Hub still awaiting restoration | Plan skipped the remaining original-value record | Include `autorunWas` in the plan. `restore.test.cjs` |
| Undo telemetry suppression during its 45 s boot wait | Delayed pass stopped the collectors again | Recheck saved choice and mutation lock before enforcement and boot completion. `quick-wins.test.cjs` |
| Undo Ambient suppression during boot polling | Poll could kill the newly restored app | Recheck before polling and before the stop. `quick-wins.test.cjs` |
| Synchronous settings-storage exception | Quick wins stayed busy and the HTTP callback could throw | Execute the operation inside its promise chain; always release busy. `quick-wins.test.cjs` |
| Component enabled through another view after Quick settings disabled it | Re-enabling the group skipped saved startup flags | Restore flags for all enabled members, including already-enabled ones. `quick-settings.test.cjs` |
| Registry read already pending when a mutation completes | Readback joined a pre-mutation read and could cache it | Invalidation increments a generation; later callers share a new read. Probe changes also invalidate. `inventory-concurrency.test.cjs` |
| Several forced process reads while another sample runs | Every caller scheduled another serialized command | Share one trailing fresh sample. A subsequent force after that sample starts still schedules a newer read. `monitor-scopes.test.cjs` |
| Post-action UI refresh | App list unnecessarily preceded process read; waiting did not guarantee expiry of the process cache | Request `/monitor?refresh=1` alongside the app list; test forced-route handling and exact query matching. |
| Plugin key absent | Developer mode off did not prevent unsigned installation | Require Developer mode for every unsigned install; show the switch and matching file/list restrictions even with no key. `plugin-signature.test.cjs`, `dashboard-states.test.cjs` |
| Integration service started | Raw SDB listened on all interfaces outside HTTP pairing | Admit only loopback by default; a paired user enables the persistent Developer access switch. Off drops remote clients and preserves local streams. Restore also disables it. Admission and persistence regressions supplement the existing protocol fixtures. |
| WGT distribution | Repository notices did not travel with the binaries | Both builders include MIT, third-party and full Phosphor notices; integration also carries the upstream root-research notice. Byte-for-byte packaging assertions. |

Removed the unused `openPluginPage` function, the constant-false plugin installation
lock and the unused `self` binding in restore planning. No speculative removal of
compatibility fallbacks, native entry points or modules dynamically required by plugins.

## Feature and hot-path review

| Feature | Paths and constraints reviewed |
| --- | --- |
| Sign-in and TV probe | Pairing/session/origin boundaries; TV-only probe acceptance; expiry and negative fixtures. PR #9 behaviour remains covered. |
| Resource monitor and diagnostics | Separate summary/full deltas, cache invalidation, fresh post-action reads, export sharing and timeout/redaction. The diagnostic CPU second-sample reservation remains ordered ahead of slow startup inventory. |
| App inventory / Task manager | Registry/probe merge, disable-enable rollback, stop readback, package-sibling uninstall protection, invalidation after mutations. |
| Quick settings / maintenance | Overlapping groups, disabled versus running states, startup flag capture/restore, reversible service choices, restore and erase gates. |
| HbbTV / privacy / TV controls | Original-value capture, stale expected values, readback/rollback and unknown-state fixtures retained. No new writable firmware controls. |
| Home order / launcher | Home cache directory variants and transactional restore; bundled-plugin route aliases, autorun restoration, CoBA guard cancellation, raw-key echo suppression and still selection. Native suite run without changing the DLL. |
| Remapper / physical input | Persistent off/on, temporary observation, reconnect and renumbering fixtures; action ordering and bounded queues retained. |
| MQTT / Home Assistant | Configuration, connect/disconnect/retry, discovery/availability and stale TV-state cleanup fixtures. No live broker validation in this audit. |
| Local domain filter / leftovers | Essential-domain exclusions, namespace state, observe limits, closed-app cache restrictions and installer-cleanup fixtures. |
| Plugin host / install / pages | Trust, lifecycle, bundled launcher protection, safe mode and scoped page sessions; unsigned-install bypass corrected. |
| Updater | Signed manifest/path/hash refusal, stage verification, confirm/watchdog/manual rollback and launcher restart fixtures. No release key generated. |
| Root adapter / SDB / packaging | Node 4 parsing/fallback, authenticated helper lifecycle, SDB multiplexed transfers/reconnect/close, source/package boundary and notice inclusion. |

All app service modules and rooting service promise-chain sites were indexed for the
async review. Runtime service code uses ES5 promise chains, not `async`/`await`, to
support Node 4.4. Independent HbbTV, telemetry and Ambient boot jobs now start together.
Post-action app and process refreshes also overlap. Forced sample fan-out is bounded
to one additional command per concurrent waiting group. These are scheduling and
command-count improvements verified by fixtures, not measured TV latency claims.

The following sequential chains are intentional: write/readback/rollback; ordered
remap macros; Home guard cancellation before launch; catalog generation before
launcher start; update staging/swap/confirmation; authentication handshakes and SDB
write acknowledgements. The TV root command queue remains serial with a 32-command
limit: blindly applying `Promise.all` there would not parallelize the helper.

## Incorporated PRs, issues and attribution

GitHub PR metadata/descriptions were retrieved read-only through `gh` (the connected
GitHub search tool returned “Unknown tool”). Compared against repository history,
release scope, current implementation and the corresponding fixtures:

- [#9](https://github.com/andrearicci93/vetro/pull/9), zerodevb: pairing for dashboard/API,
  including `/exec`, browser origin checks and hashed tokens. Included despite its
  open PR state; README attribution added, existing changelog credit retained.
- [#23](https://github.com/andrearicci93/vetro/pull/23) and
  [#24](https://github.com/andrearicci93/vetro/pull/24), Firaenix: adapted multi-app
  CoBA guard, still selection, raw navigation and late echoes. Service/diagnostic
  preference plumbing and packaged launcher fixtures are present; README credit added.
- [#75](https://github.com/andrearicci93/vetro/pull/75), Merennor: Node 4.4 integration
  syntax and unsupported-root fallback. README credit added. Passing compatibility
  fixtures do not turn unsupported root into supported root.
- #88, #106, #107: Tizen version, screen progress/model fallback and root guidance;
  device/probe/screen and rooting-status fixtures cover the included scope.
- #108 / issue #82: missing launcher log remains a successful not-running probe;
  real-shell regression retained.
- #109 / issues #89, #100, #79: app-list failures/Retry, non-launchable Settings IDs,
  opt-in Home image domain. The candidate remains excluded from default exports.
- #105: Linux fixture corrections remain included. Previously incorporated #21,
  #27, #29, #31, #32, #33, #47, #52, #61 and #73 retain their README/changelog references.

Existing upstream notices remain intact. New README credits acknowledge included
work, without implying the related open PR has been merged on GitHub. Other open
PRs (including #69, #74, #113, #117, #118, #119 and #123) are not treated as integrated
requirements by this audit. Similar behaviour is not evidence that their complete
patches were incorporated. Their overlap still needs a separate merge decision.

## Verification and release gates

- Application suite: 85 suites (including the new inventory concurrency suite).
- Rooting suite: 13 suites, including packaged Node 4 syntax checks.
- Native launcher: 5,124 checks, zero failures.
- Diagnostic parser: 19 tests. Boot recorder: 6 tests with a simulated HTTP outage.
- Both unsigned WGT variants built in `/tmp`; ZIP integrity and required notices checked.
- Release hygiene/architecture audit and `git diff --check` passed.

No changes from this audit have been installed on a TV. Before final 0.5.0:

1. Repeat restore/undo during startup, cross-view flags, launcher autorun restoration,
   restart and cold boot on the final candidate; keep the original backup data.
2. Confirm default SDB is unreachable from the LAN; test the persistent dashboard toggle across restarts and
   confirm switching off disconnects network clients while the root helper remains healthy.
3. Validate no-key/Developer mode plugin UI and the install/update/disable/remove cycle.
4. Provision the intended update key and independently signed catalog. Both public-key
   modules are still null; no unsigned updater bypass was introduced.
5. Exercise signed updater success/tamper refusal/rollback on that final key-bearing
   package. Earlier TV results and this audit's fixtures do not substitute for it.

## Pairing-mode follow-up

Developer settings now includes a persistent **Disable pairing mode** switch with an
in-page warning, explicit confirmation and an active-state warning. Requiring
pairing again immediately removes unpaired access and preserves existing keys;
restore also requires pairing. `pairing-mode.test.cjs` covers persistence,
paired/unpaired requests, origin/host restrictions, code privacy, storage failure
and corrupt-state fallback. Dashboard and restore fixtures cover confirmation and
cross-feature reset. These changes have not been tested on a TV.

## Settings and launcher follow-up

Quick settings starts on General; software update, cleanup, firmware updates and
restore/removal live there. Pairing and SDB access move to the final Developer
settings tab. Plugins has direct repository/guide links and separate catalog,
installed plugins and file-install guidance. The Task manager no longer displays
the unused-at-home role label/filter.

Samsung Home changes are blocked in both Quick settings and the Task manager while
the Vetro launcher is enabled. Home-state fixtures cover the UI and API interlock.
Reduce motion retains the saved `noMotion`/`--no-motion` compatibility fields but
now removes show/hide, cascade and page animations too. Native tests pass and the
shipped launcher DLL was rebuilt. Local preview pills now load packaged/source
Settings and Samsung Home assets without needing a TV catalog. These changes have
not been installed or verified on a TV.
