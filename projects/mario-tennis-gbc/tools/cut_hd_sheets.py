"""Cut a hero's redrawn (HD) sprite sheets into an HD sprite pack the game draws in place of the hero's own frames.

The sheets are the shot lists (out/alex_hd_pack/shot_lists, made from the game's frames) redrawn on flat magenta, at k times the shot
list's size (k = 2 for Gemini's). Each drawing sits where the game frame sat in the shot list, so a sheet pixel maps straight to a
frame pixel: match cells hold the frame at 4x, the frame's bottom 30 px above the cell's bottom, centred; walk cells hold the 16x16
facing at 5x, 20 px in from the cell's top-left. The pack keys each picture by the ROM offset of the frame it replaces (a match frame's
tile data, a walk facing's 64 bytes: the keys web/js/look/build.js gives the hero's frames), so the game picks it by what it shows.

  <out>/pack.json   { id, hero, frames: { "<rom offset>": { x, y, w, h, ox, oy, s } } }: the picture's rectangle in the atlas,
                    its top-left in frame pixels (ox, oy) and its pixels per frame pixel (s)
  <out>/atlas.png   the pictures, magenta keyed out (alpha), edge spill removed
  <out>/mask.png    the same rectangles: 255 where a pixel is the team colour (the red cap, collar, shoes, racket), else 0
  out/hd_check_<hero>.png  each picture beside the game frame it replaces, outlines over each other (not loaded by the game)
Output is private (the art is of the game's character): it goes to web/hdpacks/<id>/ (gitignored) unless a directory is given.

usage: cut_hd_sheets.py <sheets dir> <cells.json> [--hero alex] [--out dir] [--scale 2]
"""
import sys, os, json, argparse, colorsys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from gbrom import load_rom, to_offset, ROOT
import gfx

HEROES = {"alex": {"match": 0x40, "char": 0, "walk_name": "Alex"}, "nina": {"match": 0x41, "char": 1, "walk_name": "Nina"}}
CHAR_OBJECT_TABLE, OBJECT_LIST = (0x04, 0x4C29), (0x04, 0x4F75)
SHEETS = ["1_run_ready", "2_forehand_backhand", "3_serve_overhead", "4_special_reactions"]
WALK = "5_campus_walk"
WCW, WCH, WLW, WTOP = 120, 120, 200, 56                     # the walk shot list's cells (out/alex_hd_pack/HANDOFF_FOR_GEMINI.md)


def u16(rom, bank, addr):
    o = to_offset(bank, addr)
    return rom[o] | rom[o + 1] << 8


def match_frame(rom, bank, slot):
    """(rom offset, 2bpp index image cols*8 x 32) of match slot 0-144"""
    a = u16(rom, bank, 0x400E + 2 * slot)
    cols = 4 if rom[to_offset(bank, 0x7CE0 + 4 * slot + 2)] else 3
    base = to_offset(bank, a)
    img = [[0] * (cols * 8) for _ in range(32)]
    for t in range(cols * 4):
        px = gfx.tile_pixels(rom, base + t * 16)
        c, r = t // 4, t % 4
        for y in range(8):
            for x in range(8):
                img[r * 8 + y][c * 8 + x] = px[y][x]
    return base, img


def walk_blocks(rom, char):
    """the walk object's distinct 256-byte blocks in frame order (as export_walk_frames.py lists them): [rom offset]"""
    obj = rom[to_offset(*CHAR_OBJECT_TABLE) + char]
    w = u16(rom, OBJECT_LIST[0], OBJECT_LIST[1] + 2 * obj)
    bank, idx = w >> 8, w & 0xFF
    hdr = u16(rom, bank, 0x4000 + idx)
    flist = u16(rom, bank, hdr + 4)
    out = []
    for i in range(16):
        p = u16(rom, bank, flist + 2 * i)
        if p < 0x4000 or p >= 0x8000:
            break
        o = to_offset(bank, p)
        if o not in out:
            out.append(o)
    return out


def walk_facing(rom, off):
    img = [[0] * 16 for _ in range(16)]
    for t in range(4):
        px = gfx.tile_pixels(rom, off + t * 16)
        c, r = t // 2, t % 2
        for y in range(8):
            for x in range(8):
                img[r * 8 + y][c * 8 + x] = px[y][x]
    return img


