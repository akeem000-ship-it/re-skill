"""Find Mario Tennis home-bank routines that also exist in Mario Golf's bank 0.

The Tennis ROM is not needed: Tennis's bank 0 is read from the vendored source
(../mario-tennis-gbc/third_party/mario-tennis-gbc-disasm: the ROM0 files main.asm includes), where every
instruction carries its address as a `; $XXXX` comment. Both sides are reduced to
"shapes": mnemonic plus operands with registers and conditions kept and every number or
symbol replaced by `N` (rst vectors are kept). Golf's bank 0 is decoded at every byte
offset; `rst $08` is followed by 1 inline byte and `rst $10`/`rst $18` by 2 (shown at
00:0008/0010/0018), which become one `db` shape, as do the Tennis `sound`/`farcall` macros.

A Tennis routine runs from a global label to the next global label (local `.x` labels
stay inside it) and is cut at its first data line. Only routines of >= MIN instructions
are matched. For each one the tool reports the Golf offset whose instruction chain agrees
for the longest prefix.

usage: compare_home.py [--min N] [--all] [--csv | --labels]
  --labels  labels.csv rows for full matches (the 'Unused_00_' prefix of a Tennis name is dropped)
  --all  also list routines with no match;  --csv  machine-readable output
  Output: tennis_addr, tennis_name, n_insns, golf_addr, matched_insns, same_addr flag, and the number of
  Golf offsets with the same best match (several = twin routines; the one nearest the local address shift wins).
"""
import sys, os, re, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, ROOT
from instruction_set import decode

TENNIS_SRC = os.path.join(ROOT, "..", "mario-tennis-gbc", "third_party", "mario-tennis-gbc-disasm")
INLINE = {0x08: 1, 0x10: 2, 0x18: 2}
REGS = {"a", "b", "c", "d", "e", "h", "l", "af", "bc", "de", "hl", "sp",
        "[hl]", "[bc]", "[de]", "[hl+]", "[hl-]", "[c]"}
CONDS = {"nz", "z", "nc", "c"}
ALU = {"add", "adc", "sub", "sbc", "and", "xor", "or", "cp"}
RSTN = {"rst00": "$00", "rst08": "$08", "rst10": "$10", "rst18": "$18", "rst20": "$20",
        "rst28": "$28", "rst30": "$30", "rst38": "$38"}


def norm_operand(op, mnem):
    op = op.strip().lower().replace(" ", "")
    op = op.replace("[hli]", "[hl+]").replace("[hld]", "[hl-]").replace("[$ff00+c]", "[c]")
    if op in REGS:
        return op
    if mnem in ("jr", "jp", "call", "ret") and op in CONDS:
        return op
    if op.startswith("sp+") or op.startswith("sp-"):
        return "sp+N"
    if op.startswith("["):
        return "[N]"
    return "N"


LIT = re.compile(r"^\$[0-9a-f]+$|^[0-9]+$|^%[01]+$")


def literals(text):
    """Numeric literal operands of an instruction (not jump targets), as ints, for tie-breaking."""
    text = text.split(";")[0].strip().lower()
    parts = text.split(None, 1)
    if len(parts) < 2 or parts[0] in ("jr", "jp", "call", "rst"):
        return ()
    out = []
    for o in parts[1].split(","):
        o = o.strip().strip("[]").replace(" ", "")
        if LIT.match(o):
            out.append(int(o[1:], 16) if o[0] == "$" else int(o[1:], 2) if o[0] == "%" else int(o))
    return tuple(out)


def shape(text):
    """Normalise one instruction ('ld a, [hl+]') to a comparable shape."""
    text = text.split(";")[0].strip().lower()
    if not text:
        return None
    parts = text.split(None, 1)
    mnem = parts[0]
    ops = [o for o in (parts[1].split(",") if len(parts) > 1 else [])]
    if mnem == "rst":
        o = ops[0].strip().replace(" ", "")
        return "rst " + RSTN.get(o, o if o.startswith("$") else "$%02x" % int(o, 0))
    if mnem in ("lb", "ld_xy", "ld_oam"):
        return "ld %s, N" % ops[0].strip()
    if mnem == "ld" and len(ops) == 2 and ops[1].replace(" ", "").startswith("sp"):
        return "ld hl, sp+N"
    nops = [norm_operand(o, mnem) for o in ops]
    if mnem in ALU and len(nops) == 2 and nops[0] == "a":
        nops = nops[1:]
    if mnem == "ldh" and "[c]" in nops:
        mnem = "ld"
    if mnem == "jp" and nops == ["[hl]"]:
        nops = ["hl"]
    if mnem == "stop":
        nops = []
    return mnem + (" " + ", ".join(nops) if nops else "")


