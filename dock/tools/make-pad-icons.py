#!/usr/bin/env python3
"""Draws pill_chip.png into dock/res: a 52 px capsule (radius 26, white, tinted at run time) for the number pad's Done chip and tooltip.
The pad's icons are Phosphor glyphs: see render-glyphs.cjs.
Run: python3 dock/tools/make-pad-icons.py   (needs Pillow)."""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'res')
SS, PX = 4, 48
W = (255, 255, 255, 255)

def canvas(px=PX):
    s = px * SS
    return Image.new('RGBA', (s, s), (0, 0, 0, 0)), SS

def done(im, name, px=PX):
    im.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name))

def stroke(d, pts, w=3.2, joint='curve'):
    d.line([(x * SS, y * SS) for x, y in pts], fill=W, width=int(w * SS), joint=joint)

def ring(d, cx, cy, r, w=3.2):
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], outline=W, width=int(w * SS))

def disc(d, cx, cy, r):
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=W)

# the chip capsule
s = 52 * SS
im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
ImageDraw.Draw(im).rounded_rectangle([0, 0, s - 1, s - 1], radius=26 * SS, fill=W)
done(im, 'pill_chip.png', 52)
print('written')
