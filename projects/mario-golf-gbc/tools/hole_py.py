"""A hole in Python: what happens between two shots, on the game's RAM (a tools/sm83.py Machine used as memory).

After a shot (ShotMainLoop's outcome, 10:4A25): the putt count, the outcome handler (3B:7260: penalties, the
water drop, bonus and points, the "on the green" flag), the position kept in the player's record; the shot
loop (10:45E7: stroke limit, holed bookkeeping and the scorecard, the next player); then ShotSetup (10:4798)
up to the address step: lie, the club the game picks, the aim at the cup, the views and the camera.
Captions, menus and other display work are left out (their frames are not counted: the hole is checked at
each shot's address step, and each shot frame by frame from there).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import golfmath as g
import ball_sim as bs
import cup_sim as cs
import launch_py as lp
import swing_py as sw
from ball_sim import rd16, wr16
from shot_py import ball, player_field, lie_terrain, ball_in_green_area

rb, rw = lp.rb, lp.rw


def pf(w, f):                           # the current player's record byte f (index into WRAM0)
    return player_field(w, f)


def count_stroke(w):                    # 10:477C CountStroke (its frame is not counted here)
    f = pf(w, 0x20)
    if w.wram[0][f] < 0x14:
        w.wram[0][f] += 1


def points_allowed(w):                  # 02:5C19: modes 1, 2, 3, 5, $0A, $0B, for a human player
    w0 = w.wram[0]
    if w0[0x834] not in (1, 2, 3, 5, 0x0A, 0x0B):
        return False
    return w0[0x880 + ((w0[0x835] & 1) << 6) + 0x13] == 0


def add_bonus(w, de):                   # 02:53F5: $D4F1 += de
    if points_allowed(w):
        r6 = w.wram[6]
        wr16(r6, 0x4F1, (rd16(r6, 0x4F1) + de) & 0xFFFF)


def add_points(w, de):                  # 02:5411: $C83C += de x course factor (02:543E) / 2
    if points_allowed(w):
        w0 = w.wram[0]
        f = rb(0x02, 0x543E + (w0[0x836] & 0x0F))
        wr16(w0, 0x83C, (rd16(w0, 0x83C) + ((g.mul_hl_by_a(de, f)) >> 1)) & 0xFFFF)


def outcome_rules(w, a):                # 3B:7260 (the gameplay effects; captions left out)
    r6, w0 = w.wram[6], w.wram[0]
    if w0[0x834] in (5, 6, 7, 0x0B, 0x0C):
        raise NotImplementedError("play mode $%02x (~3B:75CC-~3B:76C0)" % w0[0x834])
    if r6[0x48E] & 1:                   # skipped on water
        add_bonus(w, 0x0A)
    if a == 0x80:
        return holed_rules(w)
    i = a & 0x0F
    if i == 3:                          # 3B:7426 water: a penalty stroke, the ball back to the last safe spot
        r6[0x485] &= 0xFB
        count_stroke(w)
        r6[0x400:0x406] = bytes(r6[0x51D:0x523])
        return 0
    if i == 7:                          # 3B:7411 out of bounds: a penalty stroke
        count_stroke(w)
        return 0xFF
    if i == 6:                          # 3B:7447 on the green
        f = pf(w, 0x2B)
        if not w0[f]:
            w0[f] = 1
            if r6[0x48E] & 2:           # off the pin
                add_bonus(w, 4)
            else:
                d = (r6[0x325] - w0[pf(w, 0x20)]) & 0xFF
                if not d & 0x80 and d >= 3:
                    add_bonus(w, 2)
                elif not d & 0x80 and d >= 2 and (cs.pin_dist(ball(w)) - 0x21) & 0x8000:
                    add_bonus(w, 2)
        return 0
    if i in (0x0A,):                    # 3B:7555
        r6[0x485] &= 0xF7
    return 0


def holed_rules(w):                     # 3B:72C3: the hole's bonus, how it went in, the score against par
    r6, w0 = w.wram[6], w.wram[0]       # (the memorable-shot records in the save, ~02:4714 / ~02:5C50, left out)
    add_points(w, rd16(r6, 0x4F1))
    start = r6[0x5F8:0x5FE]
    if r6[0x48E] & 4:                   # off the flagstick
        add_points(w, 0x0A)
    elif r6[0x4CD] != 6:
        if w0[pf(w, 0x20)] != 1:        # holed from off the green: 8 from $780 or more, else 6
            far = not (cs.shot_length(ball(w), start) - 0x780) & 0x8000
            add_points(w, 8 if far else 6)
    elif r6[0x329] == 0x0D:             # a putt from $280 or more
        if not (cs.shot_length(ball(w), start) - 0x280) & 0x8000:
            add_points(w, 4)
    strokes = w0[pf(w, 0x20)]
    if strokes == 1:                    # hole in one
        add_points(w, 0x14)
        return 0
    d = (strokes - r6[0x325]) & 0xFF
    add_points(w, {0xFF: 6, 0xFE: 0x0A, 0xFD: 0x10}.get(d, 0))   # birdie, eagle, albatross
    return 0


def post_shot(w, a):                    # 10:4A82-10:4AEE (B held for a retry, ~10:4A38, is not modelled)
    r6, w0 = w.wram[6], w.wram[0]
    if hasattr(w, "tasks"):
        w.tasks["task_on"] = False                   # 10:4A26: BallTask off
    if r6[0x4CD] == 6:                  # a putt
        w0[pf(w, 0x21)] += 1
    r6[0x438] &= 0x0F
    r6[0x4DC] = a
    w0[pf(w, 0x14)] = a
    sw.meter_reset(w)
    if outcome_rules(w, a) == 0:        # $FF (out of bounds): the old spot is kept (stroke and distance)
        w0[pf(w, 0x29)] = 1
        w0[pf(w, 0x22):pf(w, 0x22) + 6] = bytes(r6[0x400:0x406])
    return a                            # the shot's own outcome (pushed at 10:4AA0)


def scorecard(w):                       # 10:4101: the hole's strokes and putts, the score against par
    w0, r6 = w.wram[0], w.wram[6]
    strokes, putts = w0[pf(w, 0x20)], w0[pf(w, 0x21)]
    h = w0[0x837] - 1
    if h < 0x12:
        w0[pf(w, 0x2C) + h] = strokes | ((putts << 4) & 0xFF)
    w0[pf(w, 0x3E)] = (strokes + w0[pf(w, 0x3E)] - r6[0x325]) & 0xFF


def shot_loop_end(w, a):                # 10:45E7-10:4632 for one shot's result: True when the hole is over
    w0, r6 = w.wram[0], w.wram[6]
    r6[0x438] = 0
    if w0[0x834] not in (0, 4) and w0[pf(w, 0x20)] >= (r6[0x325] * 3) & 0xFF:
        raise NotImplementedError("stroke limit (~10:4158)")
    if a & 0x80:                        # holed (or $FF)
        w0[pf(w, 0x2A)] = w0[pf(w, 0x2B)] = 1
        w0[pf(w, 0x22):pf(w, 0x28)] = b"\0" * 6
        scorecard(w)
    return bool(w0[0x8AA] and w0[0x8EA])


def next_player(w):                     # 10:4674 PickNextPlayer (one player: always player 1)
    w0, r6 = w.wram[0], w.wram[6]
    if not w0[0x8EA] and not w0[0x8AA]:
        raise NotImplementedError("two players (~10:4680)")
    if w0[0x8EA]:                       # 10:46D9: player 1
        rec, other, p = 0x880, (0xE3 if w0[0x8E9] else None), 0
    else:                               # 10:46EE: player 2
        rec, other, p = 0x8C0, (0xA3 if w0[0x8A9] else None), 1
    w0[0x835] = p
    r6[0x400:0x406] = bytes(w0[rec + 0x22:rec + 0x28])
    r6[0x406] = r6[0x407] = r6[0x408] = 0
    if other is None:                   # the other ball's spot: 4 bytes of 10:4771
        src = [rb(0x10, 0x4771 + i) for i in range(6)]
    else:
        src = [w0[0x800 + other + i] for i in range(6)]
    r6[0x41E], r6[0x41F], r6[0x420], r6[0x421] = src[0], src[1], src[3], src[4]
    for o in range(0x409, 0x40F):
        r6[o] = src[4]
    wr16(r6, 0x4C6, rd16(w0, rec + 0x1A))
    r6[0x4CA] = w0[rec + 0x1D]
    r6[0x4C8] = w0[rec + 0x1C]
    r6[0x4C9] = w0[rec + 0x1E]
    r6[0x4CB] = w0[rec + 0x1F]
    r6[0x4CC] = w0[rec + 0x19]
    r6[0x4D7] = w0[rec + 0x13]


def pick_club(w):                       # 10:6341: the most lofted club that reaches the pin (the putter on the green)
    r6 = w.wram[6]
    ffb0 = 0x0C
    r6[0x32A] = 0
    if r6[0x4CD] in (6, 0x0A):
        r6[0x329] = 0x0D
        return
    pin = cs.pin_dist(ball(w))
    c = rb(0x10, 0x639A + (lp.lie_class(w) & 0x0F))
    b = 0x0C
    while True:
        r6[0x329] = b
        if sw.miss_table(w):
            ffb0 = b
            if (pin - lp.base_distance(w)) & 0x8000:
                break
        b -= 1
        c -= 1
        if not c:
            break
    r6[0x329] = ffb0


def aim_at_cup(w):                      # 10:61FA: angle from the ball to the cup
    r6 = w.wram[6]
    dx = (rd16(r6, 0x43D) - rd16(r6, 0x401)) & 0xFFFF
    dy = (rd16(r6, 0x43F) - rd16(r6, 0x404)) & 0xFFFF
    return g.angle_from_vector16(dy, dx)


def aim_marker(w):                      # 10:6145: the aim arrow's end ($D481-$D484), across the aim
    r6 = w.wram[6]
    turn = 0x4000 if r6[0x333] & 1 else 0xC000
    hl = 0x20 if r6[0x443] else 0x80
    c, s = g.mul_sin_cos(hl, (rd16(r6, 0x418) + turn) & 0xFFFF)
    wr16(r6, 0x481, (rd16(r6, 0x401) + c) & 0xFFFF)
    wr16(r6, 0x483, (rd16(r6, 0x404) + s) & 0xFFFF)


def shot_setup(w, hole):                # 10:4798 ShotSetup up to the address step, the aiming menu answered with A
    r6, w0, s = w.wram[6], w.wram[0], ball(w)
    r6[0x48E] = 0
    r6[0x445] = 0 if w0[pf(w, 0x29)] else 1          # the tee shot
    r6[0x446] = w0[pf(w, 0x3F)]
    w0[pf(w, 0x3F)] = 0
    r6[0x4CD] = lie_terrain(hole, s)
    r6[0x4D5] = 1 if r6[0x4CD] == 6 else 0
    r6[0x332] = w0[pf(w, 0x10)]
    r6[0x333] = w0[pf(w, 0x11)]
    pick_club(w)
    lp.club_params(w)
    r6[0x485] = 0x25
    wr16(r6, 0x418, aim_at_cup(w))
    if r6[0x443] == 2:
        r6[0x443] = 1
    r6[0x438] = 1
    aim_marker(w)
    sw.meter_reset(w)
    r6[0x485] = 0x2D
    r6[0x5F8:0x5FE] = bytes(r6[0x400:0x406])      # 02:4679
    r6[0x51C] = w0[pf(w, 0x28)]
    r6[0x485] = 0x3F
    r6[0x514:0x51A] = bytes(r6[0x400:0x406])      # 10:550B
    aim_menu_a(w, hole)
    # the aiming menu (10:5BA6) answered with A: the swing
    if r6[0x332] < 0x0B and r6[0x329] != 0x0D and w0[pf(w, 0x13)] != 3 and not w0[0x818] & 2:
        r6[0x337] = 0                                # ShotViewLeave
        wr16(r6, 0x456, rd16(r6, 0x401))             # 11:476E: the camera behind the ball
        wr16(r6, 0x458, rd16(r6, 0x404))
        wr16(r6, 0x45A, (0xC000 - rd16(r6, 0x418)) & 0xFFFF)
        r6[0x438] = 0
        load_view_4(w, hole)
    r6[0x438] = 1
    if r6[0x443] != 4:                               # 10:5632
        c = ball_in_green_area(s)
        if r6[0x443] != c:
            r6[0x444] = 0
            r6[0x443] = c
        aim_marker(w)


def load_view_4(w, hole):               # 13:432B with a = 4: the view behind the golfer
    r6 = w.wram[6]
    r6[0x444] = 0
    w.wram[0][0xA80] = w.wram[0][0xA81] = 0
    sw.anim_start(w, 0)                              # 11:6D69 (and the animation task registered)
    if hasattr(w, "tasks"):
        w.tasks["anim_on"] = True
    r6[0x443] = 4
    r6[0x480] = 0
    r6[0x328] = 0


def smart_aim(w, hole):                 # 10:6406: at the cup, or, when the club cannot reach it, a direction
    r6 = w.wram[6]                      # whose landing spot is fairway or green (else a club less)
    s = ball(w)
    if (cs.pin_dist(s) - lp.base_distance(w)) & 0x8000:
        return aim_at_cup(w)
    while True:
        bc = aim_at_cup(w)
        for d in range(0x24):
            hl, de = g.mul_sin_cos(lp.base_distance(w), bc)
            x, y = (rd16(r6, 0x401) + hl) & 0xFFFF, (rd16(r6, 0x404) + de) & 0xFFFF
            if not (x >> 8) & 0xC0 and not (y >> 8) & 0xC0:
                hole.use(1 <= r6[0x443] <= 3)
                if hole.terrain_at(x, y) in (0, 6, 0x0A, 0x0E):
                    return bc
            bc = (bc + rw(0x10, 0x63BE + 2 * d)) & 0xFFFF          # 10:63AA
        if r6[0x329] >= 0x0C:
            return aim_at_cup(w)
        r6[0x329] += 1


def mul_signed_full(hl, a):             # 00:0BB5 MulHLByASignedFull: low 16 bits of the signed product
    if hl & 0x8000:
        return g.neg16(g.mul_hl_by_a(g.neg16(hl), a))
    return g.mul_hl_by_a(hl, a)


def aim_menu_a(w, hole):                # 10:5BA6 with a = 0, answered at once with A
    r6, s = w.wram[6], ball(w)
    r6[0x426], r6[0x427], r6[0x428], r6[0x429] = s[0x01], s[0x02], s[0x04], s[0x05]
    if r6[0x4E7]:                       # settings kept from before (a retry)
        r6[0x329] = r6[0x4E8]
        r6[0x418], r6[0x419] = r6[0x4E9], r6[0x4EA]
        r6[0x32A], r6[0x32B] = r6[0x4EB], r6[0x4EC]
        r6[0x4E7] = 0
    else:
        wr16(r6, 0x418, smart_aim(w, hole))
        r6[0x32A] = r6[0x32B] = 0
        d = cs.pin_dist(s)              # the putter's range from the distance
        r6[0x32B] = 2 if not (d - 0x42B) & 0x8000 else 1 if not (d - 0x140) & 0x8000 else 0
    if r6[0x329] == 0x0D:
        r6[0x32A] = 0
    r6[0x480] = r6[0x382] = 0
    r6[0x513] = 0
    if r6[0x4D7]:
        raise NotImplementedError("the computer's aiming (~10:5943-~10:5978)")
    r6[0x44D] = 0xF0
    r6[0x438] = 4 if r6[0x443] else 2
    r6[0x4D4] = 1
    r6[0x321] = sw.miss_table(w)
    lp.club_params(w)
    r6[0x480] = 0
    r6[0x42A:0x42E] = bytes(r6[0x426:0x42A])
    dx, dy = g.mul_sin_cos(lp.base_distance(w), rd16(r6, 0x418))      # 10:5EE2
    tx, ty = (rd16(r6, 0x401) + dx) & 0xFFFF, (rd16(r6, 0x404) + dy) & 0xFFFF
    for b in (1, 2, 3, 4):              # the marker slides out in quarters (the last while the menu waits)
        for o, t in ((0x426, tx), (0x428, ty)):
            old = rd16(r6, o + 4)
            v = mul_signed_full((t - old) & 0xFFFF, b)
            v = ((v >> 2) | (0xC000 if v & 0x8000 else 0)) & 0xFFFF
            wr16(r6, o, (v + old) & 0xFFFF)
    aim_marker(w)
    r6[0x4D4] = 0
    sw.preview_restart(w)               # the landing preview has restarted at least once in the menu
    bs.speed_and_dir(s)                 # and stepped (10:5355 starts with BallSpeedAndDir)
