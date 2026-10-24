"""Bank-0 arithmetic of Mario Golf as Python functions, each named after its ROM routine.

Every function returns the result registers the callers use. tools/test_math.py checks each against the
ROM routine in PyBoy on random inputs. Values are unsigned 16-bit unless the name says Signed.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom

_rom = load_rom()
SINE = [_rom[0x1201 + 2 * i] | _rom[0x1202 + 2 * i] << 8 for i in range(0x401)]   # SineTable 00:1201


def neg16(v):
    return (-v) & 0xFFFF


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def sub_hl_de(hl, de):                 # 00:08AC
    return (hl - de) & 0xFFFF


def neg_hl(hl):                        # 00:0C60
    return neg16(hl)


def mul_hl_by_a(hl, a):                # 00:08B9 MulHLByA: low 16 bits
    return (hl * a) & 0xFFFF


def mul_hl_by_a_frac(hl, a):           # 00:0BEC MulHLByAFrac
    return (hl * a) >> 8


def mul_hl_by_a_frac_signed(hl, a):    # 00:0BCE: negate, multiply, negate for a negative hl
    if hl & 0x8000:
        return neg16(mul_hl_by_a_frac(neg16(hl), a))
    return mul_hl_by_a_frac(hl, a)


def mul_hl_by_de(hl, de):              # 00:0CB5 MulHLByDE: high 16 bits of the product
    return (hl * de) >> 16


def mul_hl_by_de_both_signed(hl, de):  # 00:0C8E
    neg = (hl ^ de) & 0x8000
    a = neg16(hl) if hl & 0x8000 else hl
    b = neg16(de) if de & 0x8000 else de
    r = mul_hl_by_de(a, b)
    return neg16(r) if neg else r


def mul_sin_unsigned(hl, bc):          # 00:11DB: hl * sin(bc), bc in 0..$7FFF
    if bc & 0x4000:
        bc = (0x8000 - bc) & 0xFFFF
    return mul_hl_by_de(SINE[(bc >> 4) & 0x7FF], (hl * 2) & 0xFFFF)


def mul_sin(hl, bc):                   # 00:11CB MulSin
    if bc & 0x8000:
        return neg16(mul_sin_unsigned(hl, bc & 0x7FFF))
    return mul_sin_unsigned(hl, bc)


def mul_sin_cos(hl, bc):               # 00:11BA: (hl = hl*cos, de = hl*sin), c's low nibble dropped
    bc &= 0xFFF0
    de = mul_sin(hl, bc)
    return mul_sin(hl, (bc + 0x4000) & 0xFFFF), de


def mul_sin_cos_signed(hl, bc):        # 00:11AC: a negative length turns the angle half a turn
    if hl & 0x8000:
        hl, bc = neg16(hl), (bc + 0x8000) & 0xFFFF
    return mul_sin_cos(hl, bc)

TANGENT = [_rom[0x1B68 + 2 * i] | _rom[0x1B69 + 2 * i] << 8 for i in range(257)]   # TangentTable 00:1B68


def div_ahl_by_de(a, hl, de):          # 00:0DDB: a:hl / de -> (a, hl), bit for bit like the ROM
    """Restoring division in three 8-bit phases (high, middle, low byte of the dividend). Like the ROM:
    phase 1 shifts only l into the remainder, the remainder's high byte is cleared before phase 2, and the
    carry out of h is dropped; so the result is the true quotient only while de < $80 or so. de = 0: ($FF, $FFFF)."""
    if de == 0:
        return 0xFF, 0xFFFF
    nde = (-de) & 0xFFFF
    rem = 0

    def phase(x, shift_h):
        nonlocal rem
        carry = 1
        for _ in range(8):
            v = (x << 1) | carry
            c = v >> 8
            x = v & 0xFF
            h, l = rem >> 8, rem & 0xFF
            v = (l << 1) | c
            l, c = v & 0xFF, v >> 8
            if shift_h:
                h = ((h << 1) | c) & 0xFF
            s = ((h << 8) | l) + nde
            carry, rem = s >> 16, s & 0xFFFF
            if not carry:
                x = (x - 1) & 0xFF
                s = rem + de
                carry, rem = s >> 16, s & 0xFFFF
        return x

    qa = phase(a, False)
    rem &= 0x00FF
    qh = phase(hl >> 8, True)
    ql = phase(hl & 0xFF, True)
    return qa, (qh << 8) | ql


def div_hl_by_de(hl, de):              # 00:09AE DivHLByDE: hl = hl / de; de = 0 -> $FFFF
    return 0xFFFF if de == 0 else hl // de


def isqrt_hl(hl):                      # 00:0F04: a = floor(sqrt(hl))
    r = int(hl ** 0.5)
    while r * r > hl:
        r -= 1
    while (r + 1) * (r + 1) <= hl:
        r += 1
    return r


def angle_from_vector16(hl, de):       # 00:1A03: bc = angle of (x = hl, y = de) from +y toward +x
    x, y = hl, de
    if x == 0:
        bc = 0
    elif y == 0:
        bc = 0x4000
    else:
        ax = neg16(x) if x & 0x8000 else x
        ay = neg16(y) if y & 0x8000 else y
        a, q = div_ahl_by_de(ax >> 8, (ax & 0xFF) << 8, ay)
        if a:
            bc = 0x3FC0
        else:
            k, b = 127, 0
            for bit, step in ((7, 64), (6, 32), (5, 16), (4, 8), (3, 4), (2, 2), (1, 1)):
                if TANGENT[k] < q:
                    k += step
                    b |= 1 << bit
                else:
                    k -= step
            if TANGENT[k] < q:
                b += 1
            if b == 0xFF and TANGENT[k + 1] < q:
                bc = 0x4000
            else:
                bc = (b << 6) & 0xFFFF
    if y & 0x8000:
        bc = (0x8000 - bc) & 0xFFFF
    if x & 0x8000:
        bc = neg16(bc)
    return bc

SINE8 = list(_rom[0x0B69:0x0B69 + 0x41])        # 00:0B69: sine bytes for angles 0..$40 (8-bit angles)


def mul_hl_by_sin_half(hl, a):         # 00:0B4C MulHLBySinHalf: a in 0..$7F
    if a & 0x40:
        a = (0x80 - a) & 0xFF
    v = (((hl * SINE8[a]) & 0xFFFF) + 0x40) & 0xFFFF
    v <<= 1
    return ((v >> 8) & 0xFF) | (0xFF00 if v & 0x10000 else 0)


def mul_hl_by_sin(hl, a):              # 00:0B3C MulHLBySin: 8-bit angle
    if a & 0x80:
        return neg16(mul_hl_by_sin_half(hl, a & 0x7F))
    return mul_hl_by_sin_half(hl, a)


def vector_from_length_and_angle_raw(hl, a):   # 00:0B31: (hl = hl*sin(a+$40), de = hl*sin(a))
    return mul_hl_by_sin(hl, (a + 0x40) & 0xFF), mul_hl_by_sin(hl, a)
