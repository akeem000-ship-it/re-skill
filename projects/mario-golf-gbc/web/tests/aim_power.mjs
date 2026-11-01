// The aim and swing helpers (web/js/hd/aimpower.js: the big meter, the shot preview, the ground markers, the tap area) on
// web/play.html in headless Chromium (WebGL through SwiftShader). A bot plays Stroke shots through the page's own key events
// (or, with --tap, touches on the tap area), from a plan per shot: turn the aim, change the club, address, then a perfect
// full-power swing (A at wSwingCount $3C, A at $78: the cursor exactly 0) or another one.
//   node web/tests/aim_power.mjs                 the check: on several courses, holes and golfers (wind, curved and straight aims,
//                                                shots from the fairway, rough and bunker, putts) the preview the page computed at
//                                                the address must equal where the ball really came to rest; and the frame cost
//   node web/tests/aim_power.mjs --shots [dir]   screenshots (default out/aimpower): before / after in 2D, 2D+HD, 3D, landscape and
//                                                portrait phones; the meter at count 10, 40, the power set, the impact, +10 frames;
//                                                the preview and markers on four courses
//   --only name,name  (screenshots) only these sets
//   node web/tests/aim_power.mjs --cost          the cost: the helpers' drawing per picture (2D, 2D+HD, 3D Lite and Full; aiming and
//                                                the meter), a preview's run, the 3D picture with the helpers off and on (SwiftShader)
// The game is held at a moment by setting window.__golf.done (play.js stops stepping; the 3D view and the helpers keep drawing
// the last frame) and let go by deleting it.
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const shots = args.includes("--shots"), cost = args.includes("--cost");
const outDir = path.resolve(root, args.find((a, i) => !a.startsWith("--") && args[i - 1] === "--shots") || "out/aimpower");
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
const DESK = { viewport: [900, 1000] }, LAND = { viewport: [915, 412], touch: true, dpr: 2 }, PORT = { viewport: [412, 915], touch: true, dpr: 2 };

// the bot, in the page: the buttons per frame from the plan, the moments to hold at, each shot's preview and real rest
const BOT = plan => {
  const g = window.__golf, w = g.w, r6 = w.wram[6], u16 = a => r6[a] | r6[a + 1] << 8;
  const st = { mark: "", since: 0, shot: 0, down: 0, launched: false, rest: null, log: [], pv: null };
  window.__bot = st;
  const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
  const want = () => window.__want;
  const tap = (d) => {                               // (--tap: a touch in the lower half of the screen, as a finger would)
    const x = innerWidth * 0.5, y = innerHeight * 0.82, t = document.elementFromPoint(x, y) || document.body;
    t.dispatchEvent(new PointerEvent(d ? "pointerdown" : "pointerup", { clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true }));
  };
  let held = 0;
  const set = (code, on) => { if (plan.tap && code === "KeyZ") tap(on); else key(code, on); };
  g.onFrame = () => {
    const m = r6[0x44E], sp = plan.shots[Math.min(st.shot, plan.shots.length - 1)] || {};
    if (g.mark !== st.mark) { st.mark = g.mark; st.since = 0; } else st.since++;
    const ball = [(u16(0x401) + r6[0x400] / 256) / 32, (u16(0x404) + r6[0x403] / 256) / 32];
    // the real shot: launched when the ball leaves its spot; at rest when the game's rest counter $D4D3 reaches $28 (ShotMainLoop)
    if (g.mark === "address" && !m) { st.launched = false; st.rest = null; st.from = ball; }
    if (!st.launched && st.from && (ball[0] !== st.from[0] || ball[1] !== st.from[1])) st.launched = true;
    if (st.launched && !st.rest && r6[0x4D3] >= 0x28) st.rest = ball;
    if (st.launched) st.last = ball;
    if (g.shots.length > st.shot) {
      st.log.push({ shot: st.shot, club: st.pv ? st.pv.club : -1, lie: st.pv ? st.pv.lie : -1, wind: [w.wram[0][0x815], w.wram[0][0x816]], outcome: g.shots[st.shot],
        real: st.rest || st.last, pv: st.pv, full: !(sp.power || sp.impact) });
      st.shot = g.shots.length; st.pv = null; st.launched = false; st.from = null;
    }
    // hold here?
    const W = want();
    if (W && st.shot === W.shot) {
      const hit = W.phase === "aim" ? g.mark === "aimmenu" && st.since === W.n : W.phase === "address" ? g.mark === "address" && st.since === W.n && !m
        : W.phase === "meter" ? g.mark === "address" && m === W.n : W.phase === "after" ? st.impactAt >= 0 && g.frames - st.impactAt === W.n
        : W.phase === "flight" ? st.launched && g.frames - st.launchAt === W.n : false;
      if (hit) { window.__want = null; g.done = { holes: [], held: true }; }
    }
    if (st.launched && st.launchAt < 0) st.launchAt = g.frames;
    let a = 0, b = 0;
    if (g.mark === "aimmenu") {
      st.impactAt = -1; st.launchAt = -1;
      const t = st.since, L = sp.aim || 0, C = sp.club || 0, B = sp.mode || 0;
      if (t >= 30 && t < 30 + Math.abs(L)) b = L < 0 ? "ArrowLeft" : "ArrowRight";
      const t2 = t - 35 - Math.abs(L);
      if (t2 >= 0 && t2 < Math.abs(C) * 8 && t2 % 8 < 2) b = C < 0 ? "ArrowUp" : "ArrowDown";
      const t3 = t2 - Math.abs(C) * 8;
      if (t3 >= 0 && t3 < B * 10 && t3 % 10 < 2) b = "KeyX";
      if (t3 - B * 10 >= (plan.aimWait || 40) && t3 - B * 10 < (plan.aimWait || 40) + 2) a = 1;
    } else if (g.mark === "address") {
      if (!m && st.since === 25 && window.__aimPower) {    // the page's own preview at this moment
        const res = window.__aimPower.preview.get(w);
        st.pv = res && { end: [res.end[0], res.end[2]], outcome: res.outcome, carry: res.carry, rest: res.rest, ms: res.ms, club: r6[0x329], lie: r6[0x4CD] };
      }
      if (!m && st.since >= (plan.addrWait || 40) && st.since < (plan.addrWait || 40) + 2) a = 1;
      const pw = sp.power ?? 0x3C, imp = sp.impact ?? 0x78;
      if (m && m !== st.prevM && (m === pw || (r6[0x329] !== 0x0D && m === imp))) { a = 1; if (m === imp || r6[0x329] === 0x0D) st.impactAt = g.frames + 1; }
      st.prevM = m;
    } else a = g.frames % 20 === 0 ? 1 : 0;
    if (a !== st.down) { set("KeyZ", !!a); st.down = a; }
    if (b !== held) { if (held) key(held, false); if (b) key(b, true); held = b; }
  };
};

