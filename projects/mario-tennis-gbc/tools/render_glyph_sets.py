"""Render the three point-score glyph sets of the bank-09 score font (REVERSE.md "Score display"):
plain $6180-$62A0, left-of-dot $6540-$6660, right-of-dot $6880-$69A0 (raw 8x16 2bpp columns, 32 bytes).

usage: render_glyph_sets.py [out/glyph_sets.png]"""
import sys, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rom = open(os.path.join(ROOT, "rom/mario_tennis.gbc"), "rb").read()
out = sys.argv[1] if len(sys.argv) > 1 else "out/glyph_sets.png"
SETS = [("plain", 0x6180), ("left of dot", 0x6540), ("right of dot", 0x6880)]
if "--range" in sys.argv:   # --range LO HI OUT: rows of 16 columns ($200 bytes) from LO to HI
    i = sys.argv.index("--range"); lo, hi = int(sys.argv[i + 1], 16), int(sys.argv[i + 2], 16); out = sys.argv[i + 3]
    SETS = [("$%04X" % a, a) for a in range(lo, hi, 0x200)]
if "--all" in sys.argv:      # the whole font $6000-$6C00 as rows of 16 columns (one row = $200 bytes)
    SETS = [("$%04X" % a, a) for a in range(0x6000, 0x6C00, 0x200)]
    out = sys.argv[sys.argv.index("--all") + 1] if len(sys.argv) > sys.argv.index("--all") + 1 else out
PAL = [(0, 156, 0), (255, 57, 0), (255, 255, 74), (0, 0, 0)]
NC = 16 if ("--all" in sys.argv or "--range" in sys.argv) else 10
img = Image.new("RGB", (NC * 8, len(SETS) * 18), (40, 40, 40))
for row, (name, base) in enumerate(SETS):
    for col in range(NC):
        a = 0x09 * 0x4000 + (base + col * 0x20 - 0x4000)
        for y in range(16):
            lo, hi = rom[a + 2 * y], rom[a + 2 * y + 1]
            for x in range(8):
                c = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)
                img.putpixel((col * 8 + x, row * 18 + y), PAL[c])
os.makedirs(os.path.dirname(os.path.join(ROOT, out)) or ".", exist_ok=True)
img.resize((img.width * 4, img.height * 4), 0).save(os.path.join(ROOT, out))
print("wrote", out, "rows:", ", ".join(n for n, _ in SETS))
