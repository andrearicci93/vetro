'use strict';
// Regular expressions compiled once at module load, not on every call.
var HEX_RE = /^(?:[a-fA-F0-9]{2})*$/;
var CR_END_RE = /\r$/;
var SOURCE_ID_RE = /^[sd]\/[A-Za-z0-9_.]+@\S+$/;
var NON_ALNUM_RE = /[^a-z0-9]+/g;
var EDGE_DASHES_RE = /^-+|-+$/g;
var LABEL_CONTROL_RE = /[\u0000-\u001f\u007f|]/g;
var LABEL_SPACES_RE = /\s+/g;
var YOUTUBE_ICON_RE = /^youtube$/i;
var TRAILING_TABS_RE = /\t+$/;
// --- HbbTV-link apps (#200), by genesai (PR #211); kept in this file because the update from 0.5.0 has no room for a new one ---
var hbbtvLink = (function () {
// Apps that are only a doorway to a broadcaster's HbbTV service (#200). SVT Play (5exPmCT0nz.svtplay) is one: its
// package declares the metadata key below, and Samsung's own Home never starts the widget itself. Started by its id,
// the widget only shows its loading wheel and goes away. Samsung's web app service (litewebappservice,
// ICAul::AulLaunchTVViewer) sends the link to the HbbTV app instead: operation default, hbbtv=<link>, plus
// tizenid=<app id>, deeplink=true and caller_process=org.tizen.litewebappservice.
// Vetro sends the operation and the link only. tizenid starts a deep-link session, and when a deep-link app ends the
// HbbTV library opens Samsung's Home (CDAEApplicationManager::m_HandleDeeplinkExit launches com.samsung.tv.csfs with
// entry_point=exit_key), which is what Vetro's launcher stands in for. Checked on an LS03B (Tizen 6.5,
// T-PTMDEUC-1720.7) on 2026-11-16: the link alone opened SVT Play from a TV channel, over Netflix and from an HDMI
// input, and leaving it with Exit went back to each of them; Samsung's full request brought up Samsung Home on exit.
// A bare start of org.tizen.hbbtv, without the link, shows nothing. The dock sends the same request natively
// (dock/src/Program.cs, SendHbbtvLaunch).
var HBBTV_METADATA_KEY = 'http://samsung.com/tv/metadata/hbbtv.link';
var HBBTV_APP = 'org.tizen.hbbtv';
var OPERATION_DEFAULT = 'http://tizen.org/appcontrol/operation/default';
var PKGMGR_DB = '/opt/dbspace/.pkgmgr_parser.db';
var APP_ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
// http(s) only, no spaces, quotes, backslashes or control characters. The dock applies the same rule (Catalog.cs).
var LINK_RE = /^https?:\/\/[A-Za-z0-9._~:\/?#\[\]@!$&()*+,;=%-]{1,500}$/;

function validLink(link) { return typeof link === 'string' && LINK_RE.test(link); }

// The request as app_launcher key/value arguments. __APP_SVC_OP_TYPE__ is the bundle key app_control_set_operation writes.
function launchArgs(link) {
    return ['__APP_SVC_OP_TYPE__', OPERATION_DEFAULT, 'hbbtv', link];
}

// One shell command for the root agent: an app with an HbbTV link is opened through the HbbTV app, any other
// app is started by its id as before. The link is read on the TV at launch time, so a rule or the Task manager
// needs no catalog of its own. It only ever reaches app_launcher as a quoted variable, never as shell text.
function launchCommand(appId) {
    if (!APP_ID_RE.test(String(appId || ''))) throw new Error('invalid appId');
    return 'L=$(sqlite3 -readonly ' + PKGMGR_DB + ' "SELECT md_value FROM package_app_app_metadata WHERE app_id=\'' + appId +
        '\' AND md_key=\'' + HBBTV_METADATA_KEY + '\' LIMIT 1;" 2>/dev/null | head -n 1); ' +
        'case "$L" in http://*|https://*) /usr/bin/app_launcher -s ' + HBBTV_APP + ' ' + launchArgs('"$L"').join(' ') + ';; ' +
        '*) /usr/bin/app_launcher -s ' + appId + ';; esac';
}

    return {METADATA_KEY: HBBTV_METADATA_KEY, HBBTV_APP: HBBTV_APP, validLink: validLink, launchArgs: launchArgs, launchCommand: launchCommand};
})();
// The dock's app list, built from what Samsung's own Home reads, so the two start out the same:
//   - the Home row order       .../apps_rw/com.samsung.tv.csfs/data/.appLayerCache.1 (or .2); TVs with the new Home
//                              (com.samsung.tv.home.media, 2022 and later) keep it in that package's data dir instead
//   - the web app registry     /opt/dbspace/.webappservice.db     (title and Tizen app id)
//   - the registry's icons     /opt/share/webappservice/apps_icon/all/<id>/
//   - the package icons        /opt/dbspace/.pkgmgr_parser.db     (sideloaded apps, TV Plus)
// Everything is read in one shell call. The result is a tab-separated list for the dock
// (dock/src/Core/Catalog.cs): slug, label, app id, fallback, icon file, kill-first app, HbbTV link. The dock rounds the
// icons itself; this module never touches an image.

var ORDER_DIR = '/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data';
// The 2022 Home (Tizen 6.5 with the Media, Game and Ambient hubs, e.g. the S95B) keeps no app row in csfs: its
// Media hub writes the same file name, but with the "recent" strip only (a few inputs and apps). The registry
// then completes the list, so the dock still shows every visible app (PR #43 by arnaudaprahamian).
var ORDER_DIR_NEW_HOME = '/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data';
var ICON_ROOT = '/opt/share/webappservice/apps_icon/all/';
var MIN_PACKAGES = 20;         // fewer package rows than this means the read failed, not that the TV has no apps
var MAX_ENTRIES = 40;          // the dock refuses more
var APP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
var ICON_FILE = /^(?:\/opt\/share\/webappservice\/apps_icon|\/opt\/usr\/apps|\/usr\/apps)\/[A-Za-z0-9_.\/-]{1,160}\.png$/;
var VIEWER = 'org.tizen.tv-viewer';
// Fix TizenTube: TizenTube is a sideloaded app that stands in for YouTube. Samsung's own YouTube
// (a Cobalt process) has to be closed before TizenTube starts, and the tile borrows the icon
// Samsung's registry holds for YouTube.
var TIZENTUBE = /TizenTube/i;
var COBALT_YOUTUBE = 'com.samsung.tv.cobalt-yt';
// Samsung's own YouTube row (widget 111299001912, wrapper app 9Ur5IzDKqV.TizenYouTube). The wrapper and its registry
// row can be gone from the TV while the Home row still lists it; the real YouTube is then only the Cobalt app,
// which starts under its own id.
var OFFICIAL_YOUTUBE_ROW = '111299001912';
// The dock repeats this check, but the file is written here, so refuse a bad path here as well.
function iconOk(p) { return ICON_FILE.test(p) && p.indexOf('..') < 0 && p.indexOf('//') < 0; }
// An input's picture: Samsung keeps the pictures of the devices it recognises (consoles, boxes) in canalysis' folder, on 6.0, 6.5 and
// 9 alike (#297: they were refused, so HDMI source images never showed). Its device-type icons are SVG, which the launcher cannot draw.
var SOURCE_ICON_FILE = /^\/usr\/share\/canalysis\/Icon\/[A-Za-z0-9_.\/-]{1,160}\.png$/;
function sourceIconOk(p) { return iconOk(p) || (SOURCE_ICON_FILE.test(p) && p.indexOf('..') < 0 && p.indexOf('//') < 0); }

// Live TV entries in the Home row are not web apps. The icon comes from the package of the same
// name when the TV has one; the dock draws its own generic one otherwise.
var LIVE = {
    // The package's own icon path is stale on some firmware; the TV Plus deep-link package ships the real icon.
    TVPLUS: {slug: 'tvplus', label: 'Samsung TV Plus', iconPackage: 'com.samsung.tv.tvplus', altIcon: '/opt/usr/apps/com.samsung.tv.tvPlusDeeplinker/shared/res/TVPlus_app_icon.png'},
    // Live TV switches to the TV input, as the TV entry of the Sources page does: only bringing tv-viewer to the front (its app id)
    // left the input where an app had put it (source type -1), and Vetro TV Tuner, which covers the TV input only, stayed hidden.
    RF: {slug: 'livetv', label: 'Live TV', iconPackage: null, target: 'source:0'}
};

// Two pills close the row. All apps opens the launcher's page of every app (Settings and the App store are its last
// two pills); the second one goes back to Samsung's Home. The input list is not here: it is one page up in the launcher.
var SYSTEM_ROWS = [
    'allapps\tAll apps\tpanel:allapps',
    'samsunghome\tSamsung Home\tsys:com.samsung.tv.csfs'
];
// The All apps page ends with two pills: Settings sends the System Menu key, which the TV routes to Samsung's own menu
// app (org.tizen.menu, menu.json; starting csfs would only show Home); the App store is Samsung's store app, or TV-Store.
var SETTINGS_ROW = 'settings\tSettings\tkey:XF86SysMenu\torg.tizen.menu';
var SAMSUNG_STORE_ROW = 'store\tApp store\tsys:com.samsung.tv.store';
// TV-Store (Apps2Samsung's store of Tizen apps, a web app) takes the store pill when it is installed and switched on, unless the
// user chose Samsung's store (dock state appStore 'samsung'). Samsung's store is the fallback when TV-Store does not start.
var TV_STORE = 'A2STVStore.Store';
var TV_STORE_ROW = 'tvstore\tTV-Store\tsys:' + TV_STORE + '\tcom.samsung.tv.store';
var APP_STORES = ['tvstore', 'samsung'];
var RESERVED_SLUGS = ['source', 'settings', 'allapps', 'samsunghome', 'store', 'tvstore'];
// A row key: what the user's own order and hidden list refer to (app:<id>, live:<TVPLUS|RF>, source:<type>).
var ROW_KEY = /^(?:app:[A-Za-z0-9_.-]{1,120}|live:[A-Z]{1,12}|source:\d{1,5})$/;
var VETRO_APP = /^vetrotvapp(\.|$)/;
// The Samsung Home pill always opens csfs. com.samsung.tv.coba.newhome, which an older Vetro started instead where it was installed,
// is a package of Home components whose app has no entry point (2022 firmware, 2025 update): it started and died, nothing showed
// (#170, #175, #210). The launcher sends csfs the bundle of Samsung's own Home key where the firmware wants it (SystemLaunch.cs).

function script() {
    var sizes = '224x224 304x304 152x152 104x104 icon';
    return [
        // F| says which Home the row came from: csfs, or the 2022 Home's Media hub (see ORDER_DIR_NEW_HOME).
        'B=' + ORDER_DIR + '; M=' + ORDER_DIR_NEW_HOME + '; F=none',
        'if [ -s "$B/.appLayerCache.1" ] || [ -s "$B/.appLayerCache.2" ]; then F=csfs; elif [ -s "$M/.appLayerCache.1" ] || [ -s "$M/.appLayerCache.2" ]; then B=$M; F=media; fi',
        'echo "F|$F"',
        '{ cat "$B/.appLayerCache.1" 2>/dev/null || cat "$B/.appLayerCache.2" 2>/dev/null; } | sed "s/^/O|/"',
        // Both Homes may keep a source list: on newer firmware the one in csfs/data can be an old copy without the names the user gave
        // the inputs (#297), so each is sent with its modification time and the newer one wins, key by key.
        'for B in ' + [ORDER_DIR, ORDER_DIR_NEW_HOME].join(' ') + '; do',
        '  if [ -f "$B/.sourceCache" ]; then printf "S|%s|" "$(stat -c %Y "$B/.sourceCache" 2>/dev/null || echo 0)"; base64 "$B/.sourceCache" | tr -d "\\n"; printf "\\n"; fi; done',
        // app_featured last: 1 downloaded, 2 Samsung's partners; what Samsung's own Apps screen lists, so All apps lists them too.
        // The column is only confirmed on the Q80A (Tizen 6.0): where it is missing sqlite refuses the whole query, so the
        // 0.5.0 query runs instead (five fields, featured unknown: All apps then lists every registry app, the row is the same).
        'sqlite3 -readonly /opt/dbspace/.webappservice.db "SELECT \'R|\'||hex(id)||\'|\'||hex(title)||\'|\'||hex(tizen_id)||\'|\'||is_hidden||\'|\'||ifnull(app_featured,0) FROM widgetinfo;" 2>/dev/null' +
        ' || sqlite3 -readonly /opt/dbspace/.webappservice.db "SELECT \'R|\'||hex(id)||\'|\'||hex(title)||\'|\'||hex(tizen_id)||\'|\'||is_hidden FROM widgetinfo;" 2>/dev/null',
        'for d in ' + ICON_ROOT + '*/; do id=$(basename "$d"); for s in ' + sizes + '; do',
        '  if [ -f "$d$s.png" ]; then echo "I|$id|$d$s.png"; break; fi; done; done',
        'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "SELECT \'P|\'||hex(a.app_id)||\'|\'||hex(l.app_icon) FROM package_app_info a JOIN package_app_localized_info l ON l.app_id=a.app_id WHERE l.app_icon != \'\';" 2>/dev/null',
        // Every app the package manager knows. Samsung's web app registry above keeps a row for an app removed with pkgcmd,
        // so a tile built from it alone would stay in the dock and not open.
        // The third field says whether the app is disabled (Quick settings → Disable, or Apps and processes): a disabled app
        // cannot start, so it gets no tile. An older reader of these lines (two fields) is not affected: it is this file.
        'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "SELECT \'A|\'||hex(app_id)||\'|\'||ifnull(app_disable,\'false\') FROM package_app_info;" 2>/dev/null',
        // #200: apps that are only an HbbTV link (SVT Play) are opened by sending that link to the HbbTV app.
        'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "SELECT \'L|\'||hex(app_id)||\'|\'||hex(md_value) FROM package_app_app_metadata WHERE md_key=\'' + hbbtvLink.METADATA_KEY + '\';" 2>/dev/null',
        'true'
    ].join('\n');
}

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function unhex(v) {
    if (!HEX_RE.test(v)) throw new Error('invalid registry field');
    return Buffer.from(v, 'hex').toString('utf8');
}

// Splits the script's output into what each source said. Lines that do not parse are skipped:
// one odd registry row must not leave the TV without a dock.
function parse(text) {
    var out = {order: [], registry: {}, icons: {}, packageIcons: {}, installed: {}, disabled: {}, installedCount: 0, hbbtvLinks: {}, sources: {}, homeApp: null, rowFrom: null};
    var sourceFiles = [];
    String(text || '').split('\n').forEach(function (line) {
        line = line.replace(CR_END_RE, '');
        var f = line.split('|');
        try {
            if (f[0] === 'F' && f.length === 2) {
                if (f[1] === 'csfs' || f[1] === 'media') out.rowFrom = f[1];
            } else if (f[0] === 'O') {
                var entry = f.slice(1).join('|').trim();
                if (SOURCE_ID_RE.test(entry)) out.order.push(entry);
            } else if (f[0] === 'S' && (f.length === 2 || f.length === 3)) {
                var sources = JSON.parse(Buffer.from(f[f.length - 1], 'base64').toString('utf8'));
                if (sources && typeof sources === 'object' && !Array.isArray(sources)) sourceFiles.push({at: f.length === 3 ? +f[1] || 0 : 0, sources: sources});
            } else if (f[0] === 'R' && (f.length === 5 || f.length === 6)) {
                out.registry[unhex(f[1])] = {title: unhex(f[2]), appId: unhex(f[3]), hidden: f[4] === '1', featured: f.length === 6 ? +f[5] || 0 : null};
            } else if (f[0] === 'I' && f.length === 3) {
                if (iconOk(f[2])) out.icons[f[1]] = f[2];
            } else if (f[0] === 'P' && f.length === 3) {
                var icon = unhex(f[2]), id = unhex(f[1]);
                if (iconOk(icon) && !out.packageIcons[id]) out.packageIcons[id] = icon;
            } else if (f[0] === 'A' && (f.length === 2 || f.length === 3)) {
                out.installed[unhex(f[1])] = true;
                if (f[2] === 'true') out.disabled[unhex(f[1])] = true;
                out.installedCount++;
            } else if (f[0] === 'L' && f.length === 3) {
                var link = unhex(f[2]).trim(), linkApp = unhex(f[1]);
                if (APP_ID.test(linkApp) && hbbtvLink.validLink(link)) out.hbbtvLinks[linkApp] = link;
            }
        } catch (e) { /* skip the line */ }
    });
    // The older list first; an input the newer one has replaces every older entry of the same input, whatever its key ("HDMI1" in
    // an old copy, "HDMI1/0" once a device was recognised). A stable sort keeps the script's order for equal times.
    sourceFiles.map(function (s, i) { return {at: s.at, i: i, sources: s.sources}; }).sort(function (a, b) { return a.at - b.at || a.i - b.i; })
        .forEach(function (s) {
            var keys = Object.keys(s.sources), types = {};
            keys.forEach(function (k) { var v = s.sources[k]; if (v && typeof v === 'object' && typeof v.SourceType === 'number') types[v.SourceType] = true; });
            Object.keys(out.sources).forEach(function (k) { var v = out.sources[k]; if (v && types[v.SourceType]) delete out.sources[k]; });
            keys.forEach(function (k) { out.sources[k] = s.sources[k]; });
        });
    return out;
}

function slugify(text) {
    var s = String(text).toLowerCase().replace(NON_ALNUM_RE, '-').replace(EDGE_DASHES_RE, '').slice(0, 36);
    return s || 'app';
}

function cleanLabel(text, fallback) {
    var s = String(text || '').replace(LABEL_CONTROL_RE, ' ').replace(LABEL_SPACES_RE, ' ').trim().slice(0, 40).trim();
    return s || fallback;
}

// Inputs beyond TV and HDMI 1-4 that only some devices have, listed only when the device's own source list (.sourceCache) holds them:
// DisplayPort on Samsung's monitors (Odyssey G6, Smart Monitor M8: key "DISPLAYPORT", SourceType 33, #215). A TV never lists it.
var EXTRA_SOURCES = [{type: 33, slug: 'in-dp', base: 'DisplayPort'}];
// Samsung's entry for an input. The key is the source's name ("HDMI2"), and on the newer Home it gains the activity index of the
// device found on it ("HDMI2/0", CoBA's GenerateSourceID): the exact name first, then any entry of that source type.
function sourceMeta(sources, type, key) {
    sources = sources || {};
    function named(v) { return !!(v.EditName || v.DetectedName); }
    var exact = sources[key] && typeof sources[key] === 'object' ? sources[key] : null;
    if (exact && named(exact)) return exact;
    var keys = Object.keys(sources).filter(function (k) { return sources[k] && typeof sources[k] === 'object' && sources[k].SourceType === type; });
    var withName = keys.filter(function (k) { return named(sources[k]); });
    return withName.length ? sources[withName[0]] : exact || (keys.length ? sources[keys[0]] : null);
}

// Sources retain their physical port identity and Samsung-provided names.
function sourceEntries(parsed, options) {
    var types = [0, 13, 14, 15, 16].concat(EXTRA_SOURCES.filter(function (x) { return sourceMeta(parsed.sources, x.type, '') !== null; }).map(function (x) { return x.type; }));
    return types.map(function (type) {
        var extra = EXTRA_SOURCES.filter(function (x) { return x.type === type; })[0];
        var key = type === 0 ? 'TV' : extra ? '' : 'HDMI' + (type - 12), base = type === 0 ? 'TV' : extra ? extra.base : 'HDMI ' + (type - 12);
        var meta = sourceMeta(parsed.sources, type, key) || {};
        var name = cleanLabel(meta.EditName || meta.DetectedName, base);
        var useImages = options && options.useSourceImages === true && type >= 13;
        var samsung = useImages ? [meta.LauncherUnfocusedIconPath, meta.IconPath, meta.OrgIconPath].filter(sourceIconOk)[0] || null : null;
        // The row key (source:<type>, TV is source:0) lets the launcher add the input to the user's row from the Sources page (hold OK).
        var entry = {slug: type === 0 ? 'in-tv' : extra ? extra.slug : 'in-hdmi' + (type - 12), label: name,
            appId: 'source:' + type, icon: samsung, killFirst: null, key: 'source:' + type};
        // The Sources page always keeps TV, HDMI1, HDMI2, HDMI3, HDMI4 order and port labels, then DisplayPort where there is one.
        entry.inputLabel = type === 0 || name === base ? base : cleanLabel(base + ' - ' + name, base);
        return entry;
    });
}

// Same order as Samsung's row. Apps the registry does not know, hidden ones and anything with an
// unusable id are left out and listed in `skipped`, so the page can say why a row is missing.
function youtubeIcon(parsed) {
    var found = null;
    Object.keys(parsed.registry).forEach(function (id) {
        var r = parsed.registry[id];
        if (!found && !r.hidden && YOUTUBE_ICON_RE.test(r.title.trim()) && !TIZENTUBE.test(r.appId) && parsed.icons[id]) found = parsed.icons[id];
    });
    return found;
}

function build(parsed, options) {
    options = options || {};
    var entries = [], skipped = [], slugs = {}, inputs = sourceEntries(parsed, options), seenPorts = {}, inputSlugs = {};
    // An input's tile in the row is drawn with the launcher's own picture of that slug (res/icons/in-hdmi2.png): an app whose name
    // happens to slug the same way gets another one, so the input never loses its picture.
    inputs.forEach(function (source) { inputSlugs[source.slug] = true; });
    function make(slug, label, appId, icon, key) {
        var base = slug, n = 2, input = typeof key === 'string' && key.indexOf('source:') === 0;
        while (slugs[slug] || RESERVED_SLUGS.indexOf(slug) >= 0 || (!input && inputSlugs[slug])) slug = base.slice(0, 36) + '-' + n++;
        slugs[slug] = true;
        var made = {slug: slug, label: label, appId: appId, icon: icon || null, killFirst: null, key: key || (appId ? 'app:' + appId : null)};
        // All apps and a customised row also pass here; they used to bypass
        // the Samsung-row-only TizenTube correction below.
        if (options.fixTizenTube && TIZENTUBE.test(appId || '')) {
            made.killFirst = COBALT_YOUTUBE;
            made.icon = youtubeIcon(parsed) || made.icon;
        }
        if (appId && parsed.hbbtvLinks && parsed.hbbtvLinks[appId]) made.hbbtvLink = parsed.hbbtvLinks[appId];
        return made;
    }
    function add(slug, label, appId, icon, key) {
        var e = make(slug, label, appId, icon, key);
        entries.push(e);
        return e;
    }
    // A registry row without a package behind it is a leftover of an uninstall that did not go through Samsung's own path.
    // The package list is only trusted when it came back whole: a short answer must not empty the dock.
    function uninstalled(reg) { return parsed.installedCount >= MIN_PACKAGES && !parsed.installed[reg.appId]; }
    var offApps = parsed.disabled || {};   // apps disabled on the TV: no tile (a caller that built `parsed` by hand may not have the list)
    parsed.order.forEach(function (item) {
        if (entries.length >= MAX_ENTRIES - SYSTEM_ROWS.length) { skipped.push({item: item, reason: 'The dock holds ' + MAX_ENTRIES + ' entries'}); return; }
        var kind = item.slice(0, item.indexOf('@')), ident = item.slice(item.indexOf('@') + 1);
        if (kind === 's/source.layer.hdmi') {
            if (options.showHomeSources !== true) return;
            if (!/^HDMI[1-4]$/.test(ident)) { skipped.push({item: item, reason: 'Unknown HDMI source'}); return; }
            if (seenPorts[ident]) return;
            seenPorts[ident] = true;
            var source = inputs[+ident.slice(4)];
            var tile = add(source.slug, source.label, source.appId, source.icon, 'source:' + source.appId.slice(7));
            if (source.altIcon) tile.altIcon = source.altIcon;
            return;
        }
        if (kind === 's/livetv') {
            var live = LIVE[ident];
            if (!live) { skipped.push({item: item, reason: 'Unknown live source'}); return; }
            var liveEntry = add(live.slug, live.label, live.target || VIEWER, live.iconPackage && parsed.packageIcons[live.iconPackage], 'live:' + ident);
            if (live.altIcon) liveEntry.altIcon = live.altIcon;
            return;
        }
        if (kind !== 'd/webapp') { skipped.push({item: item, reason: 'Unsupported entry'}); return; }
        var reg = Object.prototype.hasOwnProperty.call(parsed.registry, ident) ? parsed.registry[ident] : null;
        if ((!reg || (!reg.hidden && uninstalled(reg))) && ident === OFFICIAL_YOUTUBE_ROW && parsed.installedCount >= MIN_PACKAGES && parsed.installed[COBALT_YOUTUBE]) {
            add('youtube', 'YouTube', COBALT_YOUTUBE, parsed.icons[ident]);
            return;
        }
        if (!reg) { skipped.push({item: item, reason: 'Not installed'}); return; }
        if (reg.hidden) { skipped.push({item: item, reason: 'Hidden in the registry'}); return; }
        if (!APP_ID.test(reg.appId)) { skipped.push({item: item, reason: 'Unusable app id'}); return; }
        if (uninstalled(reg)) { skipped.push({item: item, reason: 'Not installed'}); return; }
        if (offApps[reg.appId]) { skipped.push({item: item, reason: 'Disabled'}); return; }
        var entry = add(slugify(reg.title), cleanLabel(reg.title, reg.appId), reg.appId, parsed.icons[ident] || parsed.packageIcons[reg.appId]);
        if (options.fixTizenTube && TIZENTUBE.test(reg.appId)) {
            entry.killFirst = COBALT_YOUTUBE;
            var yt = youtubeIcon(parsed);
            if (yt) entry.icon = yt; else skipped.push({item: entry.slug, reason: 'No YouTube icon found; the app\'s own icon is used'});
        }
    });
    // Without a csfs row (the 2022 Home), the row above is at best the "recent" strip: every other visible
    // app of the registry follows, by title, so the dock shows the same apps as the Home's app list.
    // With Fix TizenTube on and TizenTube in the row, the TizenTube tile stands in for Samsung's YouTube and
    // already uses its icon, so YouTube itself is not appended.
    if (parsed.rowFrom !== 'csfs') {
        var present = {}, inOrder = {};
        var standIn = options.fixTizenTube && entries.some(function (e) { return TIZENTUBE.test(e.appId); });
        entries.forEach(function (e) { present[e.appId] = true; });
        parsed.order.forEach(function (item) { if (item.indexOf('d/webapp@') === 0) inOrder[item.slice(9)] = true; });
        Object.keys(parsed.registry).filter(function (id) { return !inOrder[id]; }).map(function (id) { return {id: id, reg: parsed.registry[id]}; })
            .filter(function (x) { return !x.reg.hidden && APP_ID.test(x.reg.appId) && !uninstalled(x.reg) && !offApps[x.reg.appId] && !present[x.reg.appId] && !/^vetrotvapp(\.|$)/.test(x.reg.appId); })
            .filter(function (x) { return !(standIn && YOUTUBE_ICON_RE.test(x.reg.title.trim()) && !TIZENTUBE.test(x.reg.appId)); })
            .sort(function (a, b) { return a.reg.title.localeCompare(b.reg.title); })
            .forEach(function (x) {
                if (entries.length >= MAX_ENTRIES - SYSTEM_ROWS.length) { skipped.push({item: x.reg.appId, reason: 'The dock holds ' + MAX_ENTRIES + ' entries'}); return; }
                present[x.reg.appId] = true;
                add(slugify(x.reg.title), cleanLabel(x.reg.title, x.reg.appId), x.reg.appId, parsed.icons[x.id] || parsed.packageIcons[x.reg.appId]);
            });
    }
    // Every app the user can put in the row (the All apps page): Samsung's row as it is, then each visible app of the registry
    // that Samsung's own Apps screen would list (app_featured 1 or 2, installed, not hidden, not Vetro), one entry per key.
    var samsungKeys = entries.map(function (e) { return e.key; });
    var pool = {}, poolList = [];
    entries.forEach(function (e) { if (e.key && !pool[e.key]) { pool[e.key] = e; poolList.push(e); } });
    Object.keys(parsed.registry).forEach(function (id) {
        var reg = parsed.registry[id], key = 'app:' + reg.appId;
        if (reg.hidden || pool[key] || !APP_ID.test(reg.appId) || VETRO_APP.test(reg.appId) || uninstalled(reg) || offApps[reg.appId]) return;
        if (reg.featured !== null && reg.featured !== undefined && reg.featured !== 1 && reg.featured !== 2) return;
        var e = make(slugify(reg.title), cleanLabel(reg.title, reg.appId), reg.appId, parsed.icons[id] || parsed.packageIcons[reg.appId], key);
        pool[key] = e; poolList.push(e);
    });
    // Every input of the Sources page can be put in the row (hold OK there), whether or not it is on Samsung's row and whatever
    // showHomeSources says (that option only decides whether the sources on Samsung's row arrive in the row by themselves). Made after
    // everything above, so a Home-row source keeps its own slug; the tile is the one that option makes. These belong to the Sources page,
    // not to All apps: they stay out of poolList (a Home-row source with the option on is already in it, and is not made twice).
    var sourceTiles = [];
    inputs.forEach(function (source) {
        if (pool[source.key]) return;
        var e = make(source.slug, source.label, source.appId, source.icon, source.key);
        pool[source.key] = e; sourceTiles.push(e);
    });
    // The user's own row (Vetro's dock state, never Samsung's .appLayerCache): their order first, then whatever Samsung's row
    // holds that they have not placed (a newly installed app arrives at the end), without the ones they took out; custom names.
    var row = options.row && typeof options.row === 'object' ? options.row : null;
    if (row) {
        var hidden = {}, used = {}, out = [];
        (Array.isArray(row.hidden) ? row.hidden : []).forEach(function (k) { hidden[k] = true; });
        // exact: the row is the order and nothing else (the launcher sent it whole); every other tile of Samsung's row is taken out.
        if (row.exact) entries.forEach(function (e) { if ((row.order || []).indexOf(e.key) < 0) hidden[e.key] = true; });
        (Array.isArray(row.order) ? row.order : []).forEach(function (k) {
            if (pool[k] && !hidden[k] && !used[k] && out.length < MAX_ENTRIES - SYSTEM_ROWS.length) { used[k] = true; out.push(pool[k]); }
        });
        entries.forEach(function (e) {
            if (used[e.key] || hidden[e.key]) return;
            if (out.length >= MAX_ENTRIES - SYSTEM_ROWS.length) { skipped.push({item: e.slug, reason: 'The dock holds ' + MAX_ENTRIES + ' entries'}); return; }
            used[e.key] = true; out.push(e);
        });
        entries = out;
    }
    var labels = row && row.labels && typeof row.labels === 'object' ? row.labels : {};
    poolList.concat(sourceTiles).forEach(function (e) { if (typeof labels[e.key] === 'string' && cleanLabel(labels[e.key], '')) e.label = cleanLabel(labels[e.key], e.label); });
    // A plugin that claims an app (manifest "intercepts") takes over its tile: the dock asks Vetro to start it instead of
    // starting it itself. Only the flag goes into the list, never anything the plugin wrote. The viewer is Live TV, not an app.
    var claimed = options.intercepted || {};
    poolList.forEach(function (e) {
        if (e.appId !== VIEWER && Object.prototype.hasOwnProperty.call(claimed, e.appId)) e.viaShard = true;
    });
    var allApps = poolList.slice().sort(function (a, b) { return a.label.localeCompare(b.label); }).slice(0, MAX_ENTRIES - 2);
    // Only a package list that came back whole says TV-Store is there; without it the pill stays Samsung's store.
    var tvStore = !!(parsed.installed && parsed.installed[TV_STORE]) && !offApps[TV_STORE];
    return {entries: entries, allApps: allApps, samsungKeys: samsungKeys, inputs: inputs, skipped: skipped, homeApp: parsed.homeApp || null,
        tvStoreInstalled: tvStore, appStore: tvStore && options.appStore !== 'samsung' ? 'tvstore' : 'samsung'};
}

// Seventh column: "shard" when a plugin has taken the tile over. An older dock ignores the column and starts the app itself.
// Eighth: the row key the dock sends back when the user moves, removes or adds a tile (an older dock ignores it).
// Ninth: the app's HbbTV link (#200), which the dock sends to the HbbTV app instead of starting the widget (an older dock ignores it).
function entryLine(e, label) { return [e.slug, label || e.label, e.appId, '', e.icon || '', e.killFirst || '', e.viaShard ? 'shard' : '', e.key && ROW_KEY.test(e.key) ? e.key : '', e.hbbtvLink && hbbtvLink.validLink(e.hbbtvLink) ? e.hbbtvLink : ''].join('\t').replace(TRAILING_TABS_RE, ''); }
function allAppsTsv(built) {
    return ['# Every app the launcher\'s All apps page lists, by name; written by Vetro, rebuilt with the app list']
        .concat((built.allApps || []).map(function (e) { return entryLine(e); }))
        .concat([SETTINGS_ROW, built.appStore === 'tvstore' ? TV_STORE_ROW : SAMSUNG_STORE_ROW]).join('\n') + '\n';
}
function inputsTsv(built) {
    return ['# Sources in physical port order'].concat((built.inputs || []).map(function (e) { return entryLine(e, e.inputLabel); })).join('\n') + '\n';
}

function tsv(built) {
    var lines = ['# written by Vetro from the TV\'s own Home row; do not edit, it is rebuilt every time the dock starts'];
    built.entries.forEach(function (e) {
        lines.push(entryLine(e));
    });
    var system = SYSTEM_ROWS.map(function (row) {
        // The CoBA home launcher first, Samsung's older home app as the fallback the dock already knows.
        return built.homeApp ? row.replace('sys:com.samsung.tv.csfs', 'sys:' + built.homeApp + '\tcom.samsung.tv.csfs') : row;
    });
    return lines.concat(system).join('\n') + '\n';
}

// The registry can point at an icon that is no longer there (TV Plus does). One more read-only
// call keeps only the paths that exist; if it fails the paths stay and the dock copes with them.
function existing(execute, built) {
    var paths = [];
    var all = built.entries.concat(built.inputs || []);
    (built.allApps || []).forEach(function (e) { if (all.indexOf(e) < 0) all.push(e); });
    all.forEach(function (e) { [e.icon, e.altIcon].forEach(function (p) { if (p && paths.indexOf(p) < 0) paths.push(p); }); });
    if (!paths.length) return Promise.resolve(built);
    var script = 'for p in ' + paths.map(function (p) { return "'" + p + "'"; }).join(' ') + '; do [ -f "$p" ] && echo "OK|$p"; done; true';
    return execute(wrap(script), 10000).then(function (r) {
        if (r.exit_code || r.timed_out) { all.forEach(function (e) { delete e.altIcon; }); return built; }
        var ok = {};
        String(r.stdout || '').split('\n').forEach(function (l) { if (l.indexOf('OK|') === 0) ok[l.slice(3).trim()] = true; });
        all.forEach(function (e) {
            if (e.altIcon) {
                if (!(e.icon && ok[e.icon]) && ok[e.altIcon]) e.icon = e.altIcon;
                delete e.altIcon;
            }
            if (e.icon && !ok[e.icon]) { built.skipped.push({item: e.slug, reason: 'Icon file missing; a generic icon is used'}); e.icon = null; }
        });
        return built;
    }, function () { all.forEach(function (e) { delete e.altIcon; }); return built; });
}

// Reads the TV and returns {tsv, count, skipped}. Throws when the Home row cannot be read at all,
// because a dock with no apps is worse than none.
function load(execute, options) {
    options = options || {};
    return execute(wrap(script()), 20000).then(function (r) {
        if (r.exit_code || r.timed_out) throw new Error(r.stderr || 'Home data unavailable');
        var parsed = parse(r.stdout);
        if (!parsed.order.length && parsed.rowFrom === 'csfs') throw new Error('The Home row is empty or unreadable');
        if (!parsed.order.length && !Object.keys(parsed.registry).length) throw new Error('The Home row and the app registry are empty or unreadable');
        var built = build(parsed, options);
        var filteredSources = options.showHomeSources !== true && parsed.order.some(function (entry) { return /^s\/source\.layer\.hdmi@HDMI[1-4]$/.test(entry); });
        if (!built.entries.length && !filteredSources) throw new Error('None of the Home row apps could be matched in the registry');
        return existing(execute, built).then(function (b) {
            return {tsv: tsv(b), inputsTsv: inputsTsv(b), allAppsTsv: allAppsTsv(b), count: b.entries.length, skipped: b.skipped, samsungKeys: b.samsungKeys, rowKeys: b.entries.map(function (e) { return e.key; }),
                appStore: b.appStore, tvStoreInstalled: b.tvStoreInstalled};
        });
    });
}

module.exports = {hbbtvLink: hbbtvLink, ROW_KEY: ROW_KEY, TV_STORE: TV_STORE, APP_STORES: APP_STORES, allAppsTsv: allAppsTsv, sourceEntries: sourceEntries, inputsTsv: inputsTsv, iconPathOk: iconOk, COBALT_YOUTUBE: COBALT_YOUTUBE, load: load, parse: parse, build: build, tsv: tsv, script: script, slugify: slugify, cleanLabel: cleanLabel};

