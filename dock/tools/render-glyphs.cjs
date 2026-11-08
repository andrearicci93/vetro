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
    vol_icon_0: 'speaker-simple-slash', vol_icon_1: 'speaker-simple-low', vol_icon_2: 'speaker-simple-high'
};
const out = path.join(__dirname, '..', 'res');
for (const [name, glyph] of Object.entries(MAP)) {
    const svg = fs.readFileSync(path.join(__dirname, 'glyphs', glyph + '-regular.svg'), 'utf8').replace(/currentColor/g, '#ffffff');
    const png = new Resvg(svg, {fitTo: {mode: 'width', value: SIZE}}).render().asPng();
    fs.writeFileSync(path.join(out, name + '.png'), png);
}
console.log('rendered ' + Object.keys(MAP).length + ' glyphs');
