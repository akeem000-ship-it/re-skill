// web/play.html (the native rewrite, no emulated CPU) in headless Chromium: the page loads the ROM from rom/ through
// a small static server this test starts, starts its Stroke round, and the test plays a few shots with keys:
// at each aiming menu it turns the aim a little, presses A to address the ball, A at full power and A for the
// impact, timed by the page's frame counter (window.__golf). Fails on page errors, a stopped round, or fewer
// shots than asked. Screenshots go to out/ (aiming, address, mid-swing, flight, after each shot).
// With --match the page's mode selector picks match play against Luigi (the computer plays its own turns; the test
// plays the human's).
// usage: node web/tests/play_page.mjs [shots=3] [outdir=out] [--match]
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const match = process.argv.includes("--match");
const [shotsArg = "3", outDir = path.join(root, "out")] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const want = +shotsArg;
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".gbc": "application/octet-stream" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://localhost:${port}/web/play.html`);
await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 30000 });
if (match) {
  await page.selectOption("#mode", "match:9");
  await page.waitForFunction(() => window.__golf && window.__golf.w.wram[0][0x834] === 2 && window.__golf.frames > 0, null, { timeout: 30000 });
}

const state = () => page.evaluate(() => { const g = window.__golf;
  return { frames: g.frames, mark: g.mark, shots: g.shots.length, error: g.error, done: !!g.done, hole: g.w.wram[0][0x837] }; });
const frames = () => page.evaluate(() => window.__golf.frames);
const untilFrames = async n => page.waitForFunction(n => window.__golf.frames >= n || window.__golf.error, n, { timeout: 60000 });
const until = async (fn, arg, ms = 120000) => page.waitForFunction(fn, arg, { timeout: ms });
const press = async (key, n = 3) => {                // held for n frames
  await page.keyboard.down(key);
  await untilFrames((await frames()) + n);
  await page.keyboard.up(key);
};
let shotN = 0;
const shot = async name => page.locator("#screen").screenshot({ path: path.join(outDir, `play_${String(shotN++).padStart(2, "0")}_${name}.png`) });

const log = [];
try {
  for (let k = 0; k < want; k++) {
    await until(() => (window.__golf.mark === "aimmenu" && !window.__golf.w.wram[0][0x835]) || window.__golf.error, null, 600000);
    await untilFrames((await frames()) + 40);     // the menu's HUD frames
    await shot(`shot${k + 1}_aim`);
    await press(k % 2 ? "ArrowLeft" : "ArrowRight", 6);
    await press("KeyZ");                           // to the address step
    await until(() => window.__golf.mark === "address" || window.__golf.error);
    await untilFrames((await frames()) + 20);
    await shot(`shot${k + 1}_address`);
    const f0 = await frames();
    await press("KeyZ", 2);                        // the swing starts
    await untilFrames(f0 + 58);                    // the cursor near full power
    await press("KeyZ", 2);
    await untilFrames(f0 + 80);
    await shot(`shot${k + 1}_swing`);
    await untilFrames(f0 + 110);                   // back down to the impact zone
    await press("KeyZ", 2);
    await untilFrames(f0 + 220);
    await shot(`shot${k + 1}_flight`);
    await until(n => window.__golf.shots.length > n || window.__golf.error, k);
    const s = await state();
    log.push(`shot ${k + 1}: outcome $${(await page.evaluate(() => window.__golf.shots.at(-1))).toString(16)} at frame ${s.frames}, hole ${s.hole}`);
    await untilFrames(s.frames + 60);
    await shot(`shot${k + 1}_after`);
  }
} catch (e) {
  errors.push("script: " + e.message.split("\n")[0]);
}
const s = await state();
await page.screenshot({ path: path.join(outDir, "play_page.png") });
console.log(log.join("\n"));
console.log(JSON.stringify({ frames: s.frames, shots: s.shots, mark: s.mark, error: s.error, status: await page.locator("#status").textContent(), errors: errors.slice(0, 5) }));
await browser.close();
server.close();
const ok = !errors.length && !s.error && s.shots >= want;
console.log(ok ? `ok   play page: ${s.shots} shots, ${s.frames} frames, no page errors` : "FAIL play page");
process.exit(ok ? 0 : 1);
