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
//   POST api/action   {action: enable|disable|refresh|fixTizenTube|noMotion|cards|resetRow|appStore|enableCustom|disableCustom, on, cards, store, appId}     (was POST /dock)
//   GET  api/icon     ?slug=<tile>  the PNG of a tile                       (was GET /dock/icon)
//   GET  api/card        ?plugin=<id>  the Control center card of a Shard, as text lines (the launcher has no JSON parser): see dock.js shardCardText
//   POST api/card-select ?plugin=<id>&row=<row id>  choose a row of that card; answers the card as it is after the choice
//   POST api/open     ?slug=<tile>  start the app of a tile a plugin has taken over (the launcher calls this; answers 202 at once)
//   POST api/row      {row: [key...]}  the launcher's row as the user left it (moved, taken out, added from All apps)
//   POST api/relist   an app was installed or removed: the launcher asks for its lists again (answers 202 at once)
//
// Plain ES5, like every module the TV loads.

// ?slug=... read straight from the query string: the one parameter does not need a URL parser.
var homeCleanup = require('./home-cleanup.js');

var SLUG_QUERY_RE = /[?&]slug=([^&#]*)/;
var PLUGIN_QUERY_RE = /[?&]plugin=([^&#]*)/, ROW_QUERY_RE = /[?&]row=([^&#]*)/;
function queryOf(re, rawUrl) {
    var m = re.exec(rawUrl || '');
    if (!m) return undefined;
    try { return decodeURIComponent(m[1].replace(PLUS_RE, ' ')); } catch (e) { return undefined; }
}
var PLUS_RE = /\+/g;
function slugOf(rawUrl) {
    var m = SLUG_QUERY_RE.exec(rawUrl || '');
    if (!m) return undefined;
    try { return decodeURIComponent(m[1].replace(PLUS_RE, ' ')); } catch (e) { return undefined; }
}

var TICK_MS = 2000;          // how often the supervision looks at the root agent
var ROUND_TICKS = 5;         // every 5th tick (10 s) the launcher is checked even if nothing changed
// Once it has been seen running a few rounds in a row nothing changes for hours, so the check slows down: 10 s, then 30 s, then
// 60 s, never longer, so a crash is still noticed within a minute. Back to 10 s at once after anything that changes it: an
// action from the dashboard, the root agent coming back, a round that did not find it running (a failure, a start), and any
// start or stop of the process (its `changes` counter, which also covers the restart after an update).
var SLOW_AFTER = 3;          // rounds in a row found running before each step
function roundTicks(streak) { return streak < SLOW_AFTER ? ROUND_TICKS : streak < 2 * SLOW_AFTER ? 15 : 30; }

// dock: a Dock from dock.js. options.tickMs: the supervision interval (tests). Everything else the plugin needs from the shell comes in ctx.vetro (bundled plugins only):
//   agentConnected()          whether the root agent is connected
//   json(res, obj, code)      Vetro's JSON answer
//   readJson(req, res, cb)    reads and checks a JSON object body, answers 400/408/413 itself
function definition(dock, options) {
    var tickMs = options && options.tickMs || TICK_MS;
    var timers = options && options.timers || {setInterval: function (f, ms) { return setInterval(f, ms); }, clearInterval: function (t) { clearInterval(t); }};
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
            var vetro = ctx.vetro, timer = null, agentWas = false, hadAgent = false, ticks = 0, streak = 0, seenChanges = dock.changes;

            function tick() {
                var up = !!vetro.agentConnected(), edge = up && !agentWas;
                if (edge) {
                    if (hadAgent && typeof dock.noteWake === 'function') dock.noteWake();
                    hadAgent = true;
                }
                agentWas = up;
                if (edge || dock.changes !== seenChanges) { seenChanges = dock.changes; streak = 0; }
                if (edge || ++ticks >= roundTicks(streak)) {
                    ticks = 0;
                    Promise.resolve(dock.supervise(up)).then(function (result) { streak = result === 'running' ? streak + 1 : 0; },
                        function () { streak = 0; /* the next round tries again */ });
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
                if (p.action === 'hdrDim') return dock.setHdrDim(p.on);
                if (p.action === 'hdrBrightness') return dock.setHdrBrightness(p.brightness);
                if (p.action === 'closeIdleHome') return dock.setCloseIdleHome(p.on);
                if (p.action === 'volumePill') return dock.setVolumePill(p.on);
                if (p.action === 'volumeEdge') return dock.setVolumeEdge(p.edge);
                if (p.action === 'numberPad') return dock.setNumberPad(p.on);
                if (p.action === 'cards') return dock.setCards(p.cards);
                if (p.action === 'resetRow') return dock.resetRow();
                if (p.action === 'appStore') return dock.setAppStore(p.store);
                if (p.action === 'showHomeSources' || p.action === 'useSourceImages' || p.action === 'connectedSourcesOnly' || p.action === 'hideTvSource') return dock.setSourceOption(p.action, p.on);
                if (p.action === 'enableCustom') return dock.enableCustom(p.appId);
                if (p.action === 'disableCustom') return dock.disableCustom();
                return Promise.reject(new Error('Invalid dock action'));
            }

            return {
                // Switching the plugin on or off only starts or stops the supervision. The launcher process has its own
                // switch (POST api/action), which also handles Samsung's autorun, so stopping here never kills it.
                start: function () {
                    if (timer) return;
                    agentWas = false; hadAgent = false; ticks = 0; streak = 0;
                    timer = timers.setInterval(tick, tickMs);
                    if (timer && timer.unref) timer.unref();
                },
                stop: function () {
                    if (timer) timers.clearInterval(timer);
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
                        streak = 0;
                        vetro.readJson(req, res, function (p) {
                            action(p).then(function (d) { vetro.json(res, d); })
                                .catch(function (e) { vetro.json(res, { ok: false, error: e.message }, 409); });
                        });
                        return true;
                    }
                    // The launcher asks for this when a plugin has taken a tile over (a seventh column "shard" in its list). Answers at once
                    // and starts the app afterwards: a plugin may need a minute to get ready, and the launcher must not wait or start it too.
                    // When the root agent is disconnected (boot, standby wake, channel drop), refuse with 503 so the launcher immediately
                    // falls back to app_launcher -s instead of leaving a dead tile behind a 202.
                    if (sub === 'open' && req.method === 'POST') {
                        var slug = slugOf(req.url);
                        if (!dock.shardEntry(slug)) { vetro.json(res, { ok: false, error: 'No plugin tile with that name' }, 404); return true; }
                        if (typeof vetro.agentConnected === 'function' && !vetro.agentConnected()) {
                            vetro.json(res, { ok: false, error: 'Root agent is not connected' }, 503);
                            return true;
                        }
                        vetro.json(res, { ok: true }, 202);
                        dock.openEntry(slug).catch(function () { /* openEntry never rejects; belt and braces */ });
                        return true;
                    }
                    // A Shard's Control center card. Always 200 with text, even when the Shard is off or fails ("status unavailable"): the launcher
                    // reads the answer, never an HTTP error. The Shard's own code runs here, in the service, behind the plugin host's checks and timeouts.
                    if ((sub === 'card' && req.method === 'GET') || (sub === 'card-select' && req.method === 'POST')) {
                        var shard = queryOf(PLUGIN_QUERY_RE, req.url), work = sub === 'card' ? dock.shardCardRead(shard) : dock.shardCardSelect(shard, queryOf(ROW_QUERY_RE, req.url));
                        work.then(function (text) {
                            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                            res.end(text);
                        }).catch(function () { vetro.json(res, { error: 'card unavailable' }, 500); });
                        return true;
                    }
                    // The launcher sends its row after the user moved a tile, took one out or added one from All apps (row keys in order).
                    if (sub === 'row' && req.method === 'POST') {
                        vetro.readJson(req, res, function (p) {
                            dock.setRow(p && p.row).then(function () { vetro.json(res, { ok: true }); })
                                .catch(function (e) { vetro.json(res, { ok: false, error: e.message }, 409); });
                        });
                        return true;
                    }
                    // The launcher came on screen and found the package manager's database newer than its lists (an app was installed or
                    // removed). It does not wait: the lists are read again here and the launcher is told to reload them when they changed.
                    if (sub === 'relist' && req.method === 'POST') {
                        vetro.json(res, { ok: true }, 202);
                        dock.relist().catch(function () { /* the next time the launcher comes on screen it asks again */ });
                        return true;
                    }
                    if (sub === 'icon' && req.method === 'GET') {
                        var png = dock.iconFile(slugOf(req.url));
                        if (!png) { vetro.json(res, { error: 'icon unavailable' }, 404); return true; }
                        // A tile's picture can change when the list is rebuilt, so it stays a minute in the browser; after that the
                        // browser asks again with the ETag and an unchanged picture is a 304 without the image.
                        var etag = '"' + require('crypto').createHash('sha1').update(png).digest('hex').slice(0, 20) + '"';
                        var headers = { 'content-type': (dock.constructor && dock.constructor.imageType && dock.constructor.imageType(png)) || 'image/png', 'cache-control': 'private, max-age=60', 'etag': etag, 'X-Content-Type-Options': 'nosniff' };
                        if (req.headers && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
                        headers['content-length'] = png.length;
                        res.writeHead(200, headers);
                        res.end(png);
                        return true;
                    }
                    return false;
                }
            };
        }
    };
}

module.exports = { definition: definition, TICK_MS: TICK_MS, roundTicks: roundTicks };
