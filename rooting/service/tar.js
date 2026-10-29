'use strict';

// Minimal ustar tar builder + gzip, enough to produce the archive the SDK
// tarlauncher (sdbd-tarlauncher -xzf ... --to-command) expects.

const zlib = require('zlib');

function padOctal(value, digits) {
    const s = value.toString(8);
    if (s.length > digits - 1) throw new Error('octal field overflow: ' + value);
    // No String.prototype.padStart on Node 4.4.
    let padded = s;
    while (padded.length < digits - 1) padded = '0' + padded;
    return padded + '\0';
}

function header(entry) {
    const h = Buffer.alloc(512);
    h.write(entry.name, 0, 'utf8');                                // name (100)
    h.write(padOctal(entry.mode || 0o600, 8), 100, 'ascii');       // mode (8)
    h.write(padOctal(entry.uid || 0, 8), 108, 'ascii');            // uid (8)
    h.write(padOctal(entry.gid || 0, 8), 116, 'ascii');            // gid (8)
    // size and mtime MUST be octal: a decimal encoding truncates the
    // extracted file (e.g. 273 bytes written as "273" is read as 0o273=187),
    // which cut launch.sh mid-line and killed every payload after Route B.
    h.write(padOctal(entry.size, 12), 124, 'ascii');                // size (12)
    h.write(padOctal(entry.mtime || 0, 12), 136, 'ascii');          // mtime (12)
    h.fill(' ', 148, 156);                                          // chksum placeholder (8)
    h.write('0', 156);                                              // typeflag
    h.write('ustar\0', 257);                                        // magic
    h.write('00', 263);                                             // version
    // compute checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.write(padOctal(sum, 7) + ' ', 148);                           // checksum (6 octal + NUL + space)
    return h;
}

function tarGz(entries) {
    const blocks = [];
    // `for...of` is not supported by Node 4.4.
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const size = data.length;
        blocks.push(header({ name: entry.name, mode: entry.mode, mtime: entry.mtime, size }));
        blocks.push(data);
        const pad = (512 - (size % 512)) % 512;
        if (pad) blocks.push(Buffer.alloc(pad));
    }
    blocks.push(Buffer.alloc(1024)); // two zero blocks
    const tar = Buffer.concat(blocks);
    return zlib.gzipSync(tar);
}

module.exports = { tarGz };