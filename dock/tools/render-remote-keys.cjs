'use strict';
// Renders the remote key pictures of app/design-system/remote (the same set as the dashboard and the TV page) into dock/res
// as PNGs for the task manager's footer: white where the page uses the text colour, Vetro's light blue on the lit part.
// Needs @resvg/resvg-js, kept out of the repo:  mkdir /tmp/r && cd /tmp/r && npm i @resvg/resvg-js
//   NODE_PATH=/tmp/r/node_modules node dock/tools/render-remote-keys.cjs
const fs = require('fs');
const path = require('path');
const {Resvg} = require('@resvg/resvg-js');

const SIZE = 64;   // drawn at 32 px on the 1920 x 1080 screen: twice that, so the scaled picture stays sharp
const MAP = {key_ok: 'pad-ok', key_left: 'pad-left', key_right: 'pad-right', key_up: 'pad-up', key_back: 'back'};
const src = path.join(__dirname, '..', '..', 'app', 'design-system', 'remote'), out = path.join(__dirname, '..', 'res');
for (const [name, icon] of Object.entries(MAP)) {
    const svg = fs.readFileSync(path.join(src, icon + '.svg'), 'utf8')
        .replace(/var\(--remote-accent, (#[0-9a-f]+)\)/g, '$1').replace(/currentColor/g, '#ffffff');
    const png = new Resvg(svg, {fitTo: {mode: 'width', value: SIZE}, font: {loadSystemFonts: false}}).render().asPng();
    fs.writeFileSync(path.join(out, name + '.png'), png);
}
console.log('rendered ' + Object.keys(MAP).length + ' remote keys');
