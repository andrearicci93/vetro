'use strict';
// Vetro application: telemetry, dashboard and feature endpoints.
// Platform operations use the adapter documented in PLATFORM.md.
// Tizen 5.5 runs Node 4.4: add the built-ins it lacks before anything else loads.
require('./compat.js').install();
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var atomicFile = require('./atomic-file.js');
var MqttBridge = require('./mqtt-bridge.js').MqttBridge;
var PluginHost = require('./plugin-host.js').PluginHost;
var Updater = require('./updater.js').Updater;
var debloat = require('./debloat.js');
var control = require('./control.js');
var packageInfo = require('./package-info.js');
var platform = require('./platform.js');
var buildInfo = require('./build-info.js');
var apps = require('./apps.js');
var probe = require('./probe.js');
var remap = require('./remap.js');
var settings = require('./settings.js');
var TVSettings = require('./tv-settings.js').Store;
var AppRegistry = require('./app-registry.js');
var PhysicalInput = require('./physical-input.js').Bridge;
var renderDashboard = require('./dashboard.js');
var SystemMonitor = require('./system-monitor.js').Monitor;
// Regular expressions compiled once at module load, not on every call.
var WHITESPACE_RE = /\s+/;
var PROCESSOR_LINE_RE = /^processor/mg;
var CPU_TOTAL_LINE_RE = /^cpu /;
var CPU_CORE_LINE_RE = /^cpu[0-9]/;
var THERMAL_ZONE_RE = /^thermal_zone\d+$/;
var THERMAL_DEVICE_RE = /thermal$/;
var APP_ID_RE = /^[A-Za-z0-9_.-]+$/;
var DIAGNOSTICS_QUERY_RE = /(?:\?|&)diagnostics=1(?:&|$)/;
var REFRESH_QUERY_RE = /(?:\?|&)refresh=1(?:&|$)/;
var APP_ID_QUERY_RE = /[?&]appId=([^&#]*)/;
var PLUS_RE = /\+/g;
var APP_ID_120_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var WHITESPACE_CHAR_RE = /\s/g;
var FORMAT_QUERY_RE = /(?:^|&)format=(hosts|domains)(?:&|$)/;
var KEY_CAPABILITY_RE = /[1-9a-f]/i;
var PLUGIN_SESSION_API_RE = /^\/plugins\/[^\/]+\/s\/[0-9a-f]{32}\/api(?:\/|$)/;
var COMPONENTS_QUERY_RE = /(?:\?|&)components=1(?:&|$)/;
var MENU_ID_QUERY_RE = /[?&]id=([^&]+)/;
var SCOPE_QUERY_RE = /[?&]scope=([^&]*)/;
var MONITOR_SCOPE_RE = /^(summary|full)$/;
var monitor = new SystemMonitor(agentExecute);
var ComponentActions = require('./component-actions.js');
var dnsFilter = new (require('./local-dns.js').Filter)(agentExecute);
var homeOrder = new (require('./home-order.js').Order)(agentExecute);
// Custom launcher mode needs a look at the chosen app in the registry, and a way to put Samsung's Home back when an
// earlier build of the mode had disabled it (the mode itself never disables it any more: the boot of the TV waits for it).
var dockModule = require('./dock.js');
var dock = new dockModule.Dock({execute: agentExecute,
    home: {
        restore: function () { return applySamsungHome(false); }
    },
    shortcutCheck: function (appId, fresh) {
        return inventory(!!fresh).then(function (d) {
            if (d.registryError) throw new Error('App registry unavailable');
            return {ok: d.apps.some(function (a) { return a.appId === appId && a.show && a.disabled === false && !a.launchRisk && !/^vetrotvapp(\.|$)/.test(a.appId); })};
        });
    },
    appCheck: function (appId, fresh) {
        return inventory(!!fresh).then(function (d) {
            if (d.registryError) throw new Error('App registry unavailable');
            return dockModule.customAppCheck(d.apps, appId, !!fresh);
        });
    }});
var hbbtv = new (require('./hbbtv.js').Control)(agentExecute);
// #135: factory, hotel and shop apps, and the Aging key AgingApp can leave at 1 (factory-apps.js).
var factoryApps = require('./factory-apps.js');
var factoryTest = new factoryApps.FactoryTest(agentExecute);
var wins = new (require('./quick-wins.js').Wins)(agentExecute, {dns: dnsFilter});
// Apps removed through Vetro stay removed (keep-removed.js; idea and mechanism by zabique, github.com/zabique/vetro).
var keepRemoved = new (require('./keep-removed.js').KeepRemoved)(agentExecute);
var presence = new (require('./presence.js').Presence)(agentExecute);
var tvState = new (require('./tv-state.js').Store)(agentExecute);
var privacy = new (require('./privacy.js').Privacy)(agentExecute);
var menuSettings = new (require('./menu-settings.js').Catalog)(agentExecute);
var quickSettings = require('./quick-settings.js');
var disabledLedger = require('./disabled-ledger.js');
var leftovers = new (require('./leftovers.js').Leftovers)(agentExecute);
// Components whose disabled flag Vetro may change: verified ACR set plus Quick Settings groups.
var TOGGLE_IDS = debloat.VERIFIED_GLOBAL_IDS.concat(quickSettings.ALLOWED_IDS);
// The package builder writes a non-default port into build-info.js (VETRO_PORT=... node build.cjs);
// VETRO_PORT at run time still wins for local runs.
var PORT = Number(process.env.VETRO_PORT) || buildInfo.port || 8099;
// Tasks that wait for the root agent after a boot (DNS filter, quick wins, keep-removed check, Vetro's own startup flags) try every
// 5 s for this many rounds. The agent can take minutes to come up; the DNS filter used to give up after one (12 rounds).
var BOOT_RETRIES = 60;

// --- telemetry reader (service side, uid 5001) ---------------------------
// Reads /proc and /sys directly via fs. No platform command is needed. Every read
// is best-effort: a missing or unreadable path yields null and degrades
// gracefully instead of failing the whole endpoint.
function tryRead(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch (e) { return null; } }
function tryReadRaw(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }

function readTelemetry() {
    var out = {
        ts: Math.floor(Date.now() / 1000),
        boot_id: tryRead('/proc/sys/kernel/random/boot_id'),
        hostname: tryRead('/etc/hostname'),
        loadavg: tryRead('/proc/loadavg'),
        cpu_online: tryRead('/sys/devices/system/cpu/online'),
        cpu_gov: tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
        zram_mm_stat: tryRead('/sys/block/zram0/mm_stat')
    };

    var up = tryRead('/proc/uptime');
    if (up) out.uptime_s = parseFloat(up.split(WHITESPACE_RE)[0]);
    else out.uptime_s = null;

    var cpuinfo = tryReadRaw('/proc/cpuinfo');
    if (cpuinfo) out.cpu_cores = (cpuinfo.match(PROCESSOR_LINE_RE) || []).length;
    else out.cpu_cores = null;

    var freq = tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
    if (freq) out.cpu_freq_khz = parseInt(freq, 10);
    else out.cpu_freq_khz = null;

    var meminfo = tryReadRaw('/proc/meminfo');
    if (meminfo) out.meminfo = meminfo.split('\n').join(';');
    else out.meminfo = null;

    var stat = tryReadRaw('/proc/stat');
    if (stat) {
        out.cpu_stat = (stat.split('\n').filter(function (l) { return CPU_TOTAL_LINE_RE.test(l); })[0] || '').trim();
        out.cpu_percpu = stat.split('\n').filter(function (l) { return CPU_CORE_LINE_RE.test(l); }).join(';');
    } else {
        out.cpu_stat = null;
        out.cpu_percpu = null;
    }

    var temp = null;
    ['/sys/class/thermal', '/sys/devices/virtual/thermal'].forEach(function (dir) {
        if (temp) return;
        var zones = [];
        try { zones = fs.readdirSync(dir).filter(function (n) { return THERMAL_ZONE_RE.test(n); }).sort(); } catch (e) { zones = []; }
        zones.forEach(function (zone) { if (!temp) temp = tryRead(dir + '/' + zone + '/temp'); });
    });
    // Samsung's TVs have no Linux thermal zones (nothing under /sys/class/thermal): the SoC driver exposes the
    // temperature in whole degrees, as <soc>/<name>.thermal/temperature (56 on a Q80A), readable by everyone.
    if (!temp) {
        var soc = '/sys/devices/platform/soc', names = [];
        try { names = fs.readdirSync(soc).filter(function (n) { return THERMAL_DEVICE_RE.test(n); }).sort(); } catch (e) { names = []; }
        names.forEach(function (n) { if (!temp) temp = tryRead(soc + '/' + n + '/temperature'); });
    }
    if (temp) { var t = parseInt(temp, 10); out.soctemp_c = (t > 1000) ? (t / 1000) : t; }
    else out.soctemp_c = null;

    return out;
}

// What the TV screen shows. The launcher's pid check is the only root command, and it runs only while the launcher is on.
function screenSummary() {
    var launcherState = dock.readState(), p = platform.status();
    launcherState.enabled = launcherState.enabled || !!launcherState.customApp;     // the TV screen shows either launcher as "on"
    var checkLauncher = launcherState.enabled && p.agent.connected ? dock.probe().then(function (r) { return r.running; }, function () { return null; }) : Promise.resolve(null);
    return checkLauncher.then(function (running) {
        return require('./screen-status.js').build({version: buildInfo.version, port: PORT, platform: p, input: inputSnapshot(),
            launcher: {installed: dock.installed(), enabled: launcherState.enabled, running: running, failures: dock.failures, error: !!dock.lastError},
            meminfo: tryReadRaw('/proc/meminfo'), interfaces: os.networkInterfaces()});
    });
}

// --- HTTP routing ---------------------------------------------------------
function serveJson(res, obj, code) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code || 200, { 'content-type': 'application/json; charset=utf-8',
        'connection': code === 413 || code === 408 ? 'close' : 'keep-alive' });
    res.end(JSON.stringify(obj, null, 2) + '\n');
}

