# Plugins (API 1, experimental)

Vetro's own features are not plugins. Plugins are add-ons written by other people.
A plugin is code running on the TV: switch on only plugins you trust.

## Write one

```
node scripts/vetro-plugin.cjs new my-plugin
```

creates `my-plugin/` with `manifest.json` and `index.js` (from `examples/plugins/hello`).

`manifest.json`: `id` (must equal the folder name), `name`, `version`, `apiVersion: 1`,
`permissions` (`[]` or `["exec"]`), `main` (default `index.js`), optional `ui: {label}`.

`index.js` exports `function (ctx)` returning `{start, stop, status, route}`, all optional.
Plain ES5: the TV runs Node 4.4 (no `async`, no arrow functions guaranteed, no `worker_threads`).

`ctx`: `id`, `dir`, `config.get()` / `config.set(obj)` (your own `config.json`),
`execute(cmd, timeoutMs)` (only with the `exec` permission; otherwise it rejects).

Routes: `/plugins/<id>/api/<sub>` goes to `route(req, res, sub)`; return `false` if unhandled.
With `ui`, `GET api/ui` returns an HTML page shown in the dashboard sidebar while the plugin runs.
Pages are sandboxed (`allow-scripts`, no same-origin): use relative URLs, and GET or
`text/plain` POST (a JSON POST needs a CORS preflight the host does not answer).

## Rules the host enforces

- Off until switched on in the Plugins page; the choice survives restarts.
- Calls into a plugin are guarded; 3 consecutive errors switch it off.
- A boot that does not stay up for 60 s puts the next one in safe mode (plugins paused until resumed).
- A plugin cannot take a Vetro route: it only gets `/plugins/<id>/api/...`.
- This is fault isolation, **not** a security sandbox: a plugin runs in Vetro's process.

## Install today

Copy the folder into the TV's plugin folder (`/opt/usr/home/owner/share/vetro-plugins/`, shown on the
Plugins page) and restart Vetro. Bad folders appear as "Invalid" with the reason.

## Open: distribution (not built)

Findings: `/exec` already gives any LAN client a root shell (`SECURITY.md`: trusted LAN, no login),
so the dashboard is already the trust boundary; the TV's Node 4.4 makes downloading from the internet
on the TV itself a poor idea. Proposed flow, pending a decision:

1. **Package**: one text file `*.vplugin` (`{format, version, manifest, files}`), text only, size capped.
2. **Download**: the user's browser fetches it (GitHub release or raw URL).
3. **Install**: the browser uploads it to the TV (`POST /plugins/install`); the host checks the
   SHA-256 against the published one, writes it atomically and loads it, off.
4. **Discover**: a `plugins.json` index in a GitHub repo, read by the dashboard page in the browser
   and shown in Plugins with name, author, permissions and hash.

Steps 3 and 4 add a way to put code on the TV from a browser, so they need an explicit go-ahead
and ideally a login first.
