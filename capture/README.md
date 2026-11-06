# TvCapture: the helper of the screen-share Shard

Takes the picture the TV is showing (video and on-screen graphics, after the scaler) through Samsung's own
`libvideo-capture`, encodes it with the TV's `libturbojpeg` and serves it as MJPEG on `127.0.0.1` only.
The Shard `app/examples/plugins/screen-share/` starts it on demand and proxies it to the dashboard.

**Credit:** adapted from [zabique/vetro](https://github.com/zabique/vetro/tree/fork/extras) (`capture/`), MIT.
See `THIRD_PARTY_NOTICES.md`.

- Protected video (HDCP inputs, DRM streams) is refused by Samsung's library and shown as black; this helper does not
  try to get around that.
- It captures only while someone watches and exits after 30 s without a viewer.
- The structure `CaptureParam` was read from the library of a QN85A (Tizen 6) by the author of the fork. The Q80A has
  the same exported functions in a 32-bit ARM library; whether the layout is the same on its firmware is **not verified**.

## Build

```
sh capture/build.sh
```

needs the .NET SDK (any recent one: it targets `netcoreapp3.1`, the runtime the TVs ship, 3.1.3 on the Q80A) and
copies `TvCapture.dll` and `TvCapture.runtimeconfig.json` into the Shard's `assets/`. The Shard is then packed with
`node app/scripts/vetro-plugin.cjs pack app/examples/plugins/screen-share`; `pack` hashes the two files and declares
them in the manifest. The SHA-256 of the bundle is what the plugin list signs, so whoever publishes the Shard must
build the DLL from this source and say so.

## Provenance of the shipped DLL

`capture/build.sh` is deterministic (the git revision is not embedded, so the hash does not change with commits): the DLL in the Shard was built with .NET SDK 10.0.402 (macOS, arm64) and has SHA-256
`fc20a94b131a1d175014c20a423d06d84efec5c570a9be51de14d030a11e3e3c`. A different compiler version gives a different hash for
the same source; if you rebuild with another SDK, the hash in the manifest will change, which is expected. The fork ships its
own build of the same source (`app/native/capture/TvCapture.dll`), which this build does not reuse.
