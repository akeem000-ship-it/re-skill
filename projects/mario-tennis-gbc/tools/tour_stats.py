"""Mario Tour stat growth (RebuildStats 02:44E9).

Per play style (record +$0B & 3) a 113-byte template at 02:47FA + $71*style (pointer table 02:47F2).
Each of the 11 stats has a 9-byte row of signed thresholds at template + off; stat = number of
leading thresholds < B, where B = clamp(5*T - (level - 1), -127, 127), level = record +$18 and T =
one of four training bytes: +$38 (Top, Slice), +$39 (Serve, Stroke, Volley), +$3A (Angle, Placement),
+$3B (Speed, Dash, Reaction, Stop).
usage: tour_stats.py [STYLE T38 T39 T3A T3B LEVEL]   (no args: dump the four templates)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

rom = load_rom()
STATS = ["Top", "Slice", "Serve", "Stroke", "Volley", "Angle", "Placement", "Speed", "Dash", "Reaction", "Stop"]
MAP = [(0, 0x0D), (0, 0x16), (1, 0x1F), (1, 0x28), (1, 0x31), (2, 0x3A), (2, 0x43), (3, 0x4C), (3, 0x55), (3, 0x5E), (3, 0x67)]
s8 = lambda v: v - 256 if v >= 128 else v


def template(style):
    p = rom[to_offset(2, 0x47F2 + 2 * style)] | rom[to_offset(2, 0x47F3 + 2 * style)] << 8
    return p, rom[to_offset(2, p):to_offset(2, p) + 0x71]


def stats(style, T, level):
    _, t = template(style); out = []
    for k, (ti, off) in enumerate(MAP):
        B = max(-127, min(127, 5 * T[ti] - (level - 1)))
        n = 0
        for th in t[off:off + 9]:
            if B - s8(th) <= 0: break
            n += 1
        out.append(n)
    return out


if len(sys.argv) > 6:
    st, *T, lv = (int(x, 0) for x in sys.argv[1:7])
    print(dict(zip(STATS, stats(st, T, lv))))
else:
    for style in range(4):
        p, t = template(style)
        print("style %d @02:%04x  header %s" % (style, p, t[:13].hex(" ")))
        for k, (ti, off) in enumerate(MAP):
            print("   %-9s T%d  %s" % (STATS[k], ti, " ".join("%4d" % s8(x) for x in t[off:off + 9])))
        print("   tail +$70: %02x" % t[0x70])
