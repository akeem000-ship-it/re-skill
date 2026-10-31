"""Preview / authoring aid for the 3D overworld's annotations (web/js/g3d/field_objects.js), adapted from Mario Tennis's tool.

  field_objects_preview.py GFX OUT.png [--json FILE] [--crop x0,y0,x1,y1] [--scale N] [--grid] [--walls]

Draws the overworld map of graphics id GFX (hex, MapGfxTable 0B:4048; rendered as tools/render_map.py does, from the ROM) with an
optional 8-px grid (yellow lines every 64 px), the collision grid's blocked 16 x 16 cells (--walls: red; WRAM6 $D000 = the
descriptor's ref 4, low nibble $0F) and the annotations: blocks (orange, a cyan line at the fold between roof and front wall),
stamps (magenta: the example, thick; every map tile of the same number and attribute as one of its tiles outlined, as
field3d.js stands them up) and cards (green). Annotations come from --json (a file {"blocks":[...],"stamps":[...],"cards":[...]}) or else from
web/js/g3d/field_objects.js for that id. Prints the stamp match counts. Writes only OUT.png (keep it out of git: out/)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, ROOT
from render_map import descriptors, render, lz
from PIL import Image, ImageDraw


def load_objects(gid, path=None):
    if path:
        return json.load(open(path))
    s = open(os.path.join(ROOT, "web", "js", "g3d", "field_objects.js")).read()
    s = s[s.index("FIELD_OBJECTS = ") + len("FIELD_OBJECTS = "):s.rindex("};") + 1]
    return json.loads(s).get(str(gid), {})


def plain_tile(px, tx, ty):
    c0 = px[ty * 8][tx * 8]
    return sum(1 for y in range(8) for x in range(8) if px[ty * 8 + y][tx * 8 + x] == c0) >= 58


def find_stamps(tm, at, st, px):
    """the map tiles that stand up for a stamp, as field3d.js finds them: every tile whose number and attribute (flips, bank,
    palette) are one of the example rectangle's tiles, plain one-colour tiles left out"""
    key = lambda x, y: tm[y * 64 + x] | ((at[y * 64 + x] & 0x6F) << 8)
    keys = {key(x, y) for y in range(st["y"] // 8, (st["y"] + st["h"]) // 8) for x in range(st["x"] // 8, (st["x"] + st["w"]) // 8) if not plain_tile(px, x, y)}
    return [(x * 8, y * 8) for y in range(64) for x in range(64) if key(x, y) in keys]


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    gid, out = int(a[0], 16), a[1]
    opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    rom = load_rom()
    d = descriptors(rom)[gid]
    objs = load_objects(gid, opt("--json"))
    scale = int(opt("--scale", "2"))
    px = render(rom, d)
    img = Image.new("RGBA", (512, 512))
    img.putdata([(*c, 255) for row in px for c in row])
    tm, at, coll = lz(rom, d[2]), lz(rom, d[3]), lz(rom, d[4])
    img = img.resize((512 * scale, 512 * scale), Image.NEAREST)
    g = ImageDraw.Draw(img, "RGBA")
    S = lambda v: v * scale
    if "--grid" in a:
        for v in range(0, 512, 8):
            c = (255, 255, 0, 160) if v % 64 == 0 else (255, 255, 0, 40)
            g.line([(S(v), 0), (S(v), S(512))], fill=c)
            g.line([(0, S(v)), (S(512), S(v))], fill=c)
    if "--walls" in a:
        for cy in range(32):
            for cx in range(32):
                if (coll[cy * 32 + cx] & 0x0F) == 0x0F:
                    g.rectangle([S(cx * 16), S(cy * 16), S(cx * 16 + 16) - 1, S(cy * 16 + 16) - 1], outline=(255, 40, 40, 200))
    for b in objs.get("blocks", []):
        g.rectangle([S(b["x0"]), S(b["y0"]), S(b["x1"]) - 1, S(b["y1"]) - 1], outline=(255, 150, 0, 255), width=2)
        g.line([(S(b["x0"]), S(b["fold"])), (S(b["x1"]), S(b["fold"]))], fill=(0, 255, 255, 255), width=2)
    for st in objs.get("stamps", []):
        hits = find_stamps(tm, at, st, px)
        for (x, y) in hits:
            g.rectangle([S(x), S(y), S(x + 8) - 1, S(y + 8) - 1], outline=(255, 0, 255, 150))
        g.rectangle([S(st["x"]), S(st["y"]), S(st["x"] + st["w"]) - 1, S(st["y"] + st["h"]) - 1], outline=(255, 0, 255, 255), width=3)
        print(f"stamp at {st['x']},{st['y']} ({st.get('plant', '')}): {len(hits)} tiles")
    for c in objs.get("cards", []):
        g.rectangle([S(c["x"]), S(c["y"]), S(c["x"] + c["w"]) - 1, S(c["y"] + c["h"]) - 1], outline=(0, 255, 0, 255), width=2)
    crop = opt("--crop")
    if crop:
        x0, y0, x1, y1 = [int(v) for v in crop.split(",")]
        img = img.crop((S(x0), S(y0), S(x1), S(y1)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
