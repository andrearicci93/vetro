# Vetro Tuner

A replacement for Samsung's live TV app (`org.tizen.tv-viewer`): same features, faster to open, less RAM.
Goal of the first milestone (MVP): **watch one channel**.

Status (2026-11-07, Q80A): **works end to end without Samsung's tuner on screen**: video under a transparent window, CH+/CH-, channel list, number pad, audio switch, an info banner with the programme on air, a resident mode that shows instantly. The look is the dock's. Version 0.3.0. It is part of Vetro as **Vetro TV Tuner** (see `app/docs/TUNER.md`): `app/service/tuner.js` starts it as the `vetro-tuner` systemd unit and restarts it after a boot, a crash or an update. The integration is covered by tests on the computer, not yet tried on a TV.

## Replacing Samsung's tuner (takeover)

Samsung's `org.tizen.tv-viewer` is never disabled. With `--takeover APP_ID` the resident tuner asks libaul (`aul_app_get_status`) every 0.5 s; status 2 (focus) or 3 (visible) means Samsung's app is up, and the tuner shows itself once (`src/Core/Takeover.cs`, pure logic with tests). Leaving it (Back, Home; Source is not tried) holds the tuner away until the app has been gone: four unreadable answers in a row count as gone. Closing the app is pointless: `app_launcher -k` kills it and the platform restarts it at once (tested on the Q80A, 2026-11-08), so there is no `--close-target` any more. Other options added for Vetro: `--log PATH`, `--pid-file PATH`. `build.sh` needs Samsung's DLL as an argument (or `TVS_DLL`) and writes into `app/native/tuner/`. Unverified on a TV: the status values with the tuner window in front, Home and Source while it is shown.

## How the system tuner works (from the firmware dump)

```
tv-viewer (native C++, ~41 MB RSS, owns the OSD)      <- what we replace
      |  D-Bus (kdbus), generic call: MethodCall(functionCode, inDataSize, inDataBuffer)
tvs-daemon (root, ~15 MB RSS)  -> /dev/dvb/adapter0/*, /dev/video10, /dev/dri/card0
```

* `tvs-daemon` does the real work (tuner, demux, pipeline). `tvs-lite`, `avocd` and `tvs-daemon` stay resident whatever
  app is on top, so only the `tv-viewer` share of memory and start time can be won.
* Every `com.samsung.I*` interface of the daemon (`IServiceNavigation`, `ISourceControl`, `IPlaybackNew`, `IVideoControl`, ...) has
  one method, `MethodCall(functionCode:i, inDataSize:i, inDataBuffer:ay)`. The buffer format is Samsung's own serialiser.
* Samsung ships a managed client for it: `Tizen.TV.Broadcast.TVService.dll` (on the TV at
  `/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/1.1.12/`). It serialises in C# and calls the plain C functions of
  `libtvs-api-lite.so` (`TCIPCConnection_Call`, ...). So a .NET app can talk to the daemon with no native code of its own, which
  matters because the TV refuses unsigned ELF/.so/scripts (UEP) but runs a managed dll under the firmware `dotnet`.
* The system bus is **kdbus**: a pure-managed D-Bus library will not work, use the firmware libraries.

Public surface of that DLL that we need:

