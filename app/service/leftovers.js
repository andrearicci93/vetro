'use strict';
// Install leftovers, ported from Apps2Samsung's TV Toolbox (MIT, see
// THIRD_PARTY_NOTICES.md): the platform pushes every package to the staging
// folder before installing it and never removes it. Only files directly in the
// two folders are considered; subfolders are never touched. Clear deletes only
// package files (.wgt/.tpk/.rpm), one at a time; other files stay.
var DIRS = ['/home/owner/share/tmp/sdk_tools', '/home/owner/share/tmp/sdk_tools/tmp'];
// Other scraps, from a read-only survey of a Q80A (firmware 2310.0) with the TV on. Each is a closed list, not a pattern
// over the whole disk: rotated logs of the network manager, the temporary pictures Prime Video leaves in its own tmp folder,
// and the Chromium code and shader caches of web apps that are not running. Everything else that looks like scrap
// (cache folders of Netflix and YouTube, *.bak, *.old, /tmp) was judged risky and is not touched.
var EXTRAS = {
    logs: ['/opt/usr/data/network/inm-manager.log.[0-9]*'], logDays: 7,
    bitmaps: [{dir: '/opt/usr/home/owner/apps_rw/org.tizen.primevideo/data/tmp', app: 'org.tizen.primevideo'}], bitmapDays: 1,
    webRoot: '/opt/usr/home/owner/apps_rw', webNames: ['Code Cache', 'GPUCache']
};
var KINDS = {log: 'Old network logs', bitmap: 'Prime Video temporary pictures', webcache: 'Web app caches (closed apps)'};
var STORAGE = '/home/owner/share/tmp';

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

function script(clear, dirs, storagePath, extras) {
    dirs = dirs || DIRS;
    extras = extras === undefined ? EXTRAS : extras;
    var storage = 'df -kP ' + (storagePath || STORAGE) + ' 2>/dev/null | awk \'NR==2{print $2" "$4}\'';
    return 'echo "S before $(' + storage + ')"\ni=0\nfor d in ' + dirs.join(' ') + '; do\n' +
        ' if [ ! -d "$d" ]; then echo "E $i missing"; i=$((i+1)); continue; fi\n' +
        ' if [ ! -r "$d" ] || [ ! -x "$d" ]; then echo "E $i unreadable"; i=$((i+1)); continue; fi\n' +
        // Include dotfiles; a plain * glob would miss them.
        ' for f in "$d"/* "$d"/.[!.]* "$d"/..?*; do\n' +
        '  [ -e "$f" ] || [ -L "$f" ] || continue\n' +
        '  [ -d "$f" ] && continue\n' +
        '  n=${f##*/}; s=$(stat -c %s "$f" 2>/dev/null || echo 0)\n' +
        '  b=$(printf %s "$n" | base64 | tr -d "\\n")\n' +
        // The name must be longer than the extension, as in Apps2Samsung.
        '  p=0; case "$n" in ?*.[wW][gG][tT]|?*.[tT][pP][kK]|?*.[rR][pP][mM]) p=1;; esac\n' +
        (clear
            ? '  if [ "$p" = 1 ]; then rm -f -- "$f"; if [ -e "$f" ] || [ -L "$f" ]; then echo "X $i $s $b"; else echo "D $i $s $b"; fi; else echo "F $i $s 0 $b"; fi\n'
            : '  echo "F $i $s $p $b"\n') +
        ' done\n i=$((i+1))\ndone\n' + (extras ? extrasScript(clear, extras) : '') + 'echo "S after $(' + storage + ')"\n';
}

