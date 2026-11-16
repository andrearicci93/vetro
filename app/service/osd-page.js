'use strict';
// Pictures of Vetro UI's on-screen displays for the dashboard: the volume bar on the chosen edge, the number pad and
// the launcher's Control center.
// Drawn at the launcher's screen size (1920 x 1080) with the numbers of dock/src/Core/VolumePlacement.cs and dock/src/Ui/NumberPad.cs,
// so the bar moves when the Position menu changes. The functions are inlined into the page script (toString), so they are plain
// ES5 with no template strings. Not screenshots: the TV picture behind them is the launcher preview's sunset (tuner-page.js DEFS).

function osdSvg(label, parts) {
    return '<svg class="tuner-screen osd-screen" viewBox="0 0 1920 1080" role="img" aria-label="' + label + '" font-family="SamsungOneUI, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-weight="500">' +
        '<use href="#tvScene"/>' + parts.join('') + '</svg>';   // the shared TV picture (tuner-page.js DEFS), as in the launcher preview
}

// The volume bar: 88 x 480 on the left or right edge, 640 x 88 at the top or bottom, 96 px from the edge, the level in light blue.
function osdVolumePreview(edge, level) {
    var vertical = edge !== 'top' && edge !== 'bottom', w = vertical ? 88 : 640, h = vertical ? 480 : 88, m = 96;
    var x = edge === 'left' || !edge ? m : edge === 'right' ? 1920 - m - w : (1920 - w) / 2;
    var y = edge === 'top' ? m : edge === 'bottom' ? 1080 - m - h : (1080 - h) / 2;
    var f = Math.max(0, Math.min(100, level)) / 100, parts = [];
    parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="44" fill="#243448" fill-opacity=".92" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>');
    if (vertical) {
        var tx = x + 12, tw = w - 24, ty = y + 56, th = h - 56 - 64 - 12, fh = Math.round(th * f);
        parts.push('<rect x="' + tx + '" y="' + ty + '" width="' + tw + '" height="' + th + '" rx="32" fill="#fff" fill-opacity=".14"/>');
        parts.push('<rect x="' + tx + '" y="' + (ty + th - fh) + '" width="' + tw + '" height="' + fh + '" rx="32" fill="#a5d8ff"/>');
        parts.push('<text x="' + (x + w / 2) + '" y="' + (y + 42) + '" font-size="32" fill="#fff" text-anchor="middle">' + Math.round(f * 100) + '</text>');
        parts.push(osdSpeaker(x + (w - 40) / 2, y + h - 12 - 40 - 6));
    } else {
        var hx = x + 80, hw = w - 80 - 100, hy = y + 12, hh = h - 24, fw = Math.round(hw * f);
        parts.push('<rect x="' + hx + '" y="' + hy + '" width="' + hw + '" height="' + hh + '" rx="32" fill="#fff" fill-opacity=".14"/>');
        parts.push('<rect x="' + hx + '" y="' + hy + '" width="' + fw + '" height="' + hh + '" rx="32" fill="#a5d8ff"/>');
        parts.push('<text x="' + (x + w - 28) + '" y="' + (y + h / 2 + 11) + '" font-size="32" fill="#fff" text-anchor="end">' + Math.round(f * 100) + '</text>');
        parts.push(osdSpeaker(x + 24, y + (h - 40) / 2));
    }
    return osdSvg('The volume bar on the ' + (edge || 'left') + ' edge of the screen, at level ' + Math.round(f * 100) + '.', parts);
}

function osdSpeaker(x, y) {
    return '<g transform="translate(' + x + ' ' + y + ')" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 15h7l9-8v26l-9-8H6z" fill="#fff"/><path d="M28 13c3 4 3 10 0 14M32 9c5 6 5 16 0 22"/></g>';
}

