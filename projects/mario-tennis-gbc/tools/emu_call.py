"""Inject a far call from a running state: when PC reaches a hook point (default FieldLoop 0A:4FF5),
map bank BB, set A, and jump to an existing `rst $18 ; db idx, bank ; ...` site so the game itself performs
the far call. The return path is not restored — use it to look at what the callee shows.
usage: emu_call.py STATE SITE_BANK SITE_ADDR A FRAMES OUT.png [--hook BB:AAAA] [--press-every N] [--shots K]
example: emu_call.py states/t4.state 10 47fc 3 400 gfx/emu/mg3.png    (10:47FC = rst $18 -> 0B:4705)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
st, sb, sa, av, frames, out = a[0], int(a[1], 16), int(a[2], 16), int(a[3], 0), int(a[4]), a[5]
hb, ha = (int(x, 16) for x in (a[a.index("--hook") + 1].split(":") if "--hook" in a else ("0a", "4ff5")))
every = int(a[a.index("--press-every") + 1]) if "--press-every" in a else 0
shots = int(a[a.index("--shots") + 1]) if "--shots" in a else 0
e = Emu(); e.load(st)
done = []
def inject(em):
    if done: return
    done.append(1)
    rf = em.pb.register_file
    em.pb.memory[0xFF95] = sb          # hROMBank shadow
    em.pb.memory[0x2000] = sb          # MBC5 ROM bank
    rf.A = av
    rf.PC = sa
e.hook(hb, ha, inject)
for f in range(frames):
    if every and f % every == every - 1: e.press("a", 4, 0)
    e.run(1)
    if shots and f % shots == shots - 1: e.shot(out.replace(".png", "_%04d.png" % (f + 1)), scale=1)
print("injected" if done else "hook not reached", e.shot(out, scale=2))
e.stop()
