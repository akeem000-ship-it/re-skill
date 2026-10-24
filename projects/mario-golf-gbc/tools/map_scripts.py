"""List the overworld map scripts: for each map header (MapTable 0A:5188, see dump_maps.py) the enter script
(header +12) and the script word (+4) of each 8-byte talk (+6), object (+8) and trigger (+10) record.
A script word below $2000 is a text id shown as a message; otherwise it is code in the header's bank, run by
MapRunScript (0A:4EFF). For code scripts the text ids loaded into hl before a far call that takes a text
(ShowMessage 05:5D49 `db $46, $05`; 0A:4124 `db $0E, $0A`, which passes hl to SetMessageText 05:5A96) in the
first $200 bytes up to the first ret are printed with their text.

roots(rom) -> [(bank, addr)] of the code scripts (used by trace_code.py).
usage: map_scripts.py [BB]   (only the headers in bank BB)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
from instruction_set import decode
from dump_maps import records, word
from dump_text import strings, render

LISTS = ((6, "talk"), (8, "object"), (10, "trigger"))


def scripts(rom):
    """{(bank, header): (maps, [(kind, record id, script word)])}"""
    out = {}
    for mid, _gfx, idx, mbank, _music, _x in records(rom):
        hdr = word(rom, mbank, 0x4000 + idx)
        if (mbank, hdr) in out:
            out[(mbank, hdr)][0].append(mid)
            continue
        items = [("enter", None, word(rom, mbank, hdr + 12))]
        for f, kind in LISTS:
            o = to_offset(mbank, word(rom, mbank, hdr + f))
            while rom[o] != 0xFF:
                items.append((kind, rom[o], rom[o + 4] | rom[o + 5] << 8))
                o += 8
        out[(mbank, hdr)] = ([mid], items)
    return out


def roots(rom):
    return sorted({(b, s) for (b, _h), (_m, items) in scripts(rom).items() for _k, _i, s in items
                   if 0x4000 <= s < 0x8000})


def texts_shown(rom, bank, addr):
    """Text ids put in hl before a ShowMessage far call, from addr up to the first ret (max $200 bytes)."""
    found, hl, pc = [], None, addr
    while pc < min(addr + 0x200, 0x7FFD):
        ins = decode(rom, to_offset(bank, pc), pc)
        if ins.raw[0] == 0x21:
            hl = ins.raw[1] | ins.raw[2] << 8
        if ins.raw[0] == 0xDF:
            o = to_offset(bank, pc + 1)
            if rom[o:o + 2] in (bytes((0x46, 0x05)), bytes((0x0E, 0x0A))) and hl is not None and hl < 0x2000:
                found.append(hl)
            pc += 3
            continue
        if ins.kind == "ret" and ins.cond is None:
            break
        pc += ins.length
    return found


def main():
    rom = load_rom()
    only = int(sys.argv[1], 16) if len(sys.argv) > 1 else None
    text = {}
    for b in range(0x18, 0x20):
        for i, s in strings(rom, b):
            text[((b - 0x18) << 10) | i] = render(s[:-1])
    for (bank, hdr), (maps, items) in sorted(scripts(rom).items()):
        if only is not None and bank != only:
            continue
        print("header %02x:%04x  maps %s" % (bank, hdr, " ".join("%02x" % m for m in maps)))
        for kind, rid, s in items:
            who = kind if rid is None else "%s %02x" % (kind, rid)
            if s < 0x2000:
                print("  %-10s text %04X  %s" % (who, s, text.get(s, "?")[:70]))
            elif 0x4000 <= s < 0x8000:
                ts = texts_shown(rom, bank, s)
                print("  %-10s code %02x:%04x  %s" % (who, bank, s, " | ".join(
                    "%04X %s" % (t, text.get(t, "?")[:40]) for t in ts[:3])))
            else:
                print("  %-10s ? %04x" % (who, s))


if __name__ == "__main__":
    main()
