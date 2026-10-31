"""Whether ROM addresses are in the traced code map (states/code_map.json) and which routine entry (as
decomp_progress.py maps bytes) they fall under.
usage: code_at.py BB:AAAA [BB:AAAA ...]
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels


def main():
    code = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    for spec in sys.argv[1:]:
        b, a = (int(x, 16) for x in spec.split(":"))
        if a < 0x4000:
            b = 0
        starts = sorted(ent.get(b, ()))
        i = bisect.bisect_right(starts, a) - 1
        owner = starts[i] if i >= 0 else None
        name = (labels.get(b, owner) or ("",))[0] if owner is not None else ""
        print("%02x:%04x %s  under %s %s" % (b, a, "code" if a in code.get(b, ()) else "not code",
                                            "%02x:%04x" % (b, owner) if owner is not None else "-", name))


if __name__ == "__main__":
    main()
