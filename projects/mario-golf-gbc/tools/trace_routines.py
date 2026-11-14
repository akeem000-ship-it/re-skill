"""The routines a recorded run of the core executed (web/tests/golf/coretrace.mjs JSON: [bank, addr] pairs), with
their traced code sizes and whether a rewrite cites them (as tools/decomp_progress.py counts): to plan a port.
usage: trace_routines.py out/trace_X.json [--todo] [--bank BB]
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels
from decomp_progress import cited, sources


def main():
    a = sys.argv[1:]
    todo = "--todo" in a
    only = int(a[a.index("--bank") + 1], 16) if "--bank" in a else None
    pts = json.load(open(a[0] if os.path.isabs(a[0]) else os.path.join(ROOT, a[0])))
    labels = Labels()
    cites = cited(sources("all"))
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    for (b, x), (name, _) in labels.by.items():
        if b == "*" or x >= 0x8000 or not name:
            continue
        ent.setdefault(0 if x < 0x4000 else b, set()).add(x)
    starts = {b: sorted(v) for b, v in ent.items()}
    sizes = {}
    for b, addrs in code.items():
        s = starts.get(b, [])
        for x in addrs:
            i = bisect.bisect_right(s, x) - 1
            if i >= 0:
                sizes[(b, s[i])] = sizes.get((b, s[i]), 0) + 1
    hit = {}
    for b, x in pts:
        s = starts.get(b, [])
        i = bisect.bisect_right(s, x) - 1
        if i >= 0:
            k = (b, s[i])
            hit[k] = hit.get(k, 0) + 1
    tot = left = 0
    for k in sorted(hit):
        if only is not None and k[0] != only:
            continue
        done = k in cites
        tot += sizes.get(k, 0)
        if not done:
            left += sizes.get(k, 0)
        if todo and done:
            continue
        lab = labels.get(k[0], k[1])
        print("%02x:%04x %5d %s %s" % (k[0], k[1], sizes.get(k, 0), "*" if done else " ", lab[0] if lab and lab[0] else ""))
    print("%d routines, %d bytes, %d not cited" % (len(hit), tot, left))


if __name__ == "__main__":
    main()
