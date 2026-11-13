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
from the TV at start-up, and ends with two outline pills, Settings and Samsung Home.

Running apps have a green badge on their icon. A badge also appears when an app's
background service is running. Status refreshes every two seconds while the apps
row is visible; opening the row requests fresh status, and hiding it stops polling.

Tap the centre/OK button to launch. Hold it for 0.75 seconds to open the selected
app's running components. Choose an app or service to stop, or Cancel/Back to
return. Releasing the original hold does not activate an option. Protected TV
components remain read-only, and the backend checks the installed app and its
current process identity before stopping it. Components that restart automatically
remain marked as running. Stops do not change their saved startup flags.

The launcher uses Vetro's local `/dock/runtime` and `/dock/stop` endpoints. The
routes belong to the bundled launcher plugin and pass through Vetro's sign-in
gate; they are also available as `/plugins/launcher/api/runtime` and
`/plugins/launcher/api/stop`. The service passes its configured port through
`--api http://127.0.0.1:PORT`; standalone
runs default to port 8099. If status is unavailable, the launcher remains usable
and its options report the problem instead of offering stale stop targets.

## Layout

- `src/` the dock. `Core/` is pure logic (layout, catalog, input decoding) and has tests;
  `Native/` holds the P/Invoke surface; `Ui/` draws with EFL.
- `tests/` desktop tests of `Core/`: `cd tests && dotnet run`.
- `res/` the images (bar, shadow, glow, focus ring) and the generic Settings/HDMI icons.
- `tools/` generators for those images (`make-glass.cjs`, `system_icons.py`).
- `designer/` a standalone page to try looks; `designer/chosen.json` is the design the launcher currently draws.

## The look

The look is one design, ported from the designer page's JSON. `src/Core/Design.cs` holds the visual values and
`src/Core/Layout.cs` the geometry; both generators read those two files, so the pictures cannot disagree with the
code. `app/tests/dock-design.test.cjs` checks them against `designer/chosen.json` value by value.

One rule ties the shapes together: an icon's corner radius is a percentage of its side (`Design.IconRadiusPct`),
and the focus ring and the glow are built from that same radius, at every size the icon takes while it grows.

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
