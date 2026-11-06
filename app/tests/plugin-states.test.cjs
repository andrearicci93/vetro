'use strict';
// Regression tests for the plugin host state machine (app/docs/STATE-MACHINES.md, SM-4):
//  - removing a plugin and installing another version of it must run the new code, not Node's cached copy of the old;
//  - an exception thrown outside a guarded call (a plugin's timer) is attributed to the plugin and stops only it.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-plugin-states-')), 'p');
const bundle = (code) => JSON.stringify({ format: 'vetro-plugin', version: 1,
    manifest: { id: 'demo', name: 'Demo', version: '1', apiVersion: 1, permissions: [] }, files: { 'index.js': code } });
const plugin = (answer) => 'module.exports = function () { return { start() {}, stop() {}, status() { return { answer: ' + JSON.stringify(answer) + ' }; } }; };';

// --- remove, then install a different version of the same plugin ---------------------------------------------
{
    const host = new PluginHost({ dir: tmp(), stableMs: 10 });
    host._writeState({ enabled: {}, developer: true });   // unsigned bundles need Developer mode in 0.5.0
    host.start();
    host.install(bundle(plugin('first')));
    assert.equal(host.setEnabled('demo', true).detail.answer, 'first');
    host.setEnabled('demo', false);
    host.remove('demo');
    host.install(bundle(plugin('second')));
    assert.equal(host.setEnabled('demo', true).detail.answer, 'second', 'the reinstalled plugin runs its new code');
    host.stop();
    console.log('PASS a removed plugin installed again runs the new version');
}

// --- a plugin's own timer throws -----------------------------------------------------------------------------
{
    const dir = tmp();
    const host = new PluginHost({ dir, stableMs: 10 });
    host._writeState({ enabled: {}, developer: true });
    host.start();
    host.install(bundle(plugin('ok')));
    host.setEnabled('demo', true);
    const inside = new Error('boom in a timer');
    inside.stack = 'Error: boom in a timer\n    at Timeout._onTimeout (' + path.join(dir, 'demo', 'index.js') + ':3:9)\n    at listOnTimeout (internal/timers.js:549:17)';
    assert.equal(host.handleCrash(inside), true, 'an error raised in the plugin folder belongs to the plugin');
    const status = host.status('demo');
    assert.equal(status.state, 'failed');
    assert.match(status.lastError, /boom in a timer/);
    assert.equal(host.get('demo'), null, 'the plugin is stopped');

    const elsewhere = new Error('bug in Vetro');
    elsewhere.stack = 'Error: bug in Vetro\n    at handle (/opt/usr/apps/vetrotvapp/res/wgt/service/main.js:10:3)';
    assert.equal(host.handleCrash(elsewhere), false, 'an error from Vetro itself is not hidden');
    assert.equal(host.handleCrash(null), false);
    assert.equal(host.handleCrash({}), false);
    // a folder with the same prefix is another plugin's or none at all
    const sibling = new Error('x'); sibling.stack = 'Error: x\n    at f (' + dir + '-other/demo/index.js:1:1)';
    assert.equal(host.handleCrash(sibling), false, 'a path that only starts like the plugin directory is not inside it');
    host.stop();
    console.log('PASS a crash outside a guarded call stops that plugin and nothing else');
}

// --- the plugin directory is reached through a symlink --------------------------------------------------------
// Node's module cache and stack traces carry the real path; the host knows the plugin directory by its link.
{
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-plugin-real-')), link = real + '-link';
    fs.symlinkSync(real, link);
    const host = new PluginHost({ dir: link, stableMs: 10 });
    host._writeState({ enabled: {}, developer: true });
    host.start();
    host.install(bundle(plugin('first')));
    assert.equal(host.setEnabled('demo', true).detail.answer, 'first');
    const crash = new Error('boom through a link');
    crash.stack = 'Error: boom through a link\n    at Timeout._onTimeout (' + path.join(fs.realpathSync(real), 'demo', 'index.js') + ':3:9)';
    assert.equal(host.handleCrash(crash), true, 'a stack with the real path is attributed to the plugin');
    host.setEnabled('demo', false);
    host.remove('demo');
    host.install(bundle(plugin('second')));
    assert.equal(host.setEnabled('demo', true).detail.answer, 'second', 'the new version runs although the directory is a link');
    host.stop();
    console.log('PASS a plugin directory reached through a symlink is matched by real path');
}
