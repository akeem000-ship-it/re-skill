// A REC recording (.mgrec, js/rec.js) played again headless, as the page played it (play.js newRound and step): the same start, the
// same button reads, the sound driver along (the game waits on its jingles). Checks the state hashes the page kept every 60 frames.
//   node web/tests/rec_replay.mjs FILE.mgrec [--at F1,F2,...]     (--at: the game's mark and hole at those frames)
// Needs rom/mario_golf.gbc.
import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "..", "..");
const J = p => import(path.join(ROOT, "web", "js", p));
const { useRom } = await J("golf/rom.js"), { GolfMemory } = await J("golf/memory.js"), { playRoundFrames, playFromPowerOn } = await J("golf/game.js");
const { strokeRoundSetup, matchRoundSetup, setCourseHole } = await J("golf/start.js"), { initDisplay } = await J("golf/render/display.js");
const { SoundDriver } = await J("sound/driver.js"), { stateHash } = await J("rec.js");

const file = process.argv[2]; if (!file) { console.log("usage: node web/tests/rec_replay.mjs FILE.mgrec [--at F1,F2]"); process.exit(2); }
const raw = fs.readFileSync(file), rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
const at = new Set(((process.argv[process.argv.indexOf("--at") + 1] || "") && process.argv.includes("--at") ? process.argv[process.argv.indexOf("--at") + 1] : "").split(",").filter(Boolean).map(Number));
const rom = new Uint8Array(fs.readFileSync(path.join(ROOT, "rom", "mario_golf.gbc"))); useRom(rom);
const st = rec.start, inputs = Buffer.from(rec.inputs, "base64");
const w = new GolfMemory(), fromPowerOn = st.mode === "title";
let holes = 0;
if (!fromPowerOn) {
  holes = st.mode.startsWith("match:") ? matchRoundSetup(w, { golfer: 8, opponent: +st.mode.slice(6), course: 1, seed: st.seed })
    : strokeRoundSetup(w, { golfer: 8, course: 1, seed: st.seed });
  if (st.mode === "stroke" && (st.course || st.hole)) setCourseHole(w, st.course, st.course, st.hole);
}
if (fromPowerOn && st.sram) w.sram.set(Buffer.from(st.sram, "base64").subarray(0, w.sram.length));
initDisplay(w);
const driver = new SoundDriver(rom); driver.init();
w.onSound = id => driver.playSound(id); w.onMusicOption = f => driver.applyMusicOption(f);
w.jingleActive = () => driver.ram[0xFFCD]; w.onEndJingle = () => driver.endJingle();
if (!fromPowerOn) w.onSound(0x01);
let k = 0, mark = fromPowerOn ? "menus" : "", over = false;
const input = () => { if (k >= inputs.length) { over = true; return 0; } return inputs[k++]; };
const opts = { ev: (kind, name) => { if (kind === "M") mark = name; }, maxHoles: Infinity, onRoundStart: () => { mark = "round"; }, onRoundEnd: () => { mark = "menus"; } };
const g = fromPowerOn ? playFromPowerOn(w, input, opts) : playRoundFrames(w, holes, input, opts);
const want = new Map(rec.hashes); let ok = 0, bad = 0, firstBad = -1;
for (let f = 1; f <= rec.frames; f++) {
  const r = g.next();
  driver.setBallHeight(w.wram[0][0xAAB] | w.wram[0][0xAAC] << 8); driver.frame();
  if (want.has(f)) { if (want.get(f) === stateHash(w)) ok++; else { bad++; if (firstBad < 0) firstBad = f; } }
  if (at.has(f)) console.log("at", f, "mark", mark, "hole", w.wram[0][0x837]);
  if (r.done) { console.log("the round ended at frame", f); break; }
}
console.log(`${rec.frames} frames (REC pressed at ${rec.from}), ${k} of ${inputs.length} reads used${over ? " (ran out)" : ""}; hashes ${ok} same, ${bad} different` + (bad ? `, first at frame ${firstBad}` : ""));
process.exit(bad || k !== inputs.length ? 1 : 0);
