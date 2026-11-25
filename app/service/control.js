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
    // direct input selection (XF86DiscretHDMI3 verified on the Q80A)
    'XF86DiscretHDMI1', 'XF86DiscretHDMI2', 'XF86DiscretHDMI3', 'XF86DiscretHDMI4',
    // digits (standard X keysyms)
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    // playback
    'XF86AudioPlay', 'XF86AudioPause', 'XF86AudioStop',
    // the remote's single Play/Pause key (code 244; web apps read it as MediaPlayPause)
    'XF86PlayBack',
    'XF86AudioNext', 'XF86AudioPrev', 'XF86AudioRewind', 'XF86AudioForward'
];

var KEY_SET = {};
KEYS.forEach(function (k) { KEY_SET[k] = true; });

// DisplayPort has no key of its own: it is asked of tv-viewer, with the extras the launcher sends for an input tile (dock Program.cs
// SwitchSource; 33 is a Samsung monitor's DisplayPort, #215). On a TV without one tv-viewer stays where it is. No dotnet process.
var DISPLAYPORT = 'SourceDisplayPort';
var DISPLAYPORT_COMMAND = '/usr/bin/app_launcher -s org.tizen.tv-viewer change_source 33 sourceType 33 sourceName DisplayPort ' +
    'sourceIcon /usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/r_icon_device_s_dpport.png ' +
    'mbrIndex -2 __K_EX_LAUNCH_REQUESTOR user';

function injectCommand(key) {
    if (key === DISPLAYPORT) return DISPLAYPORT_COMMAND;
    if (!KEY_SET[key]) return null;
    return '/usr/bin/input_keyevent ' + key;
}

// The Remapper's "Turn off screen": Samsung's Picture Off, a deviced display state (lcdoff); the sound plays on. The same line the launcher's
// Audio card runs (dock Program.cs). Fixed text, never built from a rule; it never says standby or suspend. deviced answers "i 0" when it took it.
var SCREEN_OFF_COMMAND = 'busctl --timeout=3 call org.tizen.system.deviced /Org/Tizen/System/DeviceD/Display org.tizen.system.deviced.display ChangeState s lcdoff';

var LAN_KEYS = {KEY_POWER:'XF86PowerOff',KEY_DISPLAYPORT:DISPLAYPORT,KEY_TV:'XF86DiscretSourceTV',KEY_HDMI1:'XF86DiscretHDMI1',KEY_HDMI2:'XF86DiscretHDMI2',KEY_HDMI3:'XF86DiscretHDMI3',KEY_HDMI4:'XF86DiscretHDMI4',KEY_HOME:'XF86Home',KEY_RETURN:'XF86Back',KEY_EXIT:'XF86Exit',KEY_UP:'Up',KEY_DOWN:'Down',KEY_LEFT:'Left',KEY_RIGHT:'Right',KEY_ENTER:'Return',KEY_VOLUP:'XF86AudioRaiseVolume',KEY_VOLUMEUP:'XF86AudioRaiseVolume',KEY_VOLDOWN:'XF86AudioLowerVolume',KEY_VOLUMEDOWN:'XF86AudioLowerVolume',KEY_MUTE:'XF86AudioMute',KEY_PLAY:'XF86AudioPlay',KEY_PAUSE:'XF86AudioPause',KEY_STOP:'XF86AudioStop',KEY_PLAYPAUSE:'XF86PlayBack',KEY_REWIND:'XF86AudioRewind',KEY_FF:'XF86AudioForward'};
function nativeKey(key) {return KEY_SET[key] ? key : LAN_KEYS[key] || null;}
module.exports = { nativeKey:nativeKey, KEYS: KEYS, injectCommand: injectCommand, SCREEN_OFF_COMMAND: SCREEN_OFF_COMMAND };