function serveHtml(res, html) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
}

function dashboardHtml() { return renderDashboard(); }

var diagnosticPending = null, diagnosticComponents = false;
function downloadDiagnostics(res, withComponents) {
    // The CPU rate needs a second sample 1.5 s after the first, and the TV runs its commands one after the other:
    // read together, the sample waited behind the 13 s startup listing and came back without a rate (4 of 7 reports).
    // The other reads start once the second sample is queued, so it runs right after the first.
    function later(fn) { return function () { return new Promise(function (r) { setTimeout(r, 1700); }).then(fn); }; }
    withComponents = withComponents === true;
    // A plain download never joins one that is already reading the manifests, and the other way round.
    if (diagnosticPending && diagnosticComponents !== withComponents) return diagnosticPending.then(function () { return downloadDiagnostics(res, withComponents); }, function () { return downloadDiagnostics(res, withComponents); });
    diagnosticComponents = withComponents;
    if (!diagnosticPending) diagnosticPending = require('./diagnostic-report.js').collect({
        platform: function () { return platform.status(); },
        // The widget's probe wins. The service adds the firmware and Tizen version it reads itself; that read starts at once
        // (a few milliseconds, ahead of the slow ones) and gives up after 8 s, so it can only add to the probe.
        device: function () {
            var info = require('./device-info.js');
            return info.merge(Object.assign({}, state.settings || {}, {receivedAt: state.receivedAt}), agentExecute, 8000, info.httpGet);
        },
        inventory: later(function () { return inventory(false); }),
        settings: later(function () { return tvSettings.read(); }),
        catalog: later(function () { return menuSettings.load(); }),
        monitor: function () { return require('./diagnostic-report.js').twoSamples(function (force) { return monitor.snapshot('full', force); }, 1500, 16000).then(function(d){return Object.assign({},d,{telemetry:readTelemetry()});}); },
        startup: later(function () { return monitor.startup({wait: 45000}); }),
        network: later(function () { return tvSettings.readNetwork(); }),
        dns: later(function () { return dnsFilter.status(); }),
        mqtt: function () { return bridge.status(); },
        privacy: later(function () { return privacy.read(); }),
        hbbtv: later(function () { return hbbtv.read(); }),
        // The collector treats a truthy "error" as an unreadable section; the launcher keeps its last error there.
        launcher: later(function () { return dock.status().then(function (d) { return Object.assign({}, d, {error: null, hasError: !!d.error}); }); }),
        quickWins: later(function () { return wins.read(); }),
        factoryTest: later(function () { return factoryTest.read(); }),
        // Opt-in: the manifests of the components the catalog does not know. Without the box ticked the section says so.
        components: withComponents
            ? later(function () { return inventory(false).then(function (inv) { return require('./component-facts.js').read(agentExecute, inv.apps); }); })
            : function () { throw require('./exec-error.js').coded('not-requested', 'not requested'); },
        probe: function () { return state; },
        serviceApis: serviceApiProbe
    }).finally(function () { diagnosticPending = null; });
    return diagnosticPending.then(function (report) {
        if (res.destroyed || res.writableEnded) return;
        res.setHeader('Content-Disposition', 'attachment; filename="vetro-diagnostics.json"');
        res.setHeader('Cache-Control', 'no-store');
        serveJson(res, report);
    }).catch(function () { serveJson(res, {error:'Diagnostic export unavailable'}, 503); });
}

// --- app installation through the platform adapter -------------------------
var installPending = 0;
function handleInstall(req, res) {
    readJsonBody(req, res, function (parsed) {
        packageInfo.read(parsed.path).then(function (info) {
            installPending++;
            return platform.install(info.packageId, parsed.path).finally(function () { installPending--; }).then(function (output) {
                serveJson(res, {submitted: true, verified: false, packageId: info.packageId,
                    output: output, note: 'installation outcome requires verification on the TV'}, 202);
            }).catch(function (error) {
                serveJson(res, {submitted: error.submitted === false ? false : null, verified: false,
                    error: String(error.message || error), note: 'verify installation outcome before retrying'}, 503);
            });
        }).catch(function (error) {
            serveJson(res, {submitted: false, error: String(error.message || error)}, 400);
        });
    });
}

// --- self-update ------------------------------------------------------------
// The bundle is a signed text file (about 1.5 MB). It is checked here against the key built into the package.
function handleUpdate(req, res, apply) {
    readBody(req, function (body, err) {
        if (err) return serveJson(res, {ok: false, error: err.message}, err.statusCode || 400);
        var sha = req.headers && req.headers['x-vetro-sha256'];
        var task;
        try { task = apply ? updater.apply(body, sha) : Promise.resolve(updater.check(body, sha)); } catch (e) { task = Promise.reject(e); }
        task.then(function (d) { serveJson(res, d); }, function (e) {
            serveJson(res, {ok: false, error: e.message, code: e.code || null}, e.code === 'busy' ? 409 : 400);
        });
    }, 8 * 1024 * 1024);
}

