'use strict';
// Renders the remote key pictures of app/design-system/remote (the same set as the dashboard, the TV page and the launcher's task
// manager) into tuner/res as PNGs for the TV guide's footer: white where the page uses the text colour, Vetro's light blue on the lit part.
// Needs @resvg/resvg-js, kept out of the repo:  mkdir /tmp/r && cd /tmp/r && npm i @resvg/resvg-js
//   NODE_PATH=/tmp/r/node_modules node tuner/tools/render-remote-keys.cjs
// The names are the ones GuideScene.KeyNames lists; the pictures are drawn at 34 px high on the 1920 x 1080 screen, rendered at twice that.
const fs = require('fs');
const path = require('path');
const {Resvg} = require('@resvg/resvg-js');

const MAP = {key_ok: 'pad-ok', key_left: 'pad-left', key_right: 'pad-right', key_up: 'pad-up', key_down: 'pad-down', key_back: 'back', key_ch: 'rocker-ch-both'};
const HEIGHT = 68;   // px; the circle keys are square, the CH rocker is 96 x 62 and so a little wider
const src = path.join(__dirname, '..', '..', 'app', 'design-system', 'remote'), out = path.join(__dirname, '..', 'res');
for (const [name, icon] of Object.entries(MAP)) {
    const svg = fs.readFileSync(path.join(src, icon + '.svg'), 'utf8')
        .replace(/var\(--remote-accent, (#[0-9a-f]+)\)/g, '$1').replace(/currentColor/g, '#ffffff');
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const width = Math.round(HEIGHT * Number(m[1]) / Number(m[2]));
    const png = new Resvg(svg, {fitTo: {mode: 'width', value: width}, font: {loadSystemFonts: true}}).render().asPng();
    fs.writeFileSync(path.join(out, name + '.png'), png);
    console.log(name + ' ' + width + ' x ' + HEIGHT);
}
