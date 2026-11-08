# Vetro TV Tuner

Vetro TV Tuner is Vetro's own live TV screen: a channel banner, a channel list, a number pad, a TV guide and an audio switch, drawn in front of the picture. While it is on, it is shown in place of Samsung's tuner. It has its own page in the dashboard, between the Remapper and Vetro Shards, with the remote buttons and a preview of each screen.

**Status: new and not tried on a TV by this release.** The tuner itself was developed and run on one Q80A with an antenna (DVB-T). The way it is wired into Vetro (start at boot, takeover, restart after an update) is covered by tests on the computer, not yet by a run on a TV. Subtitles, teletext and the TV's other sources (HDMI, cable, satellite, apps) are not covered.

## What "replaces Samsung's tuner" means

Samsung's live TV app (`org.tizen.tv-viewer`) is **never disabled, removed or changed.** Turning the tuner on starts a small resident process that stays hidden. Every half second it asks the TV whether Samsung's live TV app is in front; when it is, Vetro's tuner draws itself over it and takes the remote keys. Turn the switch off, or let the tuner stop for any reason, and Samsung's tuner is exactly what it was.

- Press **Home** (or **Back**): the tuner steps aside and the TV's own screen handles the key. It does not come back until Samsung's live TV app has been left and opened again. **Source** has not been tried with the tuner on screen.
- **Close Samsung's tuner** (off by default, not tried on a TV): closes Samsung's live TV app once Vetro's is in front, to free its memory. Nobody knows yet whether the picture stays. If the screen goes blank, turn it off. The app stays installed and starts again when it is opened. No memory saving is claimed unless that option is on.
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

The same list, with a picture of every screen, is on the dashboard page.

## How it fits together

| Part | Where | Role |
| --- | --- | --- |
| `tuner/` | .NET 3.1 app, built from source | The screens and the conversation with Samsung's TV service |
| `app/native/tuner/vetro-tuner.dll` | built with `tuner/build.sh` | The compiled app. Samsung's own DLL is only a compile-time reference and is **never** shipped |
| `app/service/tuner.js` | Vetro service | State, start/stop, probe of the TV, takeover options, control pipe |
| `app/service/plugin-tuner.js` | bundled plugin `tuner` | The dashboard routes `GET /tuner` (state) and `POST /tuner` (`{action: enable, disable, closeSamsung, show, hide, toggle, guide}`), behind the same pairing as the rest of the API, and the supervision timer |
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
- The takeover polling, Home and Source while the tuner is shown, and the close option still need runs on a TV.
