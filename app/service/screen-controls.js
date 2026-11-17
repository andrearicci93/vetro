'use strict';
// The quick controls of the TV screen (index.html): five tiles; four do what one switch of the dashboard does, Vetro UI what four do.
//
//   GET  /screen/controls   what each tile shows, and whether this page may change anything
//   POST /screen/control    {id: launcher|ui|ads|voice, on: boolean}   or   {id: 'update', step: 'check'|'apply'}
//
// Nothing here is new behaviour: a tile calls the same internals as the dashboard's switch (the launcher's enable/disable,
// the "tracking-all" and "voice-all" quick settings, the updater), so the same locks and
// guards apply. The update is the one exception in where it runs: the TV page may only talk to the service
// (config.xml allows no other address), so the service itself fetches the update list and the signed bundle; the signature
// and the file hashes are still checked by the updater, as for an update sent from the dashboard.
//
// Plain ES5, like every module the TV loads.
var http = require('http');
var https = require('https');
var urlModule = require('url');
var quickSettings = require('./quick-settings.js');

var IDS = ['launcher', 'ui', 'ads', 'voice'];
var QUICK = {ads: 'tracking-all', voice: 'voice-all'};      // the tile and the quick-settings group behind it
var INDEX_MAX = 64 * 1024;
var BUNDLE_MAX = 8 * 1024 * 1024;
var FETCH_MS = 60000;
var VERSION_RE = /^\d+(\.\d+)*$/;
var SHA256_RE = /^[0-9a-f]{64}$/;
var STOPPED = 'Switched off in Vetro Shards';
var UPDATE_FILE_RE = /^vetro-update-[0-9.]+[.]json$/;

function problem(message, status) {
    var e = new Error(message);
    e.statusCode = status || 409;
    return e;
}

function newer(a, b) {
    if (!VERSION_RE.test(String(a)) || !VERSION_RE.test(String(b))) return String(a) !== String(b);
    var x = String(a).split('.'), y = String(b).split('.'), i, m, n;
    for (i = 0; i < Math.max(x.length, y.length); i++) {
        m = parseInt(x[i] || '0', 10); n = parseInt(y[i] || '0', 10);
        if (m !== n) return m > n;
    }
    return false;
}

// A quick-settings group as a switch. The switch is "on" when the feature is disabled (every member off), "part" when some
// members are still running, and "na" when the TV has none of them or the inventory could not be read.
function groupTile(group, apps) {
    if (!apps) return {state: 'na', why: 'Needs root access'};
    var s = quickSettings.state(group, apps);
    if (s.status === 'off') return {state: 'on'};
    if (s.status === 'on') return {state: 'off'};
    if (s.status === 'partial') return {state: 'part', left: s.enabled.length || s.flagged.length};
    return {state: 'na', why: s.status === 'unavailable' ? 'Not on this TV' : 'State unavailable'};
}

// One GET with a size and time limit. Resolves the body text.
function fetchText(source, name, max) {
    return new Promise(function (resolve, reject) {
        var target, lib, done = false, req, timer;
        function finish(err, text) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (err) { try { req.abort(); } catch (e) {} reject(err); } else resolve(text);
        }
        try {
            target = urlModule.parse(source + name);
            if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('bad address');
            lib = target.protocol === 'https:' ? https : http;
        } catch (e) { return reject(problem('The update address is not valid', 400)); }
        timer = setTimeout(function () { finish(problem('GitHub did not answer in time', 504)); }, FETCH_MS);
        req = lib.get({protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.path,
            headers: {'user-agent': 'Vetro', 'cache-control': 'no-cache'}}, function (res) {
            var chunks = [], size = 0;
            if (res.statusCode !== 200) {
                res.resume();
                return finish(problem(res.statusCode === 404 && name.indexOf('update-index') === 0 ? 'No update has been published yet'
                    : 'GitHub answered ' + res.statusCode + ' for the ' + (name.indexOf('update-index') === 0 ? 'update list' : 'update'), 502));
            }
            res.on('data', function (c) {
                size += c.length;
                if (size > max) return finish(problem('The update is larger than expected', 502));
                chunks.push(c);
            });
            res.on('end', function () { finish(null, Buffer.concat(chunks).toString('utf8')); });
            res.on('error', function (e) { finish(problem('Download failed: ' + e.message, 502)); });
        });
        req.on('error', function (e) { finish(problem('Could not reach GitHub: ' + e.message, 502)); });
    });
}

