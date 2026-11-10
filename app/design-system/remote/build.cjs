'use strict';
// Remote key icons for Vetro's pages and tutorials, drawn from Samsung's Smart Remote (One Remote): Back, Home,
// the 123 / colour key, the circle pad (four directions and OK), Power, Voice, Ambient, Play/pause and the VOL / CH rockers.
// Redrawn as plain geometry, not traced: every glyph and the button body use currentColor, so one file works on a dark
// or a light page; the highlight of the tutorial variants (pad direction, rocker side) uses --remote-accent, default
// Vetro's link blue. The four colour dots keep their colours. Run: node app/design-system/remote/build.cjs
const fs = require('fs'), path = require('path');
const outputs = {};   // path -> content; written only when run as a script (the test compares them with the files)
const emit = (file, text) => { outputs[file] = text; };
const OUT = __dirname, ACCENT = 'var(--remote-accent, #8fbaff)';
const GLYPH = 'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"';

function svg(w, h, title, body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + title + '">' +
        '<title>' + title + '</title>' + body.replace(/\d+\.\d{3,}/g, m => String(+(+m).toFixed(2))) + '</svg>\n';
}
// The round key the glyph sits on.
function key(title, glyph, opts) {
    var o = opts || {};
    return svg(48, 48, title, '<circle cx="24" cy="24" r="22" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".4" stroke-width="1.5"/>' +
        '<g ' + GLYPH + (o.color ? ' style="color:' + o.color + '"' : '') + '>' + glyph + '</g>');
}

const icons = {};

// Back: a U-turn arrow, the head at the top pointing left, the tail coming back underneath.
icons['back'] = key('Back', '<path d="M14.5 19.5H27.5a6.5 6.5 0 0 1 0 13H17.5"/><path d="M19 15l-4.5 4.5L19 24"/>');

// Home: a house with a rounded door standing on its floor line.
icons['home'] = key('Home', '<path d="M14.5 22L24 13.5 33.5 22V32a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/><path d="M21 34v-5a3 3 0 0 1 6 0v5"/>');

// 123: the four colour dots over the digits, as printed on the key. Digits are strokes, so no font is needed.
function digits(left, top) {
    // Cells: "1" 2 wide, "2" 5.4 wide, "3" about 4.7 wide (its arcs start 0.4 in), 2.2 apart: 16.5 in all, centred on the key.
    var b = top + 9.4, x1 = left, x2 = left + 4.2, x3 = left + 11.4;
    return '<path d="M' + x1 + ' ' + (top + 2) + 'L' + (x1 + 2) + ' ' + top + 'V' + b + '"/>' +
        '<path d="M' + x2 + ' ' + (top + 2.6) + 'a2.6 2.6 0 1 1 4.6 1.6L' + x2 + ' ' + b + 'H' + (x2 + 5.4) + '"/>' +
        '<path d="M' + (x3 + 0.6) + ' ' + (top + 1.15) + 'A2.3 2.3 0 1 1 ' + (x3 + 2.6) + ' ' + (top + 4.6) + 'A2.5 2.5 0 1 1 ' + (x3 + 0.43) + ' ' + (top + 8.35) + '"/>' +
        '<path d="M' + (x3 + 1.9) + ' ' + (top + 4.6) + 'H' + (x3 + 2.6) + '"/>';
}
const DOTS = ['#ef4b4b', '#2fb36b', '#f5c518', '#3b82f6'];
icons['color-123'] = key('123 and colour keys', DOTS.map((c, i) => '<circle cx="' + (16.5 + i * 5) + '" cy="16.5" r="2.1" fill="' + c + '" stroke="none"/>').join('') +
    '<g stroke-width="1.9">' + digits(15.75, 24.4) + '</g>');

// Power: the broken ring and its stroke; Samsung prints it red.
icons['power'] = key('Power', '<path d="M18.6 17.6a9 9 0 1 0 10.8 0"/><path d="M24 13.5v9"/>', {color: '#ef6b62'});
// Voice: the microphone capsule on its stand.
icons['voice'] = key('Voice', '<rect x="20.5" y="12.5" width="7" height="13" rx="3.5"/><path d="M16.5 22.5a7.5 7.5 0 0 0 15 0"/><path d="M24 30v4.5"/>');
// Ambient Mode: a picture frame with a leaf.
icons['ambient'] = key('Ambient Mode', '<rect x="14" y="15.5" width="20" height="17" rx="2.5"/><path d="M19 28.5c0-5.5 4-8.5 10-9.5-0.5 6-4 9.5-10 9.5z"/><path d="M19 28.5l5-4.5"/>');
// Play/pause: the triangle and the two bars.
icons['play-pause'] = key('Play/pause', '<path d="M14.5 17.5v13l9-6.5z"/><path d="M27.5 17.5v13M32.5 17.5v13"/>');

