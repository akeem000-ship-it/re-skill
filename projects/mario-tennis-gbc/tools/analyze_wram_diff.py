"""Diff WRAM dumps from emu_charmatch.py runs; print addresses whose value differs between runs.
Layout of each dump: C000-CFFF, then WRAM banks 1-7 D000-DFFF, then FF80-FFFF.
usage: analyze_wram_diff.py label=file ... [--max N] [--small]
"""
import sys
args = [a for a in sys.argv[1:] if "=" in a]
labels = [a.split("=")[0] for a in args]
blobs = [open(a.split("=")[1], "rb").read() for a in args]
small = "--small" in sys.argv


def addr(i):
    if i < 0x1000: return "C%03X" % i
    i -= 0x1000
    if i < 7 * 0x1000: return "%d:D%03X" % (i // 0x1000 + 1, i % 0x1000)
    return "FF%02X" % (0x80 + i - 7 * 0x1000)


print("addr     " + " ".join("%6s" % l[:6] for l in labels))
for i in range(len(blobs[0])):
    vals = [b[i] for b in blobs]
    if len(set(vals)) > 1 and (not small or max(vals) <= 32):
        print("%-8s " % addr(i) + " ".join("%6d" % v for v in vals))
