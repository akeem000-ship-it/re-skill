"""(Copied from ../mario-tennis-gbc/tools/trace_code.py and adapted to Golf's data banks and labels.)
Recursive-descent code tracer: follows control flow from the vectors and Init through
calls, jumps, rst $00 inline tables, inline-argument RSTs and rst $10/$18 farcalls (switching
bank), and from extra roots (task functions passed to AddTask, etc. via --roots BB:AAAA,...).

Outputs per-bank coverage and states/code_map.json ({bank: [[start, end], ...]} of code bytes),
states/code_entries.json ({bank: [entry, ...]}), and appends nothing to labels.csv (use --emit-labels to print sub_BB_AAAA candidates).
usage: trace_code.py [--roots BB:AAAA,...] [--report]
"""
import sys, os, json, collections
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
for (b, a), (name, _) in Labels().by.items():
    if b != "*" and a < 0x8000 and name and not any(k in name for k in ("Table", "Curve", "Signature", "Header", "String", "Font", "Widths", "Sine", "Tangent")):
        push(b if a >= 0x4000 else 0, a, True)
# export tables of code banks: a bank counts as code when most of its exports start with a
# typical routine opener (push/ld/call/xor/and/or/cp/rst/jr/jp/ret)
OPENERS = {0xC5, 0xD5, 0xE5, 0xF5, 0xCD, 0xC3, 0xAF, 0xA7, 0xB7, 0xFA, 0xF0, 0x21, 0x11, 0x01, 0x3E, 0x06, 0x0E,
           0x16, 0x1E, 0x26, 0x2E, 0xDF, 0xD7, 0xF7, 0xE7, 0xEF, 0xCF, 0x18, 0x20, 0x28, 0x30, 0x38, 0xC9, 0x7E, 0x2A,
           0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0xE8, 0xF8, 0xCB, 0xEA, 0xE0, 0x1A}
# Golf's asset banks (REVERSE.md "Bank map"): text, map graphics and headers, LZ graphics, holes
DATA_BANKS = set(range(0x18, 0x20)) | set(range(0x28, 0x36)) | {0x40} | set(range(0x4B, 0x4F)) | {0x58} | \
    set(range(0x50, 0x75))
CODE_BANKS = []
for b in range(1, NB):
    t = table(rom, b)
    if len(t) < 2: continue
    hits = sum(1 for w in t if rom[to_offset(b, w)] in OPENERS)
    if hits >= 0.8 * len(t) and b not in DATA_BANKS:
        CODE_BANKS.append(b)
        for w in t: push(b, w, True)
if "--roots" in sys.argv:
    for r in sys.argv[sys.argv.index("--roots") + 1].split(","): add_root(r)

seen = set()
while work:
    bank, pc = work.pop()
    while True:
        key = (bank if pc >= 0x4000 else 0, pc)
        if key in seen or pc >= 0x8000: break
        seen.add(key)
        cb = key[0]
        off = to_offset(cb, pc)
        ins = decode(rom, off, pc)
        if ins.kind == "illegal": break
        for i in range(ins.length): code[cb].add(pc + i)
        nxt = pc + ins.length
        n = inline_len(ins)
        if n:
            data = rom[off + ins.length:off + ins.length + n]
            for i in range(n): code[cb].add(nxt + i)
            if ins.kind == "rst" and ins.target in (0x10, 0x18) or ins.kind == "call":
                idx, fb = data[0], data[1]
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
