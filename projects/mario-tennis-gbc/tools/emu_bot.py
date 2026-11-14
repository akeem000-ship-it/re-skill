"""Play P1 automatically (track ball X, swing when close) and record WRAM0+HRAM+WRAM4/5 per frame.

usage: emu_bot.py STATE name FRAMES [--shots K] [--swing-dist N]
Output: states/rec_<name>.npy (same layout as emu_record.py --banks), screenshots gfx/emu/bot_<name>_*.png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
import numpy as np

a = sys.argv[1:]
st, name, N = a[0], a[1], int(a[2])
K = int(a[a.index("--shots") + 1]) if "--shots" in a else 0
SW = int(a[a.index("--swing-dist") + 1]) if "--swing-dist" in a else 160
e = Emu(); e.load(st)

def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(bank, addr):
    d = e.wram(bank, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256

rec = np.zeros((N, 0x3080), np.uint8)
held = set(); log = []
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
swing_cool = 0
for f in range(N):
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    tx = bx if coming else 0
    hold("right", tx > px + 12); hold("left", tx < px - 12)
    press_a = False
    if swing_cool == 0 and coming and abs(by - py) < SW and abs(bx - px) < 90:
        press_a = True; swing_cool = 40
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if tossing and vz >= 0 and bz < -250 and swing_cool == 0:   # hit the toss on the way down
        press_a = True; swing_cool = 30
    elif not tossing and f % 90 == 5 and abs(bz) < 1 and vy == 0:  # start serve / dismiss popups
        press_a = True
    hold("a", press_a)
    swing_cool = max(0, swing_cool - 1)
    e.run(1)
    rec[f, :0x1000] = np.frombuffer(bytes(e.mem[0xC000:0xD000]), np.uint8)
    rec[f, 0x1000:0x1080] = np.frombuffer(bytes(e.mem[0xFF80:0x10000]), np.uint8)
    rec[f, 0x1080:0x2080] = np.frombuffer(e.wram(4, 0xD000, 0x1000), np.uint8)
    rec[f, 0x2080:0x3080] = np.frombuffer(e.wram(5, 0xD000, 0x1000), np.uint8)
    if K and f % K == 0:
        e.shot("gfx/emu/bot_%s_%04d.png" % (name, f))
np.save("states/rec_%s.npy" % name, rec)
e.save("states/rec_%s_end.state" % name)
print("score P1 %d P2 %d" % (e.mem[0xC8E4], e.mem[0xC8E5]))
e.stop()
