"""Cross-reference finder: linear decode of each bank, report instructions that
reference ADDR (call/jp/jr/rst targets, ld r16 imm, ld [a16], ldh, farcall inline).

usage: xref.py <addr|BB:AAAA|label|BB AAAA> [bank_filter] [--data]
       xref.py --range LO-HI [bank_filter]   (RAM/SRAM range, e.g. A000-A7FF)
  ROM $4000-7FFF addresses need a bank: refs from other banks only count if the
  bank is the same (or via farcall inline bytes naming that bank).
  --data : also report raw little-endian word matches (pointer tables)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE, Labels
from instruction_set import decode
from disasm import inline_len, farcall_target


def scan(rom, bank):
    base = 0 if bank == 0 else bank * BANK_SIZE
    org = 0 if bank == 0 else 0x4000
    off = 0
    while off < BANK_SIZE:
        ins = decode(rom, base + off, org + off)
        yield ins, base + off
        off += ins.length
        n = inline_len(ins)
        if n:
            yield ("inline", ins, rom[base + off:base + off + n], org + off), base + off
            off += n


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    labels = Labels(); rom = load_rom()
    rng = None
    if "--range" in sys.argv:
        lo, hi = (int(x, 16) for x in sys.argv[sys.argv.index("--range") + 1].split("-"))
        rng = (lo, hi); args = [a for a in args if a != sys.argv[sys.argv.index("--range") + 1]]
        args = ["%04x" % lo] + args
    if len(args) > 1 and len(args[0]) <= 2 and ":" not in args[0]:
        args = ["%s:%s" % (args[0], args[1])] + args[2:]
    tb, ta = labels.resolve(args[0])
    bfilter = int(args[1], 16) if len(args) > 1 else None
    if ta >= 0x4000 and ta < 0x8000 and tb is None:
        tb = bfilter
    rom_target = ta < 0x8000
    hits = 0
    for b in range(nbanks(rom)):
        if bfilter is not None and b != bfilter and b != 0:
            continue
        for ins, off in scan(rom, b):
            if ins[0] == "inline":
                _, rins, data, pc = ins
                if rins.kind == "rst" and rins.target in (0x10, 0x18) or rins.kind == "call":
                    idx, fb = data[0], data[1]
                    if 0 < fb < nbanks(rom):
                        t = farcall_target(rom, idx, fb)
                        if t == ta and (tb is None or fb == tb):
                            print("%02x:%04x  farcall db $%02x,$%02x" % (b, pc - 1, idx, fb)); hits += 1
                continue
            refs = []
            if ins.target is not None:
                refs.append(ins.target)
            if ins.operand and ins.operand[0] in ("a16", "d16"):
                refs.append(ins.operand[1])
            if rng and any(rng[0] <= r <= rng[1] for r in refs) and ins.kind not in ("call", "jp", "jr"):
                nm = labels.name(None, refs[-1]) if hasattr(labels, "name") else None
                print("%02x:%04x  %s" % (b, ins.pc, ins.text)); hits += 1
                continue
            if rng:
                continue
            if ta in refs:
                if rom_target and ta >= 0x4000 and tb not in (None, b) and b != 0:
                    continue
                print("%02x:%04x  %s" % (b, ins.pc, ins.text)); hits += 1
    if "--data" in sys.argv:
        pat = bytes([ta & 0xFF, ta >> 8])
        i = rom.find(pat)
        while i >= 0:
            b = i // BANK_SIZE
            print("data %02x:%04x" % (b, i % BANK_SIZE + (0x4000 if b else 0))); hits += 1
            i = rom.find(pat, i + 1)
    print("%d refs" % hits)


if __name__ == "__main__":
    main()
