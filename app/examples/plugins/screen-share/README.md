# Screen share

A live view of what the TV is showing (video and on-screen graphics), as a page in the Vetro dashboard.
Open **Vetro Shards → Screen**, press Start. Size, frame rate and quality can be changed while it plays.

Protected video (HDCP inputs, DRM streams) is refused by the TV and shows as black; this Shard does not try to get around it.

## Commands it runs

All as root, through `ctx.execute`, and only when you press Start (nothing runs while the Shard is just switched on):

- `netstat -ltn | grep 127.0.0.1:8097`: is the helper already running?
- `systemd-run --unit=vetro-screen-share … /usr/bin/dotnet <plugin folder>/assets/TvCapture.dll --serve 8097 --fps 15 --size 1280x720 --idle-exit 30`
  (or `setsid nohup …` when systemd-run is missing): starts the helper. It listens on `127.0.0.1` only and exits 30 s after the last viewer.
- `systemctl reset-failed vetro-screen-share.service`: clears the state of an earlier run.

Port 8097 is used between this Shard and the helper (on the TV only). If something else has it, put `{"port": 8123}` in the Shard's `config.json`.

## The helper (native permission)

`assets/TvCapture.dll` is a .NET program built from `capture/` in the Vetro repository (`sh capture/build.sh`). It calls Samsung's
`libvideo-capture` and the TV's `libturbojpeg`. Its SHA-256 is declared in the manifest of the bundle. The permission
`native` is what tells you the Shard brings a program of its own.

## Credit

Adapted from [zabique/vetro](https://github.com/zabique/vetro/tree/fork/extras) (`capture/`, `app/service/screen-capture.js`), MIT.

## Status

Tried on a Q80A (firmware 2310.0, 2026-11-06): the helper works. A single capture takes about 25 ms, colours are right, and the
helper exits by itself after the last viewer. This TV's capture library returns at most **720x576** pixels whatever size is
asked, and the picture comes squeezed (the full 16:9 screen in a 5:4 frame), so the page stretches it back to 16:9: it is a
preview, not a sharp copy. The whole flow was run on that TV with the new plugin host (install from the bundle, switch on, page, stream through Vetro at about 10 frames/s, switch off, remove). Not yet run: a cold boot with the plugin on, or on another TV model.