// The Vetro UI tile is everything Vetro draws on the TV besides the launcher's bar: the live TV screen (Vetro TV Tuner), the
// volume bar, the number pad and the Control center. One switch for the four, each through the call its own dashboard switch
// makes. A part this TV cannot have is left out (the tuner's files missing, its plugin stopped, a TV its checks refuse; the
// launcher's files missing or its plugin stopped for the other three). The bar, the pad and the Control center are drawn by
// the launcher's process, so they show while the launcher (or a custom launcher) is on; their switches are saved either way.
function uiParts(d) {
    var parts = [], launcher = d.dock.readState();
    if (d.dock.installed() && d.pluginRunning('launcher')) {
        parts.push({name: 'keys', on: launcher.volumePill && launcher.numberPad});
        parts.push({name: 'cards', on: launcher.cards.length > 0});
    }
    if (d.tuner.installed() && d.pluginRunning('tuner') && !d.tuner.unsupported) parts.push({name: 'tuner', on: d.tuner.readState().enabled});
    return parts;
}

function uiTile(d, agent) {
    var parts = uiParts(d), on = parts.filter(function (p) { return p.on; }).length;
    if (!parts.length) return {state: 'na', why: !d.dock.installed() && !d.tuner.installed() ? 'Not in this Vetro package' : STOPPED};
    if (!agent) return {state: 'na', why: 'Needs root access'};
    return on === parts.length ? {state: 'on'} : on === 0 ? {state: 'off'} : {state: 'part', left: parts.length - on, of: parts.length};
}

// Every part is tried, in turn (the launcher and the tuner each allow one change at a time); the first refusal is reported
// after the others have had their turn, and the tile then says how many parts are still off.
function setUi(d, on) {
    var parts = uiParts(d), failed = null, chain = Promise.resolve();
    function step(run) { chain = chain.then(run).then(null, function (e) { if (!failed) failed = e; }); }
    parts.forEach(function (p) {
        if (p.name === 'keys') step(function () { return d.dock.setKeys(on); });
        if (p.name === 'cards') step(function () {
            var s = d.dock.readState();
            if (on === (s.cards.length > 0)) return null;
            return d.dock.setCards(on ? (s.lastCards.length ? s.lastCards : ['tasks']) : []);
        });
        if (p.name === 'tuner') step(function () {
            if (on === d.tuner.readState().enabled) return null;
            return on ? d.tuner.enable() : d.tuner.disable();
        });
    });
    return chain.then(function () { if (failed) throw failed; });
}

// deps: dock, tuner, updater, inventory(refresh) -> Promise of {apps}, applyQuick(id, off) -> Promise, agentConnected() -> boolean,
// pluginRunning(id) -> boolean. The launcher and the tuner are bundled plugins: the dashboard's routes answer 503 while the plugin is
// switched off or was stopped, so a tile must not change them either (nothing would supervise them, and the dashboard could not undo it).
function Controls(deps) {
    this.deps = deps;
}

// The newest update the source offers, checked against what is installed: {phase: none|found|reinstall, version}.
Controls.prototype.lookUp = function () {
    var up = this.deps.updater, status = up.status();
    if (!status.configured) return Promise.reject(problem('This build has no update key, so it cannot be updated from here'));
    return fetchText(status.source, 'update-index.json', INDEX_MAX).then(function (text) {
        var ix;
        try { ix = JSON.parse(text); } catch (e) { throw problem('Unexpected update list', 502); }
        if (!ix || !SHA256_RE.test(String(ix.sha256 || '')) || !UPDATE_FILE_RE.test(String(ix.file || '')) || !VERSION_RE.test(String(ix.version || ''))) {
            throw problem('Unexpected update list', 502);
        }
        if (!newer(ix.version, status.version)) return {index: ix, phase: 'none', version: status.version};
        if ((ix.shell || 1) > (status.shell || 1)) return {index: ix, phase: 'reinstall', version: ix.version};
        return {index: ix, phase: 'found', version: ix.version};
    });
};

