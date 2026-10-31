"""Data-named labels (the tracer's DATA_NAME / DATA_NAMES: not traced) whose bytes up to the next entry hold traced
code: such a label takes those code bytes in coverage.py / decomp_progress.py's byte -> routine mapping. Lists each
with its traced bytes and the first one (a code routine after a table that has no label of its own, or a label
inside a routine's instructions).
usage: data_labels_in_code.py [BB ...]
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels
from trace_code import DATA_LABELS


def main():
    only = {int(x, 16) for x in sys.argv[1:]}
    code = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    for b, a in sorted(DATA_LABELS):
        if only and b not in only:
            continue
        starts = sorted(ent.get(b, ()))
        i = bisect.bisect_right(starts, a)
        end = starts[i] if i < len(starts) else 0x8000
        inside = sorted(x for x in code.get(b, ()) if a <= x < end)
        if inside:
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %-36s %5d code bytes from %02x:%04x (to %04x)" % (b, a, name, len(inside), b, inside[0], end))


if __name__ == "__main__":
    main()
