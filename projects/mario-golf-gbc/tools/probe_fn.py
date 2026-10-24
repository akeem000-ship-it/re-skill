"""Print a ROM routine's outputs for a list of inputs (to guess what it computes).

usage: probe_fn.py BB:AAAA REG=V1,V2,... [REG=...]   (all lists the same length; hex values)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu_callfn import Caller


def main():
    bank, addr = (int(x, 16) for x in sys.argv[1].split(":"))
    cols = {}
    for x in sys.argv[2:]:
        k, v = x.split("=")
        cols[k] = [int(t, 16) for t in v.split(",")]
    n = len(next(iter(cols.values())))
    c = Caller()
    for i in range(n):
        kw = {k: v[i] for k, v in cols.items()}
        o = c.call(bank, addr, **kw)
        print("%s -> A=%02x BC=%04x DE=%04x HL=%04x" % (" ".join("%s=%04x" % kv for kv in kw.items()), o["A"], o["BC"], o["DE"], o["HL"]))
    c.stop()


if __name__ == "__main__":
    main()
