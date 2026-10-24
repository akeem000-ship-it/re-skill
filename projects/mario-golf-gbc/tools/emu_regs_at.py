"""Print the registers each time the game executes BB:AAAA (optionally only in a frame range).

usage: emu_regs_at.py BB:AAAA [BB:AAAA ...] [--from F] [--to F] [--state FILE] [--press FRAME:BUTTON ...]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def main():
    a = sys.argv[1:]
    pts = [tuple(int(x, 16) for x in p.split(":")) for p in a if ":" in p and not p[0].isdigit() or (":" in p and len(p.split(":")[0]) == 2 and not p.split(":")[1].isalpha() and len(p) == 7)]
    f0 = int(a[a.index("--from") + 1]) if "--from" in a else 0
    f1 = int(a[a.index("--to") + 1]) if "--to" in a else 10 ** 9
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    e = Emu()
    e.load(state)
    cur = [0]
    for bank, addr in pts:
        def hit(emu, bank=bank, addr=addr):
            if f0 <= cur[0] <= f1:
                r = emu.regs()
                print("%5d %02x:%04x A=%02x F=%02x BC=%02x%02x DE=%02x%02x HL=%04x SP=%04x" % (
                    cur[0], bank, addr, r["A"], r["F"], r["B"], r["C"], r["D"], r["E"], r["HL"], r["SP"]))
        e.hook(bank, addr, hit)

    def each(f):
        cur[0] = f
    run_script(e, f1 + 1 if f1 < 10 ** 9 else 600, parse_presses(a), each=each)
    e.stop()


if __name__ == "__main__":
    main()
