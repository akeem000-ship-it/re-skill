"""Enumerate per-bank jump tables at $4000 (targets of rst $10/$18 farcalls).

usage: scan_jumptables.py [bank]     (no arg: summary of all banks)
A bank has a table if the words at $4000.. point into $4000-$7FFF and the
first target lies just after the table.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE


def table(rom, bank):
    base = bank * BANK_SIZE
    ents = []
    lo = 0x8000
    i = 0
    while 0x4000 + i * 2 < lo:
        w = rom[base + i * 2] | rom[base + i * 2 + 1] << 8
        if not (0x4000 <= w < 0x8000):
            break
        ents.append(w)
        lo = min(lo, w)
        i += 1
    if not ents or lo != 0x4000 + len(ents) * 2:
        # allow tables whose first target is not immediately after
        if not ents or lo < 0x4000 + len(ents) * 2:
            return ents[: max(0, (lo - 0x4000) // 2)] if ents else []
    return ents


def main():
    rom = load_rom()
    if len(sys.argv) > 1:
        b = int(sys.argv[1], 16)
        for i, w in enumerate(table(rom, b)):
            print("%02x  idx $%02x -> %02x:%04x" % (b, i * 2, b, w))
        return
    for b in range(1, nbanks(rom)):
        t = table(rom, b)
        chunk = rom[b * BANK_SIZE:(b + 1) * BANK_SIZE]
        ff = chunk.count(0xFF) * 100 // BANK_SIZE
        z = chunk.count(0) * 100 // BANK_SIZE
        print("bank %02x: %3d entries  first=%s  ff=%2d%% 00=%2d%%" % (
            b, len(t), ("%04x" % t[0]) if t else "----", ff, z))


if __name__ == "__main__":
    main()