Controls.prototype.read = function (canControl) {
    var d = this.deps, agent = !!d.agentConnected(), launcher = d.dock.readState(), status = d.updater.status();
    var groups = {ads: quickSettings.find(QUICK.ads), voice: quickSettings.find(QUICK.voice)};
    var inventory = agent ? d.inventory(false).then(function (r) { return r && !r.registryError && Array.isArray(r.apps) ? r.apps : null; }, function () { return null; }) : Promise.resolve(null);
    return inventory.then(function (apps) {
        var tiles = {
            launcher: !d.dock.installed() ? {state: 'na', why: 'Not in this Vetro package'} : !d.pluginRunning('launcher') ? {state: 'na', why: STOPPED}
                : !agent ? {state: 'na', why: 'Needs root access'} : {state: launcher.enabled || launcher.customApp ? 'on' : 'off', custom: !!launcher.customApp},
            ads: groupTile(groups.ads, apps),
            voice: groupTile(groups.voice, apps),
            ui: uiTile(d, agent)
        };
        return {canControl: !!canControl, tiles: tiles, update: {configured: status.configured, version: status.version, busy: !!status.busy,
            pending: !!status.pending}};
    });
};

// Runs one tile action. Resolves {ok: true, ...} with the tile's new state, or rejects with an error that carries statusCode.
Controls.prototype.act = function (p) {
    var d = this.deps, self = this, on, id = p && p.id;
    if (id === 'update') {
        if (p.step === 'check') return this.lookUp().then(function (r) { return {ok: true, phase: r.phase, version: r.version}; });
        if (p.step !== 'apply') return Promise.reject(problem('Invalid update step', 400));
        return this.lookUp().then(function (r) {
            if (r.phase === 'none') throw problem('You already have the newest version');
            if (r.phase === 'reinstall') throw problem('This version changes the package itself: install it again with Apps2Samsung');
            return fetchText(d.updater.status().source, r.index.file, BUNDLE_MAX).then(function (bundle) {
                return d.updater.apply(bundle, r.index.sha256);
            }).then(function () { return {ok: true, phase: 'run', version: r.version}; }, function (e) {
                throw problem(e.message, e.code === 'busy' || e.code === 'pending' ? 409 : e.statusCode || 400);
            });
        });
    }
    if (IDS.indexOf(id) < 0) return Promise.reject(problem('Unknown control', 400));
    if (typeof p.on !== 'boolean') return Promise.reject(problem('Invalid state', 400));
    on = p.on;
    if (!d.agentConnected()) return Promise.reject(problem('Needs root access, which is not connected'));
    if (id === 'launcher' && !d.pluginRunning(id)) return Promise.reject(problem(STOPPED + ': turn it on there first'));
    if (id === 'ui' && !uiParts(d).length) return Promise.reject(problem(STOPPED + ': turn it on there first'));
    var task;
    if (id === 'launcher') {
        var state = d.dock.readState();
        task = on ? d.dock.enable() : state.customApp ? d.dock.disableCustom() : d.dock.disable();
    } else if (id === 'ui') {
        task = setUi(d, on);
    } else {
        task = d.applyQuick(QUICK[id], on);          // "on" here means disabled, as for the dashboard's switch
    }
    return task.then(function () { return self.read(true).then(function (r) { return {ok: true, tile: r.tiles[id]}; }); }, function (e) {
        if (!e.statusCode) e.statusCode = 409;      // a refusal of the TV or of a lock, as the dashboard's routes answer it
        throw e;
    });
};

module.exports = {Controls: Controls, newer: newer, groupTile: groupTile};
