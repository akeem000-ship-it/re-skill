// The 3D view's putting options (Putting: Green camera / Follow, Green: Clean / Arrows; g3d/camera3d.js, groundshader.js and the
// break lines of hd/aimpower.js) on web/play.html in headless Chromium (WebGL through SwiftShader). A scripted player (key events,
// as aim_power.mjs) plays Stroke shots to a putt on the green (the approach shots' power presses, the impact at $78; on the green the
// putter) with a fixed seed, so the same plan reaches the same putt as web/tests/putt_lines.mjs in Node; the game is then held there
// (window.__golf.done) while the 3D view and the helpers keep drawing the last frame.
//   node web/tests/putting_view.mjs              the check: on several putts (1) the pictures keep coming (requestAnimationFrame keeps
//                                                firing and the 3D view keeps presenting; held 8 s at the full resolution: at least 15
//                                                animation frames a second) in the course view at the approach and in the putting
//                                                view, with every option; (2) the putting view shows (scene.puttView) and the
//                                                page's four lines are the game's own (each line's end and roll = runPreview in Node's
//                                                putt_lines.mjs: the same numbers); (3) with the swing started the camera leaves it
//   node web/tests/putting_view.mjs --shots [dir] pictures (default out/putting_built): before (Follow + Arrows) and after, the putts
//                                                in the putting view and at the approach, desktop, portrait and landscape phone; frame strips and
//                                                GIFs of the green's grass motion; the speed (the 3D picture's time, before / after)
//   --only name,name   only these putts; --layouts desk,phone,land (the default: all three; land = a phone on its side, full screen)
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const shots = args.includes("--shots");
const outDir = path.resolve(root, args.find((a, i) => !a.startsWith("--") && args[i - 1] === "--shots") || "out/putting_built");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const DESK = { name: "desk", viewport: [900, 1000] }, PORT = { name: "phone", viewport: [412, 915], touch: true, dpr: 2 }, LAND = { name: "land", viewport: [915, 412], touch: true, dpr: 2 };
const LAYOUTS = (args.includes("--layouts") ? args[args.indexOf("--layouts") + 1].split(",") : ["desk", "phone", "land"]).map(n => ({ desk: DESK, phone: PORT, land: LAND })[n]);

// the putts (as putt_lines.mjs): name, course, hole, the approach shots' power presses
const PUTTS = [
  ["marion1", 1, 1, [60, 48]], ["palm18", 2, 18, [60, 56]], ["dune2", 3, 2, [52]], ["links18", 4, 18, [60]], ["marion3", 1, 3, [60, 48]],
];

// the scripted player, in the page: per game frame the buttons (the same timing as putt_lines.mjs), holds at the wanted moment
const BOT = plan => {
  const g = window.__golf, w = g.w, r6 = w.wram[6];
  const st = { mark: "", since: 0, shot: 0, down: 0, prevM: -1, held: 0 };
  window.__bot = st;
  const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
  g.onFrame = () => {
    const m = r6[0x44E];
    if (g.mark !== st.mark) { st.mark = g.mark; st.since = 0; } else st.since++;
    if (g.shots.length > st.shot) st.shot = g.shots.length;
    const W = window.__want;
    if (W) {
      const hit = W.phase === "approach" ? g.mark === "aimmenu" && st.shot === W.shot && st.since === W.n
        : W.phase === "putt" ? g.mark === "aimmenu" && r6[0x443] === 1 && r6[0x329] === 0x0D && st.since === W.n
        : W.phase === "swing" ? g.mark === "address" && m === W.n : false;
      if (hit) { window.__want = null; g.done = { holes: [], held: true }; }
    }
    let a = 0, b = 0;
    if (g.mark === "aimmenu") {
      if (r6[0x443] === 1) { if (r6[0x329] !== 0x0D) b = st.since >= 12 && st.since % 8 < 2 ? 1 : 0; else a = window.__puttGo && st.since >= 50 && st.since < 52 ? 1 : 0; }
      else a = st.since >= 30 && st.since < 32 ? 1 : 0;
    } else if (g.mark === "address") {
      if (!m && st.since >= 30 && st.since < 32) a = 1;
      const pw = r6[0x329] === 0x0D ? 0x3C : plan.powers[st.shot] ?? 60;
      if (m && m !== st.prevM && (m === pw || (r6[0x329] !== 0x0D && m === 0x78))) a = 1;
      st.prevM = m;
    } else a = g.frames % 20 < 2 ? 1 : 0;
    if (a !== st.down) { key("KeyZ", !!a); st.down = a; }
    if (b !== st.held) { key("ArrowDown", !!b); st.held = b; }
  };
};

