'use strict';
// Diagnostic reports carry a failure code from a fixed vocabulary, never the
// command output. Readers attach it to the Error they already throw.
var CODES = ['no-root-agent', 'command-timeout', 'command-failed', 'incomplete', 'unreadable', 'not-requested'];
function failed(r, message) {
    var error = new Error(message);
    error.code = r && r.timed_out ? 'command-timeout' : 'command-failed';
    if (r && !r.timed_out && Number.isInteger(r.exit_code)) error.exitCode = r.exit_code;
    return error;
}
function coded(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}
module.exports = {CODES: CODES, failed: failed, coded: coded};
