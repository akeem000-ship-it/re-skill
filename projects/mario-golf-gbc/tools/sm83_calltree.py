"""The routines a stretch of ROM code calls, found by running it in the SM83 interpreter (tools/sm83.py) from a
recorded RAM snapshot (tools/emu_hole_setup.py points, or any load_snapshot dict). Prints each routine entry
(labels.csv and states/code_entries.json) the first time it runs, indented by call depth, with how often it
ran in all. AdvanceFrame (00:2E3B) is skipped (frame tasks do not run); with --press N:BUTTON the joypad
bytes say BUTTON was newly pressed on the N-th AdvanceFrame (held 6 frames).

usage: sm83_calltree.py REC.json POINT BB:AAAA STOP [--press N:BUTTON ...] [--depth D] [--max STEPS]
  POINT: index into the recording's points; BB:AAAA where to start; STOP: BB:AAAA where to stop
"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, Labels, ROOT
from sm83 import Machine
import joypad as jp


def main():
    a = sys.argv[1:]
    rec = json.load(open(a[0]))
    pt = rec["points"][int(a[1])] if "points" in rec else rec
    snap = pt["snapshot"] if "snapshot" in pt else pt
    sb, sa = (int(x, 16) for x in a[2].split(":"))
    tb, ta = (int(x, 16) for x in a[3].split(":"))
    depth = int(a[a.index("--depth") + 1]) if "--depth" in a else 99
    maxs = int(a[a.index("--max") + 1]) if "--max" in a else 20_000_000
    presses = {}
    if "--press" in a:
        for p in a[a.index("--press") + 1:]:
            if p.startswith("--"):
                break
            n, b = p.split(":")
            presses[int(n)] = b
    labels = Labels()
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    for (b, ad), (name, _) in labels.by.items():
        if b != "*" and ad < 0x8000 and name:
            ent.setdefault(0 if ad < 0x4000 else b, set()).add(ad)
    m = Machine(load_rom())
    m.load_snapshot(snap)
    m.rom_bank = sb
    m.high[0x195] = sb
    m.sp = 0xCFF0
    m.pc = sa
    if "a" in pt:
        m.a = pt["a"]
    nframe = [0]

    def frame(mm):
        jp.read_joypad(mm.high, jp.held_at(presses, nframe[0]))
        nframe[0] += 1
        return True
    m.frame_hook = frame
    base_sp = m.sp
    seen, count = set(), collections.Counter()
    while True:
        bank = m.rom_bank if 0x4000 <= m.pc < 0x8000 else 0
        if (bank, m.pc) == (tb, ta):
            break
        if m.pc < 0x8000 and m.pc in ent.get(bank, ()):
            key = (bank, m.pc)
            count[key] += 1
            if key not in seen:
                seen.add(key)
                d = max(0, (base_sp - m.sp) // 2)
                if d <= depth:
                    lab = labels.get(bank, m.pc)
                    print("%s%02x:%04x %s  (frame %d)" % ("  " * d, bank, m.pc, lab[0] if lab else "", nframe[0]))
        m.step()
        if m.steps > maxs:
            print("stopped after %d steps at %02x:%04x" % (m.steps, bank, m.pc))
            break
    print("reached %02x:%04x after %d AdvanceFrame calls, %d steps" % (tb, ta, nframe[0], m.steps))
    if "--counts" in a:
        for k, n in count.most_common():
            lab = labels.get(*k)
            print("%6d %02x:%04x %s" % (n, k[0], k[1], lab[0] if lab else ""))


if __name__ == "__main__":
    main()