function readBody(req, cb, maxBytes) {
    maxBytes = maxBytes || 65536;
    var chunks = [], size = 0, finished = false;
    var timer = setTimeout(function () { fail('request body timeout', 408); }, 10000);
    function finish(body, err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chunks = [];
        cb(body, err);
    }
    function fail(message, code) {
        var error = new Error(message);
        error.statusCode = code;
        finish(null, error);
        if (req.resume) req.resume();
    }
    req.on('data', function (c) {
        if (finished) return;
        size += c.length;
        if (size > maxBytes) return fail('request body exceeds ' + (maxBytes / 1024) + ' KiB', 413);
        chunks.push(c);
    });
    req.on('end', function () {
        if (!finished) finish(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', function () { fail('bad request body', 400); });
    req.on('aborted', function () { fail('request aborted', 400); });
}

function readJsonBody(req, res, cb, maxBytes) {
    readBody(req, function (body, err) {
        if (err) return serveJson(res, { error: err.message }, err.statusCode || 400);
        var parsed;
        try { parsed = JSON.parse(body); }
        catch (e) { return serveJson(res, { error: 'expected a JSON object' }, 400); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return serveJson(res, { error: 'expected a JSON object' }, 400);
        }
        // This runs inside the request's 'end' event: an exception here would be uncaught and end the whole service.
        try { cb(parsed); }
        catch (e) { if (!res.headersSent) serveJson(res, { ok: false, error: 'Request failed: ' + String(e && e.message || e) }, 500); }
    }, maxBytes);
}

// The TV agent executes commands serially. Start each request's timeout only
// when it is actually sent, rather than while it waits behind other probes.
var commandQueue=Promise.resolve(), queuedCommands=0;
function agentExecute(cmd, timeoutMs, dispatchGuard) {
    if(queuedCommands>=32)return Promise.reject(new Error('TV is busy; try again in a few seconds'));
    queuedCommands++;
    var result=commandQueue.then(function(){
        if(dispatchGuard&&!dispatchGuard())throw new Error('TV command cancelled before dispatch');
        return platform.execute(cmd,timeoutMs||30000);
    });
    commandQueue=result.catch(function(){});
    return result.finally(function(){queuedCommands--;});
}

function handleExec(req, res) {
    readBody(req, function (body, err) {
        if (err) return serveJson(res, { error: err.message }, err.statusCode || 400);
        var cmd = body;
        try {
            var parsed = JSON.parse(body);
            cmd = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed.cmd : null;
        } catch (e) { /* retain support for plain-text commands */ }
        if (typeof cmd !== 'string' || !cmd.trim()) {
            return serveJson(res, { error: 'missing string "cmd" (JSON {"cmd":"..."})' }, 400);
        }

        agentExecute(cmd, 30000).then(function (r) {
            serveJson(res, {
                ok: r.exit_code === 0,
                exit_code: r.exit_code,
                timed_out: r.timed_out,
                output: r.stdout,
                stderr: r.stderr
            });
        }).catch(function (e) {
            serveJson(res, { ok: false, error: String(e.message || e) }, 503);
        });
    });
}

function handleExecStatus(res) {
    var current = platform.status();
    serveJson(res, {connected: !!(current.agent && current.agent.connected), agent: current.agent});
}

// --- remote control (POST /control) ----------------------------------------
// One remote press per call: the key name is whitelisted (control.js) and
// the command is built from the whitelist, never from request text.

function handleControl(req, res) {
    if (req.method === 'GET') {
        return serveJson(res, { keys: control.KEYS });
    }
    readJsonBody(req, res, function (parsed) {
        var key = parsed.key;
        if (!key || typeof key !== 'string') {
            return serveJson(res, { error: 'missing "key" (see GET /control for names)' }, 400);
        }
        var cmd = control.injectCommand(key);
        if (!cmd) {
            return serveJson(res, { error: 'unknown key ' + key, keys: control.KEYS }, 400);
        }
        agentExecute(cmd, 10000).then(function (r) {
            serveJson(res, { ok: r.exit_code === 0, key: key, exit_code: r.exit_code, output: r.stdout, stderr: r.stderr });
        }).catch(function (e) {
            serveJson(res, { ok: false, error: String(e.message || e) }, 503);
        });
    });
}

// --- MQTT configuration ----------------------------------------------------
// POST /mqtt {"host": "...", "port": 1883, ...} validates and stores the
// bridge config in the owner's persistent storage; the bridge picks it up
// within its 30s config poll. GET returns the current effective config
// (with the broker connection state).

function handleMqttConfig(req,res){
 var mod=require('./mqtt-bridge.js');
 if(req.method==='GET')return serveJson(res,{config:mod.publicConfig(mod.readConfig()),status:bridge.status(),connected:bridge.connected});
 readJsonBody(req,res,function(p){var cfg;try{cfg=mod.validateConfig(p,mod.readConfig());}catch(e){return serveJson(res,{ok:false,error:e.message},400);}
  try{mod.saveConfig(cfg);}catch(e){return serveJson(res,{ok:false,error:'Configuration save failed'},500);}
  bridge.configure(cfg);serveJson(res,{ok:true,config:mod.publicConfig(cfg),status:bridge.status()});
 });
}

// --- debloat --------------------------------------------------------------
// Lists ad/ACR/privacy services and delegates state changes to the platform
// adapter. The standalone adapter reports these operations as unavailable.

function handleDebloatList(req, res) {
    agentExecute(debloat.listCommand(), 15000).then(function (r) {
        if (r.exit_code !== 0 || r.timed_out) throw new Error('package discovery failed: ' + (r.stderr || r.exit_code));
        serveJson(res, { services: debloat.parseList(r.stdout) });
    }).catch(function (e) {
        serveJson(res, { ok: false, error: String(e.message || e) }, 503);
    });
}

var debloatBusy=false;
function handleDebloatAction(req, res) {
    readJsonBody(req, res, function (parsed) {
        var action = parsed.action;          // "disable" | "enable"
        var kind = parsed.kind || 'ads';     // "ads" | "privacy"
        var appIds = parsed.appIds;          // optional explicit list
        if (appIds != null && (!Array.isArray(appIds) || appIds.some(function (id) {
            return typeof id !== 'string' || !APP_ID_RE.test(id);
        }))) {
            return serveJson(res, { error: 'appIds must be an array of application IDs' }, 400);
        }
        if (kind !== 'ads' && kind !== 'privacy') {
            return serveJson(res, { error: 'kind must be ads or privacy' }, 400);
        }

        if (action !== 'disable' && action !== 'enable') {
            return serveJson(res, { error: 'action must be "disable" or "enable"' }, 400);
        }

        try { if (appIds) debloat.validateTargets(appIds, action === 'enable'); }
        catch (e) { return serveJson(res, {ok:false,error:e.message},400); }
        if (appIds && !appIds.length) return serveJson(res,{ok:true,changed:0,appIds:[]});

        if (!appIds || appIds.length!==1) return serveJson(res,{ok:false,error:'Select one installed component to disable or enable.'},409);
        if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
        var id=appIds[0],desired=action==='disable',original;
        if(id==='com.samsung.tv.csfs'&&(dock.readState().customApp||desired&&dock.readState().enabled)){debloatBusy=false;return serveJson(res,{ok:false,error:homeLockMessage()},409);}
        inventory(true).then(function(d){var row=d.apps.find(function(a){return a.appId===id;});if(d.registryError)throw Error('App registry unavailable');if(!row){var missing=Error('App not installed');missing.statusCode=409;throw missing;}var capability=ComponentActions.availability(row,d.apps,TOGGLE_IDS).toggle;if(!capability.allowed){var unavailable=Error(capability.reason);unavailable.statusCode=409;throw unavailable;}original=row.disabled;if(original===desired)return {ok:true,verified:true,changed:false,appId:id,disabled:desired};
            return agentExecute('pkgcmd '+(desired?'-D':'-A')+' -t app -n '+id+' --global',15000).then(function(r){if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'App state unchanged');invalidateInventory();return inventory(true);}).then(function(after){var r=after.apps.find(function(a){return a.appId===id;});if(after.registryError||!r||r.disabled!==desired)throw Error('Global flag not confirmed');return {ok:true,verified:true,changed:true,appId:id,disabled:r.disabled,scope:'Global flag confirmed; running processes may remain until the next launch'};}).catch(function(e){return agentExecute('pkgcmd '+(original?'-D':'-A')+' -t app -n '+id+' --global',15000).then(function(r){if(r.exit_code||r.timed_out)throw Error('Restore not confirmed');invalidateInventory();return inventory(true);}).then(function(d){var restored=d.apps.find(function(a){return a.appId===id;});throw Error(e.message+' · '+(restored&&restored.disabled===original&&!d.registryError?'previous flag restored':'restore not confirmed'));},function(){throw Error(e.message+' · restore not confirmed');});});
        }).then(function(d){
            // Remember what Vetro disabled, so that "Restore the TV" switches on those and not what the firmware ships disabled.
            if(d.changed===false&&desired)return d;
            var ledger;try{ledger=desired?disabledLedger.addCommand(id):disabledLedger.removeCommand(id);}catch(e){return d;}
            return agentExecute(ledger,8000).then(function(){return d;},function(){return d;});
        }).then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},e.statusCode||503);});

    });
}

var tvSettings=new TVSettings(agentExecute);

// --- probe, app inventory, settings, remapper -----------------------------
// The widget UI collects data through the public Tizen/Samsung web APIs and
// posts it here (POST /probe). Storing the probe needs no privileged access.
var state = probe.load() || {};
function serviceApiProbe() {
    var result = {tizenObject: typeof tizen !== 'undefined', webapisObject: typeof webapis !== 'undefined'};
    ['application', 'package', 'tvinputdevice', 'systeminfo'].forEach(function (name) {
        try { result[name] = typeof tizen !== 'undefined' && typeof tizen[name] !== 'undefined'; }
        catch (e) { result[name] = false; }
    });
    return result;
}
var REMAP_PATH = '/opt/usr/home/owner/share/vetro-remap.json';
var remapStore = (function () {
    try { return JSON.parse(fs.readFileSync(REMAP_PATH, 'utf8')); } catch (e) { return {}; }
})();
try { remapStore.rules = remap.validateRules(remapStore.rules || []); }
catch (e) { remapStore.rules = []; }
function saveRemap() {
    try { atomicFile.write(fs, REMAP_PATH, JSON.stringify(remapStore)); return true; } catch (e) { return false; }
}

function handleProbe(req, res) {
    if (req.method === 'GET') {
        if (DIAGNOSTICS_QUERY_RE.test(req.url || '')) {
            return serveJson(res, {report: state, service: serviceApiProbe()});
        }
        return serveJson(res, state);
    }
    // The widget posts from the TV itself. With pairing on, this keeps LAN clients from rewriting the
    // stored model, firmware and API probe that diagnostics report. With pairing off (or automatic and the TV app not seen yet) anyone
    // the sign-in gate let through may post, as in 0.3.5: on some TVs the page is not seen as the TV, and
    // every LAN client can already use every route.
    if (auth.pairingMode().enabled && !auth.fromThisTv(req.socket && req.socket.remoteAddress)) {
        return serveJson(res, { error: 'Probe reports are accepted from the TV only' }, 403);
    }
    readJsonBody(req, res, function (parsed) {
        try { state = probe.carry(state, probe.sanitize(parsed)); }
        catch (e) { return serveJson(res, { error: String(e.message || e) }, 400); }
        invalidateInventory();
        serveJson(res, { ok: true, persisted: probe.save(state) });
    }, probe.MAX_JSON);
}

