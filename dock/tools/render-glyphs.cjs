'use strict';
// Renders the Phosphor "regular" glyphs of dock/tools/glyphs into dock/res as white PNGs (tinted at run time):
// the number pad's icons and the volume pill's speakers. Phosphor Icons are MIT (glyphs/LICENSE-phosphor.txt).
// Needs @resvg/resvg-js, kept out of the repo:  mkdir /tmp/r && cd /tmp/r && npm i @resvg/resvg-js
//   NODE_PATH=/tmp/r/node_modules node dock/tools/render-glyphs.cjs
const fs = require('fs');
const path = require('path');
const {Resvg} = require('@resvg/resvg-js');

const SIZE = 96;
const MAP = {
    pad_bs: 'backspace', pad_colors: 'palette', pad_back: 'caret-left', pad_ttx: 'article', pad_timer: 'clock', pad_info: 'info',
    vol_icon_0: 'speaker-simple-slash', vol_icon_1: 'speaker-simple-low', vol_icon_2: 'speaker-simple-high',
    // The Audio output card's icons (Control center)
    out_tv: 'television-simple', out_bt: 'bluetooth', out_check: 'check'
};
const out = path.join(__dirname, '..', 'res');
// Glyphs moved down (+) or up (-), in the 256 grid's units, so that their ink is centred in the picture: the television
// stands high in its box and the check low, and side by side in a row of the Audio output card they were 3 px apart.
const NUDGE = {out_tv: 13.33, out_check: -8};
const nudged = (name, svg) => NUDGE[name] ? svg.replace('viewBox="0 0 256 256"', 'viewBox="0 ' + (-NUDGE[name]) + ' 256 256"') : svg;
// The palette key: the glyph's outline is white like the others (tinted at run time), its four dots are a second picture in the colours of
// the colour keys, in their order (red, green, yellow, blue), along the arc from the lower left over the top to the right: they keep their colour whatever the ink is.
// The colours are the ones of NumberPadModel (RedColor ...). The dots are the glyph's last four sub-paths, drawn here slightly larger.
const DOTS = [[84, 156, '#E5484D'], [84, 100, '#30A46C'], [128, 76, '#F2B01E'], [172, 100, '#3E7BFA']];
const palette = fs.readFileSync(path.join(__dirname, 'glyphs', 'palette-regular.svg'), 'utf8');
const cut = palette.indexOf('ZM140,76');
if (cut < 0) throw new Error('palette glyph changed: the dots are no longer the last sub-paths');
const outline = palette.slice(0, cut + 1) + '"/></svg>';
const dots = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + DOTS.map(d => '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="14" fill="' + d[2] + '"/>').join('') + '</svg>';
const render = svg => new Resvg(svg, {fitTo: {mode: 'width', value: SIZE}}).render().asPng();
fs.writeFileSync(path.join(out, 'pad_colors_dots.png'), render(dots));
for (const [name, glyph] of Object.entries(MAP)) {
    if (name === 'pad_colors') { fs.writeFileSync(path.join(out, name + '.png'), render(outline.replace(/currentColor/g, '#ffffff'))); continue; }
    const svg = fs.readFileSync(path.join(__dirname, 'glyphs', glyph + '-regular.svg'), 'utf8').replace(/currentColor/g, '#ffffff');
    const png = new Resvg(nudged(name, svg), {fitTo: {mode: 'width', value: SIZE}}).render().asPng();
    fs.writeFileSync(path.join(out, name + '.png'), png);
}
console.log('rendered ' + (Object.keys(MAP).length + 1) + ' glyphs');
