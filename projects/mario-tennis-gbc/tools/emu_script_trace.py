"""Trace the RPG bytecode interpreter (04:447D table): hook every opcode handler and log
(frame, actor slot, opcode, script address, next bytes) while replaying a state.
usage: emu_script_trace.py STATE FRAMES [--press] [--skip 0,2]   (--press: press A every 60 frames)
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from tools.emu.session import Emu
from gbrom import load_rom, to_offset
rom = load_rom()
TABLE = 0x447D
handlers = [rom[to_offset(4, TABLE + i * 2)] | rom[to_offset(4, TABLE + i * 2 + 1)] << 8 for i in range(22)]
st, N = sys.argv[1], int(sys.argv[2])
e = Emu(); e.load(st)
log = []
def mk(op):
    def f(em):
        r = em.regs(); de = r["D"] << 8 | r["E"]; bank = em.mem[0xDAF7]
        slot = em.mem[0xFFEA] | em.mem[0xFFEB] << 8
        try: nxt = rom[to_offset(bank, de):to_offset(bank, de) + 6].hex(" ")
        except Exception: nxt = "?"
        log.append((em.pb.frame_count, slot, op, bank, de, nxt))
    return f
seen = set()
for op, h in enumerate(handlers):
    if h in seen: continue            # 460A shared by 0/5/15
    seen.add(h); e.hook(4, h, mk(op))
for f in range(N):
    if "--press" in sys.argv and f % 60 == 10: e.pb.button_press("a")
    if "--press" in sys.argv and f % 60 == 16: e.pb.button_release("a")
    e.run(1)
e.stop()
ops = collections.Counter(op for _, _, op, _, _, _ in log)
print("opcode counts:", dict(sorted(ops.items())))
skip = set(int(x) for x in sys.argv[sys.argv.index("--skip") + 1].split(",")) if "--skip" in sys.argv else set()
last = None; shown = 0
for fr, slot, op, bank, de, nxt in log:
    if op in skip: continue
    key = (slot, op, de)
    if key == last: continue
    shown += 1
    if shown > 160: break
    last = key
    print("f%5d slot %04x op %2d  %02x:%04x  %s" % (fr, slot, op, bank, de, nxt))
