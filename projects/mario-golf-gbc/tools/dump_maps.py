"""Dump the overworld map table (0A:5188) and each map's header.

Read from the map loader 0A:4BBC (MapLoadHeader) and 0A:4C0D (MapPlaceAtEntrance):
  map record, 6 bytes, list ends with id $FF (an unknown id falls back to the first record):
    +0 map id (wMapId $C450)   +1 a byte passed to 0B:46DF (wMapGfx $C451)
    +2 idx, +3 bank: the header is the word at bank:$4000+idx (ReadFarVectorEntry)
    +4 music id ($C454, played by 00:2C19)   +5 ($C455)
  map header, 14 bytes copied to $C456, all pointers in the header's bank (wMapBank $C464):
    +0 entrances: 6-byte records [entry id, facing?, x lo, x hi, y lo, y hi], list ends with $FF
    +2 warps: 8-byte records; bytes 6/7 = destination map id / entry id (0A:5146)
    +4 passed to 0A:4F45 at map start     +6 talk targets (0A:49C6)   +8 objects (0A:49E9)
    +10, +12 not yet known
usage: dump_maps.py [--entrances] [--warps]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

TABLE = (0x0A, 0x5188)


def word(rom, bank, addr):
    o = to_offset(bank, addr)
    return rom[o] | rom[o + 1] << 8


def records(rom):
    o = to_offset(*TABLE)
    out = []
    while rom[o] != 0xFF:
        out.append(tuple(rom[o:o + 6]))
        o += 6
    return out


def main():
    rom = load_rom()
    for mid, gfx, idx, bank, music, x in records(rom):
        hdr = word(rom, bank, 0x4000 + idx)
        f = [word(rom, bank, hdr + 2 * i) for i in range(7)]
        print("map %02x  gfx %02x  music %02x  [%02x]  header %02x:%04x  ents %04x warps %04x +4 %04x talk %04x obj %04x +10 %04x +12 %04x" % (
            mid, gfx, music, x, bank, hdr, *f))
        if "--entrances" in sys.argv:
            o = to_offset(bank, f[0])
            while rom[o] != 0xFF:
                e = rom[o:o + 6]
                print("      entry %02x  b1 %02x  x %d  y %d" % (e[0], e[1], e[2] | e[3] << 8, e[4] | e[5] << 8))
                o += 6
        if "--warps" in sys.argv:                # MapListFindIfFlag 0A:4EC5 records: [id, facing mask, flag word, ?, ?, map, entry]
            o = to_offset(bank, f[1])
            while rom[o] != 0xFF:
                e = rom[o:o + 8]
                print("      warp %02x  facing %02x  flag %04x  [%02x %02x]  -> map %02x entry %02x" % (
                    e[0], e[1], e[2] | e[3] << 8, e[4], e[5], e[6], e[7]))
                o += 8


if __name__ == "__main__":
    main()
