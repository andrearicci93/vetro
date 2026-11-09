# Vetro TV Tuner

Vetro TV Tuner is Vetro's own live TV screen: a channel banner, a channel list, a number pad, a TV guide and an audio switch, drawn in front of the picture. While it is on, it is shown in place of Samsung's tuner. It has its own page in the dashboard, between the Remapper and Vetro Shards, with the remote buttons and a preview of each screen.

**Status: new and not tried on a TV by this release.** The tuner itself was developed and run on one Q80A with an antenna (DVB-T). The way it is wired into Vetro (start at boot, takeover, restart after an update) is covered by tests on the computer, not yet by a run on a TV. Subtitles, teletext and the TV's other sources (HDMI, cable, satellite, apps) are not covered.

## What "replaces Samsung's tuner" means

Samsung's live TV app (`org.tizen.tv-viewer`) is **never disabled, removed or changed.** Turning the tuner on starts a small resident process that stays hidden. Every half second it asks the TV whether Samsung's live TV app is in front; when it is, Vetro's tuner draws itself over it and takes the remote keys. Turn the switch off, or let the tuner stop for any reason, and Samsung's tuner is exactly what it was.

- Press **Home** (or **Back**): the tuner steps aside and the TV's own screen handles the key. The polling does not bring it back while Samsung's live TV app stays in front, so Back is not undone; it comes back when that app has been left and opened again. **Power** does not hold it away: after standby the tuner is on again with the TV (while the TV powers down the poll may show it again; nobody sees that, but it has not been checked). **Source** has not been tried with the tuner on screen.
- **A TV key brings it back at once.** The remote's keys reach Samsung's app too, and it answers CH +, CH −, Info and Guide with its own banner, list or panel. So when one of those keys arrives while the tuner is hidden, the tuner asks the TV right then whether Samsung's live TV app is in front; if it is, the tuner shows itself, whether or not Back had sent it away. On CH + and CH − it does not step the channel a second time (Samsung's app has already done it): it shows the banner of the channel the TV ends up on, read again 0.8 s and 2.5 s later. Info and Guide open their screens. The arrows and OK are left out on purpose: the launcher and Samsung's own overlays (Source, quick settings) keep the live TV app "in front" while they use those keys, and the tuner would pop up over them. Back, Home, Power and the volume keys never wake it. Samsung's app still sees the same key at the same moment, so its own banner can flash for an instant before the tuner covers it; stopping that would need the tuner to take the remote away from everything else, which it does not do. **Not yet tried on a TV**, and the status values the application manager gives while the launcher is open are unknown (the log now records every change of that status).
- **`tv-viewer` must stay on.** Measured on a Q80A (2026-11-08): with it disabled for a minute the tuner still tuned (its log and `tvs-daemon` were fine) but the screen showed no picture. `tv-viewer` is what puts the video on screen, so the tuner covers it and never replaces it.
- Samsung's app is **not closed** behind the tuner. Measured on a Q80A (2026-11-08): `app_launcher -k org.tizen.tv-viewer` kills it and the platform starts it again at once (a recovery launch), so no memory is freed. Vetro therefore claims no RAM saving for the tuner. An earlier test build had a *Close Samsung's tuner* option; it was removed.
- Quick settings → Debloat will not offer to disable `org.tizen.tv-viewer` while the tuner is on.

## Turning it on

Open **Vetro TV Tuner** and turn the switch on; Vetro asks once. The page says "Not available on this TV" and leaves the switch off when the TV cannot run the tuner. It needs:

- The firmware's .NET runtime.
- Samsung's TV service client (`/opt/usr/dotnet/Tizen.TV.Broadcast.TVService`).
- The TV's tuner service (`tvs-daemon`) running.
- Root access through Vetro, like the launcher.

The page names the first one that is missing.

It starts again by itself after a restart or a crash (back-off from 30 s up to 5 minutes, like the launcher) and after a Vetro update. **Refresh** reads the state again; **Show tuner now** brings it up without waiting for Samsung's app.

## The remote

| Button | What it does |
| --- | --- |
| CH +, CH − | Next and previous channel, with the banner |
| OK | Opens the channel list; in the list it tunes; on the number pad it presses the key |
| Up | Opens the TV guide; moves in lists and the guide |
| Left | Opens the number pad; jumps a page in the list |
| Right | Switches the audio track |
| Back | Closes what is open, then hides the tuner |
| Home | The tuner steps aside for the TV's own screen |
| Digits (remotes that have them) | Open the number pad with the digit; 2 s later it tunes, OK tunes at once |
| Guide / EPG | Opens and closes the TV guide (remotes that have the key) |
| Info | Opens the info panel at the top: programme with times and progress, its description, the clock and date, the tuner and the audio track. Any key closes it (Back and Info only close it); it closes by itself after ten seconds. Remotes that have an Info key; the Smart Control 2016 has none |

The same list, with a picture of every screen, is on the dashboard page.

## The info panel and the launcher's 123 pad

