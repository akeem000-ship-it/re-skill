"""Check tools/sm83.py against tools/golfmath.py (itself checked against the ROM in PyBoy): run the ROM's
math routines in the interpreter on random inputs.

usage: test_sm83.py [N]
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import golfmath as g

R16 = lambda: random.randrange(0x10000)
R8 = lambda: random.randrange(0x100)
CASES = [
    ("mul_hl_by_a", 0x08B9, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_a(i["hl"], i["a"]), lambda o: o["HL"]),
    ("mul_hl_by_a_frac_signed", 0x0BCE, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_a_frac_signed(i["hl"], i["a"]), lambda o: o["HL"]),
    ("mul_hl_by_de_both_signed", 0x0C8E, lambda: dict(hl=R16(), de=R16()), lambda i: g.mul_hl_by_de_both_signed(i["hl"], i["de"]), lambda o: o["HL"]),
    ("mul_sin_cos_signed", 0x11AC, lambda: dict(hl=R16(), bc=R16()), lambda i: g.mul_sin_cos_signed(i["hl"], i["bc"]), lambda o: (o["HL"], o["DE"])),
    ("div_ahl_by_de", 0x0DDB, lambda: dict(a=R8(), hl=R16(), de=R16() | 1), lambda i: g.div_ahl_by_de(i["a"], i["hl"], i["de"]), lambda o: (o["A"], o["HL"])),
    ("isqrt_hl", 0x0F04, lambda: dict(hl=R16()), lambda i: g.isqrt_hl(i["hl"]), lambda o: o["A"]),
    ("angle_from_vector16", 0x1A03, lambda: dict(hl=R16() >> random.choice([0, 4, 8]), de=R16() >> random.choice([0, 4, 8])), lambda i: g.angle_from_vector16(i["hl"], i["de"]), lambda o: o["BC"]),
    ("mul_hl_by_sin", 0x0B3C, lambda: dict(hl=R16(), a=R8()), lambda i: g.mul_hl_by_sin(i["hl"], i["a"]), lambda o: o["HL"]),
]


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    random.seed(2)
    m = Machine(load_rom())
    for name, addr, mk, py, out in CASES:
        bad = 0
        for _ in range(n):
            i = mk()
            if py(i) != out(m.call(0, addr, **i)):
                bad += 1
        print("%-26s %d cases  %s" % (name, n, "OK" if not bad else "%d mismatches" % bad))


if __name__ == "__main__":
    main()
