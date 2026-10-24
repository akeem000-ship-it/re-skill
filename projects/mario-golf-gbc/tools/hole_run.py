"""Play a recorded hole in Python (tools/hole_py.py between the shots, tools/shot_py.py for each shot) and
compare with the game: every event of every shot, from each address step on, and the state at each address
step after the first. Record the hole with emu_shot_record.py --from-address (every address step is an A event).

At an address step the display state that depends on how long the menus took (the golfer's idle animation,
the landing preview, the target marker) is taken from the recording: those bytes are reset or rebuilt before
they matter (the preview and the marker at 10:56E7, the animation at the swing).
usage: hole_run.py RECORDING.json
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import ball_sim as bs
import shot_py as sp
import hole_py as hp
from shot_sim import event_diff

# synced at an address step: the golfer's idle animation, the landing preview, and the target marker (the menu
# keeps moving it while it waits; on the course it ends at the club's distance, on the green it does not: the
# address step redraws it at 10:56E7 before anything reads it)
DISPLAY = [(6, 0x462, 0x468), (6, 0x373, 0x383), (6, 0x480, 0x481), (6, 0x513, 0x514), (6, 0x426, 0x42A)]


class Mismatch(Exception):
    pass


def main():
    rec = json.load(open(sys.argv[1]))
    ev, joy = rec["events"], rec.get("joy", {})
    w = Machine(load_rom())
    w.load_snapshot(rec["snapshot"])
    hole = bs.Hole(w.wram[6][0x320])
    pos = [0]
    report = []

    def check(kind):
        e = ev[pos[0]]
        if e[0] != kind:
            raise Mismatch("event %d: game had %s (frame %d), Python reached %s" % (pos[0], e[0], e[1], kind))
        d = event_diff(w, e)
        if d:
            raise Mismatch("event %d (%s, frame %d): differs at %s\n" % (pos[0], kind, e[1], " ".join("$%04x" % x[0] for x in d[:24]))
                           + "\n".join("   $%04x py %02x game %02x" % x for x in d[:8]))
        if kind == "F" and str(pos[0]) in joy:
            w.high[0x190:0x195] = bytes(joy[str(pos[0])])
        pos[0] += 1

    n = 0
    try:
        check(ev[0][0])
        while True:
            n += 1
            shot = sp.Shot(w, hole, check)
            first = ev[pos[0] - 1][0]
            if first in "Aa":
                a = shot.from_address(entered=first == "a")
            elif first == "L":                      # a recording made --hole from a ball in flight
                a = shot.main_loop(entered=True)
            else:
                a = shot.flight_cam(ev[pos[0] - 1][4][3])
            out = hp.post_shot(w, a)
            report.append("shot %d: outcome $%02x" % (n, out))
            if hp.shot_loop_end(w, out):
                report.append("hole done: %d strokes, %d putts, points $%04x" % (w.wram[0][hp.pf(w, 0x20)],
                              w.wram[0][hp.pf(w, 0x21)], w.wram[0][0x83C] | w.wram[0][0x83D] << 8))
                last = ev[-1]                           # the round and player records at the recording's end
                want = bytes.fromhex(last[5])
                d = [0xC800 + k for k in range(0x100) if want[k] != w.wram[0][0x800 + k]]
                report.append("  records ($C800-$C8FF) at the end: %s" % ("match" if not d else
                              "differ at " + " ".join("$%04x py %02x game %02x" % (a, w.wram[0][a - 0xC000], want[a - 0xC800]) for a in d)))
                break
            hp.next_player(w)
            hp.shot_setup(w, hole)
            nxt = next((i for i in range(pos[0], len(ev)) if ev[i][0] == "A"), None)
            if nxt is None:
                report.append("recording ends before shot %d" % (n + 1))
                break
            e = ev[nxt]
            want6 = bytes.fromhex(e[2])
            pages = {0x300: bytes.fromhex(e[6]), 0x400: bytes.fromhex(e[2]), 0x500: bytes.fromhex(e[7])}
            for bank, lo, hi in DISPLAY:                # display state: taken from the game
                w.wram[6][lo:hi] = pages[lo & 0xF00][lo & 0xFF:(lo & 0xFF) + hi - lo]
            pos[0] = nxt
            if "--diff" in sys.argv:
                for x in event_diff(w, e):
                    print("   $%04x py %02x game %02x" % x)
            check("A")
            report.append("  address of shot %d: state matches" % (n + 1))
    except Mismatch as x:
        report.append(str(x))
    print("\n".join(report))
    print("%d events matched (%d recorded)" % (pos[0], len(ev)))


if __name__ == "__main__":
    main()
