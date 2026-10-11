"""Search WRAM (all banks) + SRAM of a state for 11-byte windows matching a multiset of values.
usage: emu_find_seq.py STATE v1,v2,... [--exact]   (--exact: same order)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from collections import Counter
st, vals = sys.argv[1], [int(x) for x in sys.argv[2].split(",")]
e = Emu(); e.load(st)
regions = [("C", 0xC000, bytes(e.mem[0xC000:0xD000]))]
for b in range(1, 8):
    regions.append(("%d:D" % b, 0xD000, e.wram(b, 0xD000, 0x1000)))
n = len(vals); want = Counter(vals)
for name, base, data in regions:
    for i in range(len(data) - n):
        w = data[i:i + n]
        if ("--exact" in sys.argv and list(w) == vals) or ("--exact" not in sys.argv and Counter(w) == want):
            print("%s %04x: %s" % (name, base + i, " ".join(str(x) for x in w)))
e.stop()
