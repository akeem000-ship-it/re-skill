"""Rank WRAM0/HRAM addresses in a recording by 'smooth motion' (positions/velocities).
usage: analyze_recording.py name [--top N] [--show ADDR,ADDR,...] [--range F0:F1]
"""
import sys
import numpy as np
a = sys.argv[1:]
rec = np.load("states/rec_%s.npy" % a[0]).astype(np.int32)
top = int(a[a.index("--top") + 1]) if "--top" in a else 40
def name(i): return "C%03X" % i if i < 0x1000 else "FF%02X" % (0x80 + i - 0x1000)
def idx(s):
    v = int(s, 16); return v - 0xC000 if v < 0xFF00 else 0x1000 + v - 0xFF80
if "--show" in a:
    cols = [idx(s) for s in a[a.index("--show") + 1].split(",")]
    f0, f1 = 0, rec.shape[0]
    if "--range" in a: f0, f1 = [int(x) for x in a[a.index("--range") + 1].split(":")]
    print("frame " + " ".join("%5s" % name(c) for c in cols))
    for f in range(f0, f1):
        print("%5d " % f + " ".join("%5d" % rec[f, c] for c in cols))
    sys.exit()
d = np.diff(rec, axis=0)
d = np.where(d > 127, d - 256, d); d = np.where(d < -128, d + 256, d)
changes = (d != 0).sum(0)
small = ((np.abs(d) > 0) & (np.abs(d) <= 8)).sum(0)
distinct = np.array([len(np.unique(rec[:, i])) for i in range(rec.shape[1])])
score = small * (distinct > 8)
order = np.argsort(-score)
print("addr  changes small distinct  min  max  first..last")
for i in order[:top]:
    if score[i] == 0: break
    print("%s  %5d %5d %5d   %3d  %3d  %s" % (name(i), changes[i], small[i], distinct[i], rec[:, i].min(), rec[:, i].max(),
          " ".join(str(x) for x in rec[::24, i])))
