"""Call a ROM routine inside PyBoy with chosen registers and read back the result.

The game is stopped at a quiet point (AdvanceFrame 00:2E3B of the given state), the registers are set,
a return address pointing at 00:3101 (unused $FF fill, hooked) is pushed, and PC jumps to the routine
(ROM bank switched for banked routines). The hook at 00:3101 records the registers and memory reads.
Each call reloads the state, so calls are independent.

As a module:  fn = Caller(state); out = fn.call(bank, addr, a=.., bc=.., de=.., hl=.., f=.., mem={addr: byte},
                  read=[(addr, n)], wram=6)
              out -> dict(A, F, B, C, D, E, H, L, BC, DE, HL, mem=[bytes])
usage: emu_callfn.py BB:AAAA a=XX hl=XXXX de=XXXX bc=XXXX [state]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

TRAP = 0x3101
STATE = "states/stroke_hole1.state"


class Caller:
    def __init__(self, state=STATE):
        self.state = state
        self.e = Emu()
        self.e.load(state)
        self.req = None
        self.res = None
        self.e.hook(0x00, 0x2E3B, self._start)
        self.e.hook(0x00, TRAP, self._trap)

    def _start(self, emu):
        if self.req is None or self.res is not None or self.req.get("started"):
            return
        r = self.req
        r["started"] = True
        pb = emu.pb
        rf = pb.register_file
        if r.get("wram"):
            pb.memory[0xFF70] = r["wram"]
            pb.memory[0xFF96] = r["wram"]
        for a, v in r.get("mem", {}).items():
            pb.memory[a] = v
        sp = rf.SP - 2
        pb.memory[sp] = TRAP & 0xFF
        pb.memory[sp + 1] = TRAP >> 8
        rf.SP = sp
        rf.A = r.get("a", 0)
        rf.F = r.get("f", 0)
        bc, de, hl = r.get("bc", 0), r.get("de", 0), r.get("hl", 0)
        rf.B, rf.C, rf.D, rf.E = bc >> 8, bc & 0xFF, de >> 8, de & 0xFF
        rf.HL = hl
        if r["bank"]:
            pb.memory[0xFF95] = r["bank"]
            pb.memory[0x2000] = r["bank"]
        rf.PC = r["addr"]

    def _trap(self, emu):
        if self.req is None or self.res is not None or not self.req.get("started"):
            return
        rf = emu.pb.register_file
        out = dict(A=rf.A, F=rf.F, B=rf.B, C=rf.C, D=rf.D, E=rf.E, H=rf.HL >> 8, L=rf.HL & 0xFF)
        out["BC"], out["DE"], out["HL"] = out["B"] << 8 | out["C"], out["D"] << 8 | out["E"], rf.HL
        out["mem"] = [bytes(emu.pb.memory[a:a + n]) for a, n in self.req.get("read", [])]
        self.res = out

    def call(self, bank, addr, **kw):
        self.e.load(self.state)
        self.req = dict(bank=bank, addr=addr, **kw)
        self.res = None
        for _ in range(4):
            self.e.run(1)
            if self.res is not None:
                break
        if self.res is None:
            raise RuntimeError("routine %02x:%04x did not return within 4 frames" % (bank, addr))
        return self.res

    def stop(self):
        self.e.stop()


def main():
    bank, addr = (int(x, 16) for x in sys.argv[1].split(":"))
    kw = {}
    state = STATE
    for x in sys.argv[2:]:
        if "=" in x:
            k, v = x.split("=")
            kw[k] = int(v, 16)
        else:
            state = x
    c = Caller(state)
    r = c.call(bank, addr, **kw)
    print("A=%02x F=%02x BC=%04x DE=%04x HL=%04x" % (r["A"], r["F"], r["BC"], r["DE"], r["HL"]))
    c.stop()


if __name__ == "__main__":
    main()
