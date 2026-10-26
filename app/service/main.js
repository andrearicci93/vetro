'use strict';
// Vetro application: telemetry, dashboard and feature endpoints.
// Platform operations use the adapter documented in PLATFORM.md.
// Tizen 5.5 runs Node 4.4: add the built-ins it lacks before anything else loads.
require('./compat.js').install();
var fs = require('fs');
var http = require('http');
var os = require('os');
var MqttBridge = require('./mqtt-bridge.js').MqttBridge;
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
var monitor = new SystemMonitor(agentExecute);
var ComponentActions = require('./component-actions.js');
var dnsFilter = new (require('./local-dns.js').Filter)(agentExecute);
var homeOrder = new (require('./home-order.js').Order)(agentExecute);
var dock = new (require('./dock.js').Dock)({execute: agentExecute});
var hbbtv = new (require('./hbbtv.js').Control)(agentExecute);
var wins = new (require('./quick-wins.js').Wins)(agentExecute);
var presence = new (require('./presence.js').Presence)(agentExecute);
var tvState = new (require('./tv-state.js').Store)(agentExecute);
var privacy = new (require('./privacy.js').Privacy)(agentExecute);
var menuSettings = new (require('./menu-settings.js').Catalog)(agentExecute);
var quickSettings = require('./quick-settings.js');
var leftovers = new (require('./leftovers.js').Leftovers)(agentExecute);
// Components whose disabled flag Vetro may change: verified ACR set plus Quick Settings groups.
var TOGGLE_IDS = debloat.VERIFIED_GLOBAL_IDS.concat(quickSettings.ALLOWED_IDS);
// The package builder writes a non-default port into build-info.js (VETRO_PORT=... node build.cjs);
// VETRO_PORT at run time still wins for local runs.
var PORT = Number(process.env.VETRO_PORT) || buildInfo.port || 8099;

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
    if (up) out.uptime_s = parseFloat(up.split(/\s+/)[0]);
    else out.uptime_s = null;

    var cpuinfo = tryReadRaw('/proc/cpuinfo');
    if (cpuinfo) out.cpu_cores = (cpuinfo.match(/^processor/mg) || []).length;
    else out.cpu_cores = null;

    var freq = tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
    if (freq) out.cpu_freq_khz = parseInt(freq, 10);
    else out.cpu_freq_khz = null;

    var meminfo = tryReadRaw('/proc/meminfo');
    if (meminfo) out.meminfo = meminfo.split('\n').join(';');
    else out.meminfo = null;

    var stat = tryReadRaw('/proc/stat');
    if (stat) {
        out.cpu_stat = (stat.split('\n').filter(function (l) { return /^cpu /.test(l); })[0] || '').trim();
        out.cpu_percpu = stat.split('\n').filter(function (l) { return /^cpu[0-9]/.test(l); }).join(';');
    } else {
        out.cpu_stat = null;
        out.cpu_percpu = null;
    }

    var temp = null;
    ['/sys/class/thermal', '/sys/devices/virtual/thermal'].forEach(function (dir) {
        if (temp) return;
        var zones = [];
        try { zones = fs.readdirSync(dir).filter(function (n) { return /^thermal_zone\d+$/.test(n); }).sort(); } catch (e) { zones = []; }
        zones.forEach(function (zone) { if (!temp) temp = tryRead(dir + '/' + zone + '/temp'); });
    });
    // Samsung's TVs have no Linux thermal zones (nothing under /sys/class/thermal): the SoC driver exposes the
    // temperature in whole degrees, as <soc>/<name>.thermal/temperature (56 on a Q80A), readable by everyone.
    if (!temp) {
        var soc = '/sys/devices/platform/soc', names = [];
        try { names = fs.readdirSync(soc).filter(function (n) { return /thermal$/.test(n); }).sort(); } catch (e) { names = []; }
        names.forEach(function (n) { if (!temp) temp = tryRead(soc + '/' + n + '/temperature'); });
    }
    if (temp) { var t = parseInt(temp, 10); out.soctemp_c = (t > 1000) ? (t / 1000) : t; }
    else out.soctemp_c = null;

    return out;
}

