"""Log every change in memory regions, frame by frame, from a saved state.

usage: emu_watch.py STATE FRAMES ADDR:N [ADDR:N ...] [--press FRAME:BUTTON ...] [--shots N] [--quiet ADDR,...] [--final]
  ADDR:N as in emu_peek.py (Wn:ADDR for a WRAM bank). Frames count from the state. Prints
  "frame addr old->new" for each changed byte; --shots N saves out/watch_FFFF.png every N frames;
  --quiet lists addresses to ignore (counters); --final prints the regions and a screenshot
  (out/watch_final.png) at the end.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def main():
    a = sys.argv[1:]
    state, frames = a[0], int(a[1])
    regions = []
    for x in a[2:]:
        if x.startswith("--"):
            break
        wb = None
        if x.startswith("W"):
            wb, x = x[1:].split(":", 1)
            wb = int(wb)
        addr, n = x.split(":")
        regions.append((wb, int(addr, 16), int(n, 0)))
    quiet = set()
    if "--quiet" in a:
        quiet = {int(q, 16) for q in a[a.index("--quiet") + 1].split(",")}
    shots = int(a[a.index("--shots") + 1]) if "--shots" in a else 0
    presses = parse_presses(a)
    e = Emu()
    e.load(state)

    def read():
        out = {}
        for wb, addr, n in regions:
            d = e.wram(wb, addr, n) if wb else bytes(e.mem[addr:addr + n])
            if isinstance(d, int):
                d = bytes([d])
            for i, v in enumerate(d):
                out[(wb, addr + i)] = v
        return out

    prev = read()

    def each(f):
        nonlocal prev
        cur = read()
        ch = ["%s%04x %02x->%02x" % ("W%d:" % k[0] if k[0] else "", k[1], prev[k], v)
              for k, v in cur.items() if v != prev[k] and k[1] not in quiet]
        if ch:
            print("%5d  %s" % (f, "  ".join(ch)))
        prev = cur
        if shots and f % shots == 0:
            e.shot("out/watch_%04d.png" % f)

    run_script(e, frames, presses, each=each)
    if "--final" in a:
        for (wb, addr), v in sorted(read().items(), key=lambda kv: kv[0][1]):
            print("final %s%04x %02x" % ("W%d:" % wb if wb else "", addr, v))
        e.shot("out/watch_final.png")
    e.stop()


if __name__ == "__main__":
    main()
