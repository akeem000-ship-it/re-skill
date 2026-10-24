"""Record the ball state (WRAM6 $D400-$D45F) and the wind ($C815/$C816) at every BallTask (10:4D45) entry.

usage: emu_ball_record.py OUT.json FRAMES [--state FILE] [--press FRAME:BUTTON ...]
  default state states/stroke_hole1.state; output: {"wind": [mph, dir], "frames": [[f, "hex of 96 bytes"], ...]}
  one entry per ball step, so the simulator steps once per entry; f is the frame number
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    e = Emu()
    e.load(state)
    rec, cur = [], [0]

    def task(emu):
        rec.append([cur[0], emu.wram(6, 0xD400, 0x60).hex()])

    def each(f):
        cur[0] = f
    e.hook(0x10, 0x4D45, task)
    run_script(e, frames, parse_presses(a), each=each)
    json.dump({"wind": [e.r8(0xC815), e.r8(0xC816)], "frames": rec}, open(out, "w"))
    print("%s: %d ball steps, wind %d mph dir $%02x" % (out, len(rec), e.r8(0xC815), e.r8(0xC816)))
    e.stop()


if __name__ == "__main__":
    main()