MACROS = {
    "farcall": ["rst $18", "db"],
    "sound": ["rst $08", "db"],
    "ld_hl_indexed": ["add N", "ld l, a", "adc N", "sub l", "ld h, a"],
    "ld_bc_indexed": ["add N", "ld c, a", "adc N", "sub c", "ld b, a"],
    "ld_de_indexed": ["add N", "ld e, a", "adc N", "sub e", "ld d, a"],
    "pop_wram_bank": ["pop af", "ldh [N], a", "ldh [N], a"],
}


def expand(mnem, args):
    if mnem in MACROS:
        return MACROS[mnem]
    if mnem == "wram_bank":
        return (["ld a, N"] if args.strip() else []) + ["ldh [N], a", "ldh [N], a"]
    if mnem == "push_wram_bank":
        return ["ldh a, [N]", "push af"] + (["ld a, N"] if args.strip() else []) + ["ldh [N], a", "ldh [N], a"]
    return None


def home_files():
    """The files main.asm INCLUDEs in its ROM0 section, in order."""
    files, inside = [], False
    for line in open(os.path.join(TENNIS_SRC, "main.asm")):
        if line.startswith("SECTION"):
            inside = "ROM0" in line
        elif inside and line.startswith("INCLUDE"):
            files.append(os.path.join(TENNIS_SRC, line.split('"')[1]))
    return files


def tennis_routines():
    """[(addr, name, [shapes])] from the vendored Tennis home source."""
    out = []
    cur = None
    addr_re = re.compile(r";\s*\$([0-9a-fA-F]{4})")
    for path in home_files():
        skip = False   # inside IF DEF(FIXES)/IF DEF(EUROPE): keep the ELSE branch (original USA ROM)
        for line in open(path):
            raw = line.rstrip("\n")
            kw = raw.split(None, 1)[0] if raw.strip() else ""
            if kw in ("IF", "ELSE", "ENDC", "ELIF"):
                skip = kw == "IF"
                continue
            if skip or not raw.strip() or raw.lstrip().startswith(";"):
                continue
            if not raw[0].isspace():
                lab = raw.split(":")[0].strip()
                if "." in lab and not lab.startswith("."):
                    # Global.local label: stays inside the routine
                    continue
                if lab.startswith("."):
                    continue
                cur = [None, lab, [], False]
                out.append(cur)
                continue
            if cur is None or cur[3]:
                continue
            body = raw.split(";")[0].strip()
            m = addr_re.search(raw)
            mnem = body.split(None, 1)[0].lower()
            args = body.split(None, 1)[1] if len(body.split(None, 1)) > 1 else ""
            if mnem in ("db", "dw", "ds", "incbin", "dl", "assert"):
                cur[3] = True
                continue
            ex = expand(mnem, args)
            if cur[0] is None and m:
                cur[0] = int(m.group(1), 16)
            cur[2].extend([(x, ()) for x in ex] if ex is not None else [(shape(body), literals(body))])
    return [(a, n, s) for a, n, s, _ in out if a is not None]


def golf_chain(rom):
    """shape and next offset for an instruction decoded at every bank-0 offset."""
    shapes, nxt, lits = [], [], []
    for off in range(0x4000):
        ins = decode(rom, off, off)
        n = off + ins.length
        s = shape(ins.text) if ins.kind != "illegal" else "illegal"
        if ins.kind == "rst" and ins.target in INLINE:
            n += INLINE[ins.target]
        shapes.append(s)
        nxt.append(n)
        lits.append(literals(ins.text))
    return shapes, nxt, lits


def match_len(shapes, nxt, off, seq):
    k = 0
    for s in seq:
        if off >= 0x4000:
            break
        if shapes[off] != s:
            break
        k += 1
        if s.startswith("rst $") and int(s[5:], 16) in INLINE:
            # the db shape is folded into nxt[]
            pass
        off = nxt[off]
    return k


