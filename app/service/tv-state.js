'use strict';
// Read-only TV audio/source state for MQTT, independent of the foreground widget. Asked every 10 s while a broker is connected.
//
// First choice: four vconf reads with buxton2ctl, about 34 ms on a Q80A (fw 2310.0, measured 2026-11-21), no dotnet process:
// - memory/system/source_type: the input (0 TV, 13-16 HDMI 1-4, 33 DisplayPort on Samsung's monitors);
// - file/private/sound/volume/Master: the master volume as Samsung's audio library keeps it (libtizen-audio, same key on
//   6.0, 6.5 and 9); it read 14 when sound_manager_get_master_volume did;
// - memory/org.tizen.tv-viewer/mute_status: the mute of the TV's own key. The audio API's mute stays false when the TV is
//   muted that way (dock/src/Native/Sound.cs); tv-viewer (6.0) and volume-app (6.5, 9) keep it here;
// - file/private/sound/volume/MasterMuteOn: the audio library's own mute, for a mute set through the API.
// A fifth read gives the power state: memory/pm/state is deviced's own state (1 picture on, 2 dimmed, 3 picture off: the
// Q80A read 1 and 3 around Picture Off, 2026-11-19), the same key the input helper reads. Home Assistant gets On or Standby.
// Fallback, when none of those can be read (no buxton2ctl): native/TvState.dll, a dotnet process each time (about 120 ms on
// the Q80A, more on 2 GB TVs).
// The same command reads the channel on screen from Vetro's tuner, while it runs: the tuner rewrites a small JSON file next
// to its pid file at every channel change (tuner/src/Core/ChannelFile.cs). It is read through the root agent like the rest,
// because the service may not be allowed to open the tuner's files itself on every TV. Only kept while the input is TV.
var path = require('path');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
var LINE_RE = /^\[(?:memory|system)\] (\S+) = (Int32|Boolean): (\S+)\s*$/;
var INT_RE = /^-?\d+$/;
var KEYS = {source: 'memory/system/source_type', mute: 'memory/org.tizen.tv-viewer/mute_status',
    volume: 'file/private/sound/volume/Master', apiMute: 'file/private/sound/volume/MasterMuteOn', power: 'memory/pm/state'};
var TUNER_PID = '/home/owner/vetro-tuner.pid', TUNER_CHANNEL = '/home/owner/vetro-tuner-channel.json';
var READ = 'B=/usr/bin/buxton2ctl; if [ -x $B ]; then ' +
    '$B get memory ' + KEYS.source + ' 2>/dev/null; $B get memory ' + KEYS.mute + ' 2>/dev/null; ' +
    '$B get system ' + KEYS.volume + ' 2>/dev/null; $B get system ' + KEYS.apiMute + ' 2>/dev/null; ' +
    '$B get memory ' + KEYS.power + ' 2>/dev/null; fi; ' +
    'P=$(cat ' + TUNER_PID + ' 2>/dev/null); case "$P" in ""|*[!0-9]*) ;; *) if [ -d /proc/$P ]; then echo "TUNER|$P"; ' +
    'echo "CHANNEL|$(head -c 1024 ' + TUNER_CHANNEL + ' 2>/dev/null | tr -d "\\n")"; fi ;; esac; true';
// One read, for a rule's condition (the Remapper's "only when the screen is on / off"): asked when the rule fires, not polled.
var POWER_READ = '[ -x /usr/bin/buxton2ctl ] && /usr/bin/buxton2ctl get memory ' + KEYS.power + ' 2>/dev/null; true';
var TUNER_RE = /^TUNER\|(\d+)$/m, CHANNEL_RE = /^CHANNEL\|(\{.*\})$/m;

