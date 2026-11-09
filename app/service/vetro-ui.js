'use strict';
// Vetro UI: the launcher, the live TV tuner and the on-screen displays (glass volume bar, glass number pad) as one set of parts.
// Pure rules, shared by the service (GET /remap lists the keys Vetro UI holds) and the dashboard page (the functions are
// inlined into the page with toString(), so they are plain ES5, with no template strings).
//
// What depends on what (read from the code, see app/docs/VETRO-UI.md):
//   * the glass volume bar and the glass number pad are drawn by the launcher process: it runs when the Vetro launcher is on,
//     and, headless, when another app is the launcher (custom mode). With the launcher off they are saved but do nothing;
//   * both need the remote interception (the Remapper's input bridge): it holds Vol+, Vol-, Mute and 123 back from Samsung and
//     hands them to the launcher. Vetro UI turns the interception on by itself when one of them is switched on;
//   * a shortcut of the user's own on one of those keys is overridden while the part that holds the key is on: Vetro UI's
//     keys come first (the service handles them before the shortcuts);
//   * the Vetro launcher and a custom launcher are one choice: the Home key opens one or the other, never both;
//   * the task manager (Down on the apps row) is part of the Vetro launcher: nothing of the dock is drawn in custom mode;
//   * the tuner stands alone. The number pad's Done tunes it when it runs, and its Info key opens the tuner's info panel.

var UI_RESERVED = [
    {code: '68', label: 'Vol +', owner: 'volume', name: 'Glass volume bar'},
    {code: '67', label: 'Vol −', owner: 'volume', name: 'Glass volume bar'},
    {code: '66', label: 'Mute', owner: 'volume', name: 'Glass volume bar'},
    {code: '140', label: '123', owner: 'pad', name: 'Glass number pad'}
];

// The keys Vetro TV Tuner answers (evdev codes of the remote, tuner/src/Program.cs). The remote bridge does not pass on a key that a
// shortcut of the user's holds, and the tuner reads the bridge's copy of the remote: such a key never reaches the tuner.
// The keys the launcher's task manager needs (Down opens it from the apps row, OK opens or, held, closes an app). A shortcut of the
// user's on one of them is held back by the remote bridge, so the launcher never gets it.
var UI_TASK_KEYS = [{code: '108', label: 'Down'}, {code: '28', label: 'OK'}];

var UI_TUNER_KEYS = [
    {code: '88', label: 'CH +'}, {code: '87', label: 'CH \u2212'}, {code: '402', label: 'CH +'}, {code: '403', label: 'CH \u2212'},
    {code: '28', label: 'OK'}, {code: '103', label: 'Up'}, {code: '108', label: 'Down'}, {code: '105', label: 'Left'}, {code: '106', label: 'Right'},
    {code: '358', label: 'Info'}, {code: '365', label: 'Guide'}, {code: '362', label: 'Guide'}, {code: '1', label: 'Back'}, {code: '158', label: 'Back'}
];

// 'off' (Samsung's Home answers the Home key), 'vetro' or 'custom'. Older states have no mode, only enabled.
function uiLauncherMode(d) {
    if (!d) return 'off';
    if (d.mode === 'vetro' || d.mode === 'custom' || d.mode === 'off') return d.mode;
    return d.customApp ? 'custom' : d.enabled ? 'vetro' : 'off';
}

// The keys Vetro UI holds now: one row per key of a part that is switched on. live is false while the launcher process,
// which draws the part, is off (the key is then left to Samsung).
function uiReservedKeys(d) {
    var live = uiLauncherMode(d) !== 'off', out = [];
    for (var i = 0; i < UI_RESERVED.length; i++) {
        var k = UI_RESERVED[i], on = !!d && (k.owner === 'volume' ? d.volumePill === true : d.numberPad === true);
        if (on) out.push({code: k.code, label: k.label, owner: k.owner, name: k.name, live: live});
    }
    return out;
}

// The keys of one part ('volume' or 'pad'), whether it is on or not: what switching it on would take.
function uiKeysOf(owner) {
    var out = [];
    for (var i = 0; i < UI_RESERVED.length; i++) if (UI_RESERVED[i].owner === owner) out.push(UI_RESERVED[i]);
    return out;
}

// The user's shortcuts on the given keys (a list from uiReservedKeys or uiKeysOf): enabled physical rules only.
function uiConflicts(rules, keys) {
    var codes = {}, out = [];
    for (var i = 0; i < (keys || []).length; i++) codes[keys[i].code] = keys[i];
    (rules || []).forEach(function (r) {
        var k = r && r.enabled && r.trigger && r.trigger.type === 'physical' ? codes[String(r.trigger.value)] : null;
        if (k) out.push({code: k.code, label: k.label, owner: k.owner, name: k.name, rule: r});
    });
    return out;
}

// What a part still needs before it works, as short reasons (empty when nothing is missing).
// input: the GET /input answer ({status: {policy: {connected}, preference: {enabled}}}) or null when not read yet.
function uiNeeds(part, d, input) {
    var needs = [], mode = uiLauncherMode(d);
    if (part === 'volume' || part === 'pad') {
        if (mode === 'off') needs.push('launcher');
        var st = input && input.status, pref = st && st.preference;
        if (input && !(pref && pref.enabled === true)) needs.push('interception');
        else if (st && st.policy && st.policy.mode === 'observe') needs.push('listening');
    }
    return needs;
}

// The keys that a part switched on but waiting for a launcher would start to hold once the launcher has this mode.
function uiKeysWhen(d, mode) {
    var next = {}, k;
    for (k in d || {}) if (Object.prototype.hasOwnProperty.call(d, k)) next[k] = d[k];
    next.mode = mode; next.enabled = mode === 'vetro'; if (mode !== 'custom') next.customApp = null;
    var now = uiReservedKeys(d), later = uiReservedKeys(next), out = [];
    for (var i = 0; i < later.length; i++) {
        var was = false;
        for (var j = 0; j < now.length; j++) if (now[j].code === later[i].code && now[j].live) was = true;
        if (later[i].live && !was) out.push(later[i]);
    }
    return out;
}

var FUNCTIONS = [uiLauncherMode, uiReservedKeys, uiKeysOf, uiConflicts, uiNeeds, uiKeysWhen];

// The page's copy of the rules: the list and the functions, ready to drop into its script.
function pageSource() {
    return 'var UI_RESERVED=' + JSON.stringify(UI_RESERVED) + ',UI_TUNER_KEYS=' + JSON.stringify(UI_TUNER_KEYS) + ',UI_TASK_KEYS=' + JSON.stringify(UI_TASK_KEYS) + ';\n' + FUNCTIONS.map(function (f) { return f.toString(); }).join('\n');
}

module.exports = {UI_RESERVED: UI_RESERVED, UI_TUNER_KEYS: UI_TUNER_KEYS, UI_TASK_KEYS: UI_TASK_KEYS, keysWhen: uiKeysWhen, launcherMode: uiLauncherMode, reservedKeys: uiReservedKeys, keysOf: uiKeysOf, conflicts: uiConflicts, needs: uiNeeds, pageSource: pageSource};
