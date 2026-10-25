'use strict';
// What the TV's own package manifests say about the components Vetro's firmware catalog (a single Q80A image) does
// not know. Diagnostic reports from other TVs list dozens of such packages (com.samsung.tv.iacr, ...) with nothing
// beyond a name, so they cannot be classified. A manifest has a description, the privileges the package declares and
// the start flags it asks for. Comparing those with what the registry holds is also how a package that the installer
// registered differently shows up (issues #25 and #26: on-boot="true" asked, onboot=false registered).
//
// Only runs when the user ticks the box in Diagnostics. Two read-only calls at the lowest priority; the work is capped
// (packages, executables, bytes), and nothing is written. Paths, addresses and URLs never leave this module: the
// privilege URIs are shortened to "tizen/<name>" or "samsung/<name>", and executables are reported by file name.
var execError = require('./exec-error.js');
var facts = require('./app-facts.js');

var MAX_PACKAGES = 220;       // the export grows by about 600 bytes per package
var MAX_EXES = 40;            // executables hashed; only components that start at boot
var MAX_EXE_BYTES = 8388608;  // larger files are not read
var MAX_PRIVILEGES = 40;
var PACKAGE_ID = /^[A-Za-z0-9_.-]{1,120}$/;
var APP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
var PRIVILEGE = /^http:\/\/(tizen\.org|developer\.samsung\.com)\/privilege\/([A-Za-z0-9_.\/-]{1,80})$/;
var EXEC = /^\/(?:opt\/usr\/apps|usr\/apps)\/[A-Za-z0-9_.-]{1,120}\/[A-Za-z0-9_.\/-]{1,150}$/;
var HASH = /^[a-f0-9]{64}$/;
var DESCRIPTION = /^[A-Za-z0-9 .,()_\-\/&+:']{1,100}$/;
var OWN = /^vetrotvapp(?:\.|$)/;

function wrap(script) { return 'echo ' + Buffer.from(script).toString('base64') + ' | base64 -d | nice -n 19 sh'; }
function bool(v) { return v === 'true' ? true : v === 'false' ? false : null; }

// Which packages to look up: unknown to the catalog, or Vetro's own. Boot-time ones first, then the rest, capped.
function select(rows) {
    var byPackage = {}, order = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
        if (!r || !PACKAGE_ID.test(r.packageId || '') || !APP_ID.test(r.appId || '')) return;
        var known = facts.packages[r.packageId] || facts.packages[r.appId];
        if (known && !OWN.test(r.packageId)) return;
        var p = byPackage[r.packageId];
        if (!p) { p = byPackage[r.packageId] = {packageId: r.packageId, origin: typeof r.origin === 'string' ? r.origin : null, components: []}; order.push(p); }
        p.components.push({appId: r.appId, registeredOnBoot: r.onboot === true ? true : r.onboot === false ? false : null,
            registeredAutoRestart: r.autorestart === true ? true : r.autorestart === false ? false : null});
    });
    function rank(p) { return OWN.test(p.packageId) ? 0 : p.components.some(function (c) { return c.registeredOnBoot; }) ? 1 : 2; }
    order.sort(function (a, b) { return rank(a) - rank(b) || (a.packageId < b.packageId ? -1 : 1); });
    return {targets: order.slice(0, MAX_PACKAGES), total: order.length, truncated: order.length > MAX_PACKAGES};
}

function manifestScript(ids) {
    return [
        'for p in ' + ids.join(' ') + '; do',
        '  f=/opt/share/packages/$p.xml; [ -f "$f" ] || f=/usr/share/packages/$p.xml',
        '  if [ -f "$f" ]; then',
        '    echo "P|$p"; echo "H|$(sha256sum "$f" | cut -c1-64)"',
        '    head -c 32768 "$f" | grep -E "<(description|service-application|ui-application|privilege)[ >]" | head -n 80 | sed "s/^[[:space:]]*//"',
        '  else echo "N|$p"; fi',
        'done',
        'true'
    ].join('\n');
}
function hashScript(paths) {
    return [
        'for e in ' + paths.join(' ') + '; do',
        '  if [ -f "$e" ] && [ "$(wc -c < "$e" | tr -d " ")" -le ' + MAX_EXE_BYTES + ' ]; then sha256sum "$e"; fi',
        'done',
        'true'
    ].join('\n');
}

