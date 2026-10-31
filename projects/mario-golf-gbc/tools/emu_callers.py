"""Record who calls a routine while the game runs: (ROM bank, return address) pairs from the stack.

Plays the given button script, then counts, for every execution of BB:AAAA after frame START, the
return address at [SP] and the next stack words that point into ROM ($0150-$7FFF), with the
current ROM bank (hROMBank). Prints the most common call chains.
--seq prints the chains in the order they happened instead (repeats folded, each return address named by the
nearest label at or below it, in the bank hROMBank had at the hit for addresses >= $4000).
usage: emu_callers.py BB:AAAA START END [--depth N] [--state FILE] [--seq] --press FRAME:BUTTON ...
  e.g. emu_callers.py 00:2E3B 4400 4600 --press 3000:start 3300:a 3400:right ...
  --state starts from a saved state (frames then count from it)
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    a = sys.argv[1:]
    bank, addr = (int(x, 16) for x in a[0].split(":"))
    start, end = int(a[1]), int(a[2])
    depth = int(a[a.index("--depth") + 1]) if "--depth" in a else 4
    presses = {}
    if "--press" in a:
        for p in a[a.index("--press") + 1:]:
            if p.startswith("--"):
                break
            f, b = p.split(":")
            presses[int(f)] = b
    e = Emu(fresh=True)
    if "--state" in a:
        e.load(a[a.index("--state") + 1])
    chains = collections.Counter()
    seq = []
    state = {"on": False}

    def hit(emu):
        if not state["on"]:
            return
        sp = emu.regs()["SP"]
        words = []
        for k in range(16):
            w = emu.r16(sp + 2 * k)
            if 0x0150 <= w < 0x8000:
                words.append(w)
            if len(words) >= depth:
                break
        chains[(emu.r8(0xFF95),) + tuple(words)] += 1
        seq.append(((emu.r8(0xFF95),) + tuple(words), state["f"]))

    e.hook(bank, addr, hit)
    for f in range(end):
        state["on"] = f >= start
        state["f"] = f
        if f in presses:
            e.pb.button_press(presses[f])
        if f - 6 in presses:
            e.pb.button_release(presses[f - 6])
        e.run(1)
    e.stop()
    if "--seq" in a:
        import bisect
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from gbrom import Labels
        lab = Labels()
        names = {}
        for (b, ad), (nm, _) in lab.by.items():
            if b != "*" and nm and ad < 0x8000:
                names.setdefault(0 if ad < 0x4000 else b, []).append((ad, nm))
        for v in names.values():
            v.sort()

        def name(bank, w):
            lst = names.get(0 if w < 0x4000 else bank, [])
            i = bisect.bisect_right(lst, (w, "~")) - 1
            return "%s+%x" % (lst[i][1], w - lst[i][0]) if i >= 0 else "%04x" % w
        last, n, f0 = None, 0, 0
        for ch, f in seq + [(None, 0)]:
            if ch != last:
                if last is not None:
                    print("%5d x  frame %d  %s" % (n, f0, " <- ".join(name(last[0], w) for w in last[1:])))
                last, n, f0 = ch, 0, f
            n += 1
        return
    for ch, n in chains.most_common(25):
        print("%5d  bank %02x  %s" % (n, ch[0], " <- ".join("%04x" % w for w in ch[1:])))


if __name__ == "__main__":
    main()
