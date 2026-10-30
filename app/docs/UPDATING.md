# Updating Vetro without reinstalling

[Back to Vetro](../../README.md)

Vetro can update itself from the **Diagnostics** tab, **Software update**. You press **Check for update**; the dashboard (in your browser) asks GitHub for the newest signed update, and **Update** sends it to the TV. No computer has to be connected to the TV, and **Host PC IP** stays at `127.0.0.1`.

This is a file swap done with the root agent, not a new install. It cannot change what the package declares in `config.xml` (privileges, service flags). When a version does, Vetro says so and you install it once more with Apps2Samsung.

## What an update covers

Everything Vetro ships except `config.xml`: the service and dashboard (`service/`), the **launcher** (`native/dock/`: the program and its pictures), `native/TvState.dll`, the root helpers (`payload/`, picked up when the service starts again), `index.html` and the icon. Plugins and settings live outside the package and stay.

The launcher is a separate program that keeps running the old version when the service restarts, so an update that changed its files restarts it: if the launcher is on, the new version starts it again and only then confirms itself. If the launcher will not start, the update is not confirmed and the watchdog puts back all the files, the launcher's included, and stops the new launcher so the old one starts again. A launcher that is off is simply updated for the next time you turn it on.

## How it stays safe

- **Signed.** An update is a text file whose manifest is signed (RSA-SHA256) with the maintainer's offline key. The public key is part of the package (`app/service/update-key.js`). The TV refuses anything else, wherever it came from. A hacked GitHub account alone cannot push code to your TV.
- **Checked twice.** The service verifies the signature and every file's SHA-256 against the manifest. The root script checks each staged file again just before copying it.
- **Limited.** Only `service/*.js`, `native/`, `payload/`, `index.html` and `icon.png` can be replaced. Paths with `..` are refused.
- **Reversible.** The files being replaced are saved first. If the new version has not confirmed itself within 4 minutes (it does so once the root agent has connected), a watchdog started by the update puts the old files back and restarts. **Go back to the previous version** does the same by hand.
- **Your settings stay.** The dashboard port chosen at install time is kept; rules, DNS and plugin settings live outside the package.
- **Nothing runs by itself.** Nothing contacts GitHub unless you press the button.

## Publishing a release (maintainer)

```sh
# once: make the key pair, keep update-private.pem offline, paste the public key into app/service/update-key.js
node rooting/release.cjs keygen ~/vetro-keys

# per release: bump the version in app/config.xml, app/package.json and app/service/build-info.js, then
VETRO_UPDATE_KEY=~/vetro-keys/update-private.pem node rooting/release.cjs build /tmp/vetro-update
```

This writes `vetro-update-<version>.json` (about 1.4 MB) and `update-index.json`. Publish both in the folder the dashboard reads (`VETRO_UPDATE_SOURCE`, default the `updates` branch of the repository on `raw.githubusercontent.com`, which allows browser downloads). Raise `shell` in `app/service/build-info.js` whenever `config.xml` changes.

An installed Vetro can take updates only if its package already contained the key: the first release with this feature has to be installed the usual way.

## Measured on the Q80A (2026-10-30, firmware 2310.0, Node 12.4)

- `sha256sum`, `curl` (7.68, OpenSSL 1.1.1w, certificates verified), `setsid`, `nohup`, `base64` and `cp`/`mv` exist. `wget` does not. `curl` reaches `raw.githubusercontent.com`, `api.github.com` and `github.com` from the TV in 0.2 to 0.8 s, so a download made by the TV itself is possible.
- The install folder `/opt/usr/apps/vetrotvapp/res/wgt` is owned by `tizenglobalapp` and writable by the root agent only (the service runs as `owner`). It is on a read-write filesystem. Copy, `chmod` and `mv -f` over an existing file work.
- `app_launcher -k vetrotvapp.svc` is enough to restart the service: a new process was up and answering in about 3 s, and the root agent was connected again right after.
- **The TV refuses to run a shell script file that is not signed** (`[uep][bash] the file is NOT signed!!`), also with `sh file`; `sh -c "<text>"` works. The updater therefore never writes a script and runs it: the watchdog and the restart are passed inline, as base64 (`updater.js`, `detached()`). This was found on the TV; a first version wrote the watchdog to `/tmp` and would have failed.
- `printf '%s\n'` printed a literal `\n` through the root agent; the updater uses `echo`.
- The generated apply script was run on the TV's own shell against a throw-away folder in `/tmp`: hashes checked, files replaced, a new file added, old ones backed up, and with no confirmation the inline watchdog put everything back and restarted.
- Replaced `.js` files do run: the installed service was started from files swapped by hand after the install (dashboard.js, build-info.js, ...), so the UEP does not block `require`d files.

## End-to-end test on the Q80A (2026-10-30)

Run against the real installation, with a throw-away test key (the TV was put back byte for byte afterwards).

1. **First swap** (0.4.0 to 0.4.1, five files, driven from a computer because the installed version had no updater): the service came back in the new version, the root agent reconnected, the version confirmed itself and the watchdog stood down.
2. **Update through the TV's own `/update` endpoints** (0.4.1 to 0.4.2, a `.js` and a `.dll`): a wrong SHA-256 and a tampered file were refused, the signed bundle (1.37 MB) was accepted and applied, the service was back in about 20 seconds with `last.state = updated`. The modified `TvState.dll` ran normally.
3. **An update that cannot start** (0.4.3 with a syntax error in `main.js`): Vetro was down from 16:50:03; the watchdog restored the previous files and restarted the service at about 16:53:57 (3 min 54 s), the dashboard reported `last.state = rolled-back`, and the broken file was gone.

Found while testing: a failed hash check stops the script before anything is replaced (fail closed); `/exec` accepts bodies up to 64 KiB only; a process search by text (`pkill -f`) also matches the script that runs it.

## Still not measured

- **A reboot after a swap.** The swapped files on the test TV all date from after its last boot, and the test did not restart the whole TV.
- **Replacing a `.dll` in `payload/`** (the root helpers). `native/TvState.dll` was replaced and ran; the root chain was not touched.
- The dashboard buttons themselves (the flow above was driven by script) and the real release key.
- The dashboard downloading from GitHub in a browser (CORS on the chosen source).
