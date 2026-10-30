'use strict';
// Quick Settings groups: one switch per feature, applied as the global
// disabled flag on every installed member, as the Debloater does for a single
// component. Disabling also stops members that are still running, so the
// change takes effect now. Members come from the Q80A package manifests.

// A group with "area" has no fixed list: its members are every component the Task manager files under that area,
// except the ones that role "keep" or the protection rules cover (Smart Hub's ad agent, Vetro itself).
var GROUPS = [
    {id: 'tracking-all', label: 'All advertising and tracking', section: 'tracking', area: 'tracking',
        description: 'Every component the Task manager lists under Advertising and tracking: viewing data, ad players, analytics, personalised content and the privacy screens. Smart Hub’s ad agent stays on because Home loads part of it.',
        ids: []},
    {id: 'voice-all', label: 'All voice assistants', section: 'voice', area: 'voice', microphone: true, everything: true,
        description: 'Every component the Task manager lists under Voice assistants: Alexa, Bixby, Google Assistant, the assistant hub, always-on voice, speech and text-to-speech, voice actions and search suggestions.',
        ids: []},
    {id: 'alexa', label: 'Alexa', section: 'voice', microphone: true,
        description: 'Alexa client, its full-screen view, launcher and wake-word engine.',
        ids: ['com.samsung.tv.alexa-client', 'com.samsung.tv.alexa-fullscreen-app', 'com.samsung.tv.alexa-jump-starter',
            'com.samsung.tv.wakeup-engine-alexa']},
    {id: 'google', label: 'Google Assistant', section: 'voice', microphone: true,
        description: 'Google Assistant service and its full-screen view.',
        ids: ['com.samsung.tv.google-assistant', 'com.samsung.tv.google-fullscreen-app']},
    {id: 'bixby', label: 'Bixby', section: 'voice', microphone: true,
        description: 'Bixby clients, voice discovery menu, capsule viewer and wake-word engine.',
        ids: ['com.samsung.tv.bixby-context-client', 'com.samsung.tv.bixby-prov', 'com.samsung.tv.bixbycapsuleviewer',
            'com.samsung.tv.mybixby', 'com.samsung.tv.wakeup-engine-bixby']},
    {id: 'voice', label: 'Voice services', section: 'voice', microphone: true,
        description: 'Voice interaction framework, speech-to-text, far-field and on-device voice, voice app and music assistant.',
        ids: ['com.samsung.tv.vif', 'com.samsung.tv.farfieldvoice', 'com.samsung.tv.ondevice-voice',
            'com.samsung.tv.voiceassistant-music', 'com.samsung.tv.cnvoice', 'com.samsung.tv.cnvoice-assistant',
            'org.tizen.voice-app', 'org.tizen.voice-app-service', 'org.tizen.voice-client', 'org.tizen.stt-client']}
];
var ALLOWED_IDS = GROUPS.reduce(function (all, g) { return all.concat(g.ids); }, []);
var ID = /^[A-Za-z0-9_.-]{1,180}$/;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function find(id) { return GROUPS.filter(function (g) { return g.id === id; })[0] || null; }

// "on": every installed member enabled; "off": every one disabled and none of them left on boot or auto-restart.
// A disabled member that still has a startup flag is "flagged": the group is only partly done until the flag is cleared.
function state(group, rows) {
    var byId = {};
    (rows || []).forEach(function (r) { byId[r.appId] = r; });
    // This function is also sent to the dashboard as text, so it cannot call anything outside itself.
    var ids = !group.area ? group.ids : (rows || []).filter(function (r) {
        return r.area === group.area && r.role !== 'keep' && !/^vetrotvapp(\.|$)/.test(r.appId || '') &&
            !/^com\.samsung\.tv\.coba\.adagent(\.|$)/.test(r.appId || '') && !/^com\.samsung\.tv\.coba\.adagent(\.|$)/.test(r.packageId || '');
    }).map(function (r) { return r.appId; });
    var installed = ids.filter(function (id) { return byId[id]; });
    var unknown = installed.filter(function (id) { return typeof byId[id].disabled !== 'boolean'; });
    var disabled = installed.filter(function (id) { return byId[id].disabled === true; });
    var enabled = installed.filter(function (id) { return byId[id].disabled === false; });
    var flagged = disabled.filter(function (id) { return byId[id].onboot === true || byId[id].autorestart === true; });
    var status = !installed.length ? 'unavailable' : unknown.length ? 'unknown'
        : !enabled.length ? (flagged.length ? 'partial' : 'off') : !disabled.length ? 'on' : 'partial';
    return {id: group.id, status: status, installed: installed, enabled: enabled, disabled: disabled, flagged: flagged};
}

