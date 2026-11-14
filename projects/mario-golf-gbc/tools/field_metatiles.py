"""The 16 x 16 metatiles of an overworld map (aligned 2 x 2 tile groups), for annotating its trees in web/js/g3d/field_objects.js.

  field_metatiles.py GFX OUT.png [--region x0,y0,x1,y1] [--scale N] [--min N]

Draws every distinct aligned 16 x 16 group of map graphics id GFX (hex; tile numbers and attributes bits 0-3, 5, 6 as field3d.js keys
them) inside the region (map pixels, default the whole map), numbered, with its count, most common first, and a second image
OUT_where.png: the region with each cell's metatile number. Prints "n: count keys" per metatile (keys = tile | (attr & $6F) << 8,
top-left, top-right, bottom-left, bottom-right): the numbers to annotate. Writes only the PNGs (keep them out of git: out/)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_map import descriptors, render, lz
from PIL import Image, ImageDraw


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    gid, out = int(a[0], 16), a[1]
    opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    rom = load_rom()
    d = descriptors(rom)[gid]
    px = render(rom, d)
    tm, at = lz(rom, d[2]), lz(rom, d[3])
    x0, y0, x1, y1 = [int(v) for v in opt("--region", "0,0,512,512").split(",")]
    S, mn = int(opt("--scale", "3")), int(opt("--min", "1"))
    key = lambda x, y: tm[y * 64 + x] | ((at[y * 64 + x] & 0x6F) << 8)
    groups, where = {}, {}
    for cy in range(y0 // 16, y1 // 16):
        for cx in range(x0 // 16, x1 // 16):
            k = (key(cx * 2, cy * 2), key(cx * 2 + 1, cy * 2), key(cx * 2, cy * 2 + 1), key(cx * 2 + 1, cy * 2 + 1))
            groups.setdefault(k, []).append((cx, cy))
            where[(cx, cy)] = k
    order = sorted(groups, key=lambda k: -len(groups[k]))
    num = {k: i for i, k in enumerate(order)}
    cols = 12
    shown = [k for k in order if len(groups[k]) >= mn]
    sheet = Image.new("RGB", (cols * (16 * S + 40), ((len(shown) + cols - 1) // cols) * (16 * S + 14)), (30, 30, 30))
    g = ImageDraw.Draw(sheet)
    for i, k in enumerate(shown):
        cx, cy = groups[k][0]
        tile = Image.new("RGB", (16, 16))
        tile.putdata([px[cy * 16 + y][cx * 16 + x] for y in range(16) for x in range(16)])
        X, Y = (i % cols) * (16 * S + 40), (i // cols) * (16 * S + 14)
        sheet.paste(tile.resize((16 * S, 16 * S), Image.NEAREST), (X, Y))
        g.text((X + 16 * S + 2, Y), str(num[k]), fill=(255, 255, 0))
        g.text((X + 16 * S + 2, Y + 12), "x%d" % len(groups[k]), fill=(200, 200, 200))
        print("%d: %d %s" % (num[k], len(groups[k]), " ".join("%d" % v for v in k)))
    sheet.save(out)
    full = Image.new("RGB", (512, 512))
    full.putdata([c for row in px for c in row])
    full = full.crop((x0, y0, x1, y1)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.NEAREST)
    g = ImageDraw.Draw(full)
    for (cx, cy), k in where.items():
        X, Y = (cx * 16 - x0) * S, (cy * 16 - y0) * S
        g.rectangle([X, Y, X + 16 * S - 1, Y + 16 * S - 1], outline=(255, 255, 0, 80))
        g.text((X + 2, Y + 2), str(num[k]), fill=(255, 255, 255))
    full.save(out.replace(".png", "_where.png"))
    print(out, "and", out.replace(".png", "_where.png"))


if __name__ == "__main__":
    main()
