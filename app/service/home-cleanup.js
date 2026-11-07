'use strict';
// What `pkgcmd -u` leaves behind.
//
// Samsung's own uninstaller (webappservice, CTWebAppInstaller::t_UninstallPost) does more than remove the package: it deletes
// the app's row from the web app registry (widgetinfo), and sets the vconf keys memory/was/app_uninstall and
// memory/was/app_change, which the Home (csfs) listens to so that it drops the app from its row (.appLayerCache.*).
// `pkgcmd -u` does none of that. Measured on a Q80A (2026-11-07): after removing Disney+ with Vetro the registry row, the
// icon folder and the Home line were all still there, and so was a tile that did not open. The Samsung command line
// for the proper uninstall, wascmd, is switched off on released firmware, so Vetro does the same work itself.
//
// learn() reads the registry rows of a package BEFORE it is removed (afterwards nothing says which Home line belonged to it).
// clean() runs after a verified uninstall. sweep() finds Home lines of apps that no longer exist at all, for the ones left
// by an earlier uninstall.
//
// Order inside one run: backups first, then the vconf signal, then the Home row, then the registry row and the icon folder.
// The Home row file is rewritten only when csfs is not running (it rewrites the file from memory when it saves, which would
// bring the line back). When csfs is running the signal is given a few seconds to work and the answer says `pending`.

var HOME_DIRS = ['/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data', '/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data'];
var CACHES = ['.appLayerCache.1', '.appLayerCache.2'];
var WAS_DB = '/opt/dbspace/.webappservice.db';
var PKG_DB = '/opt/dbspace/.pkgmgr_parser.db';
var ICON_ROOT = '/opt/share/webappservice/apps_icon/all';
var BACKUP_DIR = '/opt/usr/home/owner/share/vetro-uninstall-backup';
var ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var HEX_RE = /^(?:[a-fA-F0-9]{2})*$/;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
// An id goes into a shell script between single quotes and into an extended regex: only plain ids, and never "." or "..".
function validId(id) { return typeof id === 'string' && ID_RE.test(id) && !/^\.+$/.test(id); }
function reEscape(s) { return s.replace(/[.]/g, '\\.'); }

// --- before the uninstall -----------------------------------------------------------------------------------------------

function learnScript(packageId, db) {
    // packageId is a plain id (validId): no quote can get into the statement.
    var p = "'" + packageId + "'";
    return 'sqlite3 -readonly ' + (db || WAS_DB) + ' "SELECT hex(id) FROM widgetinfo WHERE pkgname=' + p + ' OR tizen_id=' + p +
        ' OR substr(tizen_id,1,' + (packageId.length + 1) + ")='" + packageId + ".';\" 2>/dev/null; true";
}

