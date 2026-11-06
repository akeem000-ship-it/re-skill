"""Render overworld (RPG) maps from the map graphics descriptors (0B:4048, MapGfxTable).

Read from the loader 0B:44C4 / 0B:440C (MapLoadGfx). A descriptor is 18 bytes = 9 refs, each
(idx, bank) into a bank's $4000 table; the list ends with a zero word:
  w0 header   16 bytes raw  -> $C600 (bytes 2-5 -> $C329-$C32C)
  w1 palette  $40 bytes raw -> WRAM1:D000; BG palettes 2-7 from +$10
  w2 tilemap  LZ 4096       -> WRAM3:D000 (64x64 tile numbers, signed $9000 addressing)
  w3 attrmap  LZ 4096       -> WRAM2:D000 (CGB attributes: bits 0-2 palette, 3 VRAM bank, 5/6 flip)
  w4 LZ 1024 -> WRAM6:D000    w5 LZ 1024 -> WRAM6:D400    w6 not loaded    w7 LZ -> WRAM6:D800
  w8 tiles    LZ            -> WRAM1:D000; first $800 bytes -> VRAM1 $9000, next $800 -> VRAM1 $8800
The map gfx id is wMapGfx (MapTable byte 1). Palettes 0-1 are not in the descriptor: drawn grey.
Output: gfx/map_XX.png (512x512).
usage: render_map.py [id|all] [--list]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT
from decompress import decompress
import gfx

TABLE = (0x0B, 0x4048)


def descriptors(rom):
    o = to_offset(*TABLE)
    out = []
    while rom[o] | rom[o + 1]:
        out.append([(rom[o + 2 * k], rom[o + 2 * k + 1]) for k in range(9)])
        o += 18
    return out


def entry(rom, ref):
    idx, bank = ref
    o = to_offset(bank, 0x4000 + idx)
    return bank, rom[o] | rom[o + 1] << 8


def lz(rom, ref):
    bank, addr = entry(rom, ref)
    return decompress(rom, to_offset(bank, addr))[0]


def raw(rom, ref, n):
    bank, addr = entry(rom, ref)
    o = to_offset(bank, addr)
    return rom[o:o + n]


def render(rom, d):
    pal_raw = raw(rom, d[1], 0x40)
    pals = [gfx.GREYS, gfx.GREYS] + [gfx.palette_from_bytes(pal_raw, 0x10 + 8 * p) for p in range(6)]
    tmap, amap, tiles = lz(rom, d[2]), lz(rom, d[3]), lz(rom, d[8])
    img = [[(0, 0, 0)] * 512 for _ in range(512)]
    for ty in range(64):
        for tx in range(64):
            t, a = tmap[ty * 64 + tx], amap[ty * 64 + tx]
            off = t * 16 if t < 0x80 else 0x800 + (t - 0x80) * 16
            if off + 16 > len(tiles):
                continue
            px = gfx.tile_pixels(tiles, off)
            pal = pals[a & 7]
            for y in range(8):
                sy = 7 - y if a & 0x40 else y
                for x in range(8):
                    sx = 7 - x if a & 0x20 else x
                    img[ty * 8 + y][tx * 8 + x] = pal[px[sy][sx]]
    return img


def main():
    rom = load_rom()
    ds = descriptors(rom)
    if "--list" in sys.argv:
        for i, d in enumerate(ds):
            print("gfx %02x  " % i + " ".join("%02x:%04x" % entry(rom, r) for r in d))
        return
    sel = sys.argv[1] if len(sys.argv) > 1 else "all"
    ids = range(len(ds)) if sel == "all" else [int(sel, 16)]
    os.makedirs(os.path.join(ROOT, "gfx"), exist_ok=True)
    for i in ids:
        path = os.path.join(ROOT, "gfx", "map_%02x.png" % i)
        gfx.write_png(path, render(rom, ds[i]))
        print(path)


if __name__ == "__main__":
    main()
