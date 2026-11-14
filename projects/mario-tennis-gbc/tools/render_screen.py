"""Composite a BG screen from (compressed) tile data + tilemap.

usage: render_screen.py --tiles BB:AAAA[@vramaddr] [--tiles ...] --map BB:AAAA [--w 32 --h 18]
                        [--lcdc-signed] [--attr BB:AAAA] [--pal BB:AAAA] [--bgp E4] -o out.png
  --tiles: compressed tile block; @9000 or @8800 or @8000 = destination VRAM (default 9000)
  --map: compressed tilemap (row-major w*h bytes)
  --raw: treat sources as uncompressed (needs --len)
"""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, Labels, to_offset
from decompress import decompress
import gfx


def fetch(rom, labels, spec):
    bank, addr = labels.resolve(spec)
    return decompress(rom, to_offset(bank or 0, addr))[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", action="append", default=[])
    ap.add_argument("--map", required=True)
    ap.add_argument("--attr")
    ap.add_argument("--pal", help="8 BG palettes x 4 colors BGR555 (64 bytes), raw ROM address")
    ap.add_argument("--w", type=int, default=32)
    ap.add_argument("--h", type=int, default=18)
    ap.add_argument("--signed", action="store_true", help="LCDC.4=0: tiles 0-127 at 9000, 128-255 at 8800")
    ap.add_argument("--bgp", default="e4")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("-o", required=True)
    a = ap.parse_args()
    rom = load_rom(); labels = Labels()
    vram = bytearray(0x4000)  # two banks of 8000-9FFF
    for spec in a.tiles:
        dest = 0x9000
        if "@" in spec:
            spec, d = spec.split("@"); dest = int(d, 16)
        vb = 0
        if dest >= 0x10000:
            vb = 1; dest -= 0x10000
        data = fetch(rom, labels, spec)
        base = vb * 0x2000 + dest - 0x8000
        if dest == 0x9000 and len(data) > 0x800:
            # game convention (01:6030): first 2KB -> 9000, next 2KB -> 8800
            vram[base:base + 0x800] = data[:0x800]
            rest = data[0x800:0x1000]
            vram[base - 0x800:base - 0x800 + len(rest)] = rest
        else:
            n = min(len(data), 0x2000 * (vb + 1) - base)
            vram[base:base + n] = data[:n]
    tmap = fetch(rom, labels, a.map)
    attr = fetch(rom, labels, a.attr) if a.attr else None
    pals = None
    if a.pal:
        b, ad = labels.resolve(a.pal)
        o = to_offset(b or 0, ad)
        pals = [gfx.palette_from_bytes(rom, o + p * 8) for p in range(8)]
    dmg = gfx.apply_bgp(int(a.bgp, 16), gfx.DMG_GREYS)
    img = [[(0, 0, 0)] * (a.w * 8) for _ in range(a.h * 8)]
    for ty in range(a.h):
        for tx in range(a.w):
            i = ty * a.w + tx
            t = tmap[i] if i < len(tmap) else 0
            at = attr[i] if attr and i < len(attr) else 0
            if a.signed:
                addr = 0x9000 + (t if t < 128 else t - 256) * 16
            else:
                addr = 0x8000 + t * 16
            vb = (at >> 3) & 1
            px = gfx.tile_pixels(vram, vb * 0x2000 + addr - 0x8000)
            pal = pals[at & 7] if pals else dmg
            for y in range(8):
                sy = 7 - y if at & 0x40 else y
                for x in range(8):
                    sx = 7 - x if at & 0x20 else x
                    img[ty * 8 + y][tx * 8 + x] = pal[px[sy][sx]]
    gfx.write_png(a.o, img, a.scale)
    print("wrote", a.o)


if __name__ == "__main__":
    main()
