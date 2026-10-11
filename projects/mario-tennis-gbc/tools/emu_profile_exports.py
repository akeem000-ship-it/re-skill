"""Profile which bank exports run while the bot plays (which routines are the per-frame
game logic, which are the CPU AI, etc.).  Hooks every $4000-table export of the given banks.
usage: emu_profile_exports.py STATE FRAMES bank[,bank...] [--min N]
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from tools.emu.session import Emu
from gbrom import load_rom, Labels
from scan_jumptables import table
a = sys.argv[1:]
st, N, banks = a[0], int(a[1]), [int(x, 16) for x in a[2].split(",")]
mn = int(a[a.index("--min") + 1]) if "--min" in a else 1
rom = load_rom(); labels = Labels()
e = Emu(); e.load(st)
cnt = collections.Counter(); frames_hit = collections.defaultdict(set)
for b in banks:
    for i, w in enumerate(table(rom, b)):
        def mk(b=b, w=w):
            def f(em): cnt[(b, w)] += 1; frames_hit[(b, w)].add(em.pb.frame_count)
            return f
        try: e.hook(b, w, mk())
        except Exception: pass
held = set(); cool = 0
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(b, addr):
    d = e.wram(b, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
for f in range(N):
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
print("bank:addr   calls  frames  per-frame  label")
for (b, w), n in sorted(cnt.items(), key=lambda x: (-len(frames_hit[x[0]]), -x[1])):
    if n < mn: continue
    nm = labels.name(b, w) or ""
    print("%02x:%04x  %6d  %6d  %8.2f  %s" % (b, w, n, len(frames_hit[(b, w)]), n / N, nm))