// What the TV screen shows. The launcher's pid check is the only root command, and it runs only while the launcher is on.
function screenSummary() {
    var launcherState = dock.readState(), p = platform.status();
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

var diagnosticPending = null;
function downloadDiagnostics(res) {
    // The CPU rate needs a second sample 1.5 s after the first, and the TV runs its commands one after the other:
    // read together, the sample waited behind the 13 s startup listing and came back without a rate (4 of 7 reports).
    // The other reads start once the second sample is queued, so it runs right after the first.
    function later(fn) { return function () { return new Promise(function (r) { setTimeout(r, 1700); }).then(fn); }; }
    if (!diagnosticPending) diagnosticPending = require('./diagnostic-report.js').collect({
        platform: function () { return platform.status(); },
        device: function () { return Object.assign({}, state.settings || {}, {receivedAt: state.receivedAt}); },
        inventory: later(function () { return inventory(false); }),
        settings: later(function () { return tvSettings.read(); }),
        catalog: later(function () { return menuSettings.load(); }),
        monitor: function () { return require('./diagnostic-report.js').twoSamples(function (force) { return monitor.snapshot('full', force); }, 1500, 16000).then(function(d){return Object.assign({},d,{telemetry:readTelemetry()});}); },
        startup: later(function () { return monitor.startup(); }),
        network: later(function () { return tvSettings.readNetwork(); }),
        dns: later(function () { return dnsFilter.status(); }),
        mqtt: function () { return bridge.status(); },
        privacy: later(function () { return privacy.read(); }),
        hbbtv: later(function () { return hbbtv.read(); }),
        // The collector treats a truthy "error" as an unreadable section; the launcher keeps its last error there.
        launcher: later(function () { return dock.status().then(function (d) { return Object.assign({}, d, {error: null, hasError: !!d.error}); }); }),
        quickWins: later(function () { return wins.read(); }),
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
        cb(parsed);
    }, maxBytes);
}

// The TV agent executes commands serially. Start each request's timeout only
// when it is actually sent, rather than while it waits behind other probes.
var commandQueue=Promise.resolve(), queuedCommands=0;
function agentExecute(cmd, timeoutMs) {
    if(queuedCommands>=32)return Promise.reject(new Error('TV is busy; try again in a few seconds'));
    queuedCommands++;
    var result=commandQueue.then(function(){return platform.execute(cmd,timeoutMs||30000);});
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
            return typeof id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(id);
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
        inventory(true).then(function(d){var row=d.apps.find(function(a){return a.appId===id;});if(d.registryError)throw Error('App registry unavailable');if(!row){var missing=Error('App not installed');missing.statusCode=409;throw missing;}var capability=ComponentActions.availability(row,d.apps,TOGGLE_IDS).toggle;if(!capability.allowed){var unavailable=Error(capability.reason);unavailable.statusCode=409;throw unavailable;}original=row.disabled;if(original===desired)return {ok:true,verified:true,changed:false,appId:id,disabled:desired};
            return agentExecute('pkgcmd '+(desired?'-D':'-A')+' -t app -n '+id+' --global',15000).then(function(r){if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'App state unchanged');registryAt=0;return inventory(true);}).then(function(after){var r=after.apps.find(function(a){return a.appId===id;});if(after.registryError||!r||r.disabled!==desired)throw Error('Global flag not confirmed');return {ok:true,verified:true,changed:true,appId:id,disabled:r.disabled,scope:'Global flag confirmed; running processes may remain until the next launch'};}).catch(function(e){return agentExecute('pkgcmd '+(original?'-D':'-A')+' -t app -n '+id+' --global',15000).then(function(r){if(r.exit_code||r.timed_out)throw Error('Restore not confirmed');registryAt=0;return inventory(true);}).then(function(d){var restored=d.apps.find(function(a){return a.appId===id;});throw Error(e.message+' · '+(restored&&restored.disabled===original&&!d.registryError?'previous flag restored':'restore not confirmed'));},function(){throw Error(e.message+' · restore not confirmed');});});
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
    try { fs.writeFileSync(REMAP_PATH, JSON.stringify(remapStore)); return true; } catch (e) { return false; }
}

function handleProbe(req, res) {
    if (req.method === 'GET') {
        if (/(?:\?|&)diagnostics=1(?:&|$)/.test(req.url || '')) {
            return serveJson(res, {report: state, service: serviceApiProbe()});
        }
        return serveJson(res, state);
    }
    // The widget posts from the TV itself. This keeps LAN clients from rewriting the
    // stored model, firmware and API probe that diagnostics report.
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].indexOf(req.socket && req.socket.remoteAddress) < 0) {
        return serveJson(res, { error: 'Probe reports are accepted from the TV only' }, 403);
    }
    readJsonBody(req, res, function (parsed) {
        try { state = probe.sanitize(parsed); }
        catch (e) { return serveJson(res, { error: String(e.message || e) }, 400); }
        serveJson(res, { ok: true, persisted: probe.save(state) });
    }, probe.MAX_JSON);
}

