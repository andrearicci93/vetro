# Vetro launcher

A glass launcher for a rooted Samsung Tizen TV, written in C# against the TV's own EFL
libraries and run with the TV's `dotnet`. Enable it on Vetro's **Launcher** tab
to assign the physical Home button to its show/hide action.

When it is on, the Home key opens this launcher instead of Samsung's Home. The dock shows
the same apps, in the same order and with the same icons as Samsung's Home row, read
from the TV at start-up, and ends with two outline pills, Settings and Samsung Home.

In Vetro’s **Launcher → Home shortcut** settings, choose an installed app to open from
that second button and enter a label of up to 12 characters. The label fits inside the
existing button. Samsung Home remains the default and is used if the selected app is
removed (at the next list refresh) or its launch request is rejected. Save restarts an enabled launcher to apply the change;
it does not enable a disabled launcher or change the TV’s default Home app. Keep any
custom home app’s own Home takeover off while using Vetro’s launcher.

Vetro starts the process with `--mapped-home`. In this mode Home is owned by the
remapper: physical and window Home events do not toggle the overlay, and its
standalone Home watcher and close guard are not started. Commands through the
control pipe still show and hide the overlay; arrow, OK and Back navigation use
normal window events. The standalone `--home-code` mode remains available for
running the launcher independently.

## Layout

- `src/` the dock. `Core/` is pure logic (layout, catalog, input decoding) and has tests;
  `Native/` holds the P/Invoke surface; `Ui/` draws with EFL.
- `tests/` desktop tests of `Core/`: `cd tests && dotnet run`.
- `native-tests/` Linux tests that run real child commands through Ecore. With
  `libecore1` installed, run `dotnet run --project native-tests/Launcher.NativeTests.csproj`.
  These tests do not require a TV or a display server.
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

Vetro's package build copies the result into `app/native/dock/`.

## Remote control

Vetro's **Toggle Vetro launcher** remapper action uses the existing root adapter
to run `dotnet tvlauncher-dotnet.dll --control toggle --dir /home/owner`.
The command writes to the resident launcher's control pipe and returns immediately
without opening a display, starting a second launcher, or sending Samsung Home.
It also accepts `show` and `hide`.

The client returns a `VETRO_LAUNCHER_CONTROL_V1` result with `sent`, `not-sent`, or
`unknown`, a reason, and an errno. Exit codes are 0, 3, and 4 respectively.
`sent` confirms the pipe accepted the command; it is not proof that a frame was
displayed. Do not repeat an operation whose delivery is unknown.

`control-tests/test_control.py` exercises the compiled TV executable with actual
FIFOs, a private directory, separate Unix identities, missing readers, a full
pipe, and invalid targets. CI runs this suite as root so the privilege boundary
is tested as well as the command itself.
