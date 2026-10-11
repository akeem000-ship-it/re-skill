// Record a CPU-vs-CPU match from the web port to PNG frames (then: ffmpeg -> mp4).
// usage: node web/tests/record_match.mjs OUTDIR [--url http://localhost:8765/web/index.html]
//        [--games 2] [--diff 2] [--p1 23] [--p2 25] [--court 2] [--every 2] [--max 20000]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");   // global install (NODE_PATH)
import fs from "fs";
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0], url = opt("--url", "http://localhost:8765/web/index.html");
const every = +opt("--every", 2), max = +opt("--max", 20000);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__mt && window.__mt.match, null, { timeout: 30000 });
await page.evaluate(([g, d, p1, p2, c]) => {
  const $ = id => document.getElementById(id);
  $("games").value = g; $("diff").value = d; $("p1").value = p1; $("p2").value = p2; $("court").value = c;
  window.__mt.pause(); window.__mt.start(); window.__mt.match.players[0].cpu = true;
}, [opt("--games", "2"), opt("--diff", "2"), opt("--p1", "23"), opt("--p2", "25"), opt("--court", "2")]);
let n = 0, frame = 0, done = false;
while (!done && frame < max) {
  const r = await page.evaluate(([every, k]) => {
    const shots = []; let f = 0;
    for (; f < 120; f++) {
      window.__mt.step();
      if (f % every === 0) shots.push(document.getElementById("screen").toDataURL("image/png"));
      if (window.__mt.match.over) { if (f % every) shots.push(document.getElementById("screen").toDataURL("image/png")); break; }
    }
    const m = window.__mt.match;
    return { shots, f, over: m.over, games: m.games, winner: m.winner };
  }, [every, frame]);
  for (const s of r.shots) fs.writeFileSync(`${out}/f${String(n++).padStart(6, "0")}.png`, Buffer.from(s.split(",")[1], "base64"));
  frame += r.f;
  if (r.over) {   // hold the final screen for 3 s
    for (let i = 0; i < 90; i++) fs.copyFileSync(`${out}/f${String(n - 1).padStart(6, "0")}.png`, `${out}/f${String(n++).padStart(6, "0")}.png`);
    console.log("match over after", frame, "frames; games", r.games, "winner P" + (r.winner + 1)); done = true;
  }
}
if (!done) console.log("stopped at", frame, "frames");
console.log(n, "images in", out);
await browser.close();
