'use strict';

// Remote control for Vetro: key injection through /usr/bin/input_keyevent
// on the Q80A. The tool forwards the key NAME to
// enlightenment over D-Bus (org.enlightenment.wm Test.EventKey), so keys are
// X keysyms — XF86* names from the TV keyrouter config plus standard X
// keysyms for navigation and digits. KEY_* input-code names are silently
// ignored by the TV.

var KEYS = [
    // volume & mute
    'XF86AudioRaiseVolume', 'XF86AudioLowerVolume', 'XF86AudioMute',
    // power
    'XF86PowerOff',
    // navigation (standard X keysyms)
    'Up', 'Down', 'Left', 'Right', 'Return',
    // TV keys (keyrouter names)
    'XF86Back', 'XF86Home', 'XF86Menu', 'XF86Info', 'XF86Exit',
    // channels / guide
    'XF86ChannelList', 'XF86ChannelGuide', 'XF86DiscretSourceTV',
    // digits (standard X keysyms)
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    // playback
    'XF86AudioPlay', 'XF86AudioPause', 'XF86AudioStop',
    'XF86AudioNext', 'XF86AudioPrev', 'XF86AudioRewind', 'XF86AudioForward'
];

var KEY_SET = {};
KEYS.forEach(function (k) { KEY_SET[k] = true; });

function injectCommand(key) {
    if (!KEY_SET[key]) return null;
    return '/usr/bin/input_keyevent ' + key;
}

var LAN_KEYS = {KEY_TV:'XF86DiscretSourceTV',KEY_HOME:'XF86Home',KEY_RETURN:'XF86Back',KEY_EXIT:'XF86Exit',KEY_UP:'Up',KEY_DOWN:'Down',KEY_LEFT:'Left',KEY_RIGHT:'Right',KEY_ENTER:'Return',KEY_VOLUP:'XF86AudioRaiseVolume',KEY_VOLUMEUP:'XF86AudioRaiseVolume',KEY_VOLDOWN:'XF86AudioLowerVolume',KEY_VOLUMEDOWN:'XF86AudioLowerVolume',KEY_MUTE:'XF86AudioMute',KEY_PLAY:'XF86AudioPlay',KEY_PAUSE:'XF86AudioPause',KEY_STOP:'XF86AudioStop'};
function nativeKey(key) {return KEY_SET[key] ? key : LAN_KEYS[key] || null;}
module.exports = { nativeKey:nativeKey, KEYS: KEYS, injectCommand: injectCommand };
