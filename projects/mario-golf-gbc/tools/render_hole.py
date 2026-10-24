"""Render golf holes (overhead view) from the hole asset table 13:4A16 (HoleAssetTable).

Read from the hole loaders 13:4014 / 13:40CA and the locator 13:49EE (HoleAsset):
  row = hole id (wHoleId, WRAM6 $D320); 16 bytes = 8 refs (idx, bank); ref k is a list in that bank
  (word at bank:$4000+idx), and FarDispatchIndexed (00:069A) LZ-decompresses list entry n.
  ref 0 (course): [0] palettes ($40 bytes copied; the first $28 are BG palettes 2-6, checked against the
                  master palettes at $C200 in the emulator; 0, 1 and 7 come from elsewhere: drawn grey), [1] tiles (LZ -> WRAM1 -> VRAM1), [3] terrain table
                  (LZ -> WRAM6 $D800: 8 bytes per tile, 4x4 cells of 4-bit terrain types)
  ref 1 (hole):   [0] attributes (LZ -> WRAM2 $D000), [1] tilemap (LZ -> WRAM3 $D000, 64 x 64,
                  signed $9000 tile numbers), [2] LZ -> WRAM6 $D700, [3] -> WRAM4 $DC00
  refs 2-4: the behind-the-golfer view (hFFB0 = 1 paths)
Output: gfx/hole_XX.png (512 x 512) and, with --terrain, gfx/hole_XX_terrain.png (one colour per type).
usage: render_hole.py [id|all] [--list] [--terrain]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT
from decompress import decompress
import gfx

TABLE = (0x13, 0x4A16)
TERRAIN_COLOURS = [(0, 0, 0), (40, 160, 40), (90, 200, 60), (20, 110, 20), (40, 80, 220), (230, 210, 120),
                   (150, 150, 150), (200, 60, 60), (255, 255, 255), (120, 60, 20), (255, 0, 255), (0, 255, 255),
                   (255, 128, 0), (128, 0, 255), (255, 255, 0), (60, 60, 60)]


def rows(rom):
    o = to_offset(*TABLE)
    out = []
    while rom[o + 1]:
        out.append([(rom[o + 2 * k], rom[o + 2 * k + 1]) for k in range(8)])
        o += 16
    return out


def asset(rom, ref, n, raw=0):
    idx, bank = ref
    lst = rom[to_offset(bank, 0x4000 + idx)] | rom[to_offset(bank, 0x4001 + idx)] << 8
    o = to_offset(bank, lst + 2 * n)
    addr = rom[o] | rom[o + 1] << 8
    if raw:
        p = to_offset(bank, addr)
        return rom[p:p + raw]
    return decompress(rom, to_offset(bank, addr))[0]


def render(rom, row, terrain=False):
    pal_raw = asset(rom, row[0], 0, raw=0x40)
    pals = [gfx.GREYS, gfx.GREYS] + [gfx.palette_from_bytes(pal_raw, 8 * p) for p in range(5)] + [gfx.GREYS]
    tiles, attrs, tmap = asset(rom, row[0], 1), asset(rom, row[1], 0), asset(rom, row[1], 1)
    ttab = asset(rom, row[0], 3) if terrain else None
    img = [[(0, 0, 0)] * 512 for _ in range(512)]
    for ty in range(64):
        for tx in range(64):
            t, a = tmap[ty * 64 + tx], attrs[ty * 64 + tx]
            if terrain:
                for cy in range(4):
                    for cx in range(4):
                        sx = 3 - cx if a & 0x20 else cx
                        sy = 3 - cy if a & 0x40 else cy
                        b = ttab[t * 8 + sy * 2 + (sx >> 1)]
                        v = (b & 0x0F) if sx & 1 else (b >> 4)
                        for y in range(2):
                            for x in range(2):
                                img[ty * 8 + cy * 2 + y][tx * 8 + cx * 2 + x] = TERRAIN_COLOURS[v]
                continue
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
    rs = rows(rom)
    if "--list" in sys.argv:
        for i, r in enumerate(rs):
            print("hole %02x  " % i + " ".join("%02x:%02x" % (b, i_) for i_, b in r[:5]))
        return
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    sel = args[0] if args else "all"
    ids = range(len(rs)) if sel == "all" else [int(sel, 16)]
    os.makedirs(os.path.join(ROOT, "gfx"), exist_ok=True)
    for i in ids:
        for terr in ([False, True] if "--terrain" in sys.argv else [False]):
            path = os.path.join(ROOT, "gfx", "hole_%02x%s.png" % (i, "_terrain" if terr else ""))
            try:
                gfx.write_png(path, render(rom, rs[i], terr))
                print(path)
            except Exception as ex:
                print("hole %02x: %s" % (i, ex))


if __name__ == "__main__":
    main()
