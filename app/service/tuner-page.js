'use strict';
// The fixed part of the Vetro TV Tuner page in the dashboard: the remote buttons and the pictures of what the tuner draws on the TV.
// The switch and the live state are drawn by the dashboard's script (renderTuner); everything here is static markup.
//
// The pictures are SVG drawn at the tuner's own screen size (1920 x 1080) with the coordinates, sizes and alphas the native code draws
// (tuner/src/Ui/Views.cs, InfoView.cs, GuideView.cs, Core/GuideScene.cs, read from the preview's scene), so they scale like the real
// screen and show its real layout. They are not screenshots: a screenshot of the TV cannot show the video plane, the halo under the
// veil's texts is left out, and the channels, logos and programmes in them are samples.
//
// Plain ES5, like every module the TV loads.

var FONT = 'SamsungOneUI, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
// The two materials of the TV (design/DESIGN.md, tuner/src/Ui/Surface.cs Theme): the veil (Banner, Info, guide) and the panel (Channel list,
// Channel pad, Audio toast): slate #243448 at 90% with a white rim at 22% 2 px outside it, radius 40 or a capsule, no shadow. The focus is the
// ice capsule (#E4F2FF at 96%) with slate text; light blue only for progress and the guide's now line.
var SLATE = '#243448', ICE = '#e4f2ff', LIGHT = '#a5d8ff';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function n(v) { return String(Math.round(v)); }

