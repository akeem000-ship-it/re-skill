"""Static SM83 -> JavaScript translator for the traced code of the ROM (states/code_map.json).

Every basic block becomes a JS function over the core's CPU/memory objects (web/js/gb): the
generated code uses the interpreter's own ALU helpers, checks interrupts before each instruction
and syncs the hardware after each one, so it is semantically identical to the interpreter (the
lockstep test web/tests/recomp_vs_interp.mjs must report zero differences). The executor
(web/js/gb/exec.js) runs a block when the PC is a known block start and falls back to the
interpreter otherwise (RAM code, untraced code), so correctness never depends on coverage.

The output is derived from the ROM and is not committed (web/gen/ is ignored).

usage: recomp.py [--out web/gen/game.js] [--banks 0,1,8] [--stats]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE, ROOT
from scan_jumptables import table

rom = load_rom(); NB = nbanks(rom)
a = sys.argv[1:]
OUT = a[a.index("--out") + 1] if "--out" in a else "web/gen/game.js"
BANKS = [int(b, 16) for b in a[a.index("--banks") + 1].split(",")] if "--banks" in a else list(range(NB))
code_map = json.load(open(os.path.join(ROOT, "states/code_map.json")))

CC = ["!(c.f & 0x80)", "!!(c.f & 0x80)", "!(c.f & 0x10)", "!!(c.f & 0x10)"]
R8 = ["c.b", "c.c", "c.d", "c.e", "c.h", "c.l", None, "c.a"]          # None = [hl]
R16 = ["c.bc", "c.de", "c.hl", "c.sp"]; R16STK = ["c.bc", "c.de", "c.hl", "c.af"]

def rd8(i): return "m.read(c.hl)" if i == 6 else R8[i]
def wr8(i, v): return "m.write(c.hl, %s)" % v if i == 6 else "%s = %s" % (R8[i], v)

def op_len(op, buf, off):
    if op == 0xCB: return 2
    if op in (0x01, 0x11, 0x21, 0x31, 0x08, 0xC3, 0xC2, 0xCA, 0xD2, 0xDA, 0xCD, 0xC4, 0xCC, 0xD4, 0xDC, 0xEA, 0xFA): return 3
    if op in (0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x36, 0x3E, 0x18, 0x20, 0x28, 0x30, 0x38, 0xC6, 0xCE, 0xD6, 0xDE,
              0xE6, 0xEE, 0xF6, 0xFE, 0xE0, 0xF0, 0xE8, 0xF8, 0x10): return 2
    return 1

TERMINATORS = {0x18, 0x20, 0x28, 0x30, 0x38, 0xC3, 0xC2, 0xCA, 0xD2, 0xDA, 0xCD, 0xC4, 0xCC, 0xD4, 0xDC,
               0xC9, 0xC0, 0xC8, 0xD0, 0xD8, 0xD9, 0xE9, 0x76, 0xC7, 0xCF, 0xD7, 0xDF, 0xE7, 0xEF, 0xF7, 0xFF, 0xFB, 0xF3, 0x10}
ILLEGAL = {0xD3, 0xDB, 0xDD, 0xE3, 0xE4, 0xEB, 0xEC, 0xED, 0xF4, 0xFC, 0xFD}

def emit(op, b1, b2, pc, nxt):
    """JS statements for one instruction (b1/b2 = following bytes) and (cycles, cycles if branch taken or None).
    A statement list ending the block returns from the function with c.pc set."""
    s = []
    def ret(cyc, extra=None): return s, cyc, extra
    d8 = b1; d16 = b1 | (b2 << 8); r8 = (b1 ^ 0x80) - 0x80
    hi, lo = op >> 6, op & 7
    if op == 0x00: return ret(4)
    if op == 0x10: s.append("m.switchSpeed();"); return ret(4)
    if op == 0x76: s.append("c.halted = true;"); return ret(4)
    if op == 0xF3: s.append("c.ime = false; c.eiPending = false;"); return ret(4)
    if op == 0xFB: s.append("c.eiPending = true;"); return ret(4)
    if op == 0x08: s.append("m.write(0x%04X, c.sp & 0xFF); m.write(0x%04X, c.sp >> 8);" % (d16, (d16 + 1) & 0xFFFF)); return ret(20)
    if op in (0x01, 0x11, 0x21, 0x31): s.append("%s = 0x%04X;" % (R16[op >> 4], d16)); return ret(12)
    if op in (0x09, 0x19, 0x29, 0x39): s.append("c.addHL(%s);" % R16[op >> 4]); return ret(8)
    if op in (0x03, 0x13, 0x23, 0x33): s.append("%s = (%s + 1) & 0xFFFF;" % (R16[op >> 4], R16[op >> 4])); return ret(8)
    if op in (0x0B, 0x1B, 0x2B, 0x3B): s.append("%s = (%s - 1) & 0xFFFF;" % (R16[op >> 4], R16[op >> 4])); return ret(8)
    if op == 0x02: s.append("m.write(c.bc, c.a);"); return ret(8)
    if op == 0x12: s.append("m.write(c.de, c.a);"); return ret(8)
    if op == 0x22: s.append("m.write(c.hl, c.a); c.hl = (c.hl + 1) & 0xFFFF;"); return ret(8)
    if op == 0x32: s.append("m.write(c.hl, c.a); c.hl = (c.hl - 1) & 0xFFFF;"); return ret(8)
    if op == 0x0A: s.append("c.a = m.read(c.bc);"); return ret(8)
    if op == 0x1A: s.append("c.a = m.read(c.de);"); return ret(8)
    if op == 0x2A: s.append("c.a = m.read(c.hl); c.hl = (c.hl + 1) & 0xFFFF;"); return ret(8)
    if op == 0x3A: s.append("c.a = m.read(c.hl); c.hl = (c.hl - 1) & 0xFFFF;"); return ret(8)
    if op & 0xC7 == 0x04: r = (op >> 3) & 7; s.append(wr8(r, "c.inc8(%s)" % rd8(r)) + ";"); return ret(12 if r == 6 else 4)
    if op & 0xC7 == 0x05: r = (op >> 3) & 7; s.append(wr8(r, "c.dec8(%s)" % rd8(r)) + ";"); return ret(12 if r == 6 else 4)
    if op & 0xC7 == 0x06: r = (op >> 3) & 7; s.append(wr8(r, "0x%02X" % d8) + ";"); return ret(12 if r == 6 else 8)
    if op == 0x07: s.append("{ const k = c.a >> 7; c.a = ((c.a << 1) | k) & 0xFF; c.f = k ? 0x10 : 0; }"); return ret(4)
    if op == 0x0F: s.append("{ const k = c.a & 1; c.a = (c.a >> 1) | (k << 7); c.f = k ? 0x10 : 0; }"); return ret(4)
    if op == 0x17: s.append("{ const k = c.a >> 7; c.a = ((c.a << 1) | (c.f & 0x10 ? 1 : 0)) & 0xFF; c.f = k ? 0x10 : 0; }"); return ret(4)
    if op == 0x1F: s.append("{ const k = c.a & 1; c.a = (c.a >> 1) | (c.f & 0x10 ? 0x80 : 0); c.f = k ? 0x10 : 0; }"); return ret(4)
    if op == 0x27: s.append("c.exec(0x27);"); return ret(4)         # DAA: reuse the interpreter's implementation
    if op == 0x2F: s.append("c.a ^= 0xFF; c.f |= 0x60;"); return ret(4)
    if op == 0x37: s.append("c.f = (c.f & 0x80) | 0x10;"); return ret(4)
    if op == 0x3F: s.append("c.f = (c.f & 0x80) | ((c.f & 0x10) ^ 0x10);"); return ret(4)
    if op == 0x18: s.append("c.pc = 0x%04X; return;" % ((nxt + r8) & 0xFFFF)); return ret(12)
    if op in (0x20, 0x28, 0x30, 0x38):
        s.append("if (%s) { c.pc = 0x%04X; c.cyc += 4; return; }" % (CC[(op >> 3) & 3], (nxt + r8) & 0xFFFF)); return ret(8, 12)
    if hi == 1:                                                     # LD r,r'
        dst, src = (op >> 3) & 7, lo
        s.append(wr8(dst, rd8(src)) + ";"); return ret(8 if 6 in (dst, src) else 4)
    if hi == 2:                                                     # ALU A,r
        v = rd8(lo); k = (op >> 3) & 7
        s.append(["c.add(%s);", "c.add(%s, c.f & 0x10 ? 1 : 0);", "c.sub(%s);", "c.sub(%s, c.f & 0x10 ? 1 : 0);", "c.and(%s);", "c.xor(%s);", "c.or(%s);", "c.cp(%s);"][k] % v)
        return ret(8 if lo == 6 else 4)
    if op & 0xC7 == 0xC6:                                           # ALU A,d8
        k = (op >> 3) & 7
        s.append(["c.add(%s);", "c.add(%s, c.f & 0x10 ? 1 : 0);", "c.sub(%s);", "c.sub(%s, c.f & 0x10 ? 1 : 0);", "c.and(%s);", "c.xor(%s);", "c.or(%s);", "c.cp(%s);"][k] % ("0x%02X" % d8))
        return ret(8)
    if op in (0xC0, 0xC8, 0xD0, 0xD8): s.append("if (%s) { c.pc = c.pop(); c.cyc += 12; return; }" % CC[(op >> 3) & 3]); return ret(8, 20)
    if op == 0xC9: s.append("c.pc = c.pop(); return;"); return ret(16)
    if op == 0xD9: s.append("c.pc = c.pop(); c.ime = true; return;"); return ret(16)
    if op in (0xC1, 0xD1, 0xE1, 0xF1): s.append("%s = c.pop();" % R16STK[(op >> 4) & 3]); return ret(12)
    if op in (0xC5, 0xD5, 0xE5, 0xF5): s.append("c.push(%s);" % R16STK[(op >> 4) & 3]); return ret(16)
    if op == 0xC3: s.append("c.pc = 0x%04X; return;" % d16); return ret(16)
    if op in (0xC2, 0xCA, 0xD2, 0xDA): s.append("if (%s) { c.pc = 0x%04X; c.cyc += 4; return; }" % (CC[(op >> 3) & 3], d16)); return ret(12, 16)
    if op == 0xCD: s.append("c.push(0x%04X); c.pc = 0x%04X; return;" % (nxt, d16)); return ret(24)
    if op in (0xC4, 0xCC, 0xD4, 0xDC): s.append("if (%s) { c.push(0x%04X); c.pc = 0x%04X; c.cyc += 12; return; }" % (CC[(op >> 3) & 3], nxt, d16)); return ret(12, 24)
    if op & 0xC7 == 0xC7: s.append("c.push(0x%04X); c.pc = 0x%02X; return;" % (nxt, op & 0x38)); return ret(16)
    if op == 0xE0: s.append("m.write(0x%04X, c.a);" % (0xFF00 | d8)); return ret(12)
    if op == 0xF0: s.append("c.a = m.read(0x%04X);" % (0xFF00 | d8)); return ret(12)
    if op == 0xE2: s.append("m.write(0xFF00 | c.c, c.a);"); return ret(8)
    if op == 0xF2: s.append("c.a = m.read(0xFF00 | c.c);"); return ret(8)
    if op == 0xEA: s.append("m.write(0x%04X, c.a);" % d16); return ret(16)
    if op == 0xFA: s.append("c.a = m.read(0x%04X);" % d16); return ret(16)
    if op == 0xE8: s.append("c.sp = c.addSP(%d);" % r8); return ret(16)
    if op == 0xF8: s.append("c.hl = c.addSP(%d);" % r8); return ret(12)
    if op == 0xF9: s.append("c.sp = c.hl;"); return ret(8)
    if op == 0xE9: s.append("c.pc = c.hl; return;"); return ret(4)
    if op == 0xCB:
        cb = b1; r = cb & 7; bit = (cb >> 3) & 7
        if cb < 0x40 or cb >= 0x80: s.append(wr8(r, "c.cbval(0x%02X, %s)" % (cb, rd8(r))) + ";"); return ret(16 if r == 6 else 8)
        s.append("c.f = (c.f & 0x10) | 0x20 | (%s & 0x%02X ? 0 : 0x80);" % (rd8(r), 1 << bit)); return ret(12 if r == 6 else 8)
    raise ValueError("illegal opcode %02x at %04x" % (op, pc))

def bank_bytes(bank): return rom[bank * BANK_SIZE:(bank + 1) * BANK_SIZE]

def translate_bank(bank):
    data = bank_bytes(bank); base = 0 if bank == 0 else 0x4000
    traced = sorted(set(code_map.get(str(bank), [])))
    if not traced: return "", 0, 0
    tset = set(traced)
    # 1. instruction starts: linear decode from every traced address not yet covered
    starts = {}; i = 0
    for pc in traced:
        if pc in starts: continue
        p = pc
        while p in tset and p not in starts:
            op = data[p - base]
            if op in ILLEGAL: break
            n = op_len(op, data, p - base)
            starts[p] = n
            if op in TERMINATORS or op == 0x76: p += n; break
            p += n
    # 2. block boundaries: jump/call targets inside the bank, successors of terminators, export entries, vectors
    bstart = set()
    for pc, n in starts.items():
        op = data[pc - base]; b1 = data[pc - base + 1] if n > 1 else 0; b2 = data[pc - base + 2] if n > 2 else 0
        nxt = pc + n
        if op in (0x18, 0x20, 0x28, 0x30, 0x38): bstart.add((nxt + ((b1 ^ 0x80) - 0x80)) & 0xFFFF)
        if op in (0xC3, 0xC2, 0xCA, 0xD2, 0xDA, 0xCD, 0xC4, 0xCC, 0xD4, 0xDC): bstart.add(b1 | (b2 << 8))
        if op in TERMINATORS or op == 0x76: bstart.add(nxt)
        if op == 0xC7:                                           # rst $00: inline jump table follows
            q = nxt
            while q + 1 < base + BANK_SIZE:
                w = data[q - base] | (data[q - base + 1] << 8)
                if not ((0x4000 <= w < 0x8000) if bank else (0x0100 <= w < 0x4000)): break
                bstart.add(w); q += 2
    if bank: bstart.update(table(rom, bank))
    else: bstart.update([0x40, 0x48, 0x50, 0x58, 0x100, 0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38])
    bstart.add(traced[0])
    bstart = sorted(b for b in bstart if b in starts)
    # 3. emit blocks
    out = []; nblocks = 0; ninsn = 0
    key = (lambda pc: "0x%X" % pc) if bank == 0 else (lambda pc: "0x%X" % ((bank << 16) | pc))
    for b in bstart:
        lines = []; pc = b; cyc = 0
        while pc in starts:
            n = starts[pc]; op = data[pc - base]
            b1 = data[pc - base + 1] if n > 1 else 0; b2 = data[pc - base + 2] if n > 2 else 0
            try: stmts, cycles, taken = emit(op, b1, b2, pc, pc + n)
            except ValueError: break
            ninsn += 1
            if pc != b: lines.append("  if (c.irq(0x%04X)) return;" % pc)       # interrupts between instructions
            body = " ".join(stmts)
            if body.endswith("return;"):
                # the branch inside the statement adds the extra cycles itself; the straight path falls through
                lines.append("  c.cyc += %d; %s" % (cycles, body)); break
            lines.append("  c.cyc += %d; %s m.tick(c);" % (cycles, body) if body else "  c.cyc += %d; m.tick(c);" % cycles)
            if op in TERMINATORS or op == 0x76 or (pc + n) in bstart and pc + n != b:
                lines.append("  c.pc = 0x%04X; return;" % (pc + n)); break
            pc += n
        else:
            lines.append("  c.pc = 0x%04X; return;" % pc)
        if lines and not lines[-1].strip().endswith("return;"): lines.append("  c.pc = 0x%04X; return;" % pc)
        out.append("T[%s] = function(c, m) {\n%s\n};" % (key(b), "\n".join(lines))); nblocks += 1
    return "\n".join(out), nblocks, ninsn

parts = ["// generated by tools/recomp.py from the ROM's traced code: do not edit, do not commit", "export function install(T) {"]
tot_b = tot_i = 0
for bank in BANKS:
    code, nb, ni = translate_bank(bank)
    if not code: continue
    parts.append("// ---- bank %02X: %d blocks, %d instructions ----" % (bank, nb, ni)); parts.append(code)
    tot_b += nb; tot_i += ni
parts.append("}")
os.makedirs(os.path.dirname(os.path.join(ROOT, OUT)), exist_ok=True)
open(os.path.join(ROOT, OUT), "w").write("\n".join(parts) + "\n")
print("wrote %s: %d blocks, %d instructions, %d KB" % (OUT, tot_b, tot_i, os.path.getsize(os.path.join(ROOT, OUT)) // 1024))
