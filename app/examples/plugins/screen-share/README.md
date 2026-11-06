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

Not yet tried on a TV. The memory layout the helper uses was read on a QN85A; on other firmware it may report an error instead of a picture.
