# Vetro 0.4.0: Security & Plugin update

Working plan for the release. It says what is in, how far each part is checked, and what is still to do. It is
not a promise: anything marked *not tried on a TV* has only run in the test suite or on a test server.

Three themes:

1. **Plugins:** add-ons written by other people.
2. **Sign-in:** the dashboard and API answer only paired devices.
3. **Ads and privacy:** stop more of what the TV sends out.

## State

| Part | In the branch | Checked | Not checked |
| --- | --- | --- | --- |
| Plugin host, install, update, remove, safe mode | yes | 70 test suites; install, update and refusal run against a fake list in a browser | on a TV (Node 4.4 / 12); the real GitHub list (the repository does not exist yet) |
| Plugin pages under sign-in (session in the URL) | yes | host tests, routing test | with a paired browser on a TV |
| Plugin guide, scaffolder, `check`/`pack`/`index` | yes | `new`, `check`, `pack`, `index` run on a computer | a plugin written by someone else, from scratch, using only the guide |
| Sign-in (PR #9, zerodevb) | merged | author ran the same auth module on a Q60A (Tizen 6, Node 12.4) with a different app showing the code: unpaired requests got 401, pairing worked | this branch's package: the TV screen showing the code (new screen, adapted here), the service opening Vetro on pairing |
| Viewing-data stop, Stop Ambient, domain filter, ad list | yes (earlier in 0.4.0) | Q80A, with a real restart (see CHANGELOG) | other models |

## Before it can ship

1. **Build and install on the Q80A**, then: pair a browser (code on the TV screen, wrong code, expiry), pair a script and run `boot-test.py` with `VETRO_TOKEN`, install and switch on a plugin with a page, update it, reboot and check that safe mode does not trigger.
2. **Create the plugin list repository** (`andrearicci93/vetro-plugins`), or the default address answers 404 and the dashboard says so. A local copy with `notepad` and `tv-uptime` exists on the maintainer's computer. Nothing is published.
3. **Tizen 4 / Node 4.4:** the plugin host and the sign-in module are written in ES5 and avoid `crypto.timingSafeEqual`, but none of it ran on Node 4.4 yet.
4. Decide the open pull requests below.

## Ads and privacy: what exists, what could go further

Exists in 0.4.0: stop viewing-data collection (ten services, with the brake files that survive a restart and a boot step for the others), Stop Ambient, the domain filter with the firmware's hosts and the reported ACR names, the Observe requests view, the ad and tracking categories of the Debloater, and the diagnostic export that shows what starts at boot.

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

## Open pull requests that touch the same files

| PR | What | Note for 0.4.0 |
| --- | --- | --- |
| #9 | pairing sign-in | **merged into this branch**; close it on GitHub when 0.4.0 ships, and thank zerodevb in the release notes |
| #69 | fixes for the 0.3.5 redesign (domenix) | edits the TV screen, where the sign-in code now lives: expect a conflict in `app/index.html` |
| #75 | Tizen 4 on Node 4.4 (Merennor) | touches service start-up; check it against `plugin-host.js` and `auth.js` |
| #74 | relaunch diagnostics (maintainer) | not in the theme. It adds a read-only watcher that records, in the Diagnostics report, when the TV starts an app again after Vetro stopped it (HbbTV, `csfs`), so that reports from other TVs show which app and when. Not merged here |
| #30, #34, #55, #56, #57, #59, #80, #43, #23, #24 | launcher and remote | out of theme |
