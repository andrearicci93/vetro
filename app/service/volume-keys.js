'use strict';
// Vol+, Vol-, Mute and the 123 key on the real remote, handed to the dock's glass pill and number pad (each opt-in).
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
    '140': {word: 'pad', native: 'XF86More'}
};
var GROUPS = {volume: ['66', '67', '68'], pad: ['140']};
var BACK_HOLD_CODES = ['1', '158'];
var EXIT_HOLD_CODE = '174';
var TOKENS = GROUPS.volume.concat(GROUPS.pad);

function isVolumeCode(code) { return Object.prototype.hasOwnProperty.call(KEYS, String(code)); }

// The key the remote sent, sent again by name when the dock cannot be reached: only the four names of the table above. Going through
// control.js's list (the shortcuts' keys) left the 123 key dead whenever the dock was down.
var NATIVE = {};
Object.keys(KEYS).forEach(function (c) { NATIVE[KEYS[c].native] = true; });
NATIVE['XF86Back'] = true;
NATIVE['XF86Exit'] = true;
function reinjectCommand(native) { return NATIVE[native] === true ? '/usr/bin/input_keyevent ' + native : null; }

// Tokens the bridge must hold back, beside the ones the shortcuts ask for (no duplicates).
// flags: {volume: bool, pad: bool, backHold: bool}
function withTokens(tokens, flags) {
    var out = tokens.slice();
    Object.keys(GROUPS).forEach(function (g) {
        if (flags && flags[g]) GROUPS[g].forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    });
    if (flags && flags.backHold) {
        BACK_HOLD_CODES.forEach(function (c) {
            if (out.indexOf(c) < 0 && out.indexOf(c + ':hold') < 0) out.push(c + ':hold');
        });
        if (out.indexOf(EXIT_HOLD_CODE) < 0 && out.indexOf(EXIT_HOLD_CODE + ':hold') < 0) out.push(EXIT_HOLD_CODE);
    }
    return out;
}

function enabled(code, flags) {
    var c = String(code);
    return !!flags && Object.keys(GROUPS).some(function (g) { return flags[g] === true && GROUPS[g].indexOf(c) >= 0; });
}

// True when the event is a held-back volume/pad/back-hold key event the dock should handle.
function wants(event, flags) {
    if (!event || event.decision !== 'blocked') return false;
    if (flags && flags.backHold && BACK_HOLD_CODES.indexOf(String(event.code)) >= 0) {
        return event.action === 'hold' || event.action === 'up';
    }
    if (flags && flags.backHold && String(event.code) === EXIT_HOLD_CODE) {
        return event.action === 'down' || event.action === 'repeat' || event.action === 'up';
    }
    return (event.action === 'down' || event.action === 'repeat' || event.action === 'up') && enabled(event.code, flags);
}

// opts.write(path, text) -> throws on failure; opts.relay(word) -> Promise, the same word written by the root agent (rejects when
// the launcher does not read); opts.reinject(nativeKey) -> Promise; opts.route(how, errno) is told which way each key went;
// opts.state {refused} is kept between keys (the repeater gives one).
function sendWord(word, nativeKey, opts) {
    var note = opts.route || function () {}, state = opts.state || {}, err = state.refused ? state.errno || null : null;
    // Non-blocking open: a FIFO nobody reads fails at once (ENXIO) instead of freezing the service.
    var write = opts.write || function (p, t) {
        var fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        try { fs.writeSync(fd, t); } finally { fs.closeSync(fd); }
    };
    function native() {
        if (!nativeKey) return Promise.resolve('native');
        return Promise.resolve(opts.reinject(nativeKey)).then(function () { note('native', err); return 'native'; });
    }
    if (!state.refused) {
        try { write(opts.fifo || FIFO, word + '\n'); note('dock', null); return Promise.resolve('dock'); }
        catch (e) { err = e && /^E[A-Z0-9]{1,15}$/.test(e.code) ? e.code : 'EOTHER'; }
        // ENXIO: nobody reads the FIFO, the launcher is down. Anything else goes through the root agent (on the 2022+ exports no Vol or
        // 123 ever reached the launcher while the agent's words did; why is not known: EACCES under Smack, or ENOENT if the service sees
        // the path differently from root), whose own check gives the key back to Samsung when no launcher reads. EACCES / EPERM stick.
        if (err === 'ENXIO' || !opts.relay) return native();
        if (err === 'EACCES' || err === 'EPERM') { state.refused = true; state.errno = err; }
    }
    return Promise.resolve(opts.relay(word)).then(function () { note('agent', err); return 'agent'; }, native);
}

function handle(event, opts) {
    var key = KEYS[String(event.code)];
    return sendWord(key.word, key.native, opts);
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
        event: function (event, flags) {
            var code = String(event.code);
            if (flags && flags.backHold && BACK_HOLD_CODES.indexOf(code) >= 0) {
                if (event.action === 'hold') return sendWord('backhold', 'XF86Back', opts).catch(function () {});
                if (event.action === 'up') return Promise.resolve();
                return Promise.resolve();
            }
            if (flags && flags.backHold && code === EXIT_HOLD_CODE) {
                if (event.action === 'down') return sendWord('backhold', 'XF86Exit', opts).catch(function () {});
                return Promise.resolve();
            }
            if (event.action === 'up') { stop(); return Promise.resolve(); }
            // Mute and the 123 key are toggles: one press, one change, never repeated.
            if (code === '66' || code === '140') return event.action === 'down' ? send(event) : Promise.resolve();
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

module.exports = {enabled: enabled, repeater: repeater, KEYS: KEYS, TOKENS: TOKENS, BACK_HOLD_CODES: BACK_HOLD_CODES, EXIT_HOLD_CODE: EXIT_HOLD_CODE, FIFO: FIFO, isVolumeCode: isVolumeCode, withTokens: withTokens, wants: wants, sendWord: sendWord, handle: handle, reinjectCommand: reinjectCommand};
