'use strict';
// "Restore the TV": puts back what Vetro changed, switches off what can be switched off, and (as a separate,
// confirmed step) deletes the files Vetro keeps on the TV, so that the app can then be removed cleanly.
//
// It composes the reversers that already exist (each one reads back and rolls back on its own); nothing here
// invents a new way to change the TV, except the two small things that had no reverser:
//   - the startup flags (start at boot / restart) that the Task manager changed, saved in startup-backups/<appId>;
//   - the components disabled one by one in the Task manager, listed in disabled-ledger.js.
//
// What it will NOT do: switch on a component just because it is disabled. The firmware ships some disabled
// (factory, hotel, aging apps). A component is switched on again only if Vetro can prove it touched it:
//   - it is in the ledger, or in Vetro's verified set (debloat.VERIFIED_GLOBAL_IDS), or it is a user-installed app,
//   - or it is a member of a Quick settings group (those switches are Vetro's own; see the note in the plan).
// Packages uninstalled from the Task manager and values written in the TV settings pages have no record and
// cannot be brought back from here: the plan says so in `notes`.
//
// Every step is independent: a failure is reported and the next step still runs. Plain ES5 like the other modules.

var debloat = require('./debloat.js');
var quickSettings = require('./quick-settings.js');
var homeOrder = require('./home-order.js');
var ledger = require('./disabled-ledger.js');
// Regular expressions compiled once at module load, not on every call.
var HOME_LINE_RE = /^HO\|(\d+)\|(\d+)$/m;
var CR_END_RE = /\r$/;
var FLAG_PAIR_RE = /^(true|false)\|(true|false)$/;
var VETRO_ID_RE = /^vetrotvapp(\.|$)/;
var LEFT_COUNT_RE = /left=(\d+)/;

var DB = '/opt/dbspace/.pkgmgr_parser.db';
var BACKUPS = '/home/owner/share/vetro/startup-backups';
var SHARE = '/opt/usr/home/owner/share';
var ID = /^[A-Za-z0-9_.-]{1,180}$/;
var BOOL = /^(true|false)$/;

var NOTES = [
    'Packages removed from the Task manager cannot be brought back from here. Install them again from the Samsung app store or from their original package.',
    'Values written in the TV settings pages (network and TV menu) keep no record of what they were. Check them in the TV’s own menu.',
    'Changes that a third-party plugin made itself are not known to Vetro and are not undone.'
];

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function out(r, what) {
    if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || what + ' failed');
    return r.stdout || '';
}
// Resolves {value} or {error}: one unreadable source must not hide the others.
function attempt(fn) {
    return new Promise(function (resolve) { resolve(fn()); }).then(function (v) { return {value: v}; }, function (e) { return {error: (e && e.message) || String(e)}; });
}
function unique(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }

function Restore(deps) { this.d = deps; }

// --- reading ---------------------------------------------------------------------------------------------

var HOME_SCRIPT = homeOrder.PICK_DIR + 'n=0; same=0\nfor f in ' + homeOrder.FILES.join(' ') + '; do\n' +
    ' if [ -f "$D/$f.vetro-bak" ]; then n=$((n+1)); if [ -f "$D/$f" ] && cmp -s "$D/$f" "$D/$f.vetro-bak"; then same=$((same+1)); fi; fi\ndone\necho "HO|$n|$same"\ntrue';

var FLAGS_SCRIPT = 'for f in ' + BACKUPS + '/*; do\n [ -f "$f" ] || continue\n id=${f##*/}\n case "$id" in *[!A-Za-z0-9_.-]*) continue;; esac\n' +
    ' b=$(cat "$f" 2>/dev/null)\n' +
    ' c=$(printf \'.timeout 5000\\n%s\\n\' "SELECT app_onboot,app_autorestart FROM package_app_info WHERE app_id=\'$id\';" | sqlite3 -readonly ' + DB + ' 2>/dev/null)\n' +
    ' echo "SF|$id|$b|$c"\ndone\ntrue';

