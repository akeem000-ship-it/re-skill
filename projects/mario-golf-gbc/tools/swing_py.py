"""The swing in Python: what runs between the golfer addressing the ball (10:56B0) and ShotLaunch (10:5F94).
Main thread parts are methods of shot_py.Shot (address, swing, after_swing); this module has the frame tasks
that run meanwhile and the helpers, all on the game's RAM (a tools/sm83.py Machine used as memory).

Frame tasks, in their slot order (00:247D runs them each AdvanceFrame after VBlank read the joypad):
  11:6E3E  the golfer's swing animation: a script of (sprite frame, duration) pairs; $FE marks the club
           meeting the ball ($D464 = 1), $FF ends it
  11:4113  the ball display (sprites not modelled) and, with $D485 bit 4 set in views 0, 1, 4-6, the
           landing preview (11:4E5E): a ghost ball flown from the shot's perfect-swing launch
  10:55AC  during the swing: the d-pad held -> impact side and height ($D44B / $D44C, table 10:55CE)
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
import golfmath as g
import ball_sim as bs
import launch_py as lp
from ball_sim import rd16, wr16

_rom = load_rom()
rb, rw = lp.rb, lp.rw
TREE_ANGLE = _rom[to_offset(0x08, 0x5326):to_offset(0x08, 0x5326) + 256]
TREE_DIST = _rom[to_offset(0x08, 0x5426):to_offset(0x08, 0x5426) + 256]


# -- 11:6D8F / 11:6E3E: the swing animation --
def anim_start(w, kind):                # 11:6D8F: kind 1 backswing, 2 downswing, 3 back to the address pose
    r6 = w.wram[6]
    c = rb(0x11, 0x6DEE + r6[0x329])    # per club
    a = (rb(0x11, 0x6DFE + (kind & 3) * 2 + (1 if r6[0x32A] == 2 else 0)) + c) & 0xFF
    t = rw(0x11, 0x6ECD + r6[0x332] * 2)                 # per golfer sprite set
    wr16(r6, 0x462, rw(0x11, (t + ((a * 2) & 0xFF)) & 0xFFFF))
    r6[0x464] = r6[0x467] = 0
    r6[0x466] = 1
    r6[0x465] = 0xFF


def anim_task(w):                       # 11:6E3E
    r6 = w.wram[6]
    r6[0x466] = (r6[0x466] - 1) & 0xFF
    if r6[0x466]:
        return
    while True:
        r6[0x465] = (r6[0x465] + 1) & 0xFF
        p = (rd16(r6, 0x462) + 2 * r6[0x465]) & 0xFFFF
        a = rb(0x11, p)
        if a == 0xFE:                   # contact
            r6[0x464] = 1
            continue
        if a == 0xFF:                   # end: hold the last frame
            r6[0x464] = 1
            r6[0x466] = 0xFF
            r6[0x465] = (r6[0x465] - 1) & 0xFF
            return
        r6[0x467] = a
        r6[0x466] = rb(0x11, p + 1)
        return


# -- 11:4E5E: the landing preview --
def preview_restart(w):                 # 10:543C: the ghost ball from a perfect full swing with the current aim
    r6 = w.wram[6]
    r6[0x373:0x379] = bytes(r6[0x514:0x51A])           # 10:5518: from the ball's address spot
    r6[0x379:0x37C] = b"\0\0\0"
    r6[0x37C:0x382] = b"\0" * 6
    r6[0x51A], r6[0x51B] = r6[0x418], r6[0x419]
    lp.club_params(w)
    wr16(r6, 0x418, (rd16(r6, 0x418) + rd16(r6, 0x41C)) & 0xFFFF)
    power, cursor = r6[0x450], r6[0x44F]
    r6[0x450], r6[0x44F] = 0x3C, 0
    hl = lp.shot_speed(w)
    r6[0x48E] = 0
    r6[0x44F], r6[0x450] = cursor, power
    wr16(r6, 0x416, lp.scale_6134(rd16(r6, 0x416), hl))
    side = (-r6[0x44B]) & 0xFF
    side = side | 0xFF00 if side & 0x80 else side
    wr16(r6, 0x40F, (rd16(r6, 0x40F) + ((side << 5) & 0xFFFF)) & 0xFFFF)
    hl, de = g.mul_sin_cos(rd16(r6, 0x416), rd16(r6, 0x41A))
    wr16(r6, 0x380, de)
    hl, de = g.mul_sin_cos(hl, rd16(r6, 0x418))
    wr16(r6, 0x37C, hl)
    wr16(r6, 0x37E, de)
    r6[0x418], r6[0x419] = r6[0x51A], r6[0x51B]


def preview_step(w):                    # 10:5355: BallFlightStep on the ghost ball, with the real ball's speed,
    r6 = w.wram[6]                      # direction, curve and spin (and its height for the wind)
    s = memoryview(r6)[0x400:0x500]
    bs.speed_and_dir(s)
    mph, wdir = w.wram[0][0x815], w.wram[0][0x816]
    hl = g.mul_hl_by_a_frac_signed(rd16(s, 0x0F), s[0x13])
    hl = g.mul_hl_by_a_frac_signed(hl, 0x1C)
    c, sn = g.mul_sin_cos_signed(hl, ((s[0x14] + 0x40) & 0xFF) << 8)
    wr16(r6, 0x37E, (rd16(r6, 0x37E) + sn) & 0xFFFF)
    wr16(r6, 0x37C, (rd16(r6, 0x37C) + c) & 0xFFFF)
    ws, wb = bs.wind(s, mph, wdir)
    hl, _ = g.mul_sin_cos(ws, (((s[0x14] - (wb >> 8)) + 0x80) & 0xFF) << 8)
    air = (hl + (s[0x13] << 8)) & 0xFFFF
    hl = g.mul_hl_by_a_frac_signed(g.mul_hl_by_de_both_signed(rd16(s, 0x11), air), 0x1C)
    wr16(r6, 0x380, (hl + rd16(r6, 0x380) - 0x20) & 0xFFFF)
    ws, wb = bs.wind(s, mph, wdir)
    wc, wsn = g.mul_sin_cos(ws, wb)
    for o_v, o_p, target in ((0x37C, 0x373, wc), (0x37E, 0x376, wsn)):
        v = rd16(r6, o_v)
        v = (v + bs.toward_256(target, v)) & 0xFFFF
        wr16(r6, o_v, v)
        bs.add_vel_to_pos(r6, o_p, v)
    v = rd16(r6, 0x380)
    v = (v - bs.toward_256(v, 0)) & 0xFFFF
    wr16(r6, 0x380, v)
    bs.add_vel_to_pos(r6, 0x379, v)


def preview_tree(w, hole):              # 08:5109: does the ghost ball hit a tree? (not in view 1)
    r6 = w.wram[6]
    if r6[0x443] == 1:
        return 0
    if r6[0x519] == r6[0x378] and r6[0x516] == r6[0x375]:
        return 0
    hole.use(1 <= r6[0x443] <= 3)
    if not hole.slope[hole.tmap[(r6[0x378] & 0x3F) << 6 | (r6[0x375] & 0x3F)]] & 0x80:
        return 0
    a = (((r6[0x37A] | r6[0x37B] << 8) << 3) & 0xFFFF) >> 8
    if a >= 0x18:
        return 0
    c = r6[0x4F3 + (a & 0x1F)]
    if not c:
        return 0
    e = (r6[0x377] & 0xF0) | (r6[0x374] >> 4)
    b = g.angle_from_vector16(rd16(r6, 0x37E), rd16(r6, 0x37C)) >> 8
    _, de = g.vector_from_length_and_angle_raw(TREE_DIST[e], (TREE_ANGLE[e] - b) & 0xFF)
    return 1 if (bs._abs16(de) & 0xFF) < (c & 0xFE) else 0


def preview_frame(w, hole, fx):         # 11:4E5E, once per frame while the preview is on
    r6 = w.wram[6]
    if not r6[0x480] & 0x1F:            # every 32 frames: start again
        preview_restart(w)
    elif r6[0x382]:
        r6[0x382] = 0
    if not r6[0x513]:
        preview_step(w)
    a = preview_tree(w, hole)
    old, r6[0x513] = r6[0x513], a
    if a and not old:
        fx.append(("sound", 0x56))      # the ghost ball hits a tree
    r6[0x480] = (r6[0x480] + 1) & 0xFF


def preview_on(w):                      # 11:4113's views 0, 1 and 4-6 call 11:4E5E when $D485 bit 4 is set
    r6 = w.wram[6]
    return bool(r6[0x485] & 0x10) and (r6[0x443] & 7) in (0, 1, 4, 5, 6)


def meter_task(w):                      # 10:55AC: the d-pad held during the swing
    r6, held = w.wram[6], w.high[0x190]
    r6[0x44D] = held
    i = (((held >> 3) | (held << 5)) & 0xFF) & 0x1E
    r6[0x44B], r6[0x44C] = rb(0x10, 0x55CE + i), rb(0x10, 0x55CF + i)


# -- main-thread helpers --
def meter_reset(w):                     # 10:55FF
    r6 = w.wram[6]
    r6[0x44E] = r6[0x44F] = r6[0x451] = r6[0x452] = 0
    r6[0x450] = 0x80
    r6[0x44D] = 0xF0


def miss_table(w):                      # 10:6907: $D321, the miss table for the club, lie class and $D4C9
    r6 = w.wram[6]
    e = ((lp.lie_class(w) & 0x0F) << 4) | r6[0x329]
    base = 0x6A43 if r6[0x32A] >= 2 else 0x6983
    l = rb(0x10, base + e)
    v = ((((r6[0x4C9] + 4) & 0xFF) * 8) + l) & 0xFF
    return (rb(0x10, 0x693B + v) - 1) & 0xFF


def marker(w):                          # 10:56EF / 10:5EE2: the target marker at the club's distance
    r6 = w.wram[6]
    hl, de = g.mul_sin_cos(lp.base_distance(w), rd16(r6, 0x418))
    wr16(r6, 0x426, (rd16(r6, 0x401) + hl) & 0xFFFF)
    wr16(r6, 0x428, (rd16(r6, 0x404) + de) & 0xFFFF)


def shot_record(w):                     # 02:46B0: the shot's 13-byte record -> $D5F8, and for the first four
    r6, w0 = w.wram[6], w.wram[0]       # strokes of a human player -> $D680 (+$40 player 2) + stroke x 16
    from shot_py import player_field
    rec = bytes(r6[0x400:0x406]) + bytes([r6[0x418], r6[0x419], r6[0x329], r6[0x32A], r6[0x450], r6[0x44F],
                                          r6[0x44D]])
    r6[0x5F8:0x605] = rec
    if w0[0x878] or w0[player_field(w, 0x13)] or w0[player_field(w, 0x20)] >= 4:
        return
    base = 0x680 + (0x40 if w0[0x835] else 0) + ((w0[player_field(w, 0x20)] & 3) << 4)
    r6[base:base + 13] = rec


# -- 11:4795: the ball in the view behind the golfer (views 4-6) --
def ball_view_cut(w):                   # 11:47A2-489A: project the ball; $D331 = 1 once it leaves the picture
    """The camera ($D456 x, $D458 y, angle $D45A) sees the ball at depth Z and sideways X; the flight camera
    ends ($D331) when the ball is behind it, off the sides (screen x >= $A0) or off the top or bottom."""
    r6 = w.wram[6]
    ang = rd16(r6, 0x45A)
    dy = (rd16(r6, 0x404) - rd16(r6, 0x458)) & 0xFFFF
    dx = (rd16(r6, 0x401) - rd16(r6, 0x456)) & 0xFFFF
    xc, xs = g.mul_sin_cos_signed(dx, ang)
    wr16(r6, 0x45C, xc)
    wr16(r6, 0x45E, xs)
    yc, ys = g.mul_sin_cos_signed(dy, (ang + 0x4000) & 0xFFFF)
    x = (yc + xc) & 0xFFFF
    z = (rd16(r6, 0x45E) + ys) & 0xFFFF
    w.high[0x1B6] = z >> 8
    nz = g.neg16(z)
    if nz & 0x8000:                     # in front of the camera's plane: behind it, out of the picture
        r6[0x331] = 1
        return
    if not nz >> 8 and (nz & 0xFF) < 8:
        return                          # right at the camera: drawn at a fixed spot
    scale = g.div_hl_by_de(0x5000, ((nz + 0x280) & 0xFFFF) >> 3) & 0xFF
    sx = ((g.mul_hl_by_a_frac_signed(x, scale) + 1) & 0xFFFF) >> 1
    c = ((sx & 0xFF) + 0x50) & 0xFF
    if c >= 0xA0:
        r6[0x331] = 1
        return
    h = (0x80 - (r6[0x407] | r6[0x408] << 8)) & 0xFFFF
    sy = (g.mul_hl_by_a_frac_signed(h, scale) + 1) & 0xFFFF
    sy = ((sy >> 1) | (sy & 0x8000)) & 0xFFFF
    sy = (sy + 0x3C) & 0xFFFF
    if sy & 0x80:
        r6[0x331] = 1
