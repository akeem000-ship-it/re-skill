"""An overworld map's attribute layout: each 8 x 8 tile tinted by its CGB palette number (bits 0-2), for telling the map's parts apart
(trees, grass, paths, water) when annotating web/js/g3d/field_objects.js.

  map_attr_view.py GFX OUT.png [--region x0,y0,x1,y1] [--scale N]

Writes only OUT.png (keep it out of git: out/). Prints the count of tiles per palette and per distinct (tile, attribute) key."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_map import descriptors, render, lz
from PIL import Image, ImageDraw

TINT = [(255, 255, 255), (128, 128, 128), (255, 60, 60), (60, 255, 60), (60, 60, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255)]


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
    S = int(opt("--scale", "3"))
    img = Image.new("RGB", (512, 512))
    img.putdata([c for row in px for c in row])
    ov = Image.new("RGB", (512, 512))
    g = ImageDraw.Draw(ov)
    cnt = {}
    for ty in range(64):
        for tx in range(64):
            p = at[ty * 64 + tx] & 7
            g.rectangle([tx * 8, ty * 8, tx * 8 + 7, ty * 8 + 7], fill=TINT[p])
            if x0 <= tx * 8 < x1 and y0 <= ty * 8 < y1:
                cnt[p] = cnt.get(p, 0) + 1
    img = Image.blend(img, ov, 0.45).crop((x0, y0, x1, y1)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.NEAREST)
    img.save(out)
    print("palettes:", sorted(cnt.items()))
    print(out)


if __name__ == "__main__":
    main()
