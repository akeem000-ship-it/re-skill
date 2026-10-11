"""Dump the per-character record table 02:52CE (29 bytes x 32, roster order).

Verified in PyBoy: a match copies the record to the player struct at wCA0E (P1) /
wCA8E (P2); roster id at wCA0B/wCA8B; name at wCA00/wCA80.
Bytes +18..+28 = 11 stats (0-9). Label order taken from the stat-label tile sheet
(LZ 3D:5A): Serve Stroke Volley Spin Angle Topspin Speed Reaction Stop Control Dash
-- order NOT yet verified against the in-game "Review Char. Data" screen.
usage: dump_char_stats.py [--md]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
from render_sprites import ROSTER

BASE = (0x02, 0x52CE); SIZE = 29
STATS = ["Serve", "Stroke", "Volley", "Spin", "Angle", "Topspin", "Speed", "Reaction", "Stop", "Control", "Dash"]
TYPES = ["Power", "Technique", "All-Around", "Tricky", "Speed", "???"]

rom = load_rom()
types = rom[to_offset(0x38, 0x58FB):to_offset(0x38, 0x58FB) + 32]
md = "--md" in sys.argv
if md:
    print("| # | Name | Type | " + " | ".join(STATS) + " | header bytes +0..+17 |")
    print("|---|---|---|" + "---|" * len(STATS) + "---|")
for c in range(32):
    o = to_offset(*BASE) + c * SIZE
    rec = rom[o:o + SIZE]
    st = rec[18:29]
    if md:
        print("| %d | %s | %s | %s | `%s` |" % (c, ROSTER[c], TYPES[types[c]], " | ".join(str(x) for x in st), rec[:18].hex(" ")))
    else:
        print("%2d %-11s %-10s %s  | %s" % (c, ROSTER[c], TYPES[types[c]], " ".join("%d" % x for x in st), rec[:18].hex(" ")))