async function openPage(q, L, plan) {
  const [vw, vh] = L.viewport;
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: L.dpr || 1, hasTouch: !!L.touch, isMobile: !!L.touch });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); if (/aim helpers|putt lines|shot preview|3D view stopped/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.clear();
    const o = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = a => { if (a instanceof Uint16Array && a.length === 1) { a[0] = 4321; return a; } return o(a); };
  });
  await page.goto(`http://localhost:${port}/web/play.html?${q}&course=${plan.course}&hole=${plan.hole}${L.touch ? "&touch=1" : ""}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(() => { const m = document.getElementById("mode"); m.value = "stroke"; m.dispatchEvent(new Event("change")); });
  await page.waitForFunction(() => window.__golf && window.__golf.mark !== "menus" && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(`(${BOT})(${JSON.stringify(plan)})`);
  return { page, errors };
}
const holdAt = async (page, want) => {
  await page.evaluate(w => { window.__want = w; delete window.__golf.done; dispatchEvent(new KeyboardEvent("keydown", { code: "Space" })); }, want);
  await page.waitForFunction(() => (window.__golf.done && window.__golf.done.held) || window.__golf.error, null, { timeout: 900000, polling: 200 });
  await page.evaluate(() => dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
  return page.evaluate(() => ({ error: window.__golf.error, frames: window.__golf.frames, view: window.__golf.w.wram[6][0x443] }));
};
// the options, and the pictures still coming: rAF fires and the 3D view presents again (each within 20 s: SwiftShader is slow, a
// stalled one never comes back)
const setOpts = (page, o) => page.evaluate(o => { const L = window.__g3d.L; Object.assign(L, o); if (o.trees || o.grass) window.__g3d.scene.hole.id = -1; }, o);
// steady: with the game held at the full resolution, over 8 s the page's animation frames keep coming (at least 15 a second; a page
// whose GPU work queues up gets a handful) and the 3D view draws again (once at least: a Full picture of the course view can take
// seconds in SwiftShader on a busy machine)
const steady = page => page.evaluate(() => new Promise(res => {
  const G = window.__g3d; G.fixedRes = true; let raf = 0; const d0 = G.stats.drawn;
  const tick = () => { raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  setTimeout(() => { G.fixedRes = false; const drawn = G.stats.drawn - d0; res({ ok: raf >= 120 && drawn >= 1, raf, drawn, canvas: [G.canvas.width, G.canvas.height] }); }, 8000);
}));
const alive = page => page.evaluate(() => new Promise(res => {
  const G = window.__g3d, d0 = G.stats.drawn; let raf = 0; const t0 = performance.now();
  const tick = () => { raf++; if (raf < 4) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const chk = () => { if (raf >= 4 && G.stats.drawn >= d0 + 3) res({ ok: true, ms: Math.round(performance.now() - t0) }); else if (performance.now() - t0 > 20000) res({ ok: false, raf, drawn: G.stats.drawn - d0 }); else setTimeout(chk, 50); };
  chk();
}));
const settle = (page, ms = 1800) => page.waitForTimeout(ms);
const grab = async (page, file, whole) => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
  if (whole) await page.screenshot({ path: file, timeout: 180000 });
  else { const r = await page.locator("#screen").boundingBox(); await page.screenshot({ path: file, clip: r, timeout: 180000 }); }
};
// the 3D picture's cost with the game held: drawn again and again, synced by reading a pixel back (median of n)
const cost = (page, n = 7) => page.evaluate(n => {
  const G = window.__g3d, g = window.__golf, gl = G.scene.gl, px = new Uint8Array(4), t = [];
  G.fixedRes = true; G.present(g, G.lastFrame, true, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // (the full resolution, warmed up)
  for (let i = 0; i < n; i++) { const t0 = performance.now(); G.present(g, G.lastFrame, true, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - t0); }
  G.fixedRes = false; t.sort((a, b) => a - b); return { ms: +t[n >> 1].toFixed(1), canvas: [G.canvas.width, G.canvas.height], puttView: !!G.scene.puttView };
}, n);
const BEFORE = { putting: "follow", green: "arrows" }, AFTER = { putting: "green", green: "clean" };

let ok = true;
const log = (...a) => console.log(...a);
const sel = PUTTS.filter(p => !only || only.includes(p[0]));
if (shots) {
  fs.mkdirSync(outDir, { recursive: true });
  const speed = [];
  for (const L of LAYOUTS) for (const [name, course, hole, powers] of sel) {
    const plan = { course, hole, powers };
    const { page, errors } = await openPage("g3d=all", L, plan);
    const f = n => path.join(outDir, `${name}_${L.name}_${n}.png`), whole = !!L.touch;
    // the approach: the last approach shot's aiming menu (the course view, the green ahead)
    let s = await holdAt(page, { phase: "approach", shot: powers.length - 1, n: 25 });
    if (s.error) { log(name, "game error", s.error); ok = false; await page.close(); continue; }
    for (const [tag, o] of [["approach_before", BEFORE], ["approach_after", AFTER]]) {
      await setOpts(page, o); await settle(page, 2500); const a = await alive(page);
      if (!a.ok) { log(name, L.name, tag, "pictures stalled", JSON.stringify(a)); ok = false; }
      await grab(page, f(tag), whole);
      if (L === DESK) { const c = await cost(page); speed.push([name, tag, c]); }
    }
    // the putt: the putting view
    s = await holdAt(page, { phase: "putt", n: 45 });
    if (s.error) { log(name, "game error", s.error); ok = false; await page.close(); continue; }
    for (const [tag, o] of [["putt_before", BEFORE], ["putt_after", AFTER]]) {
      await setOpts(page, o); await settle(page, 2600); const a = await alive(page);
      if (!a.ok) { log(name, L.name, tag, "pictures stalled", JSON.stringify(a)); ok = false; }
      await grab(page, f(tag), whole);
      if (L === DESK) { const c = await cost(page); speed.push([name, tag, c]); }
    }
    const info = await page.evaluate(() => ({ pv: window.__g3d.scene.puttView, lines: (window.__aimPower.putts.runs || []).map(r => `${Math.round(r.power / 0.6)}%: ${r.outcome === 0x80 ? "in" : r.len}`), ms: +window.__aimPower.putts.ms.toFixed(1) }));
    log(name, L.name, JSON.stringify(info));
    // the green's grass motion (GREEN: Clean): the 3D canvas at fixed times 0.25 s apart (the scene's clock set, one picture drawn)
    if (L === DESK) {
      const frames = await page.evaluate(async () => {
        const G = window.__g3d, sc = G.scene, out = [], t0 = Math.floor(sc.time) + 10; G.fixedRes = true;
        for (let k = 0; k < 8; k++) { sc.time = t0 + k * 0.25 - 0.016; sc.lastT = performance.now() / 1000 - 0.016; G.present(window.__golf, G.lastFrame, true, true); out.push(G.canvas.toDataURL("image/png")); }
        G.fixedRes = false; return out;
      });
      frames.forEach((d, k) => fs.writeFileSync(f(`motion_t${k}`), Buffer.from(d.split(",")[1], "base64")));
      // and the swing: the camera eases back to the Follow camera
      await page.evaluate(() => { window.__puttGo = true; });
      s = await holdAt(page, { phase: "swing", n: 20 });
      await settle(page, 300); await grab(page, f("swing_start"), whole);
      s = await holdAt(page, { phase: "swing", n: 50 });
      await settle(page, 1200); await grab(page, f("swing_eased"), whole);
    }
    if (errors.length) { log(name, L.name, "page errors", errors.slice(0, 3)); ok = false; }
    await page.close();
  }
  log("speed (the 3D picture, desktop Full, SwiftShader, median of 7):");
  for (const [n, t, c] of speed) log(`  ${n} ${t}: ${c.ms} ms (${c.canvas.join("x")}${c.puttView ? ", putting view" : ""})`);
  fs.writeFileSync(path.join(outDir, "speed.json"), JSON.stringify(speed, null, 1));
} else {
  for (const [name, course, hole, powers] of sel.slice(0, 3)) {
    const plan = { course, hole, powers };
    const { page, errors } = await openPage("g3d=all", DESK, plan);
    let s = await holdAt(page, { phase: "approach", shot: powers.length - 1, n: 25 });
    for (const o of [AFTER, BEFORE, { putting: "green", green: "arrows" }, { putting: "follow", green: "clean" }]) {
      await setOpts(page, o); await settle(page, 600); const a = await alive(page), st = await steady(page);
      log(`${name} the course view, ${JSON.stringify(o)}: pictures ${a.ok ? "keep coming" : "STALLED " + JSON.stringify(a)}; held at full resolution 8 s: ${st.raf} animation frames, ${st.drawn} 3D pictures ${st.ok ? "(steady)" : "STARVED"}`);
      if (!a.ok || !st.ok) ok = false;
    }
    await setOpts(page, AFTER);
    s = await holdAt(page, { phase: "putt", n: 45 });
    await settle(page, 2000);
    const a = await alive(page), st = await steady(page); if (!a.ok || !st.ok) { log(name, "putting view: pictures STALLED", JSON.stringify(a), JSON.stringify(st)); ok = false; }
    else log(`${name} the putting view held at full resolution 8 s: ${st.raf} animation frames, ${st.drawn} 3D pictures (steady)`);
    const r = await page.evaluate(() => ({ pv: window.__g3d.scene.puttView, runs: (window.__aimPower.putts.runs || []).map(r => [r.power, r.outcome, r.len, r.end[0], r.end[2]]) }));
    log(`${name} the putting view: ${r.pv ? "shows" : "NOT SHOWN"}; lines ${r.runs.map(q => `$${q[0].toString(16)}: ${q[1] === 0x80 ? "in" : q[2]} (${q[3].toFixed(3)}, ${q[4].toFixed(3)})`).join(", ")}`);
    if (!r.pv || r.runs.length !== 4) ok = false;
    await page.evaluate(() => { window.__puttGo = true; });
    s = await holdAt(page, { phase: "swing", n: 30 });
    await settle(page, 400);
    const pv2 = await page.evaluate(() => window.__g3d.scene.puttView);
    log(`${name} the swing started: the putting view ${pv2 ? "STILL SHOWN" : "left"}`); if (pv2) ok = false;
    if (errors.length || s.error) { log(name, "errors", s.error, errors.slice(0, 3)); ok = false; }
    await page.close();
  }
  log(`${ok ? "ok  " : "FAIL"} putting view`);
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
