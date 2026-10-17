"""Print 16.16 / 8.8 fixed-point views of a recording.
usage: analyze_fixed.py name ADDR:fmt[,ADDR:fmt...] [--step N] [--range F0:F1]
fmt: f32 (signed 16.16), s16 (signed 8.8 shown as value/256), u8, s8
"""
import sys
import numpy as np
a = sys.argv[1:]
rec = np.load("states/rec_%s.npy" % a[0]).astype(np.int64)
specs = [(int(s.split(":")[0], 16) - 0xC000, s.split(":")[1], s.split(":")[0]) for s in a[1].split(",")]
step = int(a[a.index("--step") + 1]) if "--step" in a else 4
f0, f1 = 0, rec.shape[0]
if "--range" in a: f0, f1 = [int(x) for x in a[a.index("--range") + 1].split(":")]
print("frame " + " ".join("%10s" % n for _, _, n in specs))
for f in range(f0, f1, step):
    out = []
    for o, fmt, _ in specs:
        r = rec[f]
        if fmt == "f32":
            v = int(r[o]) | int(r[o + 1]) << 8 | int(r[o + 2]) << 16 | int(r[o + 3]) << 24
            if v >= 1 << 31: v -= 1 << 32
            out.append("%10.2f" % (v / 65536))
        elif fmt == "s16":
            v = int(r[o]) | int(r[o + 1]) << 8
            if v >= 0x8000: v -= 0x10000
            out.append("%10.2f" % (v / 256))
        elif fmt == "s8":
            v = int(r[o]); v = v - 256 if v > 127 else v
            out.append("%10d" % v)
        else:
            out.append("%10d" % r[o])
    print("%5d " % f + " ".join(out))