function parseHome(text) {
    var m = HOME_LINE_RE.exec(String(text || ''));
    if (!m) return null;
    return {backups: +m[1], same: +m[2]};
}
function parseFlags(text) {
    var rows = [];
    String(text || '').split('\n').forEach(function (l) {
        var f = l.replace(CR_END_RE, '').split('|');
        if (f[0] !== 'SF' || f.length < 4) return;
        var id = f[1], backup = f[2] + '|' + f[3], current = f.slice(4).join('|');
        if (!ID.test(id) || !FLAG_PAIR_RE.test(backup)) return;
        rows.push({appId: id, backup: backup, current: FLAG_PAIR_RE.test(current) ? current : null});
    });
    return rows;
}

// Components that Vetro may switch on again outside the Quick settings groups.
function provenComponents(apps, ledgerIds) {
    var verified = debloat.VERIFIED_GLOBAL_IDS;
    return (apps || []).filter(function (a) {
        if (a.disabled !== true) return false;
        if (debloat.isProtected(a.appId) || debloat.isProtected(a.packageId) || VETRO_ID_RE.test(a.appId || '')) return false;
        return ledgerIds.indexOf(a.appId) >= 0 || verified.indexOf(a.appId) >= 0 || a.system === false;
    }).map(function (a) { return a.appId; });
}

function groupMembers(apps) {
    var ids = [];
    quickSettings.GROUPS.forEach(function (g) {
        var s = quickSettings.state(g, apps);
        if (s.status === 'off' || s.status === 'partial') ids = ids.concat(s.disabled);
    });
    return unique(ids);
}