// The number pad, as dock/src/Ui/NumberPad.cs lays it out (1100 x 200 window, 64 px above the bottom edge): a capsule 96 px tall with the digits
// 1 to 0 and the dash, 72 px each, then backspace and the palette that leads to the colour keys (its four dots in the colour keys' colours, in
// their order: red, green, yellow, blue, along the arc from the lower left over the top); the number typed so far at the top left and the Done chip at the top right. Glyphs: Phosphor (MIT).
function osdPadPreview() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'bs', 'palette'], gaps = {bs: 24}, cw = 72, bw = 48 + 11 * cw + (24 + cw) + cw;
    var bx = (1920 - bw) / 2, win = 1080 - 200 - 64, by = win + 92, parts = [];
    var BS = 'M216,40H68.53a16.08,16.08,0,0,0-13.72,7.77L9.14,123.88a8,8,0,0,0,0,8.24l45.67,76.11A16.08,16.08,0,0,0,68.53,216H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM61.67,204.12,68.53,200h0ZM216,200H68.53l-43.2-72,43.2-72H216ZM106.34,146.34,124.69,128l-18.35-18.34a8,8,0,0,1,11.32-11.32L136,116.69l18.34-18.35a8,8,0,0,1,11.32,11.32L147.31,128l18.35,18.34a8,8,0,0,1-11.32,11.32L136,139.31l-18.34,18.35a8,8,0,0,1-11.32-11.32Z', PAL = 'M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Zm13,93.71A15.89,15.89,0,0,1,198.21,160H152a32,32,0,0,0-32,32,16,16,0,0,1-21.31,15.07C62.49,194.3,40,164,40,128a88,88,0,0,1,87.09-88h.9a88.35,88.35,0,0,1,88,87.25A88.86,88.86,0,0,1,213.81,147.6Z';
    var DOTS = [[84, 156, '#E5484D'], [84, 100, '#30A46C'], [128, 76, '#F2B01E'], [172, 100, '#3E7BFA']];
    parts.push('<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="96" rx="48" fill="#243448" fill-opacity=".92" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>');
    parts.push('<text x="' + (bx + 12) + '" y="' + (win + 68) + '" font-size="68" fill="#fff">12</text>');
    parts.push('<rect x="' + (bx + bw - 112) + '" y="' + (win + 28) + '" width="112" height="52" rx="26" fill="#243448" fill-opacity=".92" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>');
    parts.push('<text x="' + (bx + bw - 56) + '" y="' + (win + 63) + '" font-size="26" fill="#fff" text-anchor="middle">Done</text>');
    var cx = bx + 24;
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i], mid, ink = i === 2 ? '#243448' : '#fff';
        cx += gaps[k] || 0; mid = cx + cw / 2;
        if (i === 2) parts.push('<rect x="' + cx + '" y="' + (win + 104) + '" width="' + cw + '" height="72" rx="36" fill="#e4f2ff" fill-opacity=".96"/>');
        if (k === 'bs' || k === 'palette') {
            parts.push('<svg x="' + (mid - 20) + '" y="' + (win + 120) + '" width="40" height="40" viewBox="0 0 256 256"><path d="' + (k === 'bs' ? BS : PAL) + '" fill="#fff" fill-opacity=".92"/>' +
                (k === 'palette' ? DOTS.map(function (d) { return '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="14" fill="' + d[2] + '"/>'; }).join('') : '') + '</svg>');
        } else parts.push('<text x="' + mid + '" y="' + (win + 152) + '" font-size="36" fill="' + ink + '" text-anchor="middle">' + k + '</text>');
        cx += cw;
    }
    return osdSvg('The number pad at the bottom of the screen: the digits 1 to 0, a dash, backspace and a palette key with four coloured dots in one row, Done above on the right, 12 typed so far, 3 selected.', parts);
}

