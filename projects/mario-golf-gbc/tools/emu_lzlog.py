"""Log every LZ decompression (00:1F2F) the game does between two frames.

Prints frame, source bank:address, destination (with the WRAM bank for D000-DFFF, the VRAM bank for
8000-9FFF), the decompressed size, and the source's index in its bank's $4000 table if it is an entry.
usage: emu_lzlog.py START END [--state FILE] [--press FRAME:BUTTON ...]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script
from tools.gbrom import load_rom, to_offset
from tools.decompress import decompress
from tools.scan_jumptables import table


def main():
    a = sys.argv[1:]
    start, end = int(a[0]), int(a[1])
    rom = load_rom()
    e = Emu(fresh=True)
    if "--state" in a:
        e.load(a[a.index("--state") + 1])
    frame = {"f": 0}

    def hit(emu):
        if not start <= frame["f"] < end:
            return
        r = emu.regs()
        src, dst = r["HL"], (r["D"] << 8) | r["E"]
        bank = emu.r8(0xFF95) if src >= 0x4000 else 0
        n = len(decompress(rom, to_offset(bank, src))[0])
        where = ""
        if 0xD000 <= dst < 0xE000:
            where = " WRAM%d" % (emu.r8(0xFF70) or 1)
        elif 0x8000 <= dst < 0xA000:
            where = " VRAM%d" % (emu.r8(0xFF4F) & 1)
        idx = ""
        if bank:
            t = table(rom, bank)
            if src in t:
                idx = " (idx $%02x)" % (t.index(src) * 2)
        print("%5d  %02x:%04x%s -> %04x%s  %d bytes" % (frame["f"], bank, src, idx, dst, where, n))

    e.hook(0, 0x1F2F, hit)

    def each(f):
        frame["f"] = f
    run_script(e, end, parse_presses(a), each=each)
    e.stop()


if __name__ == "__main__":
    main()
