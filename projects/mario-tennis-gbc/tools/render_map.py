"""Render RPG-mode maps from the LoadMap descriptor table (0A:59D9, 16 B/entry).

Descriptor = 8 x (idx, bank) refs into bank tables ($4000+idx):
  w0 header   $88 B raw  -> WRAM6:DC08  (DC0A..DC0D -> wC329..wC32C)
  w1 palette  $40 B raw  -> BG palettes (game loads pals 2-7 from +$10)
  w2 tilemap  LZ 4096    -> WRAM3:D000  (64x64 tile indices, signed $9000 addressing)
  w3 attrmap  LZ 4096    -> WRAM2:D000  (CGB attributes; bit3 = VRAM bank 1)
  w4 LZ 1024             -> WRAM6:D000  (collision/height? TBD)
  w5 LZ 1024             -> WRAM6:D400  (TBD)
  w6 unused by loader
  w7 tiles    LZ         -> WRAM1:D000 -> VRAM1 $9000 (first 2KB) / $8800 (rest)

usage: render_map.py [id|all] [--crop]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT
from decompress import decompress
import gfx

TABLE = (0x0A, 0x59D9)
NMAPS = 37


def ref(rom, o):
    idx, b = rom[o], rom[o + 1]
    p = to_offset(b, 0x4000 + idx)
    return b, rom[p] | rom[p + 1] << 8


def load(rom, mid):
    o = to_offset(TABLE[0], TABLE[1] + mid * 16)
    refs = [ref(rom, o + i * 2) for i in range(8)]
    def lz(r):
        try:
            return decompress(rom, to_offset(*r))[0]
        except Exception:
            return b""
    hdr = rom[to_offset(*refs[0]):to_offset(*refs[0]) + 0x88]
    pal = rom[to_offset(*refs[1]):to_offset(*refs[1]) + 0x40]
    return dict(refs=refs, header=hdr, pal=pal, tmap=lz(refs[2]), attr=lz(refs[3]),
                w4=lz(refs[4]), w5=lz(refs[5]), tiles=lz(refs[7]))


def render(m, crop=False):
    vram1 = bytearray(0x2000)
    t = m["tiles"]
    vram1[0x1000:0x1800] = t[:0x800]
    vram1[0x0800:0x0800 + len(t[0x800:0x1000])] = t[0x800:0x1000]
    pals = [gfx.palette_from_bytes(m["pal"], p * 8) for p in range(8)]
    S = 64 if len(m["tmap"]) >= 4096 else 32   # map stride
    W = H = S
    if crop and m["header"][4] and m["header"][5]:
        W, H = min(S, m["header"][4]), min(S, m["header"][5])
    img = [[(0, 0, 0)] * (W * 8) for _ in range(H * 8)]
    for ty in range(H):
        for tx in range(W):
            i = ty * S + tx
            ti, at = m["tmap"][i], m["attr"][i]
            addr = 0x1000 + (ti if ti < 128 else ti - 256) * 16
            px = gfx.tile_pixels(vram1, addr)
            pal = pals[at & 7]
            for y in range(8):
                sy = 7 - y if at & 0x40 else y
                row = img[ty * 8 + y]
                for x in range(8):
                    sx = 7 - x if at & 0x20 else x
                    row[tx * 8 + x] = pal[px[sy][sx]]
    return img


def main():
    rom = load_rom()
    pos = [x for x in sys.argv[1:] if not x.startswith("--")]
    arg = pos[0] if pos else "all"
    ids = range(NMAPS) if arg == "all" else [int(arg)]
    os.makedirs(os.path.join(ROOT, "gfx", "maps"), exist_ok=True)
    meta = []
    for i in ids:
        m = load(rom, i)
        if len(m["tmap"]) not in (1024, 4096) or len(m["attr"]) != len(m["tmap"]):
            print("map %02d  skipped (tilemap %d B, attr %d B)" % (i, len(m["tmap"]), len(m["attr"])))
            continue
        path = os.path.join(ROOT, "gfx", "maps", "map_%02d.png" % i)
        gfx.write_png(path, render(m, "--crop" in sys.argv), 1)
        print("map %02d  hdr=%s  tiles=%d  -> %s" % (i, m["header"][:8].hex(), len(m["tiles"]) // 16, path))
        meta.append({"id": i, "file": "map_%02d.png" % i, "stride": 64 if len(m["tmap"]) >= 4096 else 32,
                     "kind": "court" if len(m["tmap"]) < 4096 else "rpg", "ntiles": len(m["tiles"]) // 16,
                     "refs": ["%02x:%04x" % r for r in m["refs"]],
                     "palettes": [["#%02x%02x%02x" % c for c in gfx.palette_from_bytes(m["pal"], p * 8)] for p in range(8)]})
    if arg == "all":
        import json
        with open(os.path.join(ROOT, "gfx", "maps", "index.json"), "w") as f:
            json.dump(meta, f, indent=0)


if __name__ == "__main__":
    main()
