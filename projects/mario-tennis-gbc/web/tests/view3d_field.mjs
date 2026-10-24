// Headless check of the overworld diorama: resumes a PyBoy field snapshot (tools/emu_dump_snapshot.py)
// in the page's core, turns the 3D view on and screenshots it. usage: node web/tests/view3d_field.mjs SNAP.json OUT.png
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [snapPath, out] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(snapPath));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 640, height: 576 } });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto("http://localhost:8765/web/full.html");
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
const info = await page.evaluate(s => { const G = window.__gb; G.pause(); G.loadSnapshot(s); G.step(30); G.view3d(true); G.step(1); const v = G.voxel; return { mode: v.mode, map: v.mapId(), walls: v.field.wallCount, scroll: v.fieldScroll(), scx: G.gb.ppu.scx, scy: G.gb.ppu.scy }; }, snap);
console.log(JSON.stringify(info));
await page.locator("#gl").screenshot({ path: out });
await browser.close();