// The plan. Read-only. Each item: {id, label, detail, state: changed|clean|unknown|manual, count?}.
Restore.prototype.plan = function () {
    var d = this.d, self = this;
    return Promise.all([
        attempt(function () { return d.inventory(true).then(function (r) { if (r.registryError) throw new Error('App registry unavailable'); return r.apps; }); }),
        attempt(function () { return d.wins.read(); }),
        attempt(function () { return d.hbbtv.read(); }),
        attempt(function () { return d.dns.status(); }),
        attempt(function () { return d.execute(wrap(HOME_SCRIPT), 8000).then(function (r) { return parseHome(out(r, 'Home order check')); }); }),
        attempt(function () { return d.execute(wrap(FLAGS_SCRIPT), 15000).then(function (r) { return parseFlags(out(r, 'Startup flags check')); }); }),
        attempt(function () { return d.execute(ledger.readCommand(), 8000).then(function (r) { return ledger.parse(out(r, 'Ledger read')); }); }),
        attempt(function () { return d.plugins.list(); }),
        attempt(function () { return d.dock.readState(); }),
        attempt(function () { return d.input.active(); }),
        attempt(function () { return d.mqtt.enabled(); }),
        attempt(function () { return d.factoryTest ? d.factoryTest.read() : {present: false, active: false}; })
    ]).then(function (x) {
        var apps = x[0], wins = x[1], hb = x[2], dns = x[3], home = x[4], flags = x[5], led = x[6], plug = x[7], dock = x[8], input = x[9], mqtt = x[10], factory = x[11];
        var items = [];
        function add(id, label, detail, read, extra) {
            var item = {id: id, label: label, detail: detail, state: 'clean'};
            if (read.error) { item.state = 'unknown'; item.error = read.error; }
            else if (extra) Object.keys(extra).forEach(function (k) { item[k] = extra[k]; });
            items.push(item);
            return item;
        }
        function flag(item, on, count) { if (item.state === 'clean' && on) item.state = 'changed'; if (count != null) item.count = count; }

        var it = add('launcher', 'Launcher', 'Switches the Vetro launcher off, so Samsung’s Home is back, and puts Autorun Smart Hub back as it was.', dock);
        if (!dock.error) flag(it, dock.value.enabled === true);

        var third = plug.error ? [] : plug.value.filter(function (p) { return !p.bundled && p.enabled; });
        it = add('plugins', 'Third-party plugins', 'Switches every plugin that is on off. The plugin files stay until you remove Vetro’s data. What a plugin changed on its own is not undone.', plug);
        if (!plug.error) flag(it, third.length > 0, third.length);

        it = add('remote', 'Remote interception', 'Stops the remapper from listening to the remote. The rules stay saved.', input);
        if (!input.error) flag(it, input.value === true);

        it = add('mqtt', 'Home Assistant bridge', 'Stops publishing the TV state to your broker. The saved settings stay.', mqtt);
        if (!mqtt.error) flag(it, mqtt.value === true);

        var groupIds = apps.error ? [] : groupMembers(apps.value);
        it = add('groups', 'Quick settings groups', 'Switches on the components of the advertising, tracking and voice groups, with their start at boot and restart as they were. A group is Vetro’s own, so its components are switched on even if the firmware had them off.', apps);
        if (!apps.error) flag(it, groupIds.length > 0, groupIds.length);

        var compIds = apps.error ? [] : provenComponents(apps.value, led.error ? [] : led.value).filter(function (id) { return groupIds.indexOf(id) < 0; });
        it = add('components', 'Components disabled in the Task manager', 'Switches on again the components Vetro disabled one by one (its own list), the verified viewing-data set and apps you installed. Components the firmware ships disabled are left alone.', apps);
        if (!apps.error) flag(it, compIds.length > 0, compIds.length);

        var w = wins.error ? null : wins.value.wins;
        [['telemetry', 'Viewing-data and usage-log services', w && w.telemetry && w.telemetry.status !== 'off', 'Starts them again and lifts the DNS block Vetro added for the usage-log host.'],
            ['ambient', 'Ambient autostart', w && w.ambient && w.ambient.status !== 'off', 'Lets Samsung’s own start of the screen saver run again.'],
            ['multiscreen', 'Multi View autostart', w && w.multiscreen && w.multiscreen.status === 'on', 'Removes the preload file, so Multi View loads at boot again.'],
            ['firmware', 'Automatic firmware updates', w && w.firmware && w.firmware.status === 'on', 'Puts the automatic update value back to what it was.']
        ].forEach(function (c) {
            var item = add('win-' + c[0], c[1], c[3], wins);
            if (!wins.error) flag(item, !!c[2]);
        });

        it = add('hbbtv', 'HbbTV', 'Puts the HbbTV menu value back, removes the brake file and starts its service and app.', hb);
        if (!hb.error) {
            var h = hb.value, chosen = false;
            try { chosen = d.wins.load().hbbtv === true; } catch (e) { /* unreadable: only an off state counts */ }
            var active = h.off || (chosen && (h.valueOff || h.flag));
            flag(it, active);
            if (it.state === 'changed' && h.valueOff && !h.canRestore) { it.state = 'manual'; it.detail = 'The value HbbTV had before was not saved. Set HbbTV back in the TV’s own menu.'; }
        }

        it = add('dns', 'Domain blocking', 'Takes the blocking out of the TV’s hosts file now. The saved domain list stays until you remove Vetro’s data.', dns);
        if (!dns.error) flag(it, dns.value.enabled === true || dns.value.applied === true);

        it = add('home-order', 'Home app order', 'Puts the Home order back to the copy Vetro saved before the first change. Home may need a restart to show it.', home);
        if (!home.error) {
            if (!home.value) { it.state = 'unknown'; it.error = 'Home order could not be read'; }
            else if (home.value.backups > 0 && home.value.backups < homeOrder.FILES.length) { it.state = 'unknown'; it.error = 'The saved Home order is incomplete'; }
            else flag(it, home.value.backups > 0 && home.value.same < home.value.backups);
        }

        // #135: not a Vetro setting, but Vetro's Task manager could open AgingApp, which leaves this key at 1. Only exactly 1 counts.
        it = add('factory-test', 'Factory colour test', 'Sets db/FactoryApp/Aging back to 0, so the TV stops starting Samsung’s colour test (AgingApp) at every boot. Restart the TV afterwards.', factory);
        if (!factory.error) flag(it, factory.value.active === true);

        var changedFlags = flags.error ? [] : flags.value.filter(function (r) { return r.current !== r.backup; });
        it = add('startup-flags', 'Start at boot and restart', 'Puts back the start-at-boot and restart values you changed in the Task manager.', flags);
        if (!flags.error) flag(it, changedFlags.length > 0, changedFlags.length);

        return {ok: true, ts: Date.now(), items: items, notes: NOTES.slice(),
            pending: items.filter(function (i) { return i.state === 'changed'; }).length,
            _data: {groupIds: groupIds, compIds: compIds, third: third, flags: flags.error ? [] : flags.value}};
    });
};

