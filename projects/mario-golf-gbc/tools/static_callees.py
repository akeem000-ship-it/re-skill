"""The routines a routine reaches by static control flow (call, jp / jr, rst $00 jump tables, the far calls rst $10 /
rst $18 / call $01F6), each with its traced code size and whether a rewrite cites it (as tools/decomp_progress.py
counts): to plan a port. Indirect jumps (jp hl) and pointers computed at run time are not followed.

usage: static_callees.py BB:AAAA [BB:AAAA ...] [--todo] [--depth N] [--flat] [--stop BB:AAAA ...]
  --todo: print only routines not cited yet; --flat: one line per routine, sorted, with the total;
  --stop: do not descend into these routines
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels, load_rom, to_offset
from instruction_set import decode
from disasm import inline_len, farcall_target, FARCALL_INLINE
from decomp_progress import cited, sources

SKIP = {(0, 0x2E3B)}   # AdvanceFrame: everything (frame tasks) hangs off it


def main():
    a = sys.argv[1:]
    todo, flat = "--todo" in a, "--flat" in a
    depth = int(a[a.index("--depth") + 1]) if "--depth" in a else 99
    stops = set()
    if "--stop" in a:
        for s in a[a.index("--stop") + 1:]:
            if s.startswith("--"):
                break
            b, x = (int(v, 16) for v in s.split(":"))
            stops.add((0 if x < 0x4000 else b, x))
    roots = []
    skipnext = False
    for i, s in enumerate(a):
        if s.startswith("--"):
            skipnext = s in ("--depth",)
            continue
        if skipnext:
            skipnext = False
            continue
        if ":" in s and "--stop" not in a[:i]:
            b, x = (int(v, 16) for v in s.split(":"))
            roots.append((0 if x < 0x4000 else b, x))
    rom = load_rom()
    labels = Labels()
    cites = cited(sources("all"))
    code = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    for (b, x), (name, _) in labels.by.items():
        if b == "*" or x >= 0x8000 or not name:
            continue
        ent.setdefault(0 if x < 0x4000 else b, set()).add(x)
    starts = {b: sorted(v) for b, v in ent.items()}

    def owner(b, x):
        s = starts.get(b, [])
        i = bisect.bisect_right(s, x) - 1
        return (b, s[i]) if i >= 0 else (b, x)

    sizes = {}
    for b, addrs in code.items():
        for x in addrs:
            k = owner(b, x)
            sizes[k] = sizes.get(k, 0) + 1

    def callees(b, x):
        """routine entries reached from the routine at b:x (its own body followed by jumps inside it)"""
        own = owner(b, x)
        seen, out, work = set(), [], [x]
        while work:
            pc = work.pop()
            while True:
                if pc in seen:
                    break
                bb = 0 if pc < 0x4000 else b
                if pc >= 0x8000:
                    break
                if owner(bb, pc) != own and pc != x:
                    out.append(owner(bb, pc))
                    break
                seen.add(pc)
                ins = decode(rom, to_offset(bb, pc), pc)
                nxt = pc + ins.length
                n = inline_len(ins)
                if n:
                    data = rom[to_offset(bb, nxt):to_offset(bb, nxt) + n]
                    if (ins.kind == "rst" and ins.target in (0x10, 0x18)) or (ins.kind == "call" and ins.target == FARCALL_INLINE):
                        t = farcall_target(rom, data[0], data[1])
                        if t is not None and data[1]:
                            out.append(owner(0 if t < 0x4000 else data[1], t))
                    nxt += n
                if ins.kind == "rst" and ins.target == 0x00:
                    lo, hi = (0x4000, 0x8000) if pc >= 0x4000 else (0x0100, 0x4000)
                    o = to_offset(bb, nxt)
                    for k in range(64):
                        t = rom[o + 2 * k] | rom[o + 2 * k + 1] << 8
                        if not (lo <= t < hi):
                            break
                        tb = 0 if t < 0x4000 else b
                        if owner(tb, t) == own:
                            work.append(t)
                        else:
                            out.append(owner(tb, t))
                    break
                if ins.kind == "call" and ins.target is not None and ins.target != FARCALL_INLINE:
                    out.append(owner(0 if ins.target < 0x4000 else b, ins.target))
                if ins.kind in ("jp", "jr") and ins.target is not None:
                    t = ins.target
                    tb = 0 if t < 0x4000 else b
                    if owner(tb, t) == own and (tb == own[0] or t < 0x4000 and own[0] == 0):
                        work.append(t)
                    else:
                        out.append(owner(tb, t))
                    if ins.cond is None:
                        break
                if ins.kind in ("ret", "reti") and ins.cond is None:
                    break
                if ins.kind == "jp" and ins.target is None:
                    break
                if ins.kind == "illegal":
                    break
                pc = nxt
        res = []
        for k in out:
            if k != own and k not in res:
                res.append(k)
        return res

    def nm(k):
        lab = labels.get(k[0], k[1])
        return lab[0] if lab and lab[0] else ""

    printed = set()
    if flat:
        allr = set()
        work = [(r, 0) for r in roots]
        while work:
            k, d = work.pop()
            if k in allr:
                continue
            allr.add(k)
            if d < depth and k not in SKIP and k not in stops:
                work += [(c, d + 1) for c in callees(*k)]
        tot = todo_tot = 0
        for k in sorted(allr):
            s = sizes.get(k, 0)
            done = k in cites
            tot += s
            if not done:
                todo_tot += s
            if todo and done:
                continue
            print("%02x:%04x %5d %s %s" % (k[0], k[1], s, "*" if done else " ", nm(k)))
        print("%d routines, %d bytes, %d not cited" % (len(allr), tot, todo_tot))
        return

    def walk(k, d):
        done = k in cites
        again = k in printed
        if not (todo and done):
            print("%s%02x:%04x %5d %s %s%s" % ("  " * d, k[0], k[1], sizes.get(k, 0), "*" if done else " ", nm(k),
                                                " ..." if again else ""))
        if again or d >= depth or k in SKIP or k in stops:
            return
        printed.add(k)
        for c in callees(*k):
            walk(c, d + 1)

    for r in roots:
        walk(r, 0)


if __name__ == "__main__":
    main()
