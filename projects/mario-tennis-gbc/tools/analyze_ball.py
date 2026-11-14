"""Decode ball state from a recording (VERIFIED layout, see REVERSE.md 'Ball physics').
  pos X/Y/Z : C400/C404/C408 signed 16.16
  vel X/Y/Z : C420/C423/C426 signed 8.16 (3 bytes)
usage: analyze_ball.py name [--range F0:F1] [--step N]
"""
import sys
import numpy as np
a = sys.argv[1:]
rec = np.load("states/rec_%s.npy" % a[0]).astype(np.int64)
f0, f1 = 0, rec.shape[0]
if "--range" in a: f0, f1 = [int(x) for x in a[a.index("--range") + 1].split(":")]
step = int(a[a.index("--step") + 1]) if "--step" in a else 1
def s32(o):
    v = rec[:, o] | rec[:, o+1] << 8 | rec[:, o+2] << 16 | rec[:, o+3] << 24
    return np.where(v >= 1 << 31, v - (1 << 32), v) / 65536
def s24(o):
    v = rec[:, o] | rec[:, o+1] << 8 | rec[:, o+2] << 16
    return np.where(v >= 1 << 23, v - (1 << 24), v) / 65536
X, Y, Z = s32(0x400), s32(0x404), s32(0x408)
VX, VY, VZ = s24(0x420), s24(0x423), s24(0x426)
print("frame       X        Y        Z      vX      vY      vZ    dvX     dvY     dvZ")
for f in range(f0, f1, step):
    d = (VX[f] - VX[f-1], VY[f] - VY[f-1], VZ[f] - VZ[f-1]) if f else (0, 0, 0)
    print("%5d %8.2f %8.2f %8.2f %7.3f %7.3f %7.3f %7.4f %7.4f %7.4f" % (f, X[f], Y[f], Z[f], VX[f], VY[f], VZ[f], *d))
