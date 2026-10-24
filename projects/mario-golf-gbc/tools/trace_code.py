"""(Copied from ../mario-tennis-gbc/tools/trace_code.py and adapted to Golf's data banks and labels.)
Recursive-descent code tracer: follows control flow from the vectors and Init through
calls, jumps, rst $00 inline tables, inline-argument RSTs and rst $10/$18 farcalls (switching
bank), and from extra roots (task functions passed to AddTask, etc. via --roots BB:AAAA,...).

Outputs per-bank coverage and states/code_map.json ({bank: [[start, end], ...]} of code bytes),
states/code_entries.json ({bank: [entry, ...]}), and appends nothing to labels.csv (use --emit-labels to print sub_BB_AAAA candidates).
usage: trace_code.py [--roots BB:AAAA,...] [--report]
"""
import sys, os, re, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, nbanks, ROOT, Labels
from instruction_set import decode
from disasm import inline_len, farcall_target
from scan_jumptables import table

rom = load_rom(); NB = nbanks(rom)
TABLE_LEN = {b: len(table(rom, b)) for b in range(1, NB)}
code = collections.defaultdict(set)     # bank -> set of code byte addresses
entries = collections.defaultdict(set)  # bank -> function entry addresses
work = []


def push(bank, addr, entry=False):
    if addr < 0x4000: bank = 0
    elif addr >= 0x8000: return
    if bank >= NB: return
    if entry: entries[bank].add(addr)
    work.append((bank, addr))


def add_root(spec):
    b, a = spec.split(":"); push(int(b, 16), int(a, 16), True)


for v in (0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x40, 0x48, 0x50, 0x58, 0x100):
    push(0, v, True)
# AddTask(HL) targets and other known indirect roots from labels.csv (names, not data tables)
# data labels (not code roots): names ending in Table / Tables / Data (optionally + one capital letter or a
# _BB copy suffix), and older data names that predate that convention
DATA_NAME = re.compile(r"(Table|Tables|Data)([A-Z]|_[0-9A-F]{2})?$")
DATA_NAMES = {"Font", "FontWidths", "FontTiles", "SaveSignature", "PowerCurve", "MissCurve", "SpeedTableJump",
              "DefaultBGPalettes", "DefaultOBJPalettes", "CursorSpriteTiles", "LinkLostTilesLZ", "LinkLostPalettes",
              "StatsPalettes", "RecordsPalettes", "GfxPromptStrings", "DebugFlagHeaderText", "NumberFontGlyphPtrs",
              "Map39LetterSpriteTiles", "Map39MarkerSpriteTiles", "SineTable8"}
LABELS = Labels()
DATA_LABELS = set()
for (b, a), (name, _) in LABELS.by.items():
    if b == "*" or a >= 0x8000 or not name:
        continue
    if DATA_NAME.search(name) or name in DATA_NAMES:
        DATA_LABELS.add((b if a >= 0x4000 else 0, a))
    else:
        push(b if a >= 0x4000 else 0, a, True)
# export tables of code banks: a bank counts as code when most of its exports start with a
# typical routine opener (push/ld/call/xor/and/or/cp/rst/jr/jp/ret)
OPENERS = {0xC5, 0xD5, 0xE5, 0xF5, 0xCD, 0xC3, 0xAF, 0xA7, 0xB7, 0xFA, 0xF0, 0x21, 0x11, 0x01, 0x3E, 0x06, 0x0E,
           0x16, 0x1E, 0x26, 0x2E, 0xDF, 0xD7, 0xF7, 0xE7, 0xEF, 0xCF, 0x18, 0x20, 0x28, 0x30, 0x38, 0xC9, 0x7E, 0x2A,
           0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0xE8, 0xF8, 0xCB, 0xEA, 0xE0, 0x1A}
