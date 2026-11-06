"""Hook one or more BANK:ADDR routines during bot play and log each entry: frame, caller (return address
on the stack with the current ROM bank) and the registers. usage: emu_hook_callers.py STATE FRAMES BB:AAAA [BB:AAAA...]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
a = sys.argv[1:]; N = int(a[1])
e = Emu(); e.load(a[0]); frame = 0; log = []
def mk(name):
    def fn(em):
        r = e.regs(); sp = r["SP"]; ret = e.mem[sp] | e.mem[sp + 1] << 8
        log.append((frame, name, e.rom_bank(), ret, r["A"], r["B"] << 8 | r["C"], r["D"] << 8 | r["E"], r["HL"], e.mem[0xC4D8]))
    return fn
for t in a[2:]:
    b, ad = t.split(":"); e.hook(int(b, 16), int(ad, 16), mk(t))
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(b, addr):
    d = e.wram(b, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
held = set(); cool = 0
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
for frame in range(N):
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    hold("right", (bx if coming else 0) > px + 12); hold("left", (bx if coming else 0) < px - 12)
    pa = False; tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90: pa = True; cool = 40
    elif tossing and vz >= 0 and bz < -250 and cool == 0: pa = True; cool = 30
    elif not tossing and frame % 90 == 5 and abs(bz) < 1 and vy == 0: pa = True
    hold("a", pa); cool = max(0, cool - 1)
    e.run(1)
for f, name, b, ret, A, bc, de, hl, res in log:
    print("f%5d %s  caller %02x:%04x  A=%02x BC=%04x DE=%04x HL=%04x  result %d" % (f, name, b, ret, A, bc, de, hl, res))
e.stop()
