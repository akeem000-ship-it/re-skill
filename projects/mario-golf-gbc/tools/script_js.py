"""Draft the JavaScript of a map script (banks 30-35) from its SM83 code, for porting by hand: a linear walk from
BB:AAAA that follows the registers' constant values and writes each far call to the bank 0A script API
(REVERSE.md "Script API"), each flag rst, sound, fade and wait as the call web/js/golf/script.js / msgbox.js /
screen.js has for it, with the ROM address in a comment. Anything else (branches, loads from RAM, calls into the
bank) is written as a `// TODO` line with its disassembly, to be ported by hand. It does not decide control flow:
it stops at an unconditional jp / jr / ret (or after N bytes).

usage: script_js.py BB:AAAA [nbytes]   (prints the draft)
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
    0x44: ("a = yield* T.scriptRunMenu(sh, {hl}, {d}, {e});", 1),
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
    while pc < end:
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
        if op in (0xC3, 0x18, 0xC9, 0xE9):
            break
        pc = nxt
    print("\n".join(out))


if __name__ == "__main__":
    main()