function parseLearn(text) {
    var ids = [];
    String(text || '').split('\n').forEach(function (l) {
        l = l.trim();
        if (!l || !HEX_RE.test(l)) return;
        var id = Buffer.from(l, 'hex').toString('utf8');
        if (validId(id) && ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
}

// Resolves with the widget ids of the package (possibly none); never rejects, because a failed read must not stop an uninstall.
function learn(execute, packageId, options) {
    if (!validId(packageId)) return Promise.resolve([]);
    var script = learnScript(packageId, options && options.wasDb);
    return execute(wrap(script), 10000).then(function (r) {
        return r && !r.exit_code && !r.timed_out ? parseLearn(r.stdout) : [];
    }, function () { return []; });
}

// --- after the uninstall ------------------------------------------------------------------------------------------------

// Shell prelude shared by clean and sweep. Paths can be moved for the tests.
function prelude(o) {
    o = o || {};
    return [
        'HOMES="' + (o.homeDirs || HOME_DIRS).join(' ') + '"',
        'WAS=' + (o.wasDb || WAS_DB),
        'PKG=' + (o.pkgDb || PKG_DB),
        'ICONS=' + (o.iconRoot || ICON_ROOT),
        'K=' + (o.backupDir || BACKUP_DIR),
        'SETTLE=' + (o.settle === undefined ? 5 : o.settle),
        'mkdir -p "$K" 2>/dev/null',
        // csfs rewrites its cache from memory while it runs.
        'running() { ' + (o.runningCmd || 'pidof com.samsung.tv.csfs >/dev/null 2>&1 || ps 2>/dev/null | grep -q "[c]sfs"') + '; }',
        // Rewrites every Home cache without the lines matching the extended regex $1. Prints how many lines went.
        'strip() { n=0; for d in $HOMES; do for f in ' + CACHES.join(' ') + '; do F="$d/$f"; [ -f "$F" ] || continue',
        '  c=$(grep -cE "$1" "$F" 2>/dev/null); [ "${c:-0}" -gt 0 ] || continue',
        '  cp -p "$F" "$K/$f.$(date +%s).before" 2>/dev/null',
        '  cp -p "$F" "$F.vetro-tmp" || continue',
        '  grep -vE "$1" "$F" > "$F.vetro-tmp"',
        '  if grep -q EOFC "$F.vetro-tmp"; then mv -f "$F.vetro-tmp" "$F"; n=$((n+c)); else rm -f "$F.vetro-tmp"; fi',
        ' done; done; echo "HOME $n"; }',
        'left() { t=0; for d in $HOMES; do for f in ' + CACHES.join(' ') + '; do [ -f "$d/$f" ] && t=$((t+$(grep -cE "$1" "$d/$f" 2>/dev/null))); done; done; echo $t; }'
    ].join('\n') + '\n';
}

function cleanScript(packageId, widgetIds, options) {
    var alt = [reEscape(packageId), reEscape(packageId) + '\\..*'].concat(widgetIds.map(reEscape)).join('|');
    var pattern = '^d/webapp@(' + alt + ')$';
    var inList = widgetIds.map(function (w) { return "'" + w + "'"; }).join(',');
    var lines = [prelude(options),
        // An app that is still installed is never touched.
        'if [ "$(sqlite3 -readonly "$PKG" "SELECT count(*) FROM package_app_info WHERE package=\'' + packageId + '\';" 2>/dev/null)" != 0 ]; then echo "SKIP installed"; exit 0; fi',
        'P=\'' + pattern + '\''];
    widgetIds.forEach(function (w) {
        lines.push('if command -v vconftool >/dev/null 2>&1; then vconftool set -f -t string memory/was/app_uninstall \'' + w + '\' >/dev/null 2>&1; vconftool set -f -t int memory/was/app_change 1 >/dev/null 2>&1; echo "SIGNAL \'' + w + '\'"; fi');
    });
    lines.push(
        'if running; then sleep "$SETTLE"; if [ "$(left "$P")" -gt 0 ] && running; then echo "HOME pending"; else echo "HOME 0"; fi; else strip "$P"; fi'
    );
    if (widgetIds.length) {
        lines.push(
            'sqlite3 -readonly "$WAS" ".mode insert widgetinfo" "SELECT * FROM widgetinfo WHERE id IN (' + inList + ');" > "$K/widgetinfo-' + packageId + '.sql" 2>/dev/null',
            // The row goes only when the package manager has no app of that id either.
            'sqlite3 -bail "$WAS" "ATTACH \'$PKG\' AS p; BEGIN IMMEDIATE; DELETE FROM widgetinfo WHERE id IN (' + inList + ') AND tizen_id NOT IN (SELECT app_id FROM p.package_app_info); SELECT \'ROW \'||changes(); COMMIT;" 2>/dev/null || echo "ROW failed"'
        );
        widgetIds.forEach(function (w) {
            lines.push('if [ -d "$ICONS/' + w + '" ]; then rm -f "$ICONS/' + w + '"/*.png; rmdir "$ICONS/' + w + '" 2>/dev/null && echo "ICON ' + w + '"; fi');
        });
    }
    lines.push('true');
    return lines.join('\n');
}

function parseResult(text) {
    var out = {skipped: false, home: 'none', homeLines: 0, rows: 0, rowFailed: false, icons: 0, signals: 0};
    String(text || '').split('\n').forEach(function (l) {
        var m;
        if (/^SKIP installed/.test(l)) out.skipped = true;
        else if ((m = /^HOME (\d+)$/.exec(l))) { out.homeLines += +m[1]; out.home = out.homeLines ? 'removed' : 'none'; }
        else if (/^HOME pending$/.test(l)) out.home = 'pending';
        else if ((m = /^ROW (\d+)$/.exec(l))) out.rows += +m[1];
        else if (/^ROW failed/.test(l)) out.rowFailed = true;
        else if (/^ICON /.test(l)) out.icons++;
        else if (/^SIGNAL /.test(l)) out.signals++;
    });
    return out;
}

// Runs after the package is verified gone. Resolves with what was cleaned; never rejects (the uninstall already happened).
function clean(execute, packageId, widgetIds, options) {
    if (!validId(packageId)) return Promise.resolve({error: 'Invalid package id'});
    var ids = (widgetIds || []).filter(validId);
    return execute(wrap(cleanScript(packageId, ids, options)), 30000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) return {error: (r && (r.stderr || r.stdout)) || 'Cleanup did not finish'};
        return parseResult(r.stdout);
    }, function (e) { return {error: e.message}; });
}

// --- leftovers of earlier uninstalls ------------------------------------------------------------------------------------

// Home lines whose app is known nowhere: no registry row with that id, no registry app id, no package or app of that id.
function orphansScript(options) {
    return prelude(options) + [
        'F=; for d in $HOMES; do if [ -f "$d/' + CACHES[0] + '" ]; then F="$d/' + CACHES[0] + '"; break; fi; done',
        '[ -n "$F" ] && grep "^d/webapp@" "$F" | sed "s/^d\\/webapp@//" | sort -u | while read id; do',
        ' case "$id" in *[!A-Za-z0-9_.-]*|""|.|..) continue;; esac',
        ' a=$(sqlite3 -readonly "$WAS" "SELECT count(*) FROM widgetinfo WHERE id=\'$id\' OR tizen_id=\'$id\' OR pkgname=\'$id\';" 2>/dev/null)',
        ' b=$(sqlite3 -readonly "$PKG" "SELECT count(*) FROM package_app_info WHERE app_id=\'$id\' OR package=\'$id\';" 2>/dev/null)',
        ' [ "$a" = 0 ] && [ "$b" = 0 ] && echo "ORPHAN $id"',
        'done',
        // A failed read prints nothing, which would look like "no leftovers": say whether the registry could be read at all.
        'n=$(sqlite3 -readonly "$WAS" "SELECT count(*) FROM widgetinfo;" 2>/dev/null); echo "REGISTRY ${n:-unreadable}"',
        'true'
    ].join('\n');
}

function parseOrphans(text) {
    var out = {orphans: [], registryRows: null};
    String(text || '').split('\n').forEach(function (l) {
        var m;
        if ((m = /^ORPHAN (\S+)$/.exec(l)) && validId(m[1])) out.orphans.push(m[1]);
        else if ((m = /^REGISTRY (\d+)$/.exec(l))) out.registryRows = +m[1];
    });
    return out;
}

function orphans(execute, options) {
    return execute(wrap(orphansScript(options)), 30000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || 'Home row unreadable');
        var o = parseOrphans(r.stdout);
        // An unreadable or empty registry would make every line look orphaned: report none then.
        if (!o.registryRows || o.registryRows < 5) return {orphans: [], registryRows: o.registryRows, unsafe: true};
        return o;
    });
}

function sweepScript(ids, options) {
    var pattern = '^d/webapp@(' + ids.map(reEscape).join('|') + ')$';
    return prelude(options) + [
        'P=\'' + pattern + '\'',
        'if running; then sleep 0; echo "HOME pending"; else strip "$P"; fi',
        'true'
    ].join('\n');
}

// Removes the lines of the given ids (which must come from orphans(): they are checked again here against the current list).
function sweep(execute, options) {
    return orphans(execute, options).then(function (o) {
        if (o.unsafe || !o.orphans.length) return {removed: [], home: 'none', unsafe: !!o.unsafe};
        return execute(wrap(sweepScript(o.orphans, options)), 30000).then(function (r) {
            if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || 'Cleanup did not finish');
            var res = parseResult(r.stdout);
            return {removed: res.home === 'removed' ? o.orphans : [], home: res.home, found: o.orphans};
        });
    });
}

module.exports = {learn: learn, clean: clean, orphans: orphans, sweep: sweep, validId: validId,
    learnScript: learnScript, cleanScript: cleanScript, orphansScript: orphansScript, sweepScript: sweepScript, parseResult: parseResult,
    parseLearn: parseLearn, parseOrphans: parseOrphans, wrap: wrap};
