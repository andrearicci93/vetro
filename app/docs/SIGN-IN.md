# Dashboard and API sign-in

Vetro's routes can run commands as root, so the service only answers devices that have paired with the TV. Apps on the TV itself (requests from loopback with an opaque or missing `Origin`, such as the Vetro widget) need no setup. App-only mode (`npm start` on a computer, no TV adapter) has no device operations and stays open.

## Pair a browser

Open `http://TV_IP:8099/` and choose **Show a code on the TV**. The service opens the Vetro app on the TV, which shows a 6-digit code for 2 minutes. If nothing appears (for example, the root agent is not connected yet), open the Vetro app yourself; it shows any pending code. Type the code in the browser.

The browser receives a random key in an `HttpOnly`, `SameSite=Strict` cookie, valid for a year. The dashboard shows **Sign out** and **Sign out all devices** in the bottom-right corner.

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

## What is enforced

| Check | Purpose |
| --- | --- |
| Unpaired LAN clients get `401` on every route except `/auth/pair`, `/auth/confirm` and the sign-in page | Root routes need a paired device |
| Only TV apps can read `/auth/pending` (the current code) | The code proves physical access to the TV |
| One pairing at a time: while a code is live, new pairing requests get `429` and the TV app is not reopened | Nobody can cancel someone else's pairing or keep popping the code up |
| Five wrong codes end a pairing; a new pairing at most every 10 seconds | Slows down guessing |
| The no-key bypass for TV apps requires `Host` to be an IP address or `localhost` | A rebound hostname on loopback still has to pair |
| A browser `Origin` must match `Host` on `/auth/pair`, `/auth/confirm` and every paired request | Other web pages can't start a pairing or use a paired browser's cookie |
| Paired devices may use any host name (`tv.local`, a router name, Home Assistant) | The key, not the address, is what grants access |
| Keys are 32 random bytes; only SHA-256 hashes are stored (`/opt/usr/home/owner/share/vetro-auth.json`) | A copied file does not reveal keys |

## Limits

Traffic is still plain HTTP: a device that can watch your LAN traffic could copy a key. Keep the TV on a trusted network and do not forward its ports. Other apps installed on the TV are trusted like the Vetro widget. To revoke every key from the TV side, a TV app can `POST /auth/signout-all`; deleting the auth file and restarting the service has the same effect.
