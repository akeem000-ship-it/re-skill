// Registers around the match's hooks. A hook's JS may call ROM routines (P.callRom: sounds, the sprite and VRAM
// queues), which leave their own registers in the CPU; the ROM routine the hook replaces leaves the caller's
// registers as it found them except for the ones it sets. keepRegs gives a hook that behaviour: the hook reads its
// arguments and writes its results through a register view, and afterwards (for a routine that waits: when it
// returns) the CPU has the caller's registers with only those results changed.
//
// What else the ROM routine leaves (its scratch registers and flags: leftovers.js) is set after the hook by
// `post(P, out, inp, ctx)`: `out` is the same register view, `inp` the registers the routine was entered with,
// ctx what `pre(P, inp)` noted before the hook ran (RAM the routine changes). `out.passCpu(...names)` takes
// registers as the CPU has them now: for a routine that ends by jumping to a ROM routine, which the hook called
// last with the registers of that jump.
const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
const PAIRS = { af: ["a", "f"], bc: ["b", "c"], de: ["d", "e"], hl: ["h", "l"] };

function registerView(get, set) {
  const view = {};
  for (const r of REGS) Object.defineProperty(view, r, { get: () => get(r), set: v => set(r, v) });
  for (const [p, [hi, lo]] of Object.entries(PAIRS))
    Object.defineProperty(view, p, { get: () => get(hi) << 8 | get(lo), set: v => { set(hi, v >> 8); set(lo, v); } });
  return view;
}

export function keepRegs(fn, extra = null) {
  return (P, cpu) => {
    const saved = {}, out = {};
    for (const r of REGS) saved[r] = cpu[r];
    const view = registerView(r => (r in out ? out[r] : saved[r]), (r, v) => { out[r] = r === "f" ? v & 0xF0 : v & 0xFF; });
    Object.defineProperty(view, "sp", { get: () => cpu.sp });
    view.passCpu = (...names) => { for (const r of names.length ? names : REGS) out[r] = cpu[r]; };
    const inp = extra && registerView(r => saved[r], () => { throw new Error("inp is read-only"); });
    const ctx = extra && extra.pre ? extra.pre(P, inp) : null;
    const leave = () => {
      if (extra) extra.post(P, view, inp, ctx);
      for (const k of REGS) cpu[k] = k in out ? out[k] : saved[k];
    };
    const r = fn(P, view);
    if (r && typeof r.next === "function") return (function* () { yield* r; leave(); })();
    leave();
  };
}
// a module's HOOKS, every one keeping the caller's registers but its results, and with the leftovers (a list of
// [bank, addr, { pre?, post }]) of the routines that have them
export function keepingRegs(hooks, leftovers = []) {
  const extra = new Map(leftovers.map(([b, a, x]) => [`${b}:${a}`, x]));
  return hooks.map(([b, a, fn]) => [b, a, keepRegs(fn, extra.get(`${b}:${a}`))]);
}
