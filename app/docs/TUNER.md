# Vetro TV Tuner

Vetro TV Tuner is Vetro's own live TV screen: a channel banner, a channel list, a number pad, a TV guide and an audio switch, drawn in front of the picture. While it is on, it is shown in place of Samsung's tuner. It has its own page in the dashboard, between the Remapper and Vetro Shards, with the remote buttons and a preview of each screen.

**Status: new and not tried on a TV by this release.** The tuner itself was developed and run on one Q80A with an antenna (DVB-T). The way it is wired into Vetro (start at boot, takeover, restart after an update) is covered by tests on the computer, not yet by a run on a TV. Subtitles, teletext and the TV's other sources (HDMI, cable, satellite, apps) are not covered.

## What "replaces Samsung's tuner" means

Samsung's live TV app (`org.tizen.tv-viewer`) is **never disabled, removed or changed.** Turning the tuner on starts a small resident process that stays hidden. Every half second it asks the TV whether Samsung's live TV app is in front; when it is, Vetro's tuner draws itself over it and takes the remote keys. Turn the switch off, or let the tuner stop for any reason, and Samsung's tuner is exactly what it was.

- Press **Home** (or **Back**): the tuner steps aside and the TV's own screen handles the key. It does not come back until Samsung's live TV app has been left and opened again. **Source** has not been tried with the tuner on screen.
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

The tuner opens the info panel on the Info key (evdev code 358) or on `info` written to the control pipe (`echo info > /tmp/vetro-tuner.ctl`). An Info key injected with `input_keyevent XF86Info` (what the launcher's 123 pad sends) does **not** reach the tuner: it goes to `tv-viewer`, which draws its own panel. For the pad's Info key to open Vetro's panel, the launcher has to write `info` to the pipe when the tuner is on (see `tuner/README.md`). Samsung's panel is not covered: when a remote's real Info key is pressed, both panels may appear.

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

Diagnostic reports include only counts and flags about the tuner, never its log.

## Building

```
tuner/build.sh /path/to/Tizen.TV.Broadcast.TVService.dll    # or TVS_DLL=...
```

The DLL is Samsung's and is read from a TV or a firmware dump. The script writes `vetro-tuner.dll` and its runtime config to `app/native/tuner/` and refuses to continue if Samsung's DLL ended up there. Tests of the logic (143 checks): `cd tuner/tests && dotnet run`. See `tuner/README.md` for how the tuner talks to the TV service.

## Known limits

- One TV tried (Q80A, DVB-T). Cable, satellite and other regions are untested.
- No subtitles or teletext. Audio: switching works; listing tracks does not.
- The takeover polling, Home and Source while the tuner is shown, still need runs on a TV.
