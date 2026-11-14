"""Byte statistics of the text banks 18-1F (offset table at $4004, strings from $4404).

Prints the number of strings per bank and how often each non-printable byte occurs, with one example
context per byte, to identify control codes.
usage: text_stats.py
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, BANK_SIZE
from dump_text import strings


def main():
    rom = load_rom()
    cnt = collections.Counter(); ex = {}
    for b in range(0x18, 0x20):
        ss = strings(rom, b)
        print("bank %02x: %d strings" % (b, len(ss)))
        for idx, data in ss:
            for i, c in enumerate(data):
                if not 0x20 <= c < 0x7F:
                    cnt[c] += 1
                    ex.setdefault(c, (b, idx, data[max(0, i - 12):i + 12]))
    for c, n in sorted(cnt.items()):
        b, idx, ctx = ex[c]
        print("$%02x %6d  e.g. %02x/%03x %r" % (c, n, b, idx, bytes(ctx)))


if __name__ == "__main__":
    main()
