// BALL FX (web/js/ballfx.js): the effects only read the game. Plays a rally of out/engine/rec1.mtrec twice in the VOX court (effects on, then
// off) and checks that the game state is identical (frame hash and a checksum of work RAM, VRAM and OAM), that the effects saw the hits,
// bounces and net events the game reported, that drawing costs well under a millisecond (software GL here, so the limit is loose), that
// the BALL FX button toggles and is remembered, and that the page logged no errors.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/ballfx.mjs
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const readRec = f => { const raw = fs.readFileSync(f); return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString()); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
const rec = readRec("out/engine/rec1.mtrec");
async function run(fxOn, F0, F1, extra = "") {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 }); const errors = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:8765/web/full.html?vox&smooth=0&ballfx=${fxOn ? 1 : 0}${extra}`);
  await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.voxel, null, { timeout: 60000, polling: 200 });
  await page.waitForTimeout(800);
  const out = await page.evaluate(async ([rec, F0, F1]) => {
    const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb, V = G.voxel, fx = V.ballfx; G.pause(true); G.loadState(rec.start);
    const inp = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0)), n = { hit: 0, bounce: 0, net: 0 };
    if (fx) { for (const [k, key] of [["spawnHit", "hit"], ["spawnBounce", "bounce"], ["spawnNet", "net"]]) { const o = fx[k].bind(fx); fx[k] = (...a) => { n[key]++; return o(...a); }; } }
    let ms = 0, draws = 0, maxQuads = 0;
    for (let f = 0; f < F1; f++) {
      G.gb.setInput(stateOf(inp[f] || 0)); G.gb.runFrame(); V.tick();
      if (f >= F0) { V.render(null, 1); if (fx && fx.on) { ms += fx.stats.ms; draws++; maxQuads = Math.max(maxQuads, fx.stats.quads); } }
    }
    const m = G.gb.mem; let h = 0; const mix = a => { for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + a[i]) | 0; };
    for (const b of m.wram) mix(b); for (const b of m.vram) mix(b); mix(m.oam);
    return { hash: G.frameHash(), ram: h, n, ms: draws ? ms / draws : 0, maxQuads, on: fx ? fx.on : null };
  }, [rec, F0, F1]);
  const btn = await page.evaluate(() => { const b = document.getElementById("ballfxbtn"); return b ? b.textContent : null; });
  let stored = null;
  if (fxOn) { await page.evaluate(() => document.getElementById("ballfxbtn").dispatchEvent(new PointerEvent("pointerdown"))); stored = await page.evaluate(() => [localStorage.getItem("mt-ballfx"), window.__gb.voxel.ballfx.on, document.getElementById("ballfxbtn").textContent]); }
  await page.close(); return { ...out, btn, stored, errors };
}
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
const A = await run(true, 5690, 5860), B = await run(false, 5690, 5860);
check("game state identical with effects on and off", A.hash === B.hash && A.ram === B.ram, `${A.hash} ${A.ram} / ${B.hash} ${B.ram}`);
check("effects saw hits, bounces and net crossings", A.n.hit >= 2 && A.n.bounce >= 2 && A.n.net >= 1, JSON.stringify(A.n));
check("drawing is cheap", A.ms < 1.5 && A.maxQuads > 10, `${A.ms.toFixed(2)} ms mean, up to ${A.maxQuads} quads (software GL)`);
check("button shows the state", A.btn === "BALL FX: on" && B.btn === "BALL FX: off", `${A.btn} / ${B.btn}`);
check("button toggles and is remembered", A.stored && A.stored[0] === "off" && A.stored[1] === false && A.stored[2] === "BALL FX: off", JSON.stringify(A.stored));
check("no page errors", !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].slice(0, 3).join(" | "));
// the net: a real net hit (rec1 frame 7394) rocks the net
const N = await run(true, 7380, 7420);
check("net hit seen", N.n.net >= 1, JSON.stringify(N.n));
await browser.close(); process.exit(bad ? 1 : 0);
