# YouTube

Opens **Samsung's own YouTube app** with a script added to its page: ads blocked, Shorts hidden, sponsor segments skipped
(SponsorBlock), optional DeArrow titles. You stay signed in, voice search and the TV's player keep working, and nothing is
installed on the TV: no WGT, no Developer mode, no re-signing.

Open **Plugins → YouTube**, press **Open YouTube**. The first start takes a few seconds longer (see below).
Optionally switch on **Samsung's YouTube button opens this**: the Home tile, the remote's YouTube key and voice then start the
patched app (see *The Home tile* below). With it off, Samsung's button still opens the plain app.

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

## Credit

[TizenTube](https://github.com/reisxd/TizenTube) by reisxd (GPL-3.0) for the script and for showing that Cobalt takes
`--proxy` and `--content`; [SponsorBlock](https://github.com/ajayyy/SponsorBlock) by Ajay Ramachandran for the segment database.
