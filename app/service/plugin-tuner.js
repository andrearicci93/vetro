'use strict';
// Vetro TV Tuner as a bundled plugin, built the same way as the launcher (plugin-launcher.js, docs/PLUGIN-ARCHITECTURE.md).
//
// The plugin owns the supervision timer that starts the tuner again after a boot or a crash while its switch is on, and the
// routes the dashboard uses. The Tuner object itself (tuner.js) stays in main.js because the updater stops and restarts the
// process around an update. Switching the plugin on or off only starts or stops the supervision: the tuner has its own
// switch (POST api/action), which also decides whether Samsung's live TV app is covered, so stopping the plugin never kills it.
//
//   GET  api/status   the tuner's state                                         (/tuner/status)
//   POST api/action   {action: enable|disable|show|hide|toggle|guide}
//
// Plain ES5, like every module the TV loads.

var TICK_MS = 2000;          // how often the supervision looks at the root agent
var ROUND_TICKS = 5;         // every 5th tick (10 s) the tuner is checked even if nothing changed
// Once it has been seen running a few rounds in a row nothing changes for hours, so the check slows down: 10 s, then 30 s, then
// 60 s, never longer, so a crash is still noticed within a minute. Back to 10 s at once after anything that changes it: an
// action from the dashboard, the root agent coming back, a round that did not find it running (a failure, a start), and any
// start or stop of the process (its `changes` counter, which also covers the restart after an update).
var SLOW_AFTER = 3;          // rounds in a row found running before each step
function roundTicks(streak) { return streak < SLOW_AFTER ? ROUND_TICKS : streak < 2 * SLOW_AFTER ? 15 : 30; }

// tuner: a Tuner from tuner.js. options.tickMs: the supervision interval (tests). What the plugin needs from the shell comes in
// ctx.vetro (bundled plugins only): agentConnected(), json(res, obj, code), readJson(req, res, cb).
function definition(tuner, options) {
    var tickMs = options && options.tickMs || TICK_MS;
    var timers = options && options.timers || {setInterval: function (f, ms) { return setInterval(f, ms); }, clearInterval: function (t) { clearInterval(t); }};
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
            var vetro = ctx.vetro, timer = null, agentWas = false, ticks = 0, streak = 0, seenChanges = tuner.changes;

            function tick() {
                var up = !!vetro.agentConnected(), edge = up && !agentWas;
                agentWas = up;
                if (edge || tuner.changes !== seenChanges) { seenChanges = tuner.changes; streak = 0; }
                if (edge || ++ticks >= roundTicks(streak)) {
                    ticks = 0;
                    Promise.resolve(tuner.supervise(up)).then(function (result) { streak = result === 'running' ? streak + 1 : 0; },
                        function () { streak = 0; /* the next round tries again */ });
                }
            }

            function action(p) {
                if (!p || typeof p !== 'object') return Promise.reject(new Error('Invalid tuner action'));
                if (p.action === 'enable') return tuner.enable();
                if (p.action === 'disable') return tuner.disable();
                if (p.action === 'show' || p.action === 'hide' || p.action === 'toggle' || p.action === 'guide') return tuner.command(p.action);
                return Promise.reject(new Error('Invalid tuner action'));
            }

            return {
                start: function () {
                    if (timer) return;
                    agentWas = false; ticks = 0; streak = 0;
                    timer = timers.setInterval(tick, tickMs);
                    if (timer && timer.unref) timer.unref();
                },
                stop: function () {
                    if (timer) timers.clearInterval(timer);
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
                        streak = 0;
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

module.exports = { definition: definition, TICK_MS: TICK_MS, roundTicks: roundTicks };
