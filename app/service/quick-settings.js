'use strict';
// Regular expressions compiled once at module load, not on every call.
// (state() is also sent to the dashboard as text, so it keeps its own literals.)
var EXIT_CODES_RE = /^(\S+) (\d+)$/;
var RUNNING_RE = /^\s*([A-Za-z0-9_.-]+) \((\d+)\)/;
var RESTORE_FLAGS_FOR_RE = /^(\S+) (\d+|none)$/;
// Quick Settings groups: one switch per feature, applied as the global
// disabled flag on every installed member, as the Debloater does for a single
// component. Disabling also stops members that are still running, so the
// change takes effect now. Members come from the Q80A package manifests.
// Since 0.7.1 (ideas from samshush, https://github.com/elithrar/samshush, BSD-3, re-written here): Samsung's own "do not start"
// files for the groups' background services (markerUnits), the TV Plus power-on setting (vconf) and the process check after a stop.

// A group with "area" has no fixed list: its members are every component the Task manager files under that area,
// except the ones that role "keep" or the protection rules cover (Smart Hub's ad agent, Vetro itself).
var GROUPS = [
    {id: 'tracking-all', label: 'All advertising and tracking', section: 'tracking', area: 'tracking',
        description: 'Stops viewing data, ad players, analytics, personalised content and privacy screens. Samsung Home still uses Smart Hub’s ad agent.',
        // Former members (formerIds): no longer switched off, and switched on again where an earlier Vetro left them off, whenever this
        // switch is used and by Restore the TV. content-grab-service passes remote keys to a cable or satellite box (it was filed as a
        // picture grabber until 0.7.1).
        ids: [], formerIds: ['content-grab-service']},
    {id: 'voice-all', label: 'All voice assistants', section: 'voice', area: 'voice', microphone: true, everything: true,
        description: 'Stops Alexa, Bixby, Google Assistant and shared voice services, including search suggestions.',
        ids: [], markerUnits: []},
    {id: 'alexa', label: 'Alexa', section: 'voice', microphone: true,
        description: 'Stops Alexa and its wake word.',
        ids: ['com.samsung.tv.alexa-client', 'com.samsung.tv.alexa-fullscreen-app', 'com.samsung.tv.alexa-jump-starter',
            'com.samsung.tv.wakeup-engine-alexa']},
    {id: 'google', label: 'Google Assistant', section: 'voice', microphone: true,
        description: 'Stops Google Assistant and its full-screen view.',
        ids: ['com.samsung.tv.google-assistant', 'com.samsung.tv.google-fullscreen-app']},
    {id: 'bixby', label: 'Bixby', section: 'voice', microphone: true,
        description: 'Stops Bixby, its voice menus and wake word.',
        ids: ['com.samsung.tv.bixby-context-client', 'com.samsung.tv.bixby-prov', 'com.samsung.tv.bixbycapsuleviewer',
            'com.samsung.tv.mybixby', 'com.samsung.tv.wakeup-engine-bixby'],
        // Tizen 9 starts bixby-prov from a unit of its own that skips the start when Samsung's "do not start" file exists (see MARKERS).
        markerUnits: ['com.samsung.tv.bixby-prov.service']},
    {id: 'voice', label: 'Voice services', section: 'voice', microphone: true,
        description: 'Stops speech-to-text, hands-free voice and other voice services.',
        ids: ['com.samsung.tv.vif', 'com.samsung.tv.farfieldvoice', 'com.samsung.tv.ondevice-voice',
            'com.samsung.tv.voiceassistant-music', 'com.samsung.tv.cnvoice', 'com.samsung.tv.cnvoice-assistant',
            'org.tizen.voice-app', 'org.tizen.voice-app-service', 'org.tizen.voice-client', 'org.tizen.stt-client'],
        // The units that launch farfieldvoice, ondevice-voice, voice-app (and voice-client on Tizen 9) when a voice remote is ready.
        markerUnits: ['com.samsung.tv.farfieldvoice.service', 'com.samsung.tv.ondevice-voice.service', 'org.tizen.voice-app.service',
            'org.tizen.voice-client.service']},
    // Samsung TV Plus (free ad-supported channels): the app, its deep-link and OTA helpers, and the streaming player behind it.
    // bms-service is started by systemd with Restart=always, so a disabled flag is not enough: Samsung's own units skip the start
    // when a file exists in /opt/usr/share/systemd/system, which `services` lists.
    // slive-provider-daemon (com.samsung.tv.slive-daemon) is no longer a member: Samsung's live TV app is one of its clients
    // (tv-viewer links libslive-provider, as do the channel info and channel indicator libraries, Q80A image), and with it stopped
    // CH +/- stopped working on a 2024 The Frame (#299). It is a former member: switched on and started again where an earlier
    // Vetro stopped it, whenever this switch is used, and by Restore the TV.
    // These packages are not system packages, so Components can also uninstall them (pkgcmd -u).
    {id: 'tvplus', label: 'Samsung TV Plus', section: 'memory',
        description: 'The app, its helpers and the streaming player with its ad beacons. Stops Samsung TV Plus and its player, and it no longer starts at power-on. The channel service stays on: live TV needs it to change channels. Frees about 15 MB.',
        ids: ['com.samsung.tv.tvplus', 'com.samsung.tv.tvPlusDeeplinker', 'w2VwCK465D.OTApp', 'org.tizen.bms-service'],
        services: ['bms'], formerIds: ['com.samsung.tv.slive-daemon'], formerServices: ['slive-provider-daemon'],
        // Samsung's own "start TV Plus at power-on" setting (a vconf key in the Q80A firmware, idea from samshush): false while the
        // group is off; the value it had is saved and written back when the group is on again, or by Restore the TV.
        vconf: [{key: 'db/menu/autorun_tv_plus', type: 'bool', off: 'false'}]},
    // Vision AI (2024 and later TVs): holding Home for a second sends the AI key, the key of the AI button on 2025 remotes,
    // and these apps answer it with Click to Search or the AI companion. Bixby and the voice apps play no part in it. With them off
    // the key opens nothing; a short Home press is unchanged. Kept on: the Vision AI row of Samsung's Home (visionairow), live
    // translation and the AI picture and sound settings. Most TVs have none of these apps, so the switch only shows where they are.
    {id: 'vision-ai', label: 'Vision AI', section: 'memory', onlyInstalled: true,
        description: 'Holding Home, or pressing the remote’s AI button, no longer opens Samsung’s AI screens (Click to Search and the AI companion). Nothing opens in their place.',
        ids: ['com.samsung.tv.AICompanionAgent', 'com.samsung.tv.AICompanionUI', 'com.samsung.tv.AICompanionUILauncher', 'com.samsung.tv.AICompanionUINotice',
            'com.samsung.tv.ai-discovery-ui', 'com.samsung.tv.ai-discovery-service', 'com.samsung.tv.ai-discovery-sceneanalyzer', 'com.samsung.tv.download-content']},
    // From samshush's optional controls (elithrar/samshush), checked against 184 public diagnostics on 2026-11-22. Each shows only on a TV
    // that has its apps. Gaming Hub: the UI apps (2022 and later) and the daemon and service that nearly every TV runs (ghdaemon on 114 of
    // 122 process lists, ~11 MB). ghdaemon.service restarts every 2 s on failure (Restart=on-failure, RestartSec=2 in the 6.0, 6.5 and 9
    // firmware): a disabled ghdaemon without Samsung's "do not start" file loops for ever (1509 restarts in 1 h 51 min on a Q80A).
    {id: 'gaming-hub', label: 'Gaming Hub', section: 'memory', onlyInstalled: true,
        description: 'Samsung Gaming Hub, the cloud gaming screen, and its background service, which runs on most TVs (about 11 MB). Game Mode is a picture setting and stays as it is.',
        ids: ['com.samsung.tv.gaminghub', 'com.samsung.tv.gamehome', 'com.samsung.tv.home.game', 'com.samsung.tv.ghdaemon', 'com.samsung.tv.ghservice'],
        markerUnits: ['com.samsung.tv.ghdaemon.service']},
    // SmartThings: the thing and client run on almost every TV (8 and 11 MB); the hub, plugins and iot-hub-control on 2022 and later.
    // Its units start the apps without Restart=, so a disabled app does not loop.
    {id: 'smartthings', label: 'SmartThings', section: 'memory', onlyInstalled: true, confirm: true,
        confirmText: 'The SmartThings app on your phone can no longer find or control this TV, and neither can anything else that goes through SmartThings. Turn this off again to bring them back.',
        description: 'The SmartThings services. The SmartThings app on a phone, and anything that controls the TV through SmartThings, can no longer find or control it, and the TV stops showing SmartThings devices. Together they hold about 20 MB on most TVs.',
        ids: ['com.samsung.tizen.smartthings-client', 'com.samsung.tizen.smartthings-thing', 'com.samsung.tizen.smartthings-hub', 'com.samsung.tizen.smartthings-plugin',
            'com.samsung.tizen.smartthings-plugin-platform', 'com.samsung.tizen.smartthings-streaming', 'com.samsung.tv.iot-hub-control', 'com.samsung.tv.coba.smartthings',
            'com.samsung.tv.SmartThingsApp', 'com.samsung.tv.smartthings-partial-app']},
    {id: 'smartthings-find', label: 'SmartThings Find', section: 'memory', onlyInstalled: true,
        description: 'The service that lets SmartThings Find use this TV to locate lost Galaxy phones, tags and earbuds nearby (about 6 MB where it runs).',
        ids: ['com.samsung.tv.smartthingsfind-daemon', 'com.samsung.tv.smartthingsfind-ondemand']},
    // Sound Sensor (ambient-sound) and the Pet Care widget: 2023 and later TVs; they start on demand. Not members: tvsensor-iot-service
    // (it also runs the light sensor's sync, samshush keeps it) and aisound-app (the TV's adaptive sound).
    {id: 'sound-sensor', label: 'Sound Sensor and Pet Care', section: 'memory', onlyInstalled: true,
        description: 'Sound Sensor, the sound detection the TV offers to SmartThings, and the Pet Care widget. The light sensor and the TV’s adaptive sound are not part of it.',
        ids: ['com.samsung.tv.ambient-sound', 'com.samsung.tv.iotwidget-petcare']},
    // Apps that come with the TV and that Samsung's own Apps screen does not let you delete. One switch each (section
    // "apps", the second group of the Disable tab): the app is disabled like any member of a group, and the same switch,
    // or Restore the TV, enables it again. The ids are the Q80A's; a TV without the app does not show its switch. The row
    // has no description: the group's one sentence says what a disabled app means.
    {id: 'app-netflix', label: 'Netflix', section: 'apps', description: '', ids: ['org.tizen.netflix-app', 'org.tizen.netflixlowmem']},
    {id: 'app-primevideo', label: 'Prime Video', section: 'apps', description: '',
        ids: ['org.tizen.primevideo', 'org.tizen.primevideo-dummy', 'org.tizen.primevideo_companionapp']},
    {id: 'app-youtube', label: 'YouTube', section: 'apps', description: '', ids: ['9Ur5IzDKqV.TizenYouTube']},
    {id: 'app-appletv', label: 'Apple TV', section: 'apps', description: '', ids: ['com.samsung.tv.aria-video', 'com.samsung.tv.aria-dummy']},
    {id: 'app-browser', label: 'Internet browser', section: 'apps', description: '', ids: ['org.tizen.browser']},
    {id: 'app-gallery', label: 'Gallery', section: 'apps', description: '', ids: ['com.samsung.tv.gallery']},
    // The same apps the Uninstall tab offers, for people who would rather switch them off: each with the background service its package
    // starts (seen in the 88 diagnostics of 2026-11-18: Disney+ on 49 TVs, Spotify 57, Xbox 29, GeForce NOW and Amazon Luna 10, Samsung Health 14).
    {id: 'app-disney', label: 'Disney+', section: 'apps', description: '', ids: ['MCmYXNxgcu.DisneyPlus', 'MCmYXNxgcu.DisneyPlusService']},
    {id: 'app-spotify', label: 'Spotify', section: 'apps', description: '',
        ids: ['rJeHak5zRg.Spotify', 'rJeHak5zRg.SpotifyService', 'rJeHak5zRg.ContinueWatchingService']},
    {id: 'app-xbox', label: 'Xbox', section: 'apps', description: '', ids: ['GHI3a0zMSx.XboxGamePass', 'GHI3a0zMSx.Service']},
    {id: 'app-geforce', label: 'GeForce NOW', section: 'apps', description: '', ids: ['w0wZu3xkQq.GeForceNOW', 'w0wZu3xkQq.GeForceNOWService']},
    {id: 'app-luna', label: 'Amazon Luna', section: 'apps', description: '', ids: ['CmeyUlnhYY.LunaWebApp', 'CmeyUlnhYY.LunaService']},
    // Health's background service app is NOT a member (113 public diagnostics list it on TVs without Samsung Health: the switch would
    // show where there is nothing to switch off). Its units skip their start on Samsung's own "do not start" file instead.
    {id: 'app-health', label: 'Samsung Health', section: 'apps', description: '', ids: ['com.samsung.tv.samsung-health'],
        markerUnits: ['samsunghealth-service-tv.service', 'samsunghealth-service-tv-path-activation.service', 'samsunghealth-service-tv-eventd.service']},
    // For people who run a third-party launcher: the Home key stops opening Samsung's Home. It does not turn on the
    // Vetro launcher (Launcher tab), which is a separate choice. The Home key has to be mapped to the other launcher by hand.
    {id: 'samsung-home', label: 'Samsung Home', section: 'home', confirm: true,
        description: 'Home stops opening Samsung Home. On a Q80A the TV may stall at startup and need a factory reset. Turn Samsung Home back on before restarting. For another launcher, use Vetro UI → Launcher.',
        ids: ['com.samsung.tv.csfs']}
];
var ALLOWED_IDS = GROUPS.reduce(function (all, g) { return all.concat(g.ids); }, []);
// Every voice unit is also the "all voice assistants" switch's.
find('voice-all').markerUnits = GROUPS.filter(function (g) { return g.section === 'voice' && g.markerUnits && g.markerUnits.length; })
    .reduce(function (all, g) { return all.concat(g.markerUnits); }, []);
