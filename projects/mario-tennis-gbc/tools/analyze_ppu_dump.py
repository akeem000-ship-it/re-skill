"""Explain a PPU dump (emu_screen_dump.py): where every VRAM tile came from and how the visible
20x18 tilemap is composed.

Builds a hash of every 16-byte tile of every clean LZ block in the graphics banks (plus raw 2bpp
runs are not covered), then labels VRAM tile runs by (block, tile offset), prints the BG map cells
as bank:tile/pal with the source block, and lists OAM. usage: analyze_ppu_dump.py DUMP.json [--banks 3c,3d,...]
"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, BANK_SIZE
from scan_jumptables import table
from decompress import decompress

rom = load_rom()
a = sys.argv[1:]; d = json.load(open(a[0]))
banks = [int(x, 16) for x in a[a.index("--banks") + 1].split(",")] if "--banks" in a else \
    [0x17, 0x18, 0x19, 0x38, 0x39, 0x3A, 0x3C, 0x3D, 0x3F, 0x6B, 0x6C, 0x6D, 0x1B, 0x3E, 0x05]
tiles = {}                       # 16-byte tile -> (bank, addr, index)
for b in banks:
    for e in sorted(set(table(rom, b))):
        try:
            out, _ = decompress(rom, b * BANK_SIZE + e - 0x4000, limit=0x4000)
        except Exception:
            continue
        for i in range(len(out) // 16):
            tiles.setdefault(bytes(out[i * 16:i * 16 + 16]), ("%02x:%04x" % (b, e), i))
# also bank 05 font (raw) and bank 18 raw
for i in range(91):
    tiles.setdefault(bytes(rom[to_offset(5, 0x7920 + i * 16):to_offset(5, 0x7920 + i * 16 + 16)]), ("05:7920 font", i))
v = [bytes.fromhex(d["vram0"]), bytes.fromhex(d["vram1"])]


def src(bank, t):
    key = v[bank][t * 16:t * 16 + 16]
    if key == bytes(16): return ("blank", 0)
    return tiles.get(key, ("?", 0))


print("== VRAM tile sources (runs)")
for bank in (0, 1):
    run = None
    for t in range(0x180):
        s = src(bank, t)
        if run and run[1] == s[0] and (s[0] in ("blank", "?") or s[1] == run[3] + (t - run[0])):
            run[2] = t; continue
        if run: print("  bank %d  $%04x-$%04x  %s +%d" % (bank, 0x8000 + run[0] * 16, 0x8000 + run[2] * 16 + 15, run[1], run[3]))
        run = [t, s[0], t, s[1]]
    print("  bank %d  $%04x-$%04x  %s +%d" % (bank, 0x8000 + run[0] * 16, 0x8000 + run[2] * 16 + 15, run[1], run[3]))
lcdc = d["lcdc"]; mb = 0x1C00 if lcdc & 8 else 0x1800; signed = not (lcdc & 0x10)
print("== BG map (bank:tile pal [source])  LCDC %02x signed=%s" % (lcdc, signed))
for ty in range(18):
    row = []
    for tx in range(20):
        i = mb + ty * 32 + tx; t, at = v[0][i], v[1][i]
        ti = (t if t < 128 else t - 256) + 256 if signed else t      # tile number in $8000-based units
        ti = ((0x1000 + (t if t < 128 else t - 256) * 16) // 16) if signed else t
        row.append("%d:%02x/%d" % (at >> 3 & 1, ti, at & 7))
    print("  %2d  %s" % (ty, " ".join(row)))
cells = collections.Counter()
for ty in range(18):
    for tx in range(20):
        i = mb + ty * 32 + tx; t, at = v[0][i], v[1][i]
        ti = ((0x1000 + (t if t < 128 else t - 256) * 16) // 16) if signed else t
        cells[src(at >> 3 & 1, ti)[0]] += 1
print("== cells by source:", dict(cells))
oam = bytes.fromhex(d["oam"])
print("== OAM (y x tile attr) [source]")
for s in range(40):
    oy, ox, t, at = oam[s * 4:s * 4 + 4]
    if oy == 0 or oy >= 160: continue
    print("  %2d  y %3d x %3d  tile %02x attr %02x  %s" % (s, oy - 16, ox - 8, t, at, src(at >> 3 & 1, t)[0]))
pal = bytes.fromhex(d["bgpal"])
print("== BG palettes:", " | ".join(" ".join("%04x" % (pal[p * 8 + c * 2] | pal[p * 8 + c * 2 + 1] << 8) for c in range(4)) for p in range(8)))