// What the dashboard gets: the plan without internals.
Restore.prototype.publicPlan = function () {
    return this.plan().then(function (p) { delete p._data; return p; });
};

// --- running ---------------------------------------------------------------------------------------------

// One restore, steps in a fixed order. A step that fails does not stop the next one.
Restore.prototype.run = function () {
    var self = this, d = this.d, steps = [];
    function record(item, status, message) { steps.push({id: item.id, label: item.label, status: status, message: message || ''}); }
    return this.plan().then(function (plan) {
        var byId = {};
        plan.items.forEach(function (i) { byId[i.id] = i; });
        var order = [
            ['launcher', function () { return d.dock.disable().then(function () { return 'Launcher off; Samsung’s Home is back.'; }); }],
            ['plugins', function () {
                plan._data.third.forEach(function (p) { d.plugins.setEnabled(p.id, false); });
                return 'Switched off: ' + plan._data.third.map(function (p) { return p.name || p.id; }).join(', ') + '.';
            }],
            ['remote', function () { return Promise.resolve(d.input.off()).then(function () { return 'The remapper no longer listens to the remote.'; }); }],
            ['mqtt', function () { return Promise.resolve(d.mqtt.off()).then(function () { return 'The bridge is off.'; }); }],
            ['groups', function () { return self.runGroups(); }],
            ['components', function () { return self.runComponents(); }],
            ['win-telemetry', function () { return self.runWin('telemetry', 'Services started again; the DNS block Vetro added is lifted.'); }],
            ['win-ambient', function () { return self.runWin('ambient', 'Samsung’s own Ambient start runs again.'); }],
            ['win-multiscreen', function () { return self.runWin('multiscreen', 'The preload file is removed.'); }],
            ['win-firmware', function () { return self.runWin('firmware', 'Automatic update value put back.'); }],
            ['hbbtv', function () { return self.runHbbtv(); }],
            ['dns', function () {
                return d.dns.status().then(function (s) { return d.dns.apply(false, s.domains || []); }).then(function (s) {
                    if (s.enabled || s.applied) throw new Error('The TV still applies the filter');
                    return 'Domain blocking off; the hosts file is back to the original.';
                });
            }],
            ['home-order', function () { return d.homeOrder.restore().then(function () { return 'Home order put back. Restart the TV to see it.'; }); }],
            ['startup-flags', function () { return self.runFlags(plan._data.flags); }],
            ['factory-test', function () { return d.factoryTest.reset().then(function (r) { return r.message; }); }]
        ];
        return order.reduce(function (chain, step) {
            return chain.then(function () {
                var item = byId[step[0]];
                if (!item) return;
                if (item.state === 'manual') return record(item, 'manual', item.detail);
                if (item.state === 'unknown') return record(item, 'failed', 'Could not be read: ' + (item.error || 'unavailable') + '.');
                if (item.state !== 'changed') return record(item, 'skipped', 'Nothing to put back.');
                return new Promise(function (resolve) { resolve(step[1]()); }).then(function (msg) { record(item, 'done', msg); }, function (e) { record(item, 'failed', (e && e.message) || String(e)); });
            });
        }, Promise.resolve()).then(function () {
            return self.publicPlan();
        }).then(function (after) {
            var failed = steps.filter(function (s) { return s.status === 'failed'; }).length;
            return {ok: true, complete: failed === 0 && after.pending === 0, steps: steps, remaining: after.items.filter(function (i) { return i.state === 'changed'; }).map(function (i) { return i.id; }), notes: NOTES.slice()};
        });
    });
};

