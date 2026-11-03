# Vetro launcher

A glass launcher for a rooted Samsung Tizen TV, written in C# against the TV's own EFL
libraries and run with the TV's `dotnet`. Vetro starts and stops it from its **Launcher**
tab; it is off until you turn it on.

When it is on, the Home key opens this launcher instead of Samsung's Home. The dock shows
the same apps, in the same order and with the same icons as Samsung's Home row, read
from the TV at start-up, and ends with two outline pills, Settings and Samsung Home.

## Layout

- `src/` the dock. `Core/` is pure logic (layout, catalog, input decoding) and has tests;
  `Native/` holds the P/Invoke surface; `Ui/` draws with EFL.
- `tests/` desktop tests of `Core/`: `cd tests && dotnet run`.
- `res/` the images (bar, shadow, glow, focus ring) and the generic Settings/HDMI icons.
- `tools/` generators for those images (`make-glass.cjs`, `system_icons.py`).
- `designer/` a standalone page to try looks; `designer/chosen.json` is the design the launcher currently draws.

## Enhanced Features

### 1. Live Available RAM & 24h Clock HUD
- Displays real-time digital clock and available memory (e.g. `19:33 · RAM 512 MB`) in the upper-right corner of the dock.
- Parses `MemAvailable:` from `/proc/meminfo` to reflect actual reclaimable memory.
- Polling is armed strictly while the dock is visible and completely suspended when hidden, maintaining a 0ms idle CPU footprint.

### 2. Remote-Triggered Task Termination
- Maps `XF86PlayBack` (evdev code `244`), `XF86AudioPause`, and Play/Pause codes (`660`) directly to terminate the focused application via `/usr/bin/app_launcher -k`.
- Reclaims occupied RAM immediately without opening secondary task managers or leaving the dock.
- Provides immediate visual confirmation and refreshes the memory HUD 0.4s after termination.

### 3. Active App Indicators (Running Dots)
- Displays a green indicator dot (`●`) directly underneath active running applications.
- Synchronizes running state dynamically using non-blocking background queries.

### 4. Clean YouTube Mod (Cobalt) Termination
- Correlates modified YouTube packages (`tUb3Xq7Lm9.Tube` / TizenTube) with the background Cobalt web engine runtime (`com.samsung.tv.cobalt-yt`) via `KillFirst`.
- Guarantees clean termination of both the frontend launcher and underlying media runtime without triggering Samsung TV "Not available" dialogs.

### 5. Samsung One UI Typography Polish
- Configured with `One UI Sans APP 500 Medium` (preventing fallback to standard Regular 400).
- Sized at 24px with +2px baseline tuning for optimal 10-foot living room legibility on 4K/QLED screens.
- Tuned text opacity to 80% for clean contrast over the frosted glass background.

## The look

The look is one design, ported from the designer page's JSON. `src/Core/Design.cs` holds the visual values and
`src/Core/Layout.cs` the geometry; both generators read those two files, so the pictures cannot disagree with the
code. `app/tests/dock-design.test.cjs` checks them against `designer/chosen.json` value by value.

One rule ties the shapes together: an icon's corner radius is a percentage of its side (`Design.IconRadiusPct`),
and the focus ring and the glow are built from that same radius, at every size the icon takes while it grows.

To change the look: edit `chosen.json` (or paste a new designer export there), update the matching constants in
`Design.cs` / `Layout.cs`, then run `node tools/make-glass.cjs` and `python3 tools/system_icons.py`-based
`render_all` before building (`cd tools && python3 -c "import system_icons as s; s.render_all('../res/icons')"`).

## Build & Test

```sh
# Run desktop tests (5,072 checks)
cd tests && dotnet run

# Build release binary for the TV runtime
dotnet build -c Release Launcher.csproj   # targets netcoreapp3.1, the runtime on the TV
```

Vetro's package build copies the result into `app/native/dock/`.
