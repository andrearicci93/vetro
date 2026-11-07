# Ad-free YouTube

Samsung's own YouTube app on your TV, **without ads**. The plugin opens the YouTube app that is already on the TV and adds
a script to its page: ads blocked, Shorts hidden, sponsor segments skipped ([SponsorBlock](https://sponsor.ajay.app)),
optional [DeArrow](https://dearrow.ajay.app) titles. You stay signed in, voice search and the TV's player keep working, and
**nothing is installed on the TV**: no WGT, no Developer mode, no re-signing, no second YouTube app.

## What you get

- Ads blocked before and inside videos, as far as the script keeps up with YouTube (see *Limits*).
- Shorts removed from the menu, SponsorBlock skipping, optional DeArrow titles and thumbnails.
- Your own account, history and subscriptions: it is the real YouTube app, not a clone.
- An optional switch so Samsung's own YouTube button (Home tile, remote key, voice) opens the patched app.
- If anything fails (proxy down, script missing, certificate missing) YouTube still opens, just without the patches.

## Install and use

1. In the dashboard open **Vetro Shards → Load plugin catalog**, find **Ad-free YouTube** and install it. It lands switched off.
2. Switch it on, open its tab, press **Open YouTube**. The first start takes up to a minute: it makes a certificate, copies the
   YouTube app's content folder (about 3 MB) and downloads the script once.
3. Optional: switch on **Samsung's YouTube button opens this** (see *The Home tile*).

**Remove it cleanly:** switch the tile option off, press **Remove certificate and files**, switch the plugin off, then remove
it. Removing the plugin alone leaves the certificate and the copy of the content folder on the TV.

**Tested on:** a Samsung Q80A (firmware 2310.0, Tizen 6.0) rooted with Vetro. Other models should work if they have the Cobalt
YouTube app (`com.samsung.tv.cobalt-yt`); the plugin says "Samsung YouTube not found" when they do not. Not yet confirmed:
the real remote YouTube key after a cold boot, and long-term behaviour as YouTube changes.

## How it works

The YouTube app on the TV is Cobalt (`com.samsung.tv.cobalt-yt`). It accepts a proxy and a content folder on its command line.
The plugin starts it with both:

```
app_launcher -s com.samsung.tv.cobalt-yt -u 5001 USERDATA ' --base_url=https://www.youtube.com/tv --dial_name=YouTube --use_eden --start_frag=#start --proxy=127.0.0.2:8101,direct:// --content=/opt/usr/home/owner/share/vyt'
```

- **The first four flags** are the ones Samsung's own YouTube tile passes. The proxy list ends in `direct://`: if the proxy is
  down, the app connects directly (unpatched) instead of failing.
- **The proxy** runs inside Vetro, on `127.0.0.2` only. Every host is a plain tunnel except `www.youtube.com`, whose start page
  gets one `<script>` tag. If the certificate or the script is missing, the proxy only tunnels: YouTube then runs unpatched
  instead of breaking.
- **The certificate.** The plugin makes a certificate authority of its own and adds it to a *copy* of the YouTube app's content
  folder (`/opt/usr/home/owner/share/vyt`, a short path on purpose: see *The Home tile*). Only the YouTube app started by this plugin trusts it. The TV's trust store is never touched, and
  `ca.key` is readable by root only, and `<DIR>` itself belongs to root: the only folder the apps' user can write in is
  `<DIR>/cache` (the downloaded script, checked by hash on every read), so it cannot swap a file for a link that a root command follows.
- **The script** is [TizenTube](https://github.com/reisxd/TizenTube) (reisxd, GPL-3.0), one exact release, downloaded from
  npm's CDN on first use and used only if its SHA-256 matches the one in the plugin. It is not part of this plugin. Sponsor
  segments come from the public [SponsorBlock](https://sponsor.ajay.app) database (CC BY-NC-SA 4.0).

`<DIR>` is `/opt/usr/home/owner/share/vetro-youtube`.

## The Home tile (optional, off by default)

Samsung's tile, remote key and voice all start the wrapper app `9Ur5IzDKqV.TizenYouTube`, which reads its flags from one row of
the web app service's database (`/opt/dbspace/.webappservice.db`, table `widgetinfo`, column `reserved_string_6`). The same text also
sits in the app's `config.xml` and in the package database, but neither is read when the app starts (checked on a Q80A). The switch
appends `--proxy=127.0.0.2:<port>,direct:// --content=/opt/usr/home/owner/share/vyt` to that row with the `sqlite3` command, and
takes it out again. The rules:

- **The TV passes the app at most 127 characters of that value** (it cuts the rest silently, so the app would start without
  `--content`, not trust the plugin's certificate, and show a white screen). Samsung's value is 88 characters, so the plugin
  takes out `--base_url=https://www.youtube.com/tv` (the address the app uses anyway when it is not given) and puts it back in front
  when it restores. That is why the content folder has a short path, and why a value that would not fit is left alone.
- The row is patched only while the proxy is listening and the certificate and script are ready; otherwise (and when the switch
  goes off, when the plugin is switched off, when Vetro stops, and on *Remove certificate and files*) it is put back.
  All changes to the row go through one queue, so a slow patch can never land after a restore. A failed restore is retried.
- Each write only happens if the row still holds what was read (compare-and-swap); only that row of that one app is touched;
  values with quotes, `$`, backticks or non-ASCII text are never written.
- Our two flags are removed wherever they sit in the value, so a firmware that adds its own flag after them does not strand them.
  If our flags are in a value this plugin will not edit, *Remove certificate and files* refuses and deletes nothing.
- If Vetro dies without restoring the row, YouTube still opens (the proxy list ends in `direct://`), unpatched.

## Commands it runs, all as root and only when you press a button

- Open: `openssl` (make or renew the authority and the youtube.com certificate), `cp -R` of the YouTube app's content folder
  (about 3 MB), `app_launcher -t` and `app_launcher -s` for `com.samsung.tv.cobalt-yt`.
- Close: `app_launcher -t com.samsung.tv.cobalt-yt`.
- The Home tile switch: `sqlite3` on that database (read the one row, compare-and-swap update), then `chown` of the database back to its owner.
- Remove certificate and files: puts the row back, closes YouTube and runs `rm -rf <DIR>`.

Switching the plugin off stops the proxy but does not close a YouTube that is already open: connections already made keep
working and new ones fall back to a direct connection.
Removing the plugin does **not** remove `<DIR>`: press *Remove certificate and files* first.

## Limits

- Every request to youtube.com goes through a new TLS connection, so the TV does a bit more work than with the plain app.
- A new TizenTube release needs a new version of this plugin (the hash is pinned on purpose).
- Ads inside videos depend on the script keeping up with YouTube; if they come back, the script needs updating, not the plugin.
- Unofficial, and YouTube's terms do not allow ad blocking. Use it on your own TV, at your own risk.
- Port 8101 can be changed with `{"port": 8123}` in the plugin's `config.json`.

## Privacy: what it connects to

- `cdn.jsdelivr.net` once, to download the TizenTube script (checked by SHA-256 before use). Nothing is sent but the request.
- `www.youtube.com`: the proxy forwards the app's own requests; it reads the start page to add the script tag and keeps nothing.
- The script, running inside YouTube's page, talks to YouTube and to the SponsorBlock / DeArrow servers (sponsor.ajay.app,
  dearrow.ajay.app) the way TizenTube does. This plugin collects nothing and sends nothing anywhere else.

## Credits

This plugin is only the glue. The hard parts are other people's work:

- **[TizenTube](https://github.com/reisxd/TizenTube)** by **reisxd** (GPL-3.0): the script that blocks the ads, and the discovery
  that Cobalt accepts `--proxy` and `--content`, which this whole approach is built on. The script is downloaded from its npm
  package (`@foxreis/tizentube`) and is not part of this plugin.
- **[SponsorBlock](https://github.com/ajayyy/SponsorBlock)** and **[DeArrow](https://github.com/ajayyy/DeArrow)** by **Ajay
  Ramachandran** and contributors: the community database of sponsor segments (CC BY-NC-SA 4.0) and of titles and thumbnails.
- **Cobalt**, Google's open-source YouTube client that Samsung ships as the TV's YouTube app.
- **[Vetro](https://github.com/andrearicci93/vetro)** for the plugin host, and Samsung's `sqlite3`, `openssl` and
  `app_launcher` for the rest.

## Legal

Unofficial and not affiliated with Google, YouTube, Samsung, TizenTube or SponsorBlock. YouTube's terms of service do not
allow ad blocking; use it on your own TV, at your own risk. This plugin is MIT-licensed like the rest of this catalog; the
TizenTube script it downloads keeps its own GPL-3.0 licence.
