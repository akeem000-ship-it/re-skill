"""Dump the animation scripts of a character sprite bank (REVERSE.md "Sprites").

Header +6 = table of word pointers (one per animation id, SetAnimation 08:69EA D = id). Script =
2-byte entries read by 08:7791: [frame, duration] when frame < $F0; [$FF, off] restart at
anim start + off; [$FE, id] switch to animation id; [$FB, m] OAM attribute ^= m (flip);
any other $Fx = hold the current frame forever.
usage: dump_anims.py BANK [--header ADDR]     (header defaults to [bank:$4000])
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

rom = load_rom()
u8 = lambda b, a: rom[to_offset(b, a)]
u16 = lambda b, a: u8(b, a) | u8(b, a + 1) << 8


def main():
    bank = int(sys.argv[1], 16)
    hdr = int(sys.argv[sys.argv.index("--header") + 1], 16) if "--header" in sys.argv else u16(bank, 0x4000)
    tab = u16(bank, hdr + 6)
    ptrs = []; a = tab
    while not ptrs or a < min(ptrs):
        p = u16(bank, a)
        if not (0x4000 <= p < 0x8000): break
        ptrs.append(p); a += 2
    print("bank %02x header %04x anim table %04x: %d animations" % (bank, hdr, tab, len(ptrs)))
    for i, p in enumerate(ptrs):
        out = []; q = p
        for _ in range(64):
            f, d = u8(bank, q), u8(bank, q + 1); q += 2
            if f < 0xF0: out.append("%d:%d" % (f, d)); continue
            if f == 0xFF: out.append("loop@+%d" % d)
            elif f == 0xFE: out.append("-> anim %d" % d)
            elif f == 0xFB: out.append("flip^%02x" % d); continue
            else: out.append("hold")
            break
        print("  anim %3d @%04x  %s" % (i, p, " ".join(out)))


if __name__ == "__main__":
    main()
