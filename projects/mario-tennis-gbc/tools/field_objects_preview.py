"""Preview / authoring aid for the 3D overworld annotations (web/js/field_objects.js).

  field_objects_preview.py MAP OUT.png [--json FILE] [--crop x0,y0,x1,y1] [--scale N] [--grid]

Draws the RPG map (gfx/maps/map_NN.png) with an optional 8-px grid (yellow lines every 64 px, labels every 32)
and the annotations: blocks (orange, cyan line = fold between roof and front wall), stamps (magenta: the
example solid, every matched copy outlined; matching uses the same rule as the game view: >= 80% of the
tile indices + attributes equal) and cards (green). Annotations come from --json (a file with
{"blocks":[...],"stamps":[...],"cards":[...]}) or else from web/js/field_objects.js for that map.
Prints the stamp match counts."""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_map import load
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_objects(mid, path=None):
    if path: return json.load(open(path))
    s = open(os.path.join(ROOT, "web", "js", "field_objects.js")).read()
    s = s[s.index("FIELD_OBJECTS = ") + len("FIELD_OBJECTS = "):s.rindex("};") + 1]
    return json.loads(s).get(str(mid), {})

def find_stamps(m, st):
    tm, at = m["tmap"], m["attr"]; key = lambda x, y: tm[y * 64 + x] | ((at[y * 64 + x] & 0x6F) << 8)
    tw, th, sx, sy = st["w"] // 8, st["h"] // 8, st["x"] // 8, st["y"] // 8
    tpl = [key(sx + x, sy + y) for y in range(th) for x in range(tw)]; need = -(-len(tpl) * 8 // 10); hits = []
    for ty in range(0, 64 - th + 1):
        for tx in range(0, 64 - tw + 1):
            ok = sum(1 for y in range(th) for x in range(tw) if key(tx + x, ty + y) == tpl[y * tw + x])
            if ok >= need: hits.append((tx * 8, ty * 8))
    return hits

def main():
    a = sys.argv[1:]; mid, out = int(a[0]), a[1]
    opt = lambda n, d=None: a[a.index(n) + 1] if n in a else d
    objs = load_objects(mid, opt("--json")); scale = int(opt("--scale", "2"))
    m = load(load_rom(), mid)
    img = Image.open(os.path.join(ROOT, "gfx", "maps", f"map_{mid:02d}.png")).convert("RGBA")
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for b in objs.get("blocks", []):
        d.rectangle((b["x0"], b["y0"], b["x1"] - 1, b["y1"] - 1), fill=(255, 140, 0, 70), outline=(255, 140, 0, 255))
        d.line((b["x0"], b["fold"], b["x1"] - 1, b["fold"]), fill=(0, 255, 255, 255))
    for i, st in enumerate(objs.get("stamps", [])):
        hits = find_stamps(m, st); print(f"stamp {i} {st}: {len(hits)} copies")
        for (x, y) in hits: d.rectangle((x, y, x + st["w"] - 1, y + st["h"] - 1), outline=(255, 0, 255, 255))
        d.rectangle((st["x"], st["y"], st["x"] + st["w"] - 1, st["y"] + st["h"] - 1), fill=(255, 0, 255, 90))
    for c in objs.get("cards", []):
        d.rectangle((c["x0"], c["y0"], c["x1"] - 1, c["y1"] - 1), fill=(0, 255, 0, 60), outline=(0, 255, 0, 255))
    im = Image.alpha_composite(img, ov)
    box = tuple(int(v) for v in opt("--crop", f"0,0,{im.width},{im.height}").split(","))
    im = im.crop(box).resize(((box[2] - box[0]) * scale, (box[3] - box[1]) * scale), Image.NEAREST)
    if "--grid" in a:
        g = ImageDraw.Draw(im)
        for x in range(box[0] - box[0] % 8, box[2] + 1, 8):
            X = (x - box[0]) * scale; g.line((X, 0, X, im.height), fill=(255, 255, 0) if x % 64 == 0 else (70, 70, 70))
            if x % 32 == 0: g.text((X + 2, 2), str(x), fill=(255, 255, 0))
        for y in range(box[1] - box[1] % 8, box[3] + 1, 8):
            Y = (y - box[1]) * scale; g.line((0, Y, im.width, Y), fill=(255, 255, 0) if y % 64 == 0 else (70, 70, 70))
            if y % 32 == 0: g.text((2, Y + 2), str(y), fill=(0, 255, 255))
    im.convert("RGB").save(out); print("wrote", out, im.size, "map size (tiles)", m["header"][4], m["header"][5])

if __name__ == "__main__": main()
