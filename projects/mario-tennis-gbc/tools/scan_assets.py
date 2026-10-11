"""Inventory compressed blocks referenced from per-bank $4000 tables.

For each bank table entry, try to LZ-decompress; an entry is 'LZ' when the
stream terminates cleanly, output <= 16KB, and the compressed end lands at or
just before the next entry's start (sorted).  Output: CSV to stdout.

usage: scan_assets.py [--bank BB] [--csv]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE, to_offset
from scan_jumptables import table
from decompress import decompress


def classify(size):
    if size % 16 == 0 and size >= 256:
        return "tiles?(%d)" % (size // 16)
    if size in (360, 576, 1024, 640, 720):
        return "tilemap?"
    return ""


def scan_bank(rom, b):
    ents = table(rom, b)
    starts = sorted(set(ents)) + [0x8000]
    out = []
    for i, w in enumerate(ents):
        nxt = next(s for s in starts if s > w)
        try:
            data, clen = decompress(rom, to_offset(b, w), limit=0x4000)
            gap = nxt - (w + clen)
            ok = 0 <= gap <= 2 and (w + clen) <= 0x8000
            out.append((b, i * 2, w, clen, len(data), ok, gap))
        except Exception:
            out.append((b, i * 2, w, None, None, False, None))
    return out


def main():
    rom = load_rom()
    banks = range(1, nbanks(rom))
    if "--bank" in sys.argv:
        banks = [int(sys.argv[sys.argv.index("--bank") + 1], 16)]
    print("bank,idx,addr,clen,ulen,lz_ok,kind")
    summary = {}
    for b in banks:
        rows = scan_bank(rom, b)
        okc = sum(1 for r in rows if r[5])
        summary[b] = (okc, len(rows))
        for r in rows:
            if r[5] or len(banks) == 1:
                print("%02x,%02x,%04x,%s,%s,%s,%s" % (r[0], r[1], r[2], r[3], r[4], int(r[5]), classify(r[4]) if r[4] else ""))
    if "--csv" not in sys.argv:
        sys.stderr.write("banks with LZ tables: " + " ".join(
            "%02x(%d/%d)" % (b, o, n) for b, (o, n) in summary.items() if o) + "\n")


if __name__ == "__main__":
    main()