async function openPage(q, L, plan) {
  const [vw, vh] = L.viewport;
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: L.dpr || 1, hasTouch: !!L.touch, isMobile: !!L.touch });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); if (/aim helpers|shot preview|3D view stopped/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(seed => {
    localStorage.clear();
    const o = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = a => { if (a instanceof Uint16Array && a.length === 1) { a[0] = seed; return a; } return o(a); };
  }, plan.seed || 4321);
  await page.goto(`http://localhost:${port}/web/play.html?${q}${L.touch ? "&touch=1" : ""}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(() => { const m = document.getElementById("mode"); m.value = "stroke"; m.dispatchEvent(new Event("change")); });   // (hidden on phones)
  await page.waitForFunction(() => window.__golf && window.__golf.mark !== "menus" && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(`(${BOT})(${JSON.stringify(plan)})`);
  await page.keyboard.down("Space").catch(() => {});      // (fast until the first hold)
  return { page, errors };
}
const holdAt = async (page, wnt, fast = true) => {
  await page.evaluate(([w, f]) => { window.__want = w; delete window.__golf.done; dispatchEvent(new KeyboardEvent(f ? "keydown" : "keyup", { code: "Space" })); }, [wnt, fast]);
  await page.waitForFunction(() => (window.__golf.done && window.__golf.done.held) || window.__golf.error, null, { timeout: 600000, polling: 100 });
  await page.evaluate(() => dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
  return page.evaluate(() => ({ error: window.__golf.error, frames: window.__golf.frames, mark: window.__golf.mark, cnt: window.__golf.w.wram[6][0x44E] }));
};
const grab = async (page, file, whole) => {
  await page.waitForTimeout(700);
  if (whole) await page.screenshot({ path: file, timeout: 120000 });
  else { const r = await page.locator("#screen").boundingBox(); await page.screenshot({ path: file, clip: r, timeout: 120000 }); }
};
const setOpts = (page, o) => page.evaluate(o => { for (const [k, v] of Object.entries(o)) window.__aimPower.set(k, v); window.__aimPower.paint(); }, o);
const ON = { meter: "big", preview: "on", marks: "on", tap: "on" }, OFF = { meter: "game", preview: "off", marks: "off", tap: "off" };

let ok = true;
const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
if (cost) {
  for (const [name, q] of [["2D", "g3d=none"], ["2D+HD", "g3d=none&ui=hd&font=itim"], ["3D Lite", "g3d=all&g3dq=lite"], ["3D Full", "g3d=all"]]) {
    const { page, errors } = await openPage(q, DESK, { shots: [{ aim: 6 }] });
    for (const [m, wnt] of [["aiming", { shot: 0, phase: "address", n: 30 }], ["meter", { shot: 0, phase: "meter", n: 40 }]]) {
      const st = await holdAt(page, wnt);
      if (st.error) { console.log(name, "game error", st.error); ok = false; break; }
      await page.waitForTimeout(500);
      const r = await page.evaluate(async () => {
        const ap = window.__aimPower, g = window.__golf, G = window.__g3d, t = [], pv = [], d3 = [[], []];
        for (let j = 0; j < 8; j++) { const t0 = performance.now(); for (let i = 0; i < 25; i++) ap.paint(g); t.push((performance.now() - t0) / 25); }   // (batches: the clock's grain is 0.1 ms)
        for (let i = 0; i < 12; i++) { ap.preview.key = ""; const t0 = performance.now(); ap.preview.get(g.w); pv.push(performance.now() - t0); }
        if (G && G.active && G.scene) for (const on of [0, 1]) {               // the 3D picture alone, then with the helpers drawn after it
          const gl = G.canvas.getContext("webgl2"), px = new Uint8Array(4);                // (readPixels waits for the GPU's work)
          for (let i = 0; i < 8; i++) { const t0 = performance.now(); G.present(g, G.lastFrame, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (on) ap.paint(g); d3[on].push(performance.now() - t0); }
        }
        return { t, pv, d3 };
      });
      console.log(`${name} ${m}: helpers ${median(r.t).toFixed(2)} ms a picture (median of ${r.t.length} batches of 25); a preview run ${median(r.pv).toFixed(1)} ms` +
        (r.d3[0].length ? `; the 3D picture ${median(r.d3[0]).toFixed(1)} ms, with the helpers ${median(r.d3[1]).toFixed(1)} ms` : ""));
    }
    if (errors.length) { console.log(name, "page errors", errors.slice(0, 3)); ok = false; }
    await page.close();
  }
} else if (shots) {
  fs.mkdirSync(outDir, { recursive: true });
  const SETS = {
    desk_2d: ["g3d=none", DESK], desk_hd: ["g3d=none&ui=hd&font=itim", DESK], desk_3d: ["g3d=all", DESK], desk_wide: ["g3d=none&ui=hd&font=itim&view=wide", DESK],
    land_hd: ["g3d=none&ui=hd&font=itim", LAND], land_3d: ["g3d=all", LAND], port_hd: ["g3d=none&ui=hd&font=itim", PORT], port_3d: ["g3d=all", PORT],
  };
  // the swing on Marion 1's tee in each layout: before (the helpers off) and after
  for (const [name, [q, L]] of Object.entries(SETS)) {
    if (only && !only.includes(name)) continue;
    const plan = { shots: [{ aim: 0 }] };
    const { page, errors } = await openPage(q, L, plan);
    const whole = !!L.touch, f = n => path.join(outDir, `${name}_${n}.png`);
    const moments = [["aim", { shot: 0, phase: "aim", n: 60 }], ["address", { shot: 0, phase: "address", n: 30 }], ["m10", { shot: 0, phase: "meter", n: 10 }],
      ["m40", { shot: 0, phase: "meter", n: 40 }], ["power", { shot: 0, phase: "meter", n: 62 }], ["impact", { shot: 0, phase: "after", n: 0 }], ["impact10", { shot: 0, phase: "after", n: 10 }]];
    for (const [m, wnt] of moments) {
      const s = await holdAt(page, wnt);
      if (s.error) { console.log(name, m, "game error", s.error); ok = false; break; }
      await setOpts(page, OFF); await grab(page, f(m + "_before"), whole);
      await setOpts(page, ON); await grab(page, f(m + "_after"), whole);
      console.log(name, m, JSON.stringify(s));
    }
    if (errors.length) { console.log(name, "page errors", errors.slice(0, 3)); ok = false; }
    await page.close();
  }
  // the preview and markers on four courses (tee, a second shot, a putt), 2D and 3D
  const STD = [["tee_aim", { shot: 0, phase: "aim", n: 75 }], ["tee_addr", { shot: 0, phase: "address", n: 30 }], ["second_aim", { shot: 1, phase: "aim", n: 75 }], ["third_aim", { shot: 2, phase: "aim", n: 75 }]];
  const PUTTS = [["third_aim", { shot: 2, phase: "aim", n: 75 }], ["third_addr", { shot: 2, phase: "address", n: 30 }], ["fourth_aim", { shot: 3, phase: "aim", n: 75 }]];   // (putts on the green)
  const COURSES = [[1, 3, 8], [2, 1, 8], [3, 5, 8], [4, 2, 8], [3, 12, 8, { seed: 2024, shots: [{ aim: 30 }, { aim: -24 }, {}, {}, {}] }, PUTTS]];
  for (const [c, h, , P, M] of COURSES) for (const [mode, q] of [["2d", "g3d=none&ui=hd&font=itim"], ["3d", "g3d=all"]]) {
    const name = `course${c}_h${h}_${mode}`;
    if (only && !only.includes(name) && !only.includes("courses")) continue;
    const plan = P || { shots: [{ aim: 10 }, { aim: -6 }, {}, {}, {}], seed: 1000 + c };
    const { page, errors } = await openPage(`${q}&course=${c}&hole=${h}`, DESK, plan);
    for (const [m, wnt] of M || STD) {
      const s = await holdAt(page, wnt);
      if (s.error) { console.log(name, m, "game error", s.error); ok = false; break; }
      await setOpts(page, ON); await grab(page, path.join(outDir, `${name}_${m}.png`), false);
      console.log(name, m, JSON.stringify(s), await page.evaluate(() => { const r = window.__aimPower.preview.res; return r && `club ${window.__golf.w.wram[6][0x329]} carry ${r.carry} rest ${r.rest} ${r.ms.toFixed(1)} ms`; }));
    }
    if (errors.length) { console.log(name, "page errors", errors.slice(0, 3)); ok = false; }
    await page.close();
  }
} else {
  // the check: perfect full swings on several holes; the preview the page computed at the address against the real rest spot
  const CASES = [
    { q: "g3d=none&course=1&hole=1", seed: 4321, shots: [{}, { aim: 8 }, {}, {}, {}] },
    { q: "g3d=all&g3dq=lite&course=2&hole=1", seed: 777, shots: [{ aim: -14 }, { club: 1 }] },
    { q: "g3d=none&ui=hd&course=3&hole=5", seed: 4242, shots: [{ aim: 20 }, { aim: -10 }, {}, {}] },
    { q: "g3d=all&g3dq=lite&course=4&hole=3", seed: 99, shots: [{}, { aim: 6 }] },
    { q: "g3d=none&course=1&hole=7", seed: 31337, shots: [{ aim: -25, club: 1 }, { aim: 30 }, {}, {}] },
    { q: "g3d=none&course=2&hole=9", seed: 5, shots: [{ power: 0x30 }, { impact: 0x76 }, {}, {}] },   // (two swings not perfect: they differ)
  ];
  const rows = [];
  for (const C of CASES) {
    const { page, errors } = await openPage(C.q, DESK, { shots: C.shots, seed: C.seed });
    await page.waitForFunction(n => window.__bot.log.length >= n || window.__golf.error || window.__golf.done, C.shots.length, { timeout: 900000, polling: 500 });
    const r = await page.evaluate(() => ({ log: window.__bot.log, error: window.__golf.error, ap: window.__aimPower.stats.cpu, g3: window.__g3d && window.__g3d.stats ? [window.__g3d.stats.fps, window.__g3d.stats.cpu] : null }));
    for (const s of r.log) {
      const same = s.pv && s.real && s.pv.end[0] === s.real[0] && s.pv.end[1] === s.real[1];
      rows.push({ q: C.q, ...s, same });
      console.log(`${C.q} shot ${s.shot + 1}: club ${s.club} lie ${s.lie} wind ${s.wind[0]} mph dir ${s.wind[1]}, ${s.full ? "perfect full" : "NOT perfect"}: preview (${s.pv ? s.pv.end.map(v => v.toFixed(3)).join(", ") : "-"}) ${s.pv ? s.pv.rest + " y" : ""}` +
        ` ${s.pv ? s.pv.ms.toFixed(1) + " ms" : ""}; real (${s.real ? s.real.map(v => v.toFixed(3)).join(", ") : "-"}) -> ${same ? "SAME" : "differs"}`);
      if (s.full && !same) ok = false;
      if (!s.full && same) console.log("  (a non-perfect swing came to rest at the preview's spot)");
    }
    console.log(`  helpers ${(r.ap || 0).toFixed(2)} ms a drawn frame${r.g3 ? `; 3D ${r.g3[0].toFixed(0)} fps, ${(r.g3[1] || 0).toFixed(1)} ms` : ""}`);
    if (r.error || errors.length) { console.log("  errors", r.error, errors.slice(0, 3)); ok = false; }
    await page.close();
  }
  const full = rows.filter(r => r.full), same = full.filter(r => r.same).length;
  console.log(`${ok ? "ok  " : "FAIL"} shot preview: ${same} of ${full.length} perfect full swings came to rest exactly at the preview's spot`);
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