var registryCache = null, registryAt = 0, registryPending = null, registryGeneration = 0, registryPendingGeneration = 0;
function invalidateInventory() { registryAt = 0; registryCache = null; registryGeneration++; }
function inventory(refresh) {
    if (!refresh && registryCache && Date.now()-registryAt<60000) return Promise.resolve(registryCache);
    if (registryPending) {
        // A read started before a mutation cannot verify that mutation. Wait for it,
        // then share a new read with every caller waiting on the same invalidation.
        if (registryPendingGeneration !== registryGeneration) return registryPending.then(function () { return inventory(refresh); });
        return registryPending;
    }
    var generation = registryGeneration;
    registryPendingGeneration = generation;
    registryPending=AppRegistry.load(agentExecute,state).then(function(data){if(generation===registryGeneration){registryCache=data;registryAt=Date.now();}return data;})
        .catch(function(e){var rows=apps.normalize(state.apps,state.packages);return {apps:rows,summary:apps.summarize(rows),source:'public probe',registryError:String(e.message||e),collectedAt:state.receivedAt||null};})
        .finally(function(){registryPending=null;});
    return registryPending;
}
function handleComponentAction(req,res) {
    readJsonBody(req,res,function(p) {
        if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
        inventory(true).then(function(d) {
            if(d.registryError)throw Error('App registry unavailable; no command sent');
            var a;
            try { a=ComponentActions.validate(p,d.apps); }
            catch(e) { e.statusCode=400;throw e; }
            var factoryResult;
            // Keep removed: Samsung's row, and with it the store id, can be gone once the package is. Read it first.
            var learned=p.action==='uninstall'?keepRemoved.learn(a.packageId):Promise.resolve(false);
            return learned.then(function(){return agentExecute(ComponentActions.command(p,a),30000);}).then(function(r) {
                // #135: AgingApp stopped this way leaves db/FactoryApp/Aging at 1, and the TV starts the test again at every boot.
                // Put it back to 0 (only if it reads exactly 1), right after the stop command and whatever it answered:
                // the process check below can fail on its own, and a stuck AgingApp is when the key matters most.
                var factory=p.action==='stop'&&factoryApps.isAging(a.appId)?factoryTest.reset().catch(function(e){return {changed:false,error:e.message};}):Promise.resolve(undefined);
                return factory.then(function(f){factoryResult=f;return r;});
            }).then(function(r) {
                invalidateInventory();
                if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'Action incomplete');
                return Promise.all([inventory(true),p.action==='stop'?monitor.snapshot('full',true):Promise.resolve(null)]).then(function(results) {
                    var after=results[0], row=after.apps.find(function(x){return x.appId===p.appId});
                    var verified=p.action==='flags'?!!row&&row[p.flag]===p.enabled:
                        p.action==='uninstall'?!after.registryError&&!after.apps.some(function(x){return x.packageId===a.packageId}):
                        !results[1].processes.some(function(x){return x.appId===p.appId});
                    // Removed on purpose and gone: put it on the list so Samsung's sync does not bring it back (switch on only).
                    if(verified&&p.action==='uninstall'&&keepRemoved.enabled()){try{keepRemoved.change('add',[a.packageId]);keepRemoved.check().catch(function(){});}catch(e){/* Vetro's own packages are refused */}}
                    debloatBusy=false;serveJson(res,{ok:verified,verified:verified,action:p.action,appId:p.appId,packageId:a.packageId,changed:p.action==='flags'?a[p.flag]!==p.enabled:undefined,
                        error:verified?null:'Requested state not confirmed; the component may have restarted.',output:r.stdout,apps:after.apps,factoryTest:factoryResult});
                });
            }).catch(function(e){if(factoryResult)e.factoryTest=factoryResult;throw e;});
        }).catch(function(e){debloatBusy=false;serveJson(res,e.factoryTest?{ok:false,error:e.message,factoryTest:e.factoryTest}:{ok:false,error:e.message},e.statusCode||503)});
    });
}
// Samsung's Home put back by the service itself (a leftover of an earlier custom launcher build): the same group switch, run from the service.
function applySamsungHome(off) {
    if(debloatBusy)return Promise.reject(new Error('Another app change is in progress. Try again in a moment.'));
    debloatBusy=true;
    return quickSettings.apply('samsung-home',off,{execute:agentExecute,inventory:inventory,invalidate:function(){invalidateInventory();}})
        .then(function(d){debloatBusy=false;return d;},function(e){debloatBusy=false;throw e;});
}
function homeLockMessage() {
    var s=dock.readState();
    return s.customApp?'Turn off the custom launcher before changing Samsung Home':s.enabled?'Turn off the Vetro launcher before changing Samsung Home':null;
}
function handleQuick(req,res) {readJsonBody(req,res,function(p){
    if(p.id==='samsung-home'&&homeLockMessage())return serveJson(res,{ok:false,error:homeLockMessage()},409);
    if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
    Promise.resolve().then(function(){return quickSettings.apply(p.id,p.off,{execute:agentExecute,inventory:inventory,invalidate:function(){invalidateInventory();}});})
        .then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},e.statusCode||503);});
});}
// {enabled:true|false}; the first 0.5.0 release form {disabled:true|false} is still accepted. Turning pairing on needs a paired browser
// (or the TV itself): pairing first proves the TV can show the code, so nobody locks themselves out of the dashboard.
function handlePairingMode(req,res) {
    if(req.method==='GET')return serveJson(res,Object.assign(auth.pairingMode(),{paired:auth.trusted(req)}));
    readJsonBody(req,res,function(p){
        var enabled=typeof p.enabled==='boolean'?p.enabled:typeof p.disabled==='boolean'?!p.disabled:null;
        if(enabled===null)return serveJson(res,{error:'Invalid pairing mode'},400);
        if(debloatBusy)return serveJson(res,{error:'App change already in progress'},409);
        if(enabled&&!auth.pairingMode().enabled&&!auth.trusted(req))return serveJson(res,{error:'Pair this browser first with the code shown on the TV, then turn pairing on',needPair:true},409);
        try { serveJson(res,Object.assign(auth.setPairingEnabled(enabled),{paired:auth.trusted(req)})); } catch(e) { serveJson(res,{error:e.message},503); }
    });
}
function sdbAccess() {
    return platform.sdbAccess ? platform.sdbAccess() : {available:false,enabled:false,active:false,port:null};
}
function handleSdbAccess(req,res) {
    if(req.method==='GET') { try { return serveJson(res,sdbAccess()); } catch(e) { return serveJson(res,{error:e.message},503); } }
    readJsonBody(req,res,function(p){
        if(typeof p.enabled!=='boolean')return serveJson(res,{error:'Invalid SDB access state'},400);
        if(debloatBusy)return serveJson(res,{error:'App change already in progress'},409);
        if(!platform.setSdbAccess)return serveJson(res,{error:'SDB access is unavailable'},503);
        platform.setSdbAccess(p.enabled).then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);});
    });
}
function handleWins(req,res) {readJsonBody(req,res,function(p){
    if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
    Promise.resolve().then(function(){return wins.apply(p.id,p.on);}).then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},409);});
});}
// Keep removed apps removed: {action:'enable'|'disable'} is the global switch, {action:'allow', packages:[...]} takes apps off the
// list. Each answer says whether Samsung's list was brought in line; the switch is saved either way.
function handleKeepRemoved(req,res) {readJsonBody(req,res,function(p){
    if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
    var task;
    try {
        if(p.action==='enable'||p.action==='disable')keepRemoved.setEnabled(p.action==='enable');
        else if(p.action==='allow')keepRemoved.change('remove',p.packages);
        else throw Error('Invalid action');
        task=keepRemoved.check();
    } catch(e) { debloatBusy=false;return serveJson(res,{ok:false,error:e.message},400); }
    task.then(function(last){debloatBusy=false;serveJson(res,Object.assign({ok:!last.error&&!(last.source&&last.source.error)},keepRemoved.summary()));})
        .catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},503);});
});}
// Restore the TV: puts back what Vetro changed, then (separately) removes Vetro's data. See restore.js.
var restoreTv = new (require('./restore.js').Restore)({
    execute: agentExecute, inventory: inventory, invalidate: function(){invalidateInventory();},
    wins: wins, keepRemoved: keepRemoved, hbbtv: hbbtv, dns: dnsFilter, homeOrder: homeOrder, dock: dock,
    plugins: {list: function(){return plugins.list();}, setEnabled: function(id,on){return plugins.setEnabled(id,on);}},
    input: {active: function(){return inputPreference().enabled===true||inputObservers.length>0;},
        off: function(){stopInput();inputPaused=false;saveInputPreference({enabled:false});}},
    mqtt: {enabled: function(){var c=require('./mqtt-bridge.js').readConfig();return !!c&&c.enabled!==false&&!!c.host;},
        off: function(){var m=require('./mqtt-bridge.js'),c=Object.assign({},m.readConfig(),{enabled:false});m.saveConfig(c);bridge.configure(c);}},
    // Pairing is not a Restore item since the republished 0.5.0: off is the default, and Restore must not switch off a protection the owner turned on.
    sdb: {status:sdbAccess, off:function(){return platform.setSdbAccess(false);}},
    afterHbbtv: function(){privacy.cached=null;},
    factoryTest: factoryTest,
    removeAuth: function(){try{fs.unlinkSync(auth.STORE_PATH);}catch(e){}}
});
// #135: GET reads db/FactoryApp/Aging; POST {action:'reset'} writes 0 only when it reads exactly 1, then reads it again.
function handleFactoryTest(req,res) {
    if(req.method==='GET')return factoryTest.read().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);});
    readJsonBody(req,res,function(p){
        if(p.action!=='reset')return serveJson(res,{error:'Invalid factory test action'},400);
        factoryTest.reset().then(function(d){serveJson(res,Object.assign({ok:true},d));}).catch(function(e){serveJson(res,{ok:false,error:e.message},e.message.indexOf('in progress')>=0?409:503);});
    });
}
function handleRestore(req,res) {
    if(req.method==='GET')return restoreTv.publicPlan().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{ok:false,error:e.message},503);});
    readJsonBody(req,res,function(p){
        if(p.action!=='run'&&p.action!=='erase')return serveJson(res,{error:'Invalid restore action'},400);
        if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
        if(p.action==='run')return restoreTv.run().then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},503);});
        restoreTv.eraseData().then(function(d){debloatBusy=false;var finish=d.finish;delete d.finish;res.on('finish',finish);serveJson(res,d);})
            .catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},e.statusCode||503);});
    });
}
// Vetro's own app icon, shown in the dashboard. It ships in the package next to the service folder.
var iconPng=null;
function serveIcon(res) {
    try {
        if(!iconPng)iconPng=fs.readFileSync(require('path').join(__dirname,'..','icon.png'));
        res.writeHead(200,{'content-type':'image/png','cache-control':'public, max-age=86400','content-length':iconPng.length});
        res.end(iconPng);
    } catch(e) { serveJson(res,{error:'icon unavailable'},404); }
}
function handleLeftovers(req,res) {
    if(req.method==='GET')return leftovers.list().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);});
    readJsonBody(req,res,function(p){
        if(p.action!=='clear')return serveJson(res,{error:'Invalid leftovers action'},400);
        // The platform stages packages in this folder while it installs them.
        if(installPending)return serveJson(res,{ok:false,error:'An installation is in progress; try again when it finishes'},409);
        leftovers.clear().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{ok:false,error:e.message},503);});
    });
}
function handleApps(req,res) {inventory(REFRESH_QUERY_RE.test(req.url)).then(function(data){serveJson(res,data);});}
var iconCache = {};
// ?appId=... read straight from the query string: the one parameter does not need a URL parser.
function appIdOf(rawUrl) {
    var m = APP_ID_QUERY_RE.exec(rawUrl || '');
    if (!m) return undefined;
    try { return decodeURIComponent(m[1].replace(PLUS_RE, ' ')); } catch (e) { return undefined; }
}
function handleIcon(req,res) {
    var id=appIdOf(req.url);
    if (!id || !APP_ID_120_RE.test(id)) return serveJson(res,{error:'invalid appId'},400);
    function send(icon){res.writeHead(200,{'content-type':icon.mime,'cache-control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(icon.data);}
    if(iconCache[id])return send(iconCache[id]);
    inventory(false).then(function(data){var row=data.apps.find(function(r){return r.appId===id;}), command=AppRegistry.iconCommand(row);
        if(!command)throw new Error('no readable icon');
        return agentExecute(command,10000).then(function(r){if(r.exit_code||r.timed_out)throw new Error('icon unavailable');var data=Buffer.from(r.stdout.replace(WHITESPACE_CHAR_RE,''),'base64');
            var png=data.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpg=data[0]===255&&data[1]===216;
            if((!png&&!jpg)||data.length>262144)throw new Error('unsupported icon');
            var icon={data:data,mime:png?'image/png':'image/jpeg'};if(Object.keys(iconCache).length<100)iconCache[id]=icon;send(icon);
        });
    }).catch(function(){serveJson(res,{error:'icon unavailable'},404);});
}
function handleLaunch(req,res) {readJsonBody(req,res,function(p){
    if(typeof p.appId!=='string'||! APP_ID_120_RE.test(p.appId))return serveJson(res,{error:'invalid appId'},400);
    inventory(false).then(function(data){var row=data.apps.find(function(r){return r.appId===p.appId;});if(!row)throw new Error('application not installed');
        // #135: the service decides, not only the dashboard. Blocked: never. Not used at home: only with confirmed:true.
        var level=factoryApps.risk(row.appId,row.packageId),refused;
        if(level==='blocked'){refused=new Error(row.appId+' '+factoryApps.BLOCKED_MESSAGE);refused.statusCode=403;throw refused;}
        if(level==='confirm'&&p.confirmed!==true){refused=new Error(row.appId+' '+factoryApps.CONFIRM_MESSAGE);refused.statusCode=409;refused.needsConfirmation=true;throw refused;}
        return runActions([{type:'launch',appId:p.appId}],true);})
        .then(function(r){serveJson(res,r);}).catch(function(e){serveJson(res,e.needsConfirmation?{error:e.message,needsConfirmation:true}:{error:e.message},e.statusCode||503);});
});}

function handleBlocklist(req, res) {
    var q = (req.url || '').split('?')[1] || '';
    var m = FORMAT_QUERY_RE.exec(q);
    var body = apps.blocklist(m ? m[1] : 'domains');
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
}

function handleSettings(req, res) {
    serveJson(res, { items: settings.describe(), values: settings.sanitize(state.settings) });
}

function handleRemap(req, res) {
    if (req.method === 'GET') return serveJson(res, { rules: remapStore.rules, paired: !!remapStore.token, homeOwner: 'launcher', homeRuleInactive: remapStore.rules.some(function(r){return r.enabled&&r.trigger.type==='physical'&&r.trigger.value==='63';}) });
    readJsonBody(req, res, function (parsed) {
        var rules;
        try { rules = remap.checkLaunchable(remap.validateRules(parsed.rules), packageOf);
            if (rules.some(function (r) { return r.enabled && r.trigger.type === 'physical' && r.trigger.value === '63'; })) throw Error('Configure the Home key with Home destination in Launcher or Remapper');
        }
        catch (e) { return serveJson(res, { error: String(e.message || e) }, 400); }
        stopInput(); inputPaused=false; inputFaultUntil=0;
        remapStore.rules = rules;
        bridge.setTopics(rules.filter(function(r){return r.enabled&&r.trigger.type==='mqtt'}).map(function(r){return r.trigger.value}));
        serveJson(res, { ok: true, persisted: saveRemap(), rules: rules });
    });
}

// Package ID of an installed app from the last registry read, if there is one (rules only carry the app ID).
function packageOf(appId){var row=registryCache&&registryCache.apps.find(function(r){return r.appId===appId;});return row?row.packageId:null;}
// direct: the Task manager's "Open app", already checked in handleLaunch. Anything else comes from a rule (remapper, MQTT, HTTP).
function runActions(actions, direct, dispatchGuard) {
    var sent=0, skipped=[],mqttSent=0;
    return actions.reduce(function(chain,a){return chain.then(function(){
        var command;
        if(dispatchGuard&&!dispatchGuard())throw new Error('Input action cancelled');
        if(a.type==='mqtt'){bridge.publish(a.topic,a.payload);sent++;mqttSent++;return;}
        if(a.type==='launch'&&!remap.launchable(a.appId)){skipped.push('launch:not-an-app');return;}
        // #135: a rule saved before this check still loads, but never opens a factory, hotel or shop app.
        if(a.type==='launch'&&!direct&&remap.ruleRisk(a.appId,packageOf)){skipped.push('launch:factory-app');return;}
        if(a.type==='launch')command='/usr/bin/app_launcher -s '+a.appId;
        else if(a.type==='key'){var key=control.nativeKey(a.key);command=key&&control.injectCommand(key);if(!command)throw new Error('unsupported native key: '+a.key);}
        else {skipped.push(a.type);return;}
        return agentExecute(command,10000,dispatchGuard).then(function(r){if(r.exit_code||r.timed_out)throw new Error(r.stderr||'native action failed');sent++;});
    });},Promise.resolve()).then(function(){return {ok:true,sent:sent,skipped:skipped,transport:mqttSent?(mqttSent===sent?'mqtt':'mixed'):'native'};});
}
var actionQueue=Promise.resolve(), pendingActions=0, inputError=null;
var physical=new PhysicalInput(agentExecute,function(event){
    if(!inputLifecycleActive||event.action!=='down'||event.decision!=='blocked'||event.code===63)return;
    var actions=remap.resolve(remapStore.rules,'physical',String(event.code));
    if(pendingActions>=8){pauseInputFault('input action queue exceeded');return;}
    pendingActions++;
    var generation=inputGeneration;
    function current(){return inputLifecycleActive&&generation===inputGeneration;}
    actionQueue=actionQueue.then(function(){return current()?runActions(actions,false,current):null;}).catch(function(e){if(current())pauseInputFault(e.message);}).finally(function(){pendingActions--;});
});
var inputObservers=[], inputPaused=false, inputRestoring=false;
// inputPaused is the user's own pause (listening mode) and lasts until they act. A fault is different: a rule's action failed
// (broker down, TV busy, agent reconnecting), so the keys are given back to the TV at once, but only for a while. Without
// the end of this pause one failed press left interception off until the service restarted.
var INPUT_FAULT_PAUSE_MS=60000, inputFaultUntil=0;
// Listening pauses interception until the user stops it. A page that was closed or navigated away while listening never says so:
// when nothing has asked about the input for this long, the pause is dropped and the saved shortcuts work again.
var INPUT_LISTEN_IDLE_MS=300000, inputSeenAt=Date.now();
function pauseInputFault(message){inputError=message;inputFaultUntil=Date.now()+INPUT_FAULT_PAUSE_MS;physical.stop();}
var inputLifecycleActive=true, inputGeneration=0;
function startInputLifecycle(){inputLifecycleActive=true;}
function stopInputLifecycle(){inputLifecycleActive=false;stopInput();}
if(typeof module!=='undefined'){
    module.exports.onStart=startInputLifecycle;module.exports.onRequest=startInputLifecycle;
    module.exports.onStop=stopInputLifecycle;module.exports.onExit=stopInputLifecycle;
}
function inputPreference(){var p=remapStore.input;return p&&p.enabled===true&&typeof p.device==='string'?p:{enabled:false};}
function saveInputPreference(preference){
    var previous=remapStore.input;remapStore.input=preference;
    if(!saveRemap()){remapStore.input=previous;throw new Error('Remote setting could not be saved to disk');}
}
function inputTokens(){return remapStore.rules.filter(function(r){return r.enabled&&r.trigger.type==='physical'&&r.trigger.value!=='63';}).map(function(r){return r.trigger.value;});}
function restoreInput(){
    if(inputPaused&&Date.now()-inputSeenAt>INPUT_LISTEN_IDLE_MS){stopInput();inputPaused=false;}
    var preference=inputPreference(),generation=inputGeneration;
    if(!inputLifecycleActive||!preference.enabled||inputPaused||Date.now()<inputFaultUntil||inputRestoring||physical.status().policy.connected||!platform.status().agent.connected||!inputTokens().length)return;
    inputRestoring=true;
    physical.inventory().then(function(list){
        if(!inputLifecycleActive||generation!==inputGeneration||inputPaused||Date.now()<inputFaultUntil||inputPreference()!==preference)return;
        var candidates=list.filter(function(d){return d.selectable&&d.name===preference.device;});
        var keyed=candidates.filter(function(d){try{return KEY_CAPABILITY_RE.test(require('fs').readFileSync('/sys/class/input/'+d.node.split('/').pop()+'/device/capabilities/key','utf8'));}catch(e){return false;}});
        // Several interfaces share the name: the one that advertises keys, and if more than one does, the saved node among them.
        var device=candidates.length===1?candidates[0]:keyed.length===1?keyed[0]:keyed.find(function(d){return d.node===preference.node;})||null;
        if(!device)throw new Error('Saved physical remote is unavailable');
        return physical.start(device.node,'filter',inputTokens());
    }).then(function(){if(generation===inputGeneration)inputError=null;}).catch(function(e){if(generation===inputGeneration)inputError=e.message;}).finally(function(){if(generation===inputGeneration)inputRestoring=false;});
}
function stopInput(){++inputGeneration;inputRestoring=false;inputObservers.forEach(function(b){b.stop();});inputObservers=[];physical.stop();}
function inputSnapshot(){
    if(!inputObservers.length)return Object.assign({},physical.status(),{preference:inputPreference()});
    var events=[],connected=false,errors=[];
    inputObservers.forEach(function(b){var s=b.status();events=events.concat(s.events);connected=connected||s.policy.connected;if(s.error)errors.push(s.error);});
    events.sort(function(a,b){return a.time_seconds-b.time_seconds||a.time_microseconds-b.time_microseconds;});
    return {policy:{mode:'observe',device:'auto',connected:connected},preference:inputPreference(),events:events.slice(-30),error:errors.join('; ')||null};
}
// A newer request (or a remap save, or switching interception off) has taken over since this one began.
function superseded(){var e=new Error('Replaced by a newer input request');e.superseded=true;return e;}
function handleInput(req,res){
    inputSeenAt=Date.now();
    if(req.method==='GET')return physical.inventory().then(function(list){serveJson(res,{devices:list,status:inputSnapshot(),error:inputError});}).catch(function(e){serveJson(res,{devices:[],status:inputSnapshot(),error:e.message});});
    readJsonBody(req,res,function(p){
        if(!inputLifecycleActive)return serveJson(res,{error:'Service input is stopped'},503);
        var tokens=inputTokens();
        inputError=null;inputFaultUntil=0;
        if(p.mode==='off'){try{saveInputPreference({enabled:false});}catch(e){return serveJson(res,{ok:false,error:e.message},503);}inputPaused=false;stopInput();return serveJson(res,{ok:true,persisted:true,status:inputSnapshot()});}
        if(p.mode!=='observe'&&p.mode!=='filter')return serveJson(res,{error:'invalid input mode'},400);
        if(p.mode==='filter'&&p.device==='auto')return serveJson(res,{error:'select the detected node before intercepting'},400);
        inputPaused=true;
        if(p.mode==='observe'&&p.device==='auto'){
            stopInput();var observerGeneration=inputGeneration;return physical.inventory().then(function(list){
                if(!inputLifecycleActive)throw new Error('Input request cancelled');
                if(observerGeneration!==inputGeneration)throw superseded();
                var candidates=list.filter(function(d){return d.selectable;});
                if(!candidates.length)throw new Error('no physical remote devices found');
                inputObservers=candidates.map(function(){return new PhysicalInput(agentExecute,function(){});});
                return Promise.all(candidates.map(function(d,i){return inputObservers[i].start(d.node,'observe',[]).catch(function(e){return {error:e.message};});}));
            }).then(function(){if(observerGeneration!==inputGeneration)throw superseded();var s=inputSnapshot();if(!s.policy.connected)throw new Error(s.error||'input helpers unavailable');serveJson(res,{ok:true,status:s});})
            .catch(function(e){if(inputLifecycleActive&&observerGeneration!==inputGeneration)e=superseded();else stopInput();serveJson(res,{ok:false,error:e.message},e.superseded?409:503);});
        }
        if(p.device==='auto')return serveJson(res,{error:'select the detected node before intercepting'},400);
        stopInput();var requestGeneration=inputGeneration;
        physical.start(p.device,p.mode,tokens).then(function(status){
            if(!inputLifecycleActive)throw new Error('Input request cancelled');
            if(requestGeneration!==inputGeneration)throw superseded();
            if(p.mode==='filter'){saveInputPreference({enabled:true,device:status.policy.device,node:status.policy.node});inputPaused=false;}
            serveJson(res,{ok:true,persisted:p.mode==='filter',status:inputSnapshot()});
        }).catch(function(e){
            // physical.start fails with its own "cancelled" error when a newer request stopped it: that is the same case.
            if(inputLifecycleActive&&requestGeneration!==inputGeneration)e=superseded();else physical.stop();
            serveJson(res,{ok:false,error:e.message},e.superseded?409:503);
        });
    });
}
function handleRemapRun(req,res){readJsonBody(req,res,function(p){
    if(typeof p.type!=='string'||typeof p.value!=='string')return serveJson(res,{error:'type and value required'},400);
    runActions(remap.resolve(remapStore.rules,p.type,p.value,p.payload)).then(function(r){serveJson(res,r);}).catch(function(e){serveJson(res,{ok:false,error:e.message},503);});
});}

var auth = require('./auth.js');
// The Vetro app polls /auth/pending and shows the code; open it so the code is on screen.
// A request that comes while the root agent is still connecting (a minute or so after boot) used to lose its launch
// silently and leave the TV without a code. It is tried again every 5 seconds for as long as the code is waiting.
function showPairingCode(attempt) {
    attempt = attempt || 0;
    runActions([{type: 'launch', appId: 'vetrotvapp.app'}]).catch(function () {
        if (attempt >= 20 || !auth.pendingLive()) return;
        var t = setTimeout(function () { if (auth.pendingLive()) showPairingCode(attempt + 1); }, 5000);
        if (t.unref) t.unref();
    });
}
var server = http.createServer(function (req, res) {
    var url = (req.url || '/').split('?')[0];
    // A sandboxed plugin page carries no sign-in cookie; its URL holds a session token the plugin host checks.
    if (PLUGIN_SESSION_API_RE.test(url)) return plugins.handle(req, res, url, serveJson, readBody);
    if (auth.gate(req, res, url, {open: platform.status().mode === 'app-only', onPair: function () { showPairingCode(0); }})) return;
    if (url === '/plugins' || url.indexOf('/plugins/') === 0) return plugins.handle(req, res, url, serveJson, readBody);
    if (url === '/diagnostics/download') {
        if (req.method !== 'GET') return serveJson(res, {error:'Use GET to download diagnostics'}, 405);
        return downloadDiagnostics(res, COMPONENTS_QUERY_RE.test(req.url || ''));
    }
    // Packaged widget documents use an opaque (null) origin, or on some runtimes a non-web scheme. Allow
    // only its probe/status exchange, including the JSON POST preflight. The sign-in gate already decided
    // who may get here.
    if ((url === '/probe' || url === '/status' || url === '/screen') && req.headers && auth.pageOrigin(req.headers.origin)) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'});
            return res.end();
        }
    }
    if (req.method === 'POST') {
        if (url === '/input') return handleInput(req,res);
        if (url === '/apps/launch') return handleLaunch(req,res);
        if (url === '/exec') return handleExec(req, res);
        if (url === '/debloat') return handleDebloatAction(req, res);
        if (url === '/dns') return readJsonBody(req,res,function(p){var task=p.action==='observe'?dnsFilter.observe():p.action==='apply'?dnsFilter.apply(p.enabled,p.domains):Promise.reject(Error('Invalid filter action'));task.then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});});
        if (url === '/pairing-mode') return handlePairingMode(req,res);
        if (url === '/sdb-access') return handleSdbAccess(req,res);
        if (url === '/wins') return handleWins(req,res);
        if (url === '/keep-removed') return handleKeepRemoved(req,res);
        if (url === '/restore') return handleRestore(req,res);
        if (url === '/factory-test') return handleFactoryTest(req,res);
        if (url === '/hbbtv') return readJsonBody(req,res,function(p){hbbtv.change(p.off,p.expected).then(function(d){privacy.cached=null;try{wins.remember('hbbtv',d.off);}catch(e){}serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},409);});});
        if (url === '/dock') return plugins.dispatch('launcher', req, res, 'action', serveJson);
        if (url === '/home-order') return readJsonBody(req,res,function(p){var t=p.action==='restore'?homeOrder.restore():homeOrder.write(p.entries);t.then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},409)});});
        if (url === '/tv-menu') return readJsonBody(req,res,function(p){menuSettings.write(p.id,p.value).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{ok:false,error:e.message},409)});});
        if (url === '/tv-settings') return readJsonBody(req,res,function(p){tvSettings.write(p).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{ok:false,error:e.message},409)});});
        if (url === '/components/action') return handleComponentAction(req,res);
        if (url === '/quick') return handleQuick(req,res);
        if (url === '/leftovers') return handleLeftovers(req,res);
        if (url === '/mqtt') return handleMqttConfig(req, res);
        if (url === '/control') return handleControl(req, res);
        if (url === '/install') return handleInstall(req, res);
        if (url === '/update/apply' || url === '/update/check') return handleUpdate(req, res, url === '/update/apply');
        if (url === '/update/rollback') return updater.rollback().then(function (d) { serveJson(res, d); }, function (e) { serveJson(res, {ok: false, error: e.message}, 409); });
        if (url === '/probe') return handleProbe(req, res);
        if (url === '/remap') return handleRemap(req, res);
        if (url === '/remap/run') return handleRemapRun(req, res);
        return serveJson(res, { error: 'POST not supported here' }, 405);
    }
    if (url === '/dns') return dnsFilter.status().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/dock/icon') return plugins.dispatch('launcher', req, res, 'icon', serveJson);
    if (url === '/dock') return plugins.dispatch('launcher', req, res, 'status', serveJson);
    if (url === '/home-order') return homeOrder.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/restore') return handleRestore(req,res);
    if (url === '/pairing-mode') return handlePairingMode(req,res);
    if (url === '/sdb-access') return handleSdbAccess(req,res);
    if (url === '/keep-removed') return serveJson(res, keepRemoved.summary());
    if (url === '/wins') return wins.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/icon.png') return serveIcon(res);
    if (url === '/factory-test') return handleFactoryTest(req,res);
    if (url === '/hbbtv') return hbbtv.read().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);});
    if (url === '/privacy') return privacy.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/tv-menu') { var q=MENU_ID_QUERY_RE.exec(req.url||''), menuId=null; try { if(q)menuId=decodeURIComponent(q[1]); } catch(e) { return serveJson(res,{error:'Invalid menu ID'},400); } return (q?menuSettings.read(menuId):menuSettings.load()).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)}); }
    if (url === '/monitor') { var scope=SCOPE_QUERY_RE.exec(req.url||'');if(scope&&!MONITOR_SCOPE_RE.test(scope[1]))return serveJson(res,{error:'Unsupported monitor scope'},400);return monitor.snapshot(scope?scope[1]:'full',REFRESH_QUERY_RE.test(req.url)).then(function(d){d.telemetry=readTelemetry();serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);}); }
    if (url === '/startup') return Promise.all([inventory(false),monitor.startup().catch(function(e){return {error:e.message};})]).then(function(d){serveJson(res,{apps:d[0].apps,services:Array.isArray(d[1])?d[1]:[],serviceError:d[1].error||null});});
    if (url === '/telemetry') return serveJson(res, readTelemetry());
    if (url === '/leftovers') return handleLeftovers(req,res);
    if (url === '/status') return serveJson(res, Object.assign({}, platform.status(), {app: buildInfo}));
    if (url === '/update') return serveJson(res, updater.status());
    if (url === '/screen') return screenSummary().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/exec') return handleExecStatus(res);
    if (url === '/debloat') return handleDebloatList(req, res);
    if (url === '/mqtt') return handleMqttConfig(req, res);
    if (url === '/control') return handleControl(req, res);
    if (url === '/probe') return handleProbe(req, res);
    if (url === '/input') return handleInput(req,res);
    if (url === '/apps/icon') return handleIcon(req,res);
    if (url === '/apps') return handleApps(req, res);
    if (url === '/blocklist') return handleBlocklist(req, res);
    if (url === '/tv-settings') return Promise.all([tvSettings.read().catch(function(e){return {items:[],error:e.message}}),dnsFilter.status().catch(function(e){return {error:e.message}}),tvSettings.readNetwork().catch(function(e){return {configurationError:e.message,services:[],interfaces:[],writable:false}})]).then(function(d){serveJson(res,{ts:Date.now(),items:d[0].items,scope:d[0].scope,error:d[0].error||null,network:Object.assign({},d[1],d[2]),device:settings.sanitize(state.settings)});});
    if (url === '/settings') return handleSettings(req, res);
    if (url === '/remap') return handleRemap(req, res);
    if (url === '/' || url === '/index.html') return serveHtml(res, auth.decorate(dashboardHtml()));
    serveJson(res, { error: 'not found' }, 404);
});
// An older Vetro that outlived an upgrade (0.3.x) can still hold the port and keep answering with its old version, and
// any other app can hold it too (8099 is where tizen-youtube and TizenTube listen). Without a handler the error ended the
// process and auto-restart brought it back into the same error, forever. Now: if the holder says it is an OLDER Vetro it
// is ended (stale-service.js; nothing else is ever touched); otherwise the service says what is wrong and tries again, so
// it comes up by itself once the port is free.
var LISTEN_RETRY_MS = Number(process.env.VETRO_LISTEN_RETRY_MS) || 15000;
var staleAttempts = 0;
function startListening() {
    server.listen(PORT, process.env.VETRO_BIND_HOST || '0.0.0.0');
}
server.on('listening', function () {
    console.log('VETRO listening on ' + PORT);
});
server.on('error', function (e) {
    if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
        var retry = function () {
            console.error('VETRO cannot listen on port ' + PORT + ' (' + e.code + '): another app holds it. Trying again in ' + Math.round(LISTEN_RETRY_MS / 1000) + ' s. Build with VETRO_PORT=<port> to use another one.');
            setTimeout(startListening, LISTEN_RETRY_MS);
        };
        if (e.code !== 'EADDRINUSE' || staleAttempts >= 3) return retry();
        staleAttempts++;
        require('./stale-service.js').endOlderService(PORT, buildInfo.version, {host: process.env.VETRO_STALE_PROBE_HOST || '127.0.0.1'}).then(function (r) {
            if (r.ended) {
                console.log('VETRO ended the older Vetro ' + r.version + ' (pid ' + r.pid + ') that still held port ' + PORT + (r.forced ? ' (forced)' : ''));
                return setTimeout(startListening, 300);
            }
            if (r.reason !== 'not-vetro') console.error('VETRO found Vetro ' + (r.version || '?') + ' on port ' + PORT + ' and did not end it: ' + r.reason);
            retry();
        }).catch(retry);
        return;
    }
    throw e;
});
startListening();