var ID = /^[A-Za-z0-9_.-]{1,180}$/;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function find(id) { return GROUPS.filter(function (g) { return g.id === id; })[0] || null; }

// "on": every installed member enabled; "off": every one disabled and none of them left on boot or auto-restart.
// A disabled member that still has a startup flag is "flagged": the group is only partly done until the flag is cleared.
function state(group, rows, markers) {
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
    // Samsung's own "do not start" files for the group's units (markerUnits), read from the TV and passed in as
    // {unit: {marker, present}}: only the units this TV has count. Off needs every file down; on, none of them.
    var units = (group.markerUnits || []).filter(function (u) { return markers && markers[u]; });
    var blocked = units.filter(function (u) { return markers[u].present === true; });
    var open = units.filter(function (u) { return markers[u].present !== true; });
    if (status === 'off' && open.length) status = 'partial';
    else if (status === 'on' && blocked.length) status = 'partial';
    return {id: group.id, status: status, installed: installed, enabled: enabled, disabled: disabled, flagged: flagged,
        markersOpen: open, markersBlocked: blocked};
}

// One script for the whole group: per-ID exit codes, no per-command queueing.
function command(ids, disable) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('for id in ' + ids.join(' ') + '; do pkgcmd ' + (disable ? '-D' : '-A') +
        ' -t app -n "$id" --global >/dev/null 2>&1; echo "$id $?"; done');
}
// The startup flags live in the package database, as the Task manager edits them (component-actions.js).
var DB = '/opt/dbspace/.pkgmgr_parser.db', SAVED = '/home/owner/share/vetro/quick-flags';
// pkgcmd may still hold the database when the flag script starts right after it: sqlite3 waits instead of failing at once.
var SQL = 'q() { printf \'.timeout 5000\\n%s\\n\' "$1" | sqlite3 -bail ' + DB + '; }\n';
// Clear boot and auto-restart; the previous values are kept in SAVED/<id> so that turning the group back on restores them.
function clearFlagsCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap(SQL + 'mkdir -p ' + SAVED + '\nfor id in ' + ids.join(' ') + '; do\n' +
        ' v=$(q "SELECT app_onboot,app_autorestart FROM package_app_info WHERE app_id=\'$id\';")\n' +
        ' case "$v" in *true*) echo "$v" > "' + SAVED + '/$id";; esac\n' +
        ' q "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'false\',app_autorestart=\'false\' WHERE app_id=\'$id\'; COMMIT;" >/dev/null 2>&1; echo "$id $?"\ndone');
}
// "<id> 0": put back, "<id> none": nothing had been saved for it, anything else: failed.
function restoreFlagsCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap(SQL + 'for id in ' + ids.join(' ') + '; do\n' +
        ' f="' + SAVED + '/$id"\n [ -f "$f" ] || { echo "$id none"; continue; }\n' +
        ' v=$(cat "$f"); on=${v%%|*}; re=${v##*|}\n' +
        ' case "$on" in true|false) ;; *) on=false;; esac\n case "$re" in true|false) ;; *) re=false;; esac\n' +
        ' q "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'$on\',app_autorestart=\'$re\' WHERE app_id=\'$id\'; COMMIT;" >/dev/null 2>&1; r=$?\n' +
        ' [ $r -eq 0 ] && rm -f "$f"; echo "$id $r"\ndone');
}
var SERVICE_DIR = '/opt/usr/share/systemd/system/', SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
var UNIT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:service|path)$/;
var MARKER_LINE_RE = /^MK\|(\S+)\|(\S+)\|([01])$/;
var VETRO_DIR = '/home/owner/share/vetro', MARKERS_LEDGER = VETRO_DIR + '/quick-markers';   // one name per line: the "do not start" files Vetro put down (Restore removes these)
// Every unit any group can keep from starting (see markerUnits).
var MARKER_UNITS = GROUPS.reduce(function (all, g) {
    (g.markerUnits || []).forEach(function (u) { if (all.indexOf(u) < 0) all.push(u); });
    return all;
}, []);
// For each unit this TV has, the name of Samsung's "do not start" file as the unit itself names it
// (ConditionPathExists=!/opt/usr/share/systemd/system/<name>) and whether it is there. Units without that line are left out:
// Vetro never creates a file a unit does not look at (Tizen 9 names some differently, the Q80A has no Bixby one).
function markersReadCommand(units) {
    units.forEach(function (u) { if (!UNIT_RE.test(u)) throw new Error('Invalid unit'); });
    return wrap('for u in ' + units.join(' ') + '; do m=$(systemctl cat "$u" 2>/dev/null | sed -n "s|^ConditionPathExists=!' + SERVICE_DIR +
        '||p" | head -1); [ -n "$m" ] || continue; [ -e "' + SERVICE_DIR + '$m" ] && p=1 || p=0; echo "MK|$u|$m|$p"; done; true');
}
function parseMarkers(text) {
    var out = {};
    String(text || '').split('\n').forEach(function (l) {
        var m = MARKER_LINE_RE.exec(l.trim());
        if (m && UNIT_RE.test(m[1]) && SERVICE_RE.test(m[2])) out[m[1]] = {marker: m[2], present: m[3] === '1'};
    });
    return out;
}
// Off: put the files down (and note them), stop the units now. On: take the files away; the units' own .path units start
// them again when they are needed (a voice remote, Samsung Health), so nothing is started here.
function markersCommand(list, off) {
    list.forEach(function (x) { if (!UNIT_RE.test(x.unit) || !SERVICE_RE.test(x.marker)) throw new Error('Invalid service'); });
    var names = list.map(function (x) { return x.marker; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
    var files = names.map(function (m) { return SERVICE_DIR + m; }).join(' ');
    return wrap(off
        ? 'mkdir -p ' + SERVICE_DIR + ' ' + VETRO_DIR + '\ntouch ' + files + '\nfor m in ' + names.join(' ') + '; do grep -qx "$m" ' + MARKERS_LEDGER +
            ' 2>/dev/null || echo "$m" >> ' + MARKERS_LEDGER + '; done\nfor u in ' + list.map(function (x) { return x.unit; }).join(' ') +
            '; do systemctl stop --no-block "$u" 2>/dev/null; done\nsleep 1\ntrue'
        : 'rm -f ' + files + '\nif [ -f ' + MARKERS_LEDGER + ' ]; then grep -vx -e ' + names.join(' -e ') + ' ' + MARKERS_LEDGER + ' > ' + MARKERS_LEDGER +
            '.tmp; mv -f ' + MARKERS_LEDGER + '.tmp ' + MARKERS_LEDGER + '; fi\ntrue');
}
// One component switched off or on by itself (Apps and processes): the unit named after it, when a group keeps that unit from
// starting with Samsung's "do not start" file (MARKER_UNITS). com.samsung.tv.ghdaemon.service restarts every 2 s once its app is
// disabled (Restart=on-failure, RestartSec=2 on 6.0, 6.5 and 9) and only the file ends that; the voice units get theirs as the
// Voice services group does. Off: file down, unit stopped; on: file away. Resolves {units, ok}; never rejects.
function componentMarkers(appId, off, execute) {
    var units = ID.test(appId || '') && MARKER_UNITS.indexOf(appId + '.service') >= 0 ? [appId + '.service'] : [];
    if (!units.length) return Promise.resolve({units: 0, ok: true});
    var read = function () {
        return execute(markersReadCommand(units), 20000).then(function (r) {
            if (r.timed_out || r.exit_code) throw new Error('Startup blocks unreadable');
            return parseMarkers(r.stdout);
        });
    };
    return read().then(function (found) {
        var list = units.filter(function (u) { return found[u]; }).map(function (u) { return {unit: u, marker: found[u].marker}; });
        if (!list.length) return {units: 0, ok: true};
        return execute(markersCommand(list, off), 30000).then(read).then(function (after) {
            return {units: list.length, ok: list.every(function (x) { return after[x.unit] && after[x.unit].present === off; })};
        });
    }).catch(function () { return {units: units.length, ok: false}; });
}
// Restore the TV: every file Vetro put down, whatever the switches say now.
var MARKERS_CLEAR = 'if [ -f ' + MARKERS_LEDGER + ' ]; then while read -r m; do case "$m" in ""|*/*|.*) ;; *) rm -f "' + SERVICE_DIR + '$m";; esac; done < ' +
    MARKERS_LEDGER + '; rm -f ' + MARKERS_LEDGER + '; fi; echo "MC|done"';
function readMarkers(execute) {
    return execute(markersReadCommand(MARKER_UNITS), 20000).then(function (r) {
        if (r.timed_out || r.exit_code) throw new Error('Startup blocks unreadable');
        return parseMarkers(r.stdout);
    });
}
// A vconf setting a group changes while it is off (vconf: [{key, type: 'bool', off}]): the value found is saved once in
// SAVED/vconf-<key> and the off value written; on writes the saved value back and forgets it. A key this TV does not have is skipped.
var VCONF_KEY_RE = /^(?:db|memory)\/[A-Za-z0-9_\/.-]{1,120}$/;
var VCONF_SAVED = VETRO_DIR + '/quick-vconf';
function vconfFile(key) { return VCONF_SAVED + '/' + key.replace(/\//g, '_'); }
function vconfCommand(items, off) {
    items.forEach(function (x) { if (!VCONF_KEY_RE.test(x.key) || x.type !== 'bool' || (x.off !== 'true' && x.off !== 'false')) throw new Error('Invalid setting'); });
    return wrap('mkdir -p ' + VCONF_SAVED + '\n' + items.map(function (x) {
        var f = vconfFile(x.key);
        return off
            ? 'v=$(vconftool get ' + x.key + ' 2>/dev/null | sed -n "s/.*value = \\([A-Za-z0-9]*\\) (Boolean).*/\\1/p")\n' +
              'if [ -z "$v" ]; then echo "VC|' + x.key + '|none"; else [ -f ' + f + ' ] || echo "$v" > ' + f + '; vconftool set -f -t bool ' + x.key + ' ' + (x.off === 'true' ? 1 : 0) +
              ' >/dev/null 2>&1; echo "VC|' + x.key + '|$?"; fi'
            : 'if [ -f ' + f + ' ]; then case "$(cat ' + f + ')" in True|true|1) n=1;; *) n=0;; esac; vconftool set -f -t bool ' + x.key +
              ' $n >/dev/null 2>&1 && rm -f ' + f + '; echo "VC|' + x.key + '|$?"; else echo "VC|' + x.key + '|none"; fi';
    }).join('\n') + '\ntrue');
}
// For Restore's plan: how many "do not start" files Vetro noted, how many vconf values it saved. Prints QL|<files>|<values>.
var LEFTOVERS_READ = 'n=0; [ -f ' + MARKERS_LEDGER + ' ] && n=$(grep -c . ' + MARKERS_LEDGER + '); v=$(ls ' + VCONF_SAVED + ' 2>/dev/null | wc -l); echo "QL|$n|$v"';
var LEFTOVERS_RE = /^QL\|(\d+)\|\s*(\d+)\s*$/m;
function parseLeftovers(text) { var m = LEFTOVERS_RE.exec(String(text || '')); return m ? {markers: +m[1], settings: +m[2]} : null; }
// Restore the TV: every saved vconf value of every group goes back, whatever the switches say now.
function vconfRestoreAll() {
    var items = GROUPS.reduce(function (all, g) { return all.concat(g.vconf || []); }, []);
    return items.length ? vconfCommand(items, false) : null;
}
// Off: put Samsung's own "do not start" file down and stop the unit. On: take the file away and start it again.
function servicesCommand(units, off) {
    units.forEach(function (u) { if (!SERVICE_RE.test(u)) throw new Error('Invalid service'); });
    var files = units.map(function (u) { return SERVICE_DIR + u; }).join(' ');
    return wrap(off
        ? 'mkdir -p ' + VETRO_DIR + '\ntouch ' + files + '\nfor m in ' + units.join(' ') + '; do grep -qx "$m" ' + MARKERS_LEDGER + ' 2>/dev/null || echo "$m" >> ' + MARKERS_LEDGER + '; done\n' +
          'for u in ' + units.join(' ') + '; do systemctl stop --no-block $u 2>/dev/null; done\nsleep 1\ntrue'
        : 'rm -f ' + files + '\nsystemctl reset-failed 2>/dev/null\nfor u in ' + units.join(' ') + '; do systemctl start --no-block $u 2>/dev/null; done\nsleep 1\ntrue');
}
// After a stop: which members still run, by their own process. app_launcher -S gives each app's pid; the process counts as that
// app only when its Smack label is the app's package (User::Pkg::<package>, as every app process on the Q80A had, native or
// .NET), so a pid the list still shows but that is gone, or reused by something else, does not count. Prints ID|<id>|<label>.
function identityCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('sleep 1\nL=$(app_launcher -S 2>/dev/null)\nfor id in ' + ids.join(' ') + '; do\n' +
        ' p=$(echo "$L" | awk -v id="$id" \'$1==id {gsub(/[()]/,"",$2); print $2; exit}\')\n' +
        ' case "$p" in ""|*[!0-9]*) continue;; esac\n [ -d /proc/$p ] || continue\n' +
        ' echo "ID|$id|$(tr -d \'\\000\' < /proc/$p/attr/current 2>/dev/null)"\ndone\ntrue');
}
var IDENTITY_LINE_RE = /^ID\|([A-Za-z0-9_.-]+)\|(.*)$/;
// The members whose process is still there: label unreadable (trust the app list) or the app's package.
function stillRunning(text, rows) {
    var pkg = {};
    (rows || []).forEach(function (r) { pkg[r.appId] = r.packageId || r.appId; });
    var out = [];
    String(text || '').split('\n').forEach(function (l) {
        var m = IDENTITY_LINE_RE.exec(l.trim());
        if (!m) return;
        var label = m[2].trim();
        if (!label || label === 'User::Pkg::' + (pkg[m[1]] || m[1])) out.push(m[1]);
    });
    return out;
}
function stopCommand(ids) {
    ids.forEach(function (id) { if (!ID.test(id)) throw new Error('Invalid app ID'); });
    return wrap('for id in ' + ids.join(' ') + '; do app_launcher -k "$id" >/dev/null 2>&1; echo "$id $?"; done');
}
function exitCodes(text) {
    var out = {};
    String(text || '').split('\n').forEach(function (l) { var m = EXIT_CODES_RE.exec(l.trim()); if (m) out[m[1]] = +m[2]; });
    return out;
}
function running(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (l) { var m = RUNNING_RE.exec(l); if (m) out.push(m[1]); });
    return out;
}

// Turning a group back on gives its members the boot and auto-restart values they had before it was turned off.
// This is best effort: the components are enabled already, so a failure is reported rather than undone.
function restoreFlagsFor(result, deps) {
    var ids = result.state.enabled;
    if (!ids.length) return Promise.resolve(result);
    return deps.execute(restoreFlagsCommand(ids), 60000).then(function (r) {
        var codes = {};
        String(r.stdout || '').split('\n').forEach(function (l) { var m = RESTORE_FLAGS_FOR_RE.exec(l.trim()); if (m) codes[m[1]] = m[2]; });
        ids.forEach(function (id) { if (codes[id] === '0') result.flagsRestored.push(id); else if (codes[id] !== 'none') result.flagsNotRestored.push(id); });
        deps.invalidate();
        return deps.inventory(true);
    }).then(function (d) {
        if (!d.registryError) { result.apps = d.apps; result.state = state(find(result.id), d.apps, result.markerState); }
        return result;
    }).catch(function () { result.flagsNotRestored = ids.slice(); result.flagsRestored = []; return result; });
}

// The former members (formerIds) of the groups that are installed and off: the ids to switch on again.
function formersOff(group, rows) {
    var byId = {};
    (rows || []).forEach(function (r) { byId[r.appId] = r; });
    return ((group && group.formerIds) || []).filter(function (id) { return ID.test(id) && byId[id] && byId[id].disabled === true; });
}
function allFormersOff(rows) {
    return GROUPS.reduce(function (all, g) { return all.concat(formersOff(g, rows).filter(function (id) { return all.indexOf(id) < 0; })); }, []);
}
// A former member's unit (formerServices) that an earlier Vetro kept from starting: its "do not start" file is taken away, the
// name leaves the ledger, and the unit is started. Units without the file are left alone.
function formerServicesCommand(units) {
    units.forEach(function (u) { if (!SERVICE_RE.test(u)) throw new Error('Invalid service'); });
    return wrap('for u in ' + units.join(' ') + '; do if [ -e ' + SERVICE_DIR + '$u ]; then rm -f ' + SERVICE_DIR + '$u; ' +
        'systemctl reset-failed $u 2>/dev/null; systemctl start --no-block $u 2>/dev/null; echo "FS|$u"; fi; done\n' +
        'if [ -f ' + MARKERS_LEDGER + ' ]; then grep -vx -e ' + units.join(' -e ') + ' ' + MARKERS_LEDGER + ' > ' + MARKERS_LEDGER + '.tmp; ' +
        'mv -f ' + MARKERS_LEDGER + '.tmp ' + MARKERS_LEDGER + '; fi\ntrue');
}
// Best effort, after the group's own change: a failure is reported in the result, nothing is undone. The flags first, then the units.
function enableFormers(result, deps) {
    var group = find(result.id);
    return enableFormerIds(result, deps).then(function (res) {
        if (!group || !group.formerServices || !group.formerServices.length) return res;
        return deps.execute(formerServicesCommand(group.formerServices), 20000).then(function (r) {
            res.formerServicesStarted = String(r.stdout || '').split('\n').map(function (l) { return /^FS\|(.+)$/.exec(l.trim()); })
                .filter(Boolean).map(function (m) { return m[1]; });
            return res;
        }, function () { res.formerServicesFailed = group.formerServices.slice(); return res; });
    });
}
function enableFormerIds(result, deps) {
    var ids = formersOff(find(result.id), result.apps);
    if (!ids.length) return Promise.resolve(result);
    return deps.execute(command(ids, false), 30000).then(function (r) {
        var codes = exitCodes(r.stdout);
        result.formersEnabled = ids.filter(function (id) { return codes[id] === 0; });
        result.formersFailed = ids.filter(function (id) { return codes[id] !== 0; });
        deps.invalidate();
        return deps.inventory(true).then(function (d) { if (!d.registryError) result.apps = d.apps; return result; });
    }).catch(function () { result.formersFailed = ids; return result; });
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
    var flagTargets = [], clearRan = false;
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
            clearRan = true;
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
            var undo = flagTargets.length && clearRan ? deps.execute(restoreFlagsCommand(flagTargets), 60000) : Promise.resolve();
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
            stopped: [], stopFailed: [], stillRunning: [], state: state(group, apps), apps: apps};
        function services() {
            if (!group.services) return Promise.resolve();
            return deps.execute(servicesCommand(group.services, off), 30000).then(function (r) {
                result.services = {off: off, ok: !r.exit_code && !r.timed_out};
            }, function () { result.services = {off: off, ok: false}; });
        }
        // Samsung's "do not start" files for the group's units, where this TV's units look for one; read back afterwards.
        function markers() {
            if (!group.markerUnits || !group.markerUnits.length) return Promise.resolve();
            var read = function () { return deps.execute(markersReadCommand(group.markerUnits), 20000).then(function (r) { return parseMarkers(r.stdout); }); };
            return read().then(function (found) {
                var list = group.markerUnits.filter(function (u) { return found[u]; }).map(function (u) { return {unit: u, marker: found[u].marker}; });
                if (!list.length) { result.markers = {off: off, units: 0, ok: true}; return; }
                return deps.execute(markersCommand(list, off), 30000).then(read).then(function (after) {
                    var wrong = list.filter(function (x) { return !after[x.unit] || after[x.unit].present !== off; });
                    result.markerState = after;
                    result.markers = {off: off, units: list.length, ok: !wrong.length};
                    result.state = state(group, result.apps, after);
                });
            }).catch(function () { result.markers = {off: off, ok: false}; });
        }
        function settings() {
            if (!group.vconf || !group.vconf.length) return Promise.resolve();
            return deps.execute(vconfCommand(group.vconf, off), 20000).then(function (r) {
                result.settings = {off: off, ok: !r.exit_code && !r.timed_out && !/\|[1-9]\d*$/m.test(r.stdout || '')};
            }, function () { result.settings = {off: off, ok: false}; });
        }
        if (!off) return services().then(markers).then(settings).then(function () { return restoreFlagsFor(result, deps); })
            .then(function (res) { return enableFormers(res, deps); });
        // A disabled flag does not end processes that are already running.
        return services().then(markers).then(settings).then(function () { return deps.execute('app_launcher -S', 10000); }).then(function (r) {
            if (r.exit_code || r.timed_out) throw new Error('running apps unreadable');
            var ids = running(r.stdout).filter(function (id) { return result.state.installed.indexOf(id) >= 0; });
            if (!ids.length) return result;
            return deps.execute(stopCommand(ids), 30000).then(function (k) {
                var codes = exitCodes(k.stdout);
                ids.forEach(function (id) { (codes[id] === 0 ? result.stopped : result.stopFailed).push(id); });
                // "Done" only when the processes are gone: a stop that answered 0 but left the app running is not done.
                return deps.execute(identityCommand(ids), 15000).then(function (c) {
                    if (c.timed_out || c.exit_code) { result.stopUnconfirmed = true; return result; }
                    result.stillRunning = stillRunning(c.stdout, result.apps);
                    return result;
                }, function () { result.stopUnconfirmed = true; return result; });
            });
        }).catch(function () { result.stopUnconfirmed = true; return result; }).then(function (res) { return enableFormers(res, deps); });
    });
}

module.exports = {GROUPS: GROUPS, ALLOWED_IDS: ALLOWED_IDS, find: find, state: state, command: command, formersOff: formersOff, allFormersOff: allFormersOff,
    stopCommand: stopCommand, servicesCommand: servicesCommand, formerServicesCommand: formerServicesCommand, identityCommand: identityCommand, stillRunning: stillRunning,
    MARKER_UNITS: MARKER_UNITS, componentMarkers: componentMarkers, markersReadCommand: markersReadCommand, parseMarkers: parseMarkers, markersCommand: markersCommand,
    readMarkers: readMarkers, MARKERS_CLEAR: MARKERS_CLEAR, LEFTOVERS_READ: LEFTOVERS_READ, parseLeftovers: parseLeftovers, MARKERS_LEDGER: MARKERS_LEDGER, vconfCommand: vconfCommand, vconfRestoreAll: vconfRestoreAll, clearFlagsCommand: clearFlagsCommand, restoreFlagsCommand: restoreFlagsCommand, exitCodes: exitCodes, running: running, apply: apply};
