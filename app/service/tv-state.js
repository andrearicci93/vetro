'use strict';
// Read-only Q80A audio/source state, independent of the foreground widget.
var path = require('path');
function decode(text) {
    var d = JSON.parse(String(text).trim());
    var type = Number.isInteger(d.sourceType) ? d.sourceType : null;
    var source = type === 0 ? 'TV' : type >= 13 && type <= 16 ? 'HDMI' + (type - 12) : null;
    return {volume: Number.isInteger(d.volume) && d.volume >= 0 && d.volume <= 100 ? d.volume : null,
        muted: typeof d.muted === 'boolean' ? d.muted : null, source: source, sourceType: type};
}
function Store(execute, options) { this.execute = execute; this.pending = null; this.tizen55 = !!(options && options.tizen55); }
Store.prototype.read = function () {
    if (this.pending) return this.pending;
    var self = this;
    var file = path.join(__dirname, '..', 'native', 'TvState.dll');
    var command = '/usr/bin/dotnet ' + "'" + file.replace(/'/g, "'\\''") + "'";
    if (this.tizen55) {
        var q=function(s){return "'"+s.replace(/'/g,"'\\''")+"'";};
        var child='printf %s System::Privileged > /proc/self/attr/current || exit 1; exec /usr/bin/dotnet-launcher --standalone '+q(file)+' "$1"';
        var script="set -e\numask 077\nout=$(mktemp /tmp/vetro-state.XXXXXX)\ntrap 'rm -f \"$out\"' EXIT\n/bin/sh -c "+q(child)+" vetro-state \"$out\"\ncat \"$out\"";
        command='echo '+Buffer.from(script).toString('base64')+' | base64 -d | sh';
    }
    this.pending = this.execute(command, 8000).then(function (r) {
        if (r.exit_code || r.timed_out) throw Error('TV audio/source state unavailable');
        return decode(r.stdout);
    }).finally(function () { self.pending = null; });
    return this.pending;
};
module.exports = {Store: Store, decode: decode};
