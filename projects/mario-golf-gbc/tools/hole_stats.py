"""Statistics of a hole's tilemap and attributes: palettes, VRAM banks and flips used, tile range.

usage: hole_stats.py HOLE_ID [--terrain]
  --terrain also prints the terrain-type map at 2 x 2 cells per character (types in hex)
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_hole import rows, asset


def main():
    rom = load_rom()
    row = rows(rom)[int(sys.argv[1], 16)]
    attrs, tmap = asset(rom, row[1], 0), asset(rom, row[1], 1)
    print("attr values:", " ".join("%02x:%d" % kv for kv in sorted(collections.Counter(attrs).items())))
    for bank in (0, 1):
        ts = [tmap[i] for i in range(4096) if (attrs[i] >> 3 & 1) == bank]
        print("VRAM bank %d: %d cells, tiles %s" % (bank, len(ts), " ".join("%02x" % t for t in sorted(set(ts)))[:400]))
    if "--terrain" in sys.argv:
        ttab = asset(rom, row[0], 3)

        def cell(cx, cy):
            tx, ty = cx // 4, cy // 4
            t, a = tmap[ty * 64 + tx], attrs[ty * 64 + tx]
            sx, sy = cx % 4, cy % 4
            if a & 0x20:
                sx = 3 - sx
            if a & 0x40:
                sy = 3 - sy
            b = ttab[t * 8 + sy * 2 + (sx >> 1)]
            return (b & 0x0F) if sx & 1 else (b >> 4)
        counts = collections.Counter(cell(x, y) for y in range(256) for x in range(256))
        print("terrain cells:", " ".join("%x:%d" % kv for kv in sorted(counts.items())))
        for y in range(0, 256, 4):
            print("".join("%x" % cell(x, y) for x in range(0, 256, 2)))


if __name__ == "__main__":
    main()
