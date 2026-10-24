"""Decompress the LZ entries of banks' $4000 tables and render them as 2bpp tile sheets.

An entry counts as LZ when it decompresses to >= 16 bytes and its compressed stream ends within
16 bytes before the next table entry (the test bank_map.py uses). Output: gfx/lz_BB_AAAA.png
(grey palette, 16 tiles per row) and a summary line per entry.
usage: extract_tiles.py BANK [BANK ...] [--raw BB:AAAA NTILES]
  --raw renders NTILES uncompressed 2bpp tiles from BB:AAAA instead (gfx/raw_BB_AAAA.png)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT, Labels
from scan_jumptables import table
from decompress import decompress
import gfx

OUT = os.path.join(ROOT, "gfx")


def lz_entries(rom, bank):
    ents = sorted(set(table(rom, bank)))
    for k, e in enumerate(ents):
        nxt = ents[k + 1] if k + 1 < len(ents) else 0x8000
        try:
            out, clen = decompress(rom, to_offset(bank, e), limit=0x4000)
        except Exception:
            continue
        if len(out) >= 16 and nxt - 16 <= e + clen <= nxt + 1:
            yield e, out, clen


def main():
    rom = load_rom()
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    if args and args[0] == "--raw":
        bank, addr = Labels().resolve(args[1])
        n = int(args[2], 0)
        o = to_offset(bank or 0, addr)
        path = os.path.join(OUT, "raw_%02x_%04x.png" % (bank or 0, addr))
        gfx.write_png(path, gfx.tilesheet(rom[o:o + n * 16], n), scale=2)
        print(path)
        return
    for b in (int(a, 16) for a in args):
        for e, out, clen in lz_entries(rom, b):
            n = len(out) // 16
            path = os.path.join(OUT, "lz_%02x_%04x.png" % (b, e))
            gfx.write_png(path, gfx.tilesheet(out, n), scale=2)
            print("%02x:%04x  %5d -> %5d bytes (%d tiles%s)  %s" % (
                b, e, clen, len(out), n, "" if len(out) % 16 == 0 else ", not a tile multiple",
                os.path.relpath(path, ROOT)))


if __name__ == "__main__":
    main()
