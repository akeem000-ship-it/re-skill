"""Dump the PPU state of an emulator state and re-render it from the dump (to check the layers).

Writes OUT.json: LCDC/SCX/SCY/WX/WY, VRAM banks 0/1 ($8000-$9FFF, hex), BG/OBJ palette shadows
(wBGPalBuf $C100 / wObjPalBuf $C140, 64 B each), OAM ($FE00-$FE9F), and OUT.png rendered from
those (BG layer + window + sprites, DMG-less CGB rules). usage: emu_screen_dump.py STATE OUT [--run N]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from PIL import Image

a = sys.argv[1:]
e = Emu(); e.load(a[0]); out = a[1]
if "--run" in a: e.run(int(a[a.index("--run") + 1]))
d = dict(lcdc=e.r8(0xFF40), scx=e.r8(0xFF43), scy=e.r8(0xFF42), wx=e.r8(0xFF4B), wy=e.r8(0xFF4A),
         vram0=bytes(e.vram(0, 0x8000, 0x2000)).hex(), vram1=bytes(e.vram(1, 0x8000, 0x2000)).hex(),
         bgpal=bytes(e.mem[0xC100:0xC140]).hex(), objpal=bytes(e.mem[0xC140:0xC180]).hex(),
         oam=bytes(e.mem[0xFE00:0xFEA0]).hex())
e.stop()
json.dump(d, open(out + ".json", "w"))


def pal(hexs):
    b = bytes.fromhex(hexs); out = []
    for p in range(8):
        cols = []
        for c in range(4):
            v = b[p * 8 + c * 2] | b[p * 8 + c * 2 + 1] << 8
            cols.append(((v & 31) * 255 // 31, (v >> 5 & 31) * 255 // 31, (v >> 10 & 31) * 255 // 31))
        out.append(cols)
    return out


v0, v1 = bytes.fromhex(d["vram0"]), bytes.fromhex(d["vram1"]); bgp, obp = pal(d["bgpal"]), pal(d["objpal"])
lcdc = d["lcdc"]; img = Image.new("RGB", (160, 144)); px = img.load()
def tile_px(v, off, x, y):
    lo, hi = v[off + y * 2], v[off + y * 2 + 1]; m = 0x80 >> x
    return (1 if lo & m else 0) | (2 if hi & m else 0)
def bg_pixel(mapbase, tx, ty, x, y, signed):
    i = mapbase + (ty & 31) * 32 + (tx & 31); t, at = v0[i], v1[i]
    off = (0x1000 + (t if t < 128 else t - 256) * 16) if signed else t * 16
    sx = 7 - x if at & 0x20 else x; sy = 7 - y if at & 0x40 else y
    c = tile_px(v1 if at & 8 else v0, off, sx, sy)
    return bgp[at & 7][c], c, at & 0x80
signed = not (lcdc & 0x10)
prio = [[0] * 160 for _ in range(144)]
for y in range(144):
    for x in range(160):
        wx, wy = d["wx"] - 7, d["wy"]
        if lcdc & 0x20 and x >= wx and y >= wy:
            mb = 0x1C00 if lcdc & 0x40 else 0x1800
            col, c, p = bg_pixel(mb, (x - wx) >> 3, (y - wy) >> 3, (x - wx) & 7, (y - wy) & 7, signed)
        else:
            mb = 0x1C00 if lcdc & 0x08 else 0x1800
            X, Y = (x + d["scx"]) & 255, (y + d["scy"]) & 255
            col, c, p = bg_pixel(mb, X >> 3, Y >> 3, X & 7, Y & 7, signed)
        px[x, y] = col; prio[y][x] = (c != 0, p)
oam = bytes.fromhex(d["oam"]); tall = lcdc & 4
for s in range(39, -1, -1):
    oy, ox, t, at = oam[s * 4:s * 4 + 4]
    if tall: t &= 0xFE
    for y in range(16 if tall else 8):
        for x in range(8):
            sx = 7 - x if at & 0x20 else x; sy = ((15 if tall else 7) - y) if at & 0x40 else y
            c = tile_px(v1 if at & 8 else v0, (t + (sy >> 3)) * 16, sx, sy & 7)
            X, Y = ox - 8 + x, oy - 16 + y
            if c and 0 <= X < 160 and 0 <= Y < 144 and not (at & 0x80 and prio[Y][X][0]):
                px[X, Y] = obp[at & 7][c]
img.resize((320, 288), Image.NEAREST).save(out + ".png")
print(out + ".png", "lcdc %02x scx %d scy %d wx %d wy %d" % (lcdc, d["scx"], d["scy"], d["wx"], d["wy"]))
