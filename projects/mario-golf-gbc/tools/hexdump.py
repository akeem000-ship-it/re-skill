"""Hex dump of ROM bytes.

usage: hexdump.py BB:AAAA [nbytes]      (or a label name)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels


def main():
    rom = load_rom()
    bank, addr = Labels().resolve(sys.argv[1])
    bank = bank or 0
    n = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0x80
    o = to_offset(bank, addr)
    for i in range(0, n, 16):
        row = rom[o + i:o + min(i + 16, n)]
        asc = "".join(chr(c) if 32 <= c < 127 else "." for c in row)
        print("%02x:%04x  %-48s %s" % (bank, addr + i, " ".join("%02x" % c for c in row), asc))


if __name__ == "__main__":
    main()
