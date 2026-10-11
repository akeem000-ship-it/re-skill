"""Log calls to key loaders while driving the game with a key script.

Hooks: 04:4B68 LoadCharacterSprites (D=sprite id), 0A:585D LoadMap (A=id).
usage: emu_trace_loads.py --state S [--keys F:btn,...] [--frames N] [--every K] [--prefix name] [--save S2]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
def opt(n, d): return a[a.index(n) + 1] if n in a else d
e = Emu()
if opt("--state", None):
    e.load(opt("--state", None))
log = []
def on_sprite(em):
    r = em.regs(); log.append((em.pb.frame_count, "LoadCharacterSprites D=%d" % r["D"]))
def on_map(em):
    r = em.regs(); log.append((em.pb.frame_count, "LoadMap A=%d" % r["A"]))
e.hook(0x04, 0x4B68, on_sprite)
e.hook(0x0A, 0x585D, on_map)
keys = {}
for k in opt("--keys", "").split(","):
    if k:
        f, b = k.split(":"); keys.setdefault(int(f), []).append(b)
frames = int(opt("--frames", "600")); every = int(opt("--every", "100")); pre = opt("--prefix", "trace")
for f in range(frames):
    for b in keys.get(f, []): e.pb.button_press(b)
    for b in keys.get(f - 6, []): e.pb.button_release(b)
    e.run(1)
    if (f + 1) % every == 0:
        e.shot("gfx/emu/%s_%05d.png" % (pre, f + 1))
for fc, s in log:
    print("frame %6d  %s" % (fc, s))
if opt("--save", None):
    e.save(opt("--save", None))
e.stop()
