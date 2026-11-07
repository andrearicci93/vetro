# UE55TU7092UXXH / T-KTSU2DEUC-2743.0 local port

This opt-in port documents the launcher and external root-agent adaptations
tested on **UE55TU7092UXXH**, build **T-KTSU2DEUC-REL-202607022000**, Tizen 5.5,
ARMv7, Node 4.4.3. It is pinned to Vetro 0.5.0, commit
`81e16b164236e2fd1edae50a06d986da5e607469`.

The ordinary Vetro package's Tizen 5.5 root limitation still applies. Nothing
in this directory enables a new route in the default package. Other TU7000
sizes, regions and firmware versions are untested. This port requires an
independently established UID-0 command channel and boot worker.

## Preparation

1. Verify the exact TV/build and establish the Remote PC/CIFS temporary root
   route. The companion samsung-tv-root contribution is
   `docs/research-notes/TU7092_PERSISTENT_ROOT.md` and its `tu7092-reference/`
   sources. If it has not been merged, use the matching contribution branch;
   the stock samsung-tv-root CLI does not provide this TU7092 CIFS adaptation.
2. Verify marker-only boot persistence before installing the full root worker.
3. Keep Developer Mode Host PC IP at your controller's LAN address for this
   route. The main installation guide's `127.0.0.1` step is for the stock
   TV-local archive route, which this port does not use.

The preparation script modifies a **local source checkout only**. It validates
the pinned commit, checks all patches before applying them, and refuses an
already-present external-agent marker:

```sh
python3 rooting/ports/tu7092/prepare.py --source . --check
python3 rooting/ports/tu7092/prepare.py --source .
```

For the full launcher appearance used on the tested TV, use this second
command instead of the preceding apply command:

```sh
python3 rooting/ports/tu7092/prepare.py --source . --with-launcher-preferences
```

`compatibility.patch` and `launcher-preferences.patch` contain **source only**.
No patched assembly, Samsung firmware, signed WGT or signing profile is shipped.

## Required compatibility changes

| Failure on this TV | Local port behavior |
| --- | --- |
| No `/usr/bin/dotnet` | Uses the existing signed `/usr/bin/dotnet-launcher --standalone` with Vetro's `APP_ID` and `AUL_APPID` |
| Upstream assembly targets .NET 3.1; installed runtime is 3.0 | Builds from source for `netcoreapp3.0` and updates the copy path in `dock/build.sh` |
| Samsung's host drops effective capabilities | Adds `Group=system_share` to the transient launcher unit so it can traverse the owner's existing home directory |
| PID/FIFO/log writes under the home directory fail | Stores volatile launcher state under `/run/vetro-dock-tu7092`, created at launch |
| Legacy systemd rejects `--collect` | Omits that option in the Samsung-host branch and resets the old failed unit before starting |
| Node 4 lacks RSA generation | Explicit `external-agent.json` opt-in publishes fresh owner-private loopback agent configuration instead of attempting archive-root |
| Node 4 lacks `crypto.timingSafeEqual` | Keeps native comparison where available and uses an equal-length XOR comparison on Node 4 |

The fallback host selection checks for an absent ordinary dotnet executable
and a present Samsung host. It was hardware-tested only on this target; it is
not a general compatibility guarantee for every TV with those paths.

The external agent must authenticate using the existing `SAMSUNG-TV-ROOT/1`
HMAC protocol and full root identity checks. It waits for the per-start private
`vetro-external-*/agent.json` directory rather than embedding a token. The
worker validates owner UID/modes, detaches from its bootstrap, restores only
its own SMACK context and reconnects after Vetro service restarts. Its source
and cold-boot procedure are in the companion rooting contribution.
`rootMethod: manual-external-agent` is the historical adapter label; actual
persistence is established separately by the boot marker and agent readback.

## Build and install

Use a .NET SDK capable of building `netcoreapp3.0`; SDK 8.0.427 was used in the
reported build. Downloading the old reference pack may be required. Then:

```sh
sh dock/build.sh
```

