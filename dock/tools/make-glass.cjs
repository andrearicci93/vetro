'use strict';

/*
 * Generates the glass assets for the native launcher.
 *
 * EFL has no backdrop blur, so "glass" is faked with layered translucency:
 * a cool tint, a top specular highlight and a bright rim, plus a soft drop
 * shadow for depth, and a top-rounded sheet background.
 *
 *   node tools/make-glass.cjs
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 3;

// Every size and look value comes from the C# sources, so a picture can never disagree with the code that draws it.
const K = (() => {
    const out = {};
    for (const f of ['Layout.cs', 'Design.cs']) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Core', f), 'utf8');
        const re = /public (?:const|static readonly) (?:int|float|double) (\w+)\s*=\s*(0x[0-9A-Fa-f]+|-?[0-9.]+)f?\s*;/g;
        let m;
        while ((m = re.exec(src))) out[m[1]] = m[2].startsWith('0x') ? parseInt(m[2], 16) : parseFloat(m[2]);
    }
    return out;
})();
const need = (...names) => names.forEach(n => { if (!(n in K)) throw new Error('constant missing in the C# sources: ' + n); });
need('FocusIcon', 'HighlightPad', 'PillGlowPad', 'PillItemW', 'PillItemH', 'Margin', 'ShellRadius', 'ShellColor', 'ShellAlpha', 'ShellBorderW',
    'ShellBorderColor', 'ShellBorderAlpha', 'ShadowBlur', 'ShadowAlpha', 'IconRadiusPct', 'GlowStrength', 'GlowSpread', 'RingW', 'RingColor');
const rgb = v => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

// Gaussian tail of a CSS blur: Gaussian of sigma = blur / 2 (Abramowitz-Stegun erf).
function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
const erfc = x => 1 - erf(x);
// signed distance to a rounded rectangle centred at (cx, cy), half-sizes hx, hy; > 0 outside
function rrSdf(px, py, cx, cy, hx, hy, rad) {
    const qx = Math.abs(px - cx) - (hx - rad), qy = Math.abs(py - cy) - (hy - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}

function inside(px, py, W, H, rtl, rtr, rbr, rbl) {
    if (px < 0 || px > W || py < 0 || py > H) return false;
    let cx, cy, r;
    if (px < rtl && py < rtl) { cx = rtl; cy = rtl; r = rtl; }
    else if (px > W - rtr && py < rtr) { cx = W - rtr; cy = rtr; r = rtr; }
    else if (px > W - rbr && py > H - rbr) { cx = W - rbr; cy = H - rbr; r = rbr; }
    else if (px < rbl && py > H - rbl) { cx = rbl; cy = H - rbl; r = rbl; }
    else return true;
    const dx = px - cx, dy = py - cy;
    return dx * dx + dy * dy <= r * r;
}

// approximate distance from the rounded-rect boundary (positive inside)
function edgeDist(px, py, W, H, rtl, rtr, rbr, rbl) {
    const dEdges = Math.min(px, W - px, py, H - py);
    let dCorner = Infinity;
    // sx/sy: which side of the corner centre belongs to that corner's quadrant (-1 left/top, +1 right/bottom)
    const corners = [[rtl, rtl, rtl, -1, -1], [W - rtr, rtr, rtr, 1, -1], [W - rbr, H - rbr, rbr, 1, 1], [rbl, H - rbl, rbl, -1, 1]];
    for (const [cx, cy, r, sx, sy] of corners) {
        // only the quadrant that holds the actual corner: otherwise the circle outline shows up inside the tile
        if (r > 0 && (px - cx) * sx >= 0 && (py - cy) * sy >= 0 && (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r + 1) {
            // in/near this corner circle
            dCorner = Math.min(dCorner, r - Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)));
        }
    }
    return Math.min(dEdges, dCorner);
}

function over(dst, src) { // src over dst, colors 0..255, alpha 0..1
    const a = src[3] + dst[3] * (1 - src[3]);
    if (a <= 0) return [0, 0, 0, 0];
    const r = (src[0] * src[3] + dst[0] * dst[3] * (1 - src[3])) / a;
    const g = (src[1] * src[3] + dst[1] * dst[3] * (1 - src[3])) / a;
    const b = (src[2] * src[3] + dst[2] * dst[3] * (1 - src[3])) / a;
    return [r, g, b, a];
}

function renderPng(name, W, H, radii, shade) {
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let pr = 0, pg = 0, pb = 0, pa = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const px = (x * SS + sx + 0.5) / SS;
                    const py = (y * SS + sy + 0.5) / SS;
                    const col = shade(px, py); // [r,g,b,a] or null
                    if (col) { pr += col[0] * col[3]; pg += col[1] * col[3]; pb += col[2] * col[3]; pa += col[3]; }
                }
            }
            const n = SS * SS;
            const a = pa / n;
            const o = (y * W + x) * 4;
            if (a > 0) {
                out[o] = Math.round(Math.min(255, pr / pa));
                out[o + 1] = Math.round(Math.min(255, pg / pa));
                out[o + 2] = Math.round(Math.min(255, pb / pa));
            }
            out[o + 3] = Math.round(Math.min(1, a) * 255);
        }
    }
    writePng(path.join(__dirname, '..', 'res', name + '.png'), W, H, out);
    console.log('wrote res/' + name + '.png');
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
}
function writePng(file, W, H, rgba) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
    const stride = W * 4;
    const raw = Buffer.alloc((stride + 1) * H);
    for (let y = 0; y < H; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
    fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const S = 256, R = 60;

function glass(focus, rad, size) {
    const R = rad || 60;
    const S = size || 256;   // shadows the file-level S so the same look renders at any square size
    return (px, py) => {
        if (!inside(px, py, S, S, R, R, R, R)) return null;
        const t = py / S;
        const d = edgeDist(px, py, S, S, R, R, R, R);
        let col = [0, 0, 0, 0];
        // tinted base
        const baseA = focus ? (0.30 - 0.12 * t) : (0.20 - 0.08 * t);
        col = over(col, [150, 170, 205, Math.max(0, baseA)]);
        // cool accent on focus
        if (focus) col = over(col, [175, 200, 255, 0.08]);
        // specular top-left
        const sx = px - S * 0.26, sy = py - S * 0.04;
        const sd = Math.sqrt(sx * sx + sy * sy) / (S * 0.55);
        if (sd < 1) col = over(col, [255, 255, 255, (focus ? 0.42 : 0.30) * (1 - sd) * (1 - sd)]);
        // rim
        if (d < 2.4) col = over(col, [255, 255, 255, (focus ? 0.55 : 0.28) * (1 - d / 2.4)]);
        return col;
    };
}

// Glow behind the selected item, drawn at its final size (item + 2 * pad), so it is never scaled. It is the designer's
// look: the item's box is filled at 55% of the strength and a blurred copy, spread 0.35 * spread px wider, falls off outside it
// (a CSS box-shadow of blur 1.6 * spread). White: the dock tints it with the app's colour when it draws it.
// w x h is the image, iw x ih the item inside it, rad the item's corner radius.
function glowBox(w, h, iw, ih, rad) {
    const spread = K.GlowSpread * 0.35, sigma = K.GlowSpread * 1.6 / 2, reach = (w - iw) / 2, peak = K.GlowStrength;
    const tail = peak * 0.5 * erfc((reach - spread) / (sigma * Math.SQRT2));   // brought down to nothing at the image edge
    return (px, py) => {
        const sdf = rrSdf(px, py, w / 2, h / 2, iw / 2, ih / 2, rad);
        if (sdf <= 0) return [255, 255, 255, peak * 0.55];
        const a = peak * 0.5 * erfc((sdf - spread) / (sigma * Math.SQRT2)) - tail;
        return a > 0.002 ? [255, 255, 255, a] : null;
    };
}

// The focus ring: an outline of RingW px around an icon of FocusIcon px, in the icon's own corner radius (a percentage of its side).
// Drawn at twice the size: the dock scales it to the icon, which is smaller while it grows.
function ring(scale) {
    const side = K.FocusIcon * scale, w = (K.FocusIcon + 2 * K.RingW) * scale, rad = K.IconRadiusPct / 100 * side;
    const col = rgb(K.RingColor);
    return (px, py) => {
        const inner = rrSdf(px, py, w / 2, w / 2, side / 2, side / 2, rad);
        const outer = rrSdf(px, py, w / 2, w / 2, side / 2 + K.RingW * scale, side / 2 + K.RingW * scale, rad + K.RingW * scale);
        return outer <= 0 && inner > 0 ? [col[0], col[1], col[2], 1] : null;
    };
}

// Soft drop shadow of the bar. The shape edge sits Margin px inside the asset and has the bar's corner radius, so a
// 9-slice border of Margin + radius holds the whole corner curve and the shadow follows the bar. The profile is a Gaussian
// of sigma = blur / 2 (a CSS blur), taken down to zero exactly at the asset edge so the window never cuts it.
function shadow() {
    const M = K.Margin, RR = K.ShellRadius, sigma = K.ShadowBlur / 2, peak = K.ShadowAlpha;
    const g = d => 0.5 * erfc(d / (sigma * Math.SQRT2));
    const edge = g(M);
    return (px, py) => {
        const sdf = rrSdf(px, py, S / 2, S / 2, S / 2 - M, S / 2 - M, RR);
        if (sdf >= M) return null;
        const a = peak * (g(sdf) - edge) / (1 - edge);
        return a > 0.001 ? [0, 0, 0, a] : null;
    };
}

function sheet() {
    const R2 = 46;
    return (px, py) => {
        if (!inside(px, py, S, S, R2, R2, 0, 0)) return null;
        const t = py / S;
        let col = [0, 0, 0, 0];
        col = over(col, [22, 28, 40, 0.72 + 0.20 * t]);
        const d = edgeDist(px, py, S, S, R2, R2, 0, 0);
        if (d < 2.4) col = over(col, [255, 255, 255, 0.30 * (1 - d / 2.4)]);
        if (py < 8) col = over(col, [255, 255, 255, 0.22 * (1 - py / 8)]);
        return col;
    };
}

// The bar, in the designer's "solid" style: an opaque tint with a thin light border inside the edge.
function dock() {
    const R3 = K.ShellRadius, tint = rgb(K.ShellColor), bc = rgb(K.ShellBorderColor);
    return (px, py) => {
        if (!inside(px, py, S, S, R3, R3, R3, R3)) return null;
        let col = [tint[0], tint[1], tint[2], K.ShellAlpha];
        if (edgeDist(px, py, S, S, R3, R3, R3, R3) < K.ShellBorderW) col = over(col, [bc[0], bc[1], bc[2], K.ShellBorderAlpha]);
        return col;
    };
}

// Chevron stroke after the hint word: two segments with round caps, white, with a soft dark halo so it reads
// over bright video without a backing shape. 24x24 cell. dir -1 points up, +1 down.
function chevron(dir) {
    const half = 1.7;
    const a = [4.5, 15.5 - (dir > 0 ? 0 : 0)], b = [12, 8.5], c = [19.5, 15.5];
    const pts = dir < 0 ? [a, b, c] : [[4.5, 8.5], [12, 15.5], [19.5, 8.5]];
    const seg = (px, py, p, q) => {
        const vx = q[0] - p[0], vy = q[1] - p[1];
        let u = ((px - p[0]) * vx + (py - p[1]) * vy) / (vx * vx + vy * vy);
        u = Math.max(0, Math.min(1, u));
        return Math.hypot(px - (p[0] + u * vx), py - (p[1] + u * vy));
    };
    return (px, py) => {
        const d = Math.min(seg(px, py, pts[0], pts[1]), seg(px, py, pts[1], pts[2]));
        if (d <= half) return [255, 255, 255, 1];
        const h = d - half;                       // halo: 3 px of falling black
        return h < 3 ? [0, 0, 0, 0.5 * (1 - h / 3) * (1 - h / 3)] : null;
    };
}

renderPng('chev_up', 24, 24, [0, 0, 0, 0], chevron(-1));
renderPng('chev_down', 24, 24, [0, 0, 0, 0], chevron(1));

// Fallback tile for an app whose icon is missing: the same corner radius as every icon.
renderPng('glass_tile', S, S, [0, 0, 0, 0], glass(false, Math.round(K.IconRadiusPct / 100 * S)));
renderPng('shadow', S, S, [0, 0, 0, 0], shadow());
{
    const pad = K.HighlightPad, side = K.FocusIcon, rad = K.IconRadiusPct / 100 * side;
    renderPng('dock_glow', side + 2 * pad, side + 2 * pad, [0, 0, 0, 0], glowBox(side + 2 * pad, side + 2 * pad, side, side, rad));
    const pp = K.PillGlowPad;
    renderPng('dock_glow_pill', K.PillItemW + 2 * pp, K.PillItemH + 2 * pp, [0, 0, 0, 0],
        glowBox(K.PillItemW + 2 * pp, K.PillItemH + 2 * pp, K.PillItemW, K.PillItemH, K.PillItemH / 2));   // pinned pills: a capsule
    const rs = (K.FocusIcon + 2 * K.RingW) * 2;
    renderPng('dock_ring', rs, rs, [0, 0, 0, 0], ring(2));
}
renderPng('dock_bg', S, S, [0, 0, 0, 0], dock());
