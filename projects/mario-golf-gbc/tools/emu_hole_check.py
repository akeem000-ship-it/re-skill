"""Compare the game's memory during a hole with the assets render_hole.py decodes.

Loads a saved state (default states/stroke_hole1.state, overhead view of hole 1), reads wHoleId
(WRAM6 $D320), and checks WRAM3 $D000 (tilemap), WRAM2 $D000 (attributes), WRAM6 $D800 (terrain
table), and which asset entry each 2 KB VRAM tile block (bank 0/1, $8800 and $9000) equals.
usage: emu_hole_check.py [STATE]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.gbrom import load_rom
from tools.render_hole import rows, asset


def main():
    state = sys.argv[1] if len(sys.argv) > 1 else "states/stroke_hole1.state"
    rom = load_rom()
    e = Emu()
    e.load(state)
    e.run(1)
    hid = e.wram(6, 0xD320)
    print("LCDC $%02x" % e.r8(0xFF40))
    row = rows(rom)[hid]
    print("wHoleId $%02x  row %s" % (hid, " ".join("%02x:%02x" % (b, i) for i, b in row[:5])))
    checks = [("tilemap WRAM3 D000", e.wram(3, 0xD000, 0x1000), asset(rom, row[1], 1)),
              ("attrs WRAM2 D000", e.wram(2, 0xD000, 0x1000), asset(rom, row[1], 0)),
              ("terrain WRAM6 D800", e.wram(6, 0xD800, 0x800), asset(rom, row[0], 3))]
    for name, got, want in checks:
        n = min(len(got), len(want))
        diff = sum(1 for i in range(n) if got[i] != want[i])
        print("%-20s %s (%d of %d bytes differ)" % (name, "match" if diff == 0 else "DIFFER", diff, n))
    cands = {}
    for k in (0, 1, 2, 4):
        try:
            d = asset(rom, row[0], k)
        except Exception:
            continue
        for h in range(0, len(d), 0x800):
            cands["ref0[%d]+%04x" % (k, h)] = d[h:h + 0x800]
    for vb in (0, 1):
        for addr in (0x8000, 0x8800, 0x9000):
            got = e.vram(vb, addr, 0x800)
            hit = [name for name, d in cands.items() if d == got[:len(d)] and len(d) >= 0x100]
            best = max(((sum(1 for t in range(min(len(d), 0x800) // 16) if d[t * 16:t * 16 + 16] == got[t * 16:t * 16 + 16]), name)
                        for name, d in cands.items()), default=(0, "-"))
            print("VRAM%d %04x: %s; best tile-for-tile: %s (%d of 128 tiles)" % (
                vb, addr, ", ".join(hit) or "no whole match", best[1], best[0]))
    # tiles of VRAM1 $9000 that differ from ref0[1]: where else do they occur?
    base = asset(rom, row[0], 1)
    got = e.vram(1, 0x9000, 0x800)
    pool = {}
    for name, d in cands.items():
        for t in range(len(d) // 16):
            pool.setdefault(bytes(d[t * 16:t * 16 + 16]), "%s tile %02x" % (name, t))
    for t in range(128):
        if base[t * 16:t * 16 + 16] != got[t * 16:t * 16 + 16]:
            print("  VRAM1 tile %02x differs from ref0[1]; same as: %s" % (t, pool.get(bytes(got[t * 16:t * 16 + 16]), "nothing in ref0")))
    e.stop()


if __name__ == "__main__":
    main()