platform.start();
// The launcher is started again after a boot or a crash while its switch is on: that supervision is the launcher plugin's (plugin-launcher.js).
// Retry after boot and helper disconnects, including late adapter availability.
var inputRestoreTimer=setInterval(restoreInput,5000);if(inputRestoreTimer.unref)inputRestoreTimer.unref();

// MQTT bridge: publishes telemetry + Home Assistant discovery when a broker
// is configured (persistent owner config, /tmp fallback). No-op without config.
var mqttLastTrigger=Object.create(null);
var bridge = new MqttBridge(readTelemetry,function(m){
 var actions=remap.resolve(remapStore.rules,'mqtt',m.topic,m.payload.toString('utf8'));if(!actions.length)return;
 var now=Date.now();if(pendingActions>=8||now-(mqttLastTrigger[m.topic]||0)<500){bridge.event('throttled','Trigger rate limited: '+m.topic);return;}
 mqttLastTrigger[m.topic]=now;pendingActions++;
 actionQueue=actionQueue.then(function(){return runActions(actions);}).then(function(r){bridge.event('trigger','Rule executed: '+m.topic+' · '+r.sent+' action(s)');}).catch(function(e){bridge.event('error','MQTT rule: '+e.message);}).finally(function(){pendingActions--;});
});
bridge.setTopics(remapStore.rules.filter(function(r){return r.enabled&&r.trigger.type==='mqtt'}).map(function(r){return r.trigger.value}));
bridge.start();
// Self-update (docs/UPDATING.md): a bundle signed with the Vetro release key replaces the package files in place.
// Nothing is checked or downloaded here; the dashboard fetches the bundle in the browser and sends it to /update/apply.
var updater = new Updater({publicKey: require('./update-key.js'), installDir: path.resolve(__dirname, '..'),
    workDir: process.env.VETRO_UPDATE_DIR || '/opt/usr/home/owner/share/vetro-update', buildInfo: buildInfo, execute: agentExecute, dockStopCommand: dock.stopLines(),
    source: process.env.VETRO_UPDATE_SOURCE || 'https://raw.githubusercontent.com/andrearicci93/vetro/updates/'});
