'use strict';
// Vol+, Vol-, Mute and the 123 key on the real remote, handed to the dock's glass pill and number pad (each opt-in), and the Guide
// key (130), handed to Vetro's TV tuner when it is on (#340).
// The root input bridge swallows the two keys (so Samsung's own bar never draws) and reports them here;
// the dock changes the level and shows the pill. If the dock cannot be reached the original key is
// injected again, so the volume keys never go dead. Mute is soft (the dock drops the level to 0 and restores it), so Samsung's mute banner never draws.

var fs = require('fs');

var FIFO = '/home/owner/tvlauncher.fifo';
var KEYS = {
    '68': {word: 'volup', native: 'XF86AudioRaiseVolume'},
    '67': {word: 'voldown', native: 'XF86AudioLowerVolume'},
    '66': {word: 'volmute', native: 'XF86AudioMute'},
    // The 123 key: the dock draws its own number pad. Without the launcher it goes back to Samsung as XF86More, the name its code 140
    // has in tizen_key_layout on 6.0, 6.5 and 9; XF86NumberPad (185) has no handler on 6.5 and 9, so 123 was dead there.
    '140': {word: 'pad', native: 'XF86More'},
    // Guide: Samsung's own guide also opens on this key, a moment after Vetro's own (the tuner reads the remote at the same time as
    // Samsung's TV app). Held back by the bridge it goes to the tuner when the tuner is on screen (key-routing.js keyCommand) and
    // back to Samsung by name when it is not, so Samsung's guide still opens from other apps. `tuner` marks the key's own route.
    '130': {word: 'guide', native: 'XF86ChannelGuide', tuner: true}
};
var GROUPS = {volume: ['66', '67', '68'], pad: ['140'], guide: ['130']};
var TOKENS = GROUPS.volume.concat(GROUPS.pad, GROUPS.guide);

function isVolumeCode(code) { return Object.prototype.hasOwnProperty.call(KEYS, String(code)); }

// The key the remote sent, sent again by name when the dock cannot be reached: only the four names of the table above. Going through
// control.js's list (the shortcuts' keys) left the 123 key dead whenever the dock was down.
var NATIVE = {};
Object.keys(KEYS).forEach(function (c) { NATIVE[KEYS[c].native] = true; });
function reinjectCommand(native) { return NATIVE[native] === true ? '/usr/bin/input_keyevent ' + native : null; }

// Tokens the bridge must hold back, beside the ones the shortcuts ask for (no duplicates).
// flags: {volume: bool, pad: bool, guide: bool}
function withTokens(tokens, flags) {
    var out = tokens.slice();
    Object.keys(GROUPS).forEach(function (g) {
        if (flags && flags[g]) GROUPS[g].forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    });
    return out;
}

function enabled(code, flags) {
    var c = String(code);
    return !!flags && Object.keys(GROUPS).some(function (g) { return flags[g] === true && GROUPS[g].indexOf(c) >= 0; });
}

// True when the event is a held-back volume key event the pill should handle: press, auto-repeat or release.
function wants(event, flags) {
    return !!event && event.decision === 'blocked' && (event.action === 'down' || event.action === 'repeat' || event.action === 'up') && enabled(event.code, flags);
}

// opts.write(path, text) -> throws on failure; opts.relay(word) -> Promise, the same word written by the root agent (rejects when
// the launcher does not read); opts.reinject(nativeKey) -> Promise; opts.route(how, errno) is told which way each key went;
// opts.state {refused} is kept between keys (the repeater gives one).
function handle(event, opts) {
    var key = KEYS[String(event.code)], note = opts.route || function () {}, state = opts.state || {}, err = state.refused ? state.errno || null : null;
    // Non-blocking open: a FIFO nobody reads fails at once (ENXIO) instead of freezing the service.
    var write = opts.write || function (p, t) {
        var fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        try { fs.writeSync(fd, t); } finally { fs.closeSync(fd); }
    };
    function native() { return Promise.resolve(opts.reinject(key.native)).then(function () { note('native', err); return 'native'; }); }
    // The Guide key: the service's own line decides between the tuner (on screen) and Samsung (by name); no FIFO of the launcher.
    if (key.tuner) {
        if (!opts.tuner) return native();
        return Promise.resolve(opts.tuner(key.native)).then(function () { note('tuner', null); return 'tuner'; }, native);
    }
    if (!state.refused) {
        try { write(opts.fifo || FIFO, key.word + '\n'); note('dock', null); return Promise.resolve('dock'); }
        catch (e) { err = e && /^E[A-Z0-9]{1,15}$/.test(e.code) ? e.code : 'EOTHER'; }
        // ENXIO: nobody reads the FIFO, the launcher is down. Anything else goes through the root agent (on the 2022+ exports no Vol or
        // 123 ever reached the launcher while the agent's words did; why is not known: EACCES under Smack, or ENOENT if the service sees
        // the path differently from root), whose own check gives the key back to Samsung when no launcher reads. EACCES / EPERM stick.
        if (err === 'ENXIO' || !opts.relay) return native();
        if (err === 'EACCES' || err === 'EPERM') { state.refused = true; state.errno = err; }
    }
    return Promise.resolve(opts.relay(key.word)).then(function () { note('agent', err); return 'agent'; }, native);
}

// The remote may send no auto-repeat for a held key (Bluetooth remotes often do not), so a press starts its own
// repeat: one step at once, then after DELAY_MS a step every INTERVAL_MS until the key is released (or MAX_MS passes,
// in case a release is lost). Auto-repeat events from the device are ignored while that timer runs.
var DELAY_MS = 380, INTERVAL_MS = 90, MAX_MS = 8000;

function repeater(opts) {
    var timer = null, started = 0, pending = false;
    if (!opts.state) opts.state = {refused: false};
    function stop() { if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; } }
    function send(event) { return handle(event, opts).catch(function () {}); }
    return {
        event: function (event) {
            if (event.action === 'up') { stop(); return Promise.resolve(); }
            // Mute, the 123 key and Guide are toggles: one press, one change, never repeated.
            if (String(event.code) === '66' || String(event.code) === '140' || String(event.code) === '130') return event.action === 'down' ? send(event) : Promise.resolve();
            if (event.action === 'repeat' && timer) return Promise.resolve();
            if (event.action === 'down') {
                stop(); started = Date.now();
                timer = setTimeout(function () {
                    timer = setInterval(function () {
                        if (Date.now() - started > MAX_MS) { stop(); return; }
                        // One step at a time: with the launcher down each step is a command for the root agent, and steps
                        // queued faster than they finish would fill its queue and keep everything else out.
                        if (pending) return;
                        pending = true;
                        send(event).then(function () { pending = false; });
                    }, INTERVAL_MS);
                    if (timer.unref) timer.unref();
                }, DELAY_MS);
                if (timer.unref) timer.unref();
            }
            return send(event);
        },
        stop: stop,
        active: function () { return !!timer; }
    };
}

module.exports = {enabled: enabled, repeater: repeater, KEYS: KEYS, TOKENS: TOKENS, FIFO: FIFO, isVolumeCode: isVolumeCode, withTokens: withTokens, wants: wants, handle: handle, reinjectCommand: reinjectCommand};
