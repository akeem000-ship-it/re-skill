// Render core save states (web/tests/tour.mjs checkpoints, .json.gz) in the page: 2D and 3D shots.
// usage: node web/tests/state_view.mjs OUTPREFIX STATE.json.gz [STATE2 ...] [--vox] [--steps N] [--size WxH] [--cam P]
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const flags = new Set(["--vox"]), vals = new Set(["--steps", "--size", "--cam"]);
const pos = a.filter((x, i) => !x.startsWith("--") && !vals.has(a[i - 1]));
const out = pos[0], states = pos.slice(1), [W, H] = opt("--size", "900x860").split("x").map(Number);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if (m.type() === "warning" || (m.type() === "error" && !m.text().includes("404"))) console.log("console", m.text()); });
await page.goto(`http://localhost:8765/web/full.html?touch&cam=${opt("--cam", "low")}`);
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
for (const sp of states) {
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(sp)));
  const name = sp.replace(/.*\//, "").replace(/\.json\.gz$/, "");
  const info = await page.evaluate(([s, vox, n]) => {
    const G = window.__gb; G.pause(); G.view3d(false); G.loadState(s); G.step(n); G.view3d(true, vox); G.voxel.debug = []; G.step(1);
    const w = G.gb.mem.wram[0]; return { mode: G.voxel.mode, map: w[0x32E], court: G.voxel.courtId, debug: G.voxel.debug.slice(0, 3) };
  }, [st, a.includes("--vox"), +opt("--steps", 2)]);
  console.log(name, JSON.stringify(info));
  await page.locator("#gl").screenshot({ path: `${out}_${name}_3d.png` });
  await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(0); });
  await page.locator("#screen").screenshot({ path: `${out}_${name}_2d.png` });
}
await browser.close();
