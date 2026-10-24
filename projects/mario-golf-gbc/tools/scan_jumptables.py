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


_SITES = None


def farcall_sites(rom):
    """{(bank, idx): number of `rst $18 / rst $10 ; db idx, bank` byte patterns} over the whole ROM."""
    global _SITES
    if _SITES is None:
        _SITES = {}
        nb = nbanks(rom)
        for i in range(len(rom) - 2):
            if rom[i] in (0xDF, 0xD7) and not rom[i + 1] & 1 and 1 <= rom[i + 2] < nb:
                k = (rom[i + 2], rom[i + 1])
                _SITES[k] = _SITES.get(k, 0) + 1
    return _SITES


def kind(rom, bank, ents):
    """'exports' for a real export table; 'header' for 1-2 words pointing far from $4000 that no far call
    uses (data banks 18-1F and 46 start with two pointers, which the table scan reads as a 2-entry table).
    Short tables that far calls do use (0D, 3D: 1 entry; 44: 2) are exports."""
    if not ents:
        return "none"
    if len(ents) <= 2 and min(ents) > 0x4000 + 0x100:
        sites = farcall_sites(rom)
        if sum(sites.get((bank, i * 2), 0) for i in range(len(ents))) < 2:
            return "header"
    return "exports"


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
        print("bank %02x: %3d entries  first=%s  ff=%2d%% 00=%2d%%  %s" % (
            b, len(t), ("%04x" % t[0]) if t else "----", ff, z, kind(rom, b, t)))


if __name__ == "__main__":
    main()
