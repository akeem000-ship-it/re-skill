"""Boot the game in PyBoy and take screenshots, logging map changes.

usage: emu_boot.py [frames] [--every N] [--press FRAME:BUTTON ...]
  Screenshots go to out/boot_FFFFF.png every N frames (default 300). wMapId/wMapEntrance are
  printed whenever they change. Starts without battery RAM (fresh).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    args = [a for a in sys.argv[1:]]
    frames = int(args[0]) if args and not args[0].startswith("--") else 1200
    every = int(args[args.index("--every") + 1]) if "--every" in args else 300
    presses = {}
    if "--press" in args:
        for p in args[args.index("--press") + 1:]:
            if p.startswith("--"):
                break
            f, b = p.split(":")
            presses[int(f)] = b
    e = Emu(fresh=True)
    last = None
    for f in range(frames):
        if f in presses:
            e.pb.button_press(presses[f])
        if f - 6 in presses:
            e.pb.button_release(presses[f - 6])
        e.run(1)
        cur = (e.r8(0xC450), e.r8(0xC46A))
        if cur != last:
            print("frame %5d  wMapId %02x  wMapEntrance %02x" % (f, cur[0], cur[1]))
            last = cur
        if f % every == every - 1:
            print("  " + e.shot("out/boot_%05d.png" % (f + 1)))
    e.stop()


if __name__ == "__main__":
    main()
