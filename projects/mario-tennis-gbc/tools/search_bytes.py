"""Byte-pattern search. '??' = wildcard.

usage: search_bytes.py "cd 97 17" [--bank BB] [--context N] [--disasm [N]] [--max N]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, from_offset, Labels


def parse(pat):
    pat = pat.replace(" ", "")
    return [None if pat[i:i + 2] == "??" else int(pat[i:i + 2], 16) for i in range(0, len(pat), 2)]


def find(rom, pat, bank=None):
    first = next((i for i, v in enumerate(pat) if v is not None), 0)
    lo, hi = 0, len(rom)
    if bank is not None:
        lo = 0 if bank == 0 else bank * 0x4000
        hi = lo + 0x4000
    i = lo
    while True:
        i = rom.find(bytes([pat[first]]), i + (0 if i == lo else 0), hi) if pat[first] is not None else i
        if i < 0 or i >= hi:
            return
        s = i - first
        if s >= lo and s + len(pat) <= hi and all(v is None or rom[s + k] == v for k, v in enumerate(pat)):
            yield s
        i += 1


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__); return
    pat = parse(argv[0])
    bank = ctx = None; dis = 0; mx = 200
    i = 1
    while i < len(argv):
        if argv[i] == "--bank": bank = int(argv[i + 1], 16); i += 2
        elif argv[i] == "--context": ctx = int(argv[i + 1]); i += 2
        elif argv[i] == "--max": mx = int(argv[i + 1]); i += 2
        elif argv[i] == "--disasm":
            dis = 8
            if i + 1 < len(argv) and argv[i + 1].isdigit(): dis = int(argv[i + 1]); i += 1
            i += 1
        else: i += 1
    rom = load_rom(); labels = Labels()
    n = 0
    for off in find(rom, pat, bank):
        b, a = from_offset(off)
        line = "%02x:%04x (0x%06x)" % (b, a, off)
        if ctx:
            line += "  " + " ".join("%02x" % x for x in rom[max(0, off - ctx):off + len(pat) + ctx])
        print(line)
        if dis:
            from disasm import disasm
            disasm(rom, b, a, dis * 2, labels)
        n += 1
        if n >= mx:
            print("... (max reached)"); break
    print("%d hits" % n)


if __name__ == "__main__":
    main()
