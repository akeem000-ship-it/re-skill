"""Play a hole in Python only (no emulator): from a recording's first address step (a recording made with
emu_shot_record.py --from-address), every swing is chosen by tools/plan_shot.py (the Python engine run from
the current state), played by shot_py.Shot from its button script, and the hole's rules (hole_py.py) lead to
the next shot. Prints each shot and the scorecard.

usage: play_hole.py RECORDING.json [--max N]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import ball_sim as bs
import shot_py as sp
import hole_py as hp
import plan_shot
import joypad as jp

NAMES = {0: "fairway", 1: "rough", 2: "bunker", 3: "water", 6: "green", 7: "out of bounds", 9: "semirough",
         0x80: "holed"}


def main():
    a = sys.argv[1:]
    rec = json.load(open(a[0]))
    if rec["events"][0][0] not in "Aa":
        sys.exit("the recording must start at an address step (--from-address)")
    w = Machine(load_rom())
    w.load_snapshot(rec["snapshot"])
    hole = bs.Hole(w.wram[6][0x320])
    limit = int(a[a.index("--max") + 1]) if "--max" in a else 15
    entered = rec["events"][0][0] == "a"
    for n in range(1, limit + 1):
        (p, i), o, d = plan_shot.plan(w.snapshot())
        presses = {10: "a", 10 + p: "a", 10 + p + i: "a"}
        f = [0]

        def ev(kind):
            if kind == "F":
                jp.read_joypad(w.high, jp.held_at(presses, f[0]))
                f[0] += 1
        r6 = w.wram[6]
        club, start = r6[0x329], (bs.rd16(r6, 0x401), bs.rd16(r6, 0x404))
        out = hp.post_shot(w, sp.Shot(w, hole, ev).from_address(entered))
        entered = False
        s = sp.ball(w)
        print("shot %d: club %2d, power %2d impact %2d from (%04x, %04x) -> %s, %d frames" % (
            n, club, p, i, start[0], start[1], NAMES.get(out, "terrain $%02x" % out), f[0]))
        if hp.shot_loop_end(w, out):
            w0 = w.wram[0]
            print("holed: %d strokes, %d putts (par %d)" % (w0[hp.pf(w, 0x20)], w0[hp.pf(w, 0x21)], r6[0x325]))
            return
        hp.next_player(w)
        hp.shot_setup(w, hole)
    print("not holed after %d shots" % limit)


if __name__ == "__main__":
    main()
