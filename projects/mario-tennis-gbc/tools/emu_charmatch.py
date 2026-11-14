"""Start a 1P exhibition match with the k-th character (cursor moved right k times from the
default) vs the first free opponent, then dump WRAM banks 0-7 + HRAM to states/wram_k<k>.bin.

usage: emu_charmatch.py K [--frames N]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

k = int(sys.argv[1])
N = int(sys.argv[sys.argv.index("--frames") + 1]) if "--frames" in sys.argv else 1500
e = Emu(); e.load("states/after_boot.state")
seq = []
t = 30
for _ in range(k):
    seq.append((t, "right")); t += 20
seq.append((t, "a")); t += 90
e_opp = [(t, "right"), (t + 40, "a")]; t += 140
seq += e_opp
for _ in range(8):
    seq.append((t, "a")); t += 100
keys = {}
for f, b in seq: keys.setdefault(f, []).append(b)
log = []
e.hook(0x04, 0x4B68, lambda em: log.append(em.regs()["D"]))
for f in range(N):
    for b in keys.get(f, []): e.pb.button_press(b)
    for b in keys.get(f - 6, []): e.pb.button_release(b)
    e.run(1)
    if f == 2 * 30 + 20 * k:
        e.shot("gfx/emu/charsel_k%02d.png" % k)
e.shot("gfx/emu/match_k%02d.png" % k)
blob = bytes(e.mem[0xC000:0xD000])
for b in range(1, 8):
    blob += e.wram(b, 0xD000, 0x1000)
blob += bytes(e.mem[0xFF80:0x10000])
os.makedirs("states", exist_ok=True)
open("states/wram_k%02d.bin" % k, "wb").write(blob)
print("k=%d sprite ids loaded: %s" % (k, log))
e.stop()
