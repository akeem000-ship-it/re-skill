// A Stroke round played natively by the JS engine (web/js/golf/game.js), from the RAM at GolfRound's entry, with
// no emulator and no state taken from a recording on the way: the swings are the buttons the game read in a
// recorded round (out/round_r3.json, tools/round_suite.py), replayed from each address step; the menus are
// answered with A. The play must come out as the game's: every shot's outcome, the ball, club and aim at every
// address step, each hole's strokes and putts, and the round and player records after the last hole.
// Start: out/holesetup_h1.json (the same round, tools/hole_setup_suite.py).
// usage: node web/tests/golf_native_round.mjs
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { GolfMemory } from "../js/golf/memory.js";
import { playRound } from "../js/golf/game.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
const start = JSON.parse(fs.readFileSync(path.join(root, "out/holesetup_h1.json"))).points.find(p => p.kind === "round");
const rec = JSON.parse(fs.readFileSync(path.join(root, "out/round_r3.json")));
const hexBytes = s => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(2 * i, 2), 16));
const h2 = v => v.toString(16).padStart(2, "0");

// the swings: for each address step (A event) the held buttons of the frames after it
const addresses = [];
rec.events.forEach((e, i) => { if (e[0] === "A") addresses.push(i); });
const streams = addresses.map((ai, k) => {
  const end = k + 1 < addresses.length ? addresses[k + 1] : rec.events.length;
  const held = [];
  for (let i = ai + 1; i < end; i++) if (rec.events[i][0] === "F") held.push(rec.joy[String(i)] ? rec.joy[String(i)][0] : 0);
  return held;
});

const w = new GolfMemory().loadSnapshot(start.snapshot);
let shot = -1, n = 0, phase = "menus", toggle = 0;
const errors = [];
const ev = (kind, name) => {
  if (kind !== "M") return;
  if (name === "address") {
    shot++; n = 0; phase = "swing";
    const want = hexBytes(rec.events[addresses[shot]][2]), want3 = hexBytes(rec.events[addresses[shot]][6]);
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
const res = playRound(w, start.a, input, { ev, maxHoles: 3 });

const wantShots = [0x00, 0x06, 0x06, 0x80, 0x01, 0x09, 0x06, 0x80, 0x06, 0x80];
const wantHoles = [[4, 2], [4, 1], [2, 1]];
if (JSON.stringify(res.shots) !== JSON.stringify(wantShots)) errors.push(`outcomes ${res.shots.map(h2).join(" ")}, the game's ${wantShots.map(h2).join(" ")}`);
if (JSON.stringify(res.holes.map(h => [h.strokes, h.putts])) !== JSON.stringify(wantHoles)) errors.push(`holes ${JSON.stringify(res.holes)}`);
const want = hexBytes(rec.events[rec.events.length - 1][5]);
const d = [];
for (let k = 0; k < 0x100; k++) if (want[k] !== w.wram[0][0x800 + k]) d.push(`$${(0xC800 + k).toString(16)} js ${h2(w.wram[0][0x800 + k])} game ${h2(want[k])}`);
if (d.length) errors.push("records differ: " + d.join(" "));
console.log(`${errors.length ? "FAIL" : "ok  "} native round: ${res.shots.length} shots (${res.shots.map(h2).join(" ")}), ` +
  res.holes.map(h => `hole ${h.hole}: ${h.strokes} strokes ${h.putts} putts`).join(", ") + `, points ${w.wram[0][0x83C]}`);
for (const e of errors) console.log("     " + e);
process.exit(errors.length ? 1 : 0);
