"""Run a button script and dump memory at chosen frames.

usage: emu_peek.py FRAME ADDR:N [ADDR:N ...] [--press FRAME:BUTTON ...] [--shot]
  ADDR is CPU hex (C000-DFFF reads the current WRAM bank mapping; Wn:ADDR reads WRAM bank n).
  --shot also saves out/peek_FRAME.png.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    a = sys.argv[1:]
    frame = int(a[0])
    regions = []
    for x in a[1:]:
        if x.startswith("--"):
            break
        wb = None
        if x.startswith("W"):
            wb, x = x[1:].split(":", 1)
            wb = int(wb)
        addr, n = x.split(":")
        regions.append((wb, int(addr, 16), int(n, 0)))
    presses = {}
    if "--press" in a:
        for p in a[a.index("--press") + 1:]:
            if p.startswith("--"):
                break
            f, b = p.split(":")
            presses[int(f)] = b
    e = Emu(fresh=True)
    for f in range(frame):
        if f in presses:
            e.pb.button_press(presses[f])
        if f - 6 in presses:
            e.pb.button_release(presses[f - 6])
        e.run(1)
    for wb, addr, n in regions:
        data = e.wram(wb, addr, n) if wb else bytes(e.mem[addr:addr + n])
        if isinstance(data, int):
            data = bytes([data])
        for i in range(0, n, 16):
            print("%s%04x: %s" % ("W%d:" % wb if wb else "", addr + i, " ".join("%02x" % b for b in data[i:i + 16])))
    if "--shot" in a:
        print(e.shot("out/peek_%05d.png" % frame))
    e.stop()


if __name__ == "__main__":
    main()
