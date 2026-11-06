"""Record the hole set-up references for web/tests/golf_hole_setup.mjs with tools/emu_hole_setup.py: from a fresh
boot through the Stroke practice round's menus, with the course, hole and random seed poked in at GolfRound's
entry, to the first address step (A pressed 40 frames into the aiming menu, or at frame 4680 for "h1").
usage: hole_setup_suite.py [NAME ...]
"""
import sys, os, subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CASES = {                                       # name: pokes at GolfRound's entry (none: the round as played)
    "h1": None,
    "c1h5": ["C837=05"], "c2h3": ["C836=02", "C837=03"], "c3h7": ["C836=03", "C837=07"],
    "c4h12": ["C836=04", "C837=0c"], "c5h18": ["C836=05", "C837=12"], "c6h1": ["C836=06", "C837=01"],
    "c8h9": ["C836=08", "C837=09"], "c10h16": ["C836=0a", "C837=10"], "c0h4": ["C836=00", "C837=04"],
    "s1c1h2": ["C836=01", "C837=02", "FFFC=1234"], "s2c2h14": ["C836=02", "C837=0e", "FFFC=beef"],
    "s3c3h9": ["C836=03", "C837=09", "FFFC=0f0f"], "s4c5h1": ["C836=05", "C837=01", "FFFC=7a31"],
    "s5c4h17": ["C836=04", "C837=11", "FFFC=c3d2"], "s6c7h6": ["C836=07", "C837=06", "FFFC=5555"],
    # the aiming menu used: clubs, aim, shot mode, the look at the pin (--menu: frames into the menu)
    "m1clubs": ["--menu", "10:down", "30:down", "50:up", "70:left:40", "130:right:12", "160:b", "180:b"],
    "m2look": ["C836=02", "C837=03", "--menu", "10:select", "200:select", "230:right:70", "320:b"],
    "m3putt": ["C836=00", "C837=04", "--menu", "10:b", "30:b", "50:left:20", "90:b", "110:select"],
    "m4long": ["C836=03", "C837=07", "FFFC=2468", "--menu", "5:left:100", "120:down", "135:down", "150:down", "170:b"],
    # the computer golfer plays player 1 (PlayerField $13 = 1): its aim (10:5978, bank 3C) up to its address step
    "cpu1": ["C893=01"], "cpu2": ["C893=01", "C836=02", "C837=03", "FFFC=1234"], "cpu3": ["C893=01", "C836=05", "C837=12"],
    "cpu4": ["C893=01", "C836=00", "C837=04", "FFFC=beef"],
}


def main():
    names = [x for x in sys.argv[1:] if not x.startswith("--")] or list(CASES)
    for name in names:
        pokes = CASES[name]
        args = ["tools/emu_hole_setup.py", "out/holesetup_%s.json" % name, "9000"] + (["--auto"] + pokes if pokes else [])
        if name.startswith("m1"):
            args[3:3] = []
        out = subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True).stdout.strip()
        print(name, out.splitlines()[-2] if out else "(no output)")


if __name__ == "__main__":
    main()
