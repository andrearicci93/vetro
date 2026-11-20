'use strict';
// Renders the remote key pictures of app/design-system/remote (the same set as the dashboard, the TV page and the launcher's task
// manager) into row 1 of tuner/res/keys.png (536 x 148 RGBA; row 1 y=0..67 holds the 7 remote keys, row 2 y=72..147 holds the 17
// hatch ends written by make-hatch-ends.py): white where the page uses the text colour, Vetro's light blue on the lit part.
// Packing all 7 icons and the hatch ends into one atlas saves 7 shipped files in the 64 KiB 0.5.0 -> 0.7.x update script budget
// (offsets match Surface.KeyAtlasX / Surface.HatchEndsAtlasY in tuner/src/Ui/Surface.cs).
// Needs @resvg/resvg-js (and python3 + Pillow to assemble the atlas):
//   mkdir /tmp/r && cd /tmp/r && npm i @resvg/resvg-js
//   NODE_PATH=/tmp/r/node_modules node tuner/tools/render-remote-keys.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {Resvg} = require('@resvg/resvg-js');

const SLOTS = [
    {name: 'key_ok', icon: 'pad-ok', x: 0, w: 68},
    {name: 'key_left', icon: 'pad-left', x: 72, w: 68},
    {name: 'key_right', icon: 'pad-right', x: 144, w: 68},
    {name: 'key_up', icon: 'pad-up', x: 216, w: 68},
    {name: 'key_down', icon: 'pad-down', x: 288, w: 68},
    {name: 'key_ch', icon: 'rocker-ch-both', x: 360, w: 105},
    {name: 'key_back', icon: 'back', x: 468, w: 68},
];
const ATLAS_W = 536;
const HEIGHT = 68;   // px; the circle keys are square (68 x 68), the CH rocker is 96 x 62 (105 x 68)
const src = path.join(__dirname, '..', '..', 'app', 'design-system', 'remote');
const out = path.join(__dirname, '..', 'res', 'keys.png');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-keys-'));
try {
    for (const slot of SLOTS) {
        const svg = fs.readFileSync(path.join(src, slot.icon + '.svg'), 'utf8')
            .replace(/var\(--remote-accent, (#[0-9a-f]+)\)/g, '$1').replace(/currentColor/g, '#ffffff');
        const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
        const width = Math.round(HEIGHT * Number(m[1]) / Number(m[2]));
        if (width !== slot.w) throw new Error(slot.name + ' width ' + width + ' != expected ' + slot.w);
        const png = new Resvg(svg, {fitTo: {mode: 'width', value: width}, font: {loadSystemFonts: true}}).render().asPng();
        fs.writeFileSync(path.join(tmp, slot.name + '.png'), png);
        console.log(slot.name + ' x=' + slot.x + ' ' + width + ' x ' + HEIGHT);
    }
    const script = [
        'import json, os, sys',
        'from PIL import Image',
        'tmp, out, atlas_w, height, slots = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), json.loads(sys.argv[5])',
        'atlas = Image.new("RGBA", (atlas_w, height), (0, 0, 0, 0))',
        'for s in slots:',
        '    atlas.paste(Image.open(os.path.join(tmp, s["name"] + ".png")).convert("RGBA"), (s["x"], 0))',
        'atlas.save(out, "PNG", optimize=True)',
    ].join('\n');
    execFileSync('python3', ['-c', script, tmp, out, String(ATLAS_W), String(HEIGHT), JSON.stringify(SLOTS)], {stdio: 'inherit'});
    execFileSync('python3', [path.join(__dirname, 'make-hatch-ends.py')], {stdio: 'inherit'});
    console.log('wrote ' + out + ' (' + ATLAS_W + ' x 148)');
} finally {
    fs.rmSync(tmp, {recursive: true, force: true});
}
