'use strict';
// The Home order cache lives in com.samsung.tv.csfs/data on most TVs and in com.samsung.tv.home.media/data on the
// TVs with the new Home (issues #22 and #25, pull requests #20 and #23). The generated shell scripts run here against real temp folders.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const homeOrder = require('../service/home-order.js'), catalog = require('../service/dock-catalog.js');
const CSFS = '/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data';
const NEW_HOME = '/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data';
assert.equal(homeOrder.BASE, CSFS, 'csfs stays the default');

const FILE = (name) => '1\ns/livetv@RF\nd/webapp@' + name + '\nd/webapp@other\nEOFC OBA\n';

function layout(content) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-cache-'));
    const dirs = {csfs: path.join(root, 'csfs'), home: path.join(root, 'home')};
    Object.keys(dirs).forEach(k => fs.mkdirSync(dirs[k]));
    Object.keys(content).forEach(k => fs.writeFileSync(path.join(dirs[k], '.appLayerCache.1'), content[k]));
    const redirect = script => script.split(CSFS).join(dirs.csfs).split(NEW_HOME).join(dirs.home);
    return {root, dirs, redirect};
}
function shellOf(command) {
    const b64 = /^echo (\S+) \| base64 -d \| sh$/.exec(command);
    return b64 ? Buffer.from(b64[1], 'base64').toString() : command;
}
function execute(l) {
    return async function (command) {
        const r = cp.spawnSync('sh', ['-c', l.redirect(shellOf(command))], {encoding: 'utf8'});
        return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr};
    };
}
function dockOrder(l) {
    const r = cp.spawnSync('sh', ['-c', l.redirect(catalog.script())], {encoding: 'utf8'});
    return catalog.parse(r.stdout).order;
}

(async function () {
    const made = [];
    try {
        // csfs only: nothing changes for the TVs that worked before
        let l = layout({csfs: FILE('legacy')}); made.push(l.root);
        assert.deepEqual(dockOrder(l), ['s/livetv@RF', 'd/webapp@legacy', 'd/webapp@other']);
        assert.deepEqual((await new homeOrder.Order(execute(l)).read()).entries, ['s/livetv@RF', 'd/webapp@legacy', 'd/webapp@other']);

        // home.media only: the TVs with the new Home
        l = layout({home: FILE('newhome')}); made.push(l.root);
        assert.deepEqual(dockOrder(l), ['s/livetv@RF', 'd/webapp@newhome', 'd/webapp@other'], 'the dock reads the new Home cache');
        const order = new homeOrder.Order(execute(l));
        assert.deepEqual((await order.read()).entries, ['s/livetv@RF', 'd/webapp@newhome', 'd/webapp@other'], 'Home order reads it');
        const reordered = ['d/webapp@other', 's/livetv@RF', 'd/webapp@newhome'];
        assert.deepEqual((await order.write(reordered)).entries, reordered, 'a reorder is written and read back');
        assert.ok(fs.readFileSync(path.join(l.dirs.home, '.appLayerCache.1'), 'utf8').includes('d/webapp@other\ns/livetv@RF'), 'in the home.media folder');
        assert.ok(fs.existsSync(path.join(l.dirs.home, '.appLayerCache.1.vetro-bak')), 'backup next to it');
        assert.deepEqual(fs.readdirSync(l.dirs.csfs), [], 'the csfs folder is left alone');
        assert.deepEqual((await order.restore()).entries, ['s/livetv@RF', 'd/webapp@newhome', 'd/webapp@other'], 'restore puts the original back');

        // both folders hold a cache: csfs wins, as before
        l = layout({csfs: FILE('legacy'), home: FILE('newhome')}); made.push(l.root);
        assert.ok(dockOrder(l).includes('d/webapp@legacy') && !dockOrder(l).includes('d/webapp@newhome'));

        // neither: the same error as before, and nothing is created
        l = layout({}); made.push(l.root);
        assert.deepEqual(dockOrder(l), []);
        await assert.rejects(new homeOrder.Order(execute(l)).read());
        console.log('PASS Home cache folder: csfs, home.media, both, neither (dock and Home order)');
    } finally {
        made.forEach(d => fs.rmSync(d, {recursive: true, force: true}));
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
