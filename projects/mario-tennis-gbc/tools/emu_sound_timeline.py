"""Log every SoundStart (00:3297) id during a bot-played rally, tagged with the game events around it
(LaunchBall 08:45A9 = racket contact, InOutCheck 08:463A = bounce), to name the SFX ids.

usage: emu_sound_timeline.py STATE FRAMES   (emu_sound_ids.py gives the per-id summary with call sites)"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
st, N = sys.argv[1], int(sys.argv[2])
e = Emu(); e.load(st)
frame = 0; log = []
def on_start(em): log.append((frame, "sound", e.regs()["A"]))
def on_launch(em): log.append((frame, "hit", None))
def on_bounce(em): log.append((frame, "bounce", None))
e.hook(0, 0x3297, on_start); e.hook(8, 0x45A9, on_launch); e.hook(8, 0x463A, on_bounce)
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(bank, addr):
    d = e.wram(bank, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
held = set(); swing_cool = 0
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
for frame in range(N):
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    tx = bx if coming else 0
    hold("right", tx > px + 12); hold("left", tx < px - 12)
    press_a = False
    if swing_cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90: press_a = True; swing_cool = 40
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if tossing and vz >= 0 and bz < -250 and swing_cool == 0: press_a = True; swing_cool = 30
    elif not tossing and frame % 90 == 5 and abs(bz) < 1 and vy == 0: press_a = True
    hold("a", press_a); swing_cool = max(0, swing_cool - 1)
    e.run(1)
for f, k, v in log: print("f%5d %-6s %s" % (f, k, "$%02x" % v if v is not None else ""))
e.stop()
