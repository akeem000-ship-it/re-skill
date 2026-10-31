// The game picker's demo rallies (web/js/picker.js): machine states at the start of a match, taken from the session recordings in
// out/ played on the ROM core, in which both sides are then left to the game's own CPU (every on-court character's wInputSource set
// to 1, the CPU), so a match plays itself. A start is kept when the CPUs then rally (at least 6 hits in 40 s of play without leaving
// the court), one for each court, character line-up and singles / doubles. Written to web/gen/demos.json.gz (gitignored: a machine
// state holds data from the ROM): [{ id, court, mode, doubles, chars, state }].
// usage: node web/tests/make_demos.mjs [--max N] [--frames F] [--dirs a,b] [--out FILE]   (N demos at most, default 24; F frames of each
// recording at most; the folders of recordings, default out,out/engine,out/port; the file written, default web/gen/demos.json.gz)
import fs from "fs"; import zlib from "zlib"; import path from "path";
import { readRecording, newCore } from "./engine/corpus.mjs";
import { loadState, saveState } from "../js/gb/state.js";
import { stateOf } from "../js/recorder.js";
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? +a[a.indexOf(n) + 1] : d);
const MAX = opt("--max", 24), FRAMES = opt("--frames", 30000), sopt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const DIRS = sopt("--dirs", "out,out/engine,out/port").split(","), OUT = sopt("--out", "web/gen/demos.json.gz");
const MATCH_MODES = new Set([1, 2, 3, 4, 10]);                          // wGameMode: ranking, open, practice match, exhibition, dream match
const files = [];
for (const dir of DIRS) for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.endsWith(".mtrec")) files.push(path.join(dir, f));
const gb = await newCore({ recomp: true }), w = gb.mem.wram;
const chars = () => { const n = w[0][0x8F3] >= 4 ? 4 : 2; return Array.from({ length: n }, (_, k) => w[0][0xA0B + 0x80 * k] & 0x3F); };   // (the players' records at $CA00, $80 apart)
const seen = new Set(), out = [];
for (const f of files) {
  if (out.length >= MAX) break;
  let rec; try { rec = readRecording(f); } catch (e) { continue; }
  if (rec.format !== "mtrec" || (rec.meta && rec.meta.engine && rec.meta.engine !== "rom")) continue;   // (the ROM core's own sessions)
  const inputs = Buffer.from(rec.inputs, "base64"), end = Math.min(inputs.length, FRAMES);
  try { loadState(gb, rec.start); } catch (e) { continue; }
  let courtAt = -1, got = null;
  for (let n = 0; n < end; n++) {
    gb.setInput(stateOf(inputs[n])); gb.runFrame();
    const map = w[0][0x32E], mode = w[0][0x8A6];
    if (map <= 15 && MATCH_MODES.has(mode)) { if (courtAt < 0) courtAt = n; if (n - courtAt === 30) { got = saveState(gb); break; } } else courtAt = -1;
  }
  if (!got) continue;
  const court = w[0][0x32E], mode = w[0][0x8A6], ch = chars(), doubles = ch.length === 4, key = `${court}:${doubles}:${[...ch].sort().join(",")}`;
  if (seen.has(key)) continue;
  // the test: both sides the CPU from here, 40 s of play; the demo then starts a second before the first serve is hit (the players
  // in their places: at the court's first frames they are still off to one side)
  const cpu = () => { for (const k of [4, 5, 6, 7]) if (w[k][0xF1E] !== 1 && (k < 6 || doubles)) w[k][0xF1E] = 1; gb.setInput(stateOf(0)); gb.runFrame(); };
  let hits = 0, lh = w[0][0x4B6], ok = true, first = -1;
  for (let n = 0; n < 2400; n++) {
    cpu();
    if (w[0][0x32E] > 15) { ok = false; break; }
    const h = w[0][0x4B6]; if (h !== lh) { lh = h; if (h) { hits++; if (first < 0) first = n; } }
  }
  if (ok && first >= 0) { loadState(gb, got); for (let n = 0; n < Math.max(0, first - 60); n++) cpu(); got = saveState(gb); }
  console.log(f, "court", court, "mode", mode, "chars", ch.join(","), "hits", hits, ok && hits >= 6 ? "KEPT" : "-");
  if (!ok || hits < 6) continue;
  seen.add(key); out.push({ id: path.basename(f, ".mtrec"), court, mode, doubles, chars: ch, state: got });
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out)));
console.log(out.length, "demos,", (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