# Golf's asset banks (REVERSE.md "Bank map"): text, map graphics and headers, LZ graphics, holes
DATA_BANKS = set(range(0x18, 0x20)) | set(range(0x28, 0x36)) | {0x40} | set(range(0x4B, 0x4F)) | {0x58} | \
    set(range(0x50, 0x75)) | {0x36, 0x37}          # 36, 37: LZ graphics only (export words look like code)
CODE_BANKS = []
for b in range(1, NB):
    t = table(rom, b)
    if len(t) < 2: continue
    hits = sum(1 for w in t if rom[to_offset(b, w)] in OPENERS)
    if hits >= 0.8 * len(t) and b not in DATA_BANKS:
        CODE_BANKS.append(b)
        for w in t:
            if (b, w) not in DATA_LABELS: push(b, w, True)
# map scripts (REVERSE.md "Top level"; tools/map_scripts.py): enter / talk / object / trigger scripts
from map_scripts import roots as map_script_roots
for mbank, s in map_script_roots(rom):
    push(mbank, s, True)
if "--roots" in sys.argv:
    for r in sys.argv[sys.argv.index("--roots") + 1].split(","): add_root(r)

# actor scripts (bytecode run by ActorsUpdateTask 04:4234): argument bytes per opcode $00-$13; op $12 calls
# native code (ActorOpCallNative 04:4A7C), op $0C jumps relative, op $00 ends
ACTOR_ARGS = [0, 1, 0, 4, 4, 5, 4, 3, 3, 0, 0, 0, 2, 3, 3, 0, 1, 1, 2, 0]
actor_scripts, actor_done = set(), set()


def parse_actor_script(bank, addr):
    todo = [addr]
    while todo:
        pc = todo.pop()
        for _ in range(256):
            if (bank, pc) in actor_done or not 0x4000 <= pc < 0x7FF8:
                break
            actor_done.add((bank, pc))
            op = rom[to_offset(bank, pc)]
            if op >= len(ACTOR_ARGS):
                break
            arg = rom[to_offset(bank, pc + 1)] | rom[to_offset(bank, pc + 2)] << 8
            if op == 0x12:
                push(bank, arg, True)
            if op == 0x0C:
                todo.append((pc + 1 + arg) & 0xFFFF)   # relative to the argument? see ActorOpJump 04:49A2
                break
            if op == 0x00:
                break
            pc += 1 + ACTOR_ARGS[op]


def push_word_table(bank, t, n, allow_zero=False):
    """Entries of a jump table at bank:t: at most n words, targets in the table's own area (bank 0 or this
    bank's $4000-$7FFF); stops at the first word that is not such a target or where the code of an entry starts."""
    lo, hi = (0x4000, 0x8000) if t >= 0x4000 else (0x0100, 0x4000)
    first = hi
    for e in range(n):
        a = t + 2 * e
        if not lo <= a < hi - 1 or a >= first:
            break
        o = to_offset(bank, a)
        w = rom[o] | rom[o + 1] << 8
        if w == 0 and allow_zero:
            continue
        if not lo <= w < hi or rom[to_offset(bank, w)] == 0xFF or t <= w < a + 2:
            break
        if w > t:
            first = min(first, w)
        push(bank, w, True)


TABLE_CALLS = {0x470D: (0x08, 16, True),   # DispatchByGameMode 08:470D: hl = 16 words by wGameMode, 0 = none
               0x4D79: (0x11, 8, True)}    # 11:4D79: hl = handler table kept in $D47E (8 words)


