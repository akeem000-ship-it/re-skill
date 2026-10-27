"""Check the copies of the sound driver in banks 7C and 7D against bank 7E, routine by routine.

SongStart (7E:4186) maps the song's bank (7C, 7D or 7E) and execution goes on in that bank's copy of the driver,
so the music code runs from all three banks. This tool takes every routine of bank 7E that the code tracer reached
(states/code_entries.json and the labels; extents from states/code_map.json, as tools/coverage.py maps bytes to
routines), decodes it instruction by instruction in 7E and in the copy, and compares them. Instructions must have
the same opcode; a 16-bit operand or jump target in $4000-$7FFF (an address inside the bank) must be the same
offset in the bank, which allows a copy at a shifted address (none is: the copies sit at the same addresses); every
other byte must be equal. It also lists traced entries of 7C / 7D that 7E has not.

usage: sound_copies.py [--cite]   (--cite: print the identical routines as `7C:AAAA 7D:AAAA  Name` lines)
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels, load_rom, BANK_SIZE
from instruction_set import decode

REF = 0x7E
COPIES = (0x7C, 0x7D)


def routines(bank, code, ent, labels):
    starts = sorted(set(ent.get(bank, ())) | {a for (b, a), (n, _) in labels.by.items()
                                              if b == bank and 0x4000 <= a < 0x8000 and n})
    out = {}
    for addr in code.get(bank, ()):
        i = bisect.bisect_right(starts, addr) - 1
        if i >= 0:
            out.setdefault(starts[i], []).append(addr)
    return {a: sorted(v) for a, v in out.items()}


def bank_bytes(rom, b):
    return rom[b * BANK_SIZE:(b + 1) * BANK_SIZE]


def same_routine(rom, ref, cop, addr, extent):
    """Compare the routine at addr (bytes `extent` in bank ref) with the one at the same place in bank cop."""
    x, y = bank_bytes(rom, ref), bank_bytes(rom, cop)
    pcs = set(extent)
    pc = addr
    while pc in pcs:
        i = decode(x, pc - 0x4000, pc)
        j = decode(y, pc - 0x4000, pc)
        if i.raw[0] != j.raw[0] or i.length != j.length:
            return "opcode differs at %04x" % pc
        if i.raw != j.raw:
            vi = i.target if i.target is not None else (i.operand[1] if i.operand else None)
            vj = j.target if j.target is not None else (j.operand[1] if j.operand else None)
            if not (i.length == 3 and vi is not None and vj is not None and 0x4000 <= vi < 0x8000
                    and 0x4000 <= vj < 0x8000 and vi - 0x4000 == vj - 0x4000):
                return "operand differs at %04x (%s / %s)" % (pc, i.text, j.text)
        for k in range(pc, pc + i.length):
            pcs.discard(k)
        pc += i.length
        if pc not in pcs and pcs:
            pc = min(pcs)            # the next traced run of this routine (after data or a gap)
    return None


def main():
    rom = load_rom()
    labels = Labels()
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    ref = routines(REF, code, ent, labels)
    cite = "--cite" in sys.argv
    for cop in COPIES:
        mine = routines(cop, code, ent, labels)
        extra = sorted(set(mine) - set(ref))
        bad = 0
        nbytes = 0
        for addr, ext in sorted(ref.items()):
            name = (labels.get(REF, addr) or ("?",))[0]
            if addr not in mine:
                print("%02x:%04x %-28s not traced in %02x" % (REF, addr, name, cop))
                continue
            if set(mine[addr]) != set(ext):
                print("%02x:%04x %-28s traced extent differs in %02x" % (REF, addr, name, cop))
            why = same_routine(rom, REF, cop, addr, ext)
            if why:
                bad += 1
                print("%02x:%04x %-28s DIFFERS in %02x: %s" % (REF, addr, name, cop, why))
            else:
                nbytes += len(mine[addr])
        print("bank %02x: %d routines of 7E compared, %d differ, %d traced bytes identical; entries only in %02x: %s"
              % (cop, len(ref), bad, nbytes, cop, " ".join("%04x" % a for a in extra) or "none"))
    if cite:
        for addr in sorted(ref):
            name = (labels.get(REF, addr) or ("?",))[0]
            print("7C:%04X 7D:%04X  %s" % (addr, addr, name))


if __name__ == "__main__":
    main()
