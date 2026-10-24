"""Shared button scripts and state handling for the emu_* tools.

parse_presses(args) -> {frame: button} from "--press FRAME:BUTTON ..."
run_script(emu, frames, presses, start=0)  plays the script (each press held 6 frames)
STROKE_HOLE1: boot -> Mario -> Play Modes -> Stroke -> hole 1 (aiming), reached by frame ~4400.
make_state(): writes states/stroke_hole1.state (frame 4500 of STROKE_HOLE1) for tools that take --state.
usage: emu_script.py   (writes states/stroke_hole1.state)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

STROKE_HOLE1 = {3000: "start", 3300: "a", 3400: "right", 3430: "right", 3460: "right", 3490: "right",
                3550: "a", 3800: "a", 4100: "a"}
STATE = "states/stroke_hole1.state"


def parse_presses(args):
    presses = {}
    if "--press" in args:
        for p in args[args.index("--press") + 1:]:
            if p.startswith("--"):
                break
            f, b = p.split(":")
            presses[int(f)] = b
    return presses


def run_script(e, frames, presses, start=0, each=None):
    for f in range(start, start + frames):
        if f in presses:
            e.pb.button_press(presses[f])
        if f - 6 in presses:
            e.pb.button_release(presses[f - 6])
        if each:
            each(f)
        e.run(1)


def make_state():
    e = Emu(fresh=True)
    run_script(e, 4500, STROKE_HOLE1)
    e.save(STATE)
    e.stop()
    print(STATE)


if __name__ == "__main__":
    make_state()