var registryCache = null, registryAt = 0, registryPending = null;
function inventory(refresh) {
    if (!refresh && registryCache && Date.now()-registryAt<60000) return Promise.resolve(registryCache);
    if (registryPending) return registryPending;
    registryPending=AppRegistry.load(agentExecute,state).then(function(data){registryCache=data;registryAt=Date.now();return data;})
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
            return agentExecute(ComponentActions.command(p,a),30000).then(function(r) {
                registryAt=0;
                if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'Action incomplete');
                return Promise.all([inventory(true),p.action==='stop'?monitor.snapshot('full',true):Promise.resolve(null)]).then(function(results) {
                    var after=results[0], row=after.apps.find(function(x){return x.appId===p.appId});
                    var verified=p.action==='flags'?!!row&&row[p.flag]===p.enabled:
                        p.action==='uninstall'?!after.registryError&&!after.apps.some(function(x){return x.packageId===a.packageId}):
                        !results[1].processes.some(function(x){return x.appId===p.appId});
                    debloatBusy=false;serveJson(res,{ok:verified,verified:verified,action:p.action,appId:p.appId,packageId:a.packageId,changed:p.action==='flags'?a[p.flag]!==p.enabled:undefined,
                        error:verified?null:'Requested state not confirmed; the component may have restarted.',output:r.stdout,apps:after.apps});
                });
            });
        }).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},e.statusCode||503)});
    });
}
function handleQuick(req,res) {readJsonBody(req,res,function(p){
    if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
    quickSettings.apply(p.id,p.off,{execute:agentExecute,inventory:inventory,invalidate:function(){registryAt=0;}})
        .then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},e.statusCode||503);});
});}
function handleWins(req,res) {readJsonBody(req,res,function(p){
    if(debloatBusy)return serveJson(res,{ok:false,error:'App change already in progress'},409);debloatBusy=true;
    wins.apply(p.id,p.on).then(function(d){debloatBusy=false;serveJson(res,d);}).catch(function(e){debloatBusy=false;serveJson(res,{ok:false,error:e.message},409);});
});}
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
function handleApps(req,res) {inventory(/refresh=1/.test(req.url)).then(function(data){serveJson(res,data);});}
var iconCache = {};
function handleIcon(req,res) {
    var id=require('url').parse(req.url,true).query.appId;
    if (!id || !/^[A-Za-z0-9_.-]{1,120}$/.test(id)) return serveJson(res,{error:'invalid appId'},400);
    function send(icon){res.writeHead(200,{'content-type':icon.mime,'cache-control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(icon.data);}
    if(iconCache[id])return send(iconCache[id]);
    inventory(false).then(function(data){var row=data.apps.find(function(r){return r.appId===id;}), command=AppRegistry.iconCommand(row);
        if(!command)throw new Error('no readable icon');
        return agentExecute(command,10000).then(function(r){if(r.exit_code||r.timed_out)throw new Error('icon unavailable');var data=Buffer.from(r.stdout.replace(/\s/g,''),'base64');
            var png=data.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpg=data[0]===255&&data[1]===216;
            if((!png&&!jpg)||data.length>262144)throw new Error('unsupported icon');
            var icon={data:data,mime:png?'image/png':'image/jpeg'};if(Object.keys(iconCache).length<100)iconCache[id]=icon;send(icon);
        });
    }).catch(function(){serveJson(res,{error:'icon unavailable'},404);});
}
function handleLaunch(req,res) {readJsonBody(req,res,function(p){
    if(typeof p.appId!=='string'||! /^[A-Za-z0-9_.-]{1,120}$/.test(p.appId))return serveJson(res,{error:'invalid appId'},400);
    inventory(false).then(function(data){if(!data.apps.some(function(r){return r.appId===p.appId;}))throw new Error('application not installed');return runActions([{type:'launch',appId:p.appId}]);})
        .then(function(r){serveJson(res,r);}).catch(function(e){serveJson(res,{error:e.message},503);});
});}

function handleBlocklist(req, res) {
    var q = (req.url || '').split('?')[1] || '';
    var m = /(?:^|&)format=(hosts|domains)(?:&|$)/.exec(q);
    var body = apps.blocklist(m ? m[1] : 'domains');
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
}

function handleSettings(req, res) {
    serveJson(res, { items: settings.describe(), values: settings.sanitize(state.settings) });
}

function handleRemap(req, res) {
    if (req.method === 'GET') return serveJson(res, { rules: remapStore.rules, paired: !!remapStore.token });
    readJsonBody(req, res, function (parsed) {
        var rules;
        try { rules = remap.validateRules(parsed.rules); }
        catch (e) { return serveJson(res, { error: String(e.message || e) }, 400); }
        stopInput(); inputPaused=false;
        remapStore.rules = rules;
        bridge.setTopics(rules.filter(function(r){return r.enabled&&r.trigger.type==='mqtt'}).map(function(r){return r.trigger.value}));
        serveJson(res, { ok: true, persisted: saveRemap(), rules: rules });
    });
}

function runActions(actions) {
    var sent=0, skipped=[],mqttSent=0;
    return actions.reduce(function(chain,a){return chain.then(function(){
        var command;
        if(a.type==='mqtt'){bridge.publish(a.topic,a.payload);sent++;mqttSent++;return;}
        if(a.type==='launch')command='/usr/bin/app_launcher -s '+a.appId;
        else if(a.type==='key'){var key=control.nativeKey(a.key);command=key&&control.injectCommand(key);if(!command)throw new Error('unsupported native key: '+a.key);}
        else {skipped.push(a.type);return;}
        return agentExecute(command,10000).then(function(r){if(r.exit_code||r.timed_out)throw new Error(r.stderr||'native action failed');sent++;});
    });},Promise.resolve()).then(function(){return {ok:true,sent:sent,skipped:skipped,transport:mqttSent?(mqttSent===sent?'mqtt':'mixed'):'native'};});
}
var actionQueue=Promise.resolve(), pendingActions=0, inputError=null;
var physical=new PhysicalInput(agentExecute,function(event){
    if(event.action!=='down'||event.decision!=='blocked')return;
    var actions=remap.resolve(remapStore.rules,'physical',String(event.code));
    if(pendingActions>=8){inputPaused=true;physical.stop();inputError='input action queue exceeded';return;}
    pendingActions++;
    actionQueue=actionQueue.then(function(){return runActions(actions);}).catch(function(e){inputError=e.message;inputPaused=true;physical.stop();}).finally(function(){pendingActions--;});
});
var inputObservers=[], inputPaused=false, inputRestoring=false;
function inputPreference(){var p=remapStore.input;return p&&p.enabled===true&&typeof p.device==='string'?p:{enabled:false};}
function saveInputPreference(preference){
    var previous=remapStore.input;remapStore.input=preference;
    if(!saveRemap()){remapStore.input=previous;throw new Error('Remote setting could not be saved to disk');}
}
function inputTokens(){return remapStore.rules.filter(function(r){return r.enabled&&r.trigger.type==='physical';}).map(function(r){return r.trigger.value;});}
function restoreInput(){
    var preference=inputPreference();
    if(!preference.enabled||inputPaused||inputRestoring||physical.status().policy.connected||!platform.status().agent.connected||!inputTokens().length)return;
    inputRestoring=true;
    physical.inventory().then(function(list){
        if(inputPaused||inputPreference()!==preference)return;
        var candidates=list.filter(function(d){return d.selectable&&d.name===preference.device;});
        var keyed=candidates.filter(function(d){try{return /[1-9a-f]/i.test(require('fs').readFileSync('/sys/class/input/'+d.node.split('/').pop()+'/device/capabilities/key','utf8'));}catch(e){return false;}});
        // Several interfaces share the name: the one that advertises keys, and if more than one does, the saved node among them.
        var device=candidates.length===1?candidates[0]:keyed.length===1?keyed[0]:keyed.find(function(d){return d.node===preference.node;})||null;
        if(!device)throw new Error('Saved physical remote is unavailable');
        return physical.start(device.node,'filter',inputTokens());
    }).then(function(){inputError=null;}).catch(function(e){inputError=e.message;}).finally(function(){inputRestoring=false;});
}
function stopInput(){inputObservers.forEach(function(b){b.stop();});inputObservers=[];physical.stop();}
function inputSnapshot(){
    if(!inputObservers.length)return Object.assign({},physical.status(),{preference:inputPreference()});
    var events=[],connected=false,errors=[];
    inputObservers.forEach(function(b){var s=b.status();events=events.concat(s.events);connected=connected||s.policy.connected;if(s.error)errors.push(s.error);});
    events.sort(function(a,b){return a.time_seconds-b.time_seconds||a.time_microseconds-b.time_microseconds;});
    return {policy:{mode:'observe',device:'auto',connected:connected},preference:inputPreference(),events:events.slice(-30),error:errors.join('; ')||null};
}
function handleInput(req,res){
    if(req.method==='GET')return physical.inventory().then(function(list){serveJson(res,{devices:list,status:inputSnapshot(),error:inputError});}).catch(function(e){serveJson(res,{devices:[],status:inputSnapshot(),error:e.message});});
    readJsonBody(req,res,function(p){
        var tokens=inputTokens();
        inputError=null;
        if(p.mode==='off'){try{saveInputPreference({enabled:false});}catch(e){return serveJson(res,{ok:false,error:e.message},503);}inputPaused=false;stopInput();return serveJson(res,{ok:true,persisted:true,status:inputSnapshot()});}
        if(p.mode!=='observe'&&p.mode!=='filter')return serveJson(res,{error:'invalid input mode'},400);
        if(p.mode==='filter'&&p.device==='auto')return serveJson(res,{error:'select the detected node before intercepting'},400);
        inputPaused=true;
        if(p.mode==='observe'&&p.device==='auto'){
            stopInput();return physical.inventory().then(function(list){
                var candidates=list.filter(function(d){return d.selectable;});
                if(!candidates.length)throw new Error('no physical remote devices found');
                inputObservers=candidates.map(function(){return new PhysicalInput(agentExecute,function(){});});
                return Promise.all(candidates.map(function(d,i){return inputObservers[i].start(d.node,'observe',[]).catch(function(e){return {error:e.message};});}));
            }).then(function(){var s=inputSnapshot();if(!s.policy.connected)throw new Error(s.error||'input helpers unavailable');serveJson(res,{ok:true,status:s});})
            .catch(function(e){stopInput();serveJson(res,{ok:false,error:e.message},503);});
        }
        if(p.device==='auto')return serveJson(res,{error:'select the detected node before intercepting'},400);
        stopInput();
        physical.start(p.device,p.mode,tokens).then(function(status){
            if(p.mode==='filter'){saveInputPreference({enabled:true,device:status.policy.device,node:status.policy.node});inputPaused=false;}
            serveJson(res,{ok:true,persisted:p.mode==='filter',status:inputSnapshot()});
        }).catch(function(e){physical.stop();serveJson(res,{ok:false,error:e.message},503);});
    });
}
function handleRemapRun(req,res){readJsonBody(req,res,function(p){
    if(typeof p.type!=='string'||typeof p.value!=='string')return serveJson(res,{error:'type and value required'},400);
    runActions(remap.resolve(remapStore.rules,p.type,p.value,p.payload)).then(function(r){serveJson(res,r);}).catch(function(e){serveJson(res,{ok:false,error:e.message},503);});
});}

http.createServer(function (req, res) {
    var url = (req.url || '/').split('?')[0];
    if (url === '/diagnostics/download') {
        if (req.method !== 'GET') return serveJson(res, {error:'Use GET to download diagnostics'}, 405);
        return downloadDiagnostics(res);
    }
    // Packaged widget documents use an opaque (null) origin. Allow only its
    // probe/status exchange, including the JSON POST preflight.
    if ((url === '/probe' || url === '/status' || url === '/screen') && req.headers && req.headers.origin === 'null') {
        res.setHeader('Access-Control-Allow-Origin', 'null');
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
        if (url === '/wins') return handleWins(req,res);
        if (url === '/hbbtv') return readJsonBody(req,res,function(p){hbbtv.change(p.off,p.expected).then(function(d){privacy.cached=null;try{wins.remember('hbbtv',d.off);}catch(e){}serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},409);});});
        if (url === '/dock') return readJsonBody(req,res,function(p){var t=p.action==='enable'?dock.enable():p.action==='disable'?dock.disable():p.action==='refresh'?dock.refresh():p.action==='fixTizenTube'?dock.setFixTizenTube(p.on):p.action==='showHomeSources'?dock.setSourceOption('showHomeSources',p.on):Promise.reject(Error('Invalid dock action'));t.then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{ok:false,error:e.message},409)});});
        if (url === '/home-order') return readJsonBody(req,res,function(p){var t=p.action==='restore'?homeOrder.restore():homeOrder.write(p.entries);t.then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},409)});});
        if (url === '/tv-menu') return readJsonBody(req,res,function(p){menuSettings.write(p.id,p.value).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{ok:false,error:e.message},409)});});
        if (url === '/tv-settings') return readJsonBody(req,res,function(p){tvSettings.write(p).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{ok:false,error:e.message},409)});});
        if (url === '/components/action') return handleComponentAction(req,res);
        if (url === '/quick') return handleQuick(req,res);
        if (url === '/leftovers') return handleLeftovers(req,res);
        if (url === '/mqtt') return handleMqttConfig(req, res);
        if (url === '/control') return handleControl(req, res);
        if (url === '/install') return handleInstall(req, res);
        if (url === '/probe') return handleProbe(req, res);
        if (url === '/remap') return handleRemap(req, res);
        if (url === '/remap/run') return handleRemapRun(req, res);
        return serveJson(res, { error: 'POST not supported here' }, 405);
    }
    if (url === '/dns') return dnsFilter.status().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/dock/icon') {var slug=require('url').parse(req.url,true).query.slug,png=dock.iconFile(slug);if(!png)return serveJson(res,{error:'icon unavailable'},404);res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=60','X-Content-Type-Options':'nosniff'});return res.end(png);}
    if (url === '/dock') return dock.status({preview: true}).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/home-order') return homeOrder.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/wins') return wins.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/icon.png') return serveIcon(res);
    if (url === '/hbbtv') return hbbtv.read().then(function(d){serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);});
    if (url === '/privacy') return privacy.read().then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)});
    if (url === '/tv-menu') { var q=/[?&]id=([^&]+)/.exec(req.url||''), menuId=null; try { if(q)menuId=decodeURIComponent(q[1]); } catch(e) { return serveJson(res,{error:'Invalid menu ID'},400); } return (q?menuSettings.read(menuId):menuSettings.load()).then(function(d){serveJson(res,d)}).catch(function(e){serveJson(res,{error:e.message},503)}); }
    if (url === '/monitor') { var scope=/[?&]scope=([^&]*)/.exec(req.url||'');if(scope&&!/^(summary|full)$/.test(scope[1]))return serveJson(res,{error:'Unsupported monitor scope'},400);return monitor.snapshot(scope?scope[1]:'full').then(function(d){d.telemetry=readTelemetry();serveJson(res,d);}).catch(function(e){serveJson(res,{error:e.message},503);}); }
    if (url === '/startup') return Promise.all([inventory(false),monitor.startup().catch(function(e){return {error:e.message};})]).then(function(d){serveJson(res,{apps:d[0].apps,services:Array.isArray(d[1])?d[1]:[],serviceError:d[1].error||null});});
    if (url === '/telemetry') return serveJson(res, readTelemetry());
    if (url === '/leftovers') return handleLeftovers(req,res);
    if (url === '/status') return serveJson(res, Object.assign({}, platform.status(), {app: buildInfo}));
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
    if (url === '/' || url === '/index.html') return serveHtml(res, dashboardHtml());
    serveJson(res, { error: 'not found' }, 404);
}).listen(PORT, function () {
    console.log('VETRO listening on ' + PORT);
});

