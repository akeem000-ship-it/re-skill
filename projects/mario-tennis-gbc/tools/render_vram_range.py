"""Render a tile range of a PPU dump (emu_screen_dump.py JSON) with a CGB OBJ/BG palette from the dump.
usage: render_vram_range.py DUMP.json BANK LO HI OUT.png [--obj N | --bg N] [--scale K] [--cols N]"""
import sys, json
from PIL import Image
a = sys.argv[1:]
d = json.load(open(a[0])); bank, lo, hi, out = int(a[1]), int(a[2], 16), int(a[3], 16), a[4]
scale = int(a[a.index("--scale") + 1]) if "--scale" in a else 4
cols = int(a[a.index("--cols") + 1]) if "--cols" in a else 16
pal = [(255, 255, 255), (170, 170, 170), (85, 85, 85), (0, 0, 0)]
key = "objpal" if "--obj" in a else "bgpal" if "--bg" in a else None
if key:
    n = int(a[a.index("--obj" if key == "objpal" else "--bg") + 1]); raw = bytes.fromhex(d[key])
    pal = []
    for i in range(4):
        v = raw[8 * n + 2 * i] | raw[8 * n + 2 * i + 1] << 8
        pal.append(((v & 31) * 8, ((v >> 5) & 31) * 8, ((v >> 10) & 31) * 8))
vram = bytes.fromhex(d["vram%d" % bank])
n = hi - lo; rows = (n + cols - 1) // cols
img = Image.new("RGB", (cols * 8, rows * 8), (255, 0, 255))
for i in range(n):
    base = (lo + i) * 16
    for y in range(8):
        b0, b1 = vram[base + 2 * y], vram[base + 2 * y + 1]
        for x in range(8):
            c = ((b0 >> (7 - x)) & 1) | (((b1 >> (7 - x)) & 1) << 1)
            img.putpixel(((i % cols) * 8 + x, (i // cols) * 8 + y), pal[c])
img.resize((img.width * scale, img.height * scale), 0).save(out); print("wrote", out)
