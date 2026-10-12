"""Dump the sound index (SoundStart 00:3297) and per-song channel tables.

  music ids $01-$32 -> 2-byte entries at 00:3151 ; sfx ids $50-$AF -> entries at 00:31B5
  entry: byte0 low nibble = ROM bank ($70 | n), high nibble = channel count; byte1 = index
  channel table at bank:$4000 + index*4, one 4-byte row per channel:
     [slot ($00/$20.. offset into driver channel state at WRAM7:D100), flags, ptr lo, ptr hi]
usage: dump_sound_index.py [--seq ID]   (--seq: hex-dump the first 64 bytes of each channel)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

rom = load_rom()
NAMES = {0x01: "intro cutscene", 0x02: "title", 0x03: "main menu", 0x06: "point jingle?", 0x32: "exhibition match (via $44)",
         0x51: "racket hit", 0x57: "serve hit", 0x59: "racket swing", 0x5B: "ball bounce", 0x66: "point over", 0x6D: "net cord", 0x5E: "menu confirm", 0x5F: "menu cursor",
         0x60: "menu back/select", 0x65: "boot ping", 0x66: "point/let?"}


def entry(i):
    base = 0x3151 + (i - 1) * 2 if i < 0x50 else 0x31B5 + (i - 0x51) * 2   # 00:32C7: sub $50 ; dec a ; add a,a
    b0, b1 = rom[base], rom[base + 1]
    if b0 == 0xFF: return None
    return 0x70 | (b0 & 15), b0 >> 4, b1


def channels(bank, idx, n):
    rows = []
    for c in range(n):
        o = to_offset(bank, 0x4000 + idx * 4 + c * 4)
        rows.append((rom[o], rom[o + 1], rom[o + 2] | rom[o + 3] << 8))
    return rows


def main():
    seq = int(sys.argv[sys.argv.index("--seq") + 1], 16) if "--seq" in sys.argv else None
    ids = [seq] if seq else list(range(1, 0x33)) + list(range(0x51, 0xB0))
    for i in ids:
        e = entry(i)
        if not e: continue
        bank, n, idx = e
        rows = channels(bank, idx, n)
        print("id $%02x  bank %02x  %d ch  %-26s %s" % (i, bank, n, NAMES.get(i, ""),
              " ".join("[slot %02x f%02x @%04x]" % r for r in rows)))
        if seq:
            for slot, fl, ptr in rows:
                o = to_offset(bank, ptr)
                print("   ch slot %02x: %s" % (slot, " ".join("%02x" % x for x in rom[o:o + 64])))


if __name__ == "__main__":
    main()
