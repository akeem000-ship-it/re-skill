"""List racket hits in a recording: frames where vY flips sign with a large new speed.
Prints launch speed, elevation, heading, spins and which player (P1 hits send vY < 0).
usage: analyze_hits.py name
"""
import sys, math
import numpy as np
rec = np.load("states/rec_%s.npy" % sys.argv[1]).astype(np.int64)
def s24(o):
    v = rec[:, o] | rec[:, o+1] << 8 | rec[:, o+2] << 16
    return np.where(v >= 1 << 23, v - (1 << 24), v) / 65536
def s16(o):
    v = rec[:, o] | rec[:, o+1] << 8
    return np.where(v >= 32768, v - 65536, v)
vx, vy, vz = s24(0x420), s24(0x423), s24(0x426)
top, side = s16(0x41C), s16(0x41E)
print("frame who   speed   elev   heading   top   side   P-stroke/serve rows")
for f in range(1, rec.shape[0]):
    if np.sign(vy[f]) != np.sign(vy[f-1]) and abs(vy[f]) > 15 and abs(vy[f-1]) > 1 or (vy[f-1] == 0 and abs(vy[f]) > 15):
        sp = math.sqrt(vx[f]**2 + vy[f]**2 + vz[f]**2)
        el = math.degrees(math.asin(-vz[f] / sp))
        hd = math.degrees(math.atan2(vy[f], vx[f])) % 360
        who = "P1" if vy[f] < 0 else "P2"
        b = 0x1080 if who == "P1" else 0x2080
        rows = "stroke %d serve %d volley %d top %d slice %d" % tuple(rec[f, b + 0xF6B:b + 0xF70])
        print("%5d %s %7.2f %6.1f %8.1f %6d %6d   %s" % (f, who, sp, el, hd, top[f], side[f], rows))
