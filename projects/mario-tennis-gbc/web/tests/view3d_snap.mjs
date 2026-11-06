// Resume a PyBoy snapshot in the page's core, play a key script, turn the 3D view on and screenshot it.
// usage: node web/tests/view3d_snap.mjs SNAP.json OUTPREFIX [--keys CODE@FRAME,...] [--frames N] [--cam PRESET] [--vox] [--size WxH]
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const snap = JSON.parse(fs.readFileSync(a[0])), out = a[1] || "out/snap3d", N = +opt("--frames", 600), cam = opt("--cam", "low"), [W, H] = opt("--size", "900x860").split("x").map(Number);
const keys = opt("--keys", "") ? opt("--keys", "").split(",").map(k => { const [code, f] = k.split("@"); return [code, +f]; }) : [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(`http://localhost:8765/web/full.html?touch&cam=${cam}` + (a.includes("--vox") ? "&vox" : ""));
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
const info = await page.evaluate(([s, keys, n, vox]) => {
  const G = window.__gb; G.pause(); G.view3d(false); G.loadSnapshot(s);
  for (let f = 0; f < n; f++) { for (const [code, kf] of keys) { if (f === kf) G.keys[code] = true; if (f === kf + 6) G.keys[code] = false; } G.step(1); }
  G.view3d(true, vox); G.step(1);
  const w = G.gb.mem.wram[0]; return { mode: G.voxel.mode, court: G.voxel.courtId, map: w[0x32E], courtId: w[0x8F4] };
}, [snap, keys, N, a.includes("--vox")]);
console.log(JSON.stringify(info));
await page.locator("#gl").screenshot({ path: `${out}_3d.png` });
await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(1); });
await page.locator("#screen").screenshot({ path: `${out}_2d.png` });
await browser.close();
