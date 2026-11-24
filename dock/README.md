# Vetro launcher

A minimal launcher for a rooted Samsung Tizen TV, written in C# against the TV's own EFL
libraries and run with the TV's `dotnet`. Vetro starts and stops it from its **Launcher**
tab; it is off until you turn it on.

The launcher is a bundled Vetro plugin: `app/service/plugin-launcher.js` owns supervision and API
actions, and the existing `/dock` URLs are aliases. Its native files still ship with Vetro and are
updated and rolled back together with Vetro; installing a replacement launcher from the catalog is
not implemented. **Still selection** is an optional setting in that plugin, off by default. It skips
focus movement, icon growth/lift and per-icon glow colours; entrance and exit fades remain.

When it is on, the Home key opens this launcher instead of Samsung's Home. The dock shows
the same apps, in the same order and with the same icons as Samsung's Home row, read
from the TV at start-up (then the user's own order: hold OK on a tile to move it or take it out), and ends with two
outline pills, All apps and Samsung Home. All apps lists every app, with Settings and the store at its end (TV-Store when Vetro finds it installed, Samsung's App store otherwise).
The fifo's `reload` reads the three lists again and makes the pages again when they changed (`ListWatch`): the launcher asks Vetro for
it when the package database is newer than its All apps list, i.e. after an app was installed or removed.
Up opens Sources. A complete HDMI + DisplayPort + USB-C inventory uses the G8's three-port layout. Other devices retain TV and HDMI 1-4, plus DisplayPort when present as before. On All apps and on Sources, holding OK adds the entry to the end of the row or takes it
out (`RowEdit.Toggle`, sent to Vetro with `RowEdit.Command`), and a tick marks what the row holds; a short OK opens it or
switches to the input when the key comes up. A Sources list without row keys (written by an older Vetro) keeps OK on the
press, has no hold and shows "Back" only.

For the G8 layout, input remaps use the same native app-control request as the launcher.
The service invokes the packaged DLL with `--switch-source TYPE LABEL ICON`; this mode validates its arguments,
sends one request and exits before the instance lock, window setup or launcher state is touched. It works while
the launcher is off. The service discovers the input and an existing firmware icon first, then reads the selected
source back before reporting success. The icon used for switching is independent of optional Samsung tile artwork.
Other devices retain the original TV/HDMI remap keys and native icon fallback; see [input compatibility](../app/docs/INPUTS.md).

## Control center and Task manager

**Down** on the apps row (or below the last pill) opens the Control center: up to three cards side by side (`--cards`,
chosen in the dashboard): Task manager, Audio output, Picture mode, Sleep timer, and the card of a Shard (`shard:<id>` or
`shard:<id>:<label>`, the label escaped as `=HH` UTF-8 bytes outside `[A-Za-z0-9.-]`; several Shards may have one each).
**Left/Right** move between the cards. A Shard card is drawn like Picture mode: its rows come from the Vetro service
(`GET /plugins/launcher/api/card?plugin=<id>`, a choice `POST …/card-select?plugin=<id>&row=<row>`, tab-separated lines, read
with curl off the main loop, `Core/ShardCard.cs`); the dock never runs the Shard. Not tried on a TV yet.
The Task manager lists the apps that are running, the biggest first: name, CPU (on a wide card) and memory (private RAM
plus swap of the app and its web renderers). **OK** switches to the selected app, **holding OK** (0.8 s) closes it (`app_launcher -t`, then
`-k` if it is still there two seconds later), **Up** on the first row or **Back** returns to the apps. A tap acts
only when the key comes up (read from the input device and from the window), so a click never closes an app. Only visible UI apps are listed: Live TV, the
on-screen menus, HbbTV, the keyboard and Vetro itself are left out (`Core/Tasks.cs`). Samsung's Home is listed, as
it is often the largest. The list refreshes every 1.5 s while open; `--no-tasks` switches the page off. Vetro starts the dock with
`--no-tasks` unless the **Task manager** switch is on (Vetro UI, Launcher tab), and always in custom-launcher mode.
A "Task manager" hint with a down chevron sits under the apps bar, mirroring the "Source" hint above it; to
make room the dock window has a second hint band at the bottom, so the bar sits 46 px higher (`--no-tasks` drops both).

## Layout

- `src/` the dock. `Core/` is pure logic (layout, catalog, input decoding) and has tests;
  `Native/` holds the P/Invoke surface; `Ui/` draws with EFL.
- `tests/` desktop tests of `Core/`: `cd tests && dotnet run`.
- `res/` the images (sheet and rim, glow, focus ring and capsule) and the generic Settings/HDMI icons. `dock_bg.png` and
  `shadow.png` are still generated but no longer drawn.
- `tools/` generators for those images (`make-glass.cjs`, `system_icons.py`).
- `designer/` a standalone page to try looks; `designer/chosen.json` is the design the launcher currently draws.

## The look

The look is one design, ported from the designer page's JSON. `src/Core/Design.cs` holds the visual values and
`src/Core/Layout.cs` the geometry; both generators read those two files, so the pictures cannot disagree with the
code. `app/tests/dock-design.test.cjs` checks them against `designer/chosen.json` value by value.

One rule ties the shapes together: an icon's corner radius is a percentage of its side (`Design.IconRadiusPct`),
and the focus ring and the glow are built from that same radius, at every size the icon takes while it grows.

The bar (apps and Sources) and the Task manager panel use the material of the 123 pad and the volume pill: `pill_rim`
(white at `ShellBorderAlpha`) 2 px outside the sheet, then `pill_bg` (`ShellColor` at `VolumeAlpha`), nine-sliced to
`Design.PanelRadius` (40: the icons' 15 plus the bar's 26 of padding, so the corners are concentric), with no drop shadow.
The Task manager marks its selected row with the 123 pad's ice capsule (`pill_cap`), and that row's texts turn slate.

To change the look: edit `chosen.json` (or paste a new designer export there), update the matching constants in
`Design.cs` / `Layout.cs`, then run `node tools/make-glass.cjs` and `python3 tools/system_icons.py`-based
`render_all` before building (`cd tools && python3 -c "import system_icons as s; s.render_all('../res/icons')"`).

Not ported from the designer (the launcher cannot do them): blurred background behind the bar, label fonts, the
brightness boost on a selected pill, and the desaturation of unselected icons. With the chosen design there are no
name labels and no clock, so the label styling options are not carried either.

## Build

```sh
dotnet build -c Release Launcher.csproj   # targets netcoreapp3.1, the runtime on the TV
```

Run `sh dock/build.sh` from the repository root to build and copy the native DLL and runtime config
into `app/native/dock/`. The package builder reads those copies; it does not compile C# automatically.
After changing native sources, rebuild before packaging. Run `dotnet run --project dock/tests` for the
pure logic, raw-input echo, Home guard cancellation and system-launch fallback checks (the shell
fixtures run on a Unix desktop and never access a TV).
