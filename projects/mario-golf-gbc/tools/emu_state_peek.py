"""Dump memory from a saved state (after one frame).

usage: emu_state_peek.py STATE ADDR:N [ADDR:N ...]     (Wn:ADDR for a WRAM bank, Vn:ADDR for a VRAM bank)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    e = Emu()
    e.load(sys.argv[1])
    e.run(1)
    for x in sys.argv[2:]:
        kind, bank = None, None
        if x[0] in "WV" and ":" in x[1:]:
            kind, rest = x[0], x[1:]
            bank, x = rest.split(":", 1)
            bank = int(bank)
        addr, n = x.split(":")
        addr, n = int(addr, 16), int(n, 0)
        if kind == "W":
            data = e.wram(bank, addr, n)
        elif kind == "V":
            data = e.vram(bank, addr, n)
        else:
            data = bytes(e.mem[addr:addr + n])
        if isinstance(data, int):
            data = bytes([data])
        for i in range(0, n, 16):
            print("%s%04x: %s" % ("%s%d:" % (kind, bank) if kind else "", addr + i, " ".join("%02x" % b for b in data[i:i + 16])))
    e.stop()


if __name__ == "__main__":
    main()