// Once the root agent has connected, a freshly updated version restarts the launcher if the update changed its files,
// then tells the watchdog it is up (otherwise the old version comes back). The dock is a separate process: a service
// restart alone leaves it running the old binary.
function restartDockAfterUpdate() {
    var launcher = dock.readState();
    if (!launcher.enabled && !launcher.customApp) return Promise.resolve('off');
    var tries = 0;
    function attempt() {
        return dock.refresh().then(function () { return 'restarted'; }, function (e) {
            if (++tries >= 4) throw e;
            return new Promise(function (r) { setTimeout(r, 4000); }).then(attempt);
        });
    }
    return attempt();
}
var updateConfirmAttempts = 0;
var updateConfirmTimer = setInterval(function () {
    if (++updateConfirmAttempts > 60) { clearInterval(updateConfirmTimer); return; }
    if (!platform.status().agent.connected) return;
    clearInterval(updateConfirmTimer);
    updater.finish(restartDockAfterUpdate).catch(function () { /* the watchdog decides */ });
}, 5000);
if (updateConfirmTimer.unref) updateConfirmTimer.unref();
// Third-party plugins (see docs/plugins.md): loaded from the plugin folder, off until switched on, guarded, safe mode after a failed boot.
// Bundled plugins ship in this package, are on by default, keep running in safe mode and get ctx.vetro (docs/PLUGIN-ARCHITECTURE.md).
// The launcher is the first one; MQTT, the remapper and the rest are still Vetro's own code.
var plugins = new PluginHost({registryKey: require('./plugin-key.js'), developerAllowed: function () { return platform.status().mode !== 'app-only'; }, dir: process.env.VETRO_PLUGIN_DIR || '/opt/usr/home/owner/share/vetro-plugins', execute: agentExecute,
    registry: process.env.VETRO_PLUGIN_REGISTRY || 'https://raw.githubusercontent.com/andrearicci93/vetro-plugins/catalog/index.json',
    services: {agentConnected: function () { return platform.status().agent.connected; }, json: serveJson, readJson: readJsonBody}});
