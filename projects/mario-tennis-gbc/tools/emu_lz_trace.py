"""Log every LZ decompression (00:1797): ROM bank, source HL, destination DE, caller.
usage: emu_lz_trace.py STATE FRAMES [--keys F:button,...] [--bank BB]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
def opt(n, d): return a[a.index(n) + 1] if n in a else d
e = Emu(); e.load(a[0]); N = int(a[1])
keys = {}
for k in opt("--keys", "").split(","):
    if k:
        f, b = k.split(":"); keys[int(f)] = b
only = int(opt("--bank", "-1"), 16) if "--bank" in a else None
log = []
def hit(em):
    r = em.regs(); sp = r["SP"]
    log.append((em.pb.frame_count, em.rom_bank(), r["HL"], r["D"] << 8 | r["E"],
                em.mem[sp] | em.mem[sp + 1] << 8, em.mem[0xFF96]))
e.hook(0x00, 0x1797, hit)
for f in range(N):
    if f in keys: e.pb.button_press(keys[f])
    if f - 6 in keys: e.pb.button_release(keys[f - 6])
    e.run(1)
e.stop()
for fr, b, src, dst, ret, wb in log:
    if only is None or b == only:
        print("frame %6d  src %02x:%04x  dst %04x (wram %d)  ret %04x" % (fr, b, src, dst, wb, ret))
print(len(log), "decompressions")
