"""How much of the game's traced code is rewritten: the share of traced code bytes (states/code_map.json) in
routines that a rewrite cites by BB:AAAA. Bytes map to routines as in tools/coverage.py (each code byte belongs
to the nearest routine entry at or below it: states/code_entries.json plus every labels.csv address). A routine
counts as rewritten when a source file names its entry address as BB:AAAA (bank-0 routines as 00:AAAA). A
routine named only to say it is not rewritten (display, sound, a branch not ported) is written ~BB:AAAA and does
not count.

Sources: every web/js/**/*.js except the emulator core web/js/gb/ (the golf engine web/js/golf, the sound
driver web/js/sound, ...) and the Python ports (tools/golfmath.py, ball_sim.py,
cup_sim.py, launch_py.py, swing_py.py, shot_py.py, hole_py.py, joypad.py).
usage: decomp_progress.py [--list | --todo] [--js | --py | --dir golf]   (--list: the cited routines with their sizes;
       --todo: the routines not cited, largest first; --dir: only web/js/<dir>)
"""
import sys, os, re, json, bisect, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels

PY = ["golfmath", "ball_sim", "cup_sim", "launch_py", "swing_py", "shot_py", "hole_py", "joypad"]
CITE = re.compile(r"(?<![~\w])([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\b")


def sources(which, sub=None):
    out = []
    if which in ("all", "js"):
        gb = os.path.join(ROOT, "web", "js", "gb") + os.sep
        top = os.path.join(ROOT, "web", "js", *([sub] if sub else []))
        out += sorted(p for p in glob.glob(os.path.join(top, "**", "*.js"), recursive=True)
                      if not p.startswith(gb))
    if which in ("all", "py"):
        out += [os.path.join(ROOT, "tools", n + ".py") for n in PY]
    return out


def cited(paths):
    c = set()
    for p in paths:
        for b, a in CITE.findall(open(p).read()):
            b, a = int(b, 16), int(a, 16)
            if a < 0x4000:
                b = 0
            elif a >= 0x8000:
                continue
            c.add((b, a))
    return c


def measure(cites):
    code = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    tot = done = 0
    sizes = {}
    todo = {}
    for b in sorted(code):
        starts = sorted(ent.get(b, ()))
        for addr in code[b]:
            i = bisect.bisect_right(starts, addr) - 1
            tot += 1
            if i >= 0 and (b, starts[i]) in cites:
                done += 1
                sizes[(b, starts[i])] = sizes.get((b, starts[i]), 0) + 1
            else:
                k = (b, starts[i] if i >= 0 else 0)
                todo[k] = todo.get(k, 0) + 1
    measure.todo = todo
    return tot, done, sizes, labels


def main():
    which = "js" if "--js" in sys.argv else "py" if "--py" in sys.argv else "all"
    sub = sys.argv[sys.argv.index("--dir") + 1] if "--dir" in sys.argv else None   # e.g. --dir golf
    if sub:
        which = "js"
    tot, done, sizes, labels = measure(cited(sources(which, sub)))
    if "--list" in sys.argv:
        for (b, a), n in sorted(sizes.items()):
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %5d  %s" % (b, a, n, name))
    if "--todo" in sys.argv:
        for (b, a), n in sorted(measure.todo.items(), key=lambda kv: -kv[1]):
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %5d  %s" % (b, a, n, name))
    print("rewritten (%s): %d of %d traced code bytes in %d routines (%.2f%%)" % (
        which, done, tot, len(sizes), 100 * done / tot))


if __name__ == "__main__":
    main()