| Need | Call |
| --- | --- |
| current source / state | `CreateSourceControl(Profile.Main, 0)` -> `GetCurrentSourceInfo`, `GetSourceState` |
| tuner mode (Air/Cable/Sat, DVB...) | `CreateServiceNavigation` -> `GetTvMode` |
| channel list (517 on the test TV, ~400 ms) | `GetServiceList(criteria with Fetch(columns), list)` |
| current channel | `GetCurrentServiceInfo(criteria, data)` |
| **tune (first time, or source not TV)** | `SourceControl.SetSource(Source.TV, serviceId, "NoAppId")` (what Samsung's own source switcher passes) |
| **zap** | `ServiceNavigation.SetService` (function code 0), not exposed by the client: called by reflection on its internal `MarshalHelperProxy` (see Zapping latency) |

Columns are only returned if requested with `CriteriaHelper.Fetch((int)ServiceDataTag.X)`.
`ServiceData.Get(tag)` throws `ArgumentException` for a column that was not fetched.

Running it needs the firmware assemblies resolved by name from `/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/1.1.12/`,
`/usr/apps/csapi-tv-tizenfx/shared/lib/` and `/usr/share/dotnet.tizen/framework/` (the DLL pulls in `Tizen.TV.Security`
for a Cynara privilege check, which pulls in `Tizen.Log`). Run it as root, like the dock.

How Samsung's own Home asks for a channel: `app_control` to `org.tizen.tv-viewer` with extras `change_source`, `major`, `minor`
(seen in `CompLiveTV.dll`). That path goes through `tv-viewer`, so it is not what we want.

## Look

The look is the dock's (`dock/designer/chosen.json`, `dock/src/Core/Design.cs`): a dark slate sheet (#2A3346) with a thin white border,
soft drop shadow, 24 px corners, white text, a white 2 px ring on the selection. `res/dock_bg.png` and `res/shadow.png` are the dock's own
pictures; `res/solid.png` and `res/ring.png` are plain white rounded rectangles (64 px, radius 16) drawn as 9-slice and tinted. `src/Ui/Surface.cs`
holds the theme and the building blocks (one clipper per view, so a view is shown or hidden as one), `src/Ui/Views.cs` the four views.
Nothing is drawn with a coloured top border. Run with `--backdrop` for screenshots: the compositor shows the video plane as white and white text
would vanish on it.

* **Banner** (bottom left, 4 s): always the same card: channel number and name, then the programme on air (title, start-end times, time left, progress bar).
  The rows are empty until the daemon has the programme (it has it once the channel's tables are in: ~2 s after a zap on a new multiplex), so the lookup
  starts 1.8 s after the zap and is repeated every 1.2 s, up to 6 times; the banner stays up while it looks. If there is none (a radio, a data service) the title row says
  "No programme information".
* **Channel list** (OK): right side, 11 rows around the selection. Up/Down move (wrapping); held down they run on and speed up (1, 3, then 8 rows a step, if the remote auto-repeats); Left/Right jump a page. OK tunes, Back closes, it closes itself after 8 s.
* **TV guide** (Up, or the Guide/EPG key): see "TV guide" below.
* **Number pad** (Left): 4x3 grid 1-9, Delete, 0, Go; arrows move, OK presses; shows the typed number and the channel it would go to
  ("No such channel" otherwise). Once a number is typed, 2 s without a key take it and tune (any key starts the 2 s again; Go still works at once). A real digit key opens it too. Closes after 20 s.
* **Audio** (Right): cycles the audio track and shows "Audio: Italian" for 2 s.
* **Info panel** (Info key 358, or `info` on the control pipe): a card at the top, 1728 x 348 px, same slate look. Channel number in a badge, the programme on air (title, channel name, start-end, a bar and the time left), up to three lines of its description, and on the right the clock, the date, the tuner (`GetTvMode`: Antenna/Cable/Satellite) and the audio track. Built from the store (programme) at once, then the worker reads the description (`ReadPresentTexts`), the audio and the tuner (`Core/InfoPanel.cs` has the date, the audio text and the word wrapping, with tests; `Ui/InfoView.cs` draws it with pooled objects). Any key closes it, then does its usual job (Back and Info only close it); 10 s timeout. Not shown, because nothing reads it yet: resolution, audio format, subtitle and teletext badges, genre.
  The launcher's 123 pad sends its Info key as `input_keyevent XF86Info`, which the tuner never sees (it goes to `tv-viewer`). While the tuner is on screen the file `/tmp/vetro-tuner.ctl.shown` exists (the pipe alone only says a tuner is resident, and `info` would bring it up over any app). To open this panel from the pad, the pad does `sh -c '[ -e /tmp/vetro-tuner.ctl.shown ] && { exec 3<>/tmp/vetro-tuner.ctl; echo info >&3; }'` and sends `XF86Info` as before when that returns non-zero. The read-write `exec 3<>` never blocks, even if the tuner died and left the pipe behind (the TV has no `timeout`). Tried on the Q80A: hidden = no flag, shown = flag, the command opened the panel.

## Keys (Smart Control 2016 on the Q80A, read from evdev, verified 2026-11-07)

| Key | Code | Tuner |
| --- | --- | --- |
| CH+ / CH- | 88 / 87 | next / previous channel |
| OK | 28 | opens the channel list; in the list tunes the selection; on the pad presses the key |
| Up / Down / Left / Right | 103 / 108 / 105 / 106 | list, pad and guide movement; with nothing open: Up opens the guide, Left our pad, Right switches audio |
| Guide / EPG | 362 / 365 | opens (and closes) the guide on remotes that have the key; the Smart Control has none |
| Back | 1 (ESC) | closes the list/pad, then hides the tuner (resident) or exits |
| Home | 63 | the tuner steps aside (hides/exits) and the system's Home handles the key; also 172 (HOMEPAGE), 139 (MENU), 116 (POWER) |
| "123" | 140 | Samsung's own pad opens whatever we do (owner confirmed 2026-11-07), so it is not used: our pad is on Left |
| ? | 67 (F9) | unknown, no effect |

**Remotes with number keys (not tested on real hardware, the owner has none).** The input devices of the IR/RC remotes on this TV
(`wt61p807 rc device`, `Smart Control`, `MCE IR Keyboard/Mouse`) all advertise `KEY_1..KEY_0` (codes 2..11), plus `KEY_MINUS` (12); the `KEY_NUMERIC_*`
range (512..521) is only on virtual devices we do not read. `InputDevices` already opens the `rc device` and `mcirb` nodes, so digits reach us.
A digit opens the pad with that digit typed; further digits add; 2 s of silence tunes; **OK tunes at once** while the number was typed on digit keys
(`NumberEntry.Typed`, cleared as soon as an arrow or an on-screen key is used). Simulated with `key 3`, `key 4`, `key 28` on the resident tuner:
23 -> Rai 5 straight away. Open: like the "123" key, Samsung's own tuner may also react to the digits (it will probably open its own entry and tune too).

The Smart Control 2016 has no digit keys. With our window in front the keys reach us and `tv-viewer` did not react (no double handling seen);
Vetro's input agent was running but in observe mode (no grab). If its filter is switched on, the real remote goes silent and the
keys come from `vetro-forwarded-remote`, which `InputDevices` already watches. Every key press is logged (`key N`): unknown ones can be learned from the log.

## Resident mode (`--resident`)

The process stays alive with its window hidden and is driven through a pipe (`--control PATH`, default `/tmp/vetro-tuner.ctl`, created 0666,
opened read-write so it never reports end-of-file). One command per line:

```
show | hide | toggle | guide | info | quit | tune N (channel number, shows the tuner) | audio | key CODE (acts as that remote key: for tests)
```

A launcher (the dock, Vetro's root agent) only has to run `echo show > /tmp/vetro-tuner.ctl`. Showing is instant (in-process ~1 ms; a cold start is
~310 ms). While hidden the keys are ignored. Cost of the resident process on the Q80A with the GL engine: RSS 30 MB, PSS 8.0 MB, private dirty 2.7 MB,
19 threads (6 of them the Mali GPU driver); with `--shm` (software engine) 12 threads but PSS 9.3 MB / private dirty 4.5 MB, so GL stays the default.
For comparison tv-viewer: 43 / 19.5 / 10.3 MB, 31 threads; `function-osd` (draws Samsung's volume bar, resident): PSS 6.4 MB, private dirty 2.4 MB.

## TV guide (EPG)

**Status: written and checked against the firmware dump and captured replies; the integrated app has NOT run on the TV** (the owner needed the TV for other work).
What is proven on the TV and what is only checked offline is listed at the end of this section.

### The call: `IServiceGuide.GetProgramList` (function code 1)

Found in the dump (`libtvs-api.so`, Ghidra) and proven read-only on the Q80A with the probe (`schedule MAJOR[:HOURS]`). The request carries only the "in" parameters,
in this order: service id (u64), window start (u32 Unix seconds), window length (u32 seconds). The reply is Samsung's tagged tree (tag, kind 4 leaf / 8 branch,
length LE): a result leaf and a map branch of alternating key leaf (u32 start) / programme branch. Programme leaves follow `ProgramData.Tag`:
0 service id, 1 event id (u16), 2 start, 3 duration, 4 UTC start, 5 UTC duration, 6 texts (title, description, raw, source, guidance, UTF-16BE; a `^Genre` suffix on the title is cut by `GuideText.Title`).
Request bytes for a 40-byte example: `010822000000000408000000FE1780DE050178250004040000005998EF6A000404000000302A0000`.

It answers **for any channel, also on other multiplexes, in 27-48 ms** (no tune needed). Canale 5 has ~26 h of data, Rai 1 ~2.4 days; a channel with no data gives result 0 and an empty map.
So the schedule of the whole list can be read in the background (516 channels ~ 20 s) and the banner never waits for a tune. This replaces the old prefetch, which could only
see the programmes of the multiplex the daemon was tuned to (`GetPresentProgram`) (the old `ProgramCache` is gone).

### Design (pure logic first, so it is testable and the layout can be checked without the TV)

* `Core/GuideReply.cs` parses a reply (never throws; wrong shape = false, "no data" = empty list). `Core/GuideStore.cs` keeps the schedule of each channel (re-read after 15 min, retried after 20 s on failure; `Nearest` orders neighbours first).
* `Core/GuideGrid.cs` is the model: 180-minute window, 7 channel rows, focus (channel + time), moves (`MoveRow`, `MovePage`, `MoveTime` = previous/next programme, scrolling the window by 30 min when a gap or the edge is reached), horizon 72 h, gaps and not-yet-read rows become "Loading" cells.
* `Core/GuideScene.cs` turns the model into a short list of primitives (sheet, fill, ring, text); `Ui/GuideView.cs` draws it with pooled EFL objects (140 fills, 260 texts, one ring: nothing is created while moving), and the offline preview script draws the **same** primitives, so `guide_open.png` is the real layout.
* Look: the dock's slate sheet, "SamsungOneUI" text, 8 px per minute, 30-minute ticks, the "now" line, programmes on air slightly brighter, one white ring on the focus; no coloured borders. Header: title, `21:20 - 01:03 · 3 h 44 min · Channel`, the long text of the programme (read on demand 250 ms after the focus stops), the date.
* **Held arrows (tested on the Q80A with the owner, 2026-11-07):** the Smart Control sends ONE press per hold and then a release, no auto-repeat events. The repeat is made by the tuner: 0.4 s after an Up/Down/Left/Right press with no release, a timer steps every 0.12 s until the release, 1 step, then 2 after ~5, then 3 after ~14 (7 per step was too fast). It only starts once a release has been seen on the device (so the first key after a restart does not repeat) and never runs more than 12 s. The same applies to the channel list.
* Keys while it is open: Up/Down channel, Left/Right programme, CH+/- page, OK watch (tunes the focused channel and closes), Back or the guide key closes; it closes itself after 60 s without keys.
* Loading (`Program.cs`): when it opens, the rows on screen are read first (focus first), then the page below and above, in cancelable 100 ms slices on the worker; the grid is redrawn after each row. The long text is not kept in the store (saves memory): the focused programme's window is read again with the texts on (6 h from its start, the same call as the bulk read).

### Proven on the TV (read-only, 2026-11-07, Q80A)

`GetProgramList` request and reply for several channels, including other multiplexes and a channel with no data (probe `schedule`); timings; the reply layout above (six replies saved as `tests/fixtures/sched_*.bin` and parsed by the tests).

### Checked only against the dump and the fixtures (not run on the TV)

* The integrated app: `TvsClient.ReadSchedule` (same reflection as `ReadPresentTexts` and the probe version), the guide window, drawing with EFL (the layout is checked with the offline preview, the EFL calls are not), the key handling and the 60 s timer.
* The detail read (6 h window, same request as the bulk read; only the parser keeps the texts, so only the parser path is new).
* Keys: Up opens the guide (Samsung's own tuner may react to Up too: not seen), Guide/EPG 362/365 are guesses from the key tables, no remote with the key was available.
* The control-pipe command `guide`. Loading and moving speed on the TV (the daemon answers in ~40 ms per channel, so a full screen is expected in about 0.3 s).
* Programmes right at the edge of the schedule (the last programme ends where the data ends: shown as "No information" after it).

Daemon calls the app makes that were never run from inside the app: `GetProgramList` (code 1) with the three window shapes it uses (3 days from now, and 6 h from a programme's start for the texts).

## Banner and prefetch

The banner reads the programme on air from the store: instant when it is there. A zap puts it on screen at once if known; otherwise the schedule is read (40 ms) before the tune is sent,
falling back, after the tune, to `GetPresentProgram` and the old retry loop (6 tries) when the schedule has nothing for now (`GetPresentProgram` only answers on the tuned multiplex, so it is never asked before the tune). After every zap a worker reads the schedules of the 24 channels around
(neighbours first, 100 ms slices that stop as soon as the owner zaps), so the next CH+/- and the guide already have them.

## Programme text: the client drops it, the reply has it

`GetPresentProgram` fills start, duration and event id, but the managed client's decoder leaves the texts empty (`containTexts` n=0). The reply
bytes do carry them: Samsung's tagged tree (tag 1 byte, kind 1 byte, length 4 bytes LE, body), the programme's tag 6 is a list of UTF-16**BE** strings:
title, description, raw descriptor, source name, guidance. `Core/GuideText.cs` reads them (test vector `tests/present-reply.hex`, a real reply);
`TvsClient.ReadPresentTexts` makes the same call as `GetPresentProgram` (same bytes) and parses the reply itself. `StartTime` is Unix UTC;
`UtcStartTime` is the same moment in the GPS epoch (-315964800 s).

## Not done, and why

* **EPG** is done (see "TV guide"); what remains is running it on the TV. `GetProgram(EProgramIndicator, TCProgramId, ...)` (code 3) is still not understood, but nothing needs it now.
* **Subtitles.** No public call turns them on. Who draws them (the daemon or `tv-viewer-graphics`) is not known: switch them on in Samsung's tuner and look
  at `enlightenment_info -topvwins`. If `tv-viewer-graphics` draws them, a daemon call alone would not show them under our window.
* **Audio list.** The client cannot list the tracks: Right tries the next index and reads it back, going back to the first when there is none.
  Checked on a channel with one track only (stays on the first); not yet on a channel with two.

* **Channel logos.** Samsung's tuner has a logo path (`banner/info/channel_logo_path`, fallback `info_nologo_default.png`) and a downloader
  (`libbroadcastapp-util`: `CBroadcastImagesDownloader::DownloadChannelLogo(serviceId)`, libcurl, temp `/run/user/5001/BroadcastImagesDownloader/temp.png`;
  `org.tizen.channel-list` `CChannelItem::GetLogo` -> "Logo URL" -> `FCThumbnailManager::GetDownloadedItem(downloadId)` from `libslive-provider`). The daemon columns
  `ServiceDataTag.LogoID/LogoVersion/IconRoute` exist but are **0 / empty for all 517 channels on this TV** (probe mode `logos`), no logo files are bundled in the
  firmware and that directory does not exist on the TV. The URL source for DVB channels was not found (`channel-list` is stripped, `DownloadChannelLogo` has no
  URL in it); what is certain is that the logo is fetched from a server, not read from the signal. The Hybridcast/TV Plus path is `GetChannelLogo(serviceId, size)`
  in `FCVirtualChannels`. Not implemented in the tuner.

## Open questions (in order)

1. ~~Does the video show under our window?~~ Yes: transparent window + `SetSource(TV, id)` is enough (verified by eye, the compositor screenshot cannot show the video plane).
2. What `tv-viewer` does on number keys, CH+/-, Back, info banner, and who owns those keys while we are in front.
3. Whether we have to stop `tv-viewer` (it is a `vip_app`; number keys route to it). Do not kill it without asking.
4. Baseline to beat: `tv-viewer` RSS 41.6 MB, 31 threads (measured 2026-11-07 on the Q80A). Measure PSS/private dirty
   with `smaps` (this kernel has no `smaps_rollup`).

## Start-up measurements (Q80A, ms from launch, `--notif`, medians of several runs)

| | before | after |
| --- | --- | --- |
| `Main` starts | 66 | 66 (the runtime itself costs ~47: an empty `Main`) |
| window up | ~510 | **~310** |
| channel name on the banner | ~500 | ~320 |

* What helped: the tvs conversation runs on its own thread while the main thread builds the window (they are independent, the
  list read dropped from ~125 to ~55 ms on the warm connection), and the app no longer re-tunes the channel that is already on.
* ReadyToRun with the TV's own `crossgen` (`crossgen /ReadyToRun /MissingDependenciesOK /p <framework>:<tizen dirs> /in a.il.dll /out a.dll`,
  a signed firmware tool, 0.3 s): about -35 ms. Real but small, and it must run on the TV per firmware: not adopted yet.
* No effect (within +/-15 ms noise): trimming unused EFL bindings, `QuickJitForLoops`.
* What is left is native: `elm_init` ~90 ms and window creation ~95 ms. The way to remove it is to keep the process resident and hidden
  (the dock does this, ~1.3 MB private), not another language: an unsigned Rust ELF is refused by the TV (UEP).
* Memory of the v0 process: RSS 25.8 MB, PSS 4.8 MB, private dirty 1.3 MB, 19 threads (tv-viewer: 43 / 19.5 / 10.3 MB, 31 threads).
* Do not time `Process.GetCurrentProcess().StartTime` on this TV, it reads ~800 ms too high; stamp the launch in an env var.

## Running it on the TV (development)

Build on a Mac with the .NET SDK (`dotnet build -c Release -p:TvsDll=<firmware copy of Tizen.TV.Broadcast.TVService.dll>`), copy
`vetro-tuner.dll` and `vetro-tuner.runtimeconfig.json` to a folder on the TV and start it as root in its own unit, like the dock:

```
systemd-run --unit=vetro-tuner --collect -p WorkingDirectory=<dir> -p KillSignal=SIGKILL \
  /usr/bin/env HOME=/home/owner XDG_RUNTIME_DIR=/run WAYLAND_DISPLAY=wayland-0 /usr/bin/dotnet vetro-tuner.dll --notif --seconds 1800 --hold
```

Stop it with Back on the remote or `systemctl stop vetro-tuner`. Give test runs a long `--seconds`: it is an auto-exit safety net.
Log: `/tmp/vetro-tuner.log`. Tests of the pure logic: `dotnet run` in `tests/` (126 checks: parser, store, grid, scene, fuzzed replies). The build output has a `res/` folder next to the dll: it must be copied with it.

## Layout

* `src/` the app: `Program.cs` (window, keys, worker thread, control pipe), `Ui/` (theme and views), `Tvs/TvsClient.cs` (Samsung client, the only file that loads it), `Core/` (pure logic with tests: channel list, number pad, programme clock, programme text, language names, guide reply / store / grid / scene), `Native/` (EFL, libc), `Input/Evdev.cs`, `res/` (pictures). Options: `--notif` (notification-level window, needed to be seen over an app), `--resident`, `--control PATH`, `--major N`, `--seconds N` (auto exit), `--hold` (banner stays), `--shm` (software engine), `--backdrop` (dark ground for screenshots).
* `tools/probe/` read-only probe of the TV service, plus `guide <major>` (read-only: present programme, texts, audio, caption mode), `rawpresent <major>` (read-only: hex of the reply), `tune <major>`, `bench <from> <to> <rounds>`, `signals <from> <to> <rounds>` `schedule MAJOR[:HOURS]` (read-only: GetProgramList, replies in /tmp/vtsched_*.bin), `logos` (read-only), and `nd <from> <to> <rounds>` (env `ND_CODE` picks the function code: 0, 1, 15, 21...) which **change the channel**; `listen <sec>` is read-only (prints the tvs signals while someone else zaps) (run them only when the
  TV is free). Build: `dotnet build -c Release -p:TvsDll=<path to Tizen.TV.Broadcast.TVService.dll from the firmware>`.
  The DLL is referenced at compile time only and is never copied or shipped.

## Tools used

* `ilspycmd` (`dotnet tool install ilspycmd`) for the managed DLLs, Ghidra 12.2 (`analyzeHeadless`) for the native ones.
