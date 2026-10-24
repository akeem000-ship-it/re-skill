// Resume a snapshot, play a key script (CODE@FROM-TO held), log window usage per frame and screenshot the 2D
// and 3D views at given frames. usage: node web/tests/snap_walk.mjs SNAP.json OUTPREFIX --keys K@A-B,... --shots F1,F2 [--frames N] [--vox] [--size WxH]
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const snap = JSON.parse(fs.readFileSync(a[0])), out = a[1], [W, H] = opt("--size", "900x860").split("x").map(Number);
const keys = opt("--keys", "") ? opt("--keys", "").split(",").map(k => { const [code, r] = k.split("@"); const [f0, f1] = r.split("-").map(Number); return [code, f0, f1 ?? f0 + 6]; }) : [];
const shots = opt("--shots", "").split(",").filter(Boolean).map(Number), N = +opt("--frames", Math.max(0, ...shots) + 1);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(`http://localhost:8765/web/full.html?touch&cam=low&aspect=${opt("--aspect", "fill")}`);
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
await page.evaluate(s => { const G = window.__gb; G.pause(); G.view3d(false); G.loadSnapshot(s); window.__f = 0; }, snap);
let f = 0;
for (const target of [...shots, N]) {
  const log = await page.evaluate(([to, keys]) => {
    const G = window.__gb, out = [];
    for (; window.__f < to; window.__f++) {
      const f = window.__f;
      for (const [code, f0, f1] of keys) { if (f === f0) G.keys[code] = true; if (f === f1) G.keys[code] = false; }
      G.step(1);
      const p = G.gb.ppu; let n = 0, first = -1, x0 = 255; for (let y = 0; y < 144; y++) if (p.winX[y] !== 255) { n++; if (first < 0) first = y; x0 = Math.min(x0, p.winX[y]); }
      if (f % 20 === 0 || (n && !window.__lastN) || (!n && window.__lastN)) out.push(`${f} map ${G.gb.mem.wram[0][0x32E]} win ${n} rows from ${first} x ${x0} lcdc ${p.lcdc.toString(16)} wy ${p.wy} wx ${p.wx} lyc ${p.lyc}`);
      window.__lastN = n;
    }
    return out;
  }, [target, keys]);
  console.log(log.join("\n"));
  if (shots.includes(target)) {
    await page.evaluate(vox => { window.__gb.view3d(true, vox); window.__gb.step(0); }, a.includes("--vox"));
    await page.locator("#gl").screenshot({ path: `${out}_${target}_3d.png` });
    await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(0); });
    await page.locator("#screen").screenshot({ path: `${out}_${target}_2d.png` });
  }
}
await browser.close();
