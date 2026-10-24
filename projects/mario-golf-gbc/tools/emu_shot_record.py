"""Record a whole shot for tools/shot_sim.py: a full RAM snapshot at the first main-thread event (L or P, so the
replay starts with the main thread at a known point), then the ordered events
  T  BallTask entry (10:4D45)       L  main-loop pass (10:6EAA, just after its AdvanceFrame; with SP)
  P  pass of the flight-camera loop before it (10:49DD, after its AdvanceFrame; with SP)
  F  AdvanceFrame entry (00:2E3B): the T events up to the next F ran in that frame
each with WRAM6 $D400-$D4FF (and, since F, $C800-$C8FF: round and player data), until FRAMES have run. (Recordings made before F existed started at the first T.)

usage: emu_shot_record.py OUT.json FRAMES [--state FILE] [--press FRAME:BUTTON ...]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import parse_presses, run_script


def snapshot(e):
    pb = e.pb
    snap = {"wram%d" % i: e.wram(i, 0xD000, 0x1000).hex() for i in range(1, 8)}
    snap["wram0"] = bytes(pb.memory[0xC000:0xD000]).hex()
    snap["vram0"], snap["vram1"] = e.vram(0, 0x8000, 0x2000).hex(), e.vram(1, 0x8000, 0x2000).hex()
    snap["high"] = bytes(pb.memory[0xFE00:0x10000]).hex() if False else bytes(pb.memory[a] for a in range(0xFE00, 0x10000)).hex()
    snap["sram"] = bytes(e.sram(0, 0xA000 + i) for i in range(0x2000)).hex()
    snap["rom_bank"] = pb.memory[0xFF95]
    return snap


def main():
    a = sys.argv[1:]
    out, frames = a[0], int(a[1])
    state = a[a.index("--state") + 1] if "--state" in a else "states/stroke_hole1.state"
    e = Emu()
    e.load(state)
    rec = {"events": [], "snapshot": None}
    cur = [0]

    def ev(kind):
        def f(emu):
            if rec["snapshot"] is None:
                if kind in "TF":
                    return
                rec["snapshot"] = snapshot(emu)
            r = emu.regs()
            rec["events"].append([kind, cur[0], emu.wram(6, 0xD400, 0x100).hex(), r["SP"],
                                  [r["A"], r["F"], r["B"], r["C"], r["D"], r["E"], r["HL"]],
                                  bytes(emu.pb.memory[0xC800:0xC900]).hex()])
        return f
    e.hook(0x10, 0x4D45, ev("T"))
    e.hook(0x10, 0x6EAA, ev("L"))
    e.hook(0x10, 0x49DD, ev("P"))
    e.hook(0x00, 0x2E3B, ev("F"))

    def each(f):
        cur[0] = f
    run_script(e, frames, parse_presses(a), each=each)
    json.dump(rec, open(out, "w"))
    print("%s: %d events (%d T, %d L)" % (out, len(rec["events"]), sum(1 for x in rec["events"] if x[0] == "T"),
          sum(1 for x in rec["events"] if x[0] == "L")))
    e.stop()


if __name__ == "__main__":
    main()
