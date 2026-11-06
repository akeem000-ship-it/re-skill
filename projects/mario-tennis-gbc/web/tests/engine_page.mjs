// The web port (index.html) on the exact engine: start an exhibition match, play N frames with a scripted pad,
// screenshot every K frames, print the score. usage: node web/tests/engine_page.mjs OUTDIR [--frames N] [--every K]
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0], frames = +opt("--frames", 3000), every = +opt("--every", 300);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("console", m.text()); });
await page.goto("http://localhost:8765/web/index.html");
await page.waitForFunction(() => window.__mt && document.getElementById("loader").hidden, null, { timeout: 60000 });
await page.evaluate(() => { const T = window.__mt; T.pause(); T.start({ p1: 23, p2: 25, court: 2, games: 2, sets: 1, difficulty: 1 }); });
const A = 1, B = 2, R = 16, L = 32, U = 64, D = 128;
for (let f = 0; f < frames; f += every) {
  const info = await page.evaluate(([f0, n]) => {
    const T = window.__mt;
    for (let f = f0; f < f0 + n; f++) {
      const L = 32, R = 16, U = 64, D = 128, leg = [L, R, U | L, D | R, 0, R, L | D, U][Math.floor(f / 90) % 8], btn = f % 37 < 3 ? 1 : f % 53 < 3 ? 2 : 0;
      T.step(leg | btn);
      if (T.match.over) break;
    }
    const m = T.match; return { score: m.score, over: m.over, players: m.players.map(p => [p.x, p.depth, p.frame]) };
  }, [f, every]);
  await page.locator("#screen").screenshot({ path: `${out}/f${String(f + every).padStart(5, "0")}.png` });
  console.log(f + every, JSON.stringify(info.score.points), JSON.stringify(info.score.games), info.over ? "OVER" : "", JSON.stringify(info.players));
  if (info.over) break;
}
await browser.close();
