'use strict';
// Vetro TV Tuner as a bundled plugin, built the same way as the launcher (plugin-launcher.js, docs/PLUGIN-ARCHITECTURE.md).
//
// The plugin owns the supervision timer that starts the tuner again after a boot or a crash while its switch is on, and the
// routes the dashboard uses. The Tuner object itself (tuner.js) stays in main.js because the updater stops and restarts the
// process around an update. Switching the plugin on or off only starts or stops the supervision: the tuner has its own
// switch (POST api/action), which also decides whether Samsung's live TV app is covered, so stopping the plugin never kills it.
//
//   GET  api/status   the tuner's state                                         (/tuner/status)
//   POST api/action   {action: enable|disable|show|hide|toggle|guide|feature, name, on}
//
// Plain ES5, like every module the TV loads.

var TICK_MS = 2000;          // how often the supervision looks at the root agent
var ROUND_TICKS = 5;         // every 5th tick (10 s) the tuner is checked even if nothing changed

// tuner: a Tuner from tuner.js. options.tickMs: the supervision interval (tests). What the plugin needs from the shell comes in
// ctx.vetro (bundled plugins only): agentConnected(), json(res, obj, code), readJson(req, res, cb).
function definition(tuner, options) {
    var tickMs = options && options.tickMs || TICK_MS;
    return {
        id: 'tuner',
        name: 'Vetro TV Tuner',
        version: '1.0.0',
        apiVersion: 1,
        bundled: true,
        author: 'Vetro',
        description: 'Watch live TV with Vetro’s own tuner on screen instead of Samsung’s. Samsung’s tuner is covered while this is on, never removed.',
        permissions: ['exec'],     // it runs root commands through the agent; a label, as for every plugin
        create: function (ctx) {
            var vetro = ctx.vetro, timer = null, agentWas = false, ticks = 0;

            function tick() {
                var up = !!vetro.agentConnected(), edge = up && !agentWas;
                agentWas = up;
                if (edge || ++ticks >= ROUND_TICKS) {
                    ticks = 0;
                    tuner.supervise(up).catch(function () { /* the next round tries again */ });
                }
            }

            function action(p) {
                if (p.action === 'enable') return tuner.enable();
                if (p.action === 'disable') return tuner.disable();
                if (p.action === 'feature') return tuner.setFeature(p.name, p.on !== false);
                if (p.action === 'show' || p.action === 'hide' || p.action === 'toggle' || p.action === 'guide') return tuner.command(p.action);
                return Promise.reject(new Error('Invalid tuner action'));
            }

            return {
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
                    return { enabled: !!tuner.readState().enabled, installed: tuner.installed() };
                },
                route: function (req, res, sub) {
                    if (sub === 'status' && req.method === 'GET') {
                        tuner.status().then(function (d) { vetro.json(res, d); })
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
                    return false;
                }
            };
        }
    };
}

module.exports = { definition: definition, TICK_MS: TICK_MS };