platform.start();
// The dock is started again after a boot or a crash while its switch is on.
// A short tick notices the moment the root agent connects, so after a boot the dock starts at once
// instead of waiting for the next 10 s round.
var dockAgentWas=false,dockTicks=0;
var dockTimer=setInterval(function(){var up=!!platform.status().agent.connected,edge=up&&!dockAgentWas;dockAgentWas=up;if(edge||++dockTicks>=5){dockTicks=0;dock.supervise(up).catch(function(){});}},2000);if(dockTimer.unref)dockTimer.unref();
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
var dnsRestoreAttempts=0;var dnsRestoreTimer=setInterval(function(){if(++dnsRestoreAttempts>12){clearInterval(dnsRestoreTimer);return}if(platform.status().agent.connected){dnsFilter.restore().then(function(s){if(!s.enabled||s.applied)clearInterval(dnsRestoreTimer)}).catch(function(){})}},5000);if(dnsRestoreTimer.unref)dnsRestoreTimer.unref();

// Quick wins that need a task after every boot (HbbTV's flag lives in /tmp, AmbientApp is started by the firmware
// 15 s after boot). Runs once the adapter is connected; the choice was saved by Vetro when the win was switched on.
var winsBootAttempts=0;var winsBootTimer=setInterval(function(){if(++winsBootAttempts>60){clearInterval(winsBootTimer);return}if(platform.status().agent.connected){clearInterval(winsBootTimer);wins.boot(hbbtv).catch(function(){})}},5000);if(winsBootTimer.unref)winsBootTimer.unref();

// Put the service's own on-boot and auto-restart flags back once the adapter is connected (see ComponentActions.selfStartup).
var selfStartupAttempts=0,selfStartupBusy=false;var selfStartupTimer=setInterval(function(){if(++selfStartupAttempts>60){clearInterval(selfStartupTimer);return}if(selfStartupBusy||!platform.status().agent.connected)return;selfStartupBusy=true;inventory(true).then(function(d){if(d.registryError)throw Error(d.registryError);return ComponentActions.selfStartup(d.apps).reduce(function(p,cmd){return p.then(function(){return agentExecute(cmd,30000).then(function(r){registryAt=0;if(r.exit_code||r.timed_out)throw Error(r.stderr||r.stdout||'Startup flag not set')})})},Promise.resolve())}).then(function(){clearInterval(selfStartupTimer)}).catch(function(){}).finally(function(){selfStartupBusy=false})},5000);if(selfStartupTimer.unref)selfStartupTimer.unref();
