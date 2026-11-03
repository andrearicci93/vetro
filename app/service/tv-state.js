'use strict';
// Read-only Q80A audio/source state, independent of the foreground widget.
var path = require('path');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
function decode(text) {
    var d = JSON.parse(String(text).trim());
    var type = Number.isInteger(d.sourceType) ? d.sourceType : null;
    var source = type === 0 ? 'TV' : type >= 13 && type <= 16 ? 'HDMI' + (type - 12) : null;
    return {volume: Number.isInteger(d.volume) && d.volume >= 0 && d.volume <= 100 ? d.volume : null,
        muted: typeof d.muted === 'boolean' ? d.muted : null, source: source, sourceType: type};
}
function Store(execute) { this.execute = execute; this.pending = null; }
Store.prototype.read = function () {
    if (this.pending) return this.pending;
    var self = this;
    var file = path.join(__dirname, '..', 'native', 'TvState.dll');
    var command = '/usr/bin/dotnet ' + "'" + file.replace(QUOTE_RE, "'\\''") + "'";
    this.pending = this.execute(command, 8000).then(function (r) {
        if (r.exit_code || r.timed_out) throw Error('TV audio/source state unavailable');
        return decode(r.stdout);
    }).finally(function () { self.pending = null; });
    return this.pending;
};
module.exports = {Store: Store, decode: decode};
