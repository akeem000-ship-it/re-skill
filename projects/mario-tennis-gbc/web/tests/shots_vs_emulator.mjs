// Re-run the ported shot selection (web/js/shots.js) on the inputs logged by tools/emu_shot_trace.py
// and compare record address, launch speed / elevation / heading with what the game did.
// usage: node web/tests/shots_vs_emulator.mjs states/shots*.json
import fs from "fs";
import { fileURLToPath } from "url";
import { Rom } from "../js/rom.js";
import { computeShot } from "../js/shots.js";
const root = new URL("../../", import.meta.url);
const rom = new Rom(new Uint8Array(fs.readFileSync(fileURLToPath(new URL("rom/mario_tennis.gbc", root)))));
let ok = 0, bad = 0, skipped = 0;
for (const f of process.argv.slice(2)) {
  for (const s of JSON.parse(fs.readFileSync(f))) {
    if (!("rec" in s) || s.variant === 0x415D) { skipped++; continue; }   // 415D = weak-hit fallback launches (inputs not logged)
    const ctx = {
      type: s.type, charge: s.charge, mirror: s.mirror, posCode: s.posCode, aimDir: s.aimDir,
      stats: { Stroke: s.stroke, Serve: s.serve, Volley: s.volley, Top: s.top, Slice: s.slice }, lobRow: 0, dropRow: 0,
      ball: { X: s.ballX, Y: s.ballY, Z: s.ballZ, vy: s.ballVY }, player: { X: s.playerX, vy: s.plVelY, moving: !!(s.moveFlags & 2) },
      targetX: s.tgtX,
    };
    // the logged Z is already the adjusted contact height: feed it back unadjusted
    const r = computeShot(rom, { ...ctx, type: s.type, ball: { ...ctx.ball, Z: s.ballZ } , noAdjust: true });
    const fields = [["recAddr", r.recAddr, s.recAddr], ["speed", r.speed, s.lbSpeed], ["elev", r.elev, s.lbElev], ["heading", r.heading, s.lbHeading]];
    if ("S" in s && s.type !== 5) fields.push(["S", r.S, s.S]);
    const diffs = fields.filter(([, a, b]) => a !== b);
    if (diffs.length) { bad++; console.log("FAIL f%d type %d: %s", s.frame, s.type, diffs.map(([n, a, b]) => `${n} ${a} vs ${b}`).join(", "), "dMin", r.dMin, s.dMin, "dMax", r.dMax, s.dMax); }
    else ok++;
  }
}
console.log(`${ok} ok, ${bad} failed, ${skipped} skipped`);
process.exit(bad ? 1 : 0);
