"""Count plausible inline far calls: `rst $10` (D7) and `rst $18` (DF) followed by `db idx, bank`.

A hit needs idx even and inside the target bank's $4000 word table (scan_jumptables.table),
and the target entry to point at something other than $FF fill. Random data also matches
sometimes, so the same test is run on E7 (`rst $20`, whose inline argument is a flag word,
not idx/bank) as a baseline for chance hits.

usage: farcall_stats.py [--bank BB] [--list]
  --list prints each hit as SRC_BANK:ADDR -> BB:AAAA (idx)
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE, from_offset
from scan_jumptables import table

OPS = {0xD7: "rst $10", 0xDF: "rst $18", 0xE7: "rst $20 (baseline)"}


def hits(rom, tables, op, only=None):
    NB = nbanks(rom)
    for b in range(NB):
        if only is not None and b != only:
            continue
        base = b * BANK_SIZE
        for i in range(base, base + BANK_SIZE - 2):
            if rom[i] != op:
                continue
            idx, tb = rom[i + 1], rom[i + 2]
            if not (1 <= tb < NB) or idx & 1 or idx // 2 >= len(tables[tb]):
                continue
            tgt = tables[tb][idx // 2]
            if rom[tb * BANK_SIZE + tgt - 0x4000] == 0xFF:
                continue
            yield b, from_offset(i)[1], tb, tgt, idx


def main():
    rom = load_rom()
    tables = {b: table(rom, b) for b in range(1, nbanks(rom))}
    only = None
    if "--bank" in sys.argv:
        only = int(sys.argv[sys.argv.index("--bank") + 1], 16)
    for op, name in OPS.items():
        hs = list(hits(rom, tables, op, only))
        by_src = collections.Counter(h[0] for h in hs)
        by_dst = collections.Counter(h[2] for h in hs)
        print("%-20s %5d hits; top sources %s; top targets %s" % (
            name, len(hs), " ".join("%02x:%d" % kv for kv in by_src.most_common(6)),
            " ".join("%02x:%d" % kv for kv in by_dst.most_common(6))))
        if "--list" in sys.argv and op != 0xE7:
            for b, a, tb, tgt, idx in hs:
                print("  %02x:%04x  %s -> %02x:%04x (idx $%02x)" % (b, a, name, tb, tgt, idx))


if __name__ == "__main__":
    main()
