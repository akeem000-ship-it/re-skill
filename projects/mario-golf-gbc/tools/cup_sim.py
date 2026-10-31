"""The cup and the pin (bank 10, 10:6E99's helpers) as Python functions on the ball state s = WRAM6 $D400-$D4FF.

Each function is named after its ROM routine and follows it step by step, including its 16-bit wraps, its
saturations ($3FFF after an overflowing division, $FFFF / $FF:FFFF after an overflowing product) and the
order of its sign fixes. tools/test_cup.py runs every one against the ROM routine in tools/sm83.py on random
states. Offsets in s: $99/$9B ball - cup (8.8), $9D/$9F the closest point of the ball's path to the cup,
$A1/$A3 the contact point, $A5 distance to the cup, $A7 ball speed, $A9-$B0 the reflection, $B8 rim flags,
$B9 pin flags, $D5 (nonzero: skips the pin and the early drop).
Sounds are reported in fx (("sound", id)); frame waits go through the frame(n) callback.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import golfmath as g
from ball_sim import rd16, wr16, add_vel_to_pos, dist

neg16 = g.neg16


def _abs(v):
    return neg16(v) if v & 0x8000 else v


def _sgn(v):
    return v >> 15 & 1


def _sra16(v, n):                       # sra h / rr l, n times
    for _ in range(n):
        v = (v >> 1) | (v & 0x8000)
    return v


def _ahl(p):                            # a:hl = $FFAA:$FFA9:$FFA8, or $FF:$FFFF when $FFAB is set
    return (0xFF, 0xFFFF) if p >> 24 else ((p >> 16) & 0xFF, p & 0xFFFF)


def _div(a, hl, de):                    # DivAHLByDE; a nonzero afterwards -> $3FFF
    a, q = g.div_ahl_by_de(a, hl, de)
    return 0x3FFF if a else q


def isqrt24(hl, a):                     # 00:1D6A: hl = floor(sqrt(hl * 256 + a)) (12 bits)
    return _isqrt(hl << 8 | a)


def _isqrt(v):
    r = int(v ** 0.5)
    while r * r > v:
        r -= 1
    while (r + 1) * (r + 1) <= v:
        r += 1
    return r


def _offset(s, o_int, o_frac, o_cup):   # 8.8 offset: (|integer difference| low byte, fraction), signed
    d = (rd16(s, o_int) - rd16(s, o_cup)) & 0xFFFF
    v = (_abs(d) & 0xFF) << 8 | s[o_frac]
    return neg16(v) if d & 0x8000 else v


def near_cup(s):                        # 10:7122 NearCup: both integer offsets below $20
    for o, c in ((0x04, 0x3F), (0x01, 0x3D)):
        d = _abs((rd16(s, o) - rd16(s, c)) & 0xFFFF)
        if not ((d - 0x20) & 0x8000):
            return 0
    return 1


def cup_offsets(s):                     # 10:73CA: $D499/$D49B = (integer difference low byte, fraction); $D4A5
    y = ((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFF) << 8 | s[0x03]
    wr16(s, 0x9B, y)
    x = ((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFF) << 8 | s[0x00]
    wr16(s, 0x99, x)
    r = dist(x, y)
    wr16(s, 0xA5, r)
    return r


def line_offset(s):                     # 10:741D: $D49B - $D499 * vy / vx (each velocity / 16 first)
    vy, vx, ox = rd16(s, 0x0B), rd16(s, 0x09), rd16(s, 0x99)
    p = _abs(ox) * _sra16(_abs(vy), 4)
    q = _div(*_ahl(p), _sra16(_abs(vx), 4))
    if (_sgn(vx) + _sgn(ox) + _sgn(vy)) & 1:
        q = neg16(q)
    return (rd16(s, 0x9B) - q) & 0xFFFF


def pin_normal(s):                      # 10:74A1: closest point of the path to the cup -> $D49D / $D49F
    t = line_offset(s)
    vx, vy = rd16(s, 0x09), rd16(s, 0x0B)
    ang = g.angle_from_vector16(_abs(vy), _abs(vx))
    hl, de = g.mul_sin_cos(_abs(t), ang)
    hl, de = g.mul_sin_cos(hl, (0x4000 - ang) & 0xFFFF)
    if not ((s[0x0A] >> 7) + (s[0x0C] >> 7)) & 1:
        hl = neg16(hl)
    if t & 0x8000:
        hl, de = neg16(hl), neg16(de)
    wr16(s, 0x9D, hl)
    wr16(s, 0x9F, de)


def pin_contact(s):                     # 10:750B: speed $D4A7; contact point $D4A1 / $D4A3
    vx, vy = rd16(s, 0x09), rd16(s, 0x0B)
    wr16(s, 0xA7, dist(vx, vy))
    a, hl = _ahl(dist(rd16(s, 0x9D), rd16(s, 0x9F)) * 0x40)
    d = 2 if s[0xB8] & 2 and not s[0xD5] else 6
    q = _div(a, hl, d << 8)
    c, _ = g.mul_sin_cos(rd16(s, 0xA5), (q & 0xFF) << 8)
    c = _abs(c)
    for v, o_base, o_out in ((vx, 0x9D, 0xA1), (vy, 0x9F, 0xA3)):
        q = _div(*_ahl(_abs(v) * c), rd16(s, 0xA7))
        if v & 0x8000:
            q = neg16(q)
        wr16(s, o_out, (q + rd16(s, o_base)) & 0xFFFF)


def reflect_line(s):                    # 10:76BA: vy - vx * $D4A3 / $D4A1
    a3, a1, vx = rd16(s, 0xA3), rd16(s, 0xA1), rd16(s, 0x09)
    q = _div(*_ahl(_abs(vx) * _abs(a3)), _abs(a1))
    if (_sgn(a1) + _sgn(vx) + _sgn(a3)) & 1:
        q = neg16(q)
    return (rd16(s, 0x0B) - q) & 0xFFFF


def reflect(s):                         # 10:771E: the velocity reflected at the contact point -> $D4A9-$D4B0
    r = reflect_line(s)
    n1 = (~s[0xA2] >> 7) & 1
    b = n1 << 1 | s[0xA4] >> 7
    if (n1 + _sgn(r)) & 1:
        b ^= 3
    s[0xBA] = b
    ang = g.angle_from_vector16(_abs(rd16(s, 0xA3)), _abs(rd16(s, 0xA1)))
    hl, de = g.mul_sin_cos(_abs(r), ang)
    hl, de = g.mul_sin_cos(hl, (0x4000 - ang) & 0xFFFF)
    if b & 1:
        hl = neg16(hl)
    wr16(s, 0xA9, hl)
    if b & 2:
        de = neg16(de)
    wr16(s, 0xAB, de)
    wr16(s, 0xAF, (de - rd16(s, 0x0B)) & 0xFFFF)
    wr16(s, 0xAD, (hl - rd16(s, 0x09)) & 0xFFFF)


def cup_wall(s):                        # 10:7A63: low in the cup: the wall turns part of the speed into vz
    s[0xBA] = 0
    d = dist(rd16(s, 0xAD), rd16(s, 0xAF))
    wr16(s, 0xB3, d)
    q = _div(*_ahl(_abs(rd16(s, 0x06)) * 0x80), 0x400)
    hl, de = g.mul_sin_cos(d, (q & 0xFF) << 8)
    wr16(s, 0x0D, (rd16(s, 0x0D) + ((de << 1) & 0xFFFF)) & 0xFFFF)
    c = hl
    s[0xBA] = (s[0xBA] << 1 | _sgn(c)) & 0xFF
    c = _abs(c)
    dv = rd16(s, 0xB3) or 1
    ad = rd16(s, 0xAD)
    s[0xBA] = (s[0xBA] << 1 | _sgn(ad)) & 0xFF
    q = _div(*_ahl(_abs(ad) * c), dv)
    if not ((s[0xBA] & 1) + (s[0xBA] >> 1 & 1)) & 1:
        q = neg16(q)
    wr16(s, 0xAD, q)
    af = rd16(s, 0xAF)
    s[0xBA] = (s[0xBA] & 0xFE) | _sgn(af)
    q = _div(*_ahl(_abs(af) * c), dv)
    if not ((s[0xBA] & 1) + (s[0xBA] >> 1 & 1)) & 1:
        q = neg16(q)
    wr16(s, 0xAF, q)


def cup_deflect(s):                     # 10:760E: off the rim (and the wall when low): new velocity
    reflect(s)
    if (_abs(rd16(s, 0x06)) - 0x400) & 0x8000:
        cup_wall(s)
    vx = (rd16(s, 0xA9) + rd16(s, 0xAD)) & 0xFFFF
    wr16(s, 0x09, vx)
    vy = (rd16(s, 0xAB) + rd16(s, 0xAF)) & 0xFFFF
    wr16(s, 0x0B, vy)
    return dist(vx, vy)


def pin_bounce(s, fx):                  # 10:765F: off the pin: velocity = half the reflected difference
    s[0x8E] |= 2
    fx.append(("sound", 0x58))
    reflect(s)
    for o_out, o_a, o_b in ((0x09, 0xAD, 0xA9), (0x0B, 0xAF, 0xAB)):
        v = (rd16(s, o_a) - rd16(s, o_b)) & 0xFFFF
        t = _sra16(_abs(v), 1)
        wr16(s, o_out, neg16(t) if v & 0x8000 else t)


def pin_dist(s):                        # 10:62AD: |ball - cup| with the fractions, normalised before squaring
    return dist24(((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFFFF) << 8 | s[0x00],
                  ((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFFFF) << 8 | s[0x03])


def shot_length(s, start):              # 10:6276: |start - ball| (start = $D5F8-$D5FD, kept by 02:4679)
    def p24(b, o):
        return b[o] | b[o + 1] << 8 | b[o + 2] << 16
    return dist24((p24(start, 0) - p24(s, 0)) & 0xFFFFFF, (p24(start, 3) - p24(s, 3)) & 0xFFFFFF)


def dist24(x, y):                       # 10:62DA: the length of a 24-bit (8.8 + 8) vector
    x = (-x) & 0xFFFFFF if x & 0x800000 else x
    y = (-y) & 0xFFFFFF if y & 0x800000 else y
    m = (y >> 16) | (x >> 16)
    a, n = ((m << 1) | 1) & 0xFF, 0
    if not m & 0x80:
        while True:
            c, a = a >> 7, (a << 1) & 0xFF
            if c:
                break
            x, y, n = (x << 1) & 0xFFFFFF, (y << 1) & 0xFFFFFF, n + 1
    py, px = (y >> 8) ** 2, (x >> 8) ** 2
    hl = ((px >> 16) + (py >> 16)) & 0xFFFF
    lo = ((px >> 8) & 0xFF) + ((py >> 8) & 0xFF)
    if lo > 0xFF:
        hl = (hl + 1) & 0xFFFF
    r = (isqrt24(hl, lo & 0xFF) << 4) & 0xFFFF
    return r >> n


def pin_far(s, hl):                     # 10:735A: a = 1 when pin_dist is above hl
    return 1 if (hl - pin_dist(s)) & 0x8000 else 0


def pin_check(s, fx):                   # 10:72E7 PinCheck
    if s[0xD5] or s[0xB9] & 1 or s[0x08]:
        return
    if s[0x07] >= 0xE8:
        return
    high = s[0x07] >= 0xC0
    if pin_far(s, 2):
        return
    s[0xB9] |= 1
    if high:                            # hits the flagstick: drops
        s[0x8E] |= 4
        fx.append(("sound", 0x59))
        s[0xB9] |= 2
        for o in range(0x09, 0x0F):
            s[o] = 0
    else:
        pin_normal(s)
        pin_contact(s)
        pin_bounce(s, fx)


def fly_in(s):                          # 10:7263 CupFlyIn: next height below 0 within 6 of the cup
    if not s[0x15]:
        return 0
    vz = rd16(s, 0x0D)
    if not vz & 0x8000:
        return 0
    s[0xB3], s[0xB4], s[0xB5] = s[0x06], s[0x07], s[0x08]
    add_vel_to_pos(s, 0xB3, (vz - 0x38) & 0xFFFF)
    if not s[0xB5] & 0x80:
        return 0
    if cup_close(s) >= 6:
        return 0
    s[0x15] = 0
    return 1


def cup_close(s):                       # the squared-offset distance used by 10:6F61 and 10:72A9
    dy = ((rd16(s, 0x04) - rd16(s, 0x3F)) & 0xFF) << 8
    dx = ((rd16(s, 0x01) - rd16(s, 0x3D)) & 0xFF) << 8
    t = g.mul_hl_by_de_both_signed(dx, dx) + g.mul_hl_by_de_both_signed(dy, dy)
    return g.isqrt_hl(t & 0xFFFF)


def roll_in(s):                         # 10:716B CupRollIn: $D4B1 = 1 when the ball drops
    s[0xBB], s[0xBC], s[0xBD], s[0xBE] = s[0x99], s[0x9A], s[0x9B], s[0x9C]
    wr16(s, 0x99, _offset(s, 0x01, 0x00, 0x3D))
    wr16(s, 0x9B, _offset(s, 0x04, 0x03, 0x3F))
    if not s[0xD5]:
        if cup_offsets(s) >> 8 < 2:
            s[0xB1] = 1
            return
    pin_normal(s)
    dx = _abs((rd16(s, 0x99) - rd16(s, 0x9D)) & 0xFFFF)
    dy = _abs((rd16(s, 0x9B) - rd16(s, 0x9F)) & 0xFFFF)
    c, _ = g.mul_sin_cos(0x40, g.angle_from_vector16(dy, dx))
    v = dx << 8
    v = (v - 0x1000000 if dx & 0x8000 else v) >> 2
    q = _div((v >> 16) & 0xFF, v & 0xFFFF, c)
    q = (q * 2) & 0xFFFF
    sp = dist(rd16(s, 0x09), rd16(s, 0x0B))
    s[0xB1] = 1 if ((((sp * 3) & 0xFFFF) - q) & 0x8000) else 0


def rim_clamp(s):                       # 10:78AD: inside the cup, keep the ball within 6 of its centre
    s[0xBB], s[0xBC], s[0xBD], s[0xBE] = s[0x99], s[0x9A], s[0x9B], s[0x9C]
    s[0xB8] = 0
    d = cup_offsets(s)
    if d >> 8 < 2:
        s[0xB8] |= 2
    if d >> 8 < 6:
        return
    s[0xB8] |= 1
    for o_off, o_pos, o_cup in ((0x99, 0x00, 0x3D), (0x9B, 0x03, 0x3F)):
        v = rd16(s, o_off)
        q = _div(*_ahl(_abs(v) * 0x600), d)
        if v & 0x8000:
            q = neg16(q)
        wr16(s, o_off, q)
        s[o_pos] = 0
        s[o_pos + 1], s[o_pos + 2] = s[o_cup], s[o_cup + 1]
        add_vel_to_pos(s, o_pos, q)
    wr16(s, 0xA5, dist(rd16(s, 0x99), rd16(s, 0x9B)))


def cup_sink(s):                        # 10:7860: vz -= $38; a = 1 at the bottom (height -$14 and below)
    vz = (rd16(s, 0x0D) - 0x38) & 0xFFFF
    wr16(s, 0x0D, vz)
    if (s[0x07] - 0xEC) & 0x80:
        return 1
    add_vel_to_pos(s, 0x06, vz)
    return 0


def cup_drop(s, frame, fx):             # 10:79AF CupDrop: one AdvanceFrame (frame()) per pass; BallTask is off
    """Returns 1 (the ball reached the bottom) or 2 (it bounced out: back in the air)."""
    s[0x15] = 0
    s[0xB8] = 0
    fx.append(("task", "off"))
    while True:
        if s[0xB8]:
            if not s[0x08] & 0x80:
                s[0x44] = 0
                s[0x15] = 1
                a = 2
                break
            pin_normal(s)
            pin_contact(s)
            if s[0xB8] & 2:
                if not s[0xD5] and not s[0xB9]:
                    s[0xB9] = 1
            elif s[0xB8] & 1:
                cup_deflect(s)
        add_vel_to_pos(s, 0x00, rd16(s, 0x09))
        add_vel_to_pos(s, 0x03, rd16(s, 0x0B))
        rim_clamp(s)
        a = cup_sink(s)
        frame(1)
        if a:
            break
    fx.append(("task", "on"))
    return a


def hole_out_place(s, frame):           # 10:7888 HoleOutPlace: ball on the cup, 30-frame wait
    for o in range(0x09, 0x0D):
        s[o] = 0
    s[0x00], s[0x01], s[0x02] = 0, s[0x3D], s[0x3E]
    s[0x03], s[0x04], s[0x05] = 0, s[0x3F], s[0x40]
    frame(30)
