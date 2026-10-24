"""Find ball-state changes made outside BallTask: compare the state at BallTask's exit (10:4D85) with the
state at the next BallTask entry (10:4D45), and log the routines running in between.

usage: emu_between.py FRAMES [--state FILE] [--press FRAME:BUTTON ...] [--watch BB:AAAA ...]
  --watch addresses are reported when executed between an exit and a changed entry.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def main():
    a = sys.argv[1:]
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    watch = []
    if "--watch" in a:
        for p in a[a.index("--watch") + 1:]:
            if p.startswith("--"):
                break
            watch.append(tuple(int(x, 16) for x in p.split(":")))
    e = Emu()
    e.load(state)
    st = {"exit": None, "seen": []}
    cur = [0]

    def entry(emu):
        d = emu.wram(6, 0xD400, 0x16)
        if st["exit"] is not None and d != st["exit"]:
            diff = [i for i in range(0x16) if d[i] != st["exit"][i]]
            print("%5d changed outside BallTask at %s; ran: %s" % (cur[0], " ".join("$%04x" % (0xD400 + i) for i in diff),
                  " ".join("%02x:%04x" % w for w in st["seen"]) or "-"))
        st["seen"] = []

    def exit_(emu):
        st["exit"] = emu.wram(6, 0xD400, 0x16)
        st["seen"] = []
    e.hook(0x10, 0x4D45, entry)
    e.hook(0x10, 0x4D85, exit_)
    for w in watch:
        e.hook(w[0], w[1], lambda emu, w=w: st["seen"].append(w) if w not in st["seen"] else None)

    def each(f):
        cur[0] = f
    run_script(e, int(a[0]), parse_presses(a), each=each)
    e.stop()


if __name__ == "__main__":
    main()
