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

LOOP_TOP, LOOP_CALL, LOOP_RET = 0x6EAA, 0x6EA7, 0x4A25
PRE_TOP, PRE_CALL = 0x49DD, 0x49DA     # the flight-camera loop (10:49D8) that runs before the main loop
# camera and display bytes that other frame tasks update between the events (not simulated here)
SKIP_C8 = set()
SKIP = set(range(0x2E, 0x38)) | set(range(0x5C, 0x60)) | set(range(0x65, 0x68)) | set(range(0x6B, 0x80))


def ball_view(m):
    return memoryview(m.wram[6])[0x400:0x500]


WHAT = {}                              # ported branches taken (water, plugged, splash, bunker)


def make_overrides(hole):
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
    return {(0x10, 0x4EE0): flight, (0x10, 0x4D09): land, (0x10, 0x4D86): roll, (0x10, 0x7CAB): pull}


def set_regs(m, regs):
    m.a, m.f, m.b, m.c, m.d, m.e = regs[:6]
    m.h, m.l = regs[6] >> 8, regs[6] & 0xFF


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
        m.overrides = make_overrides(hole)
    ev = rec["events"]
    pos = [0]                          # next event to match
    stats = {"ok": 0}
    has_f = any(e[0] == "F" for e in ev)   # newer recordings mark each AdvanceFrame of the main thread

    def check(kind):
        """The game is at an event of this kind: compare with the recording and consume it."""
        if pos[0] >= len(ev):
            raise Finished()
        e = ev[pos[0]]
        if e[0] != kind:
            raise Mismatch("event %d: game had %s (frame %d), simulation reached %s" % (pos[0], e[0], e[1], kind))
        want, got = bytes.fromhex(e[2]), m.wram[6][0x400:0x500]
        diff = [(0xD400 + k, got[k], want[k]) for k in range(0x100) if got[k] != want[k] and k not in SKIP]
        if len(e) > 5:                 # $C800-$C8FF (round and player data), in newer recordings
            want, got = bytes.fromhex(e[5]), m.wram[0][0x800:0x900]
            diff += [(0xC800 + k, got[k], want[k]) for k in range(0x100) if got[k] != want[k] and k not in SKIP_C8]
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
                check("F")
            else:
                raise Mismatch("event %d: game had %s (frame %d), simulation reached AdvanceFrame" % (pos[0], ev[pos[0]][0], ev[pos[0]][1]))
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
    outcome, note = None, ""
    try:
        # ball steps before the first main-thread event, then enter the main thread there
        while ev[pos[0]][0] in "TF":
            kind = ev[pos[0]][0]
            check(kind)
            if kind == "T":
                m.call(0x10, 0x4D45)
        e = ev[pos[0]]
        m.sp, m.pc = e[3], (LOOP_TOP if e[0] == "L" else PRE_TOP)
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
