'use strict';
// Retry timing and bounded logging for the root-agent lifecycle (platform.js).
//
// A TV where the agent can never start (Developer Mode off, a .NET runtime the payload does not support, sdbd
// refusing the connection) used to be retried every 8 s for as long as the service ran, and every failure
// appended the whole adapter state to two files: one on the persistent /opt partition, one in tmpfs (RAM).
// The delay now grows to a ceiling, and the files stop growing at a fixed size.

var FIRST_MS = 8000;
var MAX_MS = 5 * 60 * 1000;
var LOG_MAX_BYTES = 256 * 1024;
var LOG_KEEP_BYTES = 64 * 1024;

// failures = consecutive launch failures since the agent last connected (or since the service started).
function relaunchDelay(failures) {
    var n = Math.floor(Number(failures));
    if (!(n > 1)) return FIRST_MS;
    return Math.min(MAX_MS, FIRST_MS * Math.pow(2, Math.min(n, 16) - 1));
}

// How long a launch that was dispatched may wait for the agent to call back before it is tried again.
function callbackWait(failures) {
    return Math.max(30000, relaunchDelay(failures));
}

// Appends one line; once the file would pass maxBytes it is cut down to its newest lines first.
// Never throws: the log is diagnostics, not state.
function appendBounded(fs, file, line, maxBytes, keepBytes) {
    maxBytes = maxBytes || LOG_MAX_BYTES;
    keepBytes = keepBytes || LOG_KEEP_BYTES;
    try {
        var size = 0;
        try { size = fs.statSync(file).size; } catch (e) { size = 0; }
        if (size + Buffer.byteLength(line) > maxBytes) {
            var kept = '';
            try {
                var all = fs.readFileSync(file, 'utf8');
                kept = all.slice(Math.max(0, all.length - keepBytes));
                var cut = kept.indexOf('\n');
                kept = cut >= 0 && kept.length === keepBytes ? kept.slice(cut + 1) : kept;
            } catch (e) { kept = ''; }
            fs.writeFileSync(file, kept + line);
            return true;
        }
        fs.appendFileSync(file, line);
        return true;
    } catch (e) { return false; }
}

module.exports = {
    relaunchDelay: relaunchDelay, callbackWait: callbackWait, appendBounded: appendBounded,
    FIRST_MS: FIRST_MS, MAX_MS: MAX_MS, LOG_MAX_BYTES: LOG_MAX_BYTES, LOG_KEEP_BYTES: LOG_KEEP_BYTES
};
