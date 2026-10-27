"""Draft the JavaScript of a map script (banks 30-35) from its SM83 code, for porting by hand: a linear walk from
BB:AAAA that follows the registers' constant values and writes each far call to the bank 0A script API
(REVERSE.md "Script API"), each flag rst, sound, fade and wait as the call web/js/golf/script.js / msgbox.js /
screen.js has for it, with the ROM address in a comment. Anything else (branches, loads from RAM, calls into the
bank) is written as a `// TODO` line with its disassembly, to be ported by hand. It does not decide control flow:
it stops at an unconditional jp / jr / ret (or after N bytes).

With --all it goes on past unconditional jumps and returns (to the end of nbytes) and marks the branch targets
as `// label AAAA` lines; conditional branches are written `if (<condition>) goto AAAA` from the last instruction
that set the flag (cp, and / or a, bit, a flag rst $30), loads of a from RAM as `a = rd(w, ...)`, calls into the bank
as `yield* <label>(sh)`.

usage: script_js.py BB:AAAA [nbytes] [--all]   (prints the draft)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels, parse_ba
from instruction_set import decode
from disasm import inline_len

# far call index in bank 0A -> (template, generator?)  {a} {b} {bc} {de} {hl} {d} {e} {bank} are register values
API = {
    0x04: ("yield* S.scriptWaitFrames(sh, {a});", 1),
    0x06: ("M.scriptRespawnActors(w, {a}, {hl});", 0),
    0x08: ("yield* T.scriptShowText(sh, {a});", 1),
    0x0A: ("yield* T.scriptShowTextKeepOpen(sh, {a});", 1),
    0x0C: ("yield* T.scriptCloseText(sh);", 1),
    0x0E: ("T.scriptSetText(w, {hl});", 0),
    0x10: ("T.scriptSkipText(w);", 0),
    0x12: ("a = yield* T.scriptAskYesNo(sh);", 1),
    0x16: ("S.actorSetSpeed(w, {a}, {bc});", 0),
    0x18: ("S.actorSetScript(w, {a}, {de}, {b});", 0),
    0x1A: ("S.actorResetScript(w, {a});", 0),
    0x1C: ("yield* S.waitActorScriptEnd(sh, {a});", 1),
    0x1E: ("yield* S.waitActorMoveDone(sh, {a});", 1),
    0x20: ("S.actorSetPos(w, {a}, {bc}, {de});", 0),
    0x22: ("S.actorMoveTo(w, {a}, {bc}, {de});", 0),
    0x26: ("S.actorMoveBy(w, {a}, {bc}, {de});", 0),
    0x28: ("S.actorMoveDir(w, {a}, {b}, {de});", 0),
    0x2A: ("S.actorLockSpriteFacing(w, {a}, {b});", 0),
    0x2C: ("S.actorSetFacing(w, {a}, {b});", 0),
    0x2E: ("S.actorFaceActor(w, {a}, {b});", 0),
    0x30: ("S.actorsFaceEachOther(w, {a}, {b});", 0),
    0x32: ("S.actorPlayAnim(w, {b}, {a});", 0),
    0x34: ("yield* S.waitActorAnimDone(sh, {a});", 1),
    0x36: ("S.scriptActorSetSpeed(w, {bc});", 0),
    0x38: ("yield* S.scriptActorGoTo(sh, {a}, {bc}, {de});", 1),
    0x3A: ("yield* S.scriptActorGoToActor(sh, {a}, {b});", 1),
    0x3C: ("yield* S.waitScriptActorIdle(sh);", 1),
    0x3E: ("S.scriptShakeScreen(w, {a});", 0),
    0x40: ("S.actorJump(w, {a}, {de});", 0),
    0x42: ("yield* S.waitActorLanded(sh, {a});", 1),
    0x44: ("a = yield* S.scriptRunMenu(sh, {hl}, {d}, {e});", 1),
    0x46: ("S.actorSetState(w, {a}, {b});", 0),
    0x4C: ("M.scriptSetMapField(w, {hl}, {de});", 0),
}
CALLS = {0x25A1: "Scr.beginFadeOut(w, {c});", 0x25AF: "Scr.beginFadeIn(w, {c});", 0x2625: "yield* Scr.waitFade(sh);",
         0x258A: "Scr.forceFadeOut(w, {c});", 0x258D: "Scr.forceFadeIn(w, {c});", 0x2E3B: "yield* sh.advance();",
         0x2EF0: "yield* sh.advance({c});", 0x0A61: "advanceRandomSeed(w);"}


def h(v, n=2):
    return None if v is None else ("0x%0" + str(n) + "X") % v


def main():
    rom = load_rom()
    labels = Labels()
    bank, pc = parse_ba(sys.argv[1])
    end = pc + (int(sys.argv[2], 0) if len(sys.argv) > 2 else 0x400)
    R = {k: None for k in "abcdehl"}
    pushed = []
    out = []
    every = "--all" in sys.argv
    start = pc
    targets = set()
    if every:                                     # first pass: the branch targets
        q = pc
        while q < end:
            i2 = decode(rom, to_offset(bank, q), q)
            if i2.kind in ("jp", "jr") and i2.target is not None and start <= i2.target < end:
                targets.add(i2.target)
            q += i2.length + inline_len(i2)
    cond = None                                    # (z expression, c expression) of the last flag setter
    sym = None                                     # a JS expression for a when it came from RAM
    while pc < end:
        if pc in targets:
            out.append("  // label %04X" % pc)
            R = {k: None for k in "abcdehl"}; sym = None; cond = None
        off = to_offset(bank, pc)
        ins = decode(rom, off, pc)
        op = ins.raw[0]
        n = inline_len(ins)
        data = rom[off + ins.length:off + ins.length + n]
        here = "%02X:%04X" % (bank, pc)
        pair = lambda x, y: None if R[x] is None or R[y] is None else R[x] << 8 | R[y]
        val = {"a": h(R["a"]), "b": h(R["b"]), "c": h(R["c"]), "d": h(R["d"]), "e": h(R["e"]),
               "bc": h(pair("b", "c"), 4), "de": h(pair("d", "e"), 4), "hl": h(pair("h", "l"), 4)}
        val = {k: (v if v is not None else "/*%s?*/" % k) for k, v in val.items()}
        line = None
        nxt = pc + ins.length + n
        if op == 0x3E: R["a"] = ins.raw[1]
        elif op in (0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E):
            R["bcdehl"[[0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E].index(op)]] = ins.raw[1]
        elif op in (0x01, 0x11, 0x21):
            hi, lo = {0x01: "bc", 0x11: "de", 0x21: "hl"}[op]
            R[hi], R[lo] = ins.raw[2], ins.raw[1]
        elif op == 0xAF: R["a"] = 0
        elif op == 0x47: R["b"] = R["a"]
        elif op == 0x4F: R["c"] = R["a"]
        elif op == 0x78: R["a"] = R["b"]
        elif op == 0xF5: pushed.append(R["a"])
        elif op == 0xF1:
            R["a"] = pushed.pop() if pushed else None
        elif op == 0xF0 and ins.raw[1] == 0x95:          # ldh a, [hROMBank]: the script's bank
            R["a"] = bank
        elif op == 0xDF:
            idx, fb = data[0], data[1]
            if fb == 0x0A and idx in API:
                line = API[idx][0].format(**val)
                if idx in (0x12, 0x44): R["a"] = None
            else:
                t = rom[to_offset(fb, 0x4000 + idx)] | rom[to_offset(fb, 0x4001 + idx)] << 8
                name = (labels.get(fb, t) or ("?",))[0]
                line = "// TODO %s farcall %02X:%04X %s (a %s b %s c %s de %s hl %s)" % (
                    here, fb, t, name, val["a"], val["b"], val["c"], val["de"], val["hl"])
                R["a"] = None
        elif op in (0xE7, 0xEF, 0xF7):
            fl = (data[0] | data[1] << 8) >> 5
            line = {0xE7: "setFlag(w, %d);", 0xEF: "clearFlag(w, %d);", 0xF7: "// TODO test flag #%d (z when clear)"}[op] % fl
        elif op == 0xCF:
            line = "sh.sound(0x%02X);" % data[0]
        elif op == 0xCD and ins.target == 0x2ED5:
            line = "yield* sh.advance(%d);   // 00:2ED5 WaitFramesCmd" % data[0]
        elif op == 0xCD and ins.target in CALLS:
            line = CALLS[ins.target].format(**val)
            if ins.target == 0x0A61: R["a"] = None
        elif op == 0xEA:
            a16 = ins.raw[1] | ins.raw[2] << 8
            line = "wr(w, 0x%04X, %s);" % (a16, val["a"])
        av = val["a"] if R["a"] is not None or sym is None else sym
        if op == 0xFA:
            a16 = ins.raw[1] | ins.raw[2] << 8
            line = "a = rd(w, 0x%04X);" % a16
            R["a"] = None; sym = "a"
        elif op == 0xFE:
            cond = ("%s === 0x%02X" % (av, ins.raw[1]), "%s < 0x%02X" % (av, ins.raw[1])); line = ""
        elif op in (0xA7, 0xB7):
            cond = ("!%s" % av, "false"); line = ""
        elif op == 0xCB and (ins.raw[1] & 0xC7) == 0x47:
            cond = ("!(%s & 0x%02X)" % (av, 1 << ((ins.raw[1] >> 3) & 7)), None); line = ""
        elif op == 0xF7:
            fl = (data[0] | data[1] << 8) >> 5
            cond = ("!flag(w, %d)" % fl, None); line = ""
        elif op in (0x20, 0x28, 0x30, 0x38, 0xC2, 0xCA, 0xD2, 0xDA, 0xC0, 0xC8, 0xD0, 0xD8):
            z, c = cond or ("/*z?*/", "/*c?*/")
            cc = {0x20: "!(%s)" % z, 0x28: z, 0x30: "!(%s)" % c, 0x38: c, 0xC2: "!(%s)" % z, 0xCA: z,
                  0xD2: "!(%s)" % c, 0xDA: c, 0xC0: "!(%s)" % z, 0xC8: z, 0xD0: "!(%s)" % c, 0xD8: c}[op]
            what = "return" if op in (0xC0, 0xC8, 0xD0, 0xD8) else "goto %04X" % ins.target
            line = "if (%s) %s;" % (cc, what)
        elif op == 0xCD and 0x4000 <= (ins.target or 0) < 0x8000:
            nm = (labels.get(bank, ins.target) or ("fn%04X" % ins.target,))[0]
            line = "yield* %s(sh);   // call %04X" % (nm[0].lower() + nm[1:], ins.target)
            R = {k: None for k in "abcdehl"}; sym = None
        elif op in (0xC3, 0x18):
            line = "goto %04X;" % ins.target
        elif op == 0xC9:
            line = "return;"
        if line == "":
            line = None
            pc = nxt
            continue
        if line is None and not (op in (0x3E, 0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x01, 0x11, 0x21, 0xAF, 0x47, 0x4F,
                                        0x78, 0xF5, 0xF1) or op == 0xF0 and ins.raw[1] == 0x95):
            nm = labels.get(bank, ins.target)[0] if ins.target is not None and labels.get(bank, ins.target) else ""
            line = "// TODO %s %s %s" % (here, ins.text, nm)
            if op not in (0xFE, 0xB7, 0xA7):           # (a compare leaves a)
                for k in "abcdehl":
                    pass
                if op in (0xFA, 0xF0) or 0x78 <= op <= 0x7F or op in (0x3C, 0x3D, 0xE6, 0xF6, 0xC6, 0xD6, 0xEE):
                    R["a"] = None
                if op == 0xCD:
                    R = {k: None for k in "abcdehl"}
        if line:
            out.append("  %s%s// %s" % (line, " " * max(1, 64 - len(line)), here) if not line.startswith("//")
                       else "  " + line)
        if op in (0x3E, 0xAF):
            sym = None
        if op in (0xC3, 0x18, 0xC9, 0xE9) and not every:
            break
        pc = nxt
    print("\n".join(out))


if __name__ == "__main__":
    main()
