"""Dump the text banks 18-1F.

Layout (read from the loader 05:6179 and the bank exports 18:7D04/7D0C):
  text id (16 bit): bank = $18 + ((id >> 10) & 7), index = id & $3FF
  bank:TABLE + 2*index = word offset of the string, relative to bank:DATA
  TABLE and DATA are constants in each bank's loader (`ld hl, TABLE ; sla e ; rl d ; add hl, de ;
  ld e, [hl] ; inc hl ; ld d, [hl] ; ld hl, DATA`); bank 18 uses $4004/$4404, bank 19 $4004/$41B4.
  The table runs from TABLE to DATA. Strings are ASCII ending in $00; the loader copies $180 bytes to
  $C600 (export 0) or $20 bytes to $D880 (export 1).
Bytes outside $20-$7E are shown as {XX}.
usage: dump_text.py [bank] [--raw]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, BANK_SIZE

LOADER = bytes.fromhex("cb23cb12195e2356")   # sla e ; rl d ; add hl, de ; ld e,[hl] ; inc hl ; ld d,[hl]


def bases(rom, bank):
    """(TABLE, DATA) from the bank's loader code."""
    chunk = rom[bank * BANK_SIZE:(bank + 1) * BANK_SIZE]
    i = chunk.find(LOADER)
    if i < 3 or chunk[i - 3] != 0x21 or chunk[i + 8] != 0x21:
        raise ValueError("no text loader in bank %02x" % bank)
    return chunk[i - 2] | chunk[i - 1] << 8, chunk[i + 9] | chunk[i + 10] << 8


def strings(rom, bank):
    """[(index, bytes)] for one text bank; each string includes its $00 terminator."""
    table, data = bases(rom, bank)
    base = bank * BANK_SIZE - 0x4000
    out = []
    for i in range((data - table) // 2):
        o = base + table + 2 * i
        s = base + data + (rom[o] | rom[o + 1] << 8)
        e = s
        while rom[e] != 0:
            e += 1
        out.append((i, rom[s:e + 1]))
    return out


def render(data):
    return "".join(chr(c) if 0x20 <= c < 0x7F else "{%02X}" % c for c in data)


def main():
    rom = load_rom()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    banks = [int(args[0], 16)] if args else range(0x18, 0x20)
    for b in banks:
        for idx, data in strings(rom, b):
            tid = ((b - 0x18) << 10) | idx
            print("%04X %02x:%03x  %s" % (tid, b, idx, render(data)))


if __name__ == "__main__":
    main()
