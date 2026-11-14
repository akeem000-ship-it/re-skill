"""Ph7: compare the emulator's BG (court) pixels with our court render at the game's own scroll.
Loads a state, takes the PyBoy screen, reads SCX/SCY and the map id, crops gfx/maps/map_NN.png at
(SCX, SCY) and reports the share of pixels that match (tolerance per channel), ignoring pixels
covered by sprites (OAM boxes) and the window/HUD rows.
usage: compare_frames.py STATE MAPID [--tol N] [--diff out.png]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
import png

a = sys.argv[1:]
st, mid = a[0], int(a[1])
tol = int(a[a.index("--tol") + 1]) if "--tol" in a else 12
e = Emu(); e.load(st); e.run(1)
img = e.pb.screen.image.convert("RGB")
scx, scy = e.mem[0xFF43], e.mem[0xFF42]
oam = bytes(e.mem[0xFE00:0xFEA0]); wy = e.mem[0xFF4A]; lcdc = e.mem[0xFF40]
e.stop()
mask = [[False] * 160 for _ in range(144)]
for i in range(40):
    y, x = oam[i * 4] - 16, oam[i * 4 + 1] - 8
    for yy in range(max(0, y), min(144, y + 16)):
        for xx in range(max(0, x), min(160, x + 8)): mask[yy][xx] = True
if lcdc & 0x20:
    for yy in range(max(0, wy), 144): mask[yy] = [True] * 160
w, h, rows, _ = png.Reader(filename=os.path.join("gfx", "maps", "map_%02d.png" % mid)).asRGB8()
ref = [list(r) for r in rows]
ok = tot = 0; diff = []
for y in range(144):
    row = []
    for x in range(160):
        if mask[y][x]: row += [0, 0, 255]; continue
        my, mx = (y + scy) % h, (x + scx) % w
        r1 = ref[my][3 * mx:3 * mx + 3]; r2 = img.getpixel((x, y))
        good = all(abs(int(p) - int(q)) <= tol for p, q in zip(r1, r2))
        ok += good; tot += 1
        row += [0, 160, 0] if good else [255, 0, 0]
    diff.append(row)
print("SCX %d SCY %d  BG pixels compared %d  match %.2f%%" % (scx, scy, tot, 100 * ok / max(1, tot)))
if "--diff" in a:
    png.Writer(160, 144, greyscale=False).write(open(a[a.index("--diff") + 1], "wb"), diff)