// The circle pad: the ring with the four directions and OK in the middle. The tutorial variants light one part.
const C = 48, R_OUT = 44, R_IN = 22.5, R_OK = 17;
function wedge(dir) {
    const a = {up: -90, right: 0, down: 90, left: 180}[dir], rad = d => (a + d) * Math.PI / 180, ro = R_OUT - 1.5, ri = R_IN + 1.5;
    const p = (r, d) => (C + r * Math.cos(rad(d))).toFixed(2) + ' ' + (C + r * Math.sin(rad(d))).toFixed(2);
    return '<path d="M' + p(ri, -44) + 'L' + p(ro, -44) + 'A' + ro + ' ' + ro + ' 0 0 1 ' + p(ro, 44) + 'L' + p(ri, 44) + 'A' + ri + ' ' + ri + ' 0 0 0 ' + p(ri, -44) + 'Z" fill="' + ACCENT + '" fill-opacity=".32"/>';
}
function chevron(dir, lit) {
    const r = (R_OUT + R_IN) / 2, s = 4.2;
    const at = {up: [C, C - r], down: [C, C + r], left: [C - r, C], right: [C + r, C]}[dir], x = at[0], y = at[1];
    const d = {up: 'M' + (x - s) + ' ' + (y + s / 2) + 'L' + x + ' ' + (y - s / 2) + 'L' + (x + s) + ' ' + (y + s / 2),
        down: 'M' + (x - s) + ' ' + (y - s / 2) + 'L' + x + ' ' + (y + s / 2) + 'L' + (x + s) + ' ' + (y - s / 2),
        left: 'M' + (x + s / 2) + ' ' + (y - s) + 'L' + (x - s / 2) + ' ' + y + 'L' + (x + s / 2) + ' ' + (y + s),
        right: 'M' + (x - s / 2) + ' ' + (y - s) + 'L' + (x + s / 2) + ' ' + y + 'L' + (x - s / 2) + ' ' + (y + s)}[dir];
    return '<path d="' + d + '" fill="none" stroke="' + (lit ? ACCENT : 'currentColor') + '" stroke-opacity="' + (lit ? 1 : .45) + '" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>';
}
function pad(lit) {
    const name = lit ? (lit === 'ok' ? 'OK' : lit[0].toUpperCase() + lit.slice(1)) : null;
    let body = '<circle cx="48" cy="48" r="' + R_OUT + '" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".4" stroke-width="1.5"/>';
    if (lit && lit !== 'ok') body += wedge(lit);
    body += '<circle cx="48" cy="48" r="' + R_IN + '" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="1.5"/>';
    body += ['up', 'right', 'down', 'left'].map(d => chevron(d, d === lit)).join('');
    body += '<circle cx="48" cy="48" r="' + R_OK + '" fill="' + (lit === 'ok' ? ACCENT : 'currentColor') + '" fill-opacity="' + (lit === 'ok' ? .32 : .14) + '" stroke="' + (lit === 'ok' ? ACCENT : 'currentColor') + '" stroke-opacity="' + (lit === 'ok' ? 1 : .5) + '" stroke-width="1.5"/>';
    // "OK" as strokes, not text: a renderer without fonts (the PNGs for the TV) still draws it.
    body += '<g fill="none" stroke="' + (lit === 'ok' ? ACCENT : 'currentColor') + '" stroke-opacity="' + (lit === 'ok' ? 1 : .75) + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<ellipse cx="43" cy="48" rx="3.3" ry="4.4"/><path d="M49.4 43.6v8.8M54.2 43.6l-4.6 4.6M51.3 46.7l3.1 5.7"/></g>';
    return svg(96, 96, name ? 'Circle pad, ' + name : 'Circle pad: Up, Down, Left, Right and OK', body);
}
icons['pad'] = pad(null);
['up', 'down', 'left', 'right', 'ok'].forEach(d => { icons['pad-' + d] = pad(d); });

// The VOL and CH rockers: two bars side by side that tip up or down, the labels printed under them as on the remote
// (pressing VOL mutes, holding it opens Accessibility). The tutorial variants light one bar and show which way it tips.
function rocker(lit) {
    const parts = lit ? lit.split('-') : [], side = parts[0], way = parts[1];
    let body = '';
    [['vol', 'VOL', 8], ['ch', 'CH', 50]].forEach(r => {
        const on = r[0] === side, x = r[2] + 19;
        body += '<rect x="' + r[2] + '" y="22" width="38" height="12" rx="6" fill="' + (on ? ACCENT : 'currentColor') + '" fill-opacity="' + (on ? .32 : .1) + '" stroke="' + (on ? ACCENT : 'currentColor') + '" stroke-opacity="' + (on ? 1 : .45) + '" stroke-width="1.5"/>';
        body += '<text x="' + x + '" y="58" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="11" font-weight="600" fill="currentColor" fill-opacity=".75">' + r[1] + '</text>';
        (on && way && way !== 'press' ? (way === 'both' ? ['up', 'down'] : [way]) : []).forEach(w => {
            const y = w === 'up' ? 14 : 42, d = w === 'up' ? -1 : 1;
            body += '<path d="M' + (x - 5) + ' ' + (y - d * 2.5) + 'L' + x + ' ' + (y + d * 2.5) + 'L' + (x + 5) + ' ' + (y - d * 2.5) + '" fill="none" stroke="' + ACCENT + '" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>';
        });
    });
    const what = lit ? ' ' + (side === 'vol' ? 'VOL' : 'CH') + ' ' + (way === 'press' ? 'pressed' : way === 'both' ? 'up or down' : way) : '';
    return svg(96, 62, 'VOL and CH keys' + what, body);
}
icons['rocker'] = rocker(null);
['vol-up', 'vol-down', 'vol-press', 'ch-up', 'ch-down', 'ch-both'].forEach(v => { icons['rocker-' + v] = rocker(v); });

