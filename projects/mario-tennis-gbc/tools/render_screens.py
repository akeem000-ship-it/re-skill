"""Render full-screen layouts from the LoadScreen table (39:407E, table 39:40F5, 8 B/entry).

Entry = 4 x (idx, bank) refs:
  tiles   LZ -> WRAM1:D000 -> VRAM1 $9000 (2 KB) / $8800        (signed indexing)
  tilemap LZ -> WRAM3:D000 (32x32)
  attrs   LZ -> WRAM3:D400 (32x32)
  palette $40 raw -> BG palettes 0-7
Tiles referenced from VRAM bank 0 (attr bit3 = 0) are fonts/UI loaded elsewhere; they are drawn
from the same tile set here, so text areas may look wrong.

usage: render_screens.py [id|all]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT
from decompress import decompress
import gfx

TABLE = (0x39, 0x40F5)


def ref(rom, o):
    idx, b = rom[o], rom[o + 1]
    if not 1 <= b < 0x80:
        return None
    p = to_offset(b, 0x4000 + idx)
    return b, rom[p] | rom[p + 1] << 8


def lz(rom, r):
    try:
        return decompress(rom, to_offset(*r), limit=0x2000)[0]
    except Exception:
        return None


def load(rom, sid):
    o = to_offset(TABLE[0], TABLE[1] + sid * 8)
    refs = [ref(rom, o + i * 2) for i in range(4)]
    if None in refs:
        return None
    t, m, a = lz(rom, refs[0]), lz(rom, refs[1]), lz(rom, refs[2])
    if not t or not m or not a or len(m) != 1024 or len(a) != 1024:
        return None
    po = to_offset(*refs[3])
    return dict(refs=refs, tiles=t, tmap=m, attr=a, pal=rom[po:po + 64])


def render(s, crop=(20, 18)):
    v = bytearray(0x1800)
    v[0x1000:0x1800] = s["tiles"][:0x800]
    rest = s["tiles"][0x800:0x1000]; v[0x800:0x800 + len(rest)] = rest
    pals = [gfx.palette_from_bytes(s["pal"], p * 8) for p in range(8)]
    W, H = crop
    img = [[(0, 0, 0)] * (W * 8) for _ in range(H * 8)]
    for ty in range(H):
        for tx in range(W):
            i = ty * 32 + tx
            ti, at = s["tmap"][i], s["attr"][i]
            px = gfx.tile_pixels(v, 0x1000 + (ti if ti < 128 else ti - 256) * 16)
            pal = pals[at & 7]
            for y in range(8):
                sy = 7 - y if at & 0x40 else y
                for x in range(8):
                    sx = 7 - x if at & 0x20 else x
                    img[ty * 8 + y][tx * 8 + x] = pal[px[sy][sx]]
    return img


def main():
    rom = load_rom()
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    ids = range(48) if arg == "all" else [int(arg)]
    out = os.path.join(ROOT, "gfx", "screens"); os.makedirs(out, exist_ok=True)
    meta = []
    for sid in ids:
        s = load(rom, sid)
        if not s:
            if arg != "all":
                print("screen %d: invalid" % sid)
            continue
        gfx.write_png(os.path.join(out, "screen_%02d.png" % sid), render(s), 2)
        meta.append({"id": sid, "file": "screen_%02d.png" % sid, "refs": ["%02x:%04x" % r for r in s["refs"]]})
        print("screen %02d  %s" % (sid, " ".join("%02x:%04x" % r for r in s["refs"])))
    if arg == "all":
        json.dump(meta, open(os.path.join(out, "index.json"), "w"), indent=0)


if __name__ == "__main__":
    main()
