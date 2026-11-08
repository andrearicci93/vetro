# Dashboard and API sign-in

**Pairing is automatic by default.** It switches on by itself the first time the Vetro app on the TV is seen (a request from the TV with the page's opaque `Origin`), because that proves the TV can show the code. Until then, and on a TV whose page is never recognised (Q8F, Tizen 9, firmware 1300.9, where the first 0.5.0 release locked everyone out because the code could never appear), the service behaves like Vetro 0.3.5: any device on your home network can use the dashboard and API, including root commands, without a code. The dashboard says so while it waits. You can also choose yourself in Quick settings → Developer settings → Pairing (see [Require pairing](#require-pairing)). The first 0.5.0 release had pairing always on; 0.5.0 was republished with the automatic mode.

With pairing on, Vetro's routes can run commands as root, so the service only answers devices that have paired with the TV. Apps on the TV itself (requests from loopback, any `127.x` address or the TV's own address, with an opaque or missing `Origin`, such as the Vetro widget) need no setup. App-only mode (`npm start` on a computer, no TV adapter) has no device operations and stays open.

## Pair a browser

Open `http://TV_IP:8099/` and choose **Show a code on the TV**. The service opens the Vetro app on the TV, which shows a 6-digit code for 2 minutes, with the name the sign-in page sent (the browser's platform string, for example `MacIntel`), in the dashboard card of the TV screen. If nothing appears (for example, the root agent is not connected yet), open the Vetro app yourself; it shows any pending code. Type the code in the browser.

The browser receives a random key in an `HttpOnly`, `SameSite=Strict` cookie, valid for a year. The dashboard shows **Sign out** at the bottom of the side menu. It asks whether to sign out only this device or all devices.

## Pair a script

```sh
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"scripts"}' http://TV_IP:8099/auth/pair
# {"id": "...", "expiresIn": 120}  and the TV shows a code
curl -s -X POST -H 'Content-Type: application/json' -d '{"id":"<id>","code":"<code>"}' http://TV_IP:8099/auth/confirm
# {"ok": true, "token": "<64 hex characters>"}
export VETRO_TOKEN=<token>
curl -s -H "Authorization: Bearer $VETRO_TOKEN" http://TV_IP:8099/status
```

The scripts in `app/scripts` send `VETRO_TOKEN` when it is set.

## Plugin pages

A plugin page runs in a sandboxed frame without the dashboard's cookie, so it cannot send the key. When you open one, the dashboard asks the service for a **session** for that plugin: a random token in the page's own URL (`/plugins/<id>/s/<token>/api/...`). It opens that plugin's routes and nothing else, expires after 8 hours and ends when the plugin is switched off. Installing, switching on and removing plugins needs a paired device like everything else.

## What is enforced

| Check | Purpose |
| --- | --- |
| Unpaired LAN clients get `401` on every route except `/auth/pair`, `/auth/confirm` and the sign-in page | Root routes need a paired device |
| `GET /screen/controls` (what the TV screen's tiles show) may be read by the TV page from any address while pairing is off, like `/screen`; `POST /screen/control` (the tiles' actions) never is: it needs the TV itself or a paired device | A page that is not recognised as the TV can draw the tiles but cannot change anything |
| Only TV apps can read `/auth/pending` (the current code) | The code proves physical access to the TV |
| One pairing at a time: while a code is live, new pairing requests get `429` and the TV app is not reopened | Nobody can cancel someone else's pairing or keep popping the code up |
| The browser that asked for a code gets a `vetro_pair` cookie (2 minutes, `HttpOnly`, `SameSite=Strict`, path `/auth`) holding the pairing id; `GET /auth/state` tells the sign-in page whether a code is waiting and whether it is theirs, so a reload resumes the code instead of losing it | A reload used to leave a code on the TV that nobody could confirm until it expired |
| Five wrong codes end a pairing; a new pairing at most every 10 seconds | Slows down guessing |
| The no-key bypass for TV apps requires `Host` to be an IP address or `localhost` | A rebound hostname on loopback still has to pair |
| A browser `Origin` must match `Host` on `/auth/pair`, `/auth/confirm` and every paired request | Other web pages can't start a pairing or use a paired browser's cookie |
| Paired devices may use any host name (`tv.local`, a router name, Home Assistant) | The key, not the address, is what grants access |
| Keys are 32 random bytes; only SHA-256 hashes are stored (`/opt/usr/home/owner/share/vetro-auth.json`) | A copied file does not reveal keys |
| At most 20 paired devices; a 21st pairing gets `409` with the reason | No existing key is dropped behind a script's back |
| If the key file can't be written or read, the service logs it and `/auth/confirm` returns a `warning` | A read-only folder can't sign everyone out without a trace |

## Limits

Traffic is still plain HTTP: a device that can watch your LAN traffic could copy a key. Keep the TV on a trusted network and do not forward its ports. Other apps installed on the TV are trusted like the Vetro widget. To revoke every key from the TV side, a TV app can `POST /auth/signout-all`; deleting the auth file and restarting the service has the same effect.

## Require pairing

Quick settings → Developer settings → Pairing has a **Require pairing** switch. By default the mode is **automatic**: off until the Vetro app
on the TV has been seen, then on. While pairing is not on, a warning in Developer settings says that anyone on the home
network can use the dashboard and API, including root commands, without a code. Choosing On or Off replaces
the automatic mode.

To turn it on from a browser that is not paired yet, the dashboard first pairs that
browser with a code shown on the TV, then switches pairing on. This proves the TV can
show the code, so nobody locks themselves out. The service enforces it too: turning
pairing on from an unpaired client gets `409` with `needPair: true`. Turning it off asks
for confirmation. The choice persists across restarts; existing paired keys stay valid
in both directions.

While pairing is not on, the cross-site and host checks still apply. A TV page `Origin`
(opaque `null`, or a non-web scheme such as `file://`; never `http(s)`) is accepted only on `/status`, `/probe` and `/screen`, the routes the TV page
uses for its check, from any address (as in 0.3.5), so a TV whose page is not seen as
the TV itself still works. Everything else with an opaque `Origin` is refused, and
`/auth/pending` still gives codes only to the TV itself.

When the service refuses the TV page on `/status`, `/probe`, `/screen` or `/auth/pending`,
the refusal can be read by the page (`Access-Control-Allow-Origin: *`) and carries
`seen: {address, origin, host}`, what the service saw. The TV screen shows it ("Refused
this screen", or "The code cannot be shown on this screen") instead of a bare network
error. Only the caller's own address and headers go back to it.

`GET /pairing-mode` reads `{enabled, disabled, mode, tvSeen, paired}` (`enabled` is whether pairing is required now; `disabled` is the opposite,
kept for clients from the first 0.5.0 release; `mode` is `auto`, `on` or `off`; `tvSeen` says whether the TV app has been seen; `paired` says whether this request comes from a paired
device or the TV). `POST /pairing-mode` takes `{enabled: boolean}`; the first-release 0.5.0 form
`{disabled: boolean}` still works. The preference is stored atomically next to the key
store, in `vetro-auth.json.mode`, as `{"enabled": …, "disabled": …}`. No file means automatic. The TV app having been seen is kept in `vetro-auth.json.tv`
(`{"seen": true}`), written only by a request from the TV with the page's opaque `Origin` on `/status`, `/probe`, `/screen` or `/auth/pending`.
In a file from the first 0.5.0 release, `{"disabled": true}` means off; `{"disabled": false}` was only written when
someone switched pairing back on, so it means on. A file that cannot be read or understood
keeps pairing on; delete it and restart the service to go back to automatic. Pairing is not part
of Restore the TV: automatic is the default, and Restore does not switch off a protection you
turned on. Erasing Vetro's data removes both files.

For a computer-only preview, run `VETRO_BIND_HOST=127.0.0.1 npm start` from `app/`.
This uses the standalone app-only adapter, with no TV operations; app-only already
allows local access regardless of the pairing preference.
