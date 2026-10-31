"""Decode Mario Golf's battery save (SRAM): header, checksum, backup and the block directory.

Read from bank 02 (SaveLoad 02:41F6, SaveCommit 02:41C1, SaveBlockLoad 02:4355, SaveBlockEntry 02:428A):
  $A020 "CAMELOT GAMEBOY" + $00   $A030 sum of $A032-$A1BF (16 bit)   $B620-$B7BF backup of $A020-$A1BF
  $A040 + 32 n: block n = [used, SRAM bank, offset from $A000 (word), length (word), sum (word), ...]
usage: dump_save.py FILE.sav | --state STATE
  (--state reads the SRAM of a PyBoy save state; FILE is a raw 8 KiB SRAM image)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load(args):
    if args[0] == "--state":
        from tools.emu.session import Emu
        e = Emu()
        e.load(args[1])
        e.run(1)
        data = bytes(e.sram(0, 0xA000 + i) for i in range(0x2000))
        e.stop()
        return data
    return open(args[0], "rb").read()[:0x2000]


def w(d, a):
    return d[a - 0xA000] | d[a - 0xA000 + 1] << 8


def main():
    d = load(sys.argv[1:])
    sig = d[0x20:0x30]
    s = sum(d[0x32:0x1C0]) & 0xFFFF
    print("signature %r  checksum stored %04x computed %04x %s" % (
        bytes(sig).split(b"\0")[0].decode("ascii", "replace"), w(d, 0xA030), s, "OK" if s == w(d, 0xA030) else "BAD"))
    print("backup %s" % ("= main" if d[0x1620:0x17C0] == d[0x20:0x1C0] else "differs"))
    for n in range(12):
        e = 0x40 + 32 * n
        used, bank, off, ln, cs = d[e], d[e + 1], w(d, 0xA000 + e + 2), w(d, 0xA000 + e + 4), w(d, 0xA000 + e + 6)
        if not any(d[e:e + 8]):
            continue
        blk = d[off:off + ln] if bank == 0 and off + ln <= 0x2000 else b""
        bs = sum(blk) & 0xFFFF
        print("block %2d  used %02x  bank %d  $%04x  len $%04x  sum %04x%s  extra %s" % (
            n, used, bank, 0xA000 + off, ln, cs, (" (computed %04x)" % bs) if blk else "",
            " ".join("%02x" % b for b in d[e + 8:e + 32]).rstrip(" 0")))


if __name__ == "__main__":
    main()