This must replace **both** `app/native/dock/tvlauncher-dotnet.dll` and its
runtime configuration before building a WGT. Applying the source patch alone
leaves the upstream precompiled assembly unchanged. Do not use the earlier
binary-reference-byte retargeting workaround with this source build.

Build the full integration with your own Samsung TV signing profile following
[rooting/README.md](../../README.md), then install through Apps2Samsung or the
documented Samsung tools. Author/distributor certificates and passwords stay
private. A second TV needs its own DUID authorized in the distributor profile.
Keep the same author identity when updating an existing installation.

Open Vetro once. Install/enable the matching boot worker through the separately
reviewed procedure, then verify the authenticated root agent before enabling
Launcher. After a cold boot, allow roughly one minute for Samsung's application
service startup; this was about 50 seconds on the observed boot.

## App-list permission repair

One prior installation left `vetro-dock-apps.tsv` owned by root with mode 600,
so the owner service could not read/replace it. This is installation state,
not a reason to loosen the whole home directory.

As root, back up the list and its metadata. Check Vetro's actual owner UID,
compare it with the adjacent `vetro-dock.json` owner/group, restore the list's
matching owner/group and readable mode 644, and preserve its SMACK label.
Then use Vetro's Refresh action and require a successful readback. Check the
input list too if its error names that file. Do not recursively chmod/chown
`/home/owner`, and do not apply this to authentication JSON or certificates.

## Optional launcher preferences

The separate appearance patch contains the owner-confirmed adjustments:

- Selected app names enabled above icons using the existing crossfade renderer.
  The window grows from 270 to 314 pixels; the bottom-anchored icons keep their
  screen position. Geometry, scrolling, controller and allocation tests cover it.
- Settings uses the existing direct `sys:org.tizen.menu` route, avoiding the
  simulated-key timer. The owner reported improved response; internal dispatch
  timing is not a measurement of the full menu becoming visible. RF channel
  tuning was not optimized by this change.
- TizenTube uses a bundled YouTube icon when Samsung's YouTube icon is absent
  or stale. Fix TizenTube off still uses the app's own icon. The fallback path
  is limited to this port's fixed `vetrotvapp` package.
- Vetro excludes itself even when pinned in Samsung Home. It remains accessible
  from Samsung Home/Apps. Pinning the tile is an owner UI action; it is not done
  by this patch and no other TV's Home caches are distributed.

The optional icon is unmodified artwork from YouTube's official asset pack;
see [assets/README.md](assets/README.md). It is a trademark asset, not an icon
that this contribution relicenses under MIT.

## Validation and limits

On the reported physical TV, the combined port was built, installed and
confirmed with the remote: Home opens Vetro; selected Stremio/TizenTube names
appear; TizenTube's YouTube icon is correct; its playback has picture/sound;
Settings launches directly; Vetro opens from Samsung Home and stays out of its
own launcher. No generic speedup or compatibility outside this build is claimed.

A later cold restart showed a new matching boot marker, full root agent in
`System::Privileged`, active launcher with no error and physical Home-key
confirmation. Root marker uptime was 0.96 s; Vetro service/agent/launcher process
starts were 41.14/48.40/49.79 s. The marker-only disconnected-controller test
and this later integrated-agent cold boot are separate tests.

Host checks include app/integration fixtures, Node 4 syntax, Python parsers,
and 5,178 C# launcher checks. When running stock integration fixtures against
the patched tree, temporarily use `{"enabled":false}` in the external-agent
marker: those fixtures exercise the default archive adapter. Restore `true`
before building this port. Check the opt-in path separately:

```sh
node rooting/ports/tu7092/test-external-agent.cjs .
```

Host fixture success is not another hardware test.

This does not adapt every other .NET-backed Vetro feature. A new upstream
release or self-update may overwrite the local changes; review/rebuild before
updating. Reinstalling the previous same-author signed package is the package
rollback path; the boot hook has its own stop and rollback procedure. New
standby/wake behavior was not tested in this launcher change.

The port and documentation were AI-assisted. The physical-device results above
were checked by the owner. No private addresses, device identifiers, signing
material, tokens or raw diagnostic reports are included.
