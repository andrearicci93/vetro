'use strict';
// Where a key the service sends ends up, now that Vetro UI has windows of its own on the TV. Pure: every function returns a shell
// line for the root agent, nothing runs here.
//
//   * A key sent by name (/usr/bin/input_keyevent, a Remapper shortcut) goes to the window that has the keyboard focus. With Vetro TV
//     Tuner on screen that is the tuner's own window, which does not take named keys (it reads the remote from the input device): the
//     key would be lost. So a key the tuner answers goes to it on its control pipe (`key CODE`), and Home or Menu first send it away,
//     as the real keys do. Nothing changes while the tuner is not on screen.
//   * Home sent by name while the Vetro launcher holds the key (its claim, #184) reaches the launcher's window, not Samsung's Home:
//     it goes down the launcher's FIFO as `toggle` instead, which opens or closes the dock as the remote's Home does. The launcher
//     writes its pid to tvlauncher.homeclaim while the compositor grants the claim; without that (custom launcher, a refused claim, no
//     launcher) Home is sent by name as before.
//   * The remote bridge makes a new forwarding node every time it starts. The launcher and the tuner look for new nodes every 3 s; for
//     those seconds they heard nothing (the real remote is held by the bridge). `rescanCommand` tells both to look at once.
//
// The paths are the ones dock.js and tuner.js start the two processes with. A pipe is written only when its process is alive (pid) and
// the path really is a pipe (a missing one would be created as a plain file), and through a read-write descriptor (`exec 3<>`), which
// never blocks even if the reader died a moment ago: these lines run on the root agent, and a write stuck on a pipe would hold up its
// queue until the timeout (the TV has no `timeout` command).

var DOCK_PID = '/home/owner/tvlauncher.pid', DOCK_FIFO = '/home/owner/tvlauncher.fifo', DOCK_CLAIM = '/home/owner/tvlauncher.homeclaim';
var TUNER_PID = '/home/owner/vetro-tuner.pid', TUNER_PIPE = '/tmp/vetro-tuner.ctl';
var TUNER_SHOWN = TUNER_PIPE + '.shown';

// Named keys (control.js KEYS) and what the tuner does with them: the evdev code it reads for the same key on the remote, or a pipe word.
var TUNER_KEYS = {
    Up: 'key 103', Down: 'key 108', Left: 'key 105', Right: 'key 106', Return: 'key 28',
    XF86Back: 'key 1', XF86Exit: 'key 174', XF86Info: 'key 358', XF86ChannelGuide: 'key 365', XF86ChannelList: 'list', XF86PlayBack: 'key 244',
    '1': 'key 2', '2': 'key 3', '3': 'key 4', '4': 'key 5', '5': 'key 6', '6': 'key 7', '7': 'key 8', '8': 'key 9', '9': 'key 10', '0': 'key 11'
};
// Keys that send the tuner away on the real remote (its SystemKeys): it steps aside first, then the key goes to the system as before.
var TUNER_STEPS_ASIDE = {XF86Home: true, XF86Menu: true};

function alive(pidFile, pipe) {
    return 'p=$(cat ' + pidFile + ' 2>/dev/null); [ -n "$p" ] && [ -d /proc/$p ] && [ -p ' + pipe + ' ]';
}
function write(pipe, word) { return '( exec 3<>' + pipe + ' && echo \'' + word + '\' >&3 )'; }

// Volume keys sent by name and the launcher word that does the same (volume-keys.js): with the glass volume pill on, the launcher owns volume.
var VOLUME_WORDS = {XF86AudioRaiseVolume: 'volup', XF86AudioLowerVolume: 'voldown', XF86AudioMute: 'volmute'};

