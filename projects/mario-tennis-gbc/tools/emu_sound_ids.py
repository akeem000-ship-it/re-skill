"""Log sound requests (rst $08 inline ids via 00:2FB3, and PlaySound A=id at 00:3024) while
replaying a scenario; attribute them to nearby game events (ball bounce/net/hit/score changes).
usage: emu_sound_ids.py STATE FRAMES [bot]
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
a = sys.argv[1:]
e = Emu(); e.load(a[0]); N = int(a[1])
log = []
def rst08(em):
    sp = em.pb.register_file.SP
    ret = em.mem[sp] | em.mem[sp + 1] << 8          # return address = inline byte
    bank = em.mem[0xFF95] if ret >= 0x4000 else 0
    log.append((em.pb.frame_count, "rst08", em.mem[ret] if ret < 0x8000 else -1, bank, ret - 1))
def play(em):
    sp = em.pb.register_file.SP
    ret = em.mem[sp] | em.mem[sp + 1] << 8
    log.append((em.pb.frame_count, "PlaySound", em.regs()["A"], em.mem[0xFF95], ret - 3))
e.hook(0, 0x2FB3, rst08); e.hook(0, 0x3024, play)
events = []
e.hook(8, 0x45A9, lambda em: events.append((em.pb.frame_count, "LaunchBall")))
e.hook(8, 0x46B0, lambda em: events.append((em.pb.frame_count, "BounceDamp")))
bot = len(a) > 2
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
    if bot:
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
c = collections.Counter((k, i) for _, k, i, _, _ in log)
sites = collections.defaultdict(set)
for _, k, i, b, at in log: sites[(k, i)].add("%02x:%04x" % (b if at >= 0x4000 else 0, at))
ev = collections.defaultdict(collections.Counter)
for fr, k, i, _, _ in log:
    for ef, en in events:
        if abs(ef - fr) <= 1: ev[(k, i)][en] += 1
for (k, i), n in sorted(c.items(), key=lambda x: -x[1]):
    print("%-9s id $%02x  x%-4d  from %s  near %s" % (k, i, n, " ".join(sorted(sites[(k, i)])[:4]), dict(ev[(k, i)])))
e.stop()
