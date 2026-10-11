"""Find candidate player position/velocity fields in a --banks recording by correlating with
the input timeline (right/left/up/down hold windows).
usage: analyze_mover.py name
"""
import sys
import numpy as np
rec = np.load("states/rec_%s.npy" % sys.argv[1]).astype(np.int64)
def name(i):
    if i < 0x1000: return "C%03X" % i
    if i < 0x1080: return "FF%02X" % (0x80 + i - 0x1000)
    if i < 0x2080: return "4:D%03X" % (i - 0x1080)
    return "5:D%03X" % (i - 0x2080)
N, M = rec.shape
res = []
for i in range(M - 1):
    v = rec[:, i] | rec[:, i + 1] << 8
    v = np.where(v >= 0x8000, v - 0x10000, v)
    a, b, c, d = v[10], v[50], v[120], v[180]   # start, after right, after left, after up
    if a == b or b == c: continue
    if (b - a) * (c - b) < 0 and abs(b - a) > 64 and np.abs(np.diff(v[10:50])).max() < 2000:
        res.append((abs(b - a), name(i), a, b, c, d, v[230]))
for r in sorted(res, reverse=True)[:25]:
    print("%-8s start %6d  +right %6d  +left %6d  +up %6d  +down %6d" % r[1:])
