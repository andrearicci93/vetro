'use strict';
// The fixed part of the Vetro TV Tuner page in the dashboard: the remote buttons and the pictures of what the tuner draws on the TV.
// The switch and the live state are drawn by the dashboard's script (renderTuner); everything here is static markup.
//
// The pictures are SVG drawn at the tuner's own screen size (1920 x 1080) with the coordinates of tuner/src/Ui/Views.cs and
// tuner/src/Core/GuideScene.cs, so they scale like the real screen and show its real layout. They are not screenshots: a
// screenshot of the TV cannot show the video plane, and the channels and programmes in them are samples.
//
// Plain ES5, like every module the TV loads.

var FONT = 'SamsungOneUI, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
var SHEET = '#243448', ICE = '#e4f2ff', LIGHT = '#a5d8ff';   // Fumé: opaque sheet, ice focus ring, light blue only for progress

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function n(v) { return String(Math.round(v * 100) / 100); }

// ---- drawing helpers (white at an alpha, as the tuner draws) ----
function fill(x, y, w, h, alpha, radius, color) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" rx="' + n(radius === undefined ? 8 : radius) + '" fill="' + (color || '#fff') + '" fill-opacity="' + n(alpha / 255) + '"/>';
}
function ring(x, y, w, h, radius) {
    return '<rect x="' + n(x + 1) + '" y="' + n(y + 1) + '" width="' + n(w - 2) + '" height="' + n(h - 2) + '" rx="' + n(radius === undefined ? 10 : radius) + '" fill="none" stroke="' + ICE + '" stroke-width="3"/>';
}
// The tuner places text by the top of its box; SVG by its baseline.
function text(x, y, size, alpha, str, anchor) {
    return '<text x="' + n(x) + '" y="' + n(y + size * 0.82) + '" font-size="' + size + '" fill="#fff" fill-opacity="' + n(alpha / 255) + '"' +
        (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(str) + '</text>';
}
function sheet(x, y, w, h) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="16" fill="' + SHEET + '" stroke="#fff" stroke-opacity="0.16" stroke-width="2" filter="url(#tpShadow)"/>';
}
// One picture: the TV picture (the launcher preview's sunset), the parts, a text for screen readers.
function screen(label, parts) {
    return '<svg class="tuner-screen" viewBox="0 0 1920 1080" role="img" aria-label="' + esc(label) + '" font-family="' + FONT + '" font-weight="500">' +
        '<use href="#tvScene"/>' + parts.join('') + '</svg>';
}
function figure(title, keys, description, picture) {
    return '<figure class="tuner-shot">' + picture + '<figcaption><strong>' + esc(title) + '</strong><span class="tuner-opens">' + keys + '</span><span>' + esc(description) + '</span></figcaption></figure>';
}

// ---- the six views ----
// Sample channels, by number. The same ones appear in every picture, with Cinema HD (9) as the channel being watched.
var NAMES = {4: 'Weather', 5: 'Shopping', 6: 'Retro', 7: 'Talk', 8: 'News 24', 9: 'Cinema HD', 10: 'Sport 1', 11: 'Docs', 12: 'Kids', 13: 'Music', 14: 'Nature'};

function banner() {
    var X = 96, W = 780, H = 204, Y = 984 - H, Pad = 36, bar = W - 2 * Pad;
    return screen('The channel banner: channel 9, Cinema HD, the film on air with its times, the time left and a progress bar.', [
        sheet(X, Y, W, H),
        text(X + Pad, Y + 22, 56, 255, '9'), text(X + Pad + 110, Y + 32, 40, 255, 'Cinema HD'),
        text(X + Pad, Y + 84, 30, 255, 'Evening Film'),
        text(X + Pad, Y + 126, 26, 178, '21:20 – 23:05'), text(X + W - Pad, Y + 126, 26, 178, '1 h 12 min left', 'end'),
        fill(X + Pad, Y + H - 30, bar, 6, 56, 3), fill(X + Pad, Y + H - 30, Math.round(bar * 0.31), 6, 255, 3, LIGHT)
    ]);
}

