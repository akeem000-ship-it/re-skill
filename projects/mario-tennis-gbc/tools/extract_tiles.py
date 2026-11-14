"""Dump LZ assets from bank tables (see scan_assets.py) into gfx/.

  gfx/lz/BB_II.png      every block >=256 bytes rendered as a 2bpp tilesheet (grey)
  gfx/lz/BB_II_pal.png  64-byte blocks rendered as 8 CGB palettes (BGR555)
  gfx/lz/index.json     metadata for web/catalog.html

usage: extract_tiles.py [--bank BB]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, to_offset, ROOT
from scan_assets import scan_bank
from decompress import decompress
import gfx


def main():
    rom = load_rom()
    outdir = os.path.join(ROOT, "gfx", "lz")
    os.makedirs(outdir, exist_ok=True)
    banks = range(1, nbanks(rom))
    if "--bank" in sys.argv:
        banks = [int(sys.argv[sys.argv.index("--bank") + 1], 16)]
    index = []
    for b in banks:
        for (bank, idx, addr, clen, ulen, ok, gap) in scan_bank(rom, b):
            if not ok:
                continue
            data, _ = decompress(rom, to_offset(bank, addr))
            name = "%02x_%02x" % (bank, idx)
            ent = {"bank": bank, "idx": idx, "addr": "%04x" % addr, "clen": clen, "ulen": ulen, "file": None}
            if ulen == 64:
                pals = [gfx.palette_from_bytes(data, p * 8) for p in range(8)]
                img = [[pals[y // 8][x // 8] for x in range(32)] for y in range(64)]
                gfx.write_png(os.path.join(outdir, name + "_pal.png"), img, 2)
                ent["file"] = name + "_pal.png"; ent["kind"] = "palette"
                ent["colors"] = [["#%02x%02x%02x" % c for c in p] for p in pals]
            elif ulen >= 256 and ulen % 16 == 0:
                n = ulen // 16
                img = gfx.tilesheet(data, n, cols=16)
                gfx.write_png(os.path.join(outdir, name + ".png"), img, 2)
                ent["file"] = name + ".png"; ent["kind"] = "tiles"
            index.append(ent)
    with open(os.path.join(outdir, "index.json"), "w") as f:
        json.dump(index, f, indent=0)
    print("%d assets indexed, %d images" % (len(index), sum(1 for e in index if e["file"])))


if __name__ == "__main__":
    main()