seen = set()
while work or actor_scripts - {(b, a) for b, a in actor_done}:
  if not work:
      for b, a in sorted(actor_scripts):
          parse_actor_script(b, a)
      actor_scripts.clear()
      continue
  while work:
    bank, pc = work.pop()
    imm = {}                                # last immediates on this path: code pointers passed in registers
    while True:
        key = (bank if pc >= 0x4000 else 0, pc)
        if key in seen or pc >= 0x8000: break
        seen.add(key)
        cb = key[0]
        off = to_offset(cb, pc)
        ins = decode(rom, off, pc)
        if ins.kind == "illegal": break
        if ins.raw[0] == 0xFF: break                     # rst $38: the $FF fill (RST38_Fill), never a real call
        for i in range(ins.length): code[cb].add(pc + i)
        nxt = pc + ins.length
        op = ins.raw[0]
        if op in (0x21, 0x11, 0x01):                                # ld hl / de / bc, nn
            imm[{0x21: "hl", 0x11: "de", 0x01: "bc"}[op]] = ins.raw[1] | ins.raw[2] << 8
        elif op == 0x3E:
            imm["a"] = ins.raw[1]
        elif op in (0x19, 0x09):                                    # add hl, de / bc: a table base in de / bc
            r = "de" if op == 0x19 else "bc"
            if r in imm: imm["hl"] = imm[r]
            else: imm.pop("hl", None)
        elif op in (0xE1, 0xF8, 0x29, 0x39):                        # pop hl / ld hl, sp+n / add hl, hl / sp
            imm.pop("hl", None)
        if ins.kind in ("call", "jp") and ins.target in TABLE_CALLS and cb == TABLE_CALLS[ins.target][0] and "hl" in imm:
            push_word_table(cb, imm["hl"], TABLE_CALLS[ins.target][1], TABLE_CALLS[ins.target][2])
        # inline jump table: ld hl, T ... ld a, [hl+] ; ld h, [hl] ; ld l, a ... jp hl (or call JumpToHL 00:0699)
        if op == 0x2A and rom[off + 1:off + 3] == bytes((0x66, 0x6F)) and "hl" in imm:
            imm["table"] = imm["hl"]
        if (op == 0xE9 or ins.kind == "call" and ins.target == 0x0699) and "table" in imm:
            push_word_table(cb, imm.pop("table"), 32, True)
        if ins.kind == "call" and ins.target == 0x23E8 and "hl" in imm:     # RegisterFrameTask: hl = task, this bank
            push(cb, imm["hl"], True)
        if ins.kind == "call" and ins.target == 0x015E and "hl" in imm and "a" in imm:  # CallHLInBankA
            push(imm["a"], imm["hl"], True)
        n = inline_len(ins)
        if n:
            data = rom[off + ins.length:off + ins.length + n]
            for i in range(n): code[cb].add(nxt + i)
            if ins.kind == "rst" and ins.target in (0x10, 0x18) or ins.kind == "call" and n == 2 and ins.target == 0x01F6:
                idx, fb = data[0], data[1]
                if (fb, idx) == (0x0A, 0x18) and "de" in imm:            # ActorSetScript: de = actor script, this bank
                    actor_scripts.add((cb, imm["de"]))
                if (fb, idx) == (0x0A, 0x4C) and "hl" in imm and "de" in imm and 0x4000 <= imm["hl"] < 0x8000:
                    # ScriptSetMapField: word at $C450 + de = hl; de $0C / $0E / $10 = talk / object / trigger list
                    # (8-byte records, script word at +4), $12 = enter script (in the map's bank: this bank)
                    if imm["de"] == 0x12:
                        push(cb, imm["hl"], True)
                    elif imm["de"] in (0x0C, 0x0E, 0x10):
                        o = to_offset(cb, imm["hl"])
                        if rom[o] != 0xC9:
                            while rom[o] != 0xFF and o < to_offset(cb, 0x7FF8):
                                w = rom[o + 4] | rom[o + 5] << 8
                                if 0x4000 <= w < 0x8000: push(cb, w, True)
                                o += 8
                if (fb, idx) == (0x10, 0x1A) and "hl" in imm and 0x4000 <= imm["hl"] < 0x7FF6:
                    for e in range(5):                  # SetGolfEventHook: hl = table of 5 handlers (events 0-4)
                        o = to_offset(cb, imm["hl"] + 2 * e)
                        w = rom[o] | rom[o + 1] << 8
                        if 0x4000 <= w < 0x8000: push(cb, w, True)
                if 0 < fb < NB and idx // 2 < TABLE_LEN.get(fb, 0):
                    t = farcall_target(rom, idx, fb)
                    if t and 0x4000 <= t < 0x8000: push(fb, t, True)
            nxt += n
        if ins.kind == "rst" and ins.target == 0x00:          # inline jump table
            lo, hi = (0x4000, 0x8000) if pc >= 0x4000 else (0x0100, 0x4000)
            p = nxt
            for _ in range(64):
                o = to_offset(cb, p); w = rom[o] | rom[o + 1] << 8
                if not lo <= w < hi: break
                code[cb].update((p, p + 1)); push(cb, w, True); p += 2
            break
        if ins.target is not None and ins.kind in ("call", "jp", "jr", "rst"):
            push(cb, ins.target, ins.kind in ("call", "rst"))
        if ins.kind in ("ret", "jp") and ins.cond is None: break
        if ins.kind == "jr" and ins.cond is None: break
        if ins.kind == "rst" and ins.target in (0x00,): break
        pc = nxt

