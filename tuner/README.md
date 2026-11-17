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

The Banner and Info have no card: they stand on a **veil**, one picture (`res/veil_corner.png`, a quarter ellipse centred on the bottom-left corner,
stretched, not 9-slice) at alpha .58 for the Banner (0,480 1700x600) and .66 for Info (0,80 2500x1000), and every text has the EVAS soft shadow
(black, alpha 140) as a halo, like the dock's labels. Fonts are SamsungOneUI 200 (big numbers, clock), 500 and 600; texts are placed by their
baseline (the font's ascender 952 / descender 276 per 1024, in `Theme`), so the big number stands on the baseline of the line beside it. The
progress row (start and end time, the line `res/bar.png`, the progress with its head `res/progress.png`, "N min left" over the head) is
`ProgressView`; where the label goes, and which time gives way to it when it comes within 28 px, is `Core/ProgressRow.cs` (tested).
The Channel pad, Channel list and Audio toast use the material of the launcher's osd 123: `res/pill_rim.png` (white .22, 2 px outside) and
`res/pill_bg.png` (slate #243448 at .90), the dock's own pictures, radius 40 for panels (the Audio toast too) and a capsule for the one-line messages through the border scale; keys are
`res/pill_cap.png` capsules (white .14) and the focus is the ice capsule with the text in slate. No shadow anywhere. Pad and list are centred on
the screen's height. The EPG stands on the same veil grown past every edge of the screen (alpha .94, no sheet): cells are `res/pill.png` (64 px,
radius 20, 9-slice 24) in white at .09 / .16 on air / .05 loading / .035 with `res/hatch.png` tiled for "no information"; the focus is the same pill in
ice (#E4F2FF .96) with its title and time in slate, no ring and no shadow (radius 20 like the cells: a capsule on a 15-minute cell would be an oval).
`src/Ui/Surface.cs` holds the theme and the building blocks (one clipper per view, so a view is shown or hidden as one), `src/Ui/Views.cs` the views.

**Motion** (`Core/Motion.cs`, `Ui/Anim.cs`, the mock-up's choreography): only position, size, alpha and a uniform `evas_map` zoom move, driven by one
ecore animator that exists only while something moves; an ease is three straight stretches ((0,0), (1/3,.6), (2/3,.9), (1,1)), a slow start for what
leaves. The veil changes shape in 320 ms (Banner 1700x600 .58, Info 2500x1000 .66, guide 6400x3400 .94; it shrinks to the Banner's corner at alpha 0 when
nothing uses it). A view comes in with a 200 ms fade of its clipper after 60 ms and leaves with a 200 ms fade. Banner -> Info: number, name and title
fly with a zoom of the larger of the two (a text is never drawn enlarged), logo, line and progress move and resize, times and "N min left" move; the
Info's own texts fade in. Banner -> guide: the name flies to its row label (zoom), the number too and swaps with the row's 500-weight number in the last
80 ms (a text cannot change font in flight); the guide fades in as one. Guide -> Banner (OK) is the same flight backwards. Channel pad <-> Banner: the
one fades out while the other comes in. A key, a command or a held arrow first puts any transition at its end; the worker's results wait for its end
(at most 0.32 s). `--no-motion` (as the dock) or `motion=0` in the features file makes everything immediate.
The guide's footer names the remote's keys with their pictures (`res/key_*.png`, made from `app/design-system/remote` by `tools/render-remote-keys.cjs`; `GuideScene.Footer` places them). Nothing is drawn with a coloured top border. Run with `--backdrop` for screenshots: the compositor shows the video plane as white and white text
would vanish on it.

* **Banner** (bottom left, 4 s): channel number and name (logo at the right end), then the programme on air (title, start and end times, time left, progress line).
  The rows are empty until the daemon has the programme (it has it once the channel's tables are in: ~2 s after a zap on a new multiplex), so the lookup
  starts with the zap and is repeated every 1.2 s, up to 6 times; the banner stays up while it looks. If there is none (a radio, a data service) the title row says
  "No programme information". The big number stands on that second row's baseline from the start (also while the row is empty), so nothing moves when the programme arrives.
* **Channel list** (OK): right side, 11 rows around the selection. Up/Down move (wrapping); held down they run on and speed up (1, 3, then 8 rows a step, if the remote auto-repeats); Left/Right jump a page. OK tunes, Back closes, it closes itself after 8 s.
* **TV guide** (Up, or the Guide/EPG key): see "TV guide" below.
* **Number pad** (Right): 4x3 grid 1-9, Delete, 0, Go; arrows move, OK presses; shows the typed number and the channel it would go to
  ("No such channel" otherwise). Once a number is typed, 2 s without a key take it and tune (any key starts the 2 s again; Go still works at once). A real digit key opens it too. Closes after 20 s.
* **Audio toast** (Left; Down while it is up): Left cycles the audio track and opens the toast, a two-line panel at the top right (x 1176..1824,
  y 96..248, radius 40, 2.2 s, `Ui/Views.cs` `AudioToastView`): one row for Audio and one for Subtitles, each with the picture of the key that
  changes it (`res/key_left.png`, `res/key_down.png`), the label at .76 and the value in white (600). The row just changed is at full strength, the
  other quieter. Size and columns are fixed (the value column fits "Italian (hard of hearing)", longer is cut), so nothing moves when a value changes.
  **Down, only while the toast is up**, steps the subtitles Off -> track 1 -> track 2 -> ... -> Off and keeps the toast up for its full time again;
  with no toast Down does nothing, as before. The tracks are listed with Samsung's client (`TvsClient.ReadSubtitles`: `IServiceDataAux.SizeOfHybridSBT`
  and `GetHybridSBT` for the channel on screen, on the worker, when the toast opens and after every tune, the result dropped if the channel changed
  meanwhile); on/off and the track are the TV's own two settings, the vconf keys `db/menu/subtitle/subtitle` (0 = off) and
  `db/menu/subtitle/subtitlelanguage` (the index into that list), read with the list and written on Down, the index first, then on/off
  (`Tvs/SubtitleSettings.cs`). Samsung's live TV app draws the subtitles and follows those keys; the tuner never asks the daemon to change the track.
  The line says the language ("Italian", "English", "Italian (hard of hearing)" only when the client reports that mode; `qaa` is "Original",
  an unknown code is shown in capitals), "Off", "None on this channel" (nothing is written) or "Not available" when the list or the settings cannot be
  read (nothing is written). The names, the cycle and what is written are `Core/Subtitles.cs`, with tests. The switch `audio` turns the whole toast off.
  Other messages ("No channel 12", "Channels not loaded yet") keep the one-line capsule in the same corner. **Subtitles are written from an analysis
  of the firmware and have not been tried on a TV yet.**
* **Info panel** (Info key 358, or `info` on the control pipe): the Banner's corner grown up and to the right (block x 96..1296). Channel number and name, logo, the programme on air in large, its progress row, up to two lines of its description, and on the right the clock, the date, the tuner (`GetTvMode`: Antenna/Cable/Satellite) and the audio track. Built from the store (programme) at once (a programme not read yet leaves the title row empty: "No programme information" only appears once the worker has asked and there is none, on the title's baseline), then the worker reads the description (`ReadPresentTexts`), the audio and the tuner (`Core/InfoPanel.cs` has the date, the audio text and the word wrapping, with tests; `Ui/InfoView.cs` draws it with pooled objects). Under the description, on the baseline a third line would have, the Next line shows "Next", the start and the title of the programme after the one on air (`GuideStore.Next`: the first that starts when it ends), from the schedule already in the store or the one the worker reads for the panel, never an extra call; it is empty while that schedule is not known and when there is no next programme. Any key closes it, then does its usual job (Back and Info only close it); 10 s timeout. Not shown, because nothing reads it yet: resolution, audio format, subtitle and teletext badges, genre.
  The launcher's 123 pad sends its Info key as `input_keyevent XF86Info`, which the tuner never sees (it goes to `tv-viewer`). While the tuner is on screen the file `/tmp/vetro-tuner.ctl.shown` exists (the pipe alone only says a tuner is resident, and `info` would bring it up over any app). To open this panel from the pad, the pad does `sh -c '[ -e /tmp/vetro-tuner.ctl.shown ] && { exec 3<>/tmp/vetro-tuner.ctl; echo info >&3; }'` and sends `XF86Info` as before when that returns non-zero. The read-write `exec 3<>` never blocks, even if the tuner died and left the pipe behind (the TV has no `timeout`). Tried on the Q80A: hidden = no flag, shown = flag, the command opened the panel.

## Keys (Smart Control 2016 on the Q80A, read from evdev, verified 2026-11-07)

| Key | Code | Tuner |
| --- | --- | --- |
| CH+ / CH- | 88 / 87 | next / previous channel |
| OK | 28 | opens the channel list; in the list tunes the selection; on the pad presses the key |
| Up / Down / Left / Right | 103 / 108 / 105 / 106 | list, pad and guide movement; with nothing open: Up opens the guide, Right our pad, Left switches audio (Audio toast); Down switches subtitles only while the Audio toast is up |
| Guide / EPG | 362 / 365 | opens (and closes) the guide on remotes that have the key; the Smart Control has none |
| Back | 1 (ESC) | closes the list/pad/guide/info panel, then clears the banner, then goes to the channel watched before (and back again on the next Back), as Samsung's tuner does; the tuner stays up and keeps the focus, so Samsung's app never sees the key (a hidden tuner hands the focus over and Samsung answers Back with its own "previous channel" and banner) |
| Home | 63 | the tuner steps aside (hides/exits) and the system's Home handles the key; also 172 (HOMEPAGE), 139 (MENU), 116 (POWER) |
| "123" | 140 | Samsung's own pad opens whatever we do (owner confirmed 2026-11-07), so it is not used: our pad is on Right |
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
show | hide | toggle | banner | list | pad | guide | info | quit | tune N (channel number, shows the tuner) | audio | key CODE (acts as that remote key: for tests, and for a Remapper shortcut while the tuner is on screen)
resume (the launcher closed without opening anything: back if live TV is on screen) | rescan (watch the remote bridge's new forwarding node now)
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
* `Core/GuideScene.cs` turns the model into a short list of primitives (line, cell, hatch, focus, text, key, logo); `Ui/GuideView.cs` draws it with pooled EFL objects (3 lines, 140 cells, 21 hatches, one focus, 260 texts of which the focused row's number and name and the header's title have their own object, 7 logos, 7 keys: about 440, made a few seconds after the channel list arrives while nothing is on screen (or by the first open if it comes first), about 110 on screen, nothing created while moving). The preview (`preview/`, the tuner tab) runs this code on a simulated EFL.
* Look (design/challenge/opus6): the full veil, SamsungOneUI 500/600, 8 px per minute, the half hours on the axis (full hours 600 white) over a 2 px line, the "now" mark (light blue 3x16) and its trace (.30) through the rows, one cell per programme 4 px apart and flush with the grid's edges, the ice focus; no coloured borders. Header: title 600/64, `21:20 – 01:03 · 3 h 44 min · Channel`, the long text of the programme (two lines, read on demand 250 ms after the focus stops), the date at the right.
* **Held arrows (tested on the Q80A with the owner, 2026-11-07):** the Smart Control sends ONE press per hold and then a release, no auto-repeat events. The repeat is made by the tuner: 0.4 s after an Up/Down/Left/Right press with no release, a timer steps every 0.12 s until the release, 1 step, then 2 after ~5, then 3 after ~14 (7 per step was too fast). It only starts once a release has been seen on the device (so the first key after a restart does not repeat) and never runs more than 12 s. The same applies to the channel list.
* Keys while it is open: Up/Down channel, Left/Right programme, CH+/- page, OK watch (tunes the focused channel and closes), Back or the guide key closes; it closes itself after 60 s without keys.
* Loading (`Program.cs`): when it opens, the rows on screen are read first (focus first), then the page below and above, in cancelable 100 ms slices on the worker; the grid is redrawn after each row. A channel whose read fails is recorded as empty (`GuideStore.PutFailed`), so its row says "No information" instead of "Loading…" for ever, and it is asked again after 20 s; a schedule already known is kept. The long text is not kept in the store (saves memory): the focused programme's window is read again with the texts on (6 h from its start, the same call as the bulk read).

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
* **Subtitles** (Down on the Audio toast, see above) are not tried on a TV. Open: whether the client fills the track objects (language, hard of
  hearing) or only the language; whether a write from the tuner (root) reaches Samsung's app that draws them; whether they stay visible under the
  tuner's window while it is up; whether a read right after a tune already has the new channel's tracks (the read when the toast opens covers it).
  The log has one `subtitles N:` line per read with every track's raw fields, and one line per write.
* **Audio list.** The client cannot list the tracks: Left tries the next index and reads it back, going back to the first when there is none.
  Checked on a channel with one track only (stays on the first); not yet on a channel with two.

* **Channel logos.** The Banner, Channel list, Channel pad, Info and EPG show a channel's logo where there is room (switch `logos`, on by default).
  The tuner draws what Samsung's own tuner shows: the TV's slive daemon keeps a table of channels with a picture address and the DVB triplet
  (original network, transport stream, service) of each, a second table that joins them to the tvs service ids, and a folder with the pictures it
  has downloaded. `Tvs/LogoSource.cs` reads the two tables once at start (SQLite, read-only, through `Native/Sqlite.cs`) and `Core/ChannelLogos.cs`
  matches a channel by its service id first, by its triplet second, **never by name**; a match is turned into the file name the daemon gave the
  picture (`LogoNames.CacheFile`). A channel with no match, or whose file is not saved, shows no logo and the layout stays as it was: the views
  reserve the logo's room only when the tables gave something. Nothing is downloaded and nothing is written.
  Not verified on the TV yet: that the tables are readable from the tuner's process and filled, that the service id equals the tvs channel id, and
  which tag carries the DVB service number (the probe's `logos` mode prints the triplet for the first channels). The start log has a `logos:` line with
  the counts (channels, matched, with a file). Downloading the missing pictures is a separate step, not done.

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

**`--perf`** (by hand only, never in the service's start line; off it costs one test of a flag) writes lines starting with `perf ` into the log
(`src/Ui/Perf.cs`): `perf anim LABEL` for every transition (frames, min/avg/max interval, frames over 30 ms, the tuner's own work per frame in ms;
`+cut` when a key ended it early), `perf key LABEL` for every key (`zap`, `list open`, `guide open`, `guide open (objects made now)` when the guide
had not been made while idle yet, `guide move`, `info open`...: the handler's ms and the ms to the next frame tick), `perf cmd WORD` for pipe
commands, `perf show` when the resident tuner comes up, `perf guide draw` (ms, texts really set, cuts measured, cuts found already made) and once
`perf start` (launch to `Main` only when the launcher sets `VETRO_TUNER_LAUNCH_MS` to the Unix time in ms, then `elm_init`, the window, the views,
the loop). Over 50 Hz live TV a frame is 20 ms and over 60 Hz 16.7 ms: an interval over 30 ms is a dropped frame. In the preview the numbers mean
nothing (its clock can be slowed or paused); there it only shows that the probes change nothing on screen.

## Running it on the TV (development)

Build on a Mac with the .NET SDK (`dotnet build -c Release -p:TvsDll=<firmware copy of Tizen.TV.Broadcast.TVService.dll>`), copy
`vetro-tuner.dll` and `vetro-tuner.runtimeconfig.json` to a folder on the TV and start it as root in its own unit, like the dock:

```
systemd-run --unit=vetro-tuner --collect -p WorkingDirectory=<dir> -p KillSignal=SIGKILL \
  /usr/bin/env HOME=/home/owner XDG_RUNTIME_DIR=/run WAYLAND_DISPLAY=wayland-0 /usr/bin/dotnet vetro-tuner.dll --notif --seconds 1800 --hold
```

Stop it with Back on the remote or `systemctl stop vetro-tuner`. Give test runs a long `--seconds`: it is an auto-exit safety net.
Log: `/tmp/vetro-tuner.log`. Tests of the pure logic: `dotnet run` in `tests/` (parser, store, grid, scene, key routing, fuzzed replies). The build output has a `res/` folder next to the dll: it must be copied with it.

## Layout

* `src/` the app: `Program.cs` (window, keys, worker thread, control pipe), `Ui/` (theme and views), `Tvs/TvsClient.cs` (Samsung client, the only file that loads it), `Core/` (pure logic with tests: channel list, number pad, programme clock, programme text, language names, guide reply / store / grid / scene), `Native/` (EFL, libc), `Input/Evdev.cs`, `res/` (pictures). Options: `--notif` (notification-level window, needed to be seen over an app), `--resident`, `--control PATH`, `--major N`, `--seconds N` (auto exit), `--hold` (banner stays), `--shm` (software engine), `--backdrop` (dark ground for screenshots), `--no-motion` (no transitions).
* `tools/probe/` read-only probe of the TV service, plus `guide <major>` (read-only: present programme, texts, audio, caption mode), `rawpresent <major>` (read-only: hex of the reply), `tune <major>`, `bench <from> <to> <rounds>`, `signals <from> <to> <rounds>` `schedule MAJOR[:HOURS]` (read-only: GetProgramList, replies in /tmp/vtsched_*.bin), `logos` (read-only: the logo columns and the DVB triplet), and `nd <from> <to> <rounds>` (env `ND_CODE` picks the function code: 0, 1, 15, 21...) which **change the channel**; `listen <sec>` is read-only (prints the tvs signals while someone else zaps) (run them only when the
  TV is free). Build: `dotnet build -c Release -p:TvsDll=<path to Tizen.TV.Broadcast.TVService.dll from the firmware>`.
  The DLL is referenced at compile time only and is never copied or shipped.

## Tools used

* `ilspycmd` (`dotnet tool install ilspycmd`) for the managed DLLs, Ghidra 12.2 (`analyzeHeadless`) for the native ones.
