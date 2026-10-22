"""Export the roster's faces as reference art for HD redraws (palette indices: 0 clear, 1-3 as 85 / 170 / 255 grey).

  portraits/NN_name.png   the 24x24 select / message portrait (LZ, 3x3 tiles row-major; table 16:6968, a word per char)
  heads/NN_name_a.png     the 16x16 HUD heads beside the score (raw 2bpp, 2x2 tiles column-major; 18:5AF0 / 18:62F0
  heads/NN_name_b.png     + 64 per char)
Output goes to out/hd_refs/faces/ (gitignored: it is ROM-derived; never commit it).

usage: export_portraits.py [outdir]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import png
from gbrom import load_rom, to_offset, ROOT
from decompress import decompress
from render_sprites import ROSTER
import gfx

PORTRAIT_TABLE = (0x16, 0x6968)
HEAD_BASES = (0x5AF0, 0x62F0)


def grey_png(path, idx, w, h):
    rows = []
    for y in range(h):
        r = []
        for x in range(w):
            v = idx[y][x]
            r.extend((85 * v, 85 * v, 85 * v, 255) if v else (0, 0, 0, 0))
        rows.append(r)
    with open(path, "wb") as f:
        png.Writer(w, h, greyscale=False, alpha=True).write(f, rows)


def tiles(data, off, cols, rows, col_major):
    img = [[0] * (cols * 8) for _ in range(rows * 8)]
    for t in range(cols * rows):
        px = gfx.tile_pixels(data, off + t * 16)
        cx, cy = (t // rows, t % rows) if col_major else (t % cols, t // cols)
        for y in range(8):
            for x in range(8):
                img[cy * 8 + y][cx * 8 + x] = px[y][x]
    return img


def main():
    rom = load_rom()
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "hd_refs", "faces")
    for d in ("portraits", "heads"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    for c, name in enumerate(ROSTER):
        if name.startswith("unused"):
            continue
        tag = "%02d_%s" % (c, name.replace(" ", "").replace(".", ""))
        o = to_offset(*PORTRAIT_TABLE) + 2 * c
        ptr = rom[o] | rom[o + 1] << 8
        if 0x4000 <= ptr < 0x8000:
            data, _ = decompress(rom, to_offset(PORTRAIT_TABLE[0], ptr))
            if len(data) >= 144:
                grey_png(os.path.join(out, "portraits", tag + ".png"), tiles(data, 0, 3, 3, False), 24, 24)
        for k, hb in enumerate(HEAD_BASES):
            grey_png(os.path.join(out, "heads", "%s_%s.png" % (tag, "ab"[k])), tiles(rom, to_offset(0x18, hb + 64 * c), 2, 2, True), 16, 16)
        print(tag)


if __name__ == "__main__":
    main()
