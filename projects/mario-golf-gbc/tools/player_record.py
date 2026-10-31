"""The player record SetupPlayerGolfer 02:4A28 makes for a preset golfer (02:4B1D[b & $F]: its first $20 bytes,
+$28 = 6, the name from text $43 + its golfer id at +0), as --poke arguments for tools/emu_round_inputs.py.
usage: player_record.py GOLFER PLAYER      (GOLFER: preset 0-15, e.g. 9 Luigi; PLAYER: 0 ($C880) or 1 ($C8C0))
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset


def rb(rom, bank, addr):
    return rom[to_offset(bank, addr)]


def rw(rom, bank, addr):
    return rb(rom, bank, addr) | rb(rom, bank, addr + 1) << 8


def text_short(rom, tid):
    """05:40C2 CopyTextShortToDE: the string (with its 0) from text bank $18 + ((id >> 10) & 7)"""
    bank, index = 0x18 + ((tid >> 10) & 7), tid & 0x3FF
    copy = rw(rom, bank, 0x4002) + 8
    offsets, strings = rw(rom, bank, copy + 4), rw(rom, bank, copy + 0x0F)
    src = (strings + rw(rom, bank, offsets + 2 * index)) & 0xFFFF
    out = []
    for k in range(0x20):
        v = rb(rom, bank, src + k)
        out.append(v)
        if not v:
            break
    return out


def main():
    golfer, player = int(sys.argv[1], 0), int(sys.argv[2], 0)
    rom = load_rom()
    rec = [0] * 0x40
    src = rw(rom, 0x02, 0x4B1D + 2 * (golfer & 0x0F))
    for k in range(0x20):
        rec[k] = rb(rom, 0x02, src + k)
    rec[0x28] = 6
    for k, v in enumerate(text_short(rom, 0x43 + rec[0x10])):
        rec[k] = v
    base = 0xC8C0 if player else 0xC880
    print(" ".join("%04X=%02X" % (base + k, v) for k, v in enumerate(rec)))


if __name__ == "__main__":
    main()
