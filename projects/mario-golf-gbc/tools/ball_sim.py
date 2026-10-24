"""Mario Golf's ball step (BallTask 10:4D45) in Python, checked frame by frame against emulator recordings.

State = the ROM's WRAM6 bytes $D400-$D41F (a bytearray; offsets below are from $D400):
  00-02 x (8.16)   03-05 y   06-08 height   09 vx   0B vy   0D vz (8.8 signed)   0F curve   11 spin
  13 speed (byte)  14 direction (byte)  15 in-air flag
Implemented: the air step (BallFlightStep 10:4EE0), the bounce (10:4FF2-5212, except water and the bunker
plug), the landing test (BallLandCheck 10:4D09) and the roll (BallRollStep 10:4D86), off the green.
Wind: mph = $C815, direction = $C816.
usage: ball_sim.py RECORDING.json [--from FRAME] [--hole ID]   (hole id hex, default 0A)
  starts from the recorded state at FRAME (default: the first frame with the ball in the air) and steps the
  simulator once per recorded change, printing the first bytes that differ.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
import golfmath as g
from render_hole import rows, asset

_rom = load_rom()
WIND_SPEED = [_rom[to_offset(0x10, 0x5315 + 2 * i)] | _rom[to_offset(0x10, 0x5316 + 2 * i)] << 8 for i in range(32)]


TERRAIN_PROPS = [tuple(_rom[to_offset(0x10, 0x6825 + 4 * t):to_offset(0x10, 0x6825 + 4 * t) + 4]) for t in range(16)]
SLOPE_DIR = list(_rom[to_offset(0x10, 0x6516):to_offset(0x10, 0x6516) + 32])
GREEN_SLOPE = [_rom[to_offset(0x10, 0x6738 + 2 * i)] | _rom[to_offset(0x10, 0x6739 + 2 * i)] << 8 for i in range(4)]


class Hole:
    """The maps the ball code reads for hole id `hid` (HoleAssetTable 13:4A16)."""

    def __init__(self, hid):
        r = rows(_rom)[hid]
        self.attrs = asset(_rom, r[1], 0)       # WRAM2 $D000
        self.tmap = asset(_rom, r[1], 1)        # WRAM3 $D000
        self.slope = asset(_rom, r[1], 2)       # WRAM6 $D700, one byte per tile
        self.terrain = asset(_rom, r[0], 3)     # WRAM6 $D800, 8 bytes per tile
        self.slopes = asset(_rom, r[0], 4)      # WRAM1 $D800, 8 bytes per tile: slope nibble per cell

    def _cell(self, table, hl, de):
        i = ((de >> 8) * 64 + (hl >> 8)) & 0xFFF
        c, e = (hl & 0xFF) >> 6, (de & 0xFF) >> 6
        a = self.attrs[i]
        if a & 0x20:
            c = 3 - c
        if a & 0x40:
            e = 3 - e
        b = table[self.tmap[i] * 8 + e * 2 + (c >> 1)]
        return ((b & 0x0F) if c & 1 else (b >> 4)), a

    def slope_cell(self, hl, de):      # 10:674E (off the green): (nonzero, direction byte)
        n, a = self._cell(self.slopes, hl, de)
        if not n & 8:
            return 0, 0
        flip = (((a >> 2) | (a << 6)) & 0xFF) & 0x18
        return 0xFF, SLOPE_DIR[(n & 7) + flip]

    def terrain_at(self, hl, de):      # 10:6536 TerrainAt: hl = x, de = y (integer parts)
        i = ((de >> 8) * 64 + (hl >> 8)) & 0xFFF
        c, e = (hl & 0xFF) >> 6, (de & 0xFF) >> 6
        a = self.attrs[i]
        if a & 0x20:
            c = 3 - c
        if a & 0x40:
            e = 3 - e
        b = self.terrain[self.tmap[i] * 8 + e * 2 + (c >> 1)]
        return (b & 0x0F) if c & 1 else (b >> 4)

    def slope_at(self, hl, de):        # 10:64D1: (slope byte, direction byte b)
        i = ((de >> 8) * 64 + (hl >> 8)) & 0xFFF
        flip = (((self.attrs[i] >> 2) | (self.attrs[i] << 6)) & 0xFF) & 0x18   # rrca twice, and $18
        v = self.slope[self.tmap[i]]
        return v, SLOPE_DIR[(v & 7) + flip]


def rd16(s, o):
    return s[o] | s[o + 1] << 8


def wr16(s, o, v):
    s[o], s[o + 1] = v & 0xFF, (v >> 8) & 0xFF


def add_vel_to_pos(s, o, de):          # 10:52DA: 24-bit position += sign-extended 8.8 velocity
    v = s[o] | s[o + 1] << 8 | s[o + 2] << 16
    de = de - 0x10000 if de & 0x8000 else de
    v = (v + de) & 0xFFFFFF
    s[o], s[o + 1], s[o + 2] = v & 0xFF, (v >> 8) & 0xFF, v >> 16


def speed_and_dir(s):                  # 10:4CDE BallSpeedAndDir
    vx, vy = rd16(s, 0x09), rd16(s, 0x0B)
    s[0x14] = g.angle_from_vector16(vy, vx) >> 8    # hl = vy, de = vx: measured from the +x axis toward +y
    xx = g.mul_hl_by_de_both_signed(vx, vx)
    yy = g.mul_hl_by_de_both_signed(vy, vy)
    s[0x13] = g.isqrt_hl((xx + yy) & 0xFFFF)


def wind(s, mph, wdir):                # 10:52EE: (hl = speed, bc = direction << 8); none on the ground
    if not (s[0x06] | s[0x07] | s[0x08]):
        return 0, 0
    return WIND_SPEED[mph & 0x1F], wdir << 8


def toward_256(target, v):             # 10:5268 on (target - v): de = (target - v) / 256 rounded toward zero
    hl = (target - v) & 0xFFFF
    if hl & 0x8000:
        hl = (hl + 0xFF) & 0xFFFF
        return (0xFF00 | (hl >> 8)) if hl >> 8 else 0
    return hl >> 8


def spin_decay(spin):                  # 10:4F5A-4F81: spin += -spin/128, rounded away from zero
    n = (-spin) & 0xFFFF
    sign = 0xFF if n & 0x8000 else 0
    v = ((sign << 16) | n) << 1                 # sign:b:c shifted left once (24 bits)
    bc = (v >> 8) & 0xFFFF
    if (v & 0xFF) and not sign:                 # 10:4F73: low byte non-zero and positive -> round up
        bc = (bc + 1) & 0xFFFF
    return (spin + bc) & 0xFFFF


def flight_step(s, mph, wdir):         # 10:4EE0 BallFlightStep (without the bounce branch)
    speed_and_dir(s)
    hl = g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), s[0x13])
    hl = g.mul_hl_by_a_frac_signed(hl, 0x1C)
    cos_, sin_ = g.mul_sin_cos_signed(hl, ((s[0x14] + 0x40) & 0xFF) << 8)
    wr16(s, 0x0B, rd16(s, 0x0B) + sin_)
    wr16(s, 0x09, rd16(s, 0x09) + cos_)
    ws, wb = wind(s, mph, wdir)
    b = ((s[0x14] - (wb >> 8)) + 0x80) & 0xFF
    hl, _ = g.mul_sin_cos(ws, b << 8)
    air = (hl + (s[0x13] << 8)) & 0xFFFF
    hl = g.mul_hl_by_de_both_signed(rd16(s, 0x11), air)
    hl = g.mul_hl_by_a_frac_signed(hl, 0x1C)
    wr16(s, 0x0D, (hl + rd16(s, 0x0D) - 0x20) & 0xFFFF)
    wr16(s, 0x11, spin_decay(rd16(s, 0x11)))
    ws, wb = wind(s, mph, wdir)
    wc, wsn = g.mul_sin_cos(ws, wb)
    vx = rd16(s, 0x09)
    vx = (vx + toward_256(wc, vx)) & 0xFFFF
    wr16(s, 0x09, vx)
    add_vel_to_pos(s, 0x00, vx)
    vy = rd16(s, 0x0B)
    vy = (vy + toward_256(wsn, vy)) & 0xFFFF
    wr16(s, 0x0B, vy)
    add_vel_to_pos(s, 0x03, vy)
    vz = rd16(s, 0x0D)
    vz = (vz - toward_256(vz, 0)) & 0xFFFF
    wr16(s, 0x0D, vz)
    add_vel_to_pos(s, 0x06, vz)
    return bool(s[0x08] & 0x80)        # height went negative: the bounce branch (not implemented yet)


def land_check(s):                     # 10:4D09 BallLandCheck
    if rd16(s, 0x07):
        return
    vz = rd16(s, 0x0D)
    if vz & 0x8000:
        vz = (-vz) & 0xFFFF
    if vz >> 8 or (vz & 0xFF) >= 0x20:
        return
    s[0x15] = 0
    s[0x06] = s[0x07] = s[0x08] = 0
    s[0x0D] = s[0x0E] = 0


def ball_xy(s):
    return rd16(s, 0x01), rd16(s, 0x04)


def slope(s, hole):                    # 10:66DB: (magnitude, direction byte, nonzero)
    x, y = ball_xy(s)
    if not s[0x43] or s[0x43] == 4:     # off the green: 10:674E
        nz, b = hole.slope_cell(x, y)
        return (0x20, b, nz) if nz else (0, 0, 0)
    raise NotImplementedError("slope on the green (10:66F1 / 10:64D1)")
    v, b = hole.slope_at(x, y)
    strength = (v >> 4) & 3
    if not strength:
        return 0, 0, 0
    if hole.terrain_at(x, y) == 6:
        return GREEN_SLOPE[strength], b, 0xFF
    return 0x20, b, 0xFF


def terrain_props(s, hole):            # 10:67E4 (off the green): (type, props)
    if s[0x43] and s[0x43] < 4:
        raise NotImplementedError("terrain on the green")
    t = hole.terrain_at(*ball_xy(s))
    return t, TERRAIN_PROPS[t]


def bounce(s, hole):                   # 10:4FF2-5212: the ball went below the ground in the air step
    t, props = terrain_props(s, hole)
    s[0x48], s[0x49] = props[0], props[2]
    if t == 3:
        return "water"
    if t in (2, 0x0D):
        b = g.angle_from_vector16(s[0x13] << 8, neg16(rd16(s, 0x0D))) >> 8
        if b < 0x14:
            return "plugged"
    h = g.mul_hl_by_a_frac_signed(rd16(s, 0x06), s[0x48])
    wr16(s, 0x06, neg16(h))
    s[0x08] = 0
    wr16(s, 0x0D, neg16(g.mul_hl_by_a_frac_signed(rd16(s, 0x0D), s[0x48])))
    speed_and_dir(s)
    if not s[0x43]:
        _, b, nz = slope(s, hole)
        if nz:
            s[0x4A] = b & 0xF0
            shl, sde = g.vector_from_length_and_angle_raw(0xFFE0, s[0x4A])
            vz = rd16(s, 0x0D)
            wr16(s, 0x0D, g.mul_hl_by_a_frac_signed(vz, 0x80))
            hl = g.mul_hl_by_a_frac_signed(vz, 0xDD)
            chl, cde = g.mul_sin_cos(hl, s[0x4A] << 8)
            wr16(s, 0x09, rd16(s, 0x09) + chl + shl)
            wr16(s, 0x0B, rd16(s, 0x0B) + cde + sde)
    vx, vy = rd16(s, 0x09), rd16(s, 0x0B)
    hl = g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), s[0x13])
    hl = g.mul_hl_by_a_frac_signed(hl, 0x40)
    c_hl, c_de = g.mul_sin_cos_signed(hl, ((s[0x14] + 0x40) & 0xFF) << 8)
    hl = g.mul_hl_by_a_frac(rd16(s, 0x11), 0x40)
    s_hl, s_de = g.mul_sin_cos(hl, ((s[0x14] + 0x80) & 0xFF) << 8)
    nvx = (s_hl + c_hl + vx) & 0xFFFF
    nvy = (s_de + c_de + vy) & 0xFFFF
    wr16(s, 0x09, g.mul_hl_by_a_frac_signed(nvx, s[0x49]))
    wr16(s, 0x0B, g.mul_hl_by_a_frac_signed(nvy, s[0x49]))
    wr16(s, 0x11, g.mul_hl_by_a_frac_signed(rd16(s, 0x11), s[0x48]))
    wr16(s, 0x0F, g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), s[0x48]))
    return "bounce"


def green_scale(s, hl, de):            # 10:4E98: on the green the slope push scales with the ball speed
    vx, vy = rd16(s, 0x09), rd16(s, 0x0B)
    ay = neg16(vy) if vy & 0x8000 else vy
    if ay >> 8:
        return hl, de
    ax = neg16(vx) if vx & 0x8000 else vx
    if ax >> 8:
        return hl, de
    b = g.isqrt_hl((g.mul_hl_by_a(ax, ax & 0xFF) + g.mul_hl_by_a(ay, ay & 0xFF)) & 0xFFFF)
    return g.mul_hl_by_a_frac_signed(hl, b), g.mul_hl_by_a_frac_signed(de, b)


def roll_step(s, hole):                # 10:4D86 BallRollStep
    speed_and_dir(s)
    hl = g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), s[0x13])
    hl = g.mul_hl_by_a_frac_signed(hl, 0x40)
    c_hl, c_de = g.mul_sin_cos_signed(hl, ((s[0x14] + 0x40) & 0xFF) << 8)
    wr16(s, 0x0B, rd16(s, 0x0B) + c_de)
    wr16(s, 0x09, rd16(s, 0x09) + c_hl)
    wr16(s, 0x0F, g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), 0xFC))
    hl = g.mul_hl_by_a_frac(rd16(s, 0x11), s[0x13])
    hl = g.mul_hl_by_a_frac_signed(hl, 0x40)
    s_hl, s_de = g.mul_sin_cos(hl, s[0x14] << 8)
    wr16(s, 0x0B, rd16(s, 0x0B) + s_de)
    wr16(s, 0x09, rd16(s, 0x09) + s_hl)
    wr16(s, 0x11, g.mul_hl_by_a_frac_signed(rd16(s, 0x11), 0xFC))
    mag, b, nz = slope(s, hole)
    p_hl, p_de = g.mul_sin_cos(mag, b << 8) if nz else (0, 0)
    t, props = terrain_props(s, hole)
    if t == 3:
        return "water"
    if t == 6:
        p_hl, p_de = green_scale(s, p_hl, p_de)
    vx = g.mul_hl_by_a_frac_signed((p_hl + rd16(s, 0x09)) & 0xFFFF, props[1])
    wr16(s, 0x09, vx)
    add_vel_to_pos(s, 0x00, vx)
    vy = g.mul_hl_by_a_frac_signed((p_de + rd16(s, 0x0B)) & 0xFFFF, props[1])
    wr16(s, 0x0B, vy)
    add_vel_to_pos(s, 0x03, vy)
    return "roll"


def neg16(v):
    return (-v) & 0xFFFF


def ball_step(s, mph, wdir, hole):
    """One BallTask frame; returns what happened ('air', 'bounce', or a branch not simulated)."""
    if s[0x15]:
        what = "air"
        if flight_step(s, mph, wdir):
            what = bounce(s, hole)
            if what not in ("bounce",):
                return what
        land_check(s)
        return what
    return roll_step(s, hole)


def main():
    a = sys.argv[1:]
    rec = json.load(open(a[0]))
    mph, wdir = rec["wind"]
    frames = [(f, bytearray(bytes.fromhex(h))) for f, h in rec["frames"]]
    start = int(a[a.index("--from") + 1]) if "--from" in a else next(f for f, d in frames if d[0x15])
    i = next(k for k, (f, _) in enumerate(frames) if f >= start)
    s = bytearray(frames[i][1])
    hole = Hole(int(a[a.index("--hole") + 1], 16) if "--hole" in a else 0x0A)
    names = {0: "x", 3: "y", 6: "h", 9: "vx", 0xB: "vy", 0xD: "vz", 0xF: "curve", 0x11: "spin", 0x13: "speed", 0x14: "dir", 0x15: "air"}
    ok = 0
    for f, want in frames[i + 1:]:  # one recorded entry per BallTask call
        what = ball_step(s, mph, wdir, hole)
        diff = [k for k in range(0x16) if s[k] != want[k]]
        if diff:
            print("frame %d (%s): differs at %s" % (f, what, " ".join("$%02x" % (0xD400 + k) for k in diff)))
            for k in sorted({max(n for n in names if n <= k) for k in diff}):
                print("   %-5s sim %s  game %s" % (names[k], s[k:k + 3].hex(), want[k:k + 3].hex()))
            break
        ok += 1
        if what not in ("air", "bounce", "roll"):
            print("frame %d: %s (not simulated further)" % (f, what))
            break
    print("%d frames matched from frame %d" % (ok, frames[i][0]))


if __name__ == "__main__":
    main()
