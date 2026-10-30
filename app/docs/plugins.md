# Plugins (API 1, experimental)

> **Third-party code.** Plugins are written by other people, not by the author of Vetro. A plugin
> runs on your TV with the same access as Vetro itself. Plugins in the public list are spot-checked,
> not audited: that does not guarantee they work, are safe or stay unchanged, and the author of Vetro
> takes no responsibility for what a plugin does. Install only plugins you trust.

Vetro's own features (Home Assistant, launcher, …) are not plugins. Plugins are add-ons.

- [Use plugins](#use-plugins) · [Write a plugin](#write-a-plugin) · [Publish on GitHub](#publish-on-github)
- [Reference](#reference) · [What the host guarantees](#what-the-host-guarantees) · [Troubleshooting](#troubleshooting)

## Use plugins

Open **Plugins** in the dashboard.

- **Show available plugins** reads the public list (a file on GitHub) in your browser, so the browser
  needs internet; the TV does not. The list is also read once when the page opens.
- **Install** downloads the bundle in the browser and uploads it to the TV. The TV checks it against the
  SHA-256 the list publishes and installs it **switched off**. Nothing in it runs until you switch it on.
- **Update**: a plugin whose list version is higher shows "Update to x.y.z". If it was running it is switched
  off, replaced, and switched on again, unless the new version asks for different permissions: then it
  stays off and you review it first. No restart is needed.
- **From a file**: pick a `.vplugin` file. Nothing verifies who wrote it.
- **Remove** deletes the plugin and its saved settings. A running plugin must be switched off first.
- A plugin with a page appears in the sidebar while it runs.
- Folders copied by hand into the plugin folder (shown on the page, `/opt/usr/home/owner/share/vetro-plugins/`
  on the TV) are loaded at the next start of Vetro.

## Write a plugin

You need Node on your computer (any recent version). Nothing else is installed.

```
node scripts/vetro-plugin.cjs new my-plugin     # folder with manifest.json, index.js, README.md
node scripts/vetro-plugin.cjs check my-plugin   # the checks the TV runs + loads your code
node scripts/vetro-plugin.cjs pack my-plugin    # my-plugin-0.1.0.vplugin + SHA-256
```

Try it: **Plugins → or from a file → pick the `.vplugin` → switch it on.**
Edit, `pack` again, install again: it updates in place and comes back switched off.

### manifest.json

| field | required | |
|---|---|---|
| `id` | yes | 2–32 chars, `a-z 0-9 -`, starts with a letter; equals the folder name. Not `install` or `resume`. |
| `apiVersion` | yes | `1` |
| `name` | no | up to 40 chars, shown in the list |
| `version` | no | up to 24 chars. Use `1.2.3`: the dashboard offers an update when the list has a higher one |
| `description`, `author` | no | up to 160 / 60 chars, shown in the list |
| `permissions` | no | `[]` or `["exec"]` (see below) |
| `main` | no | entry file, default `index.js` |
| `ui` | no | `{ "label": "…" }` (1–24 chars): adds a page in the sidebar while the plugin runs |

### index.js

Plain **ES5**: the host is written and tested for Node 4.4, which older TVs run (the Q80A has Node 12), so do not rely on arrow functions, `let`/`const`, `async` or classes.

```js
module.exports = function (ctx) {
    return {
        start: function () {},               // switched on
        stop: function () {},                // switched off, release timers and sockets
        status: function () { return {}; },  // shown to the dashboard as `detail`
        route: function (req, res, sub) {    // /plugins/<id>/api/<sub>; return false if not yours
            return false;
        }
    };
};
```

`ctx`: `id` · `dir` (your own folder: an update replaces everything in it except `config.json`, so keep your data there) · `config.get()` / `config.set(obj)` (your own `config.json`,
the only thing kept across updates) · `execute(cmd, timeoutMs)` → Promise (only with the `exec` permission; otherwise it rejects).

A bundle is **text only**: up to 20 files, 512 KB in total, file names `a-z A-Z 0-9 . _ -` and `/`.
`config.json`, dotfiles and `node_modules` are not packed.

### The plugin page

With `ui`, `GET /plugins/<id>/api/ui` must return an HTML page. It is shown in a sandboxed frame
(`allow-scripts`, no same-origin): use **relative URLs** (`fetch("count")`), no cookies, no storage. The page URL holds a session token
that opens your routes and expires after 8 hours or when the plugin is switched off: build every request from a relative URL and the token follows.
JSON `POST` works: the host answers the CORS preflight. Dark/light: add `<meta name="color-scheme" content="light dark">`.

### The `exec` permission

`exec` runs shell commands on the TV as root-equivalent. Ask for it only if you must; the user sees
"can exec" before installing, and the public list looks at these more closely.

## Publish on GitHub

The dashboard reads a list from a GitHub repository: by default
`https://raw.githubusercontent.com/andrearicci93/vetro-plugins/main/index.json`, changeable with the
`VETRO_PLUGIN_REGISTRY` environment variable (so you can run a list of your own).

The list repository is laid out like this:

```
index.json                       what the dashboard reads (generated)
plugins/<id>/                    the source of each plugin: manifest.json, index.js, ...
dist/<id>-<version>.vplugin      the bundle for each version (generated)
scripts/build.cjs                packs plugins/ into dist/ and writes index.json; --check is the CI test
```

To add or update a plugin:

1. Put the plugin folder in `plugins/<id>/` (start from `node scripts/vetro-plugin.cjs new <id>` in the Vetro repo).
2. Run `node scripts/build.cjs`. It writes `dist/<id>-<version>.vplugin` and the entry in `index.json`.
3. Open a pull request with the source, `dist/` and `index.json`. CI fails if they are out of date. A maintainer spot-checks the code.
4. A change needs a new `version`: the hash in `index.json` must always describe a published version. Users then
   see "Update" in the dashboard.

`index.json` entry:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "author": "Your name",
  "description": "One line, shown in the dashboard.",
  "permissions": [],
  "url": "dist/my-plugin-1.0.0.vplugin",
  "sha256": "64 lowercase hex characters, the hash of the .vplugin file"
}
```

with the file itself `{ "format": "vetro-plugin-index", "version": 1, "plugins": [ ... ] }`. `url` is relative to
`index.json`, and must be `https`. The dashboard ignores entries without a valid `sha256` and refuses a
download whose `id` and `version` differ from the entry. The hash catches a corrupted file; it does not protect against a malicious author.

Rules that come from the browser: the bundle must be readable by `fetch` from the dashboard, which on GitHub means a
file in the repository served by `raw.githubusercontent.com` (release assets are not readable cross-site). After a
push GitHub's CDN can take a few minutes to serve the new file: a hash mismatch right after publishing means "wait and retry".

`node scripts/vetro-plugin.cjs index <index.json> <bundle>` adds or updates one entry by hand
(`url` defaults to `dist/<file>`), if you keep a list without `build.cjs`.

## Reference

HTTP (on the TV, port of the dashboard):

| | |
|---|---|
| `GET /plugins` | list, safe-mode flag, plugin folder, list URL |
| `POST /plugins/install` | body: bundle text; optional header `X-Vetro-Sha256` |
| `POST /plugins/<id>/enable` · `disable` · `remove` | |
| `POST /plugins/resume` | leave safe mode (takes effect after a restart of Vetro) |
| `* /plugins/<id>/api/<sub>` | your `route()` |

Bundle: `{ "format": "vetro-plugin", "version": 1, "manifest": {…}, "files": { "index.js": "…" } }`.

## What the host guarantees

- A plugin is off until switched on; the choice survives restarts. Installing or updating switches it off.
  Its code is not even read until then: installing, listing, safe mode and booting with it off never run anything of it.
- Calls into a plugin are guarded; 3 consecutive errors switch it off. Errors thrown later inside your
  own callbacks or promises are **not** caught: handle them yourself.
- A boot that does not stay up for 60 s puts the next one in safe mode (plugins paused until resumed). In safe
  mode the plugins are still listed, so you can switch off or remove the culprit before resuming.
- A plugin whose `start()` throws gets `stop()` called so it can release what it took, and is marked Failed.
- Not done yet: if an update installs but its `start()` fails, the previous version is not restored automatically (the plugin shows Failed; install the old bundle again).
- A plugin cannot take a Vetro route; it only gets `/plugins/<id>/api/...`.
- This is fault isolation, **not** a security sandbox: a plugin runs inside Vetro's process. Only paired devices can install,
  switch on or remove plugins (`SIGN-IN.md`), and a plugin page gets a session limited to its own routes; but a plugin you
  switch on has the same power as Vetro's service. Installing one is a trust decision.

## Troubleshooting

| | |
|---|---|
| "Invalid" in the list, with a reason | the folder or bundle failed a check; fix it, `pack`, install again |
| `SHA-256 does not match` | the file changed after the list was written, or the CDN has not caught up yet |
| "The plugin list is not published yet" | the list repository does not exist (404) |
| "Could not reach the plugin list" | the browser has no internet, or a blocker stops `raw.githubusercontent.com` |
| "Failed" | it could not start, or 3 errors in a row; the message shows the last one. Switch it on again after fixing |
| plugins "Suspended" | safe mode: Vetro did not stay up last time. Resume, then restart Vetro |
