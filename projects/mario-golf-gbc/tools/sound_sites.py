"""List the sound commands (rst $08 ; db id, and call PlaySoundCmd 00:2BBB / PlaySoundManaged 00:2C19 with a
loaded first) inside the traced routines of some banks, with whether a rewrite cites the routine: to hook a native
port's sounds to the sound driver.
usage: sound_sites.py BANK [BANK ...] [--cited]   (bank hex; --cited: only routines a rewrite cites)
"""
import sys, os, json, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import ROOT, Labels, load_rom, to_offset
from decomp_progress import cited, sources
from instruction_set import decode
from disasm import inline_len


def main():
    banks = [int(x, 16) for x in sys.argv[1:] if not x.startswith("--")]
    only = "--cited" in sys.argv
    rom = load_rom()
    cites = cited(sources("all"))
    code = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_map.json"))).items()}
    ent = {int(k): set(v) for k, v in json.load(open(os.path.join(ROOT, "states", "code_entries.json"))).items()}
    labels = Labels()
    for (b, a), (name, _) in labels.by.items():
        if b == "*" or a >= 0x8000 or not name:
            continue
        ent.setdefault(0 if a < 0x4000 else b, set()).add(a)
    for b in banks:
        starts = sorted(ent.get(b, ()))
        cb = code.get(b, set())
        for i, s in enumerate(starts):
            if s not in cb:
                continue
            end = starts[i + 1] if i + 1 < len(starts) else (0x4000 if b == 0 else 0x8000)
            done = (b, s) in cites
            if only and not done:
                continue
            pc, last_a = s, None
            while pc < end:
                if pc not in cb:             # a gap (data, or code after a jump): the next code byte
                    pc += 1
                    continue
                ins = decode(rom, to_offset(b, pc), pc)
                n = inline_len(ins)
                if ins.kind == "rst" and ins.target == 0x08:
                    sid = rom[to_offset(b, pc + 1)]
                    print("%02x:%04x %s %02x:%04x %-28s rst $08 $%02x" % (b, pc, "*" if done else " ", b, s,
                          (labels.get(b, s) or ("",))[0], sid))
                elif ins.kind == "call" and ins.target in (0x2BBB, 0x2C19) and n == 0:
                    print("%02x:%04x %s %02x:%04x %-28s call %04x a=%s" % (b, pc, "*" if done else " ", b, s,
                          (labels.get(b, s) or ("",))[0], ins.target, last_a))
                if ins.text.startswith("ld a, $"):
                    last_a = ins.text[6:]
                pc += ins.length + n
                if ins.kind == "rst" and ins.target == 0x00:
                    break                    # an inline jump table follows


if __name__ == "__main__":
    main()
