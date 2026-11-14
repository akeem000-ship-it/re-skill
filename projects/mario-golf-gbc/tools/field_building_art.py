"""The overworld's buildings as the map paints them, for annotating web/js/g3d/field_objects.js `houses`.

  field_building_art.py DUMP.json OUT.png x0,y0,x1,y1 [x0,y0,x1,y1 ...] [--scale N] [--img]

DUMP.json: a picture dump of the live map (out/scratch/fieldshots2.mjs --dump: its `orig`, 512 x 512 RGBA, the map as the game has
it, map-script edits included). Prints each rectangle as letters (one per colour, with the colour list) and writes the rectangles
side by side, scaled up, to OUT.png (out/)."""
import sys, json
from PIL import Image


def main():
    a = sys.argv[1:]
    if len(a) < 3:
        print(__doc__)
        return
    S = int(a[a.index("--scale") + 1]) if "--scale" in a else 12
    rects = [tuple(int(v) for v in r.split(",")) for r in a[2:] if r.count(",") == 3]
    d = json.load(open(a[0]))
    px = d["img" if "--img" in a else "orig"]
    at = lambda x, y: tuple(px[(y * 512 + x) * 4:(y * 512 + x) * 4 + 3])
    parts = []
    for (x0, y0, x1, y1) in rects:
        cols = {}
        print(f"{x0},{y0} - {x1},{y1}")
        for y in range(y0, y1):
            row = ""
            for x in range(x0, x1):
                c = at(x, y)
                if c not in cols:
                    cols[c] = "abcdefghijklmnopqrstuvwxyz"[len(cols)]
                row += cols[c]
            print(f"  {y:3d} {row}")
        print("  " + "  ".join(f"{k}=#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c, k in cols.items()))
        im = Image.new("RGB", (x1 - x0, y1 - y0))
        for y in range(y0, y1):
            for x in range(x0, x1):
                im.putpixel((x - x0, y - y0), at(x, y))
        parts.append(im.resize(((x1 - x0) * S, (y1 - y0) * S), Image.NEAREST))
    out = Image.new("RGB", (sum(p.width + 8 for p in parts), max(p.height for p in parts)), (40, 40, 40))
    x = 0
    for p in parts:
        out.paste(p, (x, 0))
        x += p.width + 8
    out.save(a[1])


if __name__ == "__main__":
    main()