function sourceName(type) {
    return type === 0 ? 'TV' : type >= 13 && type <= 16 ? 'HDMI' + (type - 12) : type === 33 ? 'DisplayPort' : type === 41 ? 'USB-C' : null;
}
// TvState.dll's JSON line.
function decode(text) {
    var d = JSON.parse(String(text).trim());
    var type = Number.isInteger(d.sourceType) ? d.sourceType : null;
    return {volume: Number.isInteger(d.volume) && d.volume >= 0 && d.volume <= 100 ? d.volume : null,
        muted: typeof d.muted === 'boolean' ? d.muted : null, source: sourceName(type), sourceType: type};
}
// buxton2ctl's lines ("[memory] memory/system/source_type = Int32: 0"). Null when nothing could be read.
function decodeVconf(text) {
    var v = {};
    String(text || '').split('\n').forEach(function (l) {
        var m = LINE_RE.exec(l.trim());
        if (!m) return;
        v[m[1]] = m[2] === 'Boolean' ? (m[3] === 'True' ? true : m[3] === 'False' ? false : null) : (INT_RE.test(m[3]) ? +m[3] : null);
    });
    var type = Number.isInteger(v[KEYS.source]) ? v[KEYS.source] : null;
    var volume = Number.isInteger(v[KEYS.volume]) && v[KEYS.volume] >= 0 && v[KEYS.volume] <= 100 ? v[KEYS.volume] : null;
    var mute = typeof v[KEYS.mute] === 'boolean' ? v[KEYS.mute] : null, apiMute = v[KEYS.apiMute] === 1 ? true : v[KEYS.apiMute] === 0 ? false : null;
    var muted = mute === true || apiMute === true ? true : mute === false || apiMute === false ? false : null;
    if (type === null && volume === null && muted === null) return null;
    return {volume: volume, muted: muted, source: sourceName(type), sourceType: type};
}

// deviced's power state (memory/pm/state): 1 normal and 2 dimmed = on, 3 screen off, 4 standby and 5 sleep = standby. Null when
// it could not be read or holds anything else, so Home Assistant shows the entity as unavailable instead of guessing.
function decodePower(text) {
    var m = /^\[memory\] memory\/pm\/state = Int32: (-?\d+)\s*$/m.exec(String(text || ''));
    var v = m ? +m[1] : null;
    return v === 1 || v === 2 ? 'on' : v === 3 || v === 4 || v === 5 ? 'standby' : null;
}

// The tuner's channel, from the TUNER|<pid> and CHANNEL|<json> lines: null unless the file is that running tuner's.
function decodeChannel(text) {
    var t = TUNER_RE.exec(String(text || '')), c = CHANNEL_RE.exec(String(text || ''));
    if (!t || !c) return null;
    var d;
    try { d = JSON.parse(c[1]); } catch (e) { return null; }
    if (!d || d.pid !== +t[1] || !Number.isInteger(d.number) || d.number < 0 || d.number > 99999) return null;
    if (typeof d.name !== 'string' || d.name.length > 200) return null;
    return {number: d.number, name: d.name, tvPlus: d.tvPlus === true};
}

function Store(execute) { this.execute = execute; this.pending = null; }
Store.prototype.read = function () {
    if (this.pending) return this.pending;
    var self = this;
    var file = path.join(__dirname, '..', 'native', 'TvState.dll');
    var native = '/usr/bin/dotnet ' + "'" + file.replace(QUOTE_RE, "'\\''") + "'";
    function viaDll() {
        return self.execute(native, 8000).then(function (r) {
            if (r.exit_code || r.timed_out) throw Error('TV audio/source state unavailable');
            return decode(r.stdout);
        });
    }
    // When the vconf part gives nothing (no buxton2ctl, or keys that do not exist there), the DLL reads the audio and the input.
    this.pending = this.execute(READ, 8000).then(function (r) {
        if (r.timed_out || r.exit_code) throw Error('TV audio/source state unavailable');
        var channel = decodeChannel(r.stdout), d = decodeVconf(r.stdout);
        return (d ? Promise.resolve(d) : viaDll()).then(function (s) {
            s.channel = s.source === 'TV' ? channel : null;
            s.power = decodePower(r.stdout);
            return s;
        });
    }).finally(function () { self.pending = null; });
    return this.pending;
};
module.exports = {Store: Store, decode: decode, decodeVconf: decodeVconf, decodeChannel: decodeChannel, decodePower: decodePower, POWER_READ: POWER_READ, sourceName: sourceName, KEYS: KEYS, READ: READ};
