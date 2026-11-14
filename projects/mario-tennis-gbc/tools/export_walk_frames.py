"""Export the roster's overworld (campus) walking sprites as reference art, the frames web/js/look/mods.js rewrites for a mod's body.

Char C's walking object is CharObjectTable 04:4C29[C]; the object's bank ref is ObjectList 04:4F75[obj] (idx, bank); its header at
[bank:$4000+idx] has the frame pointer list at +4 (up to 16 words, $4000-$7FFF). Each frame block is 256 bytes: 4 facings x 64
bytes, each facing a 16x16 picture of 2x2 tiles (8x8, 2bpp) column-major (tile t -> column t//2, row t%2), as mods.js charGfx /
bodyFrames read it. Several frame numbers can share one block.

  walk/NN_name.png        one row per frame number (0-15), one column per facing (0-3), palette indices (0 clear, 1-3 as 85 /
                          170 / 255 grey), 16x16 each with a 1 px gap
  walk/manifest.json      per char: object id, bank, the frame pointers (hex) and which frame numbers share a block
Output goes to out/hd_refs/walk/ unless a directory is given (gitignored: it is ROM-derived; never commit it).

usage: export_walk_frames.py [outdir]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import png
from gbrom import load_rom, to_offset, ROOT
from render_sprites import ROSTER
import gfx

CHAR_OBJECT_TABLE = (0x04, 0x4C29)
OBJECT_LIST = (0x04, 0x4F75)


def u16(rom, bank, addr):
    o = to_offset(bank, addr)
    return rom[o] | rom[o + 1] << 8


def walk_object(rom, c):
    obj = rom[to_offset(*CHAR_OBJECT_TABLE) + c]
    w = u16(rom, OBJECT_LIST[0], OBJECT_LIST[1] + 2 * obj)
    bank, idx = w >> 8, w & 0xFF
    hdr = u16(rom, bank, 0x4000 + idx)
    flist = u16(rom, bank, hdr + 4)
    ptrs = []
    for i in range(16):
        p = u16(rom, bank, flist + 2 * i)
        if p < 0x4000 or p >= 0x8000:
            break
        ptrs.append(p)
    return obj, bank, ptrs


def facing(rom, off):
    """a 16x16 facing: 2x2 tiles column-major"""
    img = [[0] * 16 for _ in range(16)]
    for t in range(4):
        px = gfx.tile_pixels(rom, off + t * 16)
        c, r = t // 2, t % 2
        for y in range(8):
            for x in range(8):
                img[r * 8 + y][c * 8 + x] = px[y][x]
    return img


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "hd_refs", "walk")
    os.makedirs(out, exist_ok=True)
    rom = load_rom()
    manifest = []
    for c, name in enumerate(ROSTER):
        obj, bank, ptrs = walk_object(rom, c)
        if not ptrs:
            continue
        W, H = 4 * 17 - 1, len(ptrs) * 17 - 1
        rows = [[0, 0, 0, 0] * W for _ in range(H)]
        for f, p in enumerate(ptrs):
            base = to_offset(bank, p)
            for fc in range(4):
                img = facing(rom, base + fc * 64)
                for y in range(16):
                    for x in range(16):
                        v = img[y][x]
                        if v:
                            o = (fc * 17 + x) * 4
                            rows[f * 17 + y][o:o + 4] = [85 * v, 85 * v, 85 * v, 255]
        fname = f"{c:02d}_{name.replace(' ', '_').replace('.', '')}.png"
        with open(os.path.join(out, fname), "wb") as fh:
            png.Writer(W, H, greyscale=False, alpha=True).write(fh, rows)
        shared = {}
        for f, p in enumerate(ptrs):
            shared.setdefault(f"{p:04x}", []).append(f)
        manifest.append({"char": c, "name": name, "file": fname, "object": obj, "bank": f"{bank:02x}",
                         "frames": [f"{p:04x}" for p in ptrs], "blocks": shared})
        print(f"char {c:2d} {name:<12} object {obj:3d} bank {bank:02x} {len(ptrs):2d} frames, {len(shared):2d} blocks")
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)


if __name__ == "__main__":
    main()
