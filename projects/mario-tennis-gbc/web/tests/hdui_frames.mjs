// HD UI: the built-in frame finder (web/js/hdui_frames.js) on recorded screens, headless (no browser).
// usage: node web/tests/hdui_frames.mjs   (needs rom/mario_tennis.gbc and the recordings under out/)
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js"; import { loadState } from "../js/gb/state.js"; import { stateOf } from "../js/recorder.js";
import { Screen } from "../js/hdui.js"; import { findPanels } from "../js/hdui_frames.js";
const rom = "rom/mario_tennis.gbc";
if (!fs.existsSync(rom)) { console.log("skip: no ROM"); process.exit(0); }
const bytes = new Uint8Array(fs.readFileSync(rom));
function at(file, frame) {
  const raw = fs.readFileSync(file), rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
  const gb = new GBC(bytes, { sampleRate: 44100, audio: false }); loadState(gb, rec.start);
  const inp = Uint8Array.from(Buffer.from(rec.inputs, "base64")); for (let f = 0; f < frame; f++) { gb.setInput(stateOf(inp[f] || 0)); gb.runFrame(); }
  const scr = new Screen(gb); scr.scan(); return scr;
}
const cases = [   // [recording, frame, expected panels (bg + win)]
  ["out/port/cs_singles.mtrec", 1500, 4], ["out/port/xr_results.mtrec", 1100, 2],   // 2 panels: the stadium scoreboard in the backdrop is NOT one
  ["out/port/cd_status.mtrec", 1950, 3],
  ["out/port/brief_03.mtrec", 220, 2],      // the briefing panel with the court diagram: no band inside it
  ["out/port/story_walk1.mtrec", 2136, 1], ["out/engine/rec2.mtrec", 9000, 0],
];
let bad = 0;
for (const [f, fr, want] of cases) {
  if (!fs.existsSync(f)) { console.log("skip", f); continue; }
  const scr = at(f, fr), n = findPanels(scr, "bg").length + findPanels(scr, "win").length;
  console.log(n === want ? "ok  " : "FAIL", f, fr, "panels", n, "expected", want); if (n !== want) bad++;
}
process.exit(bad ? 1 : 0);
