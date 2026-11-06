"""Ph6: let tools/emu_bot.py's player play a whole exhibition match in PyBoy and log the game's
own events through hooks (verifies call flow of decoded routines and gives reference statistics).

Hooks counted: 08:576B BallStep, 08:45A9 LaunchBall, 08:5814 BallNetCheck, 08:463A InOutCheck,
0A:585D LoadMap, 04:4B68 LoadCharacterSprites, 00:2749 VBlank.
usage: emu_fullmatch.py STATE [--frames N]
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
N = int(a[a.index("--frames") + 1]) if "--frames" in a else 40000
e = Emu(); e.load(a[0])
cnt = collections.Counter()
for name, bank, addr in (("BallStep", 8, 0x576B), ("LaunchBall", 8, 0x45A9), ("NetCheck", 8, 0x5814),
                         ("InOutCheck", 8, 0x463A), ("LoadMap", 0x0A, 0x585D), ("LoadCharSprites", 4, 0x4B68),
                         ("VBlank", 0, 0x2749)):
    e.hook(bank, addr, lambda em, n=name: cnt.update([n]))

def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(bank, addr):
    d = e.wram(bank, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256

held = set(); cool = 0
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
points = []; last = (0, 0); launches_at_point = 0; steps_frames = 0
for f in range(N):
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    tx = bx if coming else 0
    hold("right", tx > px + 12); hold("left", tx < px - 12)
    pa = False
    tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90: pa = True; cool = 40
    elif tossing and vz >= 0 and bz < -250 and cool == 0: pa = True; cool = 30
    elif not tossing and f % 90 == 5 and abs(bz) < 1 and vy == 0: pa = True
    hold("a", pa); cool = max(0, cool - 1)
    before = cnt["BallStep"]
    e.run(1)
    if cnt["BallStep"] > before: steps_frames += 1
    score = (e.mem[0xC8E4], e.mem[0xC8E5])
    if score != last:
        points.append((f, score, cnt["LaunchBall"] - launches_at_point)); launches_at_point = cnt["LaunchBall"]; last = score
    if f % 5000 == 0:
        e.shot("gfx/emu/full_%05d.png" % f)
e.shot("gfx/emu/full_end.png"); e.save("states/fullmatch_end.state")
print("frames", N, "hook counts", dict(cnt))
print("frames with exactly >=1 BallStep:", steps_frames)
print("score changes (frame, (P1,P2) points, launches since last):")
for p in points: print("  ", p)
e.stop()
