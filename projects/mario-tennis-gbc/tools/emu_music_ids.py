"""Log sound/music requests during boot -> title -> menus -> match start (fresh boot, scripted keys).
usage: emu_music_ids.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
e = Emu(fresh=True)
log = []
def grab(kind):
    def f(em):
        sp = em.pb.register_file.SP; ret = em.mem[sp] | em.mem[sp + 1] << 8
        i = em.mem[ret] if kind == "rst08" and ret < 0x8000 else em.regs()["A"]
        log.append((em.pb.frame_count, kind, i, em.mem[0xFF95], ret))
    return f
e.hook(0, 0x2FB3, grab("rst08")); e.hook(0, 0x3024, grab("PlaySound"))
keys = {1000: "start", 1400: "start", 1700: "a", 1900: "a", 2100: "a", 2200: "right", 2300: "a", 2500: "a", 2700: "a", 2900: "a"}
marks = {0: "boot", 1000: "title start", 1400: "main menu", 1700: "exhibition", 2300: "char select", 2900: "match"}
for f in range(3600):
    if f in keys: e.pb.button_press(keys[f])
    if f - 6 in keys: e.pb.button_release(keys[f - 6])
    e.run(1)
e.stop()
for fr, k, i, b, ret in log:
    tag = max((m for m in marks if m <= fr), default=0)
    if k == "rst08" or i < 0x50:
        print("frame %5d (%-12s) %-9s id $%02x  from %02x:%04x" % (fr, marks[tag], k, i, b if ret >= 0x4000 else 0, ret))
