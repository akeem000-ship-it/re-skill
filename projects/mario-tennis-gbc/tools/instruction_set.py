"""SM83 (Game Boy / LR35902) instruction set database.

decode(buf, pc) -> Insn with length, mnemonic template, operand info.
Operand encoding in templates:
  {d8}  immediate byte        {d16} immediate word
  {a8}  FF00+byte (LDH)       {a16} absolute word address
  {r8}  signed relative jump  {s8}  signed immediate (ADD SP / LD HL,SP+)
"""
from collections import namedtuple

R8 = ["b", "c", "d", "e", "h", "l", "[hl]", "a"]
R16 = ["bc", "de", "hl", "sp"]
R16STK = ["bc", "de", "hl", "af"]
R16MEM = ["[bc]", "[de]", "[hl+]", "[hl-]"]
CC = ["nz", "z", "nc", "c"]
ALU = ["add a,", "adc a,", "sub", "sbc a,", "and", "xor", "or", "cp"]
ROT = ["rlc", "rrc", "rl", "rr", "sla", "sra", "swap", "srl"]

# kind: 'call','jp','jr','ret','reti','rst','other'
Op = namedtuple("Op", "length template kind cond")

OPS = {}


def _set(op, length, template, kind="other", cond=None):
    OPS[op] = Op(length, template, kind, cond)


def _build():
    _set(0x00, 1, "nop")
    _set(0x08, 3, "ld [{a16}], sp")
    _set(0x10, 2, "stop")
    _set(0x18, 2, "jr {r8}", "jr")
    for i, cc in enumerate(CC):
        _set(0x20 + i * 8, 2, "jr %s, {r8}" % cc, "jr", cc)
    for i, rr in enumerate(R16):
        _set(0x01 + i * 16, 3, "ld %s, {d16}" % rr)
        _set(0x09 + i * 16, 1, "add hl, %s" % rr)
        _set(0x03 + i * 16, 1, "inc %s" % rr)
        _set(0x0B + i * 16, 1, "dec %s" % rr)
    for i, m in enumerate(R16MEM):
        _set(0x02 + i * 16, 1, "ld %s, a" % m)
        _set(0x0A + i * 16, 1, "ld a, %s" % m)
    for i, r in enumerate(R8):
        _set(0x04 + i * 8, 1, "inc %s" % r)
        _set(0x05 + i * 8, 1, "dec %s" % r)
        _set(0x06 + i * 8, 2, "ld %s, {d8}" % r)
    for op, m in zip((0x07, 0x0F, 0x17, 0x1F, 0x27, 0x2F, 0x37, 0x3F),
                     ("rlca", "rrca", "rla", "rra", "daa", "cpl", "scf", "ccf")):
        _set(op, 1, m)
    for d in range(8):
        for s in range(8):
            op = 0x40 + d * 8 + s
            if op == 0x76:
                _set(op, 1, "halt")
            else:
                _set(op, 1, "ld %s, %s" % (R8[d], R8[s]))
    for a in range(8):
        for s in range(8):
            _set(0x80 + a * 8 + s, 1, "%s %s" % (ALU[a], R8[s]))
        _set(0xC6 + a * 8, 2, "%s {d8}" % ALU[a])
        _set(0xC7 + a * 8, 1, "rst $%02x" % (a * 8), "rst")
    for i, cc in enumerate(CC):
        _set(0xC0 + i * 8, 1, "ret %s" % cc, "ret", cc)
        _set(0xC2 + i * 8, 3, "jp %s, {a16}" % cc, "jp", cc)
        _set(0xC4 + i * 8, 3, "call %s, {a16}" % cc, "call", cc)
    for i, rr in enumerate(R16STK):
        _set(0xC1 + i * 16, 1, "pop %s" % rr)
        _set(0xC5 + i * 16, 1, "push %s" % rr)
    _set(0xC3, 3, "jp {a16}", "jp")
    _set(0xC9, 1, "ret", "ret")
    _set(0xD9, 1, "reti", "ret")
    _set(0xCD, 3, "call {a16}", "call")
    _set(0xE0, 2, "ldh [{a8}], a")
    _set(0xF0, 2, "ldh a, [{a8}]")
    _set(0xE2, 1, "ld [c], a")
    _set(0xF2, 1, "ld a, [c]")
    _set(0xE8, 2, "add sp, {s8}")
    _set(0xF8, 2, "ld hl, sp{s8}")
    _set(0xE9, 1, "jp hl", "jp")
    _set(0xF9, 1, "ld sp, hl")
    _set(0xEA, 3, "ld [{a16}], a")
    _set(0xFA, 3, "ld a, [{a16}]")
    _set(0xF3, 1, "di")
    _set(0xFB, 1, "ei")


_build()

CB = {}
for _op in range(256):
    _r = R8[_op & 7]
    _y = (_op >> 3) & 7
    if _op < 0x40:
        CB[_op] = "%s %s" % (ROT[_y], _r)
    elif _op < 0x80:
        CB[_op] = "bit %d, %s" % (_y, _r)
    elif _op < 0xC0:
        CB[_op] = "res %d, %s" % (_y, _r)
    else:
        CB[_op] = "set %d, %s" % (_y, _r)

Insn = namedtuple("Insn", "pc length raw text kind cond target operand")
# target: absolute code target for jp/jr/call/rst (None for jp hl / ret)
# operand: (type, value) of the memory/immediate operand, for labelling


def decode(buf, off, pc):
    """Decode one instruction at buf[off] which lives at CPU address pc."""
    op = buf[off]
    if op == 0xCB:
        if off + 1 >= len(buf):
            return Insn(pc, 1, bytes([op]), "db $cb", "other", None, None, None)
        sub = buf[off + 1]
        return Insn(pc, 2, bytes(buf[off:off + 2]), CB[sub], "other", None, None, None)
    info = OPS.get(op)
    if info is None:
        return Insn(pc, 1, bytes([op]), "db $%02x  ; illegal" % op, "illegal", None, None, None)
    raw = bytes(buf[off:off + info.length])
    if len(raw) < info.length:
        return Insn(pc, len(raw), raw, "db " + ",".join("$%02x" % b for b in raw), "other", None, None, None)
    t = info.template
    target = None
    operand = None
    if "{d8}" in t:
        operand = ("d8", raw[1])
        t = t.replace("{d8}", "$%02x" % raw[1])
    elif "{d16}" in t:
        v = raw[1] | raw[2] << 8
        operand = ("d16", v)
        t = t.replace("{d16}", "$%04x" % v)
    elif "{a16}" in t:
        v = raw[1] | raw[2] << 8
        if info.kind in ("jp", "call"):
            target = v
        else:
            operand = ("a16", v)
        t = t.replace("{a16}", "$%04x" % v)
    elif "{a8}" in t:
        v = 0xFF00 | raw[1]
        operand = ("a16", v)
        t = t.replace("{a8}", "$%04x" % v)
    elif "{r8}" in t:
        rel = raw[1] - 256 if raw[1] >= 128 else raw[1]
        target = (pc + 2 + rel) & 0xFFFF
        t = t.replace("{r8}", "$%04x" % target)
    elif "{s8}" in t:
        rel = raw[1] - 256 if raw[1] >= 128 else raw[1]
        t = t.replace("{s8}", ("+%d" % rel) if rel >= 0 else ("%d" % rel))
    if info.kind == "rst":
        target = op & 0x38
    return Insn(pc, info.length, raw, t, info.kind, info.cond, target, operand)
