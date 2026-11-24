'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = '/home/owner/share/vetro-backups';
var APP_ROOT = '/opt/usr/home/owner/apps_rw';
var VETRO_ID = 'vetrotvapp';
var APP_IDS = {
    vetro: VETRO_ID,
    apltv: 'APLTVMedia',
    'apl-tv': 'APLTVMedia',
    'apl-launcher': 'APLauncher',
    omegatube: 'org.omegatube.app',
    aiostreams: 'AIOStreams',
    'free-my-tv': 'FreeMyTVio',
    osmtwitch: 'OsmTwichTV',
    'steam-link': 'TSLinkTV01',
    app2samsung: 'A2STVStore'
};

function safeName(value) {
    return /^[A-Za-z0-9_.-]+$/.test(String(value || ''));
}

function quote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function idFor(value) {
    var key = String(value || '').toLowerCase();
    var id = APP_IDS[key] || (safeName(value) ? String(value) : null);
    if (!id || !safeName(id)) throw Error('Unsupported application');
    return id;
}

function shell(execute, command) {
    return execute(command, 30000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw Error((r && (r.stderr || r.stdout)) || 'Backup command failed');
        return r;
    });
}

function Backup(options) {
    options = options || {};
    this.execute = options.execute;
    if (typeof this.execute !== 'function') throw Error('Backup requires an execute function');
}

Backup.prototype.catalog = function () {
    return shell(this.execute, 'mkdir -p ' + quote(ROOT) + ' && find ' + quote(ROOT) + ' -maxdepth 1 -type f -name "*.tar.gz" -printf "%f\\t%s\\n" 2>/dev/null || true')
        .then(function (r) {
            return {ok: true, files: String(r.stdout || '').split('\n').filter(Boolean).map(function (line) {
                var p = line.split('\t'); return {name: p[0], size: Number(p[1] || 0)};
            })};
        });
};

Backup.prototype.create = function (scope) {
    var self = this;
    var id = scope === 'vetro' ? VETRO_ID : idFor(scope);
    var stamp = Date.now() + '-' + id;
    var archive = ROOT + '/' + stamp + '.tar.gz';
    var manifest = ROOT + '/' + stamp + '.manifest';
    var cmd = 'set -e; mkdir -p ' + quote(ROOT) + '; ' +
        'test -d ' + quote(APP_ROOT + '/' + id) + '; ' +
        'printf "app=%s\\ncreated=%s\\n" ' + quote(id) + ' ' + quote(String(Date.now())) + ' > ' + quote(manifest) + '; ' +
        'tar --exclude="*/cache" --exclude="*/tmp" --exclude="*.log" -czf ' + quote(archive) +
        ' -C ' + quote(APP_ROOT) + ' ' + quote(id) + '; ' +
        'sha256sum ' + quote(archive) + ' >> ' + quote(manifest) + '; ' +
        'printf "%s\\n" ' + quote(archive);
    return shell(self.execute, cmd).then(function () {
        return {ok: true, scope: scope, appId: id, name: path.basename(archive), path: archive};
    });
};

Backup.prototype.restore = function (scope, name) {
    var self = this;
    var id = scope === 'vetro' ? VETRO_ID : idFor(scope);
    if (!safeName(name) || name.indexOf('.tar.gz') !== name.length - 7) return Promise.reject(Error('Invalid backup name'));
    var archive = ROOT + '/' + name;
    var rollback = ROOT + '/rollback-' + Date.now() + '-' + id + '.tar.gz';
    var target = APP_ROOT + '/' + id;
    var cmd = 'set -e; test -f ' + quote(archive) + '; test -d ' + quote(target) + '; ' +
        'tar -tzf ' + quote(archive) + ' | awk -v p=' + quote(id + '/') + ' ' +
        quote('$0 !~ /^\\// && index($0,p)==1 {ok=1} END {exit !ok}') + '; ' +
        'tar --exclude="*/cache" --exclude="*/tmp" --exclude="*.log" -czf ' + quote(rollback) +
        ' -C ' + quote(APP_ROOT) + ' ' + quote(id) + '; ' +
        'tar -xzf ' + quote(archive) + ' -C ' + quote(APP_ROOT) + ' --overwrite; ' +
        'chown -R 5001:5001 ' + quote(target) + '; printf "%s\\n" ' + quote(rollback);
    return shell(self.execute, cmd).then(function () {
        return {ok: true, scope: scope, appId: id, rollback: path.basename(rollback)};
    });
};

Backup.prototype.resolve = function (name) {
    if (!safeName(name) || name.indexOf('.tar.gz') !== name.length - 7) throw Error('Invalid backup name');
    return ROOT + '/' + name;
};

module.exports = {Backup: Backup, ROOT: ROOT, APP_IDS: APP_IDS};
