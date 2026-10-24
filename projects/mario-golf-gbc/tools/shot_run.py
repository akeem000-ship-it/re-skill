"""Run a recorded shot (tools/emu_shot_record.py) entirely in Python (tools/shot_py.py: BallTask and the shot's
main thread) from the recording's RAM snapshot, and compare the RAM with the game at every recorded event
(AdvanceFrame F, BallTask T, loop passes L / P), as tools/shot_sim.py does. No ROM code runs.

usage: shot_run.py RECORDING.json
       shot_run.py RECORDING.json --free [Wn:ADDR=HEX ...]
  --free: no comparison; change RAM in the snapshot first (e.g. W6:D450=20 for power $20, W6:D329=02 for the
  3-wood, W6:D44F=fe for a late impact; with a recording made --from-launch) and play the shot out in Python:
  prints the frames, where the ball stopped and the outcome.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import ball_sim as bs
import shot_py as sp
from shot_sim import event_diff


class Mismatch(Exception):
    pass


class Finished(Exception):
    pass


def free(rec, pokes):
    w = Machine(load_rom())
    w.load_snapshot(rec["snapshot"])
    for p in pokes:
        k, v = p.split("=")
        bank, addr = (int(k[1], 16), int(k.split(":")[1], 16)) if k[0] == "W" else (0, int(k, 16))
        mem = w.wram[bank] if addr >= 0xD000 else w.wram[0]
        off = addr - (0xD000 if addr >= 0xD000 else 0xC000)
        mem[off:off + len(bytes.fromhex(v))] = bytes.fromhex(v)
    hole = bs.Hole(w.wram[6][0x320])
    frames = [0]

    def ev(kind):
        if kind == "F":
            frames[0] += 1
    shot = sp.Shot(w, hole, ev)
    e = rec["events"][0]
    outcome = shot.launch() if e[0] == "S" else shot.flight_cam(e[4][3]) if e[0] == "P" else shot.main_loop(entered=True)
    s = sp.ball(w)
    names = {0: "fairway", 1: "rough", 2: "bunker", 3: "water", 6: "green", 7: "out of bounds", 9: "semirough", 0x80: "holed"}
    print("%d frames; ball at x %02x%02x.%02x y %02x%02x.%02x; outcome $%02x (%s)" % (
        frames[0], s[2], s[1], s[0], s[5], s[4], s[3], outcome, names.get(outcome, "terrain type")))


def main():
    rec = json.load(open(sys.argv[1]))
    if "--free" in sys.argv:
        return free(rec, [x for x in sys.argv[2:] if "=" in x])
    ev = rec["events"]
    w = Machine(load_rom())             # memory only
    w.load_snapshot(rec["snapshot"])
    hole = bs.Hole(w.wram[6][0x320])
    pos = [0]

    def check(kind):
        if pos[0] >= len(ev):
            raise Finished()
        e = ev[pos[0]]
        if e[0] != kind:
            raise Mismatch("event %d: game had %s (frame %d), Python reached %s" % (pos[0], e[0], e[1], kind))
        diff = event_diff(w, e)
        if diff:
            raise Mismatch("event %d (%s, frame %d): differs at %s\n" % (pos[0], kind, e[1], " ".join("$%04x" % d[0] for d in diff[:24]))
                           + "\n".join("   $%04x py %02x game %02x" % d for d in diff[:8]))
        pos[0] += 1

    shot = sp.Shot(w, hole, check)
    outcome, note = None, ""
    try:
        e = ev[0]
        check(e[0])
        if e[0] == "L":
            outcome = shot.main_loop(entered=True)
        elif e[0] == "S":
            outcome = shot.launch()
        elif e[0] == "P":
            outcome = shot.flight_cam(e[4][3])           # register c: the flight-camera loop's counter
        else:
            raise Mismatch("recording starts with %s" % e[0])
    except Finished:
        note = " (end of recording)"
    except Mismatch as x:
        note = "\n" + str(x)
    print("%d events matched (%d recorded)%s%s" % (pos[0], len(ev), "; outcome $%02x" % outcome if outcome is not None else "", note))


if __name__ == "__main__":
    main()
