"""How much of the traced code is understood: each traced code byte (states/code_map.json from trace_code.py)
belongs to the nearest routine entry at or below it (states/code_entries.json and labels.csv); a byte counts as
named when that routine has a name in labels.csv. Prints the share per bank and in total.

usage: coverage.py [--banks]
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels


def main():
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    named = {}
    for (b, a), (name, _) in Labels().by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        bank = 0 if a < 0x4000 else b
        named.setdefault(bank, set()).add(a)
        ent.setdefault(bank, set()).add(a)
    tot = tot_named = 0
    rows = []
    for b in sorted(code):
        starts = sorted(ent.get(b, ()))
        n = 0
        for addr in code[b]:
            i = bisect.bisect_right(starts, addr) - 1
            if i >= 0 and starts[i] in named.get(b, ()):
                n += 1
        tot += len(code[b])
        tot_named += n
        rows.append((b, len(code[b]), n))
    if "--banks" in sys.argv:
        for b, c, n in rows:
            print("bank %02x: %6d code bytes, %6d in named routines (%5.1f%%)" % (b, c, n, 100 * n / max(c, 1)))
    print("traced code: %d bytes; in named routines: %d (%.1f%%)" % (tot, tot_named, 100 * tot_named / tot))


if __name__ == "__main__":
    main()
