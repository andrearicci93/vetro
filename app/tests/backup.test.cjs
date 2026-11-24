'use strict';
const assert = require('assert').strict;
const Backup = require('../service/backup.js').Backup;

const calls = [];
const b = new Backup({execute: function (cmd) {
    calls.push(cmd);
    return Promise.resolve({exit_code: 0, stdout: 'ok\n', stderr: ''});
}});

assert.equal(require('../service/backup.js').APP_IDS.apltv, 'APLTVMedia');
assert.throws(() => b.resolve('../escape.tar.gz'), /Invalid backup name/);
assert.throws(() => b.resolve('x;rm.tar.gz'), /Invalid backup name/);

Promise.resolve()
    .then(() => b.create('apltv'))
    .then(result => {
        assert.equal(result.appId, 'APLTVMedia');
        assert.ok(calls[0].indexOf('--exclude="*/cache"') >= 0);
        assert.ok(calls[0].indexOf('--exclude="*/tmp"') >= 0);
        return b.restore('apltv', '123-APLTVMedia.tar.gz');
    })
    .then(result => {
        assert.equal(result.appId, 'APLTVMedia');
        assert.ok(calls[1].indexOf('tar -tzf') >= 0);
        assert.ok(calls[1].indexOf('rollback-') >= 0);
        return b.create('all-apps');
    })
    .then(result => {
        assert.equal(result.scope, 'all-apps');
        assert.ok(calls[2].indexOf(" -C '/opt/usr/home/owner/apps_rw' '.'") >= 0);
        return b.restore('all-apps', '123-all-apps.tar.gz');
    })
    .then(result => {
        assert.equal(result.scope, 'all-apps');
        assert.ok(calls[3].indexOf('index($0,"../")') >= 0);
        console.log('PASS backup: per-app, complete archive, exclusions, traversal guard, rollback restore');
    })
    .catch(error => { console.error(error.stack); process.exit(1); });
