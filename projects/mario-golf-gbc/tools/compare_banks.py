"""Compare two ROM banks byte by byte.

Prints the identical and differing runs (at least MIN bytes long) so copies of the same code in
several banks (for example the sound driver in 7C/7D/7E) can be seen at once.
usage: compare_banks.py BANK1 BANK2 [--min N]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, BANK_SIZE


def main():
    rom = load_rom()
    a, b = int(sys.argv[1], 16), int(sys.argv[2], 16)
    mn = int(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 16
    x = rom[a * BANK_SIZE:(a + 1) * BANK_SIZE]
    y = rom[b * BANK_SIZE:(b + 1) * BANK_SIZE]
    same = sum(1 for i in range(BANK_SIZE) if x[i] == y[i])
    print("banks %02x/%02x: %d of %d bytes equal at the same address" % (a, b, same, BANK_SIZE))
    i = 0
    while i < BANK_SIZE:
        eq = x[i] == y[i]
        j = i
        while j < BANK_SIZE and (x[j] == y[j]) == eq:
            j += 1
        if j - i >= mn:
            print("  %04x-%04x  %5d bytes %s" % (0x4000 + i, 0x4000 + j - 1, j - i, "same" if eq else "differ"))
        i = j


if __name__ == "__main__":
    main()
