"""Targeted SM83 disassembler with labels.csv annotation.

usage: disasm.py <bank> <addr> [nbytes]       e.g. disasm.py 0 0150 64
       (a bank disassembled from $4000 lists its export table as dw first)
       disasm.py <label> [nbytes]
       disasm.py BB:AAAA [nbytes] [--stop]    --stop: stop at first unconditional ret/jp
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels, HW  # noqa: E402
from instruction_set import decode  # noqa: E402


def annotate(ins, bank, labels):
    text = ins.text
    notes = []
    if ins.target is not None:
        n = labels.name(bank, ins.target)
        if n:
            notes.append(n)
    if ins.operand and ins.operand[0] in ("a16", "d16"):
        v = ins.operand[1]
        n = HW.get(v) if ins.operand[0] == "a16" and v < 0x8000 else labels.name(bank, v)
        if n and (ins.operand[0] == "a16" or ins.operand[1] >= 0x4000 or n.startswith("w") or n.startswith("h")):
            notes.append(n)
    return text, notes


INLINE = {0x08: 1, 0x10: 2, 0x18: 2, 0x20: 2, 0x28: 2, 0x30: 2}
FARCALL_INLINE = 0x01F6   # call $01f6 ; db idx, bank


def inline_len(ins):
    if ins.kind == "rst":
        return INLINE.get(ins.target, 0)
    if ins.kind == "call" and ins.target == FARCALL_INLINE:
        return 2
    return 0


def farcall_target(rom, idx, bank):
    """Resolve rst $10/$18 (db idx, bank): jump table at bank:$4000+idx."""
    o = to_offset(bank, 0x4000 + idx) if bank else None
    if o is None or o + 1 >= len(rom):
        return None
    return rom[o] | rom[o + 1] << 8


def describe_inline(rom, ins, data, labels):
    t = ins.target if ins.kind == "rst" else FARCALL_INLINE
    if t in (0x10, 0x18, FARCALL_INLINE):
        idx, bank = data[0], data[1]
        tgt = farcall_target(rom, idx, bank)
        if tgt is None:
            return "db $%02x, $%02x   ; farcall ?" % (idx, bank)
        n = labels.name(bank, tgt)
        return "db $%02x, $%02x   ; farcall -> %02x:%04x%s" % (idx, bank, bank, tgt, (" " + n) if n else "")
    if t == 0x08:
        return "db $%02x        ; sound/cmd id" % data[0]
    w = data[0] | data[1] << 8
    op = {0x20: "set", 0x28: "clear", 0x30: "test"}[t]
    return "dw $%04x      ; %s flag #%d (byte $%02x bit %d)" % (w, op, w >> 5, w >> 8, (w >> 5) & 7)


def disasm(rom, bank, addr, nbytes, labels, stop=False, out=sys.stdout):
    off = to_offset(bank, addr)
    end = off + nbytes
    pc = addr
    if bank and addr == 0x4000:
        # the bank's $4000 export table: list it as data, then disassemble from its end
        from scan_jumptables import table, kind
        ents = table(rom, bank)
        if kind(rom, bank, ents) == "exports":
            for i, w in enumerate(ents):
                n = labels.name(bank, w)
                out.write("%02x:%04x  %02x %02x     dw $%04x              ; idx $%02x%s\n" % (
                    bank, pc, w & 0xFF, w >> 8, w, i * 2, (" " + n) if n else ""))
                off += 2; pc += 2
    while off < end and off < len(rom):
        lab = labels.get(bank, pc)
        if lab and lab[0]:
            out.write("\n%s:%s\n" % (lab[0], ("  ; " + lab[1]) if lab[1] else ""))
        ins = decode(rom, off, pc)
        text, notes = annotate(ins, bank, labels)
        raw = " ".join("%02x" % b for b in ins.raw)
        cmt = ""
        if lab and not lab[0] and lab[1]:
            cmt = lab[1]
        line = "%02x:%04x  %-9s %-22s" % (bank if pc >= 0x4000 else 0, pc, raw, text)
        extra = "; " + ", ".join(notes) if notes else ""
        if cmt:
            extra = (extra + " | " if extra else "; ") + cmt
        out.write((line + extra).rstrip() + "\n")
        off += ins.length
        pc += ins.length
        if ins.kind == "rst" and ins.target == 0x00:
            # rst $00: A-indexed jump table follows inline; control never falls through
            lo, hi = (0x4000, 0x8000) if pc >= 0x4000 else (0x0100, 0x4000)
            for k in range(64):
                w = rom[off] | rom[off + 1] << 8
                if not (lo <= w < hi):
                    break
                n = labels.name(bank, w)
                out.write("%02x:%04x  %02x %02x     dw $%04x              ; [%d]%s\n" % (
                    bank if pc >= 0x4000 else 0, pc, rom[off], rom[off + 1], w, k, (" " + n) if n else ""))
                off += 2; pc += 2
            break
        n = inline_len(ins)
        if n and off + n <= len(rom):
            data = rom[off:off + n]
            out.write("%02x:%04x  %-9s %s\n" % (bank if pc >= 0x4000 else 0, pc,
                      " ".join("%02x" % b for b in data), describe_inline(rom, ins, data, labels)))
            off += n
            pc += n
        if stop and ins.kind in ("ret", "jp") and ins.cond is None:
            break


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    stop = "--stop" in sys.argv
    labels = Labels()
    rom = load_rom()
    if not args:
        print(__doc__)
        return
    if len(args) >= 2 and ":" not in args[0] and args[0] not in labels.names and len(args[0]) <= 2:
        bank, addr = int(args[0], 16), int(args[1], 16)
        rest = args[2:]
    else:
        bank, addr = labels.resolve(args[0])
        if bank is None:
            bank = 0
        rest = args[1:]
    n = int(rest[0], 0) if rest else 0x60
    disasm(rom, bank, addr, n, labels, stop)


if __name__ == "__main__":
    main()
