"""Prototype of the overworld object detection used by the 3D view (web/js/voxel.js fieldObjects): split an
RPG map's tiles into ground and raised objects (buildings, trees, posts) and show the result.

ground: a tile (index + palette/bank/flip attributes, priority bit ignored) is ground when it somewhere forms a
3x3 block of itself (grass, paths, floors, water), or when, iterating, at least half of its placements have
all four neighbours ground or itself (flowers, path edges, court lines). Everything else in the map area is
object material; 4-connected object regions of >= 4 tiles are objects: small ones (<= 4x5 tiles) are props
(trees, bushes, posts) that stand up as cards, larger ones are buildings that fold up (front wall + roof).

usage: seg_map_objects.py OUT.png [ids...]   (default: all RPG maps 17-36)"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_map import load, render
from PIL import Image, ImageDraw

def walkable_seed(coll, W, H):
    """metatile cells the player can reach: collision-0 cells enclosed by the solid outline (offline stand-in for
    the runtime flood fill from the player's position)"""
    MW, MH = 32, 32                                  # the whole grid: outlines may close beyond the drawn area
    out = [[False] * MW for _ in range(MH)]
    st = [(x, y) for x in range(MW) for y in (0, MH - 1)] + [(x, y) for y in range(MH) for x in (0, MW - 1)]
    while st:
        x, y = st.pop()
        if not (0 <= x < MW and 0 <= y < MH) or out[y][x] or coll[y * 32 + x] == 0x0F: continue
        out[y][x] = True; st += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return [(x, y) for y in range(MH) for x in range(MW) if not out[y][x] and coll[y * 32 + x] != 0x0F]

def segment(tmap, attr, W, H, S=64, seed_cells=()):
    key = lambda x, y: (tmap[y * S + x], attr[y * S + x] & 0x6F)
    inside = lambda x, y: 0 <= x < W and 0 <= y < H
    keys = {}
    for y in range(H):
        for x in range(W): keys.setdefault(key(x, y), []).append((x, y))
    ground = set()
    for (mx, my) in seed_cells:                    # tiles under walkable metatiles (priority tiles excluded: the player walks behind those)
        for dy in (0, 1):
            for dx in (0, 1):
                x, y = mx * 2 + dx, my * 2 + dy
                if inside(x, y) and not attr[y * S + x] & 0x80: ground.add(key(x, y))
    for k, pl in keys.items():
        for (x, y) in pl:
            if all(inside(x + dx, y + dy) and key(x + dx, y + dy) == k for dx in (-1, 0, 1) for dy in (-1, 0, 1)): ground.add(k); break
    changed = True
    while changed:
        changed = False
        for k, pl in keys.items():
            if k in ground: continue
            ok = 0
            for (x, y) in pl:
                if all((not inside(x + dx, y + dy)) or key(x + dx, y + dy) in ground or key(x + dx, y + dy) == k for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): ok += 1
            if ok * 2 >= len(pl): ground.add(k); changed = True
    obj = [[key(x, y) not in ground for x in range(W)] for y in range(H)]
    seen = [[False] * W for _ in range(H)]; comps = []
    for y in range(H):
        for x in range(W):
            if not obj[y][x] or seen[y][x]: continue
            st = [(x, y)]; seen[y][x] = True; cells = []
            while st:
                cx, cy = st.pop(); cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if inside(nx, ny) and obj[ny][nx] and not seen[ny][nx]: seen[ny][nx] = True; st.append((nx, ny))
            if len(cells) < 4: continue
            xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
            bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
            comps.append(dict(cells=cells, x0=min(xs), y0=min(ys), w=bw, h=bh, kind="prop" if bw <= 4 and bh <= 5 else "building"))
    return ground, comps

if __name__ == "__main__":
    rom = load_rom(); out = sys.argv[1]; ids = [int(a) for a in sys.argv[2:]] or list(range(17, 37))
    tiles = []
    for mid in ids:
        m = load(rom, mid)
        if len(m["tmap"]) < 4096: continue
        W, H = (m["header"][4] or 64), (m["header"][5] or 64); W, H = min(W, 64), min(H, 64)
        g, comps = segment(m["tmap"], m["attr"], W, H, seed_cells=walkable_seed(m["w4"], W, H) if len(m["w4"]) >= 1024 else ())
        img = render(m)
        if not isinstance(img, Image.Image): img = Image.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gfx", "maps", f"map_{mid:02d}.png"))
        im = img.convert("RGBA").crop((0, 0, W * 8, H * 8)); ov = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
        for c in comps:
            col = (255, 0, 255, 90) if c["kind"] == "prop" else (255, 140, 0, 90)
            for (x, y) in c["cells"]: d.rectangle((x * 8, y * 8, x * 8 + 7, y * 8 + 7), fill=col)
            d.rectangle((c["x0"] * 8, c["y0"] * 8, (c["x0"] + c["w"]) * 8 - 1, (c["y0"] + c["h"]) * 8 - 1), outline=(255, 255, 0, 255))
        t = Image.alpha_composite(im, ov); t.thumbnail((400, 400)); tiles.append((mid, t))
        print(mid, W, H, "objects", len(comps), "props", sum(c["kind"] == "prop" for c in comps))
    cols = 5; rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (410 * cols, 420 * rows), (30, 30, 30)); d = ImageDraw.Draw(sheet)
    for i, (mid, t) in enumerate(tiles): sheet.paste(t, ((i % cols) * 410, (i // cols) * 420 + 14)); d.text(((i % cols) * 410 + 2, (i // cols) * 420), f"map {mid}", fill=(255, 255, 255))
    sheet.save(out); print("wrote", out)
