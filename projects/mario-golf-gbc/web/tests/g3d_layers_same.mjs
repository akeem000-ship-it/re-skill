// The 3D layers (web/js/g3d) are render only: the game must run identically with them on. This test plays the same scripted game on
// web/play.html twice in headless Chromium (WebGL through SwiftShader), once with every 3D layer off (?g3d=none: the 2D picture) and
// once with every layer on (?g3d=all), and compares a hash of the game's whole state after every frame: the WRAM banks, HRAM, the
// save RAM and the display model (VRAM, OAM, both palette RAMs, the LCD registers). The script: a fixed random seed (the page's
// crypto.getRandomValues for the round's seed), A pressed every 20 frames in menus, the swing pressed by the meter's count; the keys
// go in through the page's own key events in the frame hook (window.__golf.onFrame), so both runs see the same buttons on the same
// frames. Scenarios: "stroke" (a Stroke round started from the selector: the tee shots, flights, approaches, the green, putts,
// the next hole), "title" (power-on: the opening, the title, the menus, into a round) and "story" (power-on with a saved character,
// out/kid.sav or --save F: into the story mode's clubhouse, the 3D overworld).
// usage: node web/tests/g3d_layers_same.mjs [frames=2400] [--scenario stroke|title|story|both|all] [--quality full|lite] [--shots outdir]
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const frames = +(args.find((a, i) => !a.startsWith("--") && !(i && args[i - 1].startsWith("--"))) || 2400);
const scenarios = opt("scenario", "both") === "both" ? ["stroke", "title"] : opt("scenario") === "all" ? ["stroke", "title", "story"] : [opt("scenario")];
const saveFile = path.join(root, opt("save", "out/kid.sav"));
const quality = opt("quality", "full"), shotDir = opt("shots", null);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function run(scenario, query) {
  const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); if (/3D view stopped/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.clear();
    const orig = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = a => { if (a instanceof Uint16Array && a.length === 1) { a[0] = 0x2F6B; return a; } return orig(a); };
  });
  if (scenario === "story") await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ["mg-sram-7f2062e51b4f", fs.readFileSync(saveFile).toString("base64")]);
  await page.goto(`http://localhost:${port}/web/play.html?${query}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 60000 });
  if (scenario === "stroke") {
    await page.selectOption("#mode", "stroke");
    await page.waitForFunction(() => window.__golf && window.__golf.mark !== "menus", null, { timeout: 60000 });
  }
  // the script and the per-frame hash (FNV-1a over the state), installed before the next frame runs
  await page.evaluate(n => {
    const g = window.__golf, w = g.w; let k = 0, down = 0;
    g.hashes = [];
    const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
    const hashState = () => {
      let h = 0x811C9DC5;
      const mix = a => { for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); };
      for (const b of w.wram) mix(b); mix(w.high); mix(w.sram); mix(w.vram[0]); mix(w.vram[1]); mix(w.oam); mix(w.bgPal); mix(w.objPal);
      const l = w.lcd; mix([l.lcdc, l.scx, l.scy, l.wx, l.wy, l.vbk, l.bcps, l.ocps]);
      return h >>> 0;
    };
    g.onFrame = () => {
      if (g.frames > 0) g.hashes[g.frames - 1] = hashState();   // the state after the previous frame (by frame number)
      k = g.frames; const m = w.wram[6][0x44E];
      let a;
      if (m) a = w.wram[6][0x329] === 0x0D ? (m === 0x14 || m === 0x15) : (m === 0x38 || m === 0x39 || m === 0x76 || m === 0x77);
      else a = k % 20 === 0;
      if (a !== down) { key("KeyZ", a); down = a; }
      if (g.frames >= n) { g.done = { holes: [] }; }
    };
  }, frames);
  await page.waitForFunction(n => window.__golf.hashes.length >= n || window.__golf.error, frames, { timeout: 1800000, polling: 500 });
  const res = await page.evaluate(() => ({ hashes: window.__golf.hashes, error: window.__golf.error, mark: window.__golf.mark, hole: window.__golf.w.wram[0][0x837],
    g3d: window.__g3d ? { failed: window.__g3d.failed, drawn: window.__g3d.stats.drawn, fps: window.__g3d.stats.fps } : null }));
  if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, `same_${scenario}_${query.replace(/[^a-z0-9]/gi, "_")}.png`) }); }
  await page.close();
  return { ...res, errors };
}

let ok = true;
for (const sc of scenarios) {
  const off = await run(sc, "g3d=none");
  const on = await run(sc, `g3d=all&g3dq=${quality}`);
  const n = Math.min(off.hashes.length, on.hashes.length);
  let first = -1, from = 0; while (from < n && (off.hashes[from] == null || on.hashes[from] == null)) from++;
  for (let i = from; i < n; i++) if (off.hashes[i] !== on.hashes[i]) { first = i; break; }
  const good = first < 0 && from < 30 && n >= frames - 2 && !off.error && !on.error && !on.errors.length && !off.errors.length && on.g3d && !on.g3d.failed && on.g3d.drawn > 0;
  ok = ok && good;
  console.log(`${good ? "ok  " : "FAIL"} ${sc}: ${n - from} frames compared (from frame ${from + 1}), ${first < 0 ? "every frame's state the same" : "first difference after frame " + (first + 1)}; ` +
    `3D drew ${on.g3d ? on.g3d.drawn : 0} pictures${on.g3d && on.g3d.failed ? " (failed: " + on.g3d.failed + ")" : ""}; end: ${on.mark}, hole ${on.hole}` +
    `${off.error || on.error ? "; game error " + (off.error || on.error) : ""}${on.errors.length || off.errors.length ? "; page errors: " + [...on.errors, ...off.errors].slice(0, 3).join(" | ") : ""}`);
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
