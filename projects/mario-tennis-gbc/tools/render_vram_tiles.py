"""Render the tiles of a PPU dump (emu_screen_dump.py JSON): VRAM bank 0 and 1, $8000-$97FF, 16 tiles per
row, grey palette, with the OAM entries listed. usage: render_vram_tiles.py DUMP.json OUT.png"""
import sys, json
from PIL import Image
d = json.load(open(sys.argv[1]))
vram = [bytes.fromhex(d["vram"][b]) if isinstance(d["vram"], list) else bytes.fromhex(d["vram"][str(b)]) for b in (0, 1)] if "vram" in d else None
if vram is None:
    vram = [bytes.fromhex(d["vram0"]), bytes.fromhex(d["vram1"])]
PAL = [(255, 255, 255), (170, 170, 170), (85, 85, 85), (0, 0, 0)]
img = Image.new("RGB", (2 * 16 * 8 + 8, 24 * 8), (255, 0, 255))
for bank in (0, 1):
    for t in range(384):
        base = t * 16
        for y in range(8):
            lo, hi = vram[bank][base + 2 * y], vram[bank][base + 2 * y + 1]
            for x in range(8):
                c = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)
                img.putpixel((bank * (16 * 8 + 8) + (t % 16) * 8 + x, (t // 16) * 8 + y), PAL[c])
img.resize((img.width * 3, img.height * 3), 0).save(sys.argv[2])
oam = bytes.fromhex(d["oam"])
print("OAM entries (y x tile attr):")
for i in range(40):
    y, x, t, at = oam[4 * i:4 * i + 4]
    if y and y < 160: print("  %2d: y=%3d x=%3d tile=%02x attr=%02x" % (i, y - 16, x - 8, t, at))