def is_key(r, g, b):
    """the magenta background (with the tolerance a generated image needs)"""
    return r > 150 and b > 150 and g < 110 and abs(r - b) < 90


def key_out(cell):
    """RGBA: magenta keyed out; pixels next to the background lose their magenta tint (despill)"""
    cell = cell.convert("RGB"); W, H = cell.size; src = cell.load()
    out = Image.new("RGBA", (W, H)); dst = out.load()
    keyed = [[is_key(*src[x, y]) for x in range(W)] for y in range(H)]
    for y in range(H):
        for x in range(W):
            if keyed[y][x]:
                dst[x, y] = (0, 0, 0, 0); continue
            r, g, b = src[x, y]
            edge = any(0 <= x + dx < W and 0 <= y + dy < H and keyed[y + dy][x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            if edge:
                m = min(r, b) - g                              # magenta excess: pull red and blue down to the green level
                if m > 24:
                    r, b = r - m * 0.75, b - m * 0.75
            dst[x, y] = (int(r), int(g), int(b), 255)
    # drop specks: opaque pixels with fewer than 3 opaque neighbours
    for y in range(H):
        for x in range(W):
            if dst[x, y][3] and sum(1 for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and 0 <= x + dx < W and 0 <= y + dy < H and dst[x + dx, y + dy][3]) < 3:
                dst[x, y] = (0, 0, 0, 0)
    return out


def team_mask(img):
    """the red parts (cap, collar, shoes, racket frame): saturated red hues"""
    W, H = img.size; p = img.load(); m = Image.new("L", (W, H)); q = m.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = p[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if (h < 0.035 or h > 0.95) and s > 0.45 and v > 0.25:
                q[x, y] = 255
    return m


def crop_cell(sheet, x0, y0, w, h, k):
    return sheet.crop((x0 * k, y0 * k, (x0 + w) * k, (y0 + h) * k))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheets"); ap.add_argument("cells")
    ap.add_argument("--hero", default="alex"); ap.add_argument("--out"); ap.add_argument("--scale", type=int, default=2)
    a = ap.parse_args()
    H = HEROES[a.hero]; k = a.scale
    out = a.out or os.path.join(ROOT, "web", "hdpacks", a.hero)
    os.makedirs(out, exist_ok=True)
    rom = load_rom()
    cfg = json.load(open(a.cells))
    C = cfg["cell"]; CW, CH, LW, TOP = C["w"], C["h"], C["left"], C["top"]
    pics = []                                               # (key, rgba, ox, oy, s, game image, label)
    for sh in cfg["sheets"]:
        tag = sh["file"].replace("alex_shotlist_", "").replace(".png", "")
        path = os.path.join(a.sheets, f"{a.hero}_hd_{tag}.png")
        if not os.path.exists(path):
            print("missing", path); continue
        sheet = Image.open(path)
        for c in sh["cells"]:
            if not c["draw"]:
                continue
            f, row, col = c["frame"], c["row"], c["col"]
            key, game = match_frame(rom, H["match"], f)
            fw, fh = len(game[0]), 32
            x0, y0 = LW + col * CW, TOP + row * CH
            sx, sy = x0 + (CW - fw * 4) // 2, y0 + CH - 30 - fh * 4             # the frame's top-left in the shot list
            rgba = key_out(crop_cell(sheet, x0 + 3, y0 + 3, CW - 6, CH - 6, k))   # inside the cell's border
            bb = rgba.getbbox()
            if not bb:
                print(f"f{f:03d}: empty"); continue
            pic = rgba.crop(bb); s = 4 * k
            ox, oy = ((x0 + 3) * k + bb[0] - sx * k) / s, ((y0 + 3) * k + bb[1] - sy * k) / s
            pics.append((key, pic, ox, oy, s, game, f"f{f:03d}"))
    wpath = os.path.join(a.sheets, f"{a.hero}_hd_{WALK}.png")
    if os.path.exists(wpath):
        sheet = Image.open(wpath)
        for r, base in enumerate(walk_blocks(rom, H["char"])):
            for fc in range(4):
                x0, y0 = WLW + fc * WCW, WTOP + r * WCH
                rgba = key_out(crop_cell(sheet, x0 + 3, y0 + 3, WCW - 6, WCH - 6, k)); bb = rgba.getbbox()
                if not bb:
                    print(f"walk {r}:{fc}: empty"); continue
                pic = rgba.crop(bb); s = 5 * k
                ox, oy = ((x0 + 3) * k + bb[0] - (x0 + 20) * k) / s, ((y0 + 3) * k + bb[1] - (y0 + 20) * k) / s
                pics.append((base + fc * 64, pic, ox, oy, s, walk_facing(rom, base + fc * 64), f"w{r:02d}.{fc}"))
    # atlas: shelf packing in rows of 2048
    AW, x, y, rowh, place = 2048, 0, 0, 0, []
    for p in pics:
        w, h = p[1].size
        if x + w > AW:
            x, y, rowh = 0, y + rowh + 2, 0
        place.append((x, y)); x += w + 2; rowh = max(rowh, h)
    AH = y + rowh
    atlas, mask = Image.new("RGBA", (AW, AH)), Image.new("L", (AW, AH))
    frames = {}
    for (key, pic, ox, oy, s, game, label), (px, py) in zip(pics, place):
        atlas.paste(pic, (px, py)); mask.paste(team_mask(pic), (px, py))
        frames[str(key)] = {"x": px, "y": py, "w": pic.width, "h": pic.height, "ox": round(ox, 3), "oy": round(oy, 3), "s": s, "n": label}
    atlas.save(os.path.join(out, "atlas.png")); mask.save(os.path.join(out, "mask.png"))
    json.dump({"id": a.hero + "-hd", "hero": a.hero, "frames": frames}, open(os.path.join(out, "pack.json"), "w"), indent=0)
    # the check sheet: game frame (grey, 8 px per pixel) under the picture, the game frame's outline in cyan
    tiles = []
    for key, pic, ox, oy, s, game, label in pics:
        gw, gh = len(game[0]), len(game)
        sc = s; X0, Y0 = min(0, ox), min(0, oy); X1, Y1 = max(gw, ox + pic.width / sc), max(gh, oy + pic.height / sc)
        T = Image.new("RGBA", (int((X1 - X0) * sc) + 2, int((Y1 - Y0) * sc) + 20), (40, 44, 56, 255)); d = ImageDraw.Draw(T)
        g = Image.new("RGBA", (gw, gh))
        for yy in range(gh):
            for xx in range(gw):
                v = game[yy][xx]
                if v:
                    g.putpixel((xx, yy), (120 + 40 * v, 120 + 40 * v, 120 + 40 * v, 255))
        T.alpha_composite(g.resize((gw * sc, gh * sc), Image.NEAREST), (int(-X0 * sc), int(-Y0 * sc)))
        over = pic.copy(); over.putalpha(over.getchannel("A").point(lambda v: v * 0.7))
        T.alpha_composite(over, (int((ox - X0) * sc), int((oy - Y0) * sc)))
        for yy in range(gh):
            for xx in range(gw):
                if game[yy][xx] and any(not (0 <= xx + dx < gw and 0 <= yy + dy < gh) or not game[yy + dy][xx + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    X, Y = int((xx - X0) * sc), int((yy - Y0) * sc); d.rectangle((X, Y, X + sc - 1, Y + sc - 1), outline=(0, 255, 255, 255))
        d.text((4, T.height - 16), label, fill=(255, 255, 255, 255))
        tiles.append(T)
    cw = 8; cols = [tiles[i::cw] for i in range(cw)]
    widths = [max((t.width for t in c), default=0) for c in cols]
    rows = [tiles[i:i + cw] for i in range(0, len(tiles), cw)]
    heights = [max(t.height for t in r) for r in rows]
    S = Image.new("RGBA", (sum(widths) + 4 * cw, sum(heights) + 4 * len(rows)), (20, 22, 28, 255))
    yy = 0
    for r, hgt in zip(rows, heights):
        xx = 0
        for i, t in enumerate(r):
            S.paste(t, (xx, yy)); xx += widths[i] + 4
        yy += hgt + 4
    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True); S.save(os.path.join(ROOT, "out", f"hd_check_{a.hero}.png"))
    # the packs' index the page loads (web/js/look/hdpack.js): every directory beside this one that holds a pack.json
    root = os.path.dirname(os.path.abspath(out))
    json.dump(sorted(d for d in os.listdir(root) if os.path.exists(os.path.join(root, d, "pack.json"))), open(os.path.join(root, "index.json"), "w"))
    print(f"{len(pics)} pictures, atlas {AW}x{AH} -> {out}")


if __name__ == "__main__":
    main()