Restore.prototype.runGroups = function () {
    var d = this.d, total = 0, errors = [];
    var deps = {execute: d.execute, inventory: d.inventory, invalidate: d.invalidate};
    return d.inventory(true).then(function (r) {
        if (r.registryError) throw new Error('App registry unavailable');
        var apps = r.apps;
        return quickSettings.GROUPS.reduce(function (chain, g) {
            return chain.then(function () {
                var s = quickSettings.state(g, apps);
                if (s.status !== 'off' && s.status !== 'partial') return;
                return quickSettings.apply(g.id, false, deps).then(function (res) {
                    total += res.changed.length;
                    if (res.apps) apps = res.apps;
                    if (res.flagsNotRestored && res.flagsNotRestored.length) errors.push(g.label + ': startup flags not put back for ' + res.flagsNotRestored.join(', '));
                }, function (e) { errors.push(g.label + ': ' + e.message); });
            });
        }, Promise.resolve());
    }).then(function () {
        if (errors.length) throw new Error(errors.join(' · ') + (total ? ' · ' + total + ' component' + (total === 1 ? '' : 's') + ' switched on' : ''));
        return total + ' component' + (total === 1 ? '' : 's') + ' switched on.';
    });
};

Restore.prototype.runComponents = function () {
    var d = this.d;
    return Promise.all([d.inventory(true), d.execute(ledger.readCommand(), 8000)]).then(function (x) {
        if (x[0].registryError) throw new Error('App registry unavailable');
        var led = ledger.parse(out(x[1], 'Ledger read'));
        var groupIds = groupMembers(x[0].apps);
        var ids = provenComponents(x[0].apps, led).filter(function (id) { return groupIds.indexOf(id) < 0; });
        if (!ids.length) return 'Nothing to switch on.';
        return d.execute(quickSettings.command(ids, false), 90000).then(function (r) {
            if (r.timed_out) throw new Error('The TV did not finish in time');
            d.invalidate();
            return d.inventory(true);
        }).then(function (after) {
            var byId = {};
            after.apps.forEach(function (a) { byId[a.appId] = a; });
            var wrong = ids.filter(function (id) { return !byId[id] || byId[id].disabled !== false; });
            var good = ids.filter(function (id) { return wrong.indexOf(id) < 0; });
            return (good.length ? d.execute(ledger.removeCommand(good), 8000).catch(function () {}) : Promise.resolve()).then(function () {
                if (wrong.length) throw new Error('Not confirmed for ' + wrong.join(', '));
                return ids.length + ' component' + (ids.length === 1 ? '' : 's') + ' switched on.';
            });
        });
    });
};

Restore.prototype.runWin = function (id, message) {
    return this.d.wins.apply(id, false).then(function () { return message; });
};

Restore.prototype.runHbbtv = function () {
    var d = this.d;
    return d.hbbtv.read().then(function (s) { return d.hbbtv.change(false, s.value); }).then(function () {
        try { d.wins.remember('hbbtv', false); } catch (e) { /* the choice is only used at the next boot */ }
        if (d.afterHbbtv) d.afterHbbtv();
        return 'HbbTV is back on.';
    });
};

