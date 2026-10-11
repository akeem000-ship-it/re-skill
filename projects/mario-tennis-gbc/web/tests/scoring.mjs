// Scoring rules vs the ROM (REVERSE.md "ScoreUpdate 08:5AD7"): deuce, set by 2, tiebreak at N-N
// to 7 by 2, tiebreak serve order 1-2-2 (rotation table 08:49D9).
import fs from "fs";
import { fileURLToPath } from "url";
import { Rom } from "../js/rom.js";
import { characterData } from "../js/assets.js";
import { Match } from "../js/match.js";
const rom = new Rom(new Uint8Array(fs.readFileSync(fileURLToPath(new URL("../../rom/mario_tennis.gbc", import.meta.url)))));
const mk = games => new Match(rom, characterData(rom, 23), characterData(rom, 25), { games, difficulty: 1 });
let fails = 0;
const eq = (what, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", what, JSON.stringify(got), ok ? "" : "want " + JSON.stringify(want)); };
const play = (m, seq) => { for (const c of seq) m.awardPoint(+c, "T"); };

let m = mk(6);
play(m, "000111"); eq("deuce text", m.scoreText(), "DEUCE");
play(m, "0"); eq("advantage", m.scoreText(), "ADV P1");
play(m, "1"); eq("back to deuce", m.scoreText(), "DEUCE");
play(m, "00"); eq("game after deuce", m.games, [1, 0]);
eq("server alternates per game", m.server, 1);

m = mk(6); m.games = [6, 6]; m.server = 0; m.tbServer = 0;
const servers = [];
for (let i = 0; i < 6; i++) { servers.push(m.server); play(m, i % 2 ? "1" : "0"); }
eq("tiebreak serve order", servers, [0, 1, 1, 0, 0, 1]);
eq("tiebreak 3-3 not over", m.over, false);
play(m, "0000"); eq("tiebreak to 7", [m.over, m.winner, m.games], [true, 0, [7, 6]]);

m = mk(2); play(m, "0000" + "1111" + "0000"); eq("2-game set: 2-1 continues", [m.games, m.over], [[2, 1], false]);
play(m, "0000"); eq("2-game set: 3-1 wins", [m.over, m.winner], [true, 0]);
process.exit(fails ? 1 : 0);