// The shell line for a key sent by name: the Remapper's Send key action and the /control endpoint (the app, Home Assistant, a script).
// inject: the line that sends the key by name (control.injectCommand), already checked.
// flags (optional, main.js keyFlags()): volume true = the launcher's volume pill is on, so Vol and Mute go to it as words, like the physical
// keys do, and by name only when the launcher is not reading its FIFO. Named volume keys alone would change the volume without the pill.
function keyCommand(nativeKey, inject, flags) {
    if (!inject) return null;
    if (flags && flags.volume && Object.prototype.hasOwnProperty.call(VOLUME_WORDS, nativeKey)) return '( ' + dockWordCommand(VOLUME_WORDS[nativeKey]) + ' ) || { ' + inject + '; }';
    var word = Object.prototype.hasOwnProperty.call(TUNER_KEYS, nativeKey) ? TUNER_KEYS[nativeKey] : null;
    var shown = alive(TUNER_PID, TUNER_PIPE) + ' && [ -e ' + TUNER_SHOWN + ' ]';
    if (word) return 'if ' + shown + '; then ' + write(TUNER_PIPE, word) + '; else ' + inject + '; fi';
    if (nativeKey === 'XF86Home') inject = homeCommand(inject);
    if (TUNER_STEPS_ASIDE[nativeKey]) return 'if ' + shown + '; then ' + write(TUNER_PIPE, 'hide') + '; fi; ' + inject;
    return inject;
}

// Home by name: down the launcher's FIFO while the launcher that is running holds the key, by name otherwise.
function homeCommand(inject) {
    return 'if ' + alive(DOCK_PID, DOCK_FIFO) + ' && [ "$(cat ' + DOCK_CLAIM + ' 2>/dev/null)" = "$p" ]; then ' + write(DOCK_FIFO, 'toggle') + '; else ' + inject + '; fi';
}

// The shell line that asks the launcher and the tuner to look for input nodes now.
function rescanCommand() {
    return [[DOCK_PID, DOCK_FIFO], [TUNER_PID, TUNER_PIPE]].map(function (x) {
        return 'if ' + alive(x[0], x[1]) + '; then ' + write(x[1], 'rescan') + '; fi';
    }).join('; ') + '; true';
}

// The shell line that hands the launcher one of the volume-keys.js words (volup, voldown, volmute, pad) when the service may not open
// its FIFO itself: exits non-zero when the launcher is not there to read it, so the key goes back to Samsung instead.
function dockWordCommand(word) {
    return /^(?:volup|voldown|volmute|pad)$/.test(word) ? alive(DOCK_PID, DOCK_FIFO) + ' && ' + write(DOCK_FIFO, word) : null;
}

// "Go to channel N" (MQTT channel/set). Vetro's tuner when it is running with Samsung's live TV on screen (the same test as the 123 pad: its
// `.tv` flag): one `tune` word, it shows itself and goes there at once. Otherwise the digits by name, which make Samsung's own TV app open
// and tune (the 123 pad does the same when the tuner is not there). number: digits only, checked by channelNumber; inject: control.injectCommand.
function channelNumber(payload) {
    var t = String(payload == null ? '' : payload).trim();
    if (/^\d{1,4}$/.test(t) && +t > 0) return String(+t);
    var m = /^\{\s*"channel"\s*:\s*"?(\d{1,4})"?\s*\}$/.exec(t);   // {"channel": 31}, what a Home Assistant template can send
    return m && +m[1] > 0 ? String(+m[1]) : null;
}
function channelCommand(number, inject) {
    if (!/^[1-9]\d{0,3}$/.test(number)) return null;
    var keys = number.split('').map(function (d) { return inject(d); });
    if (keys.some(function (k) { return !k; })) return null;
    return 'if ' + alive(TUNER_PID, TUNER_PIPE) + ' && [ -e ' + TUNER_PIPE + '.tv ]; then ' + write(TUNER_PIPE, 'tune ' + number) + '; else ' + keys.join('; ') + '; fi';
}

module.exports = {channelNumber: channelNumber, channelCommand: channelCommand, keyCommand: keyCommand, homeCommand: homeCommand, rescanCommand: rescanCommand, dockWordCommand: dockWordCommand, TUNER_KEYS: TUNER_KEYS, TUNER_PIPE: TUNER_PIPE,
    DOCK_FIFO: DOCK_FIFO, DOCK_CLAIM: DOCK_CLAIM};
