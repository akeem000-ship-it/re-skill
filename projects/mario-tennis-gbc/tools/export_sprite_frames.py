"""Export every character sprite frame as its own PNG, as reference art for HD redraws.

Per sprite set (render_sprites.py: char ids 0-45) and frame, two 1x PNGs:
  NN_name/fFFF.png      the frame in its default palette, transparent where the game draws nothing
  NN_name/fFFF_idx.png  the same frame as palette indices (0 clear, 1-3 shown as 85 / 170 / 255 grey): the regions the
                        game recolours (court side, the player's look), which an HD redraw must keep
plus manifest.json: per set its id, the roster names using it, and per frame its size, offset (dy, dx) and tile count.
Output goes to out/hd_refs/sprites/ (gitignored: it is ROM-derived; never commit it).

usage: export_sprite_frames.py [outdir]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import png
from gbrom import load_rom, ROOT
from render_sprites import NCHARS, header, frames, char_palette, sprite_names
import gfx


def frame_indices(rom, bank, ptr, info):
    """the frame as rows of palette indices (0 = clear), 8x16 OBJ tiles column-major (00:2C2B)"""
    from gbrom import to_offset
    n = info[3] or 12
    cols = (n + 3) // 4
    img = [[0] * (cols * 8) for _ in range(32)]
    base = to_offset(bank, ptr)
    for t in range(n):
        px = gfx.tile_pixels(rom, base + t * 16)
        c, r = t // 4, t % 4
        for y in range(8):
            for x in range(8):
                img[r * 8 + y][c * 8 + x] = px[y][x]
    return img


def write_rgba(path, rows):
    h, w = len(rows), len(rows[0]) // 4
    with open(path, "wb") as f:
        png.Writer(w, h, greyscale=False, alpha=True).write(f, rows)


def main():
    rom = load_rom()
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "hd_refs", "sprites")
    os.makedirs(out, exist_ok=True)
    names = sprite_names(rom)
    manifest = []
    for cid in range(NCHARS):
        try:
            bank, hdr = header(rom, cid)
            fl = frames(rom, bank, hdr)
        except Exception as e:
            print("char %02d: %s" % (cid, e)); continue
        if not fl:
            continue
        pal = char_palette(rom, hdr)
        who = names.get(cid, "npc")
        d = "%02d_%s" % (cid, who.replace("/", "+").replace(" ", "").replace(".", ""))
        os.makedirs(os.path.join(out, d), exist_ok=True)
        entry = {"id": cid, "names": who, "dir": d, "bank": "%02x" % bank, "frames": []}
        for i, (p, info) in enumerate(fl):
            idx = frame_indices(rom, bank, p, info)
            col, grey = [], []
            for row in idx:
                cr, gr = [], []
                for v in row:
                    if v:
                        cr.extend(pal[v] + (255,)); g = 85 * v; gr.extend((g, g, g, 255))
                    else:
                        cr.extend((0, 0, 0, 0)); gr.extend((0, 0, 0, 0))
                col.append(cr); grey.append(gr)
            write_rgba(os.path.join(out, d, "f%03d.png" % i), col)
            write_rgba(os.path.join(out, d, "f%03d_idx.png" % i), grey)
            entry["frames"].append({"f": i, "w": len(idx[0]), "h": 32, "dy": info[0] - 256 if info[0] > 127 else info[0],
                                    "dx": info[1] - 256 if info[1] > 127 else info[1], "tiles": info[3] or 12})
        manifest.append(entry)
        print("char %02d %-20s %d frames" % (cid, who, len(fl)))
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)


if __name__ == "__main__":
    main()
