"""Play a button script from a saved state and save the result as a new state (and a screenshot).

usage: emu_mkstate.py IN.state OUT.state FRAMES [--press FRAME:BUTTON ...]
  writes OUT.state and out/<OUT name>.png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def main():
    a = sys.argv[1:]
    e = Emu()
    e.load(a[0])
    run_script(e, int(a[2]), parse_presses(a))
    e.save(a[1])
    png = "out/%s.png" % os.path.splitext(os.path.basename(a[1]))[0]
    e.shot(png)
    print(a[1], png)
    e.stop()


if __name__ == "__main__":
    main()
