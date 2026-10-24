"""Dump the shot tables in bank 07 (read by 07:52A0 SetShotSpinSpeed).

Record (8 B): topspin s16 -> wC41C, sidespin s16 -> wC41E (negated when wC4A7 != 0, i.e.
mirrored), speed u16 (8.8 px/frame), unused.  Spin comes from row D, speed from row E
(E is a 0-9 level, the player's stat; D is a shot variant).
usage: dump_shot_tables.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

TABLES = [(0x4F11, 10, "stroke flat"), (0x4F61, 10, "stroke topspin"), (0x4FB1, 10, "stroke slice"),
          (0x5001, 10, "flat, slower (lob/drop?)"), (0x5051, 2, "spin-only A (D=wDF92)"),
          (0x5061, 2, "spin-only B (D=wDF93)"), (0x5071, 10, "serve topspin (D=wDF6E, E=wDF6C)"),
          (0x50C1, 10, "serve slice (D=wDF6F, E=wDF6C)"), (0x5111, 10, "serve flat (E=wDF6C)")]
rom = load_rom()
def s16(o):
    v = rom[o] | rom[o + 1] << 8; return v - 65536 if v >= 32768 else v
for a, n, name in TABLES:
    print("== 07:%04X  %s" % (a, name))
    for i in range(n):
        o = to_offset(7, a + i * 8)
        print("  [%d] top %6d  side %6d  speed %6.2f px/frame" % (i, s16(o), s16(o + 2), (rom[o + 4] | rom[o + 5] << 8) / 256))
