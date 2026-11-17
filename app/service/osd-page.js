'use strict';
// Pictures of Vetro UI's on-screen displays for the dashboard: the Volume bar on the chosen edge, the osd 123 and the launcher's Control center.
// Drawn at the launcher's screen size (1920 x 1080) with the coordinates, sizes and alphas the native code draws (dock/src/Core/VolumePlacement.cs,
// dock/src/Ui/VolumePill.cs, NumberPad.cs, CardChrome.cs, TaskPanel.cs, AudioCard.cs, Core/TaskPage.cs, read from the preview's scene), so the bar
// moves when the Position menu changes. The material is the TV's panel: slate #243448 at 90% with a white rim at 22% 2 px outside it, a capsule or
// radius 40, no shadow; the focus is the ice capsule (#E4F2FF at 96%) with slate text; light blue only for the level.
// The functions are inlined into the page script (toString), so they are plain ES5 with no template strings, and everything they use is one of
// them (no module-level values). Not screenshots: the TV picture behind them is the launcher preview's sunset (tuner-page.js DEFS).

function osdSvg(label, parts) {
    return '<svg class="tuner-screen osd-screen" viewBox="0 0 1920 1080" role="img" aria-label="' + label + '" font-family="SamsungOneUI, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-weight="500">' +
        '<use href="#tvScene"/>' + parts.join('') + '</svg>';   // the shared TV picture (tuner-page.js DEFS), as in the launcher preview
}

// A rounded box in a colour at an alpha (0..1).
function osdBox(x, y, w, h, r, color, alpha) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + color + '"' + (alpha < 1 ? ' fill-opacity="' + alpha + '"' : '') + '/>';
}

// The panel: the white rim (filled, 2 px outside) under the slate body, as the TV draws pill_rim and pill_bg.
function osdPanel(x, y, w, h, r) {
    return osdBox(x - 2, y - 2, w + 4, h + 4, r + 2, '#fff', 0.22) + osdBox(x, y, w, h, r, '#243448', 0.9);
}

// A text placed by its baseline; weight 500 unless given (600 for names and titles).
function osdText(x, base, size, alpha, str, anchor, color, weight) {
    return '<text x="' + x + '" y="' + base + '" font-size="' + size + '"' + (weight ? ' font-weight="' + weight + '"' : '') + ' fill="' + (color || '#fff') + '"' +
        (alpha < 1 ? ' fill-opacity="' + alpha + '"' : '') + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + str + '</text>';
}

