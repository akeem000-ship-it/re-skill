"""Replay a recorded shot (tools/emu_shot_record.py) in the SM83 interpreter and compare with the game.

Starting from the RAM snapshot at the first recorded event, the game's main thread (the flight-camera loop
10:49D8 and the shot's main loop 10:6E99, ROM code) runs in the interpreter; every AdvanceFrame it calls runs
the BallTask steps (10:4D45) the game ran in that frame and then returns at once. At each recorded event (T, and
the loop tops P = 10:49DD, L = 10:6EAA) WRAM6 $D400-$D4FF is compared with the recording (except the camera
and display bytes in SKIP). The run ends when the main loop returns to 10:4A25 with the shot's outcome.

By default the Python ports in ball_sim.py replace their ROM routines (overrides): BallFlightStep with the
bounce (10:4EE0, including water, water skips and bunker plugs), BallLandCheck (10:4D09), BallRollStep
(10:4D86) and CupPull (10:7CAB); the splash graphics they start are still ROM calls, and their sound requests
are left out. --rom runs pure ROM code.
usage: shot_sim.py RECORDING.json [--rom] [--quiet]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import ball_sim as bs
import cup_sim as cs
import shot_py as sp

LOOP_TOP, LOOP_CALL, LOOP_RET = 0x6EAA, 0x6EA7, 0x4A25
PRE_TOP, PRE_CALL = 0x49DD, 0x49DA     # the flight-camera loop (10:49D8) that runs before the main loop
# camera and display bytes that other frame tasks update between the events (not simulated here)
SKIP_C8 = set()
SKIP_D3 = {0x26, 0x27, 0x6B, 0x6C}  # wind indicator animation, HUD blink timer (bank 12 frame task, 12:502C)
SKIP_D5 = set()
SKIP = set(range(0x2E, 0x38)) | set(range(0x5C, 0x60)) | set(range(0x65, 0x68)) | set(range(0x6B, 0x80))


def ball_view(m):
    return memoryview(m.wram[6])[0x400:0x500]


WHAT = {}                              # ported branches taken (water, plugged, splash, bunker)


def make_overrides(hole, task=False):
    def wind(m):
        return m.wram[0][0x815], m.wram[0][0x816]

    def effects(m, fx):
        """What the ported branches do outside $D400-$D4FF (ball_sim.bounce): run or write it here."""
        for f in fx:
            if f == "splash":          # 12:6A9C (hl = x, de = y), 12:6A7F: the splash graphics
                s = ball_view(m)
                regs = (m.sp, m.rom_bank, m.high[0x195])
                m.call(0x12, 0x6A9C, hl=bs.rd16(s, 0x01), de=bs.rd16(s, 0x04))
                m.call(0x12, 0x6A7F)
                m.sp, m.rom_bank = regs[:2]
                m.high[0x195] = regs[2]
            else:                      # ("bunker", depth): PlayerField $15 bit 0, $3F = depth (10:4B14)
                base = 0xC880 + (0x40 if m.wram[0][0x835] else 0) - 0xC000
                m.wram[0][base + 0x15] |= 1
                if f[1]:
                    m.wram[0][base + 0x3F] = f[1]
            WHAT[f if f == "splash" else "bunker"] = WHAT.get(f if f == "splash" else "bunker", 0) + 1

    def flight(m):                     # 10:4EE0 (with the bounce branch)
        s = ball_view(m)
        hole.use(1 <= s[0x43] <= 3)
        t, fx = bytearray(s), []
        if bs.flight_step(t, *wind(m)):
            why = bs.bounce(t, hole, fx)
            m.wram[6][0x331] = 1       # 10:500D, 10:522C
            if why != "bounce":
                WHAT[why] = WHAT.get(why, 0) + 1
        s[:] = t
        effects(m, fx)
    def land(m):                       # 10:4D09
        bs.land_check(ball_view(m))
    def roll(m):                       # 10:4D86
        s = ball_view(m)
        hole.use(1 <= s[0x43] <= 3)
        t, fx = bytearray(s), []
        if bs.roll_step(t, hole, fx) == "water":
            m.wram[6][0x331] = 1       # 10:522C
            WHAT["roll water"] = WHAT.get("roll water", 0) + 1
        s[:] = t
        effects(m, fx)
    def pull(m):                       # 10:7CAB: a = 1 when it pulled
        s = ball_view(m)
        t = bytearray(s)
        m.a = bs.cup_pull(t)
        s[:] = t

    def frames(m, n):                  # AdvanceFrame n times (the replay's frame hook runs that frame's ball steps)
        for _ in range(n):
            if m.frame_hook:
                m.frame_hook(m)

    def cup(fn, result=True, keep=False):
        """Run a cup_sim port on the ball state; a = its result; the other registers are kept like the ROM's
        push / pop pairs (keep: a too)."""
        def run(m):                    # in place: CupDrop's frames compare the RAM while it runs
            regs = (m.a, m.b, m.c, m.d, m.e, m.h, m.l)
            r = fn(m, ball_view(m))
            m.a, m.b, m.c, m.d, m.e, m.h, m.l = regs
            if result and not keep:
                m.a = r
            WHAT[fn.__name__] = WHAT.get(fn.__name__, 0) + 1
        return run

    def near_cup(m, t):
        return cs.near_cup(t)
    def roll_in(m, t):
        cs.roll_in(t)
    def fly_in(m, t):
        return cs.fly_in(t)
    def pin_check(m, t):               # 10:72E7 also selects WRAM bank 6
        m.high[0x196] = m.high[0x170] = 6
        cs.pin_check(t, [])
    def cup_drop(m, t):                # BallTask is unregistered meanwhile (00:2449 / 00:23E8)
        sp = m.sp
        m.call(0, 0x2449, hl=0x4D45)
        r = cs.cup_drop(t, lambda n: frames(m, n), [])
        m.call(0, 0x23E8, a=1, hl=0x4D45)
        m.sp = sp
        return r
    def hole_out_place(m, t):
        cs.hole_out_place(t, lambda n: frames(m, n))
    def ball_task(m):                  # the whole of 10:4D45 in Python (--task)
        fx = []
        sp.ball_task(m, hole, fx)
        effects(m, [f for f in fx if f == "splash"])
        WHAT["ball_task"] = WHAT.get("ball_task", 0) + 1
    ports = {(0x10, 0x4EE0): flight, (0x10, 0x4D09): land, (0x10, 0x4D86): roll, (0x10, 0x7CAB): pull,
             (0x10, 0x7122): cup(near_cup), (0x10, 0x716B): cup(roll_in, keep=True), (0x10, 0x7263): cup(fly_in),
             (0x10, 0x72E7): cup(pin_check, keep=True), (0x10, 0x79AF): cup(cup_drop),
             (0x10, 0x7888): cup(hole_out_place, result=False)}
    if task:
        ports[(0x10, 0x4D45)] = ball_task
    return ports


def set_regs(m, regs):
    m.a, m.f, m.b, m.c, m.d, m.e = regs[:6]
    m.h, m.l = regs[6] >> 8, regs[6] & 0xFF


def event_diff(m, e):
    """[(address, simulated, game)] for the RAM recorded with event e (except the bytes other tasks own)."""
    want, got = bytes.fromhex(e[2]), m.wram[6][0x400:0x500]
    diff = [(0xD400 + k, got[k], want[k]) for k in range(0x100) if got[k] != want[k] and k not in SKIP]
    if len(e) > 5:                     # $C800-$C8FF (round and player data), in newer recordings
        want, got = bytes.fromhex(e[5]), m.wram[0][0x800:0x900]
        diff += [(0xC800 + k, got[k], want[k]) for k in range(0x100) if got[k] != want[k] and k not in SKIP_C8]
    if len(e) > 6:                     # WRAM6 $D300-$D3FF and $D500-$D5FF
        for k0, i, skip in ((0xD300, 6, SKIP_D3), (0xD500, 7, SKIP_D5)):
            want, got = bytes.fromhex(e[i]), m.wram[6][k0 - 0xD000:k0 - 0xCF00]
            diff += [(k0 + k, got[k], want[k]) for k in range(0x100) if got[k] != want[k] and k not in skip]
    return diff


class Mismatch(Exception):
    pass


class Finished(Exception):
    pass


def main():
    a = sys.argv[1:]
    rec = json.load(open(a[0]))
    m = Machine(load_rom())
    m.load_snapshot(rec["snapshot"])
    m.rom_bank = 0x10
    hole = bs.Hole(m.wram[6][0x320])
    if "--rom" not in a:
        m.overrides = make_overrides(hole, "--task" in a)
    ev = rec["events"]
    pos = [0]                          # next event to match
    stats = {"ok": 0}
    has_f = any(e[0] == "F" for e in ev)
    joy = rec.get("joy", {})
    all_tasks = bool(joy)              # recordings with the joypad (--from-address): all frame tasks run here   # newer recordings mark each AdvanceFrame of the main thread

    def check(kind):
        """The game is at an event of this kind: compare with the recording and consume it."""
        if pos[0] >= len(ev):
            raise Finished()
        e = ev[pos[0]]
        if e[0] != kind:
            raise Mismatch("event %d: game had %s (frame %d), simulation reached %s" % (pos[0], e[0], e[1], kind))
        diff = event_diff(m, e)
        if diff:
            lines = ["event %d (%s, frame %d): differs at %s" % (pos[0], kind, e[1], " ".join("$%04x" % d[0] for d in diff[:24]))]
            lines += ["   $%04x sim %02x game %02x" % d for d in diff[:8]]
            raise Mismatch("\n".join(lines))
        pos[0] += 1
        stats["ok"] += 1

    def ball_tasks(mm):
        """AdvanceFrame: run the ball steps the game ran in this frame (T events), then return at once."""
        if has_f:
            if pos[0] < len(ev) and ev[pos[0]][0] == "F":
                j = joy.get(str(pos[0]))
                check("F")
                if j:                  # the joypad as VBlank read it this frame
                    m.high[0x190:0x195] = bytes(j)
            else:
                raise Mismatch("event %d: game had %s (frame %d), simulation reached AdvanceFrame" % (pos[0], ev[pos[0]][0], ev[pos[0]][1]))
        if all_tasks:                  # run every frame task in ROM (RunFrameTasks 00:247D), BallTask included
            regs = (m.pc, m.sp, m.rom_bank, m.a, m.f, m.b, m.c, m.d, m.e, m.h, m.l)
            banks = (m.high[0x195], m.high[0x196], m.high[0x170])
            m.call(0, 0x247D, a=0)
            m.pc, m.sp, m.rom_bank, m.a, m.f, m.b, m.c, m.d, m.e, m.h, m.l = regs
            m.high[0x195], m.high[0x196], m.high[0x170] = banks
            if pos[0] >= len(ev):
                raise Finished()
            return True
        while pos[0] < len(ev) and ev[pos[0]][0] == "T":
            check("T")
            # RunFrameTasks (00:247D) keeps hROMBank, hWRAMBank and rSVBK for the interrupted main thread
            regs = (m.pc, m.sp, m.rom_bank, m.a, m.f, m.b, m.c, m.d, m.e, m.h, m.l)
            banks = (m.high[0x195], m.high[0x196], m.high[0x170])
            m.call(0x10, 0x4D45)
            m.pc, m.sp, m.rom_bank, m.a, m.f, m.b, m.c, m.d, m.e, m.h, m.l = regs
            m.high[0x195], m.high[0x196], m.high[0x170] = banks
        if pos[0] >= len(ev):
            raise Finished()
        return True

    m.watches = {(0x10, LOOP_TOP): lambda mm: check("L"), (0x10, PRE_TOP): lambda mm: check("P")}
    if all_tasks:
        m.watches[(0x10, 0x4D45)] = lambda mm: check("T")
    outcome, note = None, ""
    try:
        # ball steps before the first main-thread event, then enter the main thread there
        while ev[pos[0]][0] in "TF":
            kind = ev[pos[0]][0]
            check(kind)
            if kind == "T":
                m.call(0x10, 0x4D45)
        e = ev[pos[0]]
        if e[0] in "SAa":              # from ShotLaunch's entry (--from-launch) or the address step (--from-address)
            check(e[0])
        m.sp, m.pc = e[3], {"L": LOOP_TOP, "P": PRE_TOP, "S": 0x5F94, "A": 0x56B0, "a": 0x5713}[e[0]]
        set_regs(m, e[4])
        m.frame_hook = ball_tasks
        m.rom_bank = 0x10
        if m.run_until({LOOP_RET}, max_steps=50_000_000) == LOOP_RET:
            outcome = m.a
    except Finished:
        note = " (end of recording)"
    except Mismatch as x:
        note = "\n" + str(x)
    print("%d events matched (%d recorded)%s%s%s" % (stats["ok"], len(ev), "; loop returned a = $%02x" % outcome if outcome is not None else "",
          ("; ports ran: " + ", ".join("%s x%d" % kv for kv in WHAT.items())) if WHAT else "", note))


if __name__ == "__main__":
    main()
