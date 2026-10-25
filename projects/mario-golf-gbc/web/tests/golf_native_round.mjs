// A Stroke round played natively by the JS engine (web/js/golf/game.js), from the RAM at GolfRound's entry, with
// no emulator and no state taken from a recording on the way: the swings are the buttons the game read in a
// recorded round (out/roundin_<name>.json, tools/emu_round_inputs.py), replayed from each address step; the menus are
// answered with A. The play must come out as the game's: every shot's outcome, the ball, club and aim at every
// address step, each hole's strokes and putts, and the round and player records after the last hole.
// Start: out/holesetup_h1.json (the same round, tools/hole_setup_suite.py).
// Recordings made with --poke (rec.pokes) get the same bytes: roundin_cpu18 has player 1 played by the computer
// golfer (C893 = 1): its aim, club and swing come from ai.js (bank 3C) and must come out as the game's.
// usage: node web/tests/golf_native_round.mjs [name ...]   (default r18 cpu18 r18:setup: all 18 holes of the Stroke
// practice round, by the bot's buttons and by the computer golfer; r18:setup starts from empty RAM through the
// menus' path ported in start.js, with only the random seed taken from the recording, as the play page starts)
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { playRound } from "../js/golf/game.js";
import { strokeRoundSetup } from "../js/golf/start.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const start = JSON.parse(fs.readFileSync(path.join(root, "out/holesetup_h1.json"))).points.find(p => p.kind === "round");
function run(spec) {
  const [name, how] = spec.split(":");          // "r18:setup": the start made by start.js instead of the recorded RAM
  const rec = JSON.parse(fs.readFileSync(path.join(root, `out/roundin_${name}.json`)));
  const hexBytes = s => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(2 * i, 2), 16));
  const h2 = v => v.toString(16).padStart(2, "0");

  // the swings: for each address step the held buttons of the frames after it
  const streams = rec.addresses.map((ad, k) => rec.held.slice(ad.frame, k + 1 < rec.addresses.length ? rec.addresses[k + 1].frame : rec.held.length));

  let w = new GolfMemory().loadSnapshot(start.snapshot);
  if (how === "setup") {                         // the menus' path (start.js) from empty RAM; only the random seed
    const seed = w.high[0x1FC] | w.high[0x1FD] << 8;   // (the menus' frames advance it) is taken from the recording
    w = new GolfMemory();
    if (strokeRoundSetup(w, { golfer: 8, course: 1 }) !== start.a) throw new Error("hole count");
    w.high[0x1FC] = seed & 0xFF; w.high[0x1FD] = seed >> 8;
  }
  for (const [a, v] of Object.entries(rec.pokes || {})) {   // e.g. C893: player 1 played by the computer
    if (a.includes(":")) continue;                 // banked copies (6:D4D7) the round start here makes itself
    const addr = parseInt(a, 16);
    if (addr < 0xC000 || addr >= 0xD000) throw new Error(`poke $${a}: only WRAM0`);
    w.wram[0][addr - 0xC000] = v;
  }
  let shot = -1, n = 0, phase = "menus", toggle = 0;
  const errors = [];
  const ev = (kind, name) => {
    if (kind !== "M") return;
    if (name === "address") {
      shot++; n = 0; phase = "swing";
      const page = hexBytes(rec.addresses[shot].d300), want = page.subarray(0x100), want3 = page;
      const r6 = w.wram[6];
      const d = [];
      for (let k = 0; k < 6; k++) if (r6[0x400 + k] !== want[k]) d.push(`ball $${(0xD400 + k).toString(16)}`);
      for (const a of [0x418, 0x419]) if (r6[a] !== want[a - 0x400]) d.push(`aim $${(0xD000 + a).toString(16)}`);
      for (const a of [0x329, 0x32A, 0x32B]) if (r6[a] !== want3[a - 0x300]) d.push(`club/mode $${(0xD000 + a).toString(16)}`);
      if (d.length) errors.push(`address step ${shot + 1}: ${d.join(", ")} differ`);
    } else if (name !== "address") phase = "menus";
  };
  const input = () => {
    if (phase === "swing") return streams[shot][n++] || 0;
    return (toggle ^= 1) ? 1 : 0;                  // menus and captions: A
  };
  let holeNo = 0;
  const onHoleEnd = () => {                        // the records as the game had them at 10:4635
    const want = hexBytes(rec.hole_ends[holeNo]);
    const d = [];
    for (let k = 0; k < 0x100; k++) if (want[k] !== w.wram[0][0x800 + k]) d.push(`$${(0xC800 + k).toString(16)} js ${h2(w.wram[0][0x800 + k])} game ${h2(want[k])}`);
    if (d.length) errors.push(`records at the end of hole ${holeNo + 1} differ: ` + d.slice(0, 8).join(" "));
    holeNo++;
  };
  let res;
  try {
    res = playRound(w, start.a, input, { ev, maxHoles: rec.hole_ends.length, onHoleEnd });
  } catch (e) {
    console.log(`FAIL native round ${name}: ${e.message} (shot ${shot + 1})`);
    for (const e2 of errors) console.log("     " + e2);
    return false;
  }
  if (JSON.stringify(res.shots) !== JSON.stringify(rec.outcomes)) errors.push(`outcomes ${res.shots.map(h2).join(" ")}, the game's ${rec.outcomes.map(h2).join(" ")}`);
  console.log(`${errors.length ? "FAIL" : "ok  "} native round ${spec}: ${res.shots.length} shots (${res.shots.map(h2).join(" ")}), ` +
    res.holes.map(h => `hole ${h.hole}: ${h.strokes} strokes ${h.putts} putts`).join(", ") + `, points ${w.wram[0][0x83C]}`);
  for (const e of errors) console.log("     " + e);
  return !errors.length;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : ["r18", "cpu18", "r18:setup"];
let bad = 0;
for (const name of names) if (!run(name)) bad++;
process.exit(bad ? 1 : 0);
