// Record the web port from boot: logos -> intro -> title (press Start) -> VS -> match (CPU vs CPU).
// usage: node web/tests/record_flow.mjs OUTDIR [--url URL] [--match-frames 900] [--title-wait 150]
import { createRequire } from "module";
import fs from "fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0], url = opt("--url", "http://localhost:8765/web/index.html");
const matchFrames = +opt("--match-frames", 900), titleWait = +opt("--title-wait", 150);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__mt && window.__mt.front, null, { timeout: 30000 });
await page.evaluate(() => window.__mt.pause());
// key presses relative to the first menu frame: main -> play -> P1 (Luigi) -> P2 (right: Baby Mario)
// -> difficulty (right x2: Hard) -> court (down: grass)
const SCRIPT = [[60, "KeyZ"], [150, "KeyZ"], [240, "KeyZ"], [300, "ArrowRight"], [360, "KeyZ"], [420, "ArrowRight"], [450, "ArrowRight"], [510, "KeyZ"], [570, "ArrowDown"], [630, "KeyZ"]];
let n = 0, phase = "front", inMatch = 0;
const save = shots => { for (const s of shots) fs.writeFileSync(`${out}/f${String(n++).padStart(6, "0")}.png`, Buffer.from(s.split(",")[1], "base64")); };
while (inMatch < matchFrames) {
  const r = await page.evaluate(([titleWait, SCRIPT]) => {
    const mt = window.__mt, shots = [];
    let matchNow = 0;
    window.__menuFrame = window.__menuFrame || 0;
    for (let f = 0; f < 60; f++) {
      const fr = mt.front;
      // press Start once the title has been up for titleWait frames; then drive the menus by the script
      for (const c of ["Enter", "KeyZ", "ArrowRight", "ArrowDown"]) mt.keys[c] = false;
      mt.keys.Enter = !!(fr && fr.step === 10 && fr.t === titleWait);
      if (mt.menus) { const hit = SCRIPT.find(s => s[0] === window.__menuFrame); if (hit) mt.keys[hit[1]] = true; window.__menuFrame++; }
      mt.step();
      if (!mt.front && mt.match && !mt.match.players[0].cpu) mt.match.players[0].cpu = true;
      if (!mt.front && !mt.menus) matchNow++;
      shots.push(document.getElementById("screen").toDataURL("image/png"));
    }
    return { shots, matchNow };
  }, [titleWait, SCRIPT]);
  save(r.shots); inMatch += r.matchNow;
}
console.log(n, "frames ->", out);
await browser.close();
