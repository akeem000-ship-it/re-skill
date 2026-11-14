// Recorder round trip in the page: start recording from a core state, play scripted buttons for N frames (as a player
// would), stop, write the .mtrec through the browser download path; then web/tests/replay.mjs must reproduce it.
// usage: node web/tests/rec_roundtrip.mjs STATE.json.gz OUT.mtrec [FRAMES]
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [sp, outp, nStr] = process.argv.slice(2), N = +(nStr || 1200), st = JSON.parse(zlib.gunzipSync(fs.readFileSync(sp)));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ acceptDownloads: true });
await page.goto("http://localhost:8765/web/full.html?touch");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
await page.evaluate(s => { const G = window.__gb; G.pause(); G.loadState(s); }, st);
await page.dispatchEvent("#rec", "pointerdown");
await page.evaluate(n => { const G = window.__gb, K = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyZ", "KeyX"];
  for (let f = 0; f < n; f++) { if (f % 25 === 0) { for (const k of K) G.keys[k] = false; G.keys[K[(f / 25 * 7) % K.length | 0]] = true; } G.step(1); }
  for (const k of K) G.keys[k] = false; }, N);
const dl = page.waitForEvent("download"); await page.dispatchEvent("#rec", "pointerdown"); const d = await dl;
await d.saveAs(outp); console.log("saved", outp, fs.statSync(outp).size, "bytes");
await browser.close();
