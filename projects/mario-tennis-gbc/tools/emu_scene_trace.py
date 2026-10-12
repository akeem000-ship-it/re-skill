"""Log the top-level scene flow: every FieldScene (0A:4F40, logged at 4F55 after the record loads) with the location record
(map wC281, script wC29B:wC28A, init hook wC29C), every LoadMap (0A:585D, A = map) and
LoadScreen (39:407E, A = screen), and the init-hook target called at 0A:4FC1.
usage: emu_scene_trace.py [--state S | --fresh] --frames N [--keys F:button,...]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
def opt(n, d): return a[a.index(n) + 1] if n in a else d
frames = int(opt("--frames", "1200"))
keys = {}
for k in opt("--keys", "").split(","):
    if k:
        f, b = k.split(":"); keys[int(f)] = b
e = Emu(fresh="--fresh" in a)
if "--state" in a: e.load(opt("--state", ""))
log = []
def note(kind, fmt):
    def f(em):
        log.append((em.pb.frame_count, kind, fmt(em)))
    return f
w16 = lambda em, x: em.r8(x) | em.r8(x + 1) << 8
e.hook(0x0A, 0x4F55, note("FieldScene", lambda em: "area %02x map %02x script %02x:%04x hook %04x music %02x" % (
    em.r8(0xC280), em.r8(0xC281), em.r8(0xC29B), w16(em, 0xC28A), w16(em, 0xC29C), em.r8(0xC284))))
e.hook(0x0A, 0x585D, note("LoadMap", lambda em: "map %02x" % em.regs()["A"]))
def stack(em, n=8):
    sp = em.regs()["SP"]
    return " ".join("%04x" % w16(em, sp + 2 * i) for i in range(n))
e.hook(0x39, 0x407E, note("LoadScreen", lambda em: "screen %02x  stack %s" % (em.regs()["A"], stack(em))))
e.hook(0x0A, 0x4FC1, note("InitHook", lambda em: "%02x:%04x" % (em.regs()["A"], em.regs()["HL"])))
for f in range(frames):
    if f in keys: e.pb.button_press(keys[f])
    if f - 6 in keys: e.pb.button_release(keys[f - 6])
    e.run(1)
if "--save" in a: e.save(opt("--save", ""))
e.stop()
for fr, k, t in log:
    print("frame %6d  %-10s %s" % (fr, k, t))