# code pointers passed in registers to helpers that call them (e.g. 32:5DD5 ld hl, door animation ; call
# Map03WalkOutOfDoor): an ld hl / de / bc immediate in traced code naming an untraced address of the same bank
# that decodes as a whole routine (no illegal opcode, no $FF, ends in ret / jp, at least two calls or far calls)
def looks_like_routine(bank, a):
    if rom[to_offset(bank, a)] not in OPENERS:
        return False
    pc, calls = a, 0
    for _ in range(300):
        if pc >= 0x7FFD or pc in code[bank]:
            return False
        ins = decode(rom, to_offset(bank, pc), pc)
        if ins.kind == "illegal" or ins.raw[0] in (0xFF, 0x76, 0x10):
            return False
        if ins.kind == "call" or ins.kind == "rst" and ins.target in (0x10, 0x18):
            calls += 1
        pc += ins.length + inline_len(ins)
        if ins.kind in ("ret", "jp") and ins.cond is None:
            return calls >= 2
    return False


for _round in range(4):
    found = 0
    for b in list(code):
        if b == 0:
            continue
        starts = sorted(code[b])
        for a in starts:
            o = to_offset(b, a)
            if rom[o] not in (0x21, 0x11, 0x01) or (a + 1) not in code[b] or (a + 2) not in code[b]:
                continue
            ins = decode(rom, o, a)
            if ins.length != 3 or ins.text.split()[0] != "ld":
                continue
            w = rom[o + 1] | rom[o + 2] << 8
            if 0x4000 <= w < 0x8000 and w not in code[b] and (b, w) not in DATA_LABELS and looks_like_routine(b, w):
                push(b, w, True)
                found += 1
    if not found:
        break
    while work:
        bank, pc = work.pop()
        imm = {}
        while True:
            key = (bank if pc >= 0x4000 else 0, pc)
            if key in seen or pc >= 0x8000: break
            seen.add(key)
            cb = key[0]
            off = to_offset(cb, pc)
            ins = decode(rom, off, pc)
            if ins.kind == "illegal" or ins.raw[0] == 0xFF: break
            for i in range(ins.length): code[cb].add(pc + i)
            nxt = pc + ins.length
            n = inline_len(ins)
            if n:
                data = rom[off + ins.length:off + ins.length + n]
                for i in range(n): code[cb].add(nxt + i)
                if ins.kind == "rst" and ins.target in (0x10, 0x18) or ins.kind == "call" and n == 2 and ins.target == 0x01F6:
                    idx, fb = data[0], data[1]
                    if 0 < fb < NB and idx // 2 < TABLE_LEN.get(fb, 0):
                        t = farcall_target(rom, idx, fb)
                        if t and 0x4000 <= t < 0x8000: push(fb, t, True)
                nxt += n
            if ins.target is not None and ins.kind in ("call", "jp", "jr", "rst"):
                push(cb, ins.target, ins.kind in ("call", "rst"))
            if ins.kind in ("ret", "jp") and ins.cond is None: break
            if ins.kind == "jr" and ins.cond is None: break
            if ins.kind == "rst" and ins.target in (0x00,): break
            pc = nxt