// The TV's glyphs (dock/res, 96 px pictures drawn at 40), as outlines in their 96 px grid: the speaker with 0..2 level bars (vol_icon_N), the
// television (out_tv), the Bluetooth rune (out_bt) and the tick (out_check).
function osdGlyph(name, x, y, size, color, alpha) {
    var paths = {
        speaker1: 'M12 34H38L62 13V85L38 64H12Z M75 37V59',
        speaker2: 'M12 34H38L62 13V85L38 64H12Z M75 37V59 M87 33V67',
        tv: 'M13 35H85V82H13Z M30 14 48 31 66 14',
        bt: 'M26 30 70 64 48 84V12L70 32 26 66',
        check: 'M15 52 33 69 82 26'
    };
    return '<svg x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" viewBox="0 0 96 96"><path d="' + paths[name] + '" fill="none" stroke="' + (color || '#fff') + '" stroke-opacity="' + alpha +
        '" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// The Volume bar: 88 x 480 on the left or right edge, 640 x 88 at the top or bottom, 96 px from the edge, centred on the other axis. A capsule
// track in white .16 that fills in light blue from the foot (vertical) or from the left (horizontal), the level (32 px, .95) and the speaker.
function osdVolumePreview(edge, level) {
    var vertical = edge !== 'top' && edge !== 'bottom', w = vertical ? 88 : 640, h = vertical ? 480 : 88, m = 96;
    var x = edge === 'left' || !edge ? m : edge === 'right' ? 1920 - m - w : (1920 - w) / 2;
    var y = edge === 'top' ? m : edge === 'bottom' ? 1080 - m - h : (1080 - h) / 2;
    var f = Math.max(0, Math.min(100, level)) / 100, v = Math.round(f * 100), icon = v < 40 ? 'speaker1' : 'speaker2', parts = [osdPanel(x, y, w, h, 44)];
    var tx, ty, tw, th;
    if (vertical) { tx = x + 12; ty = y + 56; tw = w - 24; th = h - 56 - 64 - 12; }
    else { tx = x + 80; ty = y + 12; tw = w - 80 - 100; th = h - 24; }
    parts.push(osdBox(tx, ty, tw, th, 32, '#fff', 0.16));
    // The level is the whole capsule seen through a window that grows (the TV clips it), so a low level is flat at its top.
    var fl = Math.round((vertical ? th : tw) * f);
    if (fl > 0) {
        parts.push(vertical ? '<svg x="' + tx + '" y="' + (ty + th - fl) + '" width="' + tw + '" height="' + fl + '">' + osdBox(0, fl - th, tw, th, 32, '#a5d8ff', 1) + '</svg>'
            : '<svg x="' + tx + '" y="' + ty + '" width="' + fl + '" height="' + th + '">' + osdBox(0, 0, tw, th, 32, '#a5d8ff', 1) + '</svg>');
    }
    if (vertical) {
        parts.push(osdText(x + w / 2, y + 44, 32, 0.95, v, 'middle'));
        parts.push(osdGlyph(icon, x + (w - 40) / 2, y + h - 58, 40, '#fff', 0.95));
    } else {
        parts.push(osdText(x + w - 28, y + 56, 32, 0.95, v, 'end'));
        parts.push(osdGlyph(icon, x + 24, y + 24, 40, '#fff', 0.95));
    }
    return osdSvg('The volume bar on the ' + (edge || 'left') + ' edge of the screen, at level ' + v + '.', parts);
}

// The osd 123, as dock/src/Ui/NumberPad.cs lays it out: a capsule 1008 x 96 centred at the bottom (y 908) with the digits 1 to 0 and the dash,
// 72 px each, then backspace and the palette that leads to the colour keys (its four dots in the colour keys' colours, in their order: red, green,
// yellow, blue, along the arc from the lower left over the top); above it, the number typed so far in a chip at the left and the Done chip at the
// right (slate, no rim). The focus is the ice capsule. Glyphs: Phosphor (MIT).
function osdPadPreview() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'bs', 'palette'], focus = 2, bx = 456, by = 908, parts = [];
    var BS = 'M216,40H68.53a16.08,16.08,0,0,0-13.72,7.77L9.14,123.88a8,8,0,0,0,0,8.24l45.67,76.11A16.08,16.08,0,0,0,68.53,216H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM61.67,204.12,68.53,200h0ZM216,200H68.53l-43.2-72,43.2-72H216ZM106.34,146.34,124.69,128l-18.35-18.34a8,8,0,0,1,11.32-11.32L136,116.69l18.34-18.35a8,8,0,0,1,11.32,11.32L147.31,128l18.35,18.34a8,8,0,0,1-11.32,11.32L136,139.31l-18.34,18.35a8,8,0,0,1-11.32-11.32Z', PAL = 'M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Zm13,93.71A15.89,15.89,0,0,1,198.21,160H152a32,32,0,0,0-32,32,16,16,0,0,1-21.31,15.07C62.49,194.3,40,164,40,128a88,88,0,0,1,87.09-88h.9a88.35,88.35,0,0,1,88,87.25A88.86,88.86,0,0,1,213.81,147.6Z';
    var DOTS = [[84, 156, '#E5484D'], [84, 100, '#30A46C'], [128, 76, '#F2B01E'], [172, 100, '#3E7BFA']];
    parts.push(osdPanel(bx, by, 1008, 96, 48));
    parts.push(osdBox(bx, 844, 96, 52, 26, '#243448', 0.9), osdText(bx + 28, 883, 36, 1, '12'));                      // the number typed so far
    parts.push(osdBox(1348, 844, 116, 52, 26, '#243448', 0.9), osdText(1406, 880, 26, 1, 'Done', 'middle'));
    var cx = bx + 24;
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i], on = i === focus, mid;
        if (k === 'bs') cx += 24;
        mid = cx + 36;
        if (on) parts.push(osdBox(cx, by + 12, 72, 72, 36, '#e4f2ff', 0.96));
        if (k === 'bs' || k === 'palette') {
            parts.push('<svg x="' + (mid - 20) + '" y="' + (by + 28) + '" width="40" height="40" viewBox="0 0 256 256"><path d="' + (k === 'bs' ? BS : PAL) + '" fill="#fff" fill-opacity=".92"/>' +
                (k === 'palette' ? DOTS.map(function (d) { return '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="14" fill="' + d[2] + '"/>'; }).join('') : '') + '</svg>');
        } else parts.push(osdText(mid, by + 61, 36, on ? 1 : 0.92, k, 'middle', on ? '#243448' : null));
        cx += 72;
    }
    return osdSvg('The Number pad at the bottom of the screen: the digits 1 to 0, a dash, backspace and a palette key in one row, Done above on the right; 12 typed, 3 selected.', parts);
}

