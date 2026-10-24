"""Record shot launches for tools/test_launch.py: at each ShotLaunch entry (10:5F94) a full RAM snapshot, and at
its return (10:49A3) WRAM6 $D300-$D5FF and WRAM0 $C800-$CAFF.

usage: emu_launch_record.py OUT.json FRAMES [--state FILE] [--press FRAME:BUTTON ...]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script
from tools.emu_shot_record import snapshot


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    e = Emu()
    e.load(state)
    launches = []

    def enter(emu):
        launches.append({"snapshot": snapshot(emu), "sp": emu.regs()["SP"]})

    def leave(emu):
        if launches and "after" not in launches[-1]:
            launches[-1]["after"] = {"d300": emu.wram(6, 0xD300, 0x300).hex(),
                                     "c800": bytes(emu.pb.memory[0xC800:0xCB00]).hex()}
    e.hook(0x10, 0x5F94, enter)
    e.hook(0x10, 0x49A3, leave)
    run_script(e, frames, parse_presses(a))
    json.dump(launches, open(out, "w"))
    print("%s: %d launches" % (out, len(launches)))
    e.stop()


if __name__ == "__main__":
    main()
