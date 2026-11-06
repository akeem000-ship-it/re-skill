"""Find routines not yet rewritten (tools/decomp_progress.py --todo) whose code is a copy of a rewritten one: the
same instruction bytes with switchable-bank addresses ($4000-$7FFF words) masked, as tools/compare_routines.py
compares. For each such routine prints it, its size and the cited routine's address it matches (the copy starts
there; check it with compare_routines.py before citing it).
usage: find_copies.py [MIN_BYTES]   (default 8)
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels, load_rom, to_offset
from instruction_set import decode
import decomp_progress as dp


def norm(rom, bank, addr, n):
    """the instruction stream from bank:addr over n bytes, 16-bit operands in $4000-$7FFF masked"""
    out = []
    off = to_offset(bank, addr)
    pc, end = addr, addr + n
    while pc < end:
        ins = decode(rom, off, pc)
        raw = list(ins.raw)
        if len(raw) == 3 and 0x4000 <= (raw[1] | raw[2] << 8) < 0x8000:
            raw[1] = raw[2] = None
        out.extend(raw)
        off += ins.length
        pc += ins.length
    return tuple(out)


def main():
    mn = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    rom = load_rom()
    tot, done, sizes, labels = dp.measure(dp.cited(dp.sources("all")))
    todo = dp.measure.todo
    # the rewritten routines' traced code: every start address within them as a possible copy start
    code = {int(k): sorted(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    cited_ranges = []
    for (b, a), n in sizes.items():
        cited_ranges.append((b, a, n))
    for (b, a), n in sorted(todo.items(), key=lambda kv: -kv[1]):
        if n < mn:
            continue
        mine = norm(rom, b if a >= 0x4000 else 0, a, n)
        hit = None
        for (cb, ca, cn) in cited_ranges:
            if cn < n:
                continue
            bank = cb if ca >= 0x4000 else 0
            if norm(rom, bank, ca, len(mine) + 4)[:len(mine)] == mine:
                hit = (cb, ca)
                break
        if hit:
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %5d %-32s = %02x:%04x" % (b, a, n, name, hit[0], hit[1]))


if __name__ == "__main__":
    main()