plugins.register(require('./plugin-launcher.js').definition(dock));
plugins.start();
// A plugin's timer or socket callback throws outside every guard the host has. Without this the whole service ended with it
// (and, past the first minute after a boot, came back with the plugin enabled and ended again). Plugin code is stopped and the
// service goes on; an error from anywhere else is printed and ends the process, as it always did.
process.on('uncaughtException', function (e) {
    var handled = false;
    try { handled = plugins.handleCrash(e); } catch (x) { handled = false; }
    if (handled) { try { console.error('plugin stopped after an uncaught error: ' + (e && e.message)); } catch (x) { /* none */ } return; }
    try { console.error(e && e.stack || e); } catch (x) { /* none */ }
    process.exit(1);
});
// A deliberate stop is not a crash: close the boot marker so the next start is not put in safe mode.
['SIGTERM', 'SIGINT'].forEach(function (sig) { process.on(sig, function () { stopInputLifecycle(); try { plugins.stop(); } catch (e) { /* exiting anyway */ } process.exit(0); }); });

// Foreground app for MQTT: read-only, one small status query every 5 seconds,
// only while a broker connection is up. Names come from the stored probe.
var presenceTimer=setInterval(function(){
 if(!bridge.connected)return;
 presence.read().then(function(d){
  var fg=d.foreground;if(fg){var row=apps.normalize(state.apps,state.packages).filter(function(a){return a.appId===fg.appId})[0];fg=Object.assign({name:row&&row.name||fg.appId},fg);}
  bridge.publishPresence(fg);
 }).catch(function(){});
},5000);if(presenceTimer.unref)presenceTimer.unref();

