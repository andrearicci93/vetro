'use strict';
var fs = require('fs');

// Generate rules for the calling service, not a caller-supplied label.
// The returned script must run in the already privileged bootstrap before
// the root agent connects. Reading/generating it never changes SMACK policy.
function buildRules() {
    var label;
    try { label = fs.readFileSync('/proc/self/attr/current', 'utf8').trim(); }
    catch (e) { return ''; }
    // Deliberately accept only short package-label characters. An unfamiliar
    // label is skipped rather than interpolated into a rule or shell command.
    if (!/^[A-Za-z0-9_:][A-Za-z0-9_:.-]{0,22}$/.test(label)) return '';
    return "printf '%s\\n' '_ " + label + " w' > /sys/fs/smackfs/load2 2>/dev/null || true\n" +
        "printf '%s\\n' '" + label + " _ w' > /sys/fs/smackfs/load2 2>/dev/null || true\n";
}

module.exports = {buildRules: buildRules};
