'use strict';
// The script that is added to YouTube: TizenTube (https://github.com/reisxd/TizenTube, GPL-3.0). It blocks ads, hides Shorts,
// skips sponsor segments with SponsorBlock's public database (https://sponsor.ajay.app) and can show DeArrow titles.
//
// It is NOT part of this plugin. One exact release is downloaded from npm's CDN on first use and used only when its SHA-256
// matches the value below, so the CDN cannot change what runs inside your YouTube session. A newer release is a new
// version of this plugin. The file is kept in the plugin’s cache folder, so it is downloaded once.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var client = require('./tls-client.js');

var VERSION = '1.15.2';
var SHA256 = '7a092351e0e348507ef9c97da8833d5f6717de628517f5299053b3c2073f1d69';
var HOST = 'cdn.jsdelivr.net';
var URL_PATH = '/npm/@foxreis/tizentube@' + VERSION + '/dist/userScript.js';
var MAX_BYTES = 3 * 1024 * 1024;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function UserScript(dir) {
    var file = path.join(dir, 'userscript-' + VERSION + '.js'), cached = null;

    // The verified bytes, or null. Checked again on every read from disk.
    this.load = function () {
        if (cached) return cached;
        try {
            var buf = fs.readFileSync(file);
            if (sha256(buf) === SHA256) cached = { body: buf, version: VERSION };
        } catch (e) { /* not downloaded yet */ }
        return cached;
    };

    // cb(err, {body, version})
    this.ensure = function (cb) {
        var have = this.load();
        if (have) return cb(null, have);
        client.fetchBuffer(HOST, URL_PATH, MAX_BYTES, function (err, buf, status) {
            if (err) return cb(err);
            if (status !== 200) return cb(new Error('The script download answered HTTP ' + status));
            if (sha256(buf) !== SHA256) return cb(new Error('The downloaded script does not match the expected SHA-256: not used'));
            try {
                fs.writeFileSync(file + '.tmp', buf, { mode: 420 });
                fs.renameSync(file + '.tmp', file);
            } catch (e) { return cb(new Error('Could not save the script: ' + e.message)); }
            cached = { body: buf, version: VERSION };
            cb(null, cached);
        });
    };
    this.forget = function () { cached = null; };
}

module.exports = { UserScript: UserScript, VERSION: VERSION, SHA256: SHA256, HOST: HOST, URL_PATH: URL_PATH, sha256: sha256 };
