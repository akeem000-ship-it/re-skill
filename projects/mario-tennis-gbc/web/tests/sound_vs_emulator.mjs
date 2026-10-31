// The sequencer's note stream for a song must contain the live stream logged by tools/emu_seq_trace.py
// (states/seq_title.txt = song $02 from the title screen) as a contiguous per-channel subsequence
// with the same note/duration/volume triples and the same tick spacing.
import fs from "fs";
import { fileURLToPath } from "url";
import { Sequencer } from "../js/sound.js";
const root = new URL("../../", import.meta.url);
const rom = new Uint8Array(fs.readFileSync(fileURLToPath(new URL("rom/mario_tennis.gbc", root))));
const [file, idHex] = process.argv.slice(2);
const live = fs.readFileSync(file, "utf8").trim().split("\n").map(l => {
  const m = l.match(/f\s*(\d+) ch(\d) hw(\d) note (\w+) dur\s+(\d+) vol (\w)/);
  return { t: +m[1], slot: +m[2], hw: +m[3], note: parseInt(m[4], 16), dur: +m[5], vol: parseInt(m[6], 16) };
});
// the game switches songs when one ends (title: $02 then the attract intro $01): cut the log there
const cut = live.findIndex((e, i) => i && e.slot === live[i - 1].slot && e.note !== 0x1F && false);
let end = live.length;
for (const slot of [2, 3, 4, 5]) { const L = live.filter(e => e.slot === slot); for (let i = 1; i < L.length; i++) if (L[i].t > L[i - 1].t + 150) { end = Math.min(end, live.indexOf(L[i])); break; } }
live.length = end;
const seq = new Sequencer(rom); seq.start(parseInt(idHex, 16));
for (let t = 0; t < 6000; t++) seq.step();
let fails = 0;
for (const slot of [2, 3, 4, 5]) {
  const L = live.filter(e => e.slot === slot), M = seq.events.filter(e => e.slot === slot);
  if (!L.length) continue;
  const key = e => `${e.note.toString(16)}:${e.dur}:${e.vol.toString(16)}`;
  let best = null;
  for (let i = 0; i + L.length <= M.length; i++) {
    let ok = 0;
    for (let j = 0; j < L.length; j++) {
      if (key(M[i + j]) !== key(L[j])) break;
      if (j && (M[i + j].t - M[i + j - 1].t) !== (L[j].t - L[j - 1].t)) break;
      ok++;
    }
    if (!best || ok > best.ok) best = { i, ok };
  }
  // the model stops at the song's end ($FF) while the live log may span a restart: require a long exact run
  if (!best) best = { i: -1, ok: 0 };
  for (let i = 0; i < M.length && best.ok < L.length; i++) {      // also try runs that reach the model's end
    let ok = 0;
    for (let j = 0; j < L.length && i + j < M.length; j++) {
      if (key(M[i + j]) !== key(L[j])) break;
      if (j && (M[i + j].t - M[i + j - 1].t) !== (L[j].t - L[j - 1].t)) break;
      ok++;
    }
    if (ok > best.ok) best = { i, ok };
  }
  const good = best.ok === L.length;
  if (!good) fails++;
  console.log(good ? "ok  " : "FAIL", `slot ${slot} (hw ${L[0].hw}): ${best.ok}/${L.length} live notes matched in a row from model event ${best.i}`);
}
process.exit(fails ? 1 : 0);
