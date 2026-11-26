'use strict';
// A Remapper rule's condition, "only when the screen is on / off". It is one more entry at the end of the rule's action list (type "when"),
// not a field of the rule: an older Vetro does not know the type and refuses the rule set, where a field would be dropped and the rule would
// run whenever its trigger came. The TV's power state (memory/pm/state: 1 on, 3 Picture Off) is read once, when a conditioned rule is
// matched, and never for rules without one; a TV that cannot be read runs no conditioned rule.
const assert = require('assert').strict;
const path = require('path');
const loadService = require('./service-harness.cjs');
const remap = require('../service/remap.js');
const tvState = require('../service/tv-state.js');
const control = require('../service/control.js');
const backup = require('../service/settings-backup.js');

// --- validation ---
const off = {id: 'a', trigger: {type: 'http', value: 'go'}, actions: [{type: 'screenoff'}, {type: 'when', screen: 'on'}]};
assert.deepEqual(remap.validateRules([off])[0].actions, [{type: 'screenoff'}, {type: 'when', screen: 'on'}]);
// the condition goes last wherever it was written, so the first action is still what the rule does
assert.deepEqual(remap.validateRules([{id: 'b', trigger: {type: 'http', value: 'go'}, actions: [{type: 'when', screen: 'off'}, {type: 'key', key: 'KEY_MUTE'}]}])[0].actions,
    [{type: 'key', key: 'KEY_MUTE'}, {type: 'when', screen: 'off'}]);
for (const bad of [{type: 'when'}, {type: 'when', screen: 'standby'}, {type: 'when', screen: 1}]) {
    assert.throws(() => remap.validateRules([{id: 'c', trigger: {type: 'http', value: 'go'}, actions: [{type: 'screenoff'}, bad]}]), /condition|unknown/, JSON.stringify(bad));
}
assert.throws(() => remap.validateRules([{id: 'd', trigger: {type: 'http', value: 'go'}, actions: [{type: 'when', screen: 'on'}]}]), /no action/, 'a condition alone');
assert.throws(() => remap.validateRules([{id: 'e', trigger: {type: 'http', value: 'go'}, actions: [{type: 'screenoff'}, {type: 'when', screen: 'on'}, {type: 'when', screen: 'off'}]}]), /more than one/);
const rules = remap.validateRules([off, {id: 'p', trigger: {type: 'http', value: 'go'}, actions: [{type: 'key', key: 'KEY_MUTE'}]}]);
assert.equal(remap.guardOf(rules[0]), 'on'); assert.equal(remap.guardOf(rules[1]), null);
assert.deepEqual(remap.actionsOf(rules[0]), [{type: 'screenoff'}]);
assert.deepEqual(remap.resolve(rules, 'http', 'go'), [{type: 'key', key: 'KEY_MUTE'}], 'resolve never hands out a conditioned rule unguarded');
assert.equal(remap.matches(rules, 'http', 'go').length, 2);

// --- on disk: conditioned rules stay out of "rules", so a Vetro from before the condition keeps the plain ones (all or nothing validation) ---
const OLD_ACTIONS = ['key', 'launch', 'screenoff', 'mqtt'];   // what 0.7.1's validateAction knows
const split = remap.toDisk(rules);
assert.equal(split.rules.length, 1); assert.equal(split.guarded.length, 1);
assert.ok(split.rules.every(r => r.actions.every(a => OLD_ACTIONS.includes(a.type))), 'nothing in "rules" an older Vetro would refuse');
assert.deepEqual(remap.fromDisk({rules: split.rules, guarded: split.guarded, input: {auto: true}}).map(r => r.id).sort(), ['a', 'p'], 'read back together');
assert.deepEqual(remap.fromDisk({rules: split.rules}), split.rules, 'a file from before the condition');
assert.deepEqual(remap.fromDisk({}), []);
assert.deepEqual(remap.fromDisk({rules: split.rules, guarded: [{id: 'z', trigger: {type: 'http', value: 'x'}, actions: [{type: 'when', screen: 'maybe'}]}]}), split.rules, 'a damaged guarded part loses only the conditioned rules');
assert.deepEqual(remap.fromDisk({rules: [{id: 'bad'}], guarded: split.guarded}), [], 'damaged plain rules: same as before (empty)');
// a rule that came back through a rollback and an upgrade (the old version saved the file again with the key it did not know) is not doubled
assert.deepEqual(remap.fromDisk({rules: split.rules.concat(split.guarded), guarded: split.guarded}).map(r => r.id).sort(), ['a', 'p']);

