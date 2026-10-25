'use strict';
// The launcher's native look is the designer page's chosen JSON (dock/designer/chosen.json) ported to code.
// This checks, value by value, that the C# constants say what the JSON says, and that the generated images
// have the sizes the code expects, so the two cannot drift apart unnoticed.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'dock');
const chosen = JSON.parse(fs.readFileSync(path.join(root, 'designer', 'chosen.json'), 'utf8')).config;
const K = {};
['Layout.cs', 'Design.cs'].forEach(f => {
    const src = fs.readFileSync(path.join(root, 'src', 'Core', f), 'utf8');
    const re = /public (?:const|static readonly) (?:int|float|double|bool|string) (\w+)\s*=\s*(0x[0-9A-Fa-f]+|-?[0-9.]+|true|false|"[^"]*")f?\s*;/g;
    let m;
    while ((m = re.exec(src))) {
        const v = m[2];
        K[m[1]] = v.startsWith('0x') ? parseInt(v, 16) : v === 'true' ? true : v === 'false' ? false : v.startsWith('"') ? v.slice(1, -1) : parseFloat(v);
    }
});
const hex = h => parseInt(h.replace('#', ''), 16);
const eq = (name, expected) => assert.equal(K[name], expected, name + ' = ' + K[name] + ', the design says ' + expected);
const near = (name, expected) => assert.ok(Math.abs(K[name] - expected) < 1e-6, name + ' = ' + K[name] + ', the design says ' + expected);
const c = chosen;

// geometry
eq('Icon', c['layout.icon']); eq('FocusIcon', c['layout.focusIcon']); eq('Gap', c['layout.gap']);
eq('PadX', c['layout.padX']); eq('PadTop', c['layout.padTop']); eq('PadBottom', c['layout.padBottom']);
eq('GroupGap', c['layout.groupGap']); eq('MaxPillW', c['layout.maxW']); eq('DividerH', c['divider.height']);
assert.equal(K.Margin + K.BottomGap, c['layout.offset'], 'the bar sits layout.offset px above the screen bottom');
assert.equal(c['layout.position'], 'bottom'); assert.equal(c['layout.align'], 'center');
assert.equal(c['layout.fisheye'], 0, 'no lens effect: the neighbours do not grow');
near('DividerAlpha', c['divider.opacity']); assert.equal(c['divider.show'], true);

// the bar (solid: the designer ignores the glass-only gradient and highlight, and keeps at least 98% opacity)
assert.equal(c['shell.style'], 'solid');
eq('ShellRadius', c['shell.radius']); eq('ShellColor', hex(c['shell.tint']));
near('ShellAlpha', Math.max(c['shell.opacity'], 0.98));
eq('ShellBorderW', c['shell.borderW']); near('ShellBorderAlpha', c['shell.border']); eq('ShellBorderColor', hex(c['shell.borderColor']));
near('ShadowAlpha', c['shell.shadow']); eq('ShadowBlur', c['shell.shadowBlur']);
assert.ok(K.ShellSlice >= K.ShellRadius, 'the bar image keeps its corner curve inside the nine-slice border');

// icons: one radius rule for icon, ring and glow
eq('IconRadiusPct', c['icons.radius']); near('IconDim', c['icons.dim']);
assert.equal(K.IconRimAlpha > 0, c['icons.rim']);
assert.equal(c['icons.shape'], 'squircle'); assert.equal(c['icons.treat'], 'dark');

// selection
assert.equal(K.GlowFromIcon, c['glow.mode'] === 'icon');
eq('GlowColor', hex(c['glow.color'])); near('GlowStrength', c['glow.strength']); eq('GlowSpread', c['glow.spread']);
eq('RingW', c['focus.ring']); eq('RingColor', hex(c['focus.ringColor'])); eq('Lift', c['focus.lift']);
assert.equal(K.HighlightPad, Math.ceil(c['glow.spread'] * (0.35 + 1.6)), 'the glow image reaches spread + blur');
assert.equal(K.PillGlowPad, K.HighlightPad);

// text
assert.equal(K.ShowLabels, c['label.mode'] !== 'none'); assert.equal(K.ShowClock, c['clock.show']);
assert.equal(K.HintText, c['hint.text']); assert.equal(c['hint.show'], true);

// pills
assert.equal(c['pills.mode'], 'stack'); assert.equal(c['pills.style'], 'outline');
eq('PillItemW', c['pills.w']); eq('PillItemH', c['pills.h']); eq('PillItemGap', c['pills.gap']);
assert.equal(c['pills.radius'] * 2, c['pills.h'], 'the pills are capsules: the radius is half the height');
eq('PillTextSize', c['pills.size']);

// motion
assert.equal(c['motion.enter'], 'cascade'); assert.equal(K.LinearMotion, c['motion.ease'] === 'linear');
near('EnterSeconds', c['motion.duration'] / 1000); near('StaggerSeconds', c['motion.stagger'] / 1000); near('FocusSeconds', c['motion.focus'] / 1000);

// the generated images have the sizes the code expects
function size(file) {
    const b = fs.readFileSync(path.join(root, 'res', file));
    assert.equal(b.slice(1, 4).toString(), 'PNG', file + ' is a PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
assert.deepEqual(size('dock_glow.png'), [K.FocusIcon + 2 * K.HighlightPad, K.FocusIcon + 2 * K.HighlightPad], 'glow image = icon + reach on each side');
assert.deepEqual(size('dock_glow_pill.png'), [K.PillItemW + 2 * K.PillGlowPad, K.PillItemH + 2 * K.PillGlowPad], 'pill glow image');
assert.deepEqual(size('dock_ring.png'), [2 * (K.FocusIcon + 2 * K.RingW), 2 * (K.FocusIcon + 2 * K.RingW)], 'ring image: icon + ring, at twice the size');
assert.deepEqual(size('icons/settings.png'), [K.PillItemW, K.PillItemH], 'a pill image is the pill size');
assert.deepEqual(size('icons/in-hdmi1.png'), [K.FocusIcon, K.FocusIcon], 'the dock\'s own icons are made at the selected size');

console.log('PASS dock design: the native look matches the chosen designer JSON');
