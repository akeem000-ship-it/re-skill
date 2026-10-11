"""Find fields whose value tracks the per-frame derivative of a 16.16 position field.
usage: analyze_velocity.py name POSADDR [--range F0:F1]
Tests every 8-, 16- and 32-bit signed field in C400-C4FF; prints the best linear fits.
"""
import sys
import numpy as np
a = sys.argv[1:]
rec = np.load("states/rec_%s.npy" % a[0]).astype(np.int64)
p = int(a[1], 16) - 0xC000
f0, f1 = 66, 95
if "--range" in a: f0, f1 = [int(x) for x in a[a.index("--range") + 1].split(":")]
def f32(o):
    v = rec[:, o] | rec[:, o + 1] << 8 | rec[:, o + 2] << 16 | rec[:, o + 3] << 24
    return np.where(v >= 1 << 31, v - (1 << 32), v)
pos = f32(p).astype(float) / 65536
vel = np.diff(pos)[f0:f1]  # pos[f+1]-pos[f]
res = []
for o in range(0x400, 0x500):
    for w in (1, 2, 4):
        if w == 1: v = np.where(rec[:, o] > 127, rec[:, o] - 256, rec[:, o])
        elif w == 2:
            v = rec[:, o] | rec[:, o + 1] << 8; v = np.where(v >= 0x8000, v - 0x10000, v)
        else: v = f32(o)
        x = v[f0 + 1:f1 + 1].astype(float)   # value used during the step f->f+1 (try both alignments)
        for shift, xx in (("cur", v[f0:f1].astype(float)), ("next", x)):
            if xx.std() == 0 or vel.std() == 0: continue
            c = np.corrcoef(xx, vel)[0, 1]
            if abs(c) > 0.98:
                k = np.polyfit(xx, vel, 1)
                res.append((abs(c), "C%03X w%d %s corr %.4f  vel = %.6g * v + %.3g" % (o, w, shift, c, k[0], k[1])))
for c, s in sorted(res, reverse=True)[:8]:
    print(s)
