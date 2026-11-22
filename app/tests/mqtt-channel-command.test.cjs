'use strict';
// "Go to channel N" over MQTT (<prefix>/<identity>/channel/set): the payload check, the shell line (run in a real shell with the tuner's files
// in a folder of their own) and the subscription, which is there whatever the rules are.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), {execFileSync} = require('child_process');
const kr = require('../service/key-routing.js'), control = require('../service/control.js');
const {MqttBridge} = require('../service/mqtt-bridge.js');

// ---- payload: digits only, 1..9999 (a Home Assistant number box sends "31" or "31.0" is refused, a template may send JSON) ----
assert.equal(kr.channelNumber('31'), '31');
assert.equal(kr.channelNumber(' 007\n'), '7');
assert.equal(kr.channelNumber('{"channel": 5}'), '5');
assert.equal(kr.channelNumber('{"channel":"120"}'), '120');
for (const bad of ['', '0', '00', '-3', '31.0', '12345', 'abc', '3; reboot', '$(id)', '{"channel":"1;id"}', null, undefined]) assert.equal(kr.channelNumber(bad), null, 'refused: ' + bad);
assert.equal(kr.channelCommand('3; id', control.injectCommand), null, 'the line is built from digits only');
assert.equal(kr.channelCommand('0', control.injectCommand), null);

// ---- the shell line: the tuner when it is up with Samsung's live TV on screen, the digits by name otherwise ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-chan-'));
const pidFile = path.join(dir, 'vetro-tuner.pid'), pipe = path.join(dir, 'vetro-tuner.ctl'), log = path.join(dir, 'sent');
const line = kr.channelCommand('31', k => 'echo name:' + k + " >> '" + log + "'")
    .split('/home/owner/vetro-tuner.pid').join(pidFile).split('/tmp/vetro-tuner.ctl').join(pipe).split('/proc/$p').join(dir + '/proc/$p');
const run = () => { try { fs.unlinkSync(log); } catch (e) {} execFileSync('sh', ['-c', line]); return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []; };
assert.deepEqual(run(), ['name:3', 'name:1'], 'no tuner: the two digits by name, in order');
execFileSync('mkfifo', [pipe]);
fs.writeFileSync(pidFile, String(process.pid)); fs.mkdirSync(path.join(dir, 'proc', String(process.pid)), {recursive: true});
assert.deepEqual(run(), ['name:3', 'name:1'], 'tuner up but Samsung\'s live TV not on screen (no .tv flag): by name');
fs.writeFileSync(pipe + '.tv', '');
const reader = fs.openSync(pipe, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
assert.deepEqual(run(), [], 'tuner up and on the TV: nothing by name');
const buf = Buffer.alloc(64); assert.equal(buf.slice(0, fs.readSync(reader, buf, 0, 64)).toString(), 'tune 31\n', 'one tune word on the pipe');
fs.unlinkSync(pidFile); fs.writeFileSync(pidFile, '999999');
assert.deepEqual(run(), ['name:3', 'name:1'], 'a stale pid (tuner dead): by name, the pipe is not written');
fs.closeSync(reader); fs.rmSync(dir, {recursive: true, force: true});

// ---- the subscription and the discovery record ----
const sent = [], subs = [], fake = {publish: (...x) => sent.push(x), subscribe: t => subs.push(t), on() {}, close() {}};
const bridge = new MqttBridge(() => ({}));
bridge.identity = 'tv-one'; bridge.config = {topicPrefix: 'vetro'};
assert.equal(bridge.channelCommandTopic(), 'vetro/tv-one/channel/set');
assert.equal(new MqttBridge(() => ({})).channelCommandTopic(), null, 'no identity yet: no topic');
bridge.availabilityTopic = 'vetro/tv-one/availability'; bridge.client = fake; bridge.connected = true; bridge._discover();
const num = sent.filter(x => x[0] === 'homeassistant/number/tv-one/channel-set/config');
assert.equal(num.length, 1);
const conf = JSON.parse(num[0][1]);
assert.equal(conf.command_topic, 'vetro/tv-one/channel/set'); assert.equal(conf.min, 1); assert.equal(conf.max, 9999); assert.equal(conf.retain, false);
assert.ok(bridge.discoveryTopics.includes('homeassistant/number/tv-one/channel-set/config'), 'removed with the other records when MQTT is turned off');
// rules changing keep the command subscription in the list
bridge.subscriptions = [{topic: 'vetro/tv-one/channel/set', status: 'active'}, {topic: 'a/b', status: 'active'}];
bridge.setTopics(['c/d']);
assert.ok(bridge.subscriptions.some(s => s.topic === 'vetro/tv-one/channel/set'), 'the command subscription survives a change of rules');
console.log('PASS MQTT channel command: strict payload, tuner or digits by name, subscription and Home Assistant number entity');