def const_agree(lits, nxt, off, tlits):
    """How many of the Tennis routine's numeric literals the Golf chain at off repeats."""
    n = 0
    for tl in tlits:
        if off >= 0x4000:
            break
        if tl and lits[off] == tl:
            n += 1
        off = nxt[off]
    return n


def fold(seq):
    """Drop the inline 'db' shapes that follow farcall/sound (Golf side folds them into nxt)."""
    return [s for s in seq if s[0] != "db"]


def main():
    args = sys.argv[1:]
    mn = int(args[args.index("--min") + 1]) if "--min" in args else 6
    rom = load_rom()
    shapes, nxt, lits = golf_chain(rom)
    index = {}
    for off in range(0x4000 - 3):
        o2 = nxt[off]; o3 = nxt[o2] if o2 < 0x4000 else 0x4000
        if o3 >= 0x4000:
            continue
        index.setdefault((shapes[off], shapes[o2], shapes[o3]), []).append(off)
    rows = []
    tlits = {}
    for addr, name, seq in tennis_routines():
        seq = fold(seq)
        if len(seq) < mn:
            continue
        tlits[addr] = [l for _, l in seq]
        seq = [sh for sh, _ in seq]
        cands = [(match_len(shapes, nxt, off, seq), off) for off in index.get(tuple(seq[:3]), [])]
        top = max([k for k, _ in cands], default=0)
        rows.append([addr, name, len(seq), [o for k, o in cands if k == top], top])
    # Several Golf offsets can share a shape (e.g. twin routines). Pick the one whose address shift
    # (golf - tennis) is closest to that of the nearest preceding unambiguous full match.
    shift = 0
    for r in rows:
        offs = r[3]
        if len(offs) == 1 and r[4] == r[2]:
            shift = offs[0] - r[0]
        r.append(len(offs))
        r[3] = min(offs, key=lambda o: abs(o - r[0] - shift)) if offs else None
    rows = [(a, n, ln, g, k, nc) for a, n, ln, g, k, nc in rows]
    full = sum(1 for r in rows if r[4] == r[2])
    if "--labels" in args:
        # labels.csv rows for full matches. Twin Tennis routines that differ only in constants can
        # claim the same Golf address: the one repeating more of its numeric literals wins; a tie is
        # left out (resolve it by hand).
        claims = {}
        for a, n, ln, g, k, nc in rows:
            if k == ln and g is not None:
                claims.setdefault(g, []).append((const_agree(lits, nxt, g, tlits[a]), a, n))
        for g in sorted(claims):
            cs = sorted(claims[g], reverse=True)
            if len(cs) > 1 and cs[0][0] == cs[1][0]:
                print("# %04x ambiguous: %s" % (g, " / ".join("%s %04x" % (n, a) for _, a, n in cs)))
                continue
            _, a, n = cs[0]
            name = n[len("Unused_00_"):] if n.startswith("Unused_00_") else n
            print("0,%04X,%s,(as in Mario Tennis 00:%04X)" % (g, name, a))
        return
    if "--csv" in args:
        print("tennis_addr,tennis_name,n_insns,golf_addr,matched,same_addr,n_candidates")
        for a, n, ln, g, k, nc in rows:
            print("%04x,%s,%d,%s,%d,%d,%d" % (a, n, ln, "%04x" % g if g is not None else "", k, int(g == a), nc))
        return
    print("Tennis home routines >= %d insns: %d; full match in Golf: %d; partial (>=50%%): %d" % (
        mn, len(rows), full, sum(1 for r in rows if r[4] < r[2] and r[4] * 2 >= r[2])))
    print("tennis  name                                     len  golf   match")
    for a, n, ln, g, k, nc in rows:
        if k * 2 < ln and "--all" not in args:
            continue
        print("%04x    %-40s %4d  %s  %4d%s%s%s" % (a, n[:40], ln, "%04x" % g if g is not None else "----", k,
              "  FULL" if k == ln else "", "  same-addr" if g == a else "", ("  (%d candidates)" % nc) if nc > 1 else ""))


if __name__ == "__main__":
    main()
