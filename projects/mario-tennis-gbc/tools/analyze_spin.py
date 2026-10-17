"""Fit the curve/topspin implementation (08:5613) against a recording.
usage: analyze_spin.py name F0 F1
"""
import sys, os, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_sim import s32, s24, drag, fences

def s16(r, o):
    v = int(r[o]) | int(r[o+1]) << 8; return v - 65536 if v >= 32768 else v

def mshr(p, n):            # magnitude shift (game shifts |P| then re-applies sign)
    return (abs(p) >> n) * (1 if p >= 0 else -1)

def spin_step(s, variant):
    vX88, vY88, vZ88 = s["vX"] >> 8, s["vY"] >> 8, s["vZ"] >> 8
    side, top = s["side"], s["top"]
    if side:
        dX = -mshr(side * vY88, 12); dY = mshr(side * vX88, 12)
        s["vY"] += dY; s["vX"] += dX
        s["side"] = side - 3 * (side >> 8)
    if top:
        t1 = -mshr(top * vZ88, 13)
        spdxy = int(math.hypot(s["vX"] / 65536, s["vY"] / 65536) * 256)
        s["vZ"] += mshr(top * spdxy, 12)
        a = s["head"] / 65536 * 2 * math.pi
        sn, cs = math.sin(a), math.cos(a)
        if variant == 0: s["vY"] += int(2 * t1 * sn); s["vX"] += int(2 * t1 * cs)
        else:            s["vY"] += int(2 * t1 * cs); s["vX"] += int(2 * t1 * sn)
        s["top"] = top - 3 * (top >> 8)

def run(rec, f0, f1, variant, verbose=False):
    r = rec[f0]
    s = dict(X=s32(r, 0x400), Y=s32(r, 0x404), Z=s32(r, 0x408), vX=s24(r, 0x420), vY=s24(r, 0x423), vZ=s24(r, 0x426),
             side=s16(r, 0x41E), top=s16(r, 0x41C))
    worst = 0
    for f in range(f0 + 1, f1):
        R = rec[f]
        s["head"] = s16(rec[f], 0x40E) & 0xFFFF
        s["X"] += s["vX"]; s["Y"] += s["vY"]; s["Z"] += s["vZ"]
        fences(s, 0xCD, 0xCD)
        c = int(R[0x42D]); k = (c >> 4) + 1
        s["vX"], s["vY"], s["vZ"] = drag(s["vX"], k), drag(s["vY"], k), drag(s["vZ"], k)
        spin_step(s, variant)
        if s["Z"] < 0: s["vZ"] += 0x4A00
        e = [abs(s[k_] - s32(R, o)) / 65536 for k_, o in (("X", 0x400), ("Y", 0x404), ("Z", 0x408))]
        worst = max(worst, *e)
        if verbose: print("%d  err X %.3f Y %.3f Z %.3f" % (f, *e))
    return worst

name, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rec = np.load("states/rec_%s.npy" % name)
for v in (0, 1):
    print("variant", v, "max err %.3f px" % run(rec, f0, f1, v))