// Startup flags: a backup that equals the current value is just removed; a different one is written back first.
Restore.prototype.runFlags = function (rows) {
    var d = this.d;
    rows.forEach(function (r) { if (!ID.test(r.appId)) throw new Error('Invalid app ID'); });
    var lines = rows.map(function (r) {
        var parts = r.backup.split('|'), on = parts[0], re = parts[1], f = BACKUPS + '/' + r.appId;
        if (!BOOL.test(on) || !BOOL.test(re)) throw new Error('Invalid saved flags for ' + r.appId);
        if (r.current === r.backup) return 'rm -f "' + f + '"; echo "' + r.appId + ' 0"';
        return 'printf \'.timeout 5000\\n%s\\n\' "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'' + on + '\',app_autorestart=\'' + re + '\' WHERE app_id=\'' + r.appId + '\'; COMMIT;" | sqlite3 -bail ' + DB + ' >/dev/null 2>&1; r=$?; [ $r -eq 0 ] && rm -f "' + f + '"; echo "' + r.appId + ' $r"';
    });
    if (!lines.length) return Promise.resolve('Nothing to put back.');
    return d.execute(wrap(lines.join('\n')), 60000).then(function (r) {
        if (r.timed_out) throw new Error('The TV did not finish in time');
        var codes = quickSettings.exitCodes(r.stdout);
        var bad = rows.filter(function (x) { return codes[x.appId] !== 0; }).map(function (x) { return x.appId; });
        d.invalidate();
        if (bad.length) throw new Error('Could not put back the startup flags of ' + bad.join(', '));
        return 'Startup flags put back on ' + rows.length + ' component' + (rows.length === 1 ? '' : 's') + '.';
    });
};

// --- Vetro's data ----------------------------------------------------------------------------------------

// The files that hold the values above (autoupdatePrevious, quick-flags, startup-backups, the HbbTV value, the Home
// backups) and Vetro's own settings. This is why it only runs once everything is restored. vetro-auth.json goes last,
// after the answer is out, or the dashboard would lose its session in the middle of the call.
var ERASE_SCRIPT = [
    'find ' + SHARE + ' -maxdepth 1 -name \'vetro-*\' ! -name \'vetro-auth.json\' -exec rm -rf {} + 2>/dev/null',
    'rm -rf /home/owner/share/vetro',
    'rm -f /home/owner/tvlauncher.pid /home/owner/tvlauncher.fifo /home/owner/tvlauncher.log',
    'for c in ' + homeOrder.BASE + ' ' + homeOrder.BASE_NEW_HOME + '; do rm -f "$c"/.appLayerCache.[12].vetro-bak "$c"/.appLayerCache.[12].vetro-txn "$c"/.appLayerCache.[12].vetro-missing "$c"/.appLayerCache.[12].vetro-tmp; done',
    'echo left=$(find ' + SHARE + ' -maxdepth 1 -name \'vetro-*\' ! -name \'vetro-auth.json\' | wc -l)',
    'true'
].join('\n');

// Refuses while anything is still to be put back. Resolves {ok, left, finish}: call finish() once the answer is sent.
Restore.prototype.eraseData = function () {
    var d = this.d;
    return this.plan().then(function (plan) {
        var pending = plan.items.filter(function (i) { return i.state === 'changed'; });
        if (pending.length) {
            var e = new Error('Restore the TV first: ' + pending.map(function (i) { return i.label; }).join(', ') + ' still to put back.');
            e.statusCode = 409;
            throw e;
        }
        return d.execute(wrap(ERASE_SCRIPT), 30000);
    }).then(function (r) {
        var text = out(r, 'Removing Vetro’s data'), m = LEFT_COUNT_RE.exec(text);
        return {ok: true, left: m ? +m[1] : null, finish: function () { try { d.removeAuth(); } catch (e) { /* the file may be gone already */ } }};
    });
};

module.exports = {Restore: Restore, NOTES: NOTES, parseHome: parseHome, parseFlags: parseFlags, provenComponents: provenComponents,
    groupMembers: groupMembers, ERASE_SCRIPT: ERASE_SCRIPT, HOME_SCRIPT: HOME_SCRIPT, FLAGS_SCRIPT: FLAGS_SCRIPT};
