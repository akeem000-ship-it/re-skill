"""Dump the Mario Tour field scenes (REVERSE.md "Field scenes").

Location table 0A:564F: 42 x 6 bytes [area, map, idx, bank, music, 0]; the scene descriptor is
[bank:$4000+idx] -> 7 words copied to wC286: entries, exits, actors, talk, w4, step, init.
Event records (8 B): [id, facing mask ($FF any), cond(2), handler(2), p6, p7]
  cond: 0 always; flag n -> active while flag n is clear; $8000|n -> active while n is set.
  handler: 0 none; < $4000 -> message id (dialogue 05:581F); else code in the scene bank (0A:40D0).
  exits: p6 = destination area, p7 = destination entry id.  talk: p6 = flags (bit0 face player).
Entry records (8 B): [id, facing, X(2), Y(2), init hook(2)], $FF ends.
Actor records (14 B): [cond(2), script(2), X(2), Y(2), facing, end($FF), sprite, anim, attr, 0].
usage: dump_scenes.py [area ...] [--out FILE]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels

rom = load_rom(); labels = Labels()
u8 = lambda b, a: rom[to_offset(b, a)]
u16 = lambda b, a: u8(b, a) | u8(b, a + 1) << 8


def flag(c):
    if c == 0: return "always"
    n = ((c >> 8) & 0x7F) * 8 + ((c >> 5) & 7)
    return ("if flag#%d" if c & 0x8000 else "unless flag#%d") % n


def handler(bank, h):
    if h == 0: return "-"
    if h < 0x4000: return "msg #%d" % h
    nm = labels.name(bank, h)
    return "code %02x:%04x%s" % (bank, h, " " + nm if nm else "")


def events(bank, ptr, kind):
    out = []
    while ptr and u8(bank, ptr) != 0xFF and len(out) < 64:
        r = [u8(bank, ptr + i) for i in range(8)]
        cond, h = r[2] | r[3] << 8, r[4] | r[5] << 8
        face = "any" if r[1] == 0xFF else "mask %02x" % r[1]
        extra = ("-> area %02x entry %02x" % (r[6], r[7])) if kind == "exit" else ("p6=%02x p7=%02x" % (r[6], r[7]))
        out.append("    %-5s id %02x  face %-7s %-15s %-28s %s" % (kind, r[0], face, flag(cond), handler(bank, h), extra))
        ptr += 8
    return out


def main():
    args = sys.argv[1:]
    if "--out" in args:
        i = args.index("--out"); sys.stdout = open(args[i + 1], "w"); del args[i:i + 2]
    areas = [int(x, 16) for x in args] or range(42)
    for area in areas:
        rec = [u8(0x0A, 0x564F + area * 6 + i) for i in range(6)]
        _, mp, idx, bank, music, _ = rec
        d = u16(bank, 0x4000 + idx)
        w = [u16(bank, d + 2 * i) for i in range(7)]
        print("area %02x  map %02x  music %s  descriptor %02x:%04x" % (area, mp, "-" if music == 0xFF else "$%02x" % music, bank, d))
        p = w[0]
        while u8(bank, p) != 0xFF:
            r = [u8(bank, p + i) for i in range(8)]
            print("    entry id %02x  pos (%04x,%04x) facing %02x  init %s" % (
                r[0], r[2] | r[3] << 8, r[4] | r[5] << 8, r[1], handler(bank, r[6] | r[7] << 8)))
            p += 8
        for line in events(bank, w[1], "exit"): print(line)
        p = w[2]
        while u8(bank, p + 9) != 0xFF:
            r = [u8(bank, p + i) for i in range(14)]
            print("    actor  script %02x:%04x  pos (%04x,%04x) facing %02x sprite %02x anim %02x attr %02x  %s" % (
                bank, r[2] | r[3] << 8, r[4] | r[5] << 8, r[6] | r[7] << 8, r[8], r[10], r[11], r[12], flag(r[0] | r[1] << 8)))
            p += 14
        for line in events(bank, w[3], "talk"): print(line)
        for line in events(bank, w[4], "w4"): print(line)
        for line in events(bank, w[5], "step"): print(line)
        print("    init   %s" % handler(bank, w[6]))


if __name__ == "__main__":
    main()