// ---- drawing helpers (the TV's coordinates, alphas as 0..1) ----
function box(x, y, w, h, radius, color, alpha) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" rx="' + n(radius) + '" fill="' + color + '"' + (alpha < 1 ? ' fill-opacity="' + alpha + '"' : '') + '/>';
}
// A text placed by its baseline, as the tuner places it (TextMetrics.cs); weight 200, 500 or 600; anchor 'end' or 'middle' where the TV right-aligns or centres.
function text(x, base, size, weight, alpha, str, anchor, color) {
    return '<text x="' + n(x) + '" y="' + n(base) + '" font-size="' + size + '"' + (weight !== 500 ? ' font-weight="' + weight + '"' : '') +
        ' fill="' + (color || '#fff') + '"' + (alpha < 1 ? ' fill-opacity="' + alpha + '"' : '') + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(str) + '</text>';
}
// The width a text is given on the TV, estimated (the page has no SamsungOneUI): 0.45 of its size per letter, measured on the preview's texts.
function width(str, size) { return Math.round(String(str).length * size * 0.45); }
// Cut with an ellipsis to fit, as Surface.SetFitted does.
function fitted(str, size, maxW) {
    if (width(str, size) <= maxW) return str;
    var keep = Math.max(1, Math.floor(maxW / (size * 0.45)) - 1);
    return str.slice(0, keep).replace(/\s+$/, '') + '…';
}
// The panel: the white rim (filled, 2 px outside) under the slate body, both pictures in the TV (pill_rim, pill_bg).
function panel(x, y, w, h, radius) {
    return box(x - 2, y - 2, w + 4, h + 4, radius + 2, '#fff', 0.22) + box(x, y, w, h, radius, SLATE, 0.9);
}
// The veil from the bottom-left corner (veil_corner.png, stretched): Banner 1700 x 600 at .58, Info 2500 x 1000 at .66, guide 6400 x 3400 at .94.
function veil(w, h, alpha) {
    return '<rect x="0" y="' + (1080 - h) + '" width="' + w + '" height="' + h + '" fill="url(#tpVeil)" opacity="' + alpha + '"/>';
}
// A channel logo stand-in, as the mock-ups draw it (design/tuner.html): a coloured disc with the initials. The TV shows the channel's saved picture.
function logo(name, x, y, size) {
    name = name ? String(name) : 'TV';
    var h = 0, i;
    for (i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    var initials = name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'TV';
    return '<circle cx="' + n(x + size / 2) + '" cy="' + n(y + size / 2) + '" r="' + n(size / 2) + '" fill="hsl(' + h + ',55%,40%)"/>' +
        text(x + size / 2, y + size / 2 + size * 0.11, Math.round(size * 0.3), 600, 1, initials, 'middle');
}
// The progress row of the Banner and Info (ProgressRow.cs): times at both ends (26 px, .76), the 6 px track (white .22) from x0 to x1, the
// light blue progress with its round head on the point reached, "N min left" (600, white) centred on the head; a time it would come within
// 28 px of gives way.
function progress(x0, x1, lineY, start, end, left, f) {
    var head = Math.round(x0 + (x1 - x0) * f), base = lineY - 24, lw = width(left, 26), lx = head - lw / 2, out = [], hideStart = false, hideEnd = false;
    if (lx > x1 - width(end, 26) - 28 - lw) { hideEnd = true; lx = Math.min(lx, x1 - lw); } else if (lx < x0 + width(start, 26) + 28) { hideStart = true; lx = Math.max(lx, x0); }
    out.push(box(x0, lineY, x1 - x0, 6, 3, '#fff', 0.22), box(x0, lineY, head - x0, 6, 3, LIGHT, 1));
    out.push('<circle cx="' + head + '" cy="' + (lineY + 3) + '" r="12" fill="' + LIGHT + '" fill-opacity=".22"/><circle cx="' + head + '" cy="' + (lineY + 3) + '" r="7" fill="' + LIGHT + '"/>');
    if (!hideStart) out.push(text(x0, base, 26, 500, 0.76, start));
    if (!hideEnd) out.push(text(x1, base, 26, 500, 0.76, end, 'end'));
    out.push(text(lx + lw / 2, base, 26, 600, 1, left, 'middle'));
    return out.join('');
}
// One picture: the TV picture (the launcher preview's sunset), the parts, a text for screen readers.
function screen(label, parts) {
    return '<svg class="tuner-screen" viewBox="0 0 1920 1080" role="img" aria-label="' + esc(label) + '" font-family="' + FONT + '" font-weight="500">' +
        '<use href="#tvScene" xlink:href="#tvScene"/>' + parts.join('') + '</svg>';
}

// ---- the six views (tuner/src/Ui/Views.cs, InfoView.cs, GuideView.cs, Core/GuideScene.cs) ----
// Sample channels, by number. The same ones appear in every picture, with Cinema HD (9) as the channel being watched; it is 21:48 and
// Evening Film (21:20 - 23:05) is on air.
var NAMES = {4: 'Weather', 5: 'Shopping', 6: 'Retro', 7: 'Talk', 8: 'News 24', 9: 'Cinema HD', 10: 'Sport 1', 11: 'Docs', 12: 'Kids', 13: 'Music', 14: 'Nature'};
var ON_AIR = 28 / 105;   // Evening Film, 28 of its 105 minutes

// The Banner: on the veil, one block x 96..936; the number (128, weight 200) on the baseline of the programme, the name (56, 600) 30 px after it,
// the progress row with its track at y 992.
function banner() {
    return screen('The Banner at the bottom left of the screen: channel 9, Cinema HD, the film on air, its times, a progress bar and the time left.', [
        veil(1700, 600, 0.58),
        text(96, 917, 128, 200, 1, '9'), text(194, 868, 56, 600, 1, 'Cinema HD'), logo('Cinema HD', 864, 818, 72),
        text(194, 917, 32, 500, 0.92, 'Evening Film'),
        progress(96, 936, 992, '21:20', '23:05', '1 h 17 min left', ON_AIR)
    ]);
}

// The Channel list: a panel at the right edge (x 1284..1824, y 164..916, radius 40), eleven rows of 64 px, numbers right-aligned at 1376,
// a 44 px logo, names at 1456; the selected row on the ice capsule.
function channelList() {
    var X = 1284, Y = 164, W = 540, RowH = 64, rows = 11, selected = 5, parts = [panel(X, Y, W, rows * RowH + 48, 40)];
    for (var r = 0; r < rows; r++) {
        var y = Y + 24 + r * RowH, sel = r === selected, num = 4 + r;
        if (sel) parts.push(box(X + 16, y + 2, W - 32, RowH - 4, 30, ICE, 0.96));
        parts.push(text(X + 92, y + 43, 32, 500, sel ? 1 : 0.7, String(num), 'end', sel ? SLATE : null));
        parts.push(logo(NAMES[num], X + 114, y + 10, 44));
        parts.push(text(X + 172, y + 43, 32, 500, 1, NAMES[num], null, sel ? SLATE : null));
    }
    return screen('The Channel list on the right of the screen: eleven channels with their numbers and logos, Cinema HD selected.', parts);
}

// The Channel pad: a panel at the right edge (x 1284..1824, y 232..848, radius 40), "Channel number", the typed number (76), the channel it
// goes to, and twelve keys of 148 x 76 in white .14, the focus on the ice capsule.
function numberPad() {
    var X = 1284, Y = 232, KeyW = 148, KeyH = 76, labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Delete', '0', 'Go'], focus = 4;
    var parts = [panel(X, Y, 540, 616, 40), text(X + 34, Y + 54, 26, 500, 0.7, 'Channel number'), text(X + 34, Y + 133, 76, 500, 1, '9'),
        logo('Cinema HD', X + 34, Y + 158, 44), text(X + 86, Y + 192, 28, 500, 0.7, 'Cinema HD')];
    for (var i = 0; i < 12; i++) {
        var x = X + 34 + (i % 3) * (KeyW + 14), y = Y + 232 + Math.floor(i / 3) * (KeyH + 14), sel = i === focus, long = labels[i].length > 1;
        parts.push(sel ? box(x, y, KeyW, KeyH, 38, ICE, 0.96) : box(x, y, KeyW, KeyH, 38, '#fff', 0.14));
        parts.push(text(x + KeyW / 2, y + (long ? 48 : 52), long ? 28 : 40, 500, 1, labels[i], 'middle', sel ? SLATE : null));
    }
    return screen('The Channel pad on the right of the screen: the typed number 9 and the channel it goes to, Cinema HD, over a grid of keys 1 to 9, Delete, 0 and Go.', parts);
}

// The guide: no card, the veil grown over the whole screen. The programme in focus on top, a time axis from x 400 (8 px a minute, three hours
// from 21:30), seven lanes of 88 px from y 346 with the programmes as cells 76 px high (white .09, .16 on air), the now line in light blue and
// the remote's keys at the foot. Programmes are [minutes from the left edge, length, title].
var GUIDE = [
    [[-30, 45, 'Evening News'], [15, 30, 'Weather'], [45, 90, 'The Long Road'], [135, 60, 'Late News']],
    [[-10, 105, 'Evening Film'], [95, 80, 'Late Show'], [175, 40, 'Quiz']],
    [[-30, 60, 'League Match'], [30, 60, 'Replay'], [90, 60, 'Highlights'], [150, 60, 'Golf Round-up']],
    [[-50, 110, 'Ocean Planet'], [60, 120, 'Ancient Cities']],
    [[-15, 45, 'Cartoons'], [30, 45, 'Puppet Club'], [75, 105, 'Adventure Hour']],
    [[-30, 60, 'Concert Live'], [30, 90, 'Top 20'], [120, 60, 'Studio Session']],
    [[-15, 75, 'Wild Rivers'], [60, 60, 'Garden Diary'], [120, 60, 'Night Sky']]
];
var GUIDE_NOW = 18;   // 21:48
// The clock time of a number of minutes from the left edge of the window, which starts at 21:30.
function clock(minutes) {
    var total = 21 * 60 + 30 + minutes, h = Math.floor(total / 60) % 24, m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// The guide's footer as the tuner draws it (GuideScene.Footer): the remote's keys as pictures (remote-icons.js) and a word, at the places the
// tuner puts them (34 px keys at y 982, the words on the baseline 1008).
var FOOTER = [[[['pad-ok', 96]], 'Watch', 138], [[['pad-left', 249], ['pad-right', 285]], 'Time', 327], [[['pad-up', 423], ['pad-down', 459]], 'Channel', 501],
    [[['rocker-ch-both', 632]], 'Page', 692], [[['back', 789]], 'Close', 831]];
function guideFooter() {
    var icons = require('./remote-icons.js').icons, out = '';
    FOOTER.forEach(function (g) {
        g[0].forEach(function (k) {
            var w = k[0] === 'rocker-ch-both' ? 52 : 34;
            out += icons[k[0]].replace('<svg ', '<svg x="' + k[1] + '" y="982" width="' + w + '" height="34" style="color:#fff;opacity:.85" ');
        });
        out += text(g[2], 1008, 24, 500, 0.76, g[1]);
    });
    return out;
}

// The version for the slideshows: the channels run upwards one row at a time, as when Down is held. Fourteen lanes (the seven samples twice)
// move by seven inside a window of seven, so the loop has no seam; no focus capsule, it would not follow.
function guide() {
    var X0 = 400, X1 = 1840, PX = 8, RowsY = 346, RowH = 88, nowX = X0 + GUIDE_NOW * PX;
    var parts = [veil(6400, 3400, 0.94),
        text(96, 123, 64, 600, 1, 'Evening Film'),
        text(96, 177, 30, 500, 0.76, 'Cinema HD   ·   21:20 – 23:05   ·   1 h 45 min'),   // the TV's three spaces (SVG would fold plain ones)
        text(96, 223, 28, 500, 0.7, 'A retired pilot takes a last flight over the coast and meets an old friend.'),
        text(1824, 111, 32, 500, 0.76, 'Sat 7 Nov', 'end'),
        box(X0, 332, X1 - X0, 2, 0, '#fff', 0.16)];
    for (var i = 0; i < 6; i++) parts.push(text(X0 + i * 30 * PX, 312, 26, i % 2 ? 600 : 500, i % 2 ? 1 : 0.76, clock(i * 30)));
    parts.push(box(nowX - 1, 320, 3, 16, 0, LIGHT, 1), box(nowX, RowsY, 2, 7 * RowH, 0, LIGHT, 0.3));
    var lanes = [];
    GUIDE.concat(GUIDE).forEach(function (row, i) {
        var r = i % GUIDE.length, y = i * RowH, cy = y + 6, name = NAMES[8 + r];
        lanes.push(logo(name, 96, y + 16, 56), text(166, y + 32, 24, 500, 0.76, String(8 + r)), text(166, y + 66, 26, 500, 0.76, fitted(name, 26, 222)));
        row.forEach(function (p) {
            var start = Math.max(0, p[0]), end = Math.min(180, p[0] + p[1]);
            if (end <= start) return;
            var x = start === 0 ? X0 : X0 + start * PX + 2, xr = end === 180 ? X1 : X0 + end * PX - 2, onAir = p[0] <= GUIDE_NOW && GUIDE_NOW < p[0] + p[1];
            lanes.push(box(x, cy, xr - x, 76, 20, '#fff', onAir ? 0.16 : 0.09));
            if (xr - x >= 64) lanes.push(text(x + 20, cy + 46, 28, 500, onAir ? 1 : 0.9, fitted(p[2], 28, xr - x - 36)));
        });
    });
    parts.push('<svg x="0" y="' + RowsY + '" width="1920" height="' + (GUIDE.length * RowH) + '" overflow="hidden"><g class="tg-scroll">' + lanes.join('') + '</g></svg>');
    parts.push(guideFooter());
    return screen('The TV guide over the whole screen: the programme in focus with its times and description, a time axis, and seven channels with their programmes as rounded cells.', parts);
}

// Info: the Banner's corner grown up and to the right, a block x 96..1296. Left column: number (64, 200) and name, the programme (72, 600), the
// progress row (track at y 826) and up to three lines of description; right column, right-aligned at 1296: clock (88, 200), date, tuner, audio.
function info() {
    return screen('Info at the bottom left of the screen: channel 9, the film on air in large, its progress and description, what is on next, and on the right the clock, date, tuner and audio track.', [
        veil(2500, 1000, 0.66),
        text(96, 636, 64, 200, 1, '9'), text(150, 636, 36, 600, 0.76, 'Cinema HD'), logo('Cinema HD', 1224, 584, 72),
        text(96, 732, 72, 600, 1, 'Evening Film'),
        progress(96, 936, 826, '21:20', '23:05', '1 h 17 min left', ON_AIR),
        text(96, 891, 30, 500, 0.76, 'A retired pilot takes a last flight over the coast and meets'),
        text(96, 933, 30, 500, 0.76, 'an old friend, who keeps a secret about the plane.'),
        // the Next line, on the baseline of a third line of description: x as the TV puts them ("Next" 63 px wide, the time 74, 20 px apart)
        text(96, 975, 30, 500, 0.64, 'Next'), text(179, 975, 30, 500, 0.76, '23:05'), text(273, 975, 30, 500, 0.76, 'Late Show'),
        text(1300, 849, 88, 200, 1, '21:48', 'end'), text(1296, 900, 26, 500, 0.76, 'Saturday 7 November', 'end'),
        text(1296, 940, 26, 500, 0.76, 'Antenna', 'end'), text(1296, 980, 26, 500, 0.76, 'Audio: Italian', 'end')
    ]);
}

// The Audio toast (Views.cs AudioToastView): a panel at the top right, x 1176..1824, y 96..248, radius 40, two rows. Each row: the remote key
// that changes it (Left, Down; 40 px at x 1216), the label (32, white .76) at x 1272 and the value (32, 600) at x 1432 on the row's baseline
// (155, 211). Drawn as after Down: the Subtitles row is the one just changed (key .85, value 100%), the Audio row is quieter (.40, .55, .70).
function audioToast() {
    var icons = require('./remote-icons.js').icons, rows = [['pad-left', 'Audio', 'Italian', 155, false], ['pad-down', 'Subtitles', 'English', 211, true]], parts = [panel(1176, 96, 648, 152, 40)];
    rows.forEach(function (r, i) {
        var on = r[4];
        parts.push(icons[r[0]].replace('<svg ', '<svg x="1216" y="' + (124 + i * 56) + '" width="40" height="40" style="color:#fff;opacity:' + (on ? '.85' : '.4') + '" '));
        parts.push(text(1272, r[3], 32, 500, on ? 0.76 : 0.55, r[1]), text(1432, r[3], 32, 600, on ? 1 : 0.7, r[2]));
    });
    return screen('The Audio toast at the top right of the screen: Audio Italian, Subtitles English.', parts);
}

// The shared definitions the pictures refer to: the veil's gradient and the TV picture.
var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    // veil_corner.png: #111B2A, a quarter ellipse on the bottom-left corner, full to 40% of the radius, then the baked falloff (sampled from the picture).
    '<radialGradient id="tpVeil" cx="0" cy="1" r="1"><stop offset="0" stop-color="#111b2a"/><stop offset=".4" stop-color="#111b2a"/><stop offset=".5" stop-color="#111b2a" stop-opacity=".96"/><stop offset=".6" stop-color="#111b2a" stop-opacity=".85"/><stop offset=".7" stop-color="#111b2a" stop-opacity=".67"/><stop offset=".75" stop-color="#111b2a" stop-opacity=".51"/><stop offset=".8" stop-color="#111b2a" stop-opacity=".36"/><stop offset=".85" stop-color="#111b2a" stop-opacity=".21"/><stop offset=".9" stop-color="#111b2a" stop-opacity=".11"/><stop offset=".95" stop-color="#111b2a" stop-opacity=".035"/><stop offset="1" stop-color="#111b2a" stop-opacity="0"/></radialGradient>' +
    // The TV picture behind every preview: the same sunset as the launcher's preview (.lp-scene in the dashboard), drawn once
    // here and placed with <use>, so a picture inside a hidden slide still finds it.
    '<linearGradient id="tvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101c3f"/><stop offset=".45" stop-color="#553b73"/><stop offset=".72" stop-color="#d9707a"/><stop offset="1" stop-color="#f6b26b"/></linearGradient><radialGradient id="tvSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff2cf" stop-opacity=".95"/><stop offset=".35" stop-color="#ffc58a" stop-opacity=".5"/><stop offset="1" stop-color="#ffc58a" stop-opacity="0"/></radialGradient><linearGradient id="tvWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a26c"/><stop offset="1" stop-color="#1a2547"/></linearGradient>' +
    '<g id="tvScene"><rect width="1920" height="1080" fill="url(#tvSky)"/><circle cx="1330" cy="640" r="420" fill="url(#tvSun)"/><circle cx="1330" cy="640" r="64" fill="#fff0c9"/><path d="M0 690 220 520 420 640 640 470 880 650 1080 560 1290 690 1500 540 1740 660 1920 590V760H0z" fill="#42375f"/><path d="M0 760 180 640 400 740 640 620 900 760 1160 650 1420 770 1680 670 1920 740V800H0z" fill="#26274a"/><rect y="780" width="1920" height="300" fill="url(#tvWater)"/><rect x="1250" y="790" width="160" height="6" rx="3" fill="#ffe3b3" opacity=".7"/><rect x="1280" y="820" width="100" height="5" rx="2" fill="#ffe3b3" opacity=".45"/><rect x="1300" y="850" width="60" height="4" rx="2" fill="#ffe3b3" opacity=".3"/><path d="M0 900 0 1080H1920V920C1700 880 1500 930 1250 900 900 860 600 930 0 900z" fill="#0d1530" opacity=".55"/></g>' +
    '</defs></svg>';

// ---- the remote ----
// A key of the Smart Remote is drawn as its picture (app/design-system/remote); keys it does not have stay text keycaps.
var remoteKey = require('./remote-icons.js').key;
var KEY_PICTURES = {'CH +': 'rocker-ch-up', 'CH \u2212': 'rocker-ch-down', 'OK': 'pad-ok', '\u25b2': 'pad-up', '\u25c0': 'pad-left', '\u25b6': 'pad-right'};
var KEY_NAMES = {'\u25b2': 'Up', '\u25c0': 'Left', '\u25b6': 'Right'};
function caps() {
    return Array.prototype.slice.call(arguments).map(function (k) {
        return KEY_PICTURES[k] ? remoteKey(KEY_PICTURES[k], KEY_NAMES[k] || k) : '<kbd class="keycap">' + esc(k) + '</kbd>';
    }).join(' ').replace(remoteKey('rocker-ch-up', 'CH +') + ' ' + remoteKey('rocker-ch-down', 'CH \u2212'), remoteKey('rocker-ch-both', 'CH + or CH \u2212'));
}
var KEYS = [
    [caps('CH +', 'CH \u2212'), 'Next and previous channel.'],
    [caps('OK'), 'Channel list. In the list, tunes.'],
    [caps('\u25b2'), 'TV guide. Hold to scroll faster.'],
    [caps('\u25c0'), 'Audio track; then Down for subtitles. In the guide, earlier.'],
    [caps('\u25b6'), 'Channel pad. In the guide, later.']
];

function keysMarkup() {
    return '<ul class="tuner-keys">' + KEYS.map(function (k) { return '<li><span class="tuner-keycaps">' + k[0] + '</span><span>' + esc(k[1]) + '</span></li>'; }).join('') + '</ul>';
}

// The tuner's screens for the slideshow at the top of the Live TV tab (the dashboard draws and turns them), by the screens' names.
function slides() {
    return [
        {title: 'Banner', keys: caps('CH +', 'CH \u2212'), text: 'Number, name and what’s on.', svg: banner()},
        {title: 'TV guide', keys: caps('\u25b2'), text: 'Seven channels, three hours.', svg: guide()},
        {title: 'Channel list', keys: caps('OK'), text: 'Every channel, in order.', svg: channelList()},
        {title: 'Channel pad', keys: caps('\u25b6'), text: 'See the channel before you tune.', svg: numberPad()},
        {title: 'Info', keys: caps('Info'), text: 'Programme, description, clock and audio.', svg: info()},
        {title: 'Audio toast', keys: caps('\u25c0'), text: 'Audio track; Down changes subtitles.', svg: audioToast()}
    ];
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
    '.tuner-keys li{display:grid;grid-template-columns:minmax(7.5rem,10rem) minmax(0,1fr);gap:var(--s3);align-items:center;padding:var(--s2) 0;border-bottom:1px solid var(--border)}',
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

module.exports = {keysMarkup: keysMarkup, slides: slides, guide: guide, defs: DEFS, css: CSS, KEYS: KEYS};