// The launcher's Control center (Down from the apps row): its two default cards side by side, the Task manager and the Audio output, 520 px wide
// and 32 px apart, centred on x 960 with their bottom on the line of the dock bar (y 994), as tall as the longer list: a 70 px header after 18 px,
// 76 px rows, a 54 px footer and 10 px under it (dock/src/Core/TaskPage.cs). The Task manager has the focus: its first row is on the ice capsule,
// its key hint at 85 / 55% (keys / words), the other card's at 40 / 30%. The apps, figures and speakers are examples; the app icons are stand-ins.
function osdTasksPreview() {
    var parts = [], w = 520, gap = 32, rows = 4, h = 18 + 70 + rows * 76 + 54 + 10, x0 = (1920 - 2 * w - gap) / 2, y = 994 - h, list = y + 88;
    function card(x, title, titleW, sub, focused, foot) {
        var j, ka = focused ? '.85' : '.4', ta = focused ? 0.55 : 0.3;
        parts.push(osdPanel(x, y, w, h, 40));
        parts.push(osdText(x + 35, y + 54, 30, 1, title, null, null, 600));
        if (sub) parts.push(osdText(x + 35 + titleW + 18, y + 54, 22, 0.6, sub));
        if (focused) parts.push(osdBox(x + 16, list + 4, w - 32, 68, 34, '#e4f2ff', 0.96));
        // The footer as the launcher draws it (CardChrome.cs): the remote's keys as pictures (remote-icons.js, when the page has them) and
        // short words (22 px), at the places the launcher puts them (keys 50 px above the card's foot, words on the baseline 24 px above it).
        for (j = 0; j < foot.length; j++) {
            if (foot[j][0] === 'k') {
                var pic = typeof REMOTE_ICONS !== 'undefined' && REMOTE_ICONS[foot[j][1]];
                if (pic) parts.push(pic.replace('<svg ', '<svg x="' + (x + foot[j][2]) + '" y="' + (y + h - 50) + '" width="34" height="34" style="color:#fff;opacity:' + ka + '" '));
            } else parts.push(osdText(x + foot[j][2], y + h - 24, 22, ta, foot[j][1]));
        }
    }
    card(x0, 'Running apps', 181, '612 MB of memory free', true,
        [['k', 'pad-ok', 32], ['t', 'open', 75], ['t', 'Hold', 163], ['k', 'pad-ok', 216], ['t', 'close', 259], ['k', 'pad-up', 348], ['k', 'back', 384], ['t', 'return', 427]]);
    var apps = [['Netflix', '412 MB', '#b20710'], ['YouTube', '286 MB', '#d42020'], ['Samsung Home', '198 MB', '#1c5bd6'], ['Plex', '121 MB', '#3a3f45']], i;
    for (i = 0; i < apps.length; i++) {
        var top = list + i * 76, on = i === 0, ink = on ? '#243448' : null, a = on ? 1 : 0.85;
        parts.push('<g opacity="' + a + '">' + osdBox(x0 + 34, top + 12, 52, 52, 12, apps[i][2], 1) + osdText(x0 + 60, top + 46, 22, 1, apps[i][0].charAt(0), 'middle', null, 600) + '</g>');
        parts.push(osdText(x0 + 109, top + 47, 27, a, apps[i][0], null, ink, 600));
        parts.push(osdText(x0 + 487, top + 47, 24, a, apps[i][1], 'end', ink));
    }
    var x1 = x0 + w + gap, outs = [['TV speakers', 'tv', true], ['Soundbar', 'bt', false], ['Headphones', 'bt', false]];
    card(x1, 'Audio output', 174, '', false,
        [['k', 'pad-ok', 103], ['t', 'play here', 146], ['k', 'pad-up', 276], ['k', 'back', 312], ['t', 'return', 355]]);
    for (i = 0; i < outs.length; i++) {
        var row = list + i * 76;
        parts.push(osdGlyph(outs[i][1], x1 + 40, row + 18, 40, '#fff', 0.85));
        parts.push(osdText(x1 + 109, row + 47, 27, 0.85, outs[i][0], null, null, 600));
        if (outs[i][2]) parts.push(osdGlyph('check', x1 + 446, row + 18, 40, '#fff', 0.85));
    }
    return osdSvg('The launcher’s Control center: two example cards side by side, the running apps with their memory (the first selected) and the sound outputs (TV speakers ticked).', parts);
}

var FUNCTIONS = [osdSvg, osdBox, osdPanel, osdText, osdGlyph, osdVolumePreview, osdPadPreview, osdTasksPreview];
function pageSource() { return FUNCTIONS.map(function (f) { return f.toString(); }).join('\n'); }

module.exports = {volumePreview: osdVolumePreview, padPreview: osdPadPreview, tasksPreview: osdTasksPreview, pageSource: pageSource};
