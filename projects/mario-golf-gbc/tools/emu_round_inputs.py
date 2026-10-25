"""Record a long round compactly for web/tests/golf_native_round.mjs: plays a button script from a saved state in
PyBoy and keeps, for every AdvanceFrame (00:2E3B), the joypad VBlank left ($FF90 held, read at 00:2EBF), and at
each address step (10:56B0) WRAM6 $D300-$D5FF and $C800-$C8FF with the index of the next AdvanceFrame; each
shot's outcome (10:4A25, register a); at each hole end (10:4635) $C800-$C8FF.
usage: emu_round_inputs.py OUT.json FRAMES --state FILE --press FRAME:BUTTON[:HOLD] ...
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    e = Emu()
    e.load(a[a.index("--state") + 1])
    presses = {}
    for p in a[a.index("--press") + 1:]:
        if p.startswith("--"):
            break
        f, b, *h = p.split(":")
        presses[int(f)] = (b, int(h[0]) if h else 6)
    rec = {"held": [], "addresses": [], "outcomes": [], "hole_ends": []}

    def adv(emu):
        rec["held"].append(0)

    def joy(emu):
        if rec["held"]:
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
    release = {}
    for f in range(frames):
        if f in presses:
            b, h = presses[f]
            e.pb.button_press(b)
            release[f + h] = b
        if f in release:
            e.pb.button_release(release.pop(f))
        e.run(1)
    json.dump(rec, open(out, "w"))
    print("%s: %d frames, %d address steps, %d outcomes, %d holes" % (out, len(rec["held"]), len(rec["addresses"]),
                                                                      len(rec["outcomes"]), len(rec["hole_ends"])))
    e.stop()


if __name__ == "__main__":
    main()
