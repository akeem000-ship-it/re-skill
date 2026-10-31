"""Check tools/golfmath.py against the ROM routines in PyBoy (tools/emu_callfn.py) on random inputs.

usage: test_math.py [N] [name ...]     (N random cases per routine, default 100)
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu_callfn import Caller
from tools import golfmath as g

R16 = lambda: random.randrange(0x10000)
R8 = lambda: random.randrange(0x100)
CASES = {
    # name: (addr, make inputs, python result, rom result from the output registers)
    "mul_hl_by_a": (0x08B9, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_a(i["hl"], i["a"]), lambda o: o["HL"]),
    "mul_hl_by_a_frac": (0x0BEC, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_a_frac(i["hl"], i["a"]), lambda o: o["HL"]),
    "mul_hl_by_a_frac_signed": (0x0BCE, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_a_frac_signed(i["hl"], i["a"]), lambda o: o["HL"]),
    "mul_hl_by_de": (0x0CB5, lambda: dict(hl=R16(), de=R16()), lambda i: g.mul_hl_by_de(i["hl"], i["de"]), lambda o: o["HL"]),
    "mul_hl_by_de_both_signed": (0x0C8E, lambda: dict(hl=R16(), de=R16()), lambda i: g.mul_hl_by_de_both_signed(i["hl"], i["de"]), lambda o: o["HL"]),
    "mul_sin": (0x11CB, lambda: dict(hl=R16(), bc=R16() & 0xFFF0), lambda i: g.mul_sin(i["hl"], i["bc"]), lambda o: o["HL"]),
    "mul_sin_cos": (0x11BA, lambda: dict(hl=R16(), bc=R16()), lambda i: g.mul_sin_cos(i["hl"], i["bc"]), lambda o: (o["HL"], o["DE"])),
    "mul_sin_cos_signed": (0x11AC, lambda: dict(hl=R16(), bc=R16()), lambda i: g.mul_sin_cos_signed(i["hl"], i["bc"]), lambda o: (o["HL"], o["DE"])),
    "div_ahl_by_de": (0x0DDB, lambda: dict(a=R8(), hl=R16(), de=R16() | 1), lambda i: g.div_ahl_by_de(i["a"], i["hl"], i["de"]), lambda o: (o["A"], o["HL"])),
    "isqrt_hl": (0x0F04, lambda: dict(hl=R16()), lambda i: g.isqrt_hl(i["hl"]), lambda o: o["A"]),
    "angle_from_vector16": (0x1A03, lambda: dict(hl=random.choice([R16(), R8(), (R16() >> 4)]), de=random.choice([R16(), R8(), (R16() >> 4)])),
                            lambda i: g.angle_from_vector16(i["hl"], i["de"]), lambda o: o["BC"]),
    "mul_hl_by_sin": (0x0B3C, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_sin(i["hl"], i["a"]), lambda o: o["HL"]),
    "vector_from_length_and_angle_raw": (0x0B31, lambda: dict(hl=R16(), a=R8()), lambda i: g.vector_from_length_and_angle_raw(i["hl"], i["a"]), lambda o: (o["HL"], o["DE"])),
}


def main():
    args = sys.argv[1:]
    n = int(args[0]) if args and args[0].isdigit() else 100
    names = [a for a in args if not a.isdigit()] or list(CASES)
    random.seed(1)
    c = Caller()
    for name in names:
        addr, mk, py, rom = CASES[name]
        bad = 0
        for _ in range(n):
            i = mk()
            want, got = py(i), rom(c.call(0, addr, **i))
            if want != got:
                bad += 1
                if bad <= 3:
                    print("  %s %s: python %s rom %s" % (name, {k: hex(v) for k, v in i.items()},
                          want if isinstance(want, int) and False else repr(want), repr(got)))
        print("%-26s %4d cases  %s" % (name, n, "OK" if not bad else "%d mismatches" % bad))
    c.stop()


if __name__ == "__main__":
    main()
