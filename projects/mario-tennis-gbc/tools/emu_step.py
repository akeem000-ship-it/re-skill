"""Incremental driver: load STATE, play a key script, save OUT state, screenshot every K frames.

keys: comma list of BUTTON[*N][@WAIT]  e.g. "down,a@120,right*3,a"  (default wait 30 frames
after each press; *N repeats).  usage: emu_step.py IN OUT "keys" [--tail FRAMES] [--shots K]
Screenshots: gfx/emu/step_<out>_NNN.png ; final: gfx/emu/<out>.png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
src, dst, script = a[0], a[1], a[2]
tail = int(a[a.index("--tail") + 1]) if "--tail" in a else 60
shots = int(a[a.index("--shots") + 1]) if "--shots" in a else 0
name = os.path.splitext(os.path.basename(dst))[0]
e = Emu(); e.load(src)
n = 0
def maybe_shot():
    global n
    if shots and e.pb.frame_count % shots == 0:
        e.shot("gfx/emu/step_%s_%03d.png" % (name, n)); n += 1
for tok in [t for t in script.split(",") if t]:
    wait = 30
    if "@" in tok: tok, w = tok.split("@"); wait = int(w)
    rep = 1
    if "*" in tok: tok, r = tok.split("*"); rep = int(r)
    for _ in range(rep):
        if tok != "wait":
            e.pb.button_press(tok)
            for _ in range(6): e.run(1); maybe_shot()
            e.pb.button_release(tok)
        for _ in range(wait): e.run(1); maybe_shot()
for _ in range(tail): e.run(1); maybe_shot()
e.save(dst); e.shot("gfx/emu/%s.png" % name)
print("saved", dst, "frame", e.pb.frame_count)
e.stop()
