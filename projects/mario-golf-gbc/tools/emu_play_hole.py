"""Play a hole in the emulator with a simple bot, and record it.

The bot reacts to the game's phases (code hooks): in the aiming menu (10:5BA6) it presses A; at the address
step (10:56B0) it swings: A to start, A for power after POWER frames, A for impact after IMPACT more frames
(per shot from --swings, else the defaults); otherwise, when nothing happened for a while, A (messages).
Records at every shot start (ShotSetup 10:4798) the frame, WRAM6 $D300-$D5FF and WRAM0 $C800-$C8FF and a
screenshot (out/hole_<n>.png), and every shot's outcome (10:4A25, register a). Stops when the hole is done
(10:4635) or after FRAMES. Writes OUT.json with the shots and the presses made ({frame: button}), so the
same play can be replayed with tools/emu_script.py presses.

  --plan: each swing chosen by tools/plan_shot.py (the Python engine run from the address snapshot)
  --seek XX: until one is found, look for a swing (and aim) whose outcome is XX (e.g. 03 water, 07 out of bounds)
  --holes N: play on until N holes are done (or the round ends, 10:466D)
usage: emu_play_hole.py OUT.json FRAMES [--state FILE] [--plan] [--seek XX] [--swings P,I P,I ...] [--holes N]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_shot_record import snapshot
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan_shot

DEFAULT = (60, 60)                      # power after 60 frames of meter (full), impact 60 later (cursor 0)


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    swings = []
    if "--swings" in a:
        for x in a[a.index("--swings") + 1:]:
            if x.startswith("--"):
                break
            p, i = x.split(",")
            swings.append((int(p), int(i)))
    e = Emu()
    e.load(state)
    cur = {"f": 0, "phase": None, "t0": 0, "last": 0, "shot": 0, "done": False}
    plan = {}                           # frame -> button
    held_for = {}                       # frame -> frames to hold (default 6)
    rec = {"state": state, "shots": [], "outcomes": [], "presses": {}}

    def at(f, button):
        if f not in plan:
            plan[f] = button

    def menu(emu):
        cur["phase"], cur["t0"], cur["last"] = "menu", cur["f"], cur["f"]
        at(cur["f"] + 20, "a")

    def address(emu):
        cur["phase"], cur["t0"], cur["last"] = "address", cur["f"], cur["f"]
        n = max(cur["shot"] - 1, 0)
        aim, found = 0, None
        if "--seek" in a and not cur.get("sought"):    # look for a swing with this outcome (e.g. 03 water)
            found = plan_shot.seek(snapshot(emu), int(a[a.index("--seek") + 1], 16))
        if found:
            (p, i, aim), o, d = found
            cur["sought"] = True
            print("shot %d: seek P %d I %d aim %d -> outcome $%02x" % (cur["shot"], p, i, aim, o))
        elif n < len(swings):
            p, i = swings[n]
        elif "--plan" in a:                     # choose the swing with the Python engine
            (p, i), o, d = plan_shot.plan(snapshot(emu))
            print("shot %d: plan P %d I %d -> outcome $%02x, %.0f from the cup" % (cur["shot"], p, i, o, d))
        else:
            p, i = DEFAULT
        for f, b in plan_shot.swing_presses(p, i, aim).items():
            name, _, hold = b.partition(":")
            if hold:
                held_for[cur["f"] + f] = int(hold)
            at(cur["f"] + f, name)

    def setup(emu):
        cur["shot"] += 1
        cur["last"] = cur["f"]
        rec["shots"].append({"frame": cur["f"], "d300": emu.wram(6, 0xD300, 0x300).hex(),
                             "c800": bytes(emu.pb.memory[0xC800:0xC900]).hex()})
        emu.shot("out/hole_%d.png" % cur["shot"])

    def outcome(emu):
        cur["last"] = cur["f"]
        rec["outcomes"].append([cur["f"], emu.regs()["A"]])

    holes = int(a[a.index("--holes") + 1]) if "--holes" in a else 1
    cur["holes"] = 0

    def hole_done(emu):
        cur["holes"] += 1
        print("hole %d done at frame %d" % (cur["holes"], cur["f"]))
        if cur["holes"] >= holes:
            cur["done"] = True

    def round_done(emu):
        cur["done"] = True
    e.hook(0x10, 0x466D, round_done)
    e.hook(0x10, 0x5BA6, menu)
    e.hook(0x10, 0x56B0, address)
    e.hook(0x10, 0x4798, setup)
    e.hook(0x10, 0x4A25, outcome)
    e.hook(0x10, 0x4635, hole_done)
    held = {}
    for f in range(frames):
        cur["f"] = f
        if f - cur["last"] > 150 and (f - cur["last"]) % 60 == 0:
            at(f, "a")                  # nothing for a while: a message waiting for A?
        if f in plan:
            e.pb.button_press(plan[f])
            n = held_for.get(f, 6)
            held[f + n] = plan[f]
            rec["presses"][f] = plan[f] + (":%d" % n if n != 6 else "")
        if f in held:
            e.pb.button_release(held.pop(f))
        e.run(1)
        if cur["done"]:
            e.run(30)
            break
    e.shot("out/hole_end.png")
    json.dump(rec, open(out, "w"))
    print("%s: %d shots, outcomes %s, %s after %d frames" % (out, len(rec["shots"]),
          " ".join("$%02x" % o for _, o in rec["outcomes"]), "hole done" if cur["done"] else "not done", cur["f"]))
    e.stop()


if __name__ == "__main__":
    main()
