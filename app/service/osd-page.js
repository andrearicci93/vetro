'use strict';
// Pictures of Vetro UI's on-screen displays for the dashboard: the glass volume bar on the chosen edge, the glass number pad and
// the launcher's task manager.
// Drawn at the launcher's screen size (1920 x 1080) with the numbers of dock/src/Core/VolumePlacement.cs and dock/src/Ui/NumberPad.cs,
// so the bar moves when the Position menu changes. The functions are inlined into the page script (toString), so they are plain
// ES5 with no template strings. Not screenshots: the TV picture behind them is a stand-in.

function osdSvg(label, parts) {
    return '<svg class="tuner-screen osd-screen" viewBox="0 0 1920 1080" role="img" aria-label="' + label + '" font-family="SamsungOneUI, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-weight="500">' +
        '<defs><linearGradient id="osdVideo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2b44"/><stop offset=".55" stop-color="#2f3f5c"/><stop offset="1" stop-color="#11182a"/></linearGradient></defs>' +
        '<rect width="1920" height="1080" fill="url(#osdVideo)"/>' + parts.join('') + '</svg>';
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
    return osdSvg('The glass volume bar on the ' + (edge || 'left') + ' edge of the screen, at level ' + Math.round(f * 100) + '.', parts);
}

function osdSpeaker(x, y) {
    return '<g transform="translate(' + x + ' ' + y + ')" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 15h7l9-8v26l-9-8H6z" fill="#fff"/><path d="M28 13c3 4 3 10 0 14M32 9c5 6 5 16 0 22"/></g>';
}

// The number pad: one glass row at the bottom with the digits and Done, the number typed so far in a chip above it.
function osdPadPreview() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Done'], cw = 80, done = 140, bw = 10 * cw + done + 24;
    var x = (1920 - bw) / 2, top = 1080 - 64 - 200, y = top + 92, parts = [];
    parts.push('<rect x="' + ((1920 - 180) / 2) + '" y="' + (top + 28) + '" width="180" height="52" rx="26" fill="#243448" fill-opacity=".92" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>');
    parts.push('<text x="960" y="' + (top + 64) + '" font-size="32" fill="#fff" text-anchor="middle">12</text>');
    parts.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="96" rx="48" fill="#243448" fill-opacity=".92" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>');
    var cx = x + 12;
    for (var i = 0; i < keys.length; i++) {
        var kw = keys[i] === 'Done' ? done : cw, focus = i === 2;
        if (focus) parts.push('<rect x="' + (cx + 4) + '" y="' + (y + 12) + '" width="' + (kw - 8) + '" height="72" rx="36" fill="#fff" fill-opacity=".2" stroke="#e4f2ff" stroke-width="3"/>');
        parts.push('<text x="' + (cx + kw / 2) + '" y="' + (y + 60) + '" font-size="' + (keys[i] === 'Done' ? 28 : 36) + '" fill="#fff" text-anchor="middle">' + keys[i] + '</text>');
        cx += kw;
    }
    return osdSvg('The glass number pad at the bottom of the screen: the digits 1 to 0 and Done in one row, 12 typed so far, 3 selected.', parts);
}

// The launcher's task manager (Down from the apps row): the panel stands where the bar ends, 880 px wide, a 70 px header,
// 76 px rows and a 54 px footer (dock/src/Core/TaskPage.cs), the first row selected. The apps and figures are examples.
function osdTasksPreview() {
    var apps = [['Netflix', '3.1%', '412 MB'], ['YouTube', '0.8%', '286 MB'], ['Samsung Home', '0.4%', '198 MB'], ['Plex', '0.2%', '121 MB']];
    var w = 880, h = 18 + 70 + apps.length * 76 + 54 + 10, x = (1920 - w) / 2, y = 1080 - 40 - 46 - h, list = y + 18 + 70, parts = [];
    var memRight = x + w - 24 - 14, cpuRight = memRight - 150, iconX = x + 24 + 10, nameX = iconX + 52 + 22;
    parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="24" fill="#2a3346" fill-opacity=".98" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>');
    parts.push('<text x="' + (x + 34) + '" y="' + (y + 18 + 34) + '" font-size="32" font-weight="600" fill="#fff">Running apps</text>');
    parts.push('<text x="' + (x + 34) + '" y="' + (y + 18 + 62) + '" font-size="22" fill="#fff" fill-opacity=".7">612 MB of memory free</text>');
    parts.push('<text x="' + memRight + '" y="' + (y + 18 + 34) + '" font-size="22" fill="#fff" fill-opacity=".7" text-anchor="end">Sort by   Memory</text>');
    for (var i = 0; i < apps.length; i++) {
        var top = list + i * 76;
        if (i === 0) parts.push('<rect x="' + (x + 24 - 8) + '" y="' + (top + 4) + '" width="' + (w - 48 + 16) + '" height="68" rx="20" fill="#fff" fill-opacity=".16" stroke="#e4f2ff" stroke-width="3"/>');
        parts.push('<rect x="' + iconX + '" y="' + (top + 12) + '" width="52" height="52" rx="12" fill="#fff" fill-opacity=".14"/>');
        parts.push('<text x="' + (iconX + 26) + '" y="' + (top + 46) + '" font-size="22" fill="#fff" text-anchor="middle">' + apps[i][0].slice(0, 2) + '</text>');
        parts.push('<text x="' + nameX + '" y="' + (top + 47) + '" font-size="28" fill="#fff">' + apps[i][0] + '</text>');
        parts.push('<text x="' + cpuRight + '" y="' + (top + 47) + '" font-size="26" fill="#fff" fill-opacity=".75" text-anchor="end">' + apps[i][1] + '</text>');
        parts.push('<text x="' + memRight + '" y="' + (top + 47) + '" font-size="26" fill="#fff" text-anchor="end">' + apps[i][2] + '</text>');
    }
    parts.push('<text x="960" y="' + (list + apps.length * 76 + 14 + 26) + '" font-size="21" fill="#fff" fill-opacity=".7" text-anchor="middle">OK  open        Hold OK  close        ‹ ›  sort        Up / Back  return</text>');
    return osdSvg('The launcher’s task manager: the running apps with their CPU and memory, sorted by memory, the first one selected. Example apps.', parts);
}

var FUNCTIONS = [osdSvg, osdVolumePreview, osdSpeaker, osdPadPreview, osdTasksPreview];
function pageSource() { return FUNCTIONS.map(function (f) { return f.toString(); }).join('\n'); }

module.exports = {volumePreview: osdVolumePreview, padPreview: osdPadPreview, tasksPreview: osdTasksPreview, pageSource: pageSource};
