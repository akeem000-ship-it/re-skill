"""List the music table of the sound driver (banks 7C/7D/7E; read from 7E:4186 SongStart).

  count = 7E:52A4; bank of song n = 7E:52A5 + n  (the driver switches the ROM bank to it; the
  driver code at $4000-$52D8 is identical in 7C, 7D and 7E, so it keeps running)
  header of song n = word at bank:$52D7 + 2n; first byte = channel mask (bit 0 = channel 1 ...),
  then a 2-byte pointer per enabled channel (only the first is confirmed from the code so far)
usage: dump_songs.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset


def main():
    rom = load_rom()
    n = rom[to_offset(0x7E, 0x52A4)]
    print("%d songs" % n)
    for i in range(n):
        bank = rom[to_offset(0x7E, 0x52A5 + i)]
        o = to_offset(bank, 0x52D7 + 2 * i)
        hdr = rom[o] | rom[o + 1] << 8
        h = to_offset(bank, hdr)
        mask = rom[h]
        ptrs = [rom[h + 1 + 2 * k] | rom[h + 2 + 2 * k] << 8 for k in range(bin(mask & 0x0F).count("1"))]
        print("song %02x  bank %02x  header %04x  mask %02x  channels %s" % (
            i, bank, hdr, mask, " ".join("%04x" % p for p in ptrs)))


if __name__ == "__main__":
    main()
