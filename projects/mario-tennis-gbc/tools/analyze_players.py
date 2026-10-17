"""Player motion from a --banks/bot recording: per-frame dX/dY histograms and accel runs.
usage: analyze_players.py name
"""
import sys
from collections import Counter
import numpy as np
rec = np.load("states/rec_%s.npy" % sys.argv[1]).astype(np.int64)
def s24(base, o):
    v = rec[:, base + o] | rec[:, base + o + 1] << 8 | rec[:, base + o + 2] << 16
    return np.where(v >= 1 << 23, v - (1 << 24), v) / 256
for nm, base in (("P1 (WRAM4)", 0x1080), ("P2 (WRAM5)", 0x2080)):
    X, Y = s24(base, 0xF00), s24(base, 0xF03)
    dx, dy = np.diff(X), np.diff(Y)
    sp = np.round(np.hypot(dx, dy), 2)
    print(nm, "speed histogram (px/frame):", Counter(sp[sp > 0]).most_common(10))
    # show an acceleration ramp: first run where speed goes from 0 to max
    for f in range(1, len(sp) - 12):
        if sp[f - 1] == 0 and sp[f] > 0:
            print("   ramp at frame %d: %s" % (f, " ".join("%.2f" % x for x in sp[f:f + 12])))
            break
    for f in range(12, len(sp)):
        if sp[f] == 0 and sp[f - 1] > 0:
            print("   stop at frame %d: %s" % (f, " ".join("%.2f" % x for x in sp[f - 10:f + 1])))
            break
