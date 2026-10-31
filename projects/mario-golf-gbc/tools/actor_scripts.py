"""List the actor scripts (bytecode run by ActorsUpdateTask 04:4234, opcodes 04:420C) and which opcodes they use.

Scripts are found from
- the map headers' spawn lists (+4, MapInitObjects 0A:4F45) and the lists passed to ScriptRespawnActors
  (`ld hl, X` ... `rst $18 ; db $06, $0A`): 12-byte records [script, x, y, flag, ?, facing, anim, char], the list
  ending at a record whose byte 8 is $FF (SpawnActorList 04:5084);
- ActorSetScript calls (`ld de, X` ... `rst $18 ; db $18, $0A`) in the code banks 30-35, 0A, 0C.
Each script is walked as tools/trace_code.py does (argument bytes per opcode; $0C jumps relative; $00 ends).

usage: actor_scripts.py [--op N] (list the scripts using opcode N, hex) [--list]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels
from instruction_set import decode
from dump_maps import records, word

ARGS = [0, 1, 0, 4, 4, 5, 4, 3, 3, 0, 0, 0, 2, 3, 3, 0, 1, 1, 2, 0]
NAMES = ["End", "Wait", "WaitMove", "SetPos", "WalkTo", "WalkNear", "WalkBy", "WalkAngle", "WalkTurn", "Wander",
         "Follow", "Chase", "Jump", "SetField", "AddField", "Nop", "SetAnim", "SkipByte", "CallNative", "SetHome"]
SCAN_BANKS = [0x0A, 0x0C, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35]


def spawn_list(rom, bank, hl, out, origin):
    for _ in range(40):
        if not 0x4000 <= hl < 0x7FF4:
            return
        o = to_offset(bank, hl)
        if rom[o + 8] == 0xFF:
            return
        s = rom[o] | rom[o + 1] << 8
        if 0x4000 <= s < 0x8000:
            out.setdefault((bank, s), set()).add(origin)
        hl += 12


def find_scripts(rom):
    out = {}
    for mid, _gfx, idx, mbank, _m, _x in records(rom):
        hdr = word(rom, mbank, 0x4000 + idx)
        spawn_list(rom, mbank, word(rom, mbank, hdr + 4), out, "map %02x spawn list" % mid)
    for b in SCAN_BANKS:
        pc, imm = 0x4000, {}
        while pc < 0x7FFD:
            o = to_offset(b, pc)
            ins = decode(rom, o, pc)
            op = ins.raw[0]
            if op in (0x21, 0x11):
                imm[{0x21: "hl", 0x11: "de"}[op]] = ins.raw[1] | ins.raw[2] << 8
            if op == 0xDF:
                idx, fb = rom[o + 1], rom[o + 2]
                if (fb, idx) == (0x0A, 0x18) and "de" in imm and 0x4000 <= imm["de"] < 0x8000:
                    out.setdefault((b, imm["de"]), set()).add("ActorSetScript at %02x:%04x" % (b, pc))
                if (fb, idx) == (0x0A, 0x06) and "hl" in imm:
                    spawn_list(rom, b, imm["hl"], out, "ScriptRespawnActors at %02x:%04x" % (b, pc))
                pc += 3
                continue
            if ins.kind in ("jp", "ret", "call", "jr") and op not in (0x21, 0x11):
                if ins.kind != "call":
                    imm = {}
            pc += ins.length
    return out


def walk(rom, bank, addr):
    """the opcodes reached from a script: [(pc, op)]"""
    seen, todo, ops = set(), [addr], []
    while todo:
        pc = todo.pop()
        for _ in range(256):
            if (pc in seen) or not 0x4000 <= pc < 0x7FF8:
                break
            seen.add(pc)
            op = rom[to_offset(bank, pc)]
            if op >= len(ARGS):
                ops.append((pc, op))
                break
            ops.append((pc, op))
            if op == 0x0C:
                arg = rom[to_offset(bank, pc + 1)] | rom[to_offset(bank, pc + 2)] << 8
                todo.append((pc + 1 + arg) & 0xFFFF)
                break
            if op == 0x00:
                break
            pc += 1 + ARGS[op]
    return ops


def main():
    rom = load_rom()
    labels = Labels()
    scripts = find_scripts(rom)
    hist = {}
    want = int(sys.argv[sys.argv.index("--op") + 1], 16) if "--op" in sys.argv else None
    for (b, a), why in sorted(scripts.items()):
        ops = walk(rom, b, a)
        for pc, op in ops:
            hist.setdefault(op, set()).add((b, a))
        if "--list" in sys.argv or (want is not None and any(op == want for _, op in ops)):
            name = (labels.get(b, a) or ("",))[0]
            print("%02x:%04x %-36s %s  (%s)" % (b, a, name, " ".join(
                NAMES[op] if op < len(NAMES) else "?%02x" % op for _, op in ops), "; ".join(sorted(why))[:80]))
    print("%d scripts; opcodes used:" % len(scripts))
    for op in sorted(hist):
        print("  $%02x %-10s in %d scripts" % (op, NAMES[op] if op < len(NAMES) else "?", len(hist[op])))


if __name__ == "__main__":
    main()
