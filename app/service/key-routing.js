'use strict';
// Where a key the service sends ends up, now that Vetro UI has windows of its own on the TV. Pure: every function returns a shell
// line for the root agent, nothing runs here.
//
//   * A key sent by name (/usr/bin/input_keyevent, a Remapper shortcut) goes to the window that has the keyboard focus. With Vetro TV
//     Tuner on screen that is the tuner's own window, which does not take named keys (it reads the remote from the input device): the
//     key would be lost. So a key the tuner answers goes to it on its control pipe (`key CODE`), and Home or Menu first send it away,
//     as the real keys do. Nothing changes while the tuner is not on screen.
//   * The remote bridge makes a new forwarding node every time it starts. The launcher and the tuner look for new nodes every 3 s; for
//     those seconds they heard nothing (the real remote is held by the bridge). `rescanCommand` tells both to look at once.
//
// The paths are the ones dock.js and tuner.js start the two processes with. A pipe is written only when its process is alive (pid) and
// the path really is a pipe (a missing one would be created as a plain file), and through a read-write descriptor (`exec 3<>`), which
// never blocks even if the reader died a moment ago: these lines run on the root agent, and a write stuck on a pipe would hold up its
// queue until the timeout (the TV has no `timeout` command).

var DOCK_PID = '/home/owner/tvlauncher.pid', DOCK_FIFO = '/home/owner/tvlauncher.fifo';
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

// The shell line for a Remapper key action. inject: the line that sends the key by name (control.injectCommand), already checked.
function keyCommand(nativeKey, inject) {
    if (!inject) return null;
    var word = Object.prototype.hasOwnProperty.call(TUNER_KEYS, nativeKey) ? TUNER_KEYS[nativeKey] : null;
    var shown = alive(TUNER_PID, TUNER_PIPE) + ' && [ -e ' + TUNER_SHOWN + ' ]';
    if (word) return 'if ' + shown + '; then ' + write(TUNER_PIPE, word) + '; else ' + inject + '; fi';
    if (TUNER_STEPS_ASIDE[nativeKey]) return 'if ' + shown + '; then ' + write(TUNER_PIPE, 'hide') + '; fi; ' + inject;
    return inject;
}

// The shell line that asks the launcher and the tuner to look for input nodes now.
function rescanCommand() {
    return [[DOCK_PID, DOCK_FIFO], [TUNER_PID, TUNER_PIPE]].map(function (x) {
        return 'if ' + alive(x[0], x[1]) + '; then ' + write(x[1], 'rescan') + '; fi';
    }).join('; ') + '; true';
}

module.exports = {keyCommand: keyCommand, rescanCommand: rescanCommand, TUNER_KEYS: TUNER_KEYS, TUNER_PIPE: TUNER_PIPE, DOCK_FIFO: DOCK_FIFO};
