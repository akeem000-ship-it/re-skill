// shoot.mjs: replay a recording (.mtrec) in the real page in headless Chromium and save screenshots, to see a change working
// in the game. The page runs on a virtual clock (1/60 s per game frame), so effects that move with real time (wind, the
// intro) run at game speed; the walk-out intro's hold is kept (the clock runs, the game does not).
//
// usage: node web/tests/shoot.mjs SPEC.json
//   SPEC: { "rec": "out/x.mtrec", "q": "ground=carpet", "out": "out/shots/x", "hud": false,
//           "segs": [{ "a": 3000, "b": 3300, "step": 2, "shots": 0, "pre": "JS", "each": "JS", "report": "JS" }] }
//   a / b: game frames to shoot between; step: game frames between shots (default 2); shots: at most this many;
//   pre: JS run in the page once before the segment; each: before every shot; report: JS whose result is printed after.
//   One shot of frame F: { "a": F, "b": F + 1, "step": 1 }.
// Needs: the ROM in rom/, `python3 -m http.server 8765` running in this folder (PORT=... for another port), and
// Playwright's Chromium (CHROMIUM=/path/to/chrome to use another one). Page errors are printed as "pageerror ...":
// a run that prints one has not shown the change working.
import fs from "fs"; import zlib from "zlib"; import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), raw = fs.readFileSync(spec.rec), rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
const PORT = process.env.PORT || 8765;
fs.mkdirSync(spec.out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, userAgent: "Android MarioTennisWrapper" })).newPage();
page.on("pageerror", e => console.log("pageerror", e.message));
await page.addInitScript(l => { const real = performance.now.bind(performance); window.__vclock = { on: false, t: 0 }; performance.now = () => window.__vclock.on ? window.__vclock.t : real(); try { localStorage.setItem("mt-look", JSON.stringify(l)); } catch (e) { /* no storage */ } }, rec.meta.look);
const m = rec.meta;
await page.goto(`http://localhost:${PORT}/web/full.html?port=${encodeURIComponent(m.port)}${m.physics ? "&physics=" + m.physics : ""}&net=${m.net || "original"}&${spec.q || "intro=off"}`);
if (!spec.hud) await page.addStyleTag({ content: "#pad, #stickzone, #deck, #hud { display: none !important; }" });   // (the touch controls and the menu bar)
await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.port && document.getElementById("loader").hidden, null, { timeout: 120000 });
await page.evaluate(async rec => {
  const { stateOf } = await import("/web/js/recorder.js"), G = window.__gb; G.pause(); G.view3d(false);
  // a fresh port: the page's has been running since it loaded (its coroutine and counters are mid-boot)
  Object.assign(G.port, { co: null, frames: 0, vblanks: 0, offDots: 0, advances: 0, offBeat: -9, lastRet: false, inHandler: 0, cpuHandlers: [], suppressVBlanks: 0, workVBlanks: 0, events: [] });
  G.loadState(rec.start);
  const inputs = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
  window.__rp = { f: 0, run(n, vox) { for (let k = 0; k < n; k++) { G.gb.setInput(stateOf(inputs[this.f])); G.port.frame(); this.f++; window.__vclock.t += 1000 / 60; if (vox && G.voxel && G.voxel.mode === "3d") G.voxel.tick(); } } };
  window.__vclock.on = true;
}, rec);
let n = 0, in3d = false;
for (const s of spec.segs) {
  const step = s.step || 2, cur = await page.evaluate(() => window.__rp.f);
  for (let g = cur; g < s.a - 120; g += 600) await page.evaluate(([k, v]) => window.__rp.run(k, v), [Math.min(600, s.a - 120 - g), in3d]);
  if (!in3d) { await page.evaluate(() => window.__gb.view3d(true)); in3d = true; }
  await page.evaluate(k => window.__rp.run(k, true), Math.max(0, s.a - (await page.evaluate(() => window.__rp.f))));
  if (s.pre) await page.evaluate(e => (0, eval)(e), s.pre);
  let f = s.a, shots = 0; const max = s.shots || 1e9;
  while (f < s.b && shots < max) {
    const held = await page.evaluate(([st, each]) => {
      if (each) (0, eval)(each);
      const I = window.__gb.voxel.intro, hold = I && I.holding;
      if (hold) window.__vclock.t += 1000 * st / 60; else window.__rp.run(st, true);
      window.__gb.step(0); return hold;
    }, [step, s.each || ""]);
    if (!held) f += step;
    await page.screenshot({ path: `${spec.out}/${String(n++).padStart(5, "0")}_f${f}.png` }); shots++;
  }
  if (s.report) console.log("report", await page.evaluate(e => (0, eval)(e), s.report));
  console.log("seg", s.a, s.b, "shots", n);
}
await browser.close();
