"""Render the in-match caption graphics of bank 09 (table 09:488A: 4-byte [src lo, src hi, 16-byte blocks, 0];
LoadCaption 09:4872 copies them to VRAM $8200 as 8x16 columns: a 16-block entry = two lines of 4 columns,
interleaved per column; 8 blocks = one line). usage: render_captions.py [out/captions.png]"""
import sys, os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rom = open(os.path.join(ROOT, "rom/mario_tennis.gbc"), "rb").read()
out = sys.argv[1] if len(sys.argv) > 1 else "out/captions.png"
PAL = [(0, 156, 0), (255, 57, 0), (255, 255, 74), (0, 0, 0)]
def tile(a, img, x0, y0):
    for y in range(8):
        lo, hi = rom[a + 2 * y], rom[a + 2 * y + 1]
        for x in range(8):
            c = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)
            img.putpixel((x0 + x, y0 + y), PAL[c])
base = 9 * 0x4000 + 0x088A
entries = []
for i in range(28):
    lo, hi, n = rom[base + 4 * i], rom[base + 4 * i + 1], rom[base + 4 * i + 2]
    entries.append((i, hi << 8 | lo, n))
W = 16 * 8 + 40; img = Image.new("RGB", (W, len(entries) * 36), (40, 40, 40)); d = ImageDraw.Draw(img)
for row, (i, src, n) in enumerate(entries):
    d.text((2, row * 36 + 10), "%2d %04X %2d" % (i, src, n), fill=(255, 255, 255))
    a = 9 * 0x4000 + (src - 0x4000)
    # VRAM tile t (8x8) at $8200 + 16*t; 8x16 sprites use (2k, 2k+1); line 1 = tiles 0,4,8,12.. (16 blocks) or 0,2,4,6 (8 blocks)
    two = i in (0, 16, 24, 25, 26)            # two-line captions: a column = 4 tiles (line 1 top/bottom, line 2 top/bottom)
    for t in range(n):
        if two: col, line, half = (t // 4) % 8, (t // 2) % 2, t % 2
        else: col, line, half = t // 2, 0, t % 2
        if col >= 16: continue
        tile(a + 16 * t, img, 40 + col * 8, row * 36 + 2 + line * 16 + half * 8)
img.resize((img.width * 2, img.height * 2), 0).save(os.path.join(ROOT, out)); print("wrote", out)