// --- the power state ---
assert.match(tvState.POWER_READ, /buxton2ctl get memory memory\/pm\/state/);
assert.doesNotMatch(tvState.POWER_READ, /dotnet/);

// --- the Settings file keeps it, an old file without it still loads ---
const src = {dock: null, tuner: null, rules, wins: null};
const file = backup.parse(JSON.stringify(backup.build(src)));
assert.deepEqual(remap.validateRules(file.sections.remapper.rules), rules, 'saved and read back with its condition');
const old = [{id: 'x', enabled: true, trigger: {type: 'http', value: 'go'}, actions: [{type: 'screenoff'}]}];
assert.deepEqual(remap.validateRules(backup.parse(JSON.stringify(backup.build(Object.assign({}, src, {rules: old})))).sections.remapper.rules), old, 'a file from before the condition');

// --- at run time ---
const {context} = loadService(path.resolve(__dirname, '..'), {listen: false, setInterval: () => 1});
const commands = [], json = (v) => JSON.parse(JSON.stringify(v));   // arrays made inside the service's context have another prototype

let power = '[memory] memory/pm/state = Int32: 1\n', readFails = false;
context.agentExecute = async (command) => {
    if (command === tvState.POWER_READ) {
        commands.push('read');
        if (readFails instanceof Error) throw readFails;
        return readFails ? {exit_code: 0, stdout: ''} : {exit_code: 0, stdout: power};
    }
    commands.push(command === control.SCREEN_OFF_COMMAND ? 'screenoff' : command);
    return {exit_code: 0, stdout: 'i 0\n'};
};
const ruleSet = (guard, extra) => remap.validateRules([{id: 'r', trigger: {type: 'physical', value: '116'}, actions: [{type: 'screenoff'}].concat(guard ? [{type: 'when', screen: guard}] : [])}].concat(extra || []));
async function press() { context.physical.onEvent({code: 116, action: 'down', decision: 'blocked'}); await context.actionQueue; }
(async () => {
    context.inputLifecycleActive = true;

    // no condition: no extra read, nothing changes
    context.remapStore.rules = ruleSet(null);
    await press();
    assert.deepEqual(commands.splice(0), ['screenoff'], 'a rule without a condition reads nothing');
    assert.equal(context.screenGuardRun, null);

    // only when the screen is on
    context.remapStore.rules = ruleSet('on');
    await press();
    assert.deepEqual(commands.splice(0), ['read', 'screenoff']);
    assert.equal(context.screenGuardRun.result, 'met');
    power = '[memory] memory/pm/state = Int32: 3\n';
    await press();
    assert.deepEqual(commands.splice(0), ['read'], 'Picture Off: an "on" rule does not run');
    assert.equal(context.screenGuardRun.result, 'notMet');
    assert.equal(context.inputError, null, 'a condition that is not met is not an input fault');

    // only when the screen is off (the keys that leave Picture Off: volume, mute, power)
    context.remapStore.rules = ruleSet('off');
    await press();
    assert.deepEqual(commands.splice(0), ['read', 'screenoff']);
    power = '[memory] memory/pm/state = Int32: 1\n';
    await press();
    assert.deepEqual(commands.splice(0), ['read']);

    // a state that cannot be read runs no conditioned rule, but the rules without one still run
    readFails = true;
    context.remapStore.rules = ruleSet('on', [{id: 'plain', trigger: {type: 'physical', value: '116'}, actions: [{type: 'key', key: 'KEY_MUTE'}]}]);
    const plain = await context.guardedActions(remap.matches(context.remapStore.rules, 'physical', '116'));
    assert.deepEqual(json(plain), [{type: 'key', key: 'KEY_MUTE'}]);
    assert.equal(context.screenGuardRun.result, 'unreadable');
    readFails = new Error('agent down');
    assert.deepEqual(json(await context.guardedActions(remap.matches(context.remapStore.rules, 'physical', '116'))), [{type: 'key', key: 'KEY_MUTE'}], 'no root agent: nothing thrown');
    commands.length = 0;

    // the HTTP run answers the same way
    readFails = false; power = '[memory] memory/pm/state = Int32: 3\n';
    context.remapStore.rules = remap.validateRules([{id: 'h', trigger: {type: 'http', value: 'night'}, actions: [{type: 'screenoff'}, {type: 'when', screen: 'on'}]}]);
    const skipped = await context.guardedActions(remap.matches(context.remapStore.rules, 'http', 'night'));
    assert.deepEqual(json(skipped), []);
    console.log('PASS remapper screen condition: validated and kept last, never run unguarded, read once only for conditioned rules, unreadable state runs none, Settings file round trip, diagnostics');
})().catch(e => { console.error(e); process.exitCode = 1; });
