// Link play natively against two linked emulator cores. A session recorded on two cores in step with a cable
// (web/tests/golf/linkcores.mjs --record NAME: both players' buttons, every transfer, each side's frame times) is
// replayed side by side:
//   - each side's core alone, its cable a script of the bytes it got at the base-clock counts it got them
//     (web/js/gb/link.js ScriptCable; checked here: its screens match the two-core run's hashes);
//   - two native machines from power-on (boot.js gameFromPowerOn, the rounds by game.js) joined by the JS cable
//     (serial.js NativeCable), each beside its core as in the screen test (web/tests/golf/screenstep.mjs: every
//     frame the display and the screen compared; lag frames counted apart).
// The two native machines run frame part by frame part (the VBlank work, then the frame's code: screenSteps yields
// "code" between them with a cable) in the order the cores' clocks put them: each part at the base-clock count its
// core began it (the VBlank handler's entry / the wait's end), and each transfer (the cable's defer mode: started, it
// waits) ends at the count its core's transfer ended (the n-th transfer a native side starts is the n-th its core
// started): both sides see a byte in the same frame as on the hardware.
// usage: node web/tests/golf_link_vs_cores.mjs [NAME (default session)] [--frames N] [--verbose] [--record]
//   --record first records the session (linkcores.mjs sessionPolicy, --frames frames per side)
import fs from "fs";
import path from "path";
import { screenSteps } from "./golf/screenstep.mjs";
import { runLinked, packRecording, loadRecording, sessionPolicy } from "./golf/linkcores.mjs";
import { ScriptCable } from "../js/gb/link.js";
import { GBC } from "../js/gb/gbc.js";
import { saveState } from "../js/gb/state.js";
import { NativeCable } from "../js/golf/serial.js";
import { gameFromPowerOn } from "../js/golf/boot.js";
import { playRoundFrames } from "../js/golf/game.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const argv = process.argv.slice(2), arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const name = argv.find((a, i) => !a.startsWith("--") && !(i && argv[i - 1].startsWith("--frames"))) || "session";
const verbose = argv.includes("--verbose");
const recFile = `out/link/${name}.json`;
fs.mkdirSync(path.join(root, "out/link"), { recursive: true });
if (argv.includes("--record") || !fs.existsSync(path.join(root, recFile))) {
  const frames = +arg("--frames", 30000);
  console.log(`recording ${recFile}: two linked cores, ${frames} frames per side`);
  const sides = runLinked({ frames, policy: sessionPolicy() });
  fs.writeFileSync(path.join(root, recFile), JSON.stringify(packRecording(sides, { frames })));
}
const rec = loadRecording(recFile);
const stateFile = "out/link/state_poweron.json";
if (!fs.existsSync(path.join(root, stateFile))) {
  const gb = new GBC(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))), { audio: false });
  fs.writeFileSync(path.join(root, stateFile), JSON.stringify({ at: [0, 0x100], state: saveState(gb) }));
}

// the parts' keys: per side and frame k, V (the VBlank work) at tv[k], C (the code) at tc[k], the part before the
// first frame (C of frame -1) at 0; each transfer a side started: its end (the first transfer event on that side from
// the start's count)
const keys = rec.sides.map(side => {
  const ends = [];
  let e = 0;
  for (const [t] of side.starts) {
    while (e < side.events.length && side.events[e][0] < t) e++;
    ends.push(e < side.events.length ? side.events[e][0] : t);
  }
  return { V: side.tv, C: side.tc.map((t, k) => side.ta[k] ?? t), S: side.syncs, ends };
});