# unreferenced (dead) routines: in banks with at least 2 KB of traced code, an untraced gap that starts right
# after traced code and decodes as whole routines (no illegal opcode or $FF, each ending in ret / jp, with at
# least 3 calls in all) -- e.g. 33:4929, a 402-byte block nothing calls
DEAD = []
LABEL_ADDRS = {}
for (lb, la), _ in LABELS.by.items():
    if lb != "*" and la < 0x8000:
        LABEL_ADDRS.setdefault(lb if la >= 0x4000 else 0, []).append(la)
for v in LABEL_ADDRS.values():
    v.sort()
if "--no-dead" not in sys.argv:
    for b in list(code):
        if len(code[b]) < 2048:
            continue
        lo, hi = (0x0100, 0x4000) if b == 0 else (0x4000, 0x8000)
        a = lo
        while a < hi:
            if a in code[b] or a - 1 not in code[b]:
                a += 1
                continue
            end = a
            while end < hi and end not in code[b]:
                end += 1
            pc, calls, ok = a, 0, True
            while pc < end:
                ins = decode(rom, to_offset(b, pc), pc)
                if ins.kind == "illegal" or ins.raw[0] in (0xFF, 0x76, 0x10):
                    ok = False
                    break
                if ins.kind == "call" or ins.kind == "rst" and ins.target in (0x10, 0x18, 0x08, 0x20, 0x28, 0x30):
                    calls += 1
                pc += ins.length + inline_len(ins)
            near = [x for x in LABEL_ADDRS.get(b, ()) if x <= a]
            in_data = near and (b if near[-1] >= 0x4000 else 0, near[-1]) in DATA_LABELS
            if ok and pc == end and calls >= 3 and end - a >= 16 and rom[to_offset(b, a)] in OPENERS and not in_data:
                DEAD.append((b, a, end - a))
                push(b, a, True)
            a = end
    while work:
        bank, pc = work.pop()
        while True:
            key = (bank if pc >= 0x4000 else 0, pc)
            if key in seen or pc >= 0x8000: break
            seen.add(key)
            cb = key[0]
            off = to_offset(cb, pc)
            ins = decode(rom, off, pc)
            if ins.kind == "illegal" or ins.raw[0] == 0xFF: break
            for i in range(ins.length): code[cb].add(pc + i)
            nxt = pc + ins.length + inline_len(ins)
            for i in range(inline_len(ins)): code[cb].add(pc + ins.length + i)
            if ins.target is not None and ins.kind in ("call", "jp", "jr", "rst"):
                push(cb, ins.target, ins.kind in ("call", "rst"))
            if ins.kind in ("ret", "jp") and ins.cond is None: break
            if ins.kind == "jr" and ins.cond is None: break
            pc = nxt
    if "--dead" in sys.argv:
        for b, a, n in DEAD:
            print("dead code %02x:%04x %d bytes" % (b, a, n))

total = 0
rows = []
for b in range(NB):
    c = len(code[b]); total += c
    if c: rows.append((b, c, len(entries[b])))
json.dump({str(b): sorted(code[b]) for b in code}, open(os.path.join(ROOT, "states", "code_map.json"), "w"))
json.dump({str(b): sorted(entries[b]) for b in entries}, open(os.path.join(ROOT, "states", "code_entries.json"), "w"))
print("traced code bytes: %d (%.1f%% of ROM), functions: %d" % (total, 100 * total / len(rom), sum(len(v) for v in entries.values())))
print("banks treated as code (exports seeded):", " ".join("%02x" % b for b in CODE_BANKS))
if "--report" in sys.argv:
    for b, c, e in rows:
        print("bank %02x: %5d code bytes (%4.1f%%)  %3d entries" % (b, c, 100 * c / 0x4000, e))
