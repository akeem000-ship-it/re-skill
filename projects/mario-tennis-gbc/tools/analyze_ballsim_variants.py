"""Try orderings/roundings of the ball step against a recording; report max error per variant.
usage: analyze_ballsim_variants.py name F0 F1
"""
import sys, itertools
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from ball_sim import s32, s24

def drag_a(v, k):  # top-16 based
    hw = v >> 8; return v - ((((hw >> 1) * k) >> 8) << 8)
def drag_b(v, k):  # full precision
    return v - (v * k) // 512
def drag_c(v, k):  # trunc toward zero on magnitude
    m = abs(v); d = (((m >> 8) >> 1) * k >> 8) << 8; return v - d if v >= 0 else v + d

def run(rec, f0, f1, order, drag):
    r = rec[f0]
    s = dict(X=s32(r, 0x400), Y=s32(r, 0x404), Z=s32(r, 0x408), vX=s24(r, 0x420), vY=s24(r, 0x423), vZ=s24(r, 0x426))
    worst = 0
    for f in range(f0 + 1, f1):
        r = rec[f - 1]; c = int(r[0x42D]); c = c - 256 if c > 127 else c; k = (abs(c) >> 4) + 1
        for op in order:
            if op == "I": s["X"] += s["vX"]; s["Y"] += s["vY"]; s["Z"] += s["vZ"]
            elif op == "D": s["vX"], s["vY"], s["vZ"] = drag(s["vX"], k), drag(s["vY"], k), drag(s["vZ"], k)
            elif op == "G":
                if s["Z"] < 0: s["vZ"] += 0x4A00
        R = rec[f]
        worst = max(worst, abs(s["Y"] - s32(R, 0x404)) / 65536, abs(s["Z"] - s32(R, 0x408)) / 65536,
                    abs(s["vY"] - s24(R, 0x423)) / 65536)
    return worst

name, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rec = np.load("states/rec_%s.npy" % name)
res = []
for order in itertools.permutations("IDG"):
    for dn, d in (("top16", drag_a), ("full", drag_b), ("mag", drag_c)):
        res.append((run(rec, f0, f1, order, d), "".join(order), dn))
for w, o, d in sorted(res)[:6]:
    print("%-4s %-6s max err %.4f px" % (o, d, w))
