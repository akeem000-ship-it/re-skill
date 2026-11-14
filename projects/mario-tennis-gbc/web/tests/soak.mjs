import fs from "fs";
import { fileURLToPath } from "url";
const here = p => fileURLToPath(new URL(p, import.meta.url));
import { Rom } from "../js/rom.js";
import { characterData } from "../js/assets.js";
import { Match } from "../js/match.js";
const rom = new Rom(new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc"))));
const m = new Match(rom, characterData(rom, 23), characterData(rom, 25), { games: 6, difficulty: 1 });
m.players[0].cpu = true;
const stats = {}, rallies = []; let hits = 0, lastMsg = "", games = 0;
const origHit = m.hit.bind(m); m.hit = (p, k) => { hits++; return origHit(p, k); };
for (let f = 0; f < 30000 && !m.over; f++) {
  m.update({});
  if (m.msgTimer > 0 && m.message !== lastMsg) {
    const kind = m.message.split("  ")[0]; stats[kind] = (stats[kind] || 0) + 1; lastMsg = m.message;
    if (kind !== "FAULT") { rallies.push(hits); } hits = 0;
  }
  if (m.msgTimer === 0) lastMsg = "";
}
const avg = rallies.reduce((a, b) => a + b, 0) / rallies.length;
console.log("outcomes", stats); console.log("points", rallies.length, "avg hits/point", avg.toFixed(2), "max", Math.max(...rallies));
console.log("games", m.games, "over", m.over, "winner", m.winner);