// The launcher's Control center (Down from the apps row): two of its cards side by side, the Task manager and the Audio output,
// 520 px wide and 32 px apart, standing where the bar ends, with a 70 px header, 76 px rows and a 54 px footer (dock/src/Core/TaskPage.cs).
// The Task manager has the focus: its first row is on the ice capsule. The apps, figures and speakers are examples.
function osdTasksPreview() {
    var parts = [], w = 520, gap = 32, rows = 4, h = 18 + 70 + rows * 76 + 54 + 10, x0 = (1920 - 2 * w - gap) / 2, y = 1080 - 40 - 46 - h, list = y + 18 + 70;
    function card(x, title, sub, items, focused, foot) {
        var memRight = x + w - 24 - 14, iconX = x + 24 + 10, nameX = iconX + 52 + 22, i, j;
        parts.push('<rect x="' + (x - 2) + '" y="' + (y - 2) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" rx="42" fill="#fff" fill-opacity=".22"/>');
        parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="40" fill="#243448" fill-opacity=".96"/>');
        parts.push('<text x="' + (x + 34) + '" y="' + (y + 18 + 35) + '" font-size="30" font-weight="600" fill="#fff">' + title + '</text>');
        parts.push('<text x="' + (x + 34 + title.length * 15 + 18) + '" y="' + (y + 18 + 35) + '" font-size="22" fill="#fff" fill-opacity=".6">' + sub + '</text>');
        for (i = 0; i < items.length; i++) {
            var top = list + i * 76, on = focused && i === 0, ink = on ? '#243448' : '#fff';
            if (on) parts.push('<rect x="' + (x + 16) + '" y="' + (top + 4) + '" width="' + (w - 32) + '" height="68" rx="34" fill="#e4f2ff"/>');
            parts.push('<rect x="' + iconX + '" y="' + (top + 12) + '" width="52" height="52" rx="12" fill="' + ink + '" fill-opacity=".14"/>');
            parts.push('<text x="' + (iconX + 26) + '" y="' + (top + 46) + '" font-size="22" fill="' + ink + '" text-anchor="middle">' + items[i][0].slice(0, 2) + '</text>');
            parts.push('<text x="' + nameX + '" y="' + (top + 47) + '" font-size="27" font-weight="600" fill="' + ink + '">' + items[i][0] + '</text>');
            parts.push('<text x="' + memRight + '" y="' + (top + 47) + '" font-size="24" fill="' + ink + '" text-anchor="end">' + items[i][1] + '</text>');
        }
        // The footer as the launcher draws it (CardChrome.cs): the remote's keys as pictures (remote-icons.js, when the page has
        // them) and short words, 34 px keys, 8 px inside a group, 40 px between groups. Word widths are estimated (21 px font).
        var fw = 0, fy = list + rows * 76 + 14, fx;
        for (j = 0; j < foot.length; j++) fw += (foot[j][0] === 'k' ? 34 : Math.round(foot[j][1].length * 10.5)) + foot[j][2];
        fx = x + w / 2 - fw / 2;
        for (j = 0; j < foot.length; j++) {
            if (foot[j][0] === 'k') {
                var pic = typeof REMOTE_ICONS !== 'undefined' && REMOTE_ICONS[foot[j][1]];
                if (pic) parts.push(pic.replace('<svg ', '<svg x="' + fx + '" y="' + (fy - 4) + '" width="34" height="34" style="color:#fff;opacity:' + (focused ? '.85' : '.4') + '" '));
                fx += 34;
            } else {
                parts.push('<text x="' + fx + '" y="' + (fy + 20) + '" font-size="21" fill="#fff" fill-opacity="' + (focused ? '.55' : '.3') + '">' + foot[j][1] + '</text>');
                fx += Math.round(foot[j][1].length * 10.5);
            }
            fx += foot[j][2];
        }
    }
    card(x0, 'Running apps', '612 MB free', [['Netflix', '412 MB'], ['YouTube', '286 MB'], ['Samsung Home', '198 MB'], ['Plex', '121 MB']], true,
        [['k', 'pad-ok', 8], ['t', 'open', 40], ['t', 'Hold', 8], ['k', 'pad-ok', 8], ['t', 'close', 40], ['k', 'pad-up', 2], ['k', 'back', 8], ['t', 'return', 0]]);
    card(x0 + w + gap, 'Audio output', '', [['TV speakers', '✓'], ['Soundbar', ''], ['Headphones', '']], false,
        [['k', 'pad-ok', 8], ['t', 'play here', 40], ['k', 'pad-up', 2], ['k', 'back', 8], ['t', 'return', 0]]);
    return osdSvg('The launcher’s Control center: two cards side by side, the running apps with their memory (the first one selected) and the sound outputs (the TV speakers ticked). Example apps and speakers.', parts);
}

var FUNCTIONS = [osdSvg, osdVolumePreview, osdSpeaker, osdPadPreview, osdTasksPreview];
function pageSource() { return FUNCTIONS.map(function (f) { return f.toString(); }).join('\n'); }

module.exports = {volumePreview: osdVolumePreview, padPreview: osdPadPreview, tasksPreview: osdTasksPreview, pageSource: pageSource};
