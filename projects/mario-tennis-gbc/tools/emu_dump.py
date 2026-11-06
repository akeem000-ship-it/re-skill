"""Load a state, optionally run frames, hex-dump memory ranges.
usage: emu_dump.py STATE [--run N] ADDR:LEN [ADDR:LEN ...]   (ADDR may be BANK/ADDR for WRAM/SRAM banks)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
a = sys.argv[1:]
e = Emu(); e.load(a[0])
if "--run" in a:
    e.run(int(a[a.index("--run") + 1]))
for spec in a[1:]:
    if ":" not in spec: continue
    ad, n = spec.split(":"); n = int(n, 16)
    if "/" in ad:
        b, ad = ad.split("/"); data = e.wram(int(b, 16), int(ad, 16), n); base = int(ad, 16)
    else:
        base = int(ad, 16); data = bytes(e.mem[base:base + n])
    print("== %s" % spec)
    for i in range(0, n, 16):
        print("%04x: %s" % (base + i, " ".join("%02x" % x for x in data[i:i + 16])))
e.stop()
