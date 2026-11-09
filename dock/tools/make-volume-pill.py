#!/usr/bin/env python3
"""Draws the pictures of the volume pill into dock/res (white shapes, tinted at run time).

pill_bg.png     the glass body, 96 px wide: a fully rounded capsule, nine-sliced (border = radius = 48), drawn white so colour and alpha come from the code
pill_rim.png    the same capsule 2 px larger (100 px, radius 50): drawn behind the body it is the thin light edge
pill_cap.png    the track and the level bar inside, 72 px wide (radius 36)
vol_bg.png      the volume pill's own body, 88 px: a capsule (radius 44), nine-sliced, so it works as a vertical or a horizontal bar
vol_rim.png     the same capsule 92 px (radius 46): the thin light edge behind it
vol_cap.png     the track and the level inside the volume pill, 64 px (radius 32)
(the number pad keeps pill_bg/pill_rim/pill_cap above)
(the speaker icons vol_icon_0/1/2 are Phosphor glyphs: see render-glyphs.cjs)

Run: python3 dock/tools/make-volume-pill.py   (needs Pillow). Supersampled 4x for clean edges.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'res')
SS = 4

def capsule(size, radius):
    w, h = size
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=radius * SS, fill=(255, 255, 255, 255))
    return im.resize((w, h), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
capsule((96, 96), 48).save(os.path.join(OUT, 'pill_bg.png'))
capsule((100, 100), 50).save(os.path.join(OUT, 'pill_rim.png'))
capsule((72, 72), 36).save(os.path.join(OUT, 'pill_cap.png'))
capsule((88, 88), 44).save(os.path.join(OUT, 'vol_bg.png'))
capsule((92, 92), 46).save(os.path.join(OUT, 'vol_rim.png'))
capsule((64, 64), 32).save(os.path.join(OUT, 'vol_cap.png'))
print('written to', os.path.abspath(OUT))
