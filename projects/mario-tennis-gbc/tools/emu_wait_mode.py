"""Bot-play from STATE until the score display mode wC494 reaches one of MODES (e.g. 3,4,5 = game
score), then run EXTRA frames, save states/OUT.state and print the wC494 transitions.
usage: emu_wait_mode.py STATE MODES OUT [--max N] [--extra N] [games]  (games: stop when the game count changes)"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
a = sys.argv[1:]
modes = set(int(x) for x in a[1].split(",")); out = a[2]
N = int(a[a.index("--max") + 1]) if "--max" in a else 8000
extra = int(a[a.index("--extra") + 1]) if "--extra" in a else 20
e = Emu(); e.load(a[0])
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(b, addr):
    d = e.wram(b, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
held = set(); cool = 0; last = None
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
for f in range(N):
    mode = e.mem[0xC494]
    key = (mode, e.mem[0xC8E4], e.mem[0xC8E5], e.mem[0xC8E6], e.mem[0xC8E7])
    if key != last: print("f%5d wC494=%d points %d-%d games %d-%d" % ((f,) + key)); games_changed = last is not None and key[3:] != last[3:]; last = key
    else: games_changed = False
    if mode in modes or (games_changed and "games" in a):
        e.run(extra); e.save(out); print("saved", out, "at frame", f + extra); break
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    hold("right", (bx if coming else 0) > px + 12); hold("left", (bx if coming else 0) < px - 12)
    pa = False; tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90: pa = True; cool = 40
    elif tossing and vz >= 0 and bz < -250 and cool == 0: pa = True; cool = 30
    elif not tossing and f % 90 == 5 and abs(bz) < 1 and vy == 0: pa = True
    hold("a", pa); cool = max(0, cool - 1)
    e.run(1)
e.stop()
