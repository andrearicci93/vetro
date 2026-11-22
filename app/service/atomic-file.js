'use strict';
// Writes a small state file so that a power cut (these TVs are switched off at the wall) leaves either the old
// content or the new content, never half of one. The temporary file sits next to the target: rename is atomic
// only inside one filesystem. Callers that read the file already treat a missing or unparsable file as "no saved
// state", which is why a truncated file used to silently reset the setting.
var path = require('path');

function writeWithSync(fs, file, text, options) {
    var mode = options && options.mode !== undefined ? options.mode : 438;
    var buf = Buffer.from(String(text), 'utf8');
    var fd = fs.openSync(file, 'w', mode);
    try {
        var off = 0;
        while (off < buf.length) {
            var n = fs.writeSync(fd, buf, off, buf.length - off);
            if (!(n > 0)) throw new Error('short write');
            off += n;
        }
        if (typeof fs.fsyncSync === 'function') fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

function fsyncDir(fs, file) {
    if (typeof fs.openSync !== 'function' || typeof fs.fsyncSync !== 'function') return;
    try {
        var dfd = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch (e) { /* best-effort; unsupported on some filesystems / Windows */ }
}

function write(fs, file, text, options) {
    var temp = file + '.tmp';
    var hasSync = typeof fs.openSync === 'function' && typeof fs.writeSync === 'function' && typeof fs.closeSync === 'function';
    if (hasSync && options && options.backup && typeof options.validate === 'function') {
        try {
            var existing = fs.readFileSync(file, 'utf8');
            if (options.validate(existing)) {
                var bakTmp = file + '.bak.tmp';
                try {
                    writeWithSync(fs, bakTmp, existing, options);
                    fs.renameSync(bakTmp, file + '.bak');
                    fsyncDir(fs, file + '.bak');
                } catch (e) {
                    try { fs.unlinkSync(bakTmp); } catch (x) { /* nothing to remove */ }
                }
            }
        } catch (e) { /* no valid existing file to back up */ }
    }
    try {
        if (hasSync) writeWithSync(fs, temp, text, options);
        else fs.writeFileSync(temp, text, options);
        fs.renameSync(temp, file);
        if (hasSync) fsyncDir(fs, file);
    } catch (e) {
        try { fs.unlinkSync(temp); } catch (x) { /* nothing to remove */ }
        throw e;
    }
}
module.exports = {write: write};