// One script for the whole group: per-ID exit codes, no per-command queueing.
function command(ids, disable) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('for id in ' + ids.join(' ') + '; do pkgcmd ' + (disable ? '-D' : '-A') +
        ' -t app -n "$id" --global >/dev/null 2>&1; echo "$id $?"; done');
}
// The startup flags live in the package database, as the Task manager edits them (component-actions.js).
var DB = '/opt/dbspace/.pkgmgr_parser.db', SAVED = '/home/owner/share/vetro/quick-flags';
// Clear boot and auto-restart; the previous values are kept in SAVED/<id> so that turning the group back on restores them.
function clearFlagsCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('mkdir -p ' + SAVED + '\nfor id in ' + ids.join(' ') + '; do\n' +
        ' v=$(sqlite3 -readonly ' + DB + ' "SELECT app_onboot,app_autorestart FROM package_app_info WHERE app_id=\'$id\';")\n' +
        ' case "$v" in *true*) echo "$v" > "' + SAVED + '/$id";; esac\n' +
        ' sqlite3 -bail ' + DB + ' "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'false\',app_autorestart=\'false\' WHERE app_id=\'$id\'; COMMIT;" >/dev/null 2>&1; echo "$id $?"\ndone');
}
function restoreFlagsCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('for id in ' + ids.join(' ') + '; do\n' +
        ' f="' + SAVED + '/$id"\n [ -f "$f" ] || { echo "$id 0"; continue; }\n' +
        ' v=$(cat "$f"); on=${v%%|*}; re=${v##*|}\n' +
        ' case "$on" in true|false) ;; *) on=false;; esac\n case "$re" in true|false) ;; *) re=false;; esac\n' +
        ' sqlite3 -bail ' + DB + ' "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'$on\',app_autorestart=\'$re\' WHERE app_id=\'$id\'; COMMIT;" >/dev/null 2>&1; r=$?\n' +
        ' [ $r -eq 0 ] && rm -f "$f"; echo "$id $r"\ndone');
}
function stopCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('for id in ' + ids.join(' ') + '; do app_launcher -k "$id" >/dev/null 2>&1; echo "$id $?"; done');
}
function exitCodes(text) {
    var out = {};
    String(text || '').split('\n').forEach(function (l) { var m = /^(\S+) (\d+)$/.exec(l.trim()); if (m) out[m[1]] = +m[2]; });
    return out;
}
function running(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (l) { var m = /^\s*([A-Za-z0-9_.-]+) \((\d+)\)/.exec(l); if (m) out.push(m[1]); });
    return out;
}

// Turning a group back on gives its members the boot and auto-restart values they had before it was turned off.
// This is best effort: the components are enabled already, so a failure is reported rather than undone.
function restoreFlagsFor(result, deps) {
    if (!result.changed.length) return Promise.resolve(result);
    return deps.execute(restoreFlagsCommand(result.changed), 60000).then(function (r) {
        var codes = exitCodes(r.stdout);
        result.changed.forEach(function (id) { (codes[id] === 0 ? result.flagsRestored : result.flagsNotRestored).push(id); });
        deps.invalidate();
        return deps.inventory(true);
    }).then(function (d) {
        if (!d.registryError) { result.apps = d.apps; result.state = state(find(result.id), d.apps); }
        return result;
    }).catch(function () { result.flagsNotRestored = result.changed.slice(); result.flagsRestored = []; return result; });
}