// One record per package. Lines that do not parse are skipped: one odd manifest must not cost the whole section.
function parseManifests(text) {
    var out = {}, cur = null;
    String(text || '').split('\n').forEach(function (line) {
        line = line.replace(/\r$/, '');
        var m = /^([PNH])\|(.*)$/.exec(line);
        if (m) {
            if (m[1] === 'P' && PACKAGE_ID.test(m[2])) cur = out[m[2]] = {manifest: 'found', sha256: null, description: null, privileges: [], components: {}};
            else if (m[1] === 'N' && PACKAGE_ID.test(m[2])) { out[m[2]] = {manifest: 'missing', sha256: null, description: null, privileges: [], components: {}}; cur = null; }
            else if (m[1] === 'H' && cur && HASH.test(m[2])) cur.sha256 = m[2];
            return;
        }
        if (!cur) return;
        var d = /^<description[^>]*>([^<]*)<\/description>/.exec(line);
        if (d) { if (cur.description === null && DESCRIPTION.test(d[1].trim()) && !/(?:\d{1,3}\.){3}\d{1,3}|https?:|\/home\/|\/opt\/|\/Users\//i.test(d[1])) cur.description = d[1].trim(); return; }
        var pr = /^<privilege>([^<]*)<\/privilege>/.exec(line);
        if (pr) { var u = PRIVILEGE.exec(pr[1].trim()); if (u && cur.privileges.length < MAX_PRIVILEGES) cur.privileges.push((u[1] === 'tizen.org' ? 'tizen/' : 'samsung/') + u[2]); return; }
        var c = /^<(service|ui)-application\s([^>]*)>?/.exec(line);
        if (c) {
            var attrs = {}, re = /([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g, a;
            while ((a = re.exec(c[2])) !== null) attrs[a[1]] = a[2];
            if (APP_ID.test(attrs.appid || '')) cur.components[attrs.appid] = {
                kind: c[1] === 'service' ? 'service' : 'ui', exec: EXEC.test(attrs.exec || '') && attrs.exec.indexOf('..') < 0 ? attrs.exec : null,
                declaredOnBoot: bool(attrs['on-boot']), declaredAutoRestart: bool(attrs['auto-restart']), taskmanage: bool(attrs.taskmanage)};
        }
    });
    return out;
}
function parseHashes(text) {
    var out = {};
    String(text || '').split('\n').forEach(function (line) {
        var m = /^([a-f0-9]{64})\s+(\/\S+)$/.exec(line.replace(/\r$/, ''));
        if (m && EXEC.test(m[2])) out[m[2]] = m[1];
    });
    return out;
}

function build(selection, manifests, hashes) {
    return {
        requested: true, packageCount: selection.targets.length, totalUnknown: selection.total, truncated: selection.truncated,
        packages: selection.targets.map(function (t) {
            var m = manifests[t.packageId] || {manifest: 'missing', sha256: null, description: null, privileges: [], components: {}};
            var open = t.origin === 'system' || t.origin === 'preinstalled' || OWN.test(t.packageId);
            return {
                packageId: t.packageId, origin: t.origin, manifest: m.manifest, manifestSha256: m.sha256,
                description: open ? m.description : null, privileges: m.privileges,
                components: t.components.map(function (c) {
                    var d = m.components[c.appId] || null;
                    var differs = d && d.declaredOnBoot !== null && c.registeredOnBoot !== null
                        ? d.declaredOnBoot !== c.registeredOnBoot || (d.declaredAutoRestart !== null && c.registeredAutoRestart !== null && d.declaredAutoRestart !== c.registeredAutoRestart) : null;
                    return {
                        appId: c.appId, kind: d ? d.kind : null, exec: d && d.exec ? d.exec.split('/').pop() : null,
                        declaredOnBoot: d ? d.declaredOnBoot : null, declaredAutoRestart: d ? d.declaredAutoRestart : null, taskmanage: d ? d.taskmanage : null,
                        registeredOnBoot: c.registeredOnBoot, registeredAutoRestart: c.registeredAutoRestart, differs: differs,
                        exeSha256: d && d.exec && hashes[d.exec] ? hashes[d.exec] : null};
                })};
        })
    };
}

function read(execute, rows) {
    var selection = select(rows);
    if (!selection.targets.length) return Promise.resolve(build(selection, {}, {}));
    var ids = selection.targets.map(function (t) { return t.packageId; });
    return execute(wrap(manifestScript(ids)), 45000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw execError.failed(r, 'component facts unavailable');
        var manifests = parseManifests(r.stdout), paths = [];
        // Hash the executables of components that start at boot, Vetro's own first; the rest is not worth the disk reads.
        selection.targets.forEach(function (t) {
            var m = manifests[t.packageId];
            if (m) t.components.forEach(function (c) {
                var d = m.components[c.appId];
                if (d && d.exec && paths.length < MAX_EXES && paths.indexOf(d.exec) < 0 && (OWN.test(t.packageId) || c.registeredOnBoot || d.declaredOnBoot)) paths.push(d.exec);
            });
        });
        if (!paths.length) return build(selection, manifests, {});
        return execute(wrap(hashScript(paths)), 30000).then(function (h) {
            return build(selection, manifests, h && !h.exit_code && !h.timed_out ? parseHashes(h.stdout) : {});
        }, function () { return build(selection, manifests, {}); });
    });
}

module.exports = {read: read, select: select, parseManifests: parseManifests, parseHashes: parseHashes, build: build, manifestScript: manifestScript, hashScript: hashScript, MAX_PACKAGES: MAX_PACKAGES};
