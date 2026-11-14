// Analog-stick check: resumes an overworld snapshot in touch mode, drags the virtual stick in eight directions
// and reports the keys it sets and how far the field scroll / player moved. usage: node web/tests/stick_walk.mjs SNAP.json [OUT.png]
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [snapPath, shot] = process.argv.slice(2), snap = JSON.parse(fs.readFileSync(snapPath));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto("http://localhost:8765/web/full.html?touch&pad=stick");
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
await page.waitForFunction(() => document.getElementById("loader").hidden, null, { timeout: 60000 });
await page.evaluate(s => { const G = window.__gb; G.pause(); G.loadSnapshot(s); G.step(60); }, snap);   // let the opening line pass
for (let i = 0; i < +(process.env.SKIP || 4); i++) await page.evaluate(() => { const G = window.__gb; G.keys.KeyZ = true; G.step(4); G.keys.KeyZ = false; G.step(40); });
const cx = 110, cy = 760, R = 50;
const pos = () => page.evaluate(() => { const w = window.__gb.gb.mem.wram[0]; return { x: w[0x321] * 8 + (w[0x320] >> 5), y: w[0x323] * 8 + (w[0x322] >> 5) }; });
for (const [name, ang] of [["right", 0], ["down-right", 45], ["down", 90], ["left", 180], ["up", 270], ["up-left", 225]]) {
  const p0 = await pos();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + R * Math.cos(ang * Math.PI / 180), cy + R * Math.sin(ang * Math.PI / 180), { steps: 4 });
  const k = await page.evaluate(() => { const G = window.__gb, k = G.keys; const o = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].filter(c => k[c]).join("+"); G.step(40); return o; });
  if (shot && name === "up-left") await page.screenshot({ path: shot });
  await page.mouse.up();
  const after = await page.evaluate(() => { const G = window.__gb, k = G.keys; return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].filter(c => k[c]).join("+") || "none"; });
  const p1 = await pos();
  console.log(`${name.padEnd(10)} keys ${k.padEnd(20)} scroll moved ${p1.x - p0.x},${p1.y - p0.y}  after release: ${after}`);
}
await browser.close();