// deps: execute(cmd, timeoutMs), inventory(refresh) -> {apps, registryError}, invalidate().
function apply(groupId, off, deps) {
    var group = find(groupId);
    if (!group) return Promise.reject(new Error('Unknown quick setting'));
    if (typeof off !== 'boolean') return Promise.reject(new Error('Invalid state'));
    var targets = [];
    function registry(refresh) {
        return deps.inventory(refresh).then(function (d) {
            if (d.registryError) throw new Error('App registry unavailable');
            return d;
        });
    }
    function verify(ids, disabled) {
        deps.invalidate();
        return registry(true).then(function (d) {
            var byId = {};
            d.apps.forEach(function (r) { byId[r.appId] = r; });
            return {apps: d.apps, wrong: ids.filter(function (id) { return !byId[id] || byId[id].disabled !== disabled; })};
        });
    }
    var flagTargets = [];
    function flagsWrong(apps, ids) {
        var byId = {};
        apps.forEach(function (r) { byId[r.appId] = r; });
        return ids.filter(function (id) { return !byId[id] || byId[id].onboot !== false || byId[id].autorestart !== false; });
    }
    return registry(true).then(function (before) {
        var s = state(group, before.apps);
        if (s.status === 'unavailable') { var missing = new Error('Not installed on this TV'); missing.statusCode = 409; throw missing; }
        if (s.status === 'unknown') throw new Error('App state is unavailable. Refresh the inventory.');
        targets = off ? s.enabled : s.disabled;
        // Turning off also clears boot and auto-restart on the members that are off already but still flagged.
        var byId = {};
        before.apps.forEach(function (r) { byId[r.appId] = r; });
        flagTargets = off ? s.enabled.concat(s.flagged).filter(function (id) { return byId[id].onboot === true || byId[id].autorestart === true; }) : [];
        if (!targets.length && !flagTargets.length && off) return before.apps;
        if (!targets.length && !off) return before.apps;
        var step = targets.length ? deps.execute(command(targets, off), 90000).then(function (r) {
            if (r.timed_out) throw new Error('TV did not finish the change in time');
            return verify(targets, off);
        }).then(function (after) {
            if (after.wrong.length) throw new Error('Not confirmed for ' + after.wrong.join(', '));
            return after.apps;
        }) : Promise.resolve(before.apps);
        return step.then(function (apps) {
            if (!flagTargets.length) return apps;
            return deps.execute(clearFlagsCommand(flagTargets), 60000).then(function (r) {
                if (r.timed_out) throw new Error('TV did not finish clearing the startup flags in time');
                deps.invalidate();
                return registry(true);
            }).then(function (d) {
                var wrong = flagsWrong(d.apps, flagTargets);
                if (wrong.length) throw new Error('Startup flags not cleared for ' + wrong.join(', '));
                return d.apps;
            });
        }).catch(function (e) {
            // Put every member that was changed back to its previous state: flags first, then the disabled flag.
            var undo = flagTargets.length ? deps.execute(restoreFlagsCommand(flagTargets), 60000) : Promise.resolve();
            return undo.then(function () {
                return targets.length ? deps.execute(command(targets, !off), 90000).then(function () { return verify(targets, !off); }) : {wrong: []};
            }).then(function (restored) {
                throw new Error(e.message + ' · ' + (restored.wrong.length ? 'restore not confirmed for ' + restored.wrong.join(', ') : 'previous state restored'));
            }, function () {
                throw new Error(e.message + ' · restore not confirmed');
            });
        });
    }).then(function (apps) {
        var result = {ok: true, verified: true, id: group.id, off: off, changed: targets, flagsCleared: off ? flagTargets : [], flagsRestored: [], flagsNotRestored: [],
            stopped: [], stopFailed: [], state: state(group, apps), apps: apps};
        if (!off) return restoreFlagsFor(result, deps);
        // A disabled flag does not end processes that are already running.
        return deps.execute('app_launcher -S', 10000).then(function (r) {
            if (r.exit_code || r.timed_out) throw new Error('running apps unreadable');
            var ids = running(r.stdout).filter(function (id) { return result.state.installed.indexOf(id) >= 0; });
            if (!ids.length) return result;
            return deps.execute(stopCommand(ids), 30000).then(function (k) {
                var codes = exitCodes(k.stdout);
                ids.forEach(function (id) { (codes[id] === 0 ? result.stopped : result.stopFailed).push(id); });
                return result;
            });
        }).catch(function () { result.stopUnconfirmed = true; return result; });
    });
}

module.exports = {GROUPS: GROUPS, ALLOWED_IDS: ALLOWED_IDS, find: find, state: state, command: command,
    stopCommand: stopCommand, clearFlagsCommand: clearFlagsCommand, restoreFlagsCommand: restoreFlagsCommand, exitCodes: exitCodes, running: running, apply: apply};
