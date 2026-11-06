'use strict';
// A list of the components that Vetro itself disabled one by one from the Task manager (POST /debloat), so that
// "Restore the TV" can switch on exactly those and nothing the firmware shipped disabled (factory, hotel and aging
// apps are disabled out of the box, and a blanket re-enable would start them).
//
// The file lives next to the other root-written Vetro state, one app ID per line. Writing it is best effort: a
// failure never blocks the change the user asked for. Components that Quick settings groups disable are not listed
// here: the groups know their own members (quick-settings.js).

var DIR = '/home/owner/share/vetro';
var FILE = DIR + '/disabled-by-vetro';
var ID = /^[A-Za-z0-9_.-]{1,180}$/;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function valid(id) { return typeof id === 'string' && ID.test(id); }

function addCommand(id) {
    if (!valid(id)) throw new Error('Invalid app ID');
    return wrap('mkdir -p ' + DIR + '\ntouch ' + FILE + '\ngrep -qx -- "' + id + '" ' + FILE + ' || echo "' + id + '" >> ' + FILE + '\ntrue');
}
function removeCommand(ids) {
    ids = [].concat(ids);
    ids.forEach(function (id) { if (!valid(id)) throw new Error('Invalid app ID'); });
    // Rewritten through a temporary file: no sed -i on the busybox of older firmware.
    return wrap('[ -f ' + FILE + ' ] || exit 0\n' + 'grep -v -x -F -e ' + ids.map(function (id) { return '"' + id + '"'; }).join(' -e ') + ' ' + FILE +
        ' > ' + FILE + '.tmp; mv -f ' + FILE + '.tmp ' + FILE + '\ntrue');
}
function readCommand() { return wrap('cat ' + FILE + ' 2>/dev/null; true'); }
function parse(text) {
    var seen = {}, out = [];
    String(text || '').split('\n').forEach(function (l) {
        l = l.trim();
        if (valid(l) && !seen[l]) { seen[l] = true; out.push(l); }
    });
    return out;
}

module.exports = {FILE: FILE, DIR: DIR, addCommand: addCommand, removeCommand: removeCommand, readCommand: readCommand, parse: parse};
