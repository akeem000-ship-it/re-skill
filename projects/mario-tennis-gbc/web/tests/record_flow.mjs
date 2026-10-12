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
let n = 0, phase = "front", inMatch = 0;
const save = shots => { for (const s of shots) fs.writeFileSync(`${out}/f${String(n++).padStart(6, "0")}.png`, Buffer.from(s.split(",")[1], "base64")); };
while (inMatch < matchFrames) {
  const r = await page.evaluate(([titleWait]) => {
    const mt = window.__mt, shots = [];
    let matchNow = 0;
    for (let f = 0; f < 60; f++) {
      const fr = mt.front;
      // press Start once the title has been up for titleWait frames
      mt.keys.Enter = !!(fr && fr.step === 10 && fr.t === titleWait);
      mt.step();
      if (!mt.front && mt.match && !mt.match.players[0].cpu) mt.match.players[0].cpu = true;
      if (!mt.front) matchNow++;
      shots.push(document.getElementById("screen").toDataURL("image/png"));
    }
    return { shots, matchNow };
  }, [titleWait]);
  save(r.shots); inMatch += r.matchNow;
}
console.log(n, "frames ->", out);
await browser.close();
