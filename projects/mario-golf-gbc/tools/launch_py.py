"""ShotLaunch (10:5F94) in Python: the swing result -> the ball's launch speed, elevation, direction, spin and
curve, and its starting velocity. Works on the game's RAM (a tools/sm83.py Machine used as memory), like
shot_py.py; every table is read from the ROM where the code reads it. Checked against the ROM by
tools/test_launch.py.

RAM read: wClub $D329, wShotMode $D32A, $D32B (putter range), $D321 (golfer), $D333 bit 0 (mirrored: left-
handed?), swing $D44B-$D450, wLie $D446, $D445, the lie terrain $D4CD, golfer stats $D4C6 (driver distance),
$D4C8 (trajectory), $D4CA, $D4CB, $D4CC (equipment bits), the computer's $D4BF / $D4D8 / $D4D9, aim $D418.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
import golfmath as g
from ball_sim import rd16, wr16

_rom = load_rom()


def rb(bank, addr):
    return _rom[to_offset(bank, addr) if addr >= 0x4000 else addr]


def rw(bank, addr):
    return rb(bank, addr) | rb(bank, addr + 1) << 8


def _ptr(base, off):                    # "add a,l / ld l,a / adc a,h / sub l / ld h,a": 16-bit base + 8-bit offset
    return (base + (off & 0xFF)) & 0xFFFF


def mul_round(hl, de):                  # MulHLByDE, + 1 when bit 15 of the product ($FFA9 bit 7) is set
    p = hl * de
    return ((p >> 16) + ((p >> 15) & 1)) & 0xFFFF


def club_distance(club, hl, b):         # 02:511A ClubDistance
    if club:
        return mul_round(hl, rw(0x02, 0x5171 + 2 * club))
    if b & 2:                           # equipment: +10%, at most 400
        hl = (hl + g.mul_hl_by_de(hl, 0x1999)) & 0xFFFF
        return hl if ((hl - 0x190) & 0x8000) else 0x190
    if b & 4:                           # -5%
        return mul_round(hl, 0xF333)
    return hl


def elevation(club, l):                 # 02:518B: launch elevation for the club and trajectory class l
    if club == 0x0D:
        return 0
    de = rw(0x02, 0x51DC + 2 * club)
    return (rw(0x02, _ptr(0x51BC, (((l + 8) & 0x0F) * 2))) + de) & 0xFFFF


def adjust_02_534b(a, club, e):         # 02:534B: the driver's shot shape with equipment bits e
    h = a
    if club:
        return h
    if e & 2:
        if not e & 1:
            if h == 4:
                return 4
            h = (h + 1) & 0xFF
            return h if h == 4 else (h + 1) & 0xFF
        if h == 0xFC:
            return 0xFC
        h = (h - 1) & 0xFF
        return h if h == 0xFC else (h - 1) & 0xFF
    return 0 if e & 4 else h


def shape(w):                           # 10:6B03: shot shape (signed), mirrored with $D333 bit 0
    s = w.wram[6]
    a = adjust_02_534b(s[0x4CA], s[0x329], s[0x4CC])
    return (-a) & 0xFF if s[0x333] & 1 else a


def curve_08_607c(hl, a):               # 08:607C
    t = rw(0x08, _ptr(0x609C, ((a + 8) & 0x0F) * 2))
    return g.mul_hl_by_a_frac_signed((t * 2) & 0xFFFF, (hl >> 1) & 0xFF)


def club_params(w):                     # 10:5EEF ShotClubParams
    r6 = w.wram[6]
    club = r6[0x329]
    p = rw(0x10, 0x61A6 + 2 * club)     # ClubParamTable
    r6[0x411], r6[0x412], r6[0x416], r6[0x417] = rb(0x10, p), rb(0x10, p + 1), rb(0x10, p + 2), rb(0x10, p + 3)
    if club == 0x0D:
        for o in (0x41C, 0x41D, 0x41A, 0x41B, 0x40F, 0x410):
            r6[o] = 0
        return
    wr16(r6, 0x41A, elevation(club, r6[0x4C8]))
    hl = club_distance(club, rd16(r6, 0x4C6), r6[0x4CC])
    wr16(r6, 0x41C, curve_08_607c(hl, shape(w)))
    wr16(r6, 0x40F, (rw(0x10, _ptr(0x5F74, ((shape(w) + 8) & 0x0F) * 2)) * 2) & 0xFFFF)   # CurveStartTable


def miss_index(w):                      # 10:6B1F: the impact cursor through the golfer's table ($D321)
    r6 = w.wram[6]
    a = r6[0x44F]
    if r6[0x333] & 1:
        a = (-a) & 0xFF
    if a & 0x80:
        a = a if a >= 0xF2 else 0xF2
    elif a >= 0x0E:
        a = 0x0E
    t = rw(0x10, _ptr(0x6B5B, (w.wram[6][0x321] & 7) * 2))
    return rb(0x10, (t + (((a + 0x0E) & 0xFF) >> 1)) & 0xFFFF)


def miss_factor(w):                     # 10:6BC7: speed factor for the miss ($C9FD = the index)
    a = miss_index(w)
    w.wram[0][0x9FD] = a
    return rb(0x10, 0x6BDC + ((a + 9) & 0xFF))


def control(w, hl):                     # 10:6BEF: scale by the golfer's control ($D4CB), then x 2
    f = rb(0x10, 0x6C08 + ((w.wram[6][0x4CB] + 4) & 0x0F))
    if f:
        hl = g.mul_hl_by_a_frac_signed(hl, f)
    return (hl * 2) & 0xFFFF


def _word_at(base, b):                  # word table base indexed by the signed miss index b (-9..9)
    v = ((((b + 9) & 0xFF) * 2) & 0xFF) + (base & 0xFF)
    return rw(0x10, ((base & 0xFF00) + v) & 0xFFFF)


def miss_elevation(w, b):               # 10:6C18
    return control(w, _word_at(0x6C2E, b))


def miss_direction(w, b):               # 10:6C54 (x 1.5 from lie terrain $0C)
    hl = control(w, _word_at(0x6C79, b))
    if w.wram[6][0x4CD] == 0x0C:
        hl = (hl + g.mul_hl_by_a_frac_signed(hl, 0x80)) & 0xFFFF
    return hl


def miss_curve(w, b):                   # 10:6C9F
    return control(w, _word_at(0x6CB5, b))


def lie_class(w):                       # 10:6672
    r6 = w.wram[6]
    if r6[0x445]:
        return 0
    t, q = r6[0x4CD], r6[0x446]
    if t in (0x0D, 0x02):
        if q:
            return 5 if q == 1 else 6
    elif t in (0x00, 0x0E):
        if q:
            return 9 if q == 1 else 0x0A
    elif t == 1:
        if q:
            return 0x0B
    return rb(0x10, _ptr(0x66CB, t))


def lie_factor(w):                      # 10:65EF LieFactor: (d, e) bytes and the next word of the club's row
    p = (rw(0x10, _ptr(0x660E, w.wram[6][0x329] * 2)) + lie_class(w) * 2) & 0xFFFF
    return rb(0x10, p + 1), rb(0x10, p), rw(0x10, p + 2)


def scale_by_power(hl, a):              # 10:6865 ScaleByPower
    return hl if a >= 0x3C else g.mul_hl_by_a_frac(hl, rb(0x10, 0x6875 + a))


def base_distance(w):                   # 10:68B1 ClubBaseDistance
    r6 = w.wram[6]
    club = r6[0x329]
    if club == 0x0D:
        return {0: 0x140, 1: 0x42A}.get(r6[0x32B], 0x855)
    if r6[0x32A] == 2:
        return 0x780
    if r6[0x32A] == 3:
        return 0x3C0
    hl = g.mul_hl_by_a(club_distance(club, rd16(r6, 0x4C6), r6[0x4CC]), 0x20)
    if r6[0x32A]:
        hl = (hl + g.mul_hl_by_de(hl, 0x199A)) & 0xFFFF
    return hl


TABLE_ROUTINES = [(0x39, 0x6A48)] * 5 + [(0x39, 0x5525), (0x39, 0x4006), (0x38, 0x6A02), (0x38, 0x4006),
                  (0x38, 0x550B), (0x3A, 0x4006), (0x3A, 0x54EB)] + [(0x3A, 0x69BC)] * 4   # 10:6D6A by $D4C8


def speed_table(w, club, de):           # the routine picked by 10:6D6A (banks 38-3A; same code, own tables)
    bank, addr = TABLE_ROUTINES[(w.wram[6][0x4C8] + 8) & 0x0F]
    assert rb(bank, addr + 0x10) == 0x01 and rb(bank, addr + 0x35) == 0x01
    t1, t2 = rw(bank, addr + 0x11), rw(bank, addr + 0x36)
    if club >= 0x0D:
        return 0x40
    if w.wram[6][0x32A] == 2:
        return rb(bank, (rw(bank, t2 + 2 * club) + (de & 0xFFFE)) & 0xFFFF)
    p = (rw(bank, t1 + 2 * club) + (de & 0xFFFE)) & 0xFFFF
    if not de & 1:
        return rw(bank, p)
    return ((rw(bank, p) + rw(bank, p + 2)) & 0xFFFF) >> 1


def adjust_08_60bc(hl, a):              # 08:60BC
    f = rb(0x08, _ptr(0x60D6, (a + 8) & 0x0F))
    return hl if not f else (hl + g.mul_hl_by_a_frac(hl, f)) & 0xFFFF


def shot_speed(w):                      # 10:6CDB ShotSpeed
    r6 = w.wram[6]
    club = r6[0x329]
    if club == 0x0D:                    # putter: by range $D32B and power
        t = rw(0x10, _ptr(0x6DCD, (r6[0x32B] & 3) * 2))
        return rw(0x10, (t + (r6[0x450] & 0xFE)) & 0xFFFF)
    hl = base_distance(w)
    d, e, _ = lie_factor(w)
    total = (d + e) & 0xFF
    if total >= 0xA0 and r6[0x32A] < 2 and r6[0x450] == 0x3C and r6[0x44F] == 0:
        r6[0x48E] |= 8                  # a perfect full shot from a good lie: the cue
    if total != 0xC6:
        hl = g.mul_hl_by_a_frac(hl, ((0x148 * total + 0x80) & 0xFFFF) >> 8)
    f = miss_factor(w)
    if f:
        hl = g.mul_hl_by_a_frac(hl, f)
    hl = scale_by_power(hl, r6[0x450])
    hl = ((hl + 0x10) & 0xFFFF) >> 5
    hl = adjust_08_60bc(hl, shape(w))
    return speed_table(w, club, hl)


def scale_6134(hl, de):                 # 10:6134: hl x e/256, or hl x (1 + e/256) when d is nonzero
    f = g.mul_hl_by_a_frac(hl, de & 0xFF)
    return f if not de >> 8 else (hl + f) & 0xFFFF


def shot_launch(w, fx=None):            # 10:5F94 ShotLaunch
    r6 = w.wram[6]
    r6[0x51D:0x523] = bytes(r6[0x400:0x406])                   # 10:52C2
    club_params(w)
    wr16(r6, 0x418, (rd16(r6, 0x418) + rd16(r6, 0x41C)) & 0xFFFF)
    if r6[0x4BF]:                       # the computer: its targets go into the meter
        hl = rd16(r6, 0x4C6)
        r6[0x44F], r6[0x450] = r6[0x4D9], r6[0x4D8]
        r6[0x44B] = r6[0x44C] = 0
    else:
        hl = shot_speed(w)
    hl = scale_6134(rd16(r6, 0x416), hl)
    imp = r6[0x44C]
    if imp:
        hl = g.mul_hl_by_a_frac(hl, 0xF9) if not imp & 0x80 else (hl + g.mul_hl_by_a_frac(hl, 7)) & 0xFFFF
    wr16(r6, 0x416, hl)
    club = r6[0x329]
    if club != 0x0D:
        b = miss_index(w)
        e = (rd16(r6, 0x41A) + miss_elevation(w, b)) & 0xFFFF
        wr16(r6, 0x41A, 0x3F00 if (e >> 8) >= 0x40 else e)
        wr16(r6, 0x418, (rd16(r6, 0x418) + miss_direction(w, b)) & 0xFFFF)
        wr16(r6, 0x40F, (rd16(r6, 0x40F) + miss_curve(w, b)) & 0xFFFF)
        imp = r6[0x44C]
        spin = scale_6134(rd16(r6, 0x411), (0 if imp & 0x80 else 0x100) | imp)
        wr16(r6, 0x411, scale_by_power(spin, r6[0x450]))
        side = (-r6[0x44B]) & 0xFF
        side = side | 0xFF00 if side & 0x80 else side
        wr16(r6, 0x40F, (rd16(r6, 0x40F) + ((side << 5) & 0xFFFF)) & 0xFFFF)
    hl, de = g.mul_sin_cos(rd16(r6, 0x416), rd16(r6, 0x41A))
    wr16(r6, 0x40D, de)
    hl, de = g.mul_sin_cos(hl, rd16(r6, 0x418))
    wr16(r6, 0x409, hl)
    wr16(r6, 0x40B, de)
    r6[0x415] = r6[0x489] = 0 if club == 0x0D else 1
    r6[0x48A], r6[0x48B], r6[0x48C], r6[0x48D] = r6[0x401], r6[0x402], r6[0x404], r6[0x405]
    if fx is not None:
        fx.append(("sound", "launch"))
