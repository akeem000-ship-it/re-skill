"""List the traced routines of some banks with their code sizes, names and whether a rewrite cites them (the same
byte -> routine mapping as tools/decomp_progress.py): to plan what to port next.
usage: routine_sizes.py BANK [BANK ...] [--todo]   (bank hex; --todo: only routines not cited yet)
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels
from decomp_progress import cited, sources


def main():
    banks = [int(x, 16) for x in sys.argv[1:] if not x.startswith("--")]
    todo = "--todo" in sys.argv
    cites = cited(sources("all"))
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    for b in banks:
        starts = sorted(ent.get(b, ()))
        sizes = {}
        for addr in code.get(b, ()):
            i = bisect.bisect_right(starts, addr) - 1
            if i >= 0:
                sizes[starts[i]] = sizes.get(starts[i], 0) + 1
        tot = 0
        for a in sorted(sizes):
            done = (b, a) in cites
            tot += sizes[a]
            if todo and done:
                continue
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %5d %s %s" % (b, a, sizes[a], "*" if done else " ", name))
        print("bank %02x: %d code bytes" % (b, tot))


if __name__ == "__main__":
    main()
