"""Record WRAM0 (C000-CFFF) + HRAM (+ WRAM banks 4,5 with --banks) every frame while playing a key script.
Layout per frame: C000-CFFF | FF80-FFFF | [bank4 D000-DFFF | bank5 D000-DFFF]
Saves states/rec_<name>.npy (frames x 4096+128 uint8) and screenshots every K frames.
usage: emu_record.py STATE name "keys" FRAMES [--shots K]
keys: F:button[:hold] comma list (absolute frame offsets)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
import numpy as np
a = sys.argv[1:]
st, name, keys, N = a[0], a[1], a[2], int(a[3])
K = int(a[a.index("--shots") + 1]) if "--shots" in a else 0
press, release = {}, {}
for k in [k for k in keys.split(",") if k]:
    p = k.split(":"); f = int(p[0]); hold = int(p[2]) if len(p) > 2 else 6
    press.setdefault(f, []).append(p[1]); release.setdefault(f + hold, []).append(p[1])
e = Emu(); e.load(st)
BANKS = "--banks" in a
rec = np.zeros((N, 0x1000 + 0x80 + (0x2000 if BANKS else 0)), np.uint8)
for f in range(N):
    for b in press.get(f, []): e.pb.button_press(b)
    for b in release.get(f, []): e.pb.button_release(b)
    e.run(1)
    rec[f, :0x1000] = np.frombuffer(bytes(e.mem[0xC000:0xD000]), np.uint8)
    rec[f, 0x1000:0x1080] = np.frombuffer(bytes(e.mem[0xFF80:0x10000]), np.uint8)
    if BANKS:
        rec[f, 0x1080:0x2080] = np.frombuffer(e.wram(4, 0xD000, 0x1000), np.uint8)
        rec[f, 0x2080:0x3080] = np.frombuffer(e.wram(5, 0xD000, 0x1000), np.uint8)
    if K and f % K == 0:
        e.shot("gfx/emu/rec_%s_%04d.png" % (name, f))
np.save("states/rec_%s.npy" % name, rec)
e.save("states/rec_%s_end.state" % name)
print("recorded", rec.shape)
e.stop()