// DUMP=side:frame:bank:addr:len[,...] prints both machines' bytes there (WRAM bank 0-7 or h for HRAM) (debugging)
const dumps = (process.env.DUMP || "").split(",").filter(Boolean).map(s => { const [sd, f, b, a, n] = s.split(":"); return { sd: +sd, f: +f, b, a: parseInt(a, 16), n: parseInt(n, 16) }; });
// VWATCH=side:addr: the frames where VRAM bank 0 at addr starts / stops differing (debugging)
const vwatch = process.env.VWATCH ? process.env.VWATCH.split(":").map((v, i) => (i ? parseInt(v, 16) : +v)) : null;
let vdiff = false;
const dumpHook = id => (f, w, core) => {
  if (vwatch && vwatch[0] === id) {
    const a = vwatch[1] - 0x8000, d = w.vram[0][a] !== core.gb.mem.vram[0][a];
    if (d !== vdiff) { console.log(`side ${id} frame ${f}: vram $${vwatch[1].toString(16)} ${d ? "differs" : "agrees"} (js ${w.vram[0][a].toString(16)} game ${core.gb.mem.vram[0][a].toString(16)})`); vdiff = d; }
  }
  for (const d of dumps) if (d.sd === id && d.f === f) {
    const js = [], game = [];
    for (let i = 0; i < d.n; i++) {
      if (d.b === "h") { js.push(w.high[0x180 + d.a - 0xFF80 + i]); game.push(core.hram()[d.a - 0xFF80 + i]); }
      else { const b = +d.b, o = (d.a & 0xFFF) + i; js.push(w.wram[b][o]); game.push(core.wram(b)[o]); }
    }
    const hx = a => a.map(v => v.toString(16).padStart(2, "0")).join(" ");
    console.log(`side ${id} frame ${f} ${d.b}:${d.a.toString(16)}\n  js   ${hx(js)}\n  game ${hx(game)}`);
  }
};
const cable = new NativeCable();
cable.defer = true;
const results = [];
const steppers = [0, 1].map(id => {
  const side = rec.sides[id];
  const res = { id };
  results.push(res);
  const g = screenSteps({ stateFile, maxFrames: side.inputs.length + 10, open: true, verbose, trace: !!process.env.LINKTRACE && +process.env.LINKTRACE === id, hook: dumpHook(id), shotTag: String(id),
    policy: f => side.inputs[f] || 0,
    setupCore: gb => new ScriptCable(gb, side.events),
    setupNative: (w, r) => { cable.attach(w); res.r = r; res.w = w; },
    run: sh => (function* () {
      const g = gameFromPowerOn(sh, function* (holes) { yield* playRoundFrames(sh.w, holes, null, { sh }); });
      for (;;) {
        const r = g.next();
        if (r.done) return r.value;
        if (res.r && res.r.frames >= side.inputs.length - 2) return "stopped";
        yield r.value;
      }
    })() });
  return { id, g, next: { part: "C", k: -1 }, done: false, syncs: 0 };
});
const keyOf = s => (s.next.part === "S" ? keys[s.id].S[s.next.n] ?? Infinity : s.next.k < 0 ? 0 : (s.next.part === "V" ? keys[s.id].V : keys[s.id].C)[s.next.k] ?? Infinity);
const t0 = Date.now();
let error = null;
try {
  for (;;) {
    const live = steppers.filter(s => !s.done);
    if (!live.length) break;
    const s = live.length === 1 ? live[0] : (keyOf(live[0]) <= keyOf(live[1]) ? live[0] : live[1]);
    if (cable.pending.length) {                  // a transfer waiting: its end when it comes before the next part
      const w = cable.pending[0], id = cable.ends.indexOf(w);
      const n = cable.started[id] - cable.pending.filter(x => x === w).length;
      const end = keys[id].ends[n] ?? -1;
      if (end <= keyOf(s)) {
        if (process.env.LINKDBG) console.log(`transfer ${id}#${n} end ${end} next part ${s.id} ${s.next.part}${s.next.k} key ${keyOf(s)} frames ${results.map(r => r.r && r.r.frames)}`);
        cable.complete(); continue;
      }
    }
    const r = s.g.next();
    if (r.done) { s.done = true; results[s.id].end = r.value; continue; }
    if (r.value === "code") s.next = { part: "C", k: s.next.k };
    else if (r.value === "sync") s.next = { part: "S", k: s.next.k, n: s.syncs++ };
    else s.next = { part: "V", k: s.next.k + 1 };
  }
} catch (e) { error = e; }

let bad = 0;
for (const res of results) {
  const r = res.end || res.r;
  if (!r) continue;
  const ok = !error && !r.bad.length;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} side ${res.id}: ${r.frames} frames, ${r.pixelExact} pixel-exact, ${r.modelExact} with the display state equal, ${r.lag} differing after lag frames, ${r.bad.length} other`);
  const runs = [];
  for (const b of r.bad) { const l = runs[runs.length - 1]; if (l && b.frame === l[1] + 1) l[1] = b.frame; else runs.push([b.frame, b.frame]); }
  if (runs.length) console.log(`    differing frames: ${runs.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(" ")}`);
  for (const b of r.bad.slice(0, 8)) console.log(`    frame ${b.frame}: ${b.px} px; ${b.out.join("; ").slice(0, 400)}`);
  const sounds = r.sounds.core.filter(x => +x.split(":")[0] < r.frames).join(" ") === r.sounds.native.join(" ");
  if (!sounds) {
    const c = r.sounds.core, n = r.sounds.native;
    let i = 0; while (i < c.length && c[i] === n[i]) i++;
    console.log(`    sounds differ from #${i}: game ${c.slice(i, i + 6).join(" ")} / js ${n.slice(i, i + 6).join(" ")}`);
  }
}
if (error) { console.log(`FAIL: ${error.stack.split("\n").slice(0, 6).join("\n")}`); bad++; }
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
