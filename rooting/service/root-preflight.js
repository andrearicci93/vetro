'use strict';
// Runtime/capability checks adapted from chris-ritsen/samsung-tv-root v0.0.12
// (Unlicense); see THIRD_PARTY_NOTICES.md. Commands run through TV-local SDB.
var fs = require('fs');
function failure(code) { var e = new Error(code); e.code = code; return e; }
function selectRuntime(versions) {
    if (versions.some(function (v) { return v[0] >= 6; })) return '6.0';
    if (versions.some(function (v) { return v[0] === 3 && v[1] === 1; })) return '3.1';
    throw failure('runtime-unsupported');
}
function detectRuntime(result, files) {
    if (result.ok) {
        var versions = [], match;
        var pattern = /^Microsoft\.NETCore\.App (\d+)\.(\d+)\.\d+\s+\[/gm;
        while ((match = pattern.exec(result.output))) versions.push([Number(match[1]), Number(match[2])]);
        return selectRuntime(versions);
    }
    if (result.code !== 255 || result.output.indexOf('Unknown option --list-runtimes') < 0) {
        throw failure('runtime-probe-failed');
    }
    // Samsung apphost exposes its active CLR through this symlink; never guess
    // a runtime from model/year, or use unrelated installed runtime directories.
    var active = '/usr/share/dotnet.tizen/netcoreapp';
    try {
        var version = /^(\d+)\.(\d+)\.\d+$/.exec(require('path').basename(files.realpathSync(active)));
        if (!version) throw failure('runtime-probe-failed');
        files.accessSync(active + '/libcoreclr.so', fs.constants.R_OK);
        files.accessSync(active + '/System.Private.CoreLib.dll', fs.constants.R_OK);
        return selectRuntime([[Number(version[1]), Number(version[2])]]);
    } catch (error) {
        if (error.code === 'runtime-unsupported') throw error;
        throw failure('runtime-probe-failed');
    }
}
function effectiveCapabilities(output, file, required) {
    var line = output.split('\n').filter(function (s) { return s.split(/\s+/)[0] === file; })[0] || '';
    var caps = {}, match, pattern = /(cap_[a-z0-9_]+(?:,cap_[a-z0-9_]+)*)[=+]([eip]+)/g;
    while ((match = pattern.exec(line))) {
        var flags = match[2];
        match[1].split(',').forEach(function (name) { caps[name] = flags; });
    }
    return required.every(function (name) { return (caps[name] || '').indexOf('e') >= 0; });
}
function checkTarget(options) {
    var opts = options || {}, execute = opts.run, files = opts.fs || fs;
    if (typeof execute !== 'function') return Promise.reject(failure('preflight-failed'));
    return execute('/usr/bin/dotnet', ['--list-runtimes']).then(function (result) {
        var runtime = detectRuntime(result, files);
        return execute('getcap', ['/usr/bin/dotnet', '/usr/sbin/sdbd-tarlauncher']).then(function (caps) {
            if (!caps.ok) throw failure('capabilities-probe-failed');
            if (!effectiveCapabilities(caps.output, '/usr/bin/dotnet', ['cap_setgid', 'cap_sys_admin'])) throw failure('dotnet-capabilities-missing');
            if (!effectiveCapabilities(caps.output, '/usr/sbin/sdbd-tarlauncher', ['cap_setgid', 'cap_setuid'])) throw failure('launcher-capabilities-missing');
            return execute('/usr/bin/tar', ['--help']).then(function (tar) {
                if (!tar.ok) throw failure('tar-probe-failed');
                if (tar.output.indexOf('--to-command') < 0) throw failure('tar-unsupported');
                return { runtime: runtime, source: 'detected' };
            });
        });
    });
}
module.exports = { checkTarget: checkTarget, detectRuntime: detectRuntime, effectiveCapabilities: effectiveCapabilities };
