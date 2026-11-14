"""Pick a swing with the Python engine: from a RAM snapshot taken where the golfer addresses the ball
(10:56B0), play candidate swings in Python (shot_py.Shot.from_address with a button script) and keep the one
that ends nearest the cup (holed first; water and out of bounds last).

A swing is (P, I): A 10 frames after the address, A for power P frames later, A for impact I frames after
that (the putter swings at the power press). plan(snapshot) -> ((P, I), outcome, distance).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import ball_sim as bs
import shot_py as sp
import joypad as jp

ROM = load_rom()


class Stop(Exception):
    pass


def swing_presses(p, i, aim=0):
    """Button script for a swing from the address step: aim steps first (Left < 0 < Right, $80 each, at most
    8), then A, power after p frames, impact after i more (the putter swings at the power press)."""
    presses, t = {}, 4
    if aim:
        presses[t] = ("left:%d" if aim < 0 else "right:%d") % abs(aim)
        t += abs(aim) + 2
    presses[t + 6] = "a"
    presses[t + 6 + p] = "a"
    presses[t + 6 + p + i] = "a"
    return presses


def play(snapshot, p, i, limit=4000, aim=0, presses=None):
    w = Machine(ROM)
    w.load_snapshot(snapshot)
    hole = bs.Hole(w.wram[6][0x320])
    if presses is None:
        presses = {10: "a", 10 + p: "a", 10 + p + i: "a"} if not aim else swing_presses(p, i, aim)
    n = [0]

    def ev(kind):
        if kind == "F":
            jp.read_joypad(w.high, jp.held_at(presses, n[0]))
            n[0] += 1
            if n[0] > limit:
                raise Stop()
    try:
        outcome = sp.Shot(w, hole, ev).from_address()
    except Stop:
        return None, None
    s = sp.ball(w)
    dx = bs.rd16(s, 0x01) - bs.rd16(s, 0x3D)
    dy = bs.rd16(s, 0x04) - bs.rd16(s, 0x3F)
    return outcome, (dx * dx + dy * dy) ** 0.5


def score(outcome, d):
    if outcome is None:
        return 1e9
    if outcome == 0x80:
        return -1
    return d + {3: 5000, 7: 5000, 2: 300, 1: 100, 9: 50}.get(outcome, 0)


def plan(snapshot):
    r6 = bytes.fromhex(snapshot["wram6"])
    putter = r6[0x329] == 0x0D
    if putter:
        cands = [(p, 0) for p in range(2, 60)]
    else:
        cands = [(p, p) for p in range(16, 61, 4)] + [(60, i) for i in (58, 62)]
    best = None
    for p, i in cands:
        o, d = play(snapshot, p, i)
        sc = score(o, d)
        if best is None or sc < best[0]:
            best = (sc, (p, i), o, d)
    return best[1], best[2], best[3]


def seek(snapshot, want):
    """A swing (with aim) whose outcome is want, or None."""
    r6 = bytes.fromhex(snapshot["wram6"])
    putter = r6[0x329] == 0x0D
    for aim in (0, -8, 8, -4, 4, -6, 6, -2, 2):
        for p in ((range(4, 60, 4)) if putter else range(16, 61, 4)):
            i = 0 if putter else p
            o, d = play(snapshot, p, i, aim=aim)
            if o == want:
                return (p, i, aim), o, d
    return None
