"""A shot in Python: BallTask (10:4D45) complete, and the shot's main thread (ShotMainLoop 10:6E99 and the
flight-camera loop before it), on the game's own RAM.

The world is a tools/sm83.py Machine used as memory only (no ROM code runs): the ball state is WRAM6
$D400-$D4FF (`s`), the rest is read and written where the ROM keeps it. Graphics, sprites and sounds are left
out; what they would do is reported in fx. The maps come from ball_sim.Hole (the course maps, or the green
maps in views 1-3).
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
import golfmath as g
import ball_sim as bs
from ball_sim import rd16, wr16
import cup_sim as cs
import launch_py as lp
import swing_py as sw

_rom = load_rom()
TREE_ANGLE = _rom[to_offset(0x08, 0x5326):to_offset(0x08, 0x5326) + 256]   # angle to the trunk per tile spot
TREE_DIST = _rom[to_offset(0x08, 0x5426):to_offset(0x08, 0x5426) + 256]    # distance to the trunk


def ball(w):
    return memoryview(w.wram[6])[0x400:0x500]


def player_field(w, f):                 # 10:4B14 PlayerField: WRAM0 offset of the current player's field f
    return 0x880 + f + (0x40 if w.wram[0][0x835] else 0)


def apply_fx(w, fx):
    """What the ported branches do outside $D400-$D4FF that matters to the game state."""
    for f in fx:
        if isinstance(f, tuple) and f[0] == "bunker":       # PlayerField $15 bit 0, $3F = plug depth
            w.wram[0][player_field(w, 0x15)] |= 1
            if f[1]:
                w.wram[0][player_field(w, 0x3F)] = f[1]


def terrain_check(w, hole, s):          # 10:527C BallTerrainCheck: last safe spot -> $D51D
    hl, de = bs.rd16(s, 0x01), bs.rd16(s, 0x04)
    v = s[0x43]
    if v and v != 4:
        d, h = ((de >> 8) - s[0x42]) & 0xFF, ((hl >> 8) - s[0x41]) & 0xFF
        if h >= 5 or d >= 4:
            return
        hl, de = ((h << 8 | hl & 0xFF) << 2) & 0xFFFF, ((d << 8 | de & 0xFF) << 2) & 0xFFFF
    if hole.terrain_at(hl, de) in (3, 7):
        return
    w.wram[6][0x51D:0x523] = bytes(s[0:6])


def tree_check(w, hole, s, fx):         # 08:51D2: trees (tiles with bit 7 in the $D700 table)
    r6 = w.wram[6]
    if r6[0x519] == s[0x05] and r6[0x516] == s[0x02]:
        return                          # this tile was hit already
    if s[0x43] in (1, 2):
        return
    attr = hole.slope[hole.tmap[(s[0x05] & 0x3F) << 6 | (s[0x02] & 0x3F)]]
    if not attr & 0x80:
        return
    a = (((s[0x07] | s[0x08] << 8) << 3) & 0xFFFF) >> 8
    if a >= 0x18:
        return                          # above the tree
    c = r6[0x4F3 + (a & 0x1F)]          # the tree's half width at this height (bit 0: canopy deflects)
    if not c:
        return
    e = (s[0x04] & 0xF0) | (s[0x01] >> 4)
    _, de = g.vector_from_length_and_angle_raw(TREE_DIST[e], (TREE_ANGLE[e] - s[0x14]) & 0xFF)
    if (bs._abs16(de) & 0xFF) >= (c & 0xFE):
        return                          # passes beside it
    r6[0x519], r6[0x516] = s[0x05], s[0x02]
    if c & 1:                           # bounces off: mirrored direction, half speed
        cc = TREE_ANGLE[e]
        b = (2 * cc - s[0x14] + 0x80) & 0xFF
        hl, de = g.mul_sin_cos((s[0x13] >> 1) << 8, b << 8)
        bs.wr16(s, 0x0B, de)
        bs.wr16(s, 0x09, hl)
        s[0x8E] |= 0x10
        if s[0x13]:
            fx.append(("sound", "tree", 0))
    else:                               # through the leaves: slowed
        for o, f in ((0x09, 0xE6), (0x0B, 0xE6), (0x0D, 0xF0)):
            bs.wr16(s, o, g.mul_hl_by_a_frac_signed(bs.rd16(s, o), f))
        s[0x8E] |= 0x10
        if s[0x13]:
            fx.append(("sound", "tree", 1))


def rest_watch(s):                      # 10:7077: $D4D3 counts frames at the same spot ($D4CF-$D4D2)
    if (s[0x01], s[0x02], s[0x04], s[0x05]) == (s[0xCF], s[0xD0], s[0xD1], s[0xD2]) and ((s[0x07] + 1) & 0xFF) < 2:
        s[0xD3] = (s[0xD3] + 1) & 0xFF
        return
    s[0xCF], s[0xD0], s[0xD1], s[0xD2] = s[0x01], s[0x02], s[0x04], s[0x05]
    s[0xD3] = 0


def ball_task(w, hole, fx):             # 10:4D45 BallTask
    s = ball(w)
    hole.use(1 <= s[0x43] <= 3)
    if s[0x15]:
        if bs.flight_step(s, w.wram[0][0x815], w.wram[0][0x816]):
            bs.bounce(s, hole, fx)
            w.wram[6][0x331] = 1        # 10:500D, 10:522C
        bs.land_check(s)
    else:
        if bs.roll_step(s, hole, fx) == "water":
            w.wram[6][0x331] = 1
    apply_fx(w, fx)
    terrain_check(w, hole, s)
    tree_check(w, hole, s, fx)
    if w.high[0x194] & 2:               # B pressed
        w.wram[6][0x360] = 2
    rest_watch(s)
    w.wram[0][0xAAB], w.wram[0][0xAAC] = s[0x07], s[0x08]
    s[0xC1], s[0xC2] = s[0x07], s[0x08]


LIE_FAIRWAY = _rom[to_offset(0x10, 0x70DB):to_offset(0x10, 0x70DB) + 16]   # lie quality by position (10:70DB)
LIE_ROUGH = _rom[to_offset(0x10, 0x7112):to_offset(0x10, 0x7112) + 16]     # (10:7112)


def ball_in_green_area(s):              # 10:5617 BallInGreenArea
    return 1 if ((s[0x05] - s[0x42]) & 0xFF) < 4 and ((s[0x02] - s[0x41]) & 0xFF) < 5 else 0


def lie_terrain(hole, s):               # 10:648B BallLieTerrain
    hl, de = bs.rd16(s, 0x01), bs.rd16(s, 0x04)
    if s[0x43] and s[0x43] != 4:
        de = ((((de >> 8) - s[0x42]) & 0xFF) << 8 | (de & 0xFF)) << 2 & 0xFFFF
        hl = ((((hl >> 8) - s[0x41]) & 0xFF) << 8 | (hl & 0xFF)) << 2 & 0xFFFF
    hole.use(1 <= s[0x43] <= 3)
    return hole.terrain_at(hl, de)


def registered(w, bank, addr):          # is bank:addr in the frame task table ($C1C0: 16 x flags, address, bank)?
    t = w.wram[0][0x1C0:0x200]
    return any(t[i] and not t[i] & 0x80 and t[i + 1] | t[i + 2] << 8 == addr and t[i + 3] == bank
               for i in range(0, 0x40, 4))


class Shot:
    """The main thread of a shot. ev(kind) is called at the points tools/emu_shot_record.py records: F at each
    AdvanceFrame, T at each BallTask, L / P at the loop tops; it may compare the RAM with a recording."""

    TASKS = {"task_on": (0x10, 0x4D45),               # BallTask
             "meter_on": (0x10, 0x55AC),              # the swing's d-pad task
             "anim_on": (0x11, 0x6E3E),               # the golfer's animation
             "display_on": (0x11, 0x4113)}            # the ball display

    def __init__(self, w, hole, ev=lambda kind: None):
        self.w, self.hole, self.ev = w, hole, ev
        if not hasattr(w, "tasks"):                   # which frame tasks run: from the snapshot's task table,
            w.tasks = {k: registered(w, *v) for k, v in self.TASKS.items()}   # then kept here
        self.fx = []

    def __getattr__(self, k):
        if k in Shot.TASKS:
            return self.w.tasks[k]
        raise AttributeError(k)

    def __setattr__(self, k, v):
        if k in Shot.TASKS:
            self.w.tasks[k] = v
        else:
            object.__setattr__(self, k, v)

    def advance(self, n=1):             # 00:2E3B AdvanceFrame: the frame tasks in their slot order
        for _ in range(n):
            self.ev("F")
            if self.anim_on:                            # 11:6E3E
                sw.anim_task(self.w)
            if self.display_on:                         # 11:4113: the ball display
                if sw.preview_on(self.w):               # -> 11:4E5E
                    sw.preview_frame(self.w, self.hole, self.fx)
                if self.w.wram[6][0x443] & 7 in (4, 5, 6):
                    sw.ball_view_cut(self.w)            # 11:47A2
            if self.meter_on:                           # 10:55AC
                sw.meter_task(self.w)
            if self.task_on:                            # 10:4D45 BallTask
                self.ev("T")
                ball_task(self.w, self.hole, self.fx)

    # -- 10:56B0: the golfer at the ball: club (Up / Down in view 4), aim (Left / Right), A swings, B goes back --
    def address(self, entered=False):   # entered: at the loop top 10:5713 (after its AdvanceFrame)
        w, s = self.w, ball(self.w)
        r6 = w.wram[6]
        self.task_on = False
        if not entered:
            s[0x60] = s[0x61] = 0
        label = "5713" if entered else "56B6"
        while True:
            if label == "56B6":
                sw.meter_reset(w)
                self.advance()
                if s[0xD7]:
                    raise NotImplementedError("the computer's swing (~10:5643)")
                s[0x53] = 0
                s[0x51] = 1
                label = "56CC"
            if label == "56CC":
                r6[0x321] = sw.miss_table(w)
                self.advance(2)
                lp.club_params(w)
                label = "56E7"
            if label == "56E7":
                s[0x80] = 0
                r6[0x382] = 1
                sw.marker(w)
            if label != "5713":
                self.advance()
            label = "5710"
            joy = w.high[0x194]
            if joy & 1:
                r = self.swing()
                if r == "again":
                    label = "56B6"
                    continue
                return r
            if joy & 2:
                return 0xFF                              # back to the aiming menu (not modelled further)
            if s[0x43] != 4:
                continue
            rep, club = w.high[0x191], r6[0x329]
            if rep & 0x40 or rep & 0x80:
                if s[0xCD] != 6 and ((rep & 0x40 and club != 0) or (not rep & 0x40 and club != 0x0C)):
                    r6[0x329] = club - 1 if rep & 0x40 else club + 1
                    label = "56CC"
                continue
            held = w.high[0x190]
            if held & 0x20:
                bc = 0 if ((s[0x61] - 0xF8) & 0x80) else 0xFF80
            elif held & 0x10:
                bc = 0x80 if ((s[0x61] - 0x08) & 0x80) else 0
            else:
                continue
            wr16(s, 0x18, (rd16(s, 0x18) + bc) & 0xFFFF)
            wr16(s, 0x60, (rd16(s, 0x60) + bc) & 0xFFFF)
            label = "56E7"

    def swing(self):                    # 10:57C0 / SwingMeterLoop 10:57E0: A for power, A for impact
        w, s = self.w, ball(self.w)
        r6 = w.wram[6]
        s[0x4D] = 0
        s[0x51] = 0
        if r6[0x329] != 0x0D:
            self.meter_on = True
        sw.anim_start(w, 1)
        b = 0
        while True:
            self.advance()
            a = s[0x4E]
            s[0x4F] = (0x78 - a) & 0xFF if a >= 0x3C else a
            if s[0x4E] >= 0x78 and not b:
                return self.swing_off()
            if not s[0x4E] & 1:
                c = w.high[0x194] | s[0x53]
            else:
                s[0x53] = w.high[0x194]
                c = 0
            if c & 2 and not b:
                return self.swing_off()
            if c & 1:
                if b:
                    return self.swing_end(True)
                s[0x50] = s[0x4F]
                b = 1
                if r6[0x329] == 0x0D:                   # the putter: one press
                    r6[0x32A] = r6[0x32B]
                    return self.swing_end(False)
                if s[0x50] == 0x3C:
                    s[0x52] = 1
            s[0x4E] = (s[0x4E] + 1) & 0xFF
            if s[0x4E] == 0x8A:
                return self.swing_end(True) if b else self.swing_off()

    def swing_end(self, impact):        # 10:587A (impact: downswing; perfect at cursor 0) and 10:588D
        w, s = self.w, ball(self.w)
        if impact:
            sw.anim_start(w, 2)
            if s[0x4F] == 0:
                s[0x51] = 1
        self.meter_on = False
        return 0

    def swing_off(self):                # 10:5861: no power or B: back to the address after 20 frames
        w, s = self.w, ball(self.w)
        s[0x4D] = 0xF0
        self.meter_on = False
        sw.anim_start(w, 3)
        self.advance(20)
        return "again"

    def after_swing(self):              # 10:4921-10:49A0: from the swing to ShotLaunch
        w, s = self.w, ball(self.w)
        r6, w0 = w.wram[6], w.wram[0]
        s[0x85] &= 0xEF
        sw.shot_record(w)                               # 02:46B0 (~02:48B8 is for link play)
        s[0x85] = 0x2D
        if s[0x43] == 4:
            while True:                                 # 11:6E34: until the club meets the ball
                self.advance()
                if s[0x64]:
                    break
        else:                                           # 10:4AEF
            self.advance(0x30 if r6[0x329] == 0x0D else 0x24 if r6[0x32A] >= 2 else 0x32)
        r6[0x35A], r6[0x35B] = w0[0x8A0], w0[0x8A1]
        r6[0x35D], r6[0x35E] = r6[0x32A], r6[0x32B]
        r6[0x35C] = w0[player_field(w, 0x2B)]
        r6[0x369], r6[0x36A] = s[0x18], s[0x19]
        r6[0x359] = w0[player_field(w, 0x29)]
        s[0x47] = s[0x46]
        f = player_field(w, 0x20)                       # 10:477C: one more stroke
        if w0[f] < 0x14:
            w0[f] += 1
            self.advance()
        r6[0x35F] = r6[0x360] = 0
        r6[0x519], r6[0x516] = s[0x05], s[0x02]
        s[0x85] |= 4
        return self.launch()

    def from_address(self, entered=False):  # the swing as played, then the shot: the outcome
        r = self.address(entered)
        if r != 0:
            return r
        return self.after_swing()

    # -- the view changes: maps and graphics; only their RAM effects on the shot state are kept --
    def view_leave(self):               # 3B:431F ShotViewLeave
        self.w.wram[6][0x337] = 0
        self.advance()

    def load_view(self, c):             # 13:432B LoadShotView (not view 4): one AdvanceFrame (13:4462)
        w, s = self.w, ball(self.w)
        self.anim_on = False                            # 13:433A -> 11:6D88: the golfer's animation stops
        s[0x44] = 0
        w.wram[0][0xA80] = w.wram[0][0xA81] = 0
        if c:
            w.wram[0][0x320:0x324] = b"\0\0\0\0"
        s[0x43] = c
        w.wram[6][0x36B] = w.wram[6][0x36C] = 0
        self.advance()

    def cup_view(self, v):              # ~13:44A4 CupViewEnter (2) / ~13:4528 CupViewLeave (1): graphics only, no frames
        pass

    # -- 10:5F94 ShotLaunch and what follows it up to the flight-camera loop (10:49A0-10:49D8) --
    def launch(self):
        w, s = self.w, ball(self.w)
        r6 = w.wram[6]
        lp.shot_launch(w, self.fx)
        for o in range(0xCF, 0xD5):                     # 10:706C
            s[o] = 0
        s[0x46] = 0
        if r6[0x32A] == 1 and r6[0x329] != 0x0D and not (r6[0x44F] == 0 and r6[0x450] == 0x3C):
            f = player_field(w, 0x28)                   # 10:433B: a power shot used up (unless perfect)
            w.wram[0][f] = (w.wram[0][f] - 1) & 0xFF
        s[0x38] = 0x11
        self.task_on = True                             # 10:49B7 RegisterFrameTask(1, BallTask)
        if s[0x43] != 4:                                # on the green views: no flight camera
            return self.after_flight()
        r6[0x331] = 1 if w.wram[0][0x33F] and s[0x17] < 8 else 0
        self.advance()
        self.ev("P")
        return self.flight_cam(0x5A)

    # -- 10:49DD: the flight-camera loop, from its top (after its AdvanceFrame), with its counter c --
    def flight_cam(self, c):
        w, s = self.w, ball(self.w)
        while not (ball_in_green_area(s) or w.wram[6][0x331]):
            c = (c - 1) & 0xFF
            if not c:
                break
            self.advance()
            self.ev("P")
        self.load_view(ball_in_green_area(s))          # 10:4A00 (graphics before it: 30EB, 15:47B1, 04:...)
        self.advance()                                  # 10:4A0A WaitFramesCmd 1
        return self.after_flight()

    def after_flight(self):             # 10:4A0E
        s = ball(self.w)
        if not s[0x8E] & 0x10 and s[0x8E] & 0x08:
            self.fx.append(("cue", 8))                  # the caption ~3B:4339
        self.advance()                                  # 10:4A1E WaitFramesCmd 1
        return self.main_loop()

    def main_loop(self, entered=False):  # 10:6E99 ShotMainLoop; entered: start at its top (after AdvanceFrame)
        s = ball(self.w)
        if not entered:
            s[0xBB] = s[0xBC] = s[0xBD] = s[0xBE] = 0
            s[0xB9] = 0
            s[0x44] = 0
        while True:
            if entered:
                entered = False
            else:
                self.advance()
                self.ev("L")
            r = self.body()
            if r is not None:
                return r

    def body(self):                     # one pass of 10:6EAA; None = next frame, else the outcome
        w, s, fx = self.w, ball(self.w), self.fx
        w0, w6 = w.wram[0], w.wram[6]
        x, y = s[0x02], s[0x05]
        if w0[0x329] > x or x >= w0[0x32B] or w0[0x32A] > y or y >= ((w0[0x32C] - 2) & 0xFF):
            fx.append(("sound", 0x40))                  # 10:6E90 ShotOutOfBounds
            self.advance(30)
            return 7
        to_6f28 = True
        if s[0x43] == 1:
            if cs.near_cup(s):
                cs.pin_check(s, fx)
                if not s[0x08] and s[0x07] < 0x20:
                    self.cup_view(2)
                    s[0x43] = 2
                    to_6f28 = False
        elif s[0x43] == 2:
            cs.pin_check(s, fx)
            low = s[0x08] & 0x80 or (not s[0x08] and s[0x07] < 0x20)
            if not (low and cs.near_cup(s)):
                self.cup_view(1)
                s[0x43] = 1
            to_6f28 = False
        if to_6f28:
            c = ball_in_green_area(s)
            if s[0x43] != c:
                self.view_leave()
                s[0x43] = c
                self.load_view(c)
        if s[0x43] == 2:                                 # 10:6F43
            if cs.fly_in(s):
                return self.holed()
            if not (((s[0x07] | s[0x08] << 8) - 4) & 0x8000):
                return None
            if cs.cup_close(s) < 6:
                cs.roll_in(s)
                return self.holed() if s[0xB1] else None
        if bs.cup_pull(s):                               # 10:6F9E
            return None
        if s[0xD3] >= 0x28:
            return self.at_rest()
        if not w6[0x35F] or w6[0x367] & 0x80:
            return None
        joy = w.high[0x194]
        if joy & 2:
            return self.at_rest()
        if not joy & 1:
            return None
        return self.retry()

    def holed(self):                    # 10:7052 ShotHoled
        s = ball(self.w)
        s[0x44] = 1
        self.task_on = False
        a = cs.cup_drop(s, lambda n: self.advance(n), [])
        self.task_on = True
        if a == 2:
            return self.main_loop_continue()
        self.fx.append(("sound", 0x5A))
        cs.hole_out_place(s, lambda n: self.advance(n))
        s[0x85] &= 0xFB
        return 0x80

    def main_loop_continue(self):       # jp 10:6EA7: back into the loop without its set-up
        while True:
            self.advance()
            self.ev("L")
            r = self.body()
            if r is not None:
                return r

    def at_rest(self):                  # 10:7029 ShotAtRest
        w, s = self.w, ball(self.w)
        s[0x0D] = s[0x0E] = 0
        s[0x06] = s[0x07] = s[0x08] = 0
        t = lie_terrain(self.hole, s)
        table = LIE_FAIRWAY if t in (0, 0x0E) else LIE_ROUGH if t == 1 else None
        if table:
            q = table[((s[0x03] >> 4) + (s[0x00] >> 4)) & 0x0F]
            w.wram[0][player_field(w, 0x3F)] = q
            s[0x46] = q
        return t

    def retry(self):                    # 10:6FC9: A after the ball stopped in a mode with $D35F set (not seen yet)
        w, s = self.w, ball(self.w)
        w6 = w.wram[6]
        s[0x00:0x06] = bytes(w6[0x361:0x367])
        w6[0x51D:0x523] = bytes(w6[0x36D:0x373])
        w.wram[0][player_field(w, 0x3F)] = w6[0x368]
        s[0x46] = w6[0x368]
        for o in range(0x06, 0x0F):
            s[o] = 0
        s[0x15] = 0
        self.fx.append(("sound", 0x40))
        c = ball_in_green_area(s)
        if c:
            self.load_view(1)
        elif s[0x43]:
            self.load_view(0)
        else:
            raise NotImplementedError("~13:4276")
        w6[0x360] = 0
        return w6[0x367]
