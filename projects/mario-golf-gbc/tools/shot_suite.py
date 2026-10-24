"""Record and replay the shot test set: every case is a saved state (optionally poked), a button script and the
loop outcome the game gave. Each case is recorded with emu_shot_record.py (out/suite_<name>.json) and replayed
with shot_sim.py in both modes (ROM only, and with the Python ports).

States come from tools/emu_script.py (stroke_hole1) and emu_mkstate.py runs from it; they are not committed.
usage: shot_suite.py [NAME ...] [--replay-only]
"""
import sys, os, subprocess, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SWING = ["60:a", "100:a", "180:a"]     # a button script that swings from an aiming state

# name: (state, pokes for emu_poke_state.py or None, frames, presses, expected outcome)
CASES = {
    # full swings, launch to rest
    "h1_tee":         ("stroke_hole1", None, 1500, SWING, 0x00),
    "h1_shot2":       ("h1_shot2", None, 1500, SWING, 0x00),
    "h1_shot3":       ("h1_shot3", None, 1500, SWING, 0x00),
    "h1_shot4":       ("h1_shot4", None, 1500, SWING, 0x06),
    "h1_bunker":      ("h1_bunker", None, 1500, SWING, 0x00),
    "h1_inbunker":    ("h1_inbunker", None, 1500, SWING, 0x00),
    "sand_semi":      ("h1_inbunker", None, 1500, ["60:a", "100:a", "130:a", "215:a"], 0x09),
    "sand_to_sand":   ("h1_inbunker", None, 1500, ["60:a", "100:a", "145:a", "220:a"], 0x02),
    "h2_tee":         ("h2_tee", None, 1500, SWING, 0x01),
    # putts from 3.6 ft: a miss and three that hole out
    "putt_miss":      ("h1_shot5", None, 900, ["10:a", "40:a", "70:a"], 0x06),
    "putt_17_109":    ("h1_shot5", None, 700, ["10:a", "17:a", "109:a"], 0x80),
    "putt_23_107":    ("h1_shot5", None, 700, ["10:a", "23:a", "107:a"], 0x80),
    "putt_26_109":    ("h1_shot5", None, 700, ["10:a", "26:a", "109:a"], 0x80),
    # balls already moving
    "cupview":        ("h1_cupview", None, 900, [], 0x80),
    "chipfall":       ("h1_chipfall", None, 900, [], 0x06),
    "h1_rolling":     ("h1_rolling", None, 900, [], 0x09),
    "rollbunker":     ("h1_rollbunker", None, 900, [], 0x02),
    "h2_flight":      ("h2_flight", None, 900, [], 0x00),
    "h2_rolling":     ("h2_rolling", None, 400, [], 0x00),
    "overwater":      ("h2_overwater", None, 300, [], 0x03),      # skips twice, then rolls in
    "bunker_land":    ("h1_plug", None, 140, [], 0x02),           # too flat to plug
    # poked: no horizontal speed, so the landing is vertical
    "plug_0000":      ("h1_plug", ["W6:D409=00000000"], 140, [], 0x02),
    "plug_0200":      ("h1_plug", ["W6:D409=00020000"], 140, [], 0x02),
    "water_stop":     ("h2_overwater", ["W6:D406=003000000000000000"], 300, [], 0x03),
}


def run(args):
    return subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True).stdout.strip()


def main():
    a = sys.argv[1:]
    names = [x for x in a if not x.startswith("--")] or list(CASES)
    bad = 0
    for name in names:
        state, pokes, frames, presses, want = CASES[name]
        path = "states/%s.state" % state
        if pokes:
            path = "states/suite_%s.state" % name
            run(["tools/emu_poke_state.py", "states/%s.state" % state, path] + pokes + ["--frames", "1"])
        rec = "out/suite_%s.json" % name
        if "--replay-only" not in a or not os.path.exists(os.path.join(HERE, rec)):
            run(["tools/emu_shot_record.py", rec, str(frames), "--state", path] + (["--press"] + presses if presses else []))
        rom = run(["tools/shot_sim.py", rec, "--rom"])
        port = run(["tools/shot_sim.py", rec])
        outs = [re.search(r"a = \$(..)", r) for r in (rom, port)]
        ok = all(outs) and outs[0].group(1) == outs[1].group(1) and "differs" not in rom + port and \
            (want is None or int(outs[0].group(1), 16) == want)
        bad += not ok
        print("%-12s %s  %s" % (name, "ok  " if ok else "FAIL", port.replace("\n", " / ")))
    print("%d of %d cases ok" % (len(names) - bad, len(names)))


if __name__ == "__main__":
    main()