The tuner opens the info panel on the Info key (evdev code 358) or on `info` written to the control pipe (`echo info > /tmp/vetro-tuner.ctl`). An Info key injected with `input_keyevent XF86Info` (what the launcher's 123 pad sends) does **not** reach the tuner: it goes to `tv-viewer`, which draws its own panel. For the pad's Info key to open Vetro's panel, the launcher has to write `info` to the pipe while the tuner is on screen (the file `/tmp/vetro-tuner.ctl.shown` says so; see `tuner/README.md` for the exact command). Samsung's panel is not covered: when a remote's real Info key is pressed, both panels may appear.

The panel does not show resolution, audio format, subtitle or teletext badges, or the programme's genre: the tuner has not read them from the TV service yet, and it shows nothing rather than guess.

## How it fits together

| Part | Where | Role |
| --- | --- | --- |
| `tuner/` | .NET 3.1 app, built from source | The screens and the conversation with Samsung's TV service |
| `app/native/tuner/vetro-tuner.dll` | built with `tuner/build.sh` | The compiled app. Samsung's own DLL is only a compile-time reference and is **never** shipped |
| `app/service/tuner.js` | Vetro service | State, start/stop, probe of the TV, takeover options, control pipe |
| `app/service/plugin-tuner.js` | bundled plugin `tuner` | The dashboard routes `GET /tuner` (state) and `POST /tuner` (`{action: enable, disable, show, hide, toggle, guide}`), behind the same pairing as the rest of the API, and the supervision timer |
| `app/service/tuner-page.js` | dashboard | The key table and the five previews |

Runtime files: state `/opt/usr/home/owner/share/vetro-tuner.json`, process id `/home/owner/vetro-tuner.pid`, log `/home/owner/vetro-tuner.log`, control pipe `/tmp/vetro-tuner.ctl` (`show`, `hide`, `toggle`, `guide`). The process runs as root in its own systemd unit, `vetro-tuner`. Vetro updates replace `native/tuner/` like `native/dock/` and restart both. Restore the TV switches the tuner off.

Diagnostic reports include only counts and flags about the tuner, which of its four prerequisites exist and the version numbers of Samsung's TV client, never its log.

## Building

```
tuner/build.sh /path/to/Tizen.TV.Broadcast.TVService.dll    # or TVS_DLL=...
```

The DLL is Samsung's and is read from a TV or a firmware dump. The script writes `vetro-tuner.dll` and its runtime config to `app/native/tuner/` and refuses to continue if Samsung's DLL ended up there. Tests of the logic (166 checks): `cd tuner/tests && dotnet run`. See `tuner/README.md` for how the tuner talks to the TV service.

## Other TVs: what is the same and what is not known

The tuner leans on a few names and paths that were read on one Q80A. They were compared with the 65 diagnostic reports attached to 60 GitHub issues (52 models from 2018 to 2026, Tizen 5 to 10, 20 firmware builds; 54 of them have a process list because the root agent was connected):

| What the tuner needs | Evidence from other TVs |
| --- | --- |
| Samsung's live TV app `org.tizen.tv-viewer` | In the app inventory of all 65 reports; a process `tv-viewer` in all 54 that list processes. The same id is named in reports from a Frame 2024 (#41), a Frame 2025 (#122) and an AU7100 (#127). **Same.** |
| The tuner service `tvs-daemon` | Running in all 54 reports with a process list (every firmware build among them), next to `tvs-ht-service` and, on most, `tvs-lite` or `tvsensor-iot-se`. **Same.** |
| `/usr/bin/dotnet` and a .NET Core 3.1 target | The launcher needs the same host. Tizen 5 and 5.5 sets (#35, #77, #95) have no `/usr/bin/dotnet`, only `dotnet-launcher`, and runtimes 2.1 to 3.0: the tuner is refused there with *no .NET runtime*, like the launcher. The launcher is enabled and running on a Tizen 6.5 set with runtime family 3.1 (#158, #165) and on a Tizen 9 set with 6.0 (#163), started with the same line and runtime file as the tuner's. **Different on Tizen 5; same from Tizen 6.** |
| Samsung's client, `/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/<version>/` | Seen only in the Q80A firmware dump (version 1.1.12; two more copies of the DLL sit under `/usr/apps/`). The reports do not list it. **Unknown.** |
| The calls to `tvs-daemon` (set channel, read schedule, audio) | Their numbers were read from the Q80A's client and are called through reflection. Whether other firmware versions use the same ones is **unknown**; a failing call is logged and the tuner falls back to a plain channel change where it can. |
| `aul_app_get_status`, the remote's key codes (CH + and − as 88 and 87, OK as 28, Home as 63), the Wayland socket | The launcher uses the same socket and Home code on all the TVs it runs on. The status values and the CH and OK codes are **unknown** outside the Q80A. |

Because the client folder and the service cannot be seen in the old reports, **diagnostic reports now carry the answer**: the `tuner` section lists which of the four prerequisites exist (`dotnet`, `client`, `tvs`, `viewer`) and the version folders of Samsung's client (numbers only). The tuner switch is refused, with the first missing item named, on a TV that lacks any of them, so a TV that differs cannot be left half set up. If a report shows `client: false` on a TV with a running `tvs-daemon`, the client lives somewhere else there.

## Known limits

- One TV tried (Q80A, DVB-T). Cable, satellite and other regions are untested.
- No subtitles or teletext. Audio: switching works; listing tracks does not.
- The takeover polling, the key wake, Home, Power and Source while the tuner is shown, still need runs on a TV.
