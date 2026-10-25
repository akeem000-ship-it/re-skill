"""Record the reference for the hole set-up (web/tests/golf_hole_setup.mjs): boots the game in PyBoy and plays
the Stroke practice round script (tools/emu_script.py STROKE_HOLE1, then A at the aiming menu), taking a full
RAM snapshot (as tools/emu_shot_record.py does) at
  round   GolfRound entry (10:4451), with register a (the round id)
  hole    each pass of the per-hole start (10:44B4)
  pick    each PickNextPlayer call in the per-hole set-up (10:45D9)
  address each AddressBall entry (10:56B0)
plus the frame each was reached at and the number of AdvanceFrame calls (00:2E3B) since GolfRound.
--state FILE starts from a saved state instead of a fresh boot (then --press gives the script).
--poke ADDR=HEX (WRAM0 or HRAM) changes the RAM when GolfRound is entered (e.g. C836=02 C837=05 for course 2,
hole 5); --auto presses A 40 frames after each entry to the aiming menu (AimMenu 10:5BA6) instead of the fixed
press of the script; --menu OFF:BUTTON[:HOLD] ... presses buttons that many frames into the first aiming menu
(held 6 frames, or HOLD), and A 40 frames after the last.
Every AdvanceFrame (00:2E3B) from GolfRound's entry on is an event ["F", frame, WRAM6 $D300-$D5FF, $C800-$C8FF,
joypad $FF90-$FF94 as VBlank left it for that frame (read at 00:2EBF)], and the steps of the set-up are events
["M", frame, name] (MARKS), so a frame-exact port can be checked frame by frame ("events").
usage: emu_hole_setup.py OUT.json FRAMES [--state FILE] [--press FRAME:BUTTON ...] [--stop KIND:N]
                         [--poke ADDR=HEX ...] [--auto]
  --stop address:1 stops after the first address step (default)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, STROKE_HOLE1
from tools.emu_shot_record import snapshot


class Stop(Exception):
    pass


MARKS = {(0x10, 0x44B4): "hole", (0x08, 0x6432): "flyover", (0x12, 0x6F8D): "windintro", (0x10, 0x45D9): "pick",
         (0x10, 0x4798): "shotsetup", (0x10, 0x5BA6): "aimmenu", (0x10, 0x56B0): "address"}


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    stop = a[a.index("--stop") + 1] if "--stop" in a else "address:1"
    skind, scount = stop.split(":")[0], int(stop.split(":")[1])
    if "--state" in a:
        e = Emu()
        e.load(a[a.index("--state") + 1])
        presses = parse_presses(a)
    else:
        e = Emu(fresh=True)
        presses = dict(STROKE_HOLE1)
        if "--auto" not in a:
            presses[4680] = "a"                 # the aiming menu: swing
    pokes = [x for x in a if "=" in x and not x.startswith("--")]
    menu, menu_done, holds = [], [False], {}
    if "--menu" in a:
        for x in a[a.index("--menu") + 1:]:
            if x.startswith("--") or "=" in x:
                break
            p = x.split(":")
            menu.append((int(p[0]), p[1], int(p[2]) if len(p) > 2 else 0))
    rec = {"points": [], "events": []}
    cur = [0]
    nframes = [None]

    def adv(emu):
        if nframes[0] is not None:
            nframes[0] += 1
            rec["events"].append(["F", cur[0], emu.wram(6, 0xD300, 0x300).hex(),
                                  bytes(emu.pb.memory[0xC800:0xC900]).hex(), None])
    e.hook(0x00, 0x2E3B, adv)

    def joy(emu):                               # 00:2EBF: the joypad VBlank read for this AdvanceFrame
        if nframes[0] is not None and rec["events"]:
            last = next(x for x in reversed(rec["events"]) if x[0] == "F")
            last[4] = [emu.pb.memory[0xFF90 + i] for i in range(5)]
    e.hook(0x00, 0x2EBF, joy)

    def mark(name):
        def f(emu):
            if nframes[0] is not None:
                rec["events"].append(["M", cur[0], name])
            if name == "aimmenu" and "--auto" in a:
                if menu and not menu_done[0]:
                    menu_done[0] = True
                    for off, b, hold in menu:
                        presses[cur[0] + off] = b
                        if hold:
                            holds[cur[0] + off] = hold
                    presses[cur[0] + max(o for o, _, h in menu) + 40] = "a"
                else:
                    presses[cur[0] + 40] = "a"
        return f
    for (b, ad), name in MARKS.items():
        if name not in ("hole", "pick", "address"):
            e.hook(b, ad, mark(name))

    def point(kind):
        def f(emu):
            if kind in ("hole", "pick", "address"):
                mark(kind)(emu)
            if kind == "round":
                nframes[0] = 0
                for p in pokes:
                    k, v = p.split("=")
                    for i, b in enumerate(bytes.fromhex(v)):
                        emu.w8(int(k, 16) + i, b)
            r = emu.regs()
            rec["points"].append({"kind": kind, "frame": cur[0], "advances": nframes[0], "a": r["A"],
                                  "snapshot": snapshot(emu)})
            print("%s at frame %d (%s AdvanceFrame calls since GolfRound)" % (kind, cur[0], nframes[0]))
        return f
    e.hook(0x10, 0x4451, point("round"))
    e.hook(0x10, 0x44B4, point("hole"))
    e.hook(0x10, 0x45D9, point("pick"))
    e.hook(0x10, 0x56B0, point("address"))
    release = {}
    for f in range(frames):
        cur[0] = f
        if f in presses:
            e.pb.button_press(presses[f])
            release[f + holds.get(f, 6)] = presses[f]
        if f in release:
            e.pb.button_release(release.pop(f))
        e.run(1)
        if sum(1 for p in rec["points"] if p["kind"] == skind) >= scount:
            break
    json.dump(rec, open(out, "w"))
    print(out)
    e.stop()


if __name__ == "__main__":
    main()
