"""Event-flag usage map (flags = bit array wEventFlags $C9C0, inside the $C800 save image).

Sources: `rst $20/$28/$30 ; dw n<<5` (set/clear/test), `ld de, n ; call Set/Clear/TestFlagIdx`
($2509/$2523/$24EF) and the condition words of the field-scene records (dump_scenes.py).
Scans the code banks only (list below) to avoid matches inside graphics.
usage: dump_flags.py [--flag N]
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, BANK_SIZE
from xref import scan

CODE_BANKS = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F,
              0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x24, 0x27, 0x28,
              0x38, 0x3B, 0x3E, 0x6B]
rom = load_rom()
uses = collections.defaultdict(list)
KIND = {0x20: "set", 0x28: "clear", 0x30: "test"}
IDX = {0x2509: "set", 0x2523: "clear", 0x24EF: "test"}


def flagnum(w): return ((w >> 8) & 0xFF) * 8 + ((w >> 5) & 7)


for b in CODE_BANKS:
    prev = None
    for ins, off in scan(rom, b):
        if ins[0] == "inline":
            _, rins, data, pc = ins
            if rins.kind == "rst" and rins.target in KIND and len(data) >= 2:
                uses[flagnum(data[0] | data[1] << 8)].append("%02x:%04x %s" % (b, pc - 1, KIND[rins.target]))
            prev = None
            continue
        if ins.kind == "call" and ins.target in IDX and prev is not None:
            uses[prev].append("%02x:%04x %s" % (b, ins.pc, IDX[ins.target]))
        prev = ins.operand[1] if (ins.text.startswith("ld de, $") and ins.operand and ins.operand[0] == "d16") else None

# scene record conditions
import dump_scenes as ds
for area in range(42):
    rec = [ds.u8(0x0A, 0x564F + area * 6 + i) for i in range(6)]
    bank = rec[3]; d = ds.u16(bank, 0x4000 + rec[2])
    w = [ds.u16(bank, d + 2 * i) for i in range(7)]
    for li, kind in ((1, "exit"), (3, "talk"), (4, "event4"), (5, "step")):
        p = w[li]
        while p and ds.u8(bank, p) != 0xFF:
            c = ds.u16(bank, p + 2)
            if c: uses[flagnum(c & 0x7FFF)].append("area %02x %s %02x %s" % (area, kind, ds.u8(bank, p), "if-set" if c & 0x8000 else "if-clear"))
            p += 8
    p = w[2]
    while ds.u8(bank, p + 9) != 0xFF:
        c = ds.u16(bank, p)
        if c: uses[flagnum(c & 0x7FFF)].append("area %02x actor@%04x %s" % (area, p, "if-set" if c & 0x8000 else "if-clear"))
        p += 14

only = int(sys.argv[sys.argv.index("--flag") + 1]) if "--flag" in sys.argv else None
for n in sorted(uses):
    if only is not None and n != only: continue
    kinds = collections.Counter(u.split()[-1] for u in uses[n])
    print("flag %4d ($%03x byte %3d bit %d)  %s" % (n, n, n >> 3, n & 7, " ".join("%s×%d" % kv for kv in sorted(kinds.items()))))
    if only is not None or len(uses[n]) <= 6:
        for u in uses[n]: print("      " + u)
print(len(uses), "flags referenced")
