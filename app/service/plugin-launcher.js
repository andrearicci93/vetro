'use strict';
// The Vetro launcher as a bundled plugin (docs/PLUGIN-ARCHITECTURE.md, step 2).
//
// What moved here from main.js: the supervision timer that starts the launcher again after a boot or a crash, and the
// three routes that the dashboard and scripts use. What did not move: the Dock object itself (dock.js), because the
// updater still stops and restarts the launcher around an update; that goes through the plugin's own hooks later.
//
// The old URLs keep working: main.js forwards /dock and /dock/icon to the routes below with host.dispatch(), so no
// client changes. The same routes are also reachable as /plugins/launcher/api/<sub>.
//
//   GET  api/status   the launcher's state and the preview of its list      (was GET /dock)
//   POST api/action   {action: enable|disable|refresh|fixTizenTube|noMotion|taskManager|enableCustom|disableCustom, on, appId}     (was POST /dock)
//   GET  api/icon     ?slug=<tile>  the PNG of a tile                       (was GET /dock/icon)
//   POST api/open     ?slug=<tile>  start the app of a tile a plugin has taken over (the launcher calls this; answers 202 at once)
//
// Plain ES5, like every module the TV loads.

// ?slug=... read straight from the query string: the one parameter does not need a URL parser.
var homeCleanup = require('./home-cleanup.js');

var SLUG_QUERY_RE = /[?&]slug=([^&#]*)/;
var PLUS_RE = /\+/g;
function slugOf(rawUrl) {
    var m = SLUG_QUERY_RE.exec(rawUrl || '');
    if (!m) return undefined;
    try { return decodeURIComponent(m[1].replace(PLUS_RE, ' ')); } catch (e) { return undefined; }
}

var TICK_MS = 2000;          // how often the supervision looks at the root agent
var ROUND_TICKS = 5;         // every 5th tick (10 s) the launcher is checked even if nothing changed

// dock: a Dock from dock.js. options.tickMs: the supervision interval (tests). Everything else the plugin needs from the shell comes in ctx.vetro (bundled plugins only):
//   agentConnected()          whether the root agent is connected
//   json(res, obj, code)      Vetro's JSON answer
//   readJson(req, res, cb)    reads and checks a JSON object body, answers 400/408/413 itself
function definition(dock, options) {
    var tickMs = options && options.tickMs || TICK_MS;
    return {
        id: 'launcher',
        name: 'Launcher',
        version: '1.1.0',
        apiVersion: 1,
        bundled: true,
        author: 'Vetro',
        description: 'The minimal launcher that replaces Samsung\'s Home while it is switched on.',
        permissions: ['exec'],     // it runs root commands through the agent; a label, as for every plugin
        create: function (ctx) {
            var vetro = ctx.vetro, timer = null, agentWas = false, ticks = 0;

            function tick() {
                var up = !!vetro.agentConnected(), edge = up && !agentWas;
                agentWas = up;
                if (edge || ++ticks >= ROUND_TICKS) {
                    ticks = 0;
                    dock.supervise(up).catch(function () { /* the next round tries again */ });
                }
            }

            // "Rebuild the list" also takes the Home lines of apps that are gone out of Samsung's Home row (left by uninstalls made
            // with pkgcmd): the launcher's list is built from that row, so this is the one place a user looks when a tile is dead.
            // A failure here never stops the rebuild.
            function rebuild() {
                var sweep = typeof dock.execute === 'function' ? homeCleanup.sweep(dock.execute).catch(function () { return null; }) : Promise.resolve(null);
                return sweep.then(function (cleaned) {
                    return dock.refresh().then(function (status) {
                        return cleaned && cleaned.found && cleaned.found.length ? Object.assign({}, status, {cleaned: cleaned}) : status;
                    });
                });
            }

            function action(p) {
                if (p.action === 'enable') return dock.enable();
                if (p.action === 'disable') return dock.disable();
                if (p.action === 'refresh') return rebuild();
                if (p.action === 'fixTizenTube') return dock.setFixTizenTube(p.on);
                if (p.action === 'noMotion') return dock.setNoMotion(p.on);
                if (p.action === 'volumePill') return dock.setVolumePill(p.on);
                if (p.action === 'volumeEdge') return dock.setVolumeEdge(p.edge);
                if (p.action === 'numberPad') return dock.setNumberPad(p.on);
                if (p.action === 'taskManager') return dock.setTaskManager(p.on);
                if (p.action === 'showHomeSources' || p.action === 'useSourceImages') return dock.setSourceOption(p.action, p.on);
                if (p.action === 'enableCustom') return dock.enableCustom(p.appId);
                if (p.action === 'disableCustom') return dock.disableCustom();
                return Promise.reject(new Error('Invalid dock action'));
            }

            return {
                // Switching the plugin on or off only starts or stops the supervision. The launcher process has its own
                // switch (POST api/action), which also handles Samsung's autorun, so stopping here never kills it.
                start: function () {
                    if (timer) return;
                    agentWas = false; ticks = 0;
                    timer = setInterval(tick, tickMs);
                    if (timer.unref) timer.unref();
                },
                stop: function () {
                    if (timer) clearInterval(timer);
                    timer = null;
                },
                status: function () {
                    var state = dock.readState();
                    return { enabled: !!state.enabled || !!state.customApp, installed: dock.installed() };
                },
                route: function (req, res, sub) {
                    if (sub === 'status' && req.method === 'GET') {
                        dock.status({ preview: true }).then(function (d) { vetro.json(res, d); })
                            .catch(function (e) { vetro.json(res, { error: e.message }, 503); });
                        return true;
                    }
                    if (sub === 'action' && req.method === 'POST') {
                        vetro.readJson(req, res, function (p) {
                            action(p).then(function (d) { vetro.json(res, d); })
                                .catch(function (e) { vetro.json(res, { ok: false, error: e.message }, 409); });
                        });
                        return true;
                    }
                    // The launcher asks for this when a plugin has taken a tile over (a seventh column "shard" in its list). Answers at once
                    // and starts the app afterwards: a plugin may need a minute to get ready, and the launcher must not wait or start it too.
                    if (sub === 'open' && req.method === 'POST') {
                        var slug = slugOf(req.url);
                        if (!dock.shardEntry(slug)) { vetro.json(res, { ok: false, error: 'No plugin tile with that name' }, 404); return true; }
                        vetro.json(res, { ok: true }, 202);
                        dock.openEntry(slug).catch(function () { /* openEntry never rejects; belt and braces */ });
                        return true;
                    }
                    if (sub === 'icon' && req.method === 'GET') {
                        var png = dock.iconFile(slugOf(req.url));
                        if (!png) { vetro.json(res, { error: 'icon unavailable' }, 404); return true; }
                        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
                        res.end(png);
                        return true;
                    }
                    return false;
                }
            };
        }
    };
}

module.exports = { definition: definition, TICK_MS: TICK_MS };
