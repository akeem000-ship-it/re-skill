"""Which traced routines the game's code executed in the screen cases (web/tests/golf_screens_vs_core.mjs run with
COVER=out/scratch/cover.bin, or any test that runs the core: web/tests/golf/cover.mjs; one byte per ROM byte, set when the core
ran an instruction there), and whether a
rewrite cites them. Bytes map to routines as in tools/decomp_progress.py.
usage: cover_report.py [COVERFILE ...] [--todo] [--banks BB,BB]   (--todo: only routines not cited yet; several files are
       OR-merged; --runs BB:AAAA-AAAA: the executed byte runs there)
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels
from decomp_progress import cited, sources


def main():
    args = [a for k, a in enumerate(sys.argv[1:]) if not a.startswith("--") and sys.argv[k] != "--banks"]
    files = args or [os.path.join(ROOT, "out", "scratch", "cover.bin")]
    banks = None
    if "--banks" in sys.argv:
        banks = {int(x, 16) for x in sys.argv[sys.argv.index("--banks") + 1].split(",")}
    cover = bytearray(0x200000)
    for f in files:                            # (several runs: OR-merged)
        for i, v in enumerate(open(f, "rb").read()):
            if v:
                cover[i] = 1
    cites = cited(sources("all"))
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    for b in sorted(code):
        if banks is not None and b not in banks:
            continue
        starts = sorted(ent.get(b, ()))
        size, hit = {}, {}
        for addr in code[b]:
            i = bisect.bisect_right(starts, addr) - 1
            if i < 0:
                continue
            k = starts[i]
            size[k] = size.get(k, 0) + 1
            off = addr if b == 0 else b * 0x4000 + addr - 0x4000
            if cover[off]:
                hit[k] = hit.get(k, 0) + 1
        for k in sorted(hit):
            c = (b, k) in cites
            if "--todo" in sys.argv and c:
                continue
            name = (labels.get(b, k) or ("",))[0]
            print("%02x:%04x %5d/%-5d %s %s" % (b, k, hit[k], size[k], "cited" if c else "TODO ", name))



def ranges(files, bank, lo, hi):
    """the executed runs of bank:lo-hi (cover_report.py FILES --runs BB:AAAA-AAAA)"""
    cover = bytearray(0x200000)
    for f in files:
        for i, v in enumerate(open(f, "rb").read()):
            if v:
                cover[i] = 1
    base = 0 if bank == 0 else bank * 0x4000 - 0x4000
    run = None
    for a in range(lo, hi + 1):
        if cover[base + a]:
            run = run or a
        elif run is not None:
            print("%02x:%04x-%04x" % (bank, run, a - 1))
            run = None
    if run is not None:
        print("%02x:%04x-%04x" % (bank, run, hi))


if __name__ == "__main__":
    if "--runs" in sys.argv:
        spec = sys.argv[sys.argv.index("--runs") + 1]
        b, r = spec.split(":")
        lo, hi = (int(x, 16) for x in r.split("-"))
        ranges([a for k, a in enumerate(sys.argv[1:]) if not a.startswith("--") and sys.argv[k] not in ("--banks", "--runs")], int(b, 16), lo, hi)
    else:
        main()
