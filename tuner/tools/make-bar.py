#!/usr/bin/env python3
"""Draws tuner/res/bar.png: the thin progress bar (track and fill) of the banner and the info panel.

The bar is 6 px tall on the screen. The old bars were cut from solid.png (64 px, radius 12) with a 20 px nine-slice border, which is
taller than the bar itself: EFL squeezed the corners to a third of their height and the ends came out as points. This picture is a
capsule of exactly the size it is drawn at (16 x 6, radius 3), sliced with a border of 3 (Theme.BarSlice), so its ends are never
scaled: only the middle stretches. White with alpha, tinted at run time. Coverage is computed with 16 x 16 samples per pixel, no libraries.

Run: python3 tuner/tools/make-bar.py
"""
import os
import struct
import zlib

W, H, R, SS = 16, 6, 3, 16
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'res', 'bar.png')


def inside(x, y):
    """True when the point (in pixels) is inside the capsule."""
    if x < R:
        return (x - R) ** 2 + (y - H / 2.0) ** 2 <= R * R
    if x > W - R:
        return (x - (W - R)) ** 2 + (y - H / 2.0) ** 2 <= R * R
    return 0 <= y <= H


def png(rows):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


rows = []
for py in range(H):
    row = []
    for px in range(W):
        hit = sum(inside(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS) for sx in range(SS) for sy in range(SS))
        row += [255, 255, 255, round(255 * hit / (SS * SS))]
    rows.append(row)
with open(OUT, 'wb') as f:
    f.write(png(rows))
print('written', os.path.abspath(OUT))