function channelList() {
    var X = 1284, Y = 110, W = 540, Pad = 24, RowH = 64, rows = 11, selected = 5, parts = [sheet(X, Y, W, rows * RowH + 2 * Pad)];
    for (var r = 0; r < rows; r++) {
        var y = Y + Pad + r * RowH, sel = r === selected, num = String(4 + r);
        if (sel) { parts.push(fill(X + 16, y + 2, W - 32, RowH - 4, 77, 12), ring(X + 16, y + 2, W - 32, RowH - 4)); }
        parts.push(text(X + 44, y + 10, 32, sel ? 255 : 178, num), text(X + 150, y + 10, 32, 255, NAMES[4 + r]));
    }
    return screen('The channel list on the right of the screen with eleven channels and one selected.', parts);
}

function numberPad() {
    var X = 1284, Y = 110, W = 540, Pad = 34, KeyW = 148, KeyH = 76, Gap = 14, GridY = 232, H = GridY + 4 * KeyH + 3 * Gap + Pad;
    var labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Delete', '0', 'Go'], parts = [sheet(X, Y, W, H),
        text(X + Pad, Y + 30, 26, 178, 'Channel number'), text(X + Pad, Y + 62, 76, 255, '9'), text(X + Pad, Y + 166, 28, 178, 'Cinema HD')];
    for (var i = 0; i < 12; i++) {
        var r = Math.floor(i / 3), c = i % 3, x = X + Pad + c * (KeyW + Gap), y = Y + GridY + r * (KeyH + Gap), sel = i === 10, long = labels[i].length > 1;
        parts.push(fill(x, y, KeyW, KeyH, sel ? 66 : 51, 12));
        parts.push(text(x + KeyW / 2, y + (long ? 20 : 12), long ? 28 : 40, 255, labels[i], 'middle'));
        if (sel) parts.push(ring(x, y, KeyW, KeyH, 12));
    }
    return screen('The number pad: a typed channel number, the channel it goes to, and a grid of keys 1 to 9, Delete, 0 and Go.', parts);
}