function sq(v) { if (/['\n]/.test(v)) throw new Error('Unsafe path'); return "'" + v + "'"; }
// K: found, Y: deleted, Z: could not delete. "N apps" means the list of running apps could not be read, so nothing that
// depends on an app being closed is touched. A file is skipped when it is a link, has several hard links, is younger than
// the minimum age or is open (fuser; if fuser is missing, everything counts as open).
function extrasScript(clear, x) {
    var out = ['run=$(app_launcher -S 2>/dev/null); case "$run" in *"("*")"*) ok=1;; *) ok=0; echo "N apps";; esac',
        'busy() { printf "%s\\n" "$run" | grep -Eq "[[:space:]]$1([. ]|\\$)"; }',
        'inuse() { command -v fuser >/dev/null 2>&1 || return 0; fuser "$1" >/dev/null 2>&1; }',
        'plain() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %h "$1" 2>/dev/null)" = 1 ]; }',
        'rec() { echo "$1 $2 $3 $(printf %s "$4" | base64 | tr -d "\\n")"; }',
        'drop() { if [ "$1" = file ]; then rm -f -- "$2"; [ ! -e "$2" ] && [ ! -L "$2" ]; else find "$2" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} \\; ; [ -z "$(ls -A "$2" 2>/dev/null)" ]; fi; }',
        // one <file|dir> <kind> <bytes> <path>: list it, or delete it and say whether that worked
        'one() { if [ "' + (clear ? 1 : 0) + '" = 1 ]; then if drop "$1" "$4"; then rec Y "$2" "$3" "$4"; else rec Z "$2" "$3" "$4"; fi; else rec K "$2" "$3" "$4"; fi; }'];
    x.logs.forEach(function (g) { if (/[\s'"$`;&|<>()\\]/.test(g)) throw new Error('Unsafe path'); });
    out.push('for f in ' + x.logs.join(' ') + '; do plain "$f" || continue; [ -n "$(find "$f" -mtime +' + x.logDays + ' 2>/dev/null)" ] || continue; inuse "$f" && continue; one file log "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$f"; done');
    x.bitmaps.forEach(function (b) {
        out.push('if [ "$ok" = 1 ] && ! busy ' + sq(b.app) + '; then for f in ' + sq(b.dir) + '/tmp_bitmap*; do plain "$f" || continue; n=${f##*/}; printf %s "$n" | grep -Eq \'^tmp_bitmap[0-9]+(\\.[0-9]+)*$\' || continue; [ -n "$(find "$f" -mtime +' + (x.bitmapDays - 1) + ' 2>/dev/null)" ] || continue; inuse "$f" && continue; one file bitmap "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$f"; done; fi');
    });
    out.push('if [ "$ok" = 1 ]; then for d in ' + sq(x.webRoot) + '/*/data; do [ -d "$d" ] && [ ! -L "$d" ] || continue; pkg=${d%/data}; pkg=${pkg##*/}; case "$pkg" in vetrotvapp*) continue;; esac; busy "$pkg" && continue;' +
        ' for name in ' + x.webNames.map(sq).join(' ') + '; do c="$d/$name"; [ -d "$c" ] && [ ! -L "$c" ] || continue; [ -z "$(find "$c" -type l 2>/dev/null | head -n 1)" ] || continue; [ -n "$(find "$c" -type f 2>/dev/null | head -n 1)" ] || continue;' +
        ' sz=$(du -sk "$c" 2>/dev/null | awk \'{print $1*1024}\'); [ "${sz:-0}" -gt 0 ] || continue; one dir webcache "$sz" "$c"; done; done; fi');
    return out.join('\n') + '\n';
}

function name(b64) { try { return Buffer.from(b64, 'base64').toString('utf8'); } catch (e) { return null; } }
function storage(line) {
    var f = String(line || '').trim().split(/\s+/);
    return f.length === 2 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) ? {totalBytes: +f[0] * 1024, availableBytes: +f[1] * 1024} : null;
}

function parse(text, dirs) {
    dirs = dirs || DIRS;
    var out = {dirs: dirs.slice(), files: [], deleted: [], failed: [], errors: [], storageBefore: null, storageAfter: null,
        extras: [], extrasDeleted: [], extrasFailed: [], appsUnreadable: false};
    String(text || '').split('\n').forEach(function (l) {
        var m;
        if ((m = /^S (before|after) ?(.*)$/.exec(l))) out[m[1] === 'before' ? 'storageBefore' : 'storageAfter'] = storage(m[2]);
        else if ((m = /^E (\d) (\w+)$/.exec(l))) {
            // A missing tmp/ subfolder is normal; anything else is reported.
            if (!(m[2] === 'missing' && m[1] !== '0')) out.errors.push({path: dirs[+m[1]], error: m[2]});
        } else if ((m = /^F (\d) (\d+) ([01]) ([A-Za-z0-9+/=]+)$/.exec(l))) {
            out.files.push({name: name(m[4]), path: dirs[+m[1]] + '/' + name(m[4]), size: +m[2], isPackage: m[3] === '1'});
        } else if (l === 'N apps') {
            out.appsUnreadable = true;
        } else if ((m = /^([KYZ]) (log|bitmap|webcache) (\d+) ([A-Za-z0-9+/=]+)$/.exec(l))) {
            var item = {kind: m[2], label: KINDS[m[2]], path: name(m[4]), size: +m[3]};
            (m[1] === 'K' ? out.extras : m[1] === 'Y' ? out.extrasDeleted : out.extrasFailed).push(item);
        } else if ((m = /^([DX]) (\d) (\d+) ([A-Za-z0-9+/=]+)$/.exec(l))) {
            (m[1] === 'D' ? out.deleted : out.failed).push({name: name(m[4]), path: dirs[+m[2]] + '/' + name(m[4]), size: +m[3]});
        }
    });
    var packages = out.files.filter(function (f) { return f.isPackage; });
    out.packageCount = packages.length;
    out.packageBytes = packages.reduce(function (n, f) { return n + f.size; }, 0);
    function sum(list) { return list.reduce(function (n, f) { return n + f.size; }, 0); }
    out.extraBytes = sum(out.extras);
    out.extraKinds = {};
    out.extras.forEach(function (f) { var k = out.extraKinds[f.kind] || (out.extraKinds[f.kind] = {label: f.label, count: 0, bytes: 0}); k.count++; k.bytes += f.size; });
    out.freedBytes = sum(out.deleted) + sum(out.extrasDeleted);
    return out;
}

function Leftovers(execute) { this.execute = execute; this.busy = false; }
Leftovers.prototype.list = function () {
    return this.execute(wrap(script(false)), 15000).then(function (r) {
        if (r.exit_code || r.timed_out) throw new Error('Staging folder unreadable');
        return parse(r.stdout);
    });
};
Leftovers.prototype.clear = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Cleanup already in progress'));
    this.busy = true;
    return this.execute(wrap(script(true)), 60000).then(function (r) {
        if (r.timed_out) throw new Error('Cleanup did not finish in time; refresh to see what remains');
        var result = parse(r.stdout);
        // Files that were not packages stay; list them as the current contents.
        return Object.assign(result, {ok: !result.failed.length && !result.errors.length && !result.extrasFailed.length});
    }).finally(function () { self.busy = false; });
};

module.exports = {Leftovers: Leftovers, DIRS: DIRS, EXTRAS: EXTRAS, KINDS: KINDS, script: script, parse: parse};
