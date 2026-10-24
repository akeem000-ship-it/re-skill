"""Find which hole assets are in WRAM during the putting view (or any state).

For WRAM2 $D000, WRAM3 $D000, WRAM6 $D700 and WRAM6 $D800 / WRAM1 $D800, prints the HoleAssetTable entries
(ref 0-4, entries 0-5 of the current hole) whose decompressed bytes equal the memory there.
usage: emu_green_check.py STATE
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.gbrom import load_rom
from tools.render_hole import rows, asset


def main():
    rom = load_rom()
    e = Emu()
    e.load(sys.argv[1])
    e.run(1)
    hid = e.wram(6, 0xD320)
    row = rows(rom)[hid]
    print("hole $%02x  d441-d443 %s  hFFB0 %02x" % (hid, e.wram(6, 0xD441, 3).hex(), e.r8(0xFFB0)))
    cands = {}
    for r in range(5):
        for n in range(6):
            try:
                cands["ref%d[%d]" % (r, n)] = asset(rom, row[r], n)
            except Exception:
                pass
    for wb, addr, n in ((2, 0xD000, 0x1000), (3, 0xD000, 0x1000), (6, 0xD700, 0x100), (6, 0xD800, 0x800), (1, 0xD800, 0x800)):
        got = e.wram(wb, addr, n)
        hits = [k for k, d in cands.items() if len(d) >= 0x40 and got[:min(len(d), n)] == d[:min(len(d), n)]]
        print("WRAM%d %04x: %s" % (wb, addr, ", ".join(hits) or "no match"))
    e.stop()


if __name__ == "__main__":
    main()
