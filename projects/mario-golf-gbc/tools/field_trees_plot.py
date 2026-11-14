"""Plot a dump of the 3D overworld's lifted trees (from a browser run: {"trees": [[x, z, kind, pixels]], "img": the map picture
with the trees painted over, 512 x 512 RGBA}) for checking web/js/g3d/fieldtrees.js and the field_objects.js trees.kinds rectangles.

  field_trees_plot.py DUMP.json OUT.png [--crop x0,y0,x1,y1] [--scale N] [--orig] [--cut] [--cells] [--notrees]

--orig: the picture before the trees were painted over (dump's orig); --cut: the lifted pixels tinted; --cells: the 16 px grid with each cell's corner; --notrees: no tree marks.

Writes only OUT.png (out/)."""
import sys, json
from PIL import Image, ImageDraw

COL = {"egg": (255, 255, 0), "cypress": (0, 255, 255), "bush": (255, 128, 0), "palm": (255, 0, 255), "cactus": (255, 60, 60)}


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    d = json.load(open(a[0]))
    S = int(opt("--scale", "3"))
    src = d["orig"] if "--orig" in a and d.get("orig") else d["img"]
    img = Image.frombytes("RGBA", (512, 512), bytes(src)).convert("RGB")
    if "--cut" in a and d.get("cut"):
        px = img.load()
        for p, v in enumerate(d["cut"]):
            if v:
                r, g_, b = px[p % 512, p // 512]
                px[p % 512, p // 512] = (r // 2 + 128, g_ // 2, b // 2 + 100)
    img = img.resize((512 * S, 512 * S), Image.NEAREST)
    g = ImageDraw.Draw(img)
    if "--cells" in a:
        for v in range(0, 512, 16):
            g.line([(v * S, 0), (v * S, 512 * S)], fill=(255, 255, 255))
            g.line([(0, v * S), (512 * S, v * S)], fill=(255, 255, 255))
        for cy in range(0, 512, 16):
            for cx in range(0, 512, 16):
                g.text((cx * S + 2, cy * S + 2), "%d,%d" % (cx, cy), fill=(255, 255, 255))
    for x, z, kind, n in ([] if "--notrees" in a else d["trees"]):
        c = COL.get(kind, (255, 255, 255))
        g.ellipse([x * S - 4, z * S - 4, x * S + 4, z * S + 4], outline=c, width=2)
        g.text((x * S + 5, z * S - 5), kind[0], fill=c)
    cr = opt("--crop")
    if cr:
        x0, y0, x1, y1 = [int(v) * S for v in cr.split(",")]
        img = img.crop((x0, y0, x1, y1))
    img.save(a[1])
    print(a[1], len(d["trees"]), "trees")


if __name__ == "__main__":
    main()
