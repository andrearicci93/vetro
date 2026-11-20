#!/usr/bin/env python3
"""Draws the rounded ends of a "No information" cell in the TV guide into row 2 of tuner/res/keys.png.

A cell with no programme is striped (hatch.png, a 16 px tile: the cell's .035 white plus diagonal lines). The stripes used to be a tiled
rectangle 20 px in from each end, laid over the plain rounded cell: the two ends showed as solid caps without lines, and the middle had the
.035 twice. Now the whole cell is stripes. EFL cannot round the corners of a tiled picture without a mask, so the ends are pictures made
here: the first and last 24 px of a 76 px tall cell (GuideLayout.CellH) with 20 px rounded corners, filled with the same stripes.

The stripes are anchored at the cell's left edge, so the left end is always the same picture. The right end starts at (width - 24) px into
the cell, which can fall anywhere in the 16 px tile, so it comes in 16 versions. All 17 sit side by side (408 x 76: slot 0 the left end,
slot 1 + k the right end starting k px into the tile) in row 2 of tuner/res/keys.png (y = 72..147, below the 536 x 68 remote keys row with
a 4 px transparent gutter, so the update from 0.5.0 carries one atlas instead of two files). The guide shows the slot it needs by moving
the picture's fill (GuideView, HatchEnd). The middle is hatch.png tiled with its fill moved by 24 % 16 = 8 px.

Run: python3 tuner/tools/make-hatch-ends.py   (no libraries)
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'res')
CAP, H, TILE, R, SS = 24, 76, 16, 20, 16   # end width, cell height (GuideLayout.CellH), stripe tile, corner radius, 16x16 supersampling
ATLAS_W, KEYS_H, GUTTER = 536, 68, 4       # keys.png row 1 (536 x 68), 4 px transparent gutter, row 2 at y = 72..147 (total 536 x 148)


def read_png(path):
    """RGBA rows of an 8-bit RGBA, non-interlaced PNG (what the tuner's pictures are)."""
    data = open(path, 'rb').read()
    i, idat = 8, b''
    while i < len(data):
        n, tag = struct.unpack('>I4s', data[i:i + 8])
        body = data[i + 8:i + 8 + n]
        if tag == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and ctype == 6, path + ': expected 8-bit RGBA'
        elif tag == b'IDAT':
            idat += body
        i += 12 + n
    raw, stride, prev, rows = zlib.decompress(idat), w * 4, bytearray(w * 4), []
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def write_png(path, w, rows):
    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, len(rows), 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


kw, kh, keys = read_png(os.path.join(RES, 'keys.png'))
assert kw == ATLAS_W and kh >= KEYS_H, 'keys.png: expected width %d and height >= %d' % (ATLAS_W, KEYS_H)
tw, th, hatch = read_png(os.path.join(RES, 'hatch.png'))
assert tw == TILE and th == TILE


def pill_alpha(x, y):
    """Alpha (0..255) at (x, y) of a cell drawn H px tall with radius R (x in 0..CAP-1 for left end, CAP..2*CAP-1 for right end)."""
    left = x < CAP
    cx = R if left else 2 * CAP - R
    cy = R if y < R else H - R if y >= H - R else None
    if cy is None or (x >= R if left else x < 2 * CAP - R):
        return 255
    hit = sum((x + (sx + 0.5) / SS - cx) ** 2 + (y + (sy + 0.5) / SS - cy) ** 2 <= R * R
              for sx in range(SS) for sy in range(SS))
    return round(255 * hit / (SS * SS))


def end(px0, phase):
    """One end: columns px0..px0+CAP-1, the stripes starting at `phase` px into the tile."""
    rows = []
    for y in range(H):
        row = bytearray()
        for x in range(CAP):
            t = hatch[y % TILE][((phase + x) % TILE) * 4:((phase + x) % TILE) * 4 + 4]
            row += bytes((t[0], t[1], t[2], (t[3] * pill_alpha(px0 + x, y) + 127) // 255))
        rows.append(row)
    return rows


slots = [end(0, 0)] + [end(CAP, k) for k in range(TILE)]
pad_right = bytes((ATLAS_W - CAP * len(slots)) * 4)
blank = bytes(ATLAS_W * 4)
atlas = [bytes(keys[y]) for y in range(KEYS_H)] + [blank] * GUTTER + [
    b''.join(bytes(sl[y]) for sl in slots) + pad_right for y in range(H)
]
write_png(os.path.join(RES, 'keys.png'), ATLAS_W, atlas)
print('keys.png %dx%d (keys %dx%d + hatch_ends %dx%d at y=%d)' % (
    ATLAS_W, len(atlas), ATLAS_W, KEYS_H, CAP * len(slots), H, KEYS_H + GUTTER))
