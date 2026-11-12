"""The distinct 8 x 8 tiles of an overworld map (tile number and attributes bits 0-3, 5, 6, as field3d.js keys them), for annotating
web/js/g3d/field_objects.js by tile (the trees' anchor tiles).

  map_tiles_sheet.py GFX OUT.png [--pal P,P] [--scale N] [--where x0,y0,x1,y1]

Draws each distinct key (only those in palettes P when given), numbered by its key (tile | (attr & $6F) << 8) with its count, most
common first. --where: instead, the map's region (px) with each tile of those palettes labelled with its key's tile number (hex).
Writes only OUT.png (out/)."""
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
    pals = {int(v) for v in opt("--pal").split(",")} if opt("--pal") else None
    S = int(opt("--scale", "4"))
    seen = {}
    for ty in range(64):
        for tx in range(64):
            if pals is not None and (at[ty * 64 + tx] & 7) not in pals:
                continue
            k = tm[ty * 64 + tx] | ((at[ty * 64 + tx] & 0x6F) << 8)
            seen.setdefault(k, []).append((tx, ty))
    keys = sorted(seen, key=lambda k: -len(seen[k]))
    if opt("--where"):
        x0, y0, x1, y1 = [int(v) for v in opt("--where").split(",")]
        img = Image.new("RGB", (512, 512))
        img.putdata([c for row in px for c in row])
        img = img.crop((x0, y0, x1, y1)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.NEAREST)
        g = ImageDraw.Draw(img)
        for k, at_ in seen.items():
            for tx, ty in at_:
                if x0 <= tx * 8 < x1 and y0 <= ty * 8 < y1:
                    X, Y = (tx * 8 - x0) * S, (ty * 8 - y0) * S
                    g.rectangle([X, Y, X + 8 * S - 1, Y + 8 * S - 1], outline=(255, 255, 255))
                    g.text((X + 2, Y + 2), "%02x" % (k & 0xFF) + ("h" if k & 0x2000 else "") + ("v" if k & 0x4000 else ""), fill=(255, 255, 0))
        img.save(out)
        print(out)
        return
    cols, cw, ch = 16, 8 * S + 44, 8 * S + 4
    img = Image.new("RGB", (cols * cw, ((len(keys) + cols - 1) // cols) * ch), (30, 30, 30))
    g = ImageDraw.Draw(img)
    for i, k in enumerate(keys):
        tx, ty = seen[k][0]
        t = Image.new("RGB", (8, 8))
        t.putdata([px[ty * 8 + y][tx * 8 + x] for y in range(8) for x in range(8)])
        X, Y = (i % cols) * cw, (i // cols) * ch
        img.paste(t.resize((8 * S, 8 * S), Image.NEAREST), (X, Y))
        g.text((X + 8 * S + 2, Y), str(k), fill=(255, 255, 0))
        g.text((X + 8 * S + 2, Y + 12), "x%d" % len(seen[k]), fill=(190, 190, 190))
    img.save(out)
    print(out, len(keys), "keys")


if __name__ == "__main__":
    main()
