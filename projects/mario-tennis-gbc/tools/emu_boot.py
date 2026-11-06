"""Boot test: run N frames from power-on, screenshot every K frames, optional key script.

usage: emu_boot.py [--frames N] [--every K] [--keys F:button,F:button,...] [--fresh] [--save STATE]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
def opt(n, d): return a[a.index(n) + 1] if n in a else d
frames = int(opt("--frames", "600")); every = int(opt("--every", "60"))
keys = {}
for k in opt("--keys", "").split(","):
    if k:
        f, b = k.split(":"); keys[int(f)] = b
e = Emu(fresh="--fresh" in a)
for f in range(frames):
    if f in keys:
        e.pb.button_press(keys[f])
    if f - 6 in keys:
        e.pb.button_release(keys[f - 6])
    e.run(1)
    if (f + 1) % every == 0:
        print("frame %5d  ROMbank %02x  map %02x  PC %04x" % (f + 1, e.rom_bank(), e.r8(0xC281), e.regs()["PC"]),
              e.shot("gfx/emu/boot_%05d.png" % (f + 1)))
if "--save" in a:
    e.save(opt("--save", None))
e.stop()