// Native audio/source reads require no foreground UI and never alter the TV.
var tvStateTimer=setInterval(function(){
 if(!bridge.connected)return;
 tvState.read().then(function(d){bridge.publishTvState(d);}).catch(function(){bridge.publishTvState(null);});
},10000);if(tvStateTimer.unref)tvStateTimer.unref();

// Restore only an explicitly saved local domain filter once the adapter is ready.
var dnsRestoreAttempts=0;var dnsRestoreTimer=setInterval(function(){if(++dnsRestoreAttempts>BOOT_RETRIES){clearInterval(dnsRestoreTimer);return}if(platform.status().agent.connected){dnsFilter.restore().then(function(s){if(!s.enabled||s.applied)clearInterval(dnsRestoreTimer)}).catch(function(){})}},5000);if(dnsRestoreTimer.unref)dnsRestoreTimer.unref();

// Quick wins that need a task after every boot (HbbTV's flag lives in /tmp, AmbientApp is started by the firmware
// 15 s after boot). Runs once the adapter is connected; the choice was saved by Vetro when the win was switched on.
var winsBootAttempts=0;var winsBootTimer=setInterval(function(){if(++winsBootAttempts>BOOT_RETRIES){clearInterval(winsBootTimer);return}if(platform.status().agent.connected){clearInterval(winsBootTimer);wins.boot(hbbtv).catch(function(){})}},5000);if(winsBootTimer.unref)winsBootTimer.unref();

// Keep removed apps removed: the source fix is written on every change; this is only the safety net, slow, and only
// while the switch is on. It also runs once when the adapter is up, and once more to take Vetro's ids out if the
// switch was left off with ids still in Samsung's list.
var keepRemovedTimer=setInterval(function(){if(platform.status().agent.connected&&!debloatBusy&&keepRemoved.enabled())keepRemoved.check().catch(function(){});},10*60000);if(keepRemovedTimer.unref)keepRemovedTimer.unref();
var keepRemovedBootAttempts=0;var keepRemovedBootTimer=setInterval(function(){if(++keepRemovedBootAttempts>BOOT_RETRIES){clearInterval(keepRemovedBootTimer);return}if(platform.status().agent.connected){clearInterval(keepRemovedBootTimer);keepRemoved.check().catch(function(){});}},5000);if(keepRemovedBootTimer.unref)keepRemovedBootTimer.unref();

// Warm the boot-state cache of the Startup tab (a 12-17 s read on a Q80A, run as a detached job so the root agent is never held up) once
// the TV has settled, so the first visit to the tab already has it. Tried for up to 5 minutes until the adapter is connected.
var startupWarmAttempts=0;var startupWarmTimer=setInterval(function(){if(++startupWarmAttempts>30){clearInterval(startupWarmTimer);return}if(platform.status().agent.connected){clearInterval(startupWarmTimer);monitor.startup().catch(function(){});}},10000);if(startupWarmTimer.unref)startupWarmTimer.unref();

// Put the service's own on-boot and auto-restart flags back once the adapter is connected (see ComponentActions.selfStartup).
var selfStartupAttempts=0,selfStartupBusy=false;var selfStartupTimer=setInterval(function(){if(++selfStartupAttempts>BOOT_RETRIES){clearInterval(selfStartupTimer);return}if(selfStartupBusy||!platform.status().agent.connected)return;selfStartupBusy=true;inventory(true).then(function(d){if(d.registryError)throw Error(d.registryError);return ComponentActions.selfStartup(d.apps).reduce(function(p,cmd){return p.then(function(){return agentExecute(cmd,30000).then(function(r){invalidateInventory();if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'Startup flag not set')})})},Promise.resolve())}).then(function(){clearInterval(selfStartupTimer)}).catch(function(){}).finally(function(){selfStartupBusy=false})},5000);if(selfStartupTimer.unref)selfStartupTimer.unref();
