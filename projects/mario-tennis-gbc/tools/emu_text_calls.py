"""Hook every text bank's GetMsg/GetName export and log (bank, message index DE, caller)
while replaying from a state and pressing A every 90 frames.  Finds the script 'say' opcode.
usage: emu_text_calls.py STATE FRAMES
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
TEXT_BANKS = [0x1F, 0x25, 0x26, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x5E, 0x6E]
e = Emu(); e.load(sys.argv[1]); N = int(sys.argv[2])
log = []
def mk(bank, which):
    def f(em):
        r = em.regs(); sp = r["SP"]
        # FarCallInline frames: return address of the rst $18 caller is deeper in the stack; log both
        stack = [em.mem[sp + i] | em.mem[sp + i + 1] << 8 for i in range(0, 12, 2)]
        log.append((em.pb.frame_count, bank, which, r["D"] << 8 | r["E"], em.mem[0xFF95], stack))
    return f
for b in TEXT_BANKS:
    e.hook(b, 0x4000, mk(b, "msg")); e.hook(b, 0x4002, mk(b, "name"))
for f in range(N):
    if f % 90 == 10: e.pb.button_press("a")
    if f % 90 == 16: e.pb.button_release("a")
    e.run(1)
e.stop()
for fr, b, w, de, rb, st in log[:40]:
    print("frame %5d bank %02x %-4s msg #%-4d  stack %s" % (fr, b, w, de, " ".join("%04x" % x for x in st)))
print(len(log), "calls")
