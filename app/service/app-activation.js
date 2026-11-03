'use strict';
// The Q74T's launchpad restarts HbbTV and screend restarts Ambient. Use the
// package manager's supported activation API, with exact state readback.
var IDS = ['org.tizen.hbbtv-service', 'org.tizen.ambientapp'];
function valid(id) { if (IDS.indexOf(id) < 0) throw Error('Unsupported background app'); }
function readScript(id) {
    valid(id);
    return 'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "SELECT app_disable FROM package_app_info WHERE app_id=\'' + id + '\';"';
}
function parse(text) {
    var s = String(text || '').trim();
    if (s !== 'true' && s !== 'false') throw Error('Background app activation state unavailable');
    return s === 'true';
}
function command(id, disabled) {
    valid(id);
    if (typeof disabled !== 'boolean') throw Error('Invalid app activation state');
    // pkgcmd returns 25 when the requested state is already set on Tizen 5.5.
    return 'current=$(' + readScript(id) + ') || exit 1\n' +
        'case "$current" in true|false) ;; *) echo "Activation state unavailable" >&2; exit 1;; esac\n' +
        'if [ "$current" != ' + (disabled ? 'true' : 'false') + ' ]; then pkgcmd ' +
        (disabled ? '-D' : '-A') + ' -t app -n ' + id + ' --global; fi';
}
function check(r) {
    if (!r || r.exit_code || r.timed_out) throw Error(r && (r.stderr || r.stdout) || 'Background app activation failed');
    return r.stdout || '';
}
function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function set(execute, id, disabled) {
    var wait = disabled ? '\ni=0; while app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*' + id.replace(/\./g, '\\.') +
        '[[:space:]]" && [ $i -lt 12 ]; do sleep 0.5; i=$((i+1)); done' : '';
    return execute(wrap('set -e\n' + command(id, disabled) + wait + '\n' + readScript(id)), 12000).then(function (r) {
        var lines = check(r).trim().split('\n');
        if (parse(lines[lines.length - 1]) !== disabled) throw Error('Background app activation did not change');
    });
}
module.exports = {readScript: readScript, parse: parse, command: command, set: set};