Object.keys(icons).forEach(n => emit(path.join(OUT, n + '.svg'), icons[n]));

// A contact sheet: every icon on a dark and a light background, at 1x and 2x.
const cell = n => '<figure><div class="big">' + icons[n].replace(/ width="\d+" height="\d+"/, '') + '</div><figcaption>' + n + '.svg</figcaption></figure>';
const groups = [['Keys', ['back', 'home', 'color-123', 'power', 'voice', 'ambient', 'play-pause']],
    ['Circle pad', ['pad', 'pad-up', 'pad-down', 'pad-left', 'pad-right', 'pad-ok']],
    ['VOL / CH', ['rocker', 'rocker-vol-up', 'rocker-vol-down', 'rocker-vol-press', 'rocker-ch-up', 'rocker-ch-down', 'rocker-ch-both']]];
const sheet = theme => '<section class="' + theme + '">' + groups.map(g => '<h2>' + g[0] + '</h2><div class="grid">' + g[1].map(cell).join('') + '</div>').join('') + '</section>';
emit(path.join(OUT, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remote key icons</title><style>' +
    'body{margin:0;font:14px system-ui,-apple-system,Segoe UI,sans-serif}section{padding:16px 20px}.dark{background:#080f23;color:#f5f8ff}.light{background:#f5f8ff;color:#101c35;--remote-accent:#123bb5}' +
    'h2{font-size:13px;font-weight:600;opacity:.7;margin:8px 0}.grid{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;display:grid;justify-items:center;gap:6px}.big svg{height:64px;width:auto}figcaption{font-size:11px;opacity:.6;font-family:ui-monospace,monospace}' +
    '</style></head><body>' + sheet('dark') + sheet('light') + '</body></html>\n');
// 2. The dashboard's copy: app/service/remote-icons.js, plain ES5 (the service runs on the TV's Node 4) with a page copy.
const inline = n => icons[n].replace(/<title>[^<]*<\/title>/, '').replace(/ width="\d+" height="\d+"/, '').replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true" focusable="false"').replace(/\n$/, '');
const map = {};
Object.keys(icons).forEach(n => { map[n] = inline(n); });
const SERVICE = path.join(OUT, '..', '..', 'service', 'remote-icons.js');
emit(SERVICE, "'use strict';\n" +
    '// Generated by app/design-system/remote/build.cjs from the remote key icons: do not edit by hand, run that script.\n' +
    '// remoteKey(name, label) is an inline picture of a key of the Smart Remote with label as its accessible name; it inherits\n' +
    '// the text colour, and the lit part of the tutorial variants uses --remote-accent. The page gets the same function (pageSource).\n\n' +
    'var REMOTE_ICONS = ' + JSON.stringify(map, null, 1).replace(/\u2212/g, '\\u2212') + ';\n\n' +
    'function remoteKey(name, label) {\n' +
    "    var svg = REMOTE_ICONS[name];\n" +
    "    if (!svg) return '';\n" +
    "    var text = String(label).replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;');\n" +
    "    return '<span class=\"rkey rkey-' + name + '\" role=\"img\" aria-label=\"' + text + '\" title=\"' + text + '\">' + svg + '</span>';\n" +
    '}\n\n' +
    "function pageSource() { return 'var REMOTE_ICONS=' + JSON.stringify(REMOTE_ICONS) + ';\\n' + remoteKey.toString(); }\n\n" +
    'module.exports = {icons: REMOTE_ICONS, key: remoteKey, pageSource: pageSource};\n');

// 3. The TV page (app/index.html) has no service modules: the few keys it shows are written between two markers.
const TV = path.join(OUT, '..', '..', 'index.html'), TV_KEYS = ['pad-ok', 'pad-down', 'back'];
const page = fs.readFileSync(TV, 'utf8'), begin = '/* remote-icons:begin (app/design-system/remote/build.cjs) */', end = '/* remote-icons:end */';
const a = page.indexOf(begin), b = page.indexOf(end);
if (a < 0 || b < a) throw new Error('index.html has no remote-icons markers');
const block = begin + '\nvar KEY_ICONS = ' + JSON.stringify(TV_KEYS.reduce((o, n) => { o[n] = map[n]; return o; }, {})) + ';\n';
emit(TV, page.slice(0, a) + block + page.slice(b));

module.exports = {icons, outputs};
if (require.main === module) {
    Object.keys(outputs).forEach(f => fs.writeFileSync(f, outputs[f]));
    console.log(Object.keys(icons).length + ' icons written to ' + OUT + ', remote-icons.js and the TV page block updated');
}
