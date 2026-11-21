'use strict';
const assert = require('assert').strict;
const path = require('path');
const loadService = require('./service-harness.cjs');

(async () => {
    const execCalls = [];
    let onAgentCb = null;
    const svc = loadService(path.resolve(__dirname, '..'), {
        dependencies: {
            './updater.js': { Updater: function () {} },
            './platform.js': {
                start() {}, stop() {},
                status() { return { mode: 'root', agent: { connected: true } }; },
                onAgent(cb) { onAgentCb = cb; },
                execute(cmd, ms) {
                    execCalls.push({ cmd, ms });
                    if (cmd.includes('__VOL__')) {
                        return Promise.resolve({
                            exit_code: 0,
                            stdout: '__VOL__\n   int32 12\n   int32 0\n__MUTE__\n   int32 0\n   int32 0\n__SRC__\nmemory/system/source_type, value = 14 (Int32)\n__TVM__\nmemory/org.tizen.tv-viewer/mute_status, value = True (Boolean)\n'
                        });
                    }
                    return Promise.resolve({ exit_code: 0, stdout: '' });
                }
            }
        }
    });

    const p1 = svc.context.parseFastTvState('__VOL__\n   int32 7\n   int32 0\n__MUTE__\n   int32 0\n   int32 0\n__SRC__\nvalue = 0 (Int32)\n__TVM__\nvalue = False (Boolean)\n');
    assert.deepEqual(Object.assign({}, p1), { volume: 7, muted: false, source: 'TV', sourceType: 0 });

    const p2 = svc.context.parseFastTvState('__VOL__\n   int32 0\n   int32 -4\n__MUTE__\n   int32 0\n   int32 -4\n__SRC__\nvalue = 14 (Int32)\n__TVM__\nvalue = True (Boolean)\n');
    assert.deepEqual(Object.assign({}, p2), { volume: null, muted: true, source: 'HDMI2', sourceType: 14 });

    assert.equal(svc.context.parseFastTvState('__VOL__\n__FAIL__\n__MUTE__\n__FAIL__\n__SRC__\n__TVM__\n'), null);

    const fastRes = await svc.context.readTvStateFast();
    assert.deepEqual(Object.assign({}, fastRes), { volume: 12, muted: true, source: 'HDMI2', sourceType: 14 });

    onAgentCb(true);
    await new Promise(r => setImmediate(r));
    const oomCall = execCalls.find(c => c.cmd.includes('oom_score_adj') && c.cmd.includes('/sys/fs/cgroup/memory/cgroup.procs'));
    assert.ok(oomCall && oomCall.cmd.includes('ProcExclude si exclude') && oomCall.cmd.includes('echo -500') && oomCall.cmd.includes('/proc/$p/status'));

    console.log('PASS dotnet-free TvState and OOM -500 protection');
})().catch(e => { console.error(e); process.exit(1); });