// The guide: 7 channels, 180 minutes at 8 px a minute, "now" 40 minutes in. Programmes are [minutes from the left edge, length, title].
var GUIDE = [
    [[-20, 60, 'Morning News'], [40, 50, 'Weather'], [90, 90, 'The Long Road']],
    [[-35, 95, 'Evening Film'], [60, 80, 'Late Show'], [140, 40, 'Quiz']],
    [[-10, 70, 'League Match'], [60, 60, 'Replay'], [120, 60, 'Highlights']],
    [[-50, 110, 'Ocean Planet'], [60, 120, 'Ancient Cities']],
    [[-5, 45, 'Cartoons'], [40, 45, 'Puppet Club'], [85, 95, 'Adventure Hour']],
    [[-30, 60, 'Concert Live'], [30, 70, 'Top 20'], [100, 80, 'Studio Session']],
    [[-15, 75, 'Wild Rivers'], [60, 55, 'Garden Diary'], [115, 65, 'Night Sky']]
];
var GUIDE_TIMES = ['20:40', '21:10', '21:40', '22:10', '22:40', '23:10'];
// The clock time of a number of minutes from the left edge of the window, which starts at 20:40.
function clock(minutes) {
    var total = 20 * 60 + 40 + minutes, h = Math.floor(total / 60) % 24, m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// scroll: the version for the slideshows, where the channels run upwards one row at a time, as when Down is held. Fourteen rows
// (the seven samples twice) move by seven inside a window of seven, so the loop has no seam; no focus ring, it would not follow.
function guide(scroll) {
    var SX = 64, SY = 56, SW = 1792, SH = 968, Pad = 40, AxisY = 268, RowsY = 316, RowH = 88, CellH = 76, LabelX = SX + Pad, CellsX = LabelX + 246 + 14, CellsW = 1440, PX = 8;
    var parts = [sheet(SX, SY, SW, SH),
        text(LabelX, SY + 26, 40, 255, 'Evening Film'),
        text(LabelX, SY + 84, 26, 178, '21:20 – 23:05   ·   1 h 45 min   ·   Cinema HD'),
        text(LabelX, SY + 128, 26, 178, 'A retired pilot takes a last flight over the coast and meets an old friend.'),
        text(SX + SW - Pad, SY + 32, 30, 178, 'Sat 7 Nov', 'end')];
    GUIDE_TIMES.forEach(function (t, i) { parts.push(text(CellsX + i * 30 * PX, AxisY + 6, 24, 178, t)); });
    parts.push(fill(CellsX, RowsY - 4, CellsW, 2, 40, 0));
    var nowX = CellsX + 40 * PX, focus = null;
    var rows = scroll ? GUIDE.concat(GUIDE) : GUIDE, top = scroll ? 0 : RowsY, out = parts;
    if (scroll) out = [];
    rows.forEach(function (row, i) {
        var r = i % GUIDE.length, y = top + i * RowH, cy = y + (RowH - CellH) / 2, focusRow = !scroll && r === 1;
        var parts = out;
        parts.push(text(LabelX, y + 22, 30, focusRow ? 255 : 178, String(8 + r)), text(LabelX + 68, y + 24, 27, focusRow ? 255 : 178, NAMES[8 + r]));
        row.forEach(function (p, c) {
            var start = Math.max(0, p[0]), end = Math.min(180, p[0] + p[1]);
            if (end <= start) return;
            var x = CellsX + start * PX, w = (end - start) * PX - 4, onAir = p[0] <= 40 && 40 < p[0] + p[1], isFocus = !scroll && r === 1 && c === 0;
            parts.push(fill(x, cy, w, CellH, isFocus ? 66 : onAir ? 66 : 51, 12));
            if (isFocus) focus = [x, cy, w];
            if (w >= 64) {
                parts.push(text(x + 16, cy + 10, 28, 255, p[2]));
                if (w >= 128) parts.push(text(x + 16, cy + 41, 24, isFocus ? 255 : 178, w >= 230 ? clock(p[0]) + ' \u2013 ' + clock(p[0] + p[1]) : clock(p[0])));
            }
        });
    });
    if (scroll) parts.push('<svg x="0" y="' + RowsY + '" width="1920" height="' + (GUIDE.length * RowH) + '" overflow="hidden"><g class="tg-scroll">' + out.join('') + '</g></svg>');
    else parts.push(ring(focus[0], focus[1], focus[2], CellH, 12));
    parts.push(fill(nowX - 1, AxisY + 30, 3, RowsY - AxisY - 32, 255, 1, LIGHT), fill(nowX, RowsY, 1, 7 * RowH - 6, 45, 0));
    parts.push(text(LabelX, SY + SH - 52, 24, 178, 'OK  Watch        Left / Right  Time        Up / Down  Channel        CH + / -  Page        Back  Close'));
    return screen('The TV guide: the programme in focus with its times and description, a time axis, and seven channels with their programmes as boxes.', parts);
}

function info() {
    var X = 96, Y = 56, W = 1728, H = 348, Pad = 44, Badge = 96, TextX = X + Pad + Badge + 32, SideX = X + W - Pad - 380, BarX = TextX + 170 + 24;
    return screen('The info panel at the top of the screen: channel 9, the film on air with its times, progress and description, and on the right the clock, date, tuner and audio.', [
        sheet(X, Y, W, H),
        fill(X + Pad, Y + 36, Badge, Badge, 51, 12), text(X + Pad + Badge / 2, Y + 36 + 18, 44, 255, '9', 'middle'),
        text(TextX, Y + 28, 44, 255, 'Evening Film'), text(TextX, Y + 88, 30, 178, 'Cinema HD'),
        text(TextX, Y + 130, 26, 178, '21:20 \u2013 23:05'), fill(BarX, Y + 144, 260, 6, 56, 3), fill(BarX, Y + 144, 81, 6, 255, 3, LIGHT), text(BarX + 260 + 24, Y + 130, 26, 178, '1 h 12 min left'),
        text(SideX, Y + 28, 44, 255, '21:48'), text(SideX, Y + 90, 26, 178, 'Saturday 7 November'), text(SideX, Y + 128, 26, 178, 'Antenna'), text(SideX, Y + 164, 26, 178, 'Audio: Italian'),
        text(X + Pad, Y + 212, 30, 178, 'A retired pilot takes a last flight over the coast and meets an old friend,'),
        text(X + Pad, Y + 252, 30, 178, 'who has a secret about the plane that brought them together years ago.')
    ]);
}

function audioToast() {
    var Right = 1920 - 96, Y = 80, W = 360, H = 72;
    return screen('A small message at the top right of the screen: Audio, Italian.', [sheet(Right - W, Y, W, H), text(Right - W + 32, Y + 14, 32, 255, 'Audio: Italian')]);
}

// The shared definitions the pictures refer to: a soft shadow like the dock's and the dark stand-in for the video.
var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<filter id="tpShadow" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/></filter>' +
    '<linearGradient id="tpVideo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c2b45"/><stop offset="0.55" stop-color="#101a2e"/><stop offset="1" stop-color="#0a1120"/></linearGradient>' +
    // The TV picture behind every preview: the same sunset as the launcher's preview (.lp-scene in the dashboard), drawn once
    // here and placed with <use>, so a picture inside a hidden slide still finds it.
    '<linearGradient id="tvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101c3f"/><stop offset=".45" stop-color="#553b73"/><stop offset=".72" stop-color="#d9707a"/><stop offset="1" stop-color="#f6b26b"/></linearGradient><radialGradient id="tvSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff2cf" stop-opacity=".95"/><stop offset=".35" stop-color="#ffc58a" stop-opacity=".5"/><stop offset="1" stop-color="#ffc58a" stop-opacity="0"/></radialGradient><linearGradient id="tvWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a26c"/><stop offset="1" stop-color="#1a2547"/></linearGradient>' +
    '<g id="tvScene"><rect width="1920" height="1080" fill="url(#tvSky)"/><circle cx="1330" cy="640" r="420" fill="url(#tvSun)"/><circle cx="1330" cy="640" r="64" fill="#fff0c9"/><path d="M0 690 220 520 420 640 640 470 880 650 1080 560 1290 690 1500 540 1740 660 1920 590V760H0z" fill="#42375f"/><path d="M0 760 180 640 400 740 640 620 900 760 1160 650 1420 770 1680 670 1920 740V800H0z" fill="#26274a"/><rect y="780" width="1920" height="300" fill="url(#tvWater)"/><rect x="1250" y="790" width="160" height="6" rx="3" fill="#ffe3b3" opacity=".7"/><rect x="1280" y="820" width="100" height="5" rx="2" fill="#ffe3b3" opacity=".45"/><rect x="1300" y="850" width="60" height="4" rx="2" fill="#ffe3b3" opacity=".3"/><path d="M0 900 0 1080H1920V920C1700 880 1500 930 1250 900 900 860 600 930 0 900z" fill="#0d1530" opacity=".55"/></g>' +
    '</defs></svg>';

// ---- the remote ----
// A key of the Smart Remote is drawn as its picture (app/design-system/remote); keys it does not have stay text keycaps.
var remoteKey = require('./remote-icons.js').key;
var KEY_PICTURES = {'CH +': 'rocker-ch-up', 'CH \u2212': 'rocker-ch-down', 'OK': 'pad-ok', '\u25b2': 'pad-up', '\u25bc': 'pad-down', '\u25c0': 'pad-left', '\u25b6': 'pad-right',
    'Back': 'back', 'Home': 'home', 'Power': 'power', '123': 'color-123'};
var KEY_NAMES = {'\u25b2': 'Up', '\u25bc': 'Down', '\u25c0': 'Left', '\u25b6': 'Right'};
function caps() {
    return Array.prototype.slice.call(arguments).map(function (k) {
        return KEY_PICTURES[k] ? remoteKey(KEY_PICTURES[k], KEY_NAMES[k] || k) : '<kbd class="keycap">' + esc(k) + '</kbd>';
    }).join(' ').replace(remoteKey('rocker-ch-up', 'CH +') + ' ' + remoteKey('rocker-ch-down', 'CH \u2212'), remoteKey('rocker-ch-both', 'CH + or CH \u2212'));
}
var KEYS = [
    [caps('CH +', 'CH \u2212'), 'Next and previous channel.'],
    [caps('OK'), 'Channel list. In the list, tunes.'],
    [caps('\u25b2'), 'TV guide. Hold to scroll faster.'],
    [caps('\u25c0'), 'Next audio track. In the guide, earlier.'],
    [caps('\u25b6'), 'Number pad. In the guide, later.']
];

function keysMarkup() {
    return '<ul class="tuner-keys">' + KEYS.map(function (k) { return '<li><span class="tuner-keycaps">' + k[0] + '</span><span>' + esc(k[1]) + '</span></li>'; }).join('') + '</ul>';
}

// The tuner's screens for the slideshow at the top of the Live TV tab (the dashboard draws and turns them).
function slides() {
    return [
        {title: 'Channel banner', keys: caps('CH +', 'CH \u2212'), text: 'Number, name and what’s on.', svg: banner()},
        {title: 'TV guide', keys: caps('\u25b2'), text: 'Seven channels, three hours.', svg: guide(true)},
        {title: 'Channel list', keys: caps('OK'), text: 'Every channel, in order.', svg: channelList()},
        {title: 'Number pad', keys: caps('\u25b6'), text: 'See the channel before you tune.', svg: numberPad()},
        {title: 'Info panel', keys: caps('Info'), text: 'Programme, description, clock and audio.', svg: info()},
        {title: 'Audio', keys: caps('\u25c0'), text: 'Next audio track.', svg: audioToast()}
    ];
}

function previewsMarkup() {
    return DEFS + '<div class="tuner-shots">' + [
        figure('Channel banner', caps('CH +', 'CH −'), 'Appears on every channel change: number, name, the programme on air, when it ends and how far it has gone.', banner()),
        figure('Channel list', caps('OK'), 'All channels in order, eleven at a time. Hold up or down to run through them; OK tunes.', channelList()),
        figure('Number pad', caps('▶'), 'Type a channel number and see where it goes before you tune.', numberPad()),
        figure('TV guide', caps('▲'), 'Seven channels over three hours. Any channel, also on other frequencies, with its description when you stop on a programme.', guide()),
        figure('Info panel', caps('Info'), 'Everything about what is on: programme, times, description, clock and date, the tuner and the audio track. It closes by itself after ten seconds.', info()),
        figure('Audio', caps('◀'), 'Switches to the next audio track and names it for two seconds.', audioToast())
    ].join('') + '</div>';
}

// CSS for the page. Tokens come from the dashboard; no coloured top borders on rounded cards (the screens are plain frames).
var CSS = [
    // The slideshows (Live TV and the Overview): one picture at a time, fading in; dots and a pause button under it.
    '.tshow{display:grid;gap:var(--s2)}.tshow .tshow-slide{margin:0;display:none}.tshow .tshow-slide.is-on{display:grid;gap:var(--s2)}.tshow .tshow-slide.is-enter{animation:tshowIn .6s ease}',
    '@keyframes tshowIn{from{opacity:0}to{opacity:1}}',
    '.tshow-bar{display:flex;align-items:center;gap:var(--s1);flex-wrap:wrap}',
    '.tshow-bar button{min-height:0;padding:0;border:0;background:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:var(--muted)}',
    '.tshow-bar button:focus-visible{outline:2px solid var(--vetro-focus,var(--accent));outline-offset:2px}',
    '.tshow-dot::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.45}.tshow-dot[aria-current="true"]{color:var(--accent)}.tshow-dot[aria-current="true"]::before{opacity:1;width:20px;border-radius:4px}',
    '.tshow-pause svg{width:14px;height:14px;fill:currentColor}',
    // Inside the pictures: the guide's channels run up a row at a time (the launcher's rise is in the dashboard, .lp-rise).
    '.tg-scroll{animation:tgScroll 8s infinite}',
    '@keyframes tgScroll{0%,8%{transform:translateY(0)}14%,22%{transform:translateY(-88px)}28%,36%{transform:translateY(-176px)}42%,50%{transform:translateY(-264px)}56%,64%{transform:translateY(-352px)}70%,78%{transform:translateY(-440px)}84%,92%{transform:translateY(-528px)}98%,100%{transform:translateY(-616px)}}',
    '@media (prefers-reduced-motion:reduce){.tshow .tshow-slide.is-enter,.tg-scroll{animation:none}}',
    '.tuner-keys{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:var(--s2)}',
    '.tuner-keys li{display:grid;grid-template-columns:minmax(7.5rem,10rem) minmax(0,1fr);gap:var(--s3);align-items:start;padding:var(--s2) 0;border-bottom:1px solid var(--border)}',
    '.tuner-keys li:last-child{border-bottom:0}',
    '.tuner-keys li>span:last-child{font-size:var(--fs-s);line-height:1.5;color:var(--muted);max-width:var(--vetro-prose-measure)}',
    '.tuner-keycaps{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s1)}',
    // Pictures of the remote's keys (remote-icons.js): the text colour, the lit part in the page accent.
    '.rkey{display:inline-flex;align-items:center;color:var(--text);--remote-accent:var(--accent)}.rkey svg{height:2.5rem;width:auto;display:block}.tuner-keycaps .rkey svg{height:3rem}.tuner-keycaps .rkey[class*=rkey-rocker] svg,.tuner-opens .rkey[class*=rkey-rocker] svg{height:3.25rem}.tuner-opens{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s1)}',
    '.keycap{display:inline-flex;align-items:center;justify-content:center;min-width:2.25rem;min-height:2rem;padding:0 var(--s2);border:1px solid var(--vetro-control-border);border-radius:8px;background:var(--raised);color:var(--text);font:600 var(--fs-s) var(--font-mono)}',
    '.tuner-shots{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4);margin-top:var(--s3)}',
    '@supports(grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))){.tuner-shots{grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))}}',
    '.tuner-shot{margin:0;display:grid;gap:var(--s2);align-content:start}',
    '.tuner-screen{display:block;width:100%;height:auto;aspect-ratio:16/9;border:1px solid var(--border);border-radius:var(--r);background:#0a1120}',
    '.tuner-shot figcaption{display:grid;gap:var(--s1);font-size:var(--fs-s);line-height:1.5;color:var(--muted)}',
    '.tuner-shot figcaption strong{color:var(--text);font-size:1rem;font-weight:600}',
    '.tuner-opens{display:flex;flex-wrap:wrap;gap:var(--s1);align-items:center}',
    '.tuner-opens .keycap{min-height:1.5rem;min-width:1.75rem;font-size:.8125rem}',
    '@media(max-width:620px){.tuner-keys li{grid-template-columns:minmax(0,1fr);gap:var(--s1)}}'
].join('');

module.exports = {keysMarkup: keysMarkup, previewsMarkup: previewsMarkup, slides: slides, guide: guide, defs: DEFS, css: CSS, KEYS: KEYS};
