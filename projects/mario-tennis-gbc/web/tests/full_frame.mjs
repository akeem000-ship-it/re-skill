// Headless check of the full-game page: boots on the core, steps N frames, screenshots at a phone
// viewport and a wide (foldable inner screen) viewport. usage: node web/tests/full_frame.mjs OUTPREFIX [--frames N]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/full", N = +opt("--frames", 400);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
for (const [name, vp] of [["phone", { width: 412, height: 915 }], ["fold", { width: 904, height: 860 }]]) {
  const page = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true });
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto("http://localhost:8765/web/full.html?touch");
  await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 30000 });
  const h = await page.evaluate(n => { window.__gb.pause(); window.__gb.step(n); return window.__gb.frameHash(); }, N);
  console.log(name, "frame", N, "hash", h);
  await page.screenshot({ path: `${out}_${name}.png` });
  await page.close();
}
await browser.close();
