"""Record a long round compactly for web/tests/golf_native_round.mjs: plays a button script from a saved state in
PyBoy and keeps, for every AdvanceFrame (00:2E3B), the joypad VBlank left ($FF90 held, read at 00:2EBF), and at
each address step (10:56B0) WRAM6 $D300-$D5FF and $C800-$C8FF with the index of the next AdvanceFrame; each
shot's outcome (10:4A25, register a); at each hole end (10:4635) $C800-$C8FF.
usage: emu_round_inputs.py OUT.json FRAMES (--state FILE | --boot) [--poke ADDR=VAL ...] [--every N] [--holes N]
                           [--press FRAME:BUTTON[:HOLD] ...]
  --boot: a fresh boot through the Stroke practice round's menus (tools/emu_script.py STROKE_HOLE1); the record
          starts at GolfRound's entry (10:4451), where the pokes are made (as for out/holesetup_*.json)
  --poke: bytes written after the state loads, or at GolfRound's entry with --boot (C893=01: player 1 is the
          computer golfer; 6:D4D7=01 a WRAM bank's byte)
  --holes N: stop at the Nth hole end (and in any case where the round ends, 10:464A)
  --every N: also A for 4 frames every N frames (from GolfRound's entry with --boot): captions and menus when a
          computer golfer plays
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import STROKE_HOLE1


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    boot = "--boot" in a
    if boot:
        e = Emu(fresh=True)
    else:
        e = Emu()
        e.load(a[a.index("--state") + 1])

    def args(flag):
        if flag not in a:
            return []
        out = []
        for p in a[a.index(flag) + 1:]:
            if p.startswith("--"):
                break
            out.append(p)
        return out
    rec = {"held": [], "addresses": [], "outcomes": [], "hole_ends": [], "pokes": {}}
    started = [not boot]

    def poke(p):
        addr, val = p.split("=")
        if ":" in addr:
            bank, a16 = (int(x, 16) for x in addr.split(":"))
            old = e.pb.memory[0xFF70]
            e.pb.memory[0xFF70] = bank
            e.pb.memory[a16] = int(val, 16)
            e.pb.memory[0xFF70] = old
        else:
            e.pb.memory[int(addr, 16)] = int(val, 16)
        rec["pokes"][addr.upper()] = int(val, 16)
    presses = {f: (b, 6) for f, b in STROKE_HOLE1.items()} if boot else {}
    for p in args("--press"):
        f, b, *h = p.split(":")
        presses[int(f)] = (b, int(h[0]) if h else 6)
    every = int(args("--every")[0]) if "--every" in a else 0
    cur = [0]

    def start(f0):
        for p in args("--poke"):
            poke(p)
        if every:
            for f in range(f0 + every, frames, every):
                presses.setdefault(f, ("a", 4))
    if boot:
        def round_entry(emu):
            if not started[0]:
                started[0] = True
                start(cur[0])
        e.hook(0x10, 0x4451, round_entry)
    else:
        start(0)

    def adv(emu):
        if started[0]:
            rec["held"].append(0)

    def joy(emu):
        if started[0] and rec["held"]:
            rec["held"][-1] = emu.pb.memory[0xFF90]

    def address(emu):
        rec["addresses"].append({"frame": len(rec["held"]), "d300": emu.wram(6, 0xD300, 0x300).hex(),
                                 "c800": bytes(emu.pb.memory[0xC800:0xC900]).hex()})

    def outcome(emu):
        rec["outcomes"].append(emu.regs()["A"])

    def hole_end(emu):
        rec["hole_ends"].append(bytes(emu.pb.memory[0xC800:0xC900]).hex())
    e.hook(0x00, 0x2E3B, adv)
    e.hook(0x00, 0x2EBF, joy)
    e.hook(0x10, 0x56B0, address)
    e.hook(0x10, 0x4A25, outcome)
    e.hook(0x10, 0x4635, hole_end)
    ended = [False]

    def round_end(emu):                        # 10:464A: the round is over (a match can end early)
        ended[0] = True
    e.hook(0x10, 0x464A, round_end)
    release = {}
    for f in range(frames):
        cur[0] = f
        if f in presses:
            b, h = presses[f]
            e.pb.button_press(b)
            release[f + h] = b
        if f in release:
            e.pb.button_release(release.pop(f))
        e.run(1)
        if "--holes" in a and len(rec["hole_ends"]) >= int(args("--holes")[0]):
            break
        if ended[0]:
            break
    json.dump(rec, open(out, "w"))
    print("%s: %d frames, %d address steps, %d outcomes, %d holes" % (out, len(rec["held"]), len(rec["addresses"]),
                                                                      len(rec["outcomes"]), len(rec["hole_ends"])))
    e.stop()


if __name__ == "__main__":
    main()
