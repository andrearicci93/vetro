'use strict';
// The Remapper's "Turn off screen" (Picture Off, the sound stays on): a shortcut runs the fixed deviced line as root, counts as done only
// when deviced answers "i 0", never turns a refusal into an input fault (that would give the remote back to Samsung for a minute), and
// the diagnostics get the number of such rules and how the last one ended. Only the TV execution boundary is replaced.
const assert = require('assert').strict;
const path = require('path');
const loadService = require('./service-harness.cjs');
const remap = require('../service/remap.js');
const control = require('../service/control.js');
const {context} = loadService(path.resolve(__dirname, '..'), {listen:false,setInterval:()=>1});

const commands = [];
let answer = {exit_code:0,stdout:'i 0\n'};
context.agentExecute = async (command, _timeout, guard) => {
    if (guard && !guard()) throw Error('Input action cancelled');
    commands.push(command);
    if (answer instanceof Error) throw answer;
    return answer;
};
async function press(code) {
    context.physical.onEvent({code,action:'down',decision:'blocked'});
    await context.actionQueue;
}
(async () => {
    context.remapStore.rules = remap.validateRules([
        {id:'off',trigger:{type:'physical',value:'116'},actions:[{type:'screenoff'}]},
        {id:'off-http',enabled:false,trigger:{type:'http',value:'night'},actions:[{type:'screenoff'}]}]);
    context.inputLifecycleActive = true;

    await press(116);
    assert.deepEqual(commands, [control.SCREEN_OFF_COMMAND], 'the key runs the one fixed line');
    assert.match(commands[0], /ChangeState s lcdoff$/);
    assert.doesNotMatch(commands[0], /standby|suspend|lcdon/);
    assert.equal(context.screenOffRun.result, 'ok');

    // A refusal (an answer other than "i 0") is not an input fault: the interception stays on.
    answer = {exit_code:0,stdout:'i -22\n'};
    await press(116);
    assert.equal(context.screenOffRun.result, 'refused');
    assert.equal(context.inputError, null, 'a refused Picture Off does not pause the remote interception');
    const refused = await context.runActions([{type:'screenoff'}]);
    assert.equal(refused.sent, 0); assert.equal(refused.skipped.join(), 'screenoff:refused');

    // The root agent itself failing is a fault, like for any other action.
    answer = new Error('agent down');
    await press(116);
    assert.equal(context.screenOffRun.result, 'failed');
    assert.match(String(context.inputError), /agent down/);

    // Keys that are not held back, repeats and releases never run it (the wake key included: the helper marks it "wake").
    const before = commands.length;
    answer = {exit_code:0,stdout:'i 0\n'};
    for (const action of ['repeat', 'up']) { context.physical.onEvent({code:116,action,decision:'blocked'}); }
    context.physical.onEvent({code:116,action:'down',decision:'wake'});
    context.physical.onEvent({code:116,action:'down',decision:'native'});
    await context.actionQueue;
    assert.equal(commands.length, before, 'only a held key press runs it');
    console.log('PASS remapper turn off screen: fixed Picture Off line, "i 0" counts, a refusal is no input fault, wake and repeats never run it');
})().catch(e => { console.error(e); process.exitCode = 1; });
