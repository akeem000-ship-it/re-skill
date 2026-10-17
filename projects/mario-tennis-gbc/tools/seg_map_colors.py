"""Colour-based variant of seg_map_objects.py: ground colours are the colours under walkable metatiles plus
colours that form large flat areas; a tile is object material when a quarter of its pixels use other colours.
usage: seg_map_colors.py OUT.png [ids...]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from render_map import load
from seg_map_objects import walkable_seed
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def segment(img, W, H, seed, prio):
    px = img.load(); WP, HP = W * 8, H * 8
    from collections import Counter
    gc = Counter()
    for (mx, my) in seed:
        for y in range(my * 16, min(HP, my * 16 + 16)):
            for x in range(mx * 16, min(WP, mx * 16 + 16)):
                if not prio[(y // 8) * 64 + x // 8]: gc[px[x, y]] += 1
    tot = sum(gc.values()) or 1
    ground = {c for c, n in gc.items() if n >= tot * 0.004}
    # large flat colour regions (court surfaces, water, floors): 4-connected runs of one colour >= 1200 px
    seen = bytearray(WP * HP)
    for y in range(HP):
        for x in range(WP):
            if seen[y * WP + x]: continue
            c = px[x, y]; st = [(x, y)]; seen[y * WP + x] = 1; n = 0
            while st:
                cx, cy = st.pop(); n += 1
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < WP and 0 <= ny < HP and not seen[ny * WP + nx] and px[nx, ny] == c: seen[ny * WP + nx] = 1; st.append((nx, ny))
            if n >= 1200: ground.add(c)
    obj = [[False] * W for _ in range(H)]
    for ty in range(H):
        for tx in range(W):
            bad = sum(1 for y in range(8) for x in range(8) if px[tx * 8 + x, ty * 8 + y] not in ground)
            obj[ty][tx] = bad >= 16
    seen = [[False] * W for _ in range(H)]; comps = []
    for y in range(H):
        for x in range(W):
            if not obj[y][x] or seen[y][x]: continue
            st = [(x, y)]; seen[y][x] = True; cells = []
            while st:
                cx, cy = st.pop(); cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and obj[ny][nx] and not seen[ny][nx]: seen[ny][nx] = True; st.append((nx, ny))
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
        W, H = min(64, m["header"][4] or 64), min(64, m["header"][5] or 64)
        img = Image.open(os.path.join(ROOT, "gfx", "maps", f"map_{mid:02d}.png")).convert("RGB")
        seed = walkable_seed(m["w4"], W, H) if len(m["w4"]) >= 1024 else []
        g, comps = segment(img, W, H, seed, [a & 0x80 for a in m["attr"]])
        im = img.convert("RGBA").crop((0, 0, W * 8, H * 8)); ov = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
        for c in comps:
            col = (255, 0, 255, 110) if c["kind"] == "prop" else (255, 140, 0, 110)
            for (x, y) in c["cells"]: d.rectangle((x * 8, y * 8, x * 8 + 7, y * 8 + 7), fill=col)
        t = Image.alpha_composite(im, ov); t.thumbnail((400, 400)); tiles.append((mid, t))
        print(mid, "seed", len(seed), "ground colours", len(g), "objects", len(comps), "props", sum(c["kind"] == "prop" for c in comps))
    cols = 5; rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (410 * cols, 420 * rows), (30, 30, 30)); d = ImageDraw.Draw(sheet)
    for i, (mid, t) in enumerate(tiles): sheet.paste(t, ((i % cols) * 410, (i // cols) * 420 + 14)); d.text(((i % cols) * 410 + 2, (i // cols) * 420), f"map {mid}", fill=(255, 255, 255))
    sheet.save(out); print("wrote", out)
