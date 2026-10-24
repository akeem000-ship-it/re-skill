"""Check tools/cup_sim.py against the ROM: each cup / pin routine runs in tools/sm83.py and in Python on the same
random ball state (WRAM6 $D400-$D4FF: the ball near a random cup, random velocities, heights and flags), and the
whole state and the returned registers must agree.

usage: test_cup.py [N] [NAME ...]
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import cup_sim as c


def rand_state():
    s = bytearray(random.randrange(256) for _ in range(0x100))
    cx, cy = random.randrange(0x200, 0x3000), random.randrange(0x200, 0x3000)
    spread = random.choice([1, 2, 4, 8, 0x30])
    c.wr16(s, 0x3D, cx)
    c.wr16(s, 0x3F, cy)
    c.wr16(s, 0x01, (cx + random.randrange(-spread, spread + 1)) & 0xFFFF)
    c.wr16(s, 0x04, (cy + random.randrange(-spread, spread + 1)) & 0xFFFF)
    vmax = random.choice([0x40, 0x100, 0x400, 0x8000])
    for o in (0x09, 0x0B, 0x0D):
        c.wr16(s, o, random.randrange(-vmax, vmax) & 0xFFFF)
    h = random.choice([0, 0x10, 0x100, 0x400, 0x2000])
    v = random.randrange(-h, h + 1) if h else 0
    s[0x06], s[0x07], s[0x08] = v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF
    s[0x15] = random.choice([0, 1])
    s[0xD5] = random.choice([0, 0, 0, 1])
    s[0xB8] = random.choice([0, 1, 2, 3])
    s[0xB9] = random.choice([0, 0, 1, 2, 3])
    s[0x44] = random.choice([0, 1])
    if random.random() < 0.5:           # close to the pin, low, untouched: the deep branches
        c.wr16(s, 0x01, cx)
        c.wr16(s, 0x04, cy)
        s[0x00], s[0x03] = random.randrange(-3, 4) & 0xFF, random.randrange(-3, 4) & 0xFF
        if random.random() < 0.5:
            c.wr16(s, 0x01, (cx - (s[0] >> 7)) & 0xFFFF)
            c.wr16(s, 0x04, (cy - (s[3] >> 7)) & 0xFFFF)
        s[0x08], s[0x07] = 0, random.choice([0, 0x80, 0xC0, 0xD0, 0xE8, 0xF0])
        s[0xB9], s[0xD5] = 0, random.choice([0, 0, 1])
    return s


def py_drop(s):
    return c.cup_drop(s, lambda n: None, [])


def py_place(s):
    return c.hole_out_place(s, lambda n: None)


# name: (ROM address, Python function, registers in, result register or None)
CASES = {
    "near_cup":     (0x7122, c.near_cup, {}, "A"),
    "cup_offsets":  (0x73CA, c.cup_offsets, {}, "HL"),
    "line_offset":  (0x741D, c.line_offset, {}, "HL"),
    "pin_normal":   (0x74A1, c.pin_normal, {}, None),
    "pin_contact":  (0x750B, c.pin_contact, {}, None),
    "reflect_line": (0x76BA, c.reflect_line, {}, "HL"),
    "reflect":      (0x771E, c.reflect, {}, None),
    "cup_wall":     (0x7A63, c.cup_wall, {}, None),
    "cup_deflect":  (0x760E, c.cup_deflect, {}, "HL"),
    "pin_bounce":   (0x765F, lambda s: c.pin_bounce(s, []), {}, None),
    "pin_dist":     (0x62AD, c.pin_dist, {}, "HL"),
    "pin_far":      (0x735A, lambda s: c.pin_far(s, 2), {"hl": 2}, "A"),
    "pin_check":    (0x72E7, lambda s: c.pin_check(s, []), {}, None),
    "fly_in":       (0x7263, c.fly_in, {}, "A"),
    "roll_in":      (0x716B, c.roll_in, {}, None),
    "rim_clamp":    (0x78AD, c.rim_clamp, {}, None),
    "cup_sink":     (0x7860, c.cup_sink, {}, "A"),
    "cup_drop":     (0x79AF, py_drop, {}, "A"),
    "hole_out_place": (0x7888, py_place, {}, None),
}


def main():
    a = sys.argv[1:]
    n = int(a[0]) if a and a[0].isdigit() else 500
    names = [x for x in a if not x.isdigit()] or list(CASES)
    random.seed(7)
    m = Machine(load_rom())
    m.frame_hook = lambda mm: True          # AdvanceFrame returns at once
    for name in names:
        addr, fn, regs, out = CASES[name]
        bad, shown, changed, skipped = 0, 0, 0, 0
        for _ in range(n):
            s = rand_state()
            m.wram[6][0x400:0x500] = s
            m.high[0x170] = m.high[0x196] = 6
            m.sp = 0xDFF0
            try:
                o = m.call(0x10, addr, max_steps=200000, **regs)
            except RuntimeError:
                skipped += 1                # the ROM did not finish (CupDrop on a state that never sinks)
                continue
            t = bytearray(s)
            r = fn(t)
            got = bytes(m.wram[6][0x400:0x500])
            diff = [k for k in range(0x100) if got[k] != t[k]]
            changed += got != bytes(s)
            if diff or (out and r != o[out]):
                bad += 1
                if shown < 2:
                    shown += 1
                    print("  %s: %s rom %s py %s" % (name, " ".join("$%02x:%02x/%02x" % (k, got[k], t[k]) for k in diff[:10]),
                          o.get(out) if out else "", r if out else ""))
        print("%-15s %d cases (%d changed the state, %d not finished)  %s" % (name, n, changed, skipped,
              "OK" if not bad else "%d mismatches" % bad))


if __name__ == "__main__":
    main()
