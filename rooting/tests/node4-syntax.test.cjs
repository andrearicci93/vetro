'use strict';
// Tizen 4 and 5.5 run the web service on Node.js 4.4 (V8 4.5). One
// destructuring pattern, default parameter or for...of in a packaged service
// file is a SyntaxError while loading, and the service never listens: that is
// exactly how the integration package stopped on a UE43NU7090 (issue #2).
//
// The package is checked, not the source tree, so a file added to the builder
// later is covered without touching this test. Comments and string literals are
// masked first, so prose and messages cannot trip the rules.
const assert = require('assert').strict;

const files = require('../build.cjs').collectIntegration()
    .filter(function (file) { return decodeURIComponent(file.uri).startsWith('service/'); });

// Replaces comments and literals with spaces, keeping newlines, so match
// offsets still point at the right line.
function mask(source) {
    let out = '', i = 0;
    const blank = c => (c === '\n' ? '\n' : ' ');
    while (i < source.length) {
        const c = source[i], next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && next === '*') {
            out += '  '; i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out += blank(source[i]); i++; }
            out += '  '; i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += ' '; i++;
            while (i < source.length) {
                const ch = source[i];
                if (ch === '\\') { out += '  '; i += 2; continue; }
                out += blank(ch); i++;
                if (ch === quote) break;
            }
            continue;
        }
        out += c; i++;
    }
    return out;
}

const RULES = [
    [/(?:const|let|var)\s*[{\[]/g, 'destructuring declaration'],
    [/for\s*\(\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s+of\b/g, 'for...of loop'],
    [/\.\.\./g, 'rest or spread element'],
    [/function\s*[A-Za-z_$][\w$]*\s*\([^)]*=[^=]/g, 'default parameter'],
    [/\([^()]*=[^=][^()]*\)\s*=>/g, 'default parameter in an arrow function'],
    [/\basync\s+(?:function\b|\()/g, 'async function'],
    [/\bawait\s+[A-Za-z_$(]/g, 'await'],
    [/\.padStart\s*\(|\.padEnd\s*\(/g, 'String.prototype.padStart/padEnd (Node 8+)'],
    [/\.includes\s*\(/g, 'String/Array.prototype.includes (Node 6+)'],
    [/Object\.(?:values|entries|fromEntries)\s*\(/g, 'Object.values/entries/fromEntries (Node 7+)'],
    [/\.flat(?:Map)?\s*\(/g, 'Array.prototype.flat/flatMap (Node 11+)'],
    [/fs\.promises/g, 'fs.promises (Node 10+)'],
    [/mkdirSync\s*\([^)]*recursive/g, 'fs.mkdirSync {recursive: true} (Node 10.12+)'],
    [/copyFileSync/g, 'fs.copyFileSync (Node 8.5+)']
];

const findings = [];
for (const file of files) {
    const name = decodeURIComponent(file.uri);
    const source = file.data.toString('utf8');
    const masked = mask(source);
    for (const [pattern, what] of RULES) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(masked))) {
            const line = masked.slice(0, match.index).split('\n').length;
            findings.push(name + ':' + line + ' — ' + what + ' (' + JSON.stringify(match[0].trim()) + ')');
            if (match[0].length === 0) pattern.lastIndex++;
        }
    }
}

assert.deepEqual(findings, [], 'Node 4.4 cannot parse or run these; the service would fail to start:\n' + findings.join('\n'));
assert.ok(files.some(file => decodeURIComponent(file.uri) === 'service/platform.js'), 'the TV adapter is packaged');
console.log('PASS Node 4.4 syntax guard: ' + files.length + ' packaged service files');
