// A scripted golfer for web/play.html in headless Chromium (WebGL through SwiftShader), shared by arc_shots.mjs and deck_map.mjs
// (after aim_power.mjs's bot): Stroke shots through the page's own key events from a plan per shot (turn the aim, change the club,
// the shot mode, address, then a perfect full-power swing: A at wSwingCount $3C, A at $78; or other press counts; on the green the
// putter, one press). The game is held at a wanted moment by setting window.__golf.done (play.js stops stepping; the 3D view, the
// helpers and the deck keep drawing the last frame) and let go by deleting it. Each shot's real rest spot is logged.
// serve(root): the page's files from root (a copy of an older tree for "before" pictures: it needs its own rom/ beside web/).
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

export const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain", ".ttf": "font/ttf", ".woff2": "font/woff2" };
export function serve(root) {
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  return { server, port: server.address().port };
}
export const launch = () => chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

// the layouts: a desktop window, the Galaxy Z Fold8's inner screen held upright (~1812 x 2176 px), its cover screen (~1080 x 2520 px),
// a phone on its side
export const LAYOUTS = {
  desk: { viewport: [900, 1000] },
  inner: { viewport: [906, 1088], touch: true, dpr: 2 },
  cover: { viewport: [412, 960], touch: true, dpr: 2.625 },
  land: { viewport: [915, 412], touch: true, dpr: 2 },
};

// the bot, in the page
export const BOT = plan => {
  const g = window.__golf, w = g.w, r6 = w.wram[6], u16 = a => r6[a] | r6[a + 1] << 8;
  const st = { mark: "", since: 0, shot: 0, down: 0, launched: false, rest: null, log: [], pv: null, impactAt: -1, launchAt: -1 };
  window.__bot = st;
  const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
  let held = 0;
  g.onFrame = () => {
    const m = r6[0x44E], sp = plan.shots[Math.min(st.shot, plan.shots.length - 1)] || {};
    if (g.mark !== st.mark) { st.mark = g.mark; st.since = 0; } else st.since++;
    const ball = [(u16(0x401) + r6[0x400] / 256) / 32, (u16(0x404) + r6[0x403] / 256) / 32];
    if (g.mark === "address" && !m) { st.launched = false; st.rest = null; st.from = ball; }
    if (!st.launched && st.from && (ball[0] !== st.from[0] || ball[1] !== st.from[1])) { st.launched = true; st.launchAt = g.frames; }
    if (st.launched && !st.rest && r6[0x4D3] >= 0x28) st.rest = ball;
    if (st.launched) st.last = ball;
    if (g.shots.length > st.shot) {
      st.log.push({ shot: st.shot, club: st.pv ? st.pv.club : -1, outcome: g.shots[st.shot], real: st.rest || st.last, pv: st.pv, deck: st.deck, full: !(sp.power || sp.impact) });
      st.shot = g.shots.length; st.pv = null; st.deck = null; st.launched = false; st.from = null;
    }
    const W = window.__want;
    if (W && (st.shot === W.shot || W.phase === "putt")) {
      const hit = W.phase === "aim" ? g.mark === "aimmenu" && st.since >= W.n && (r6[0x443] !== 1 || r6[0x329] === 0x0D || !plan.putter)
        : W.phase === "address" ? g.mark === "address" && st.since === W.n && !m
        : W.phase === "meter" ? g.mark === "address" && m === W.n
        : W.phase === "flight" ? st.launched && g.frames - st.launchAt === W.n
        : W.phase === "putt" ? g.mark === "aimmenu" && r6[0x443] === 1 && r6[0x329] === 0x0D && st.since >= W.n && st.shot >= (W.shot || 0) : false;   // (the first putt on the green)
      if (hit) { window.__want = null; g.done = { holes: [], held: true }; }
    }
    let a = 0, b = 0;
    if (g.mark === "aimmenu") {
      st.impactAt = -1; st.launchAt = -1;
      const t = st.since, L = sp.aim || 0, C = sp.club || 0, B = sp.mode || 0;
      if (plan.putter && r6[0x443] === 1 && r6[0x329] !== 0x0D) b = t >= 12 && t % 8 < 2 ? "ArrowDown" : 0;   // (on the green: the putter)
      else if (plan.putter && r6[0x443] === 1) a = t >= 240 && t < 242 ? 1 : 0;                                // (the putt: a look first)
      else {
        if (t >= 30 && t < 30 + Math.abs(L)) b = L < 0 ? "ArrowLeft" : "ArrowRight";
        const t2 = t - 35 - Math.abs(L);
        if (t2 >= 0 && t2 < Math.abs(C) * 8 && t2 % 8 < 2) b = C < 0 ? "ArrowUp" : "ArrowDown";
        const t3 = t2 - Math.abs(C) * 8;
        if (t3 >= 0 && t3 < B * 10 && t3 % 10 < 2) b = "KeyX";
        if (t3 - B * 10 >= (plan.aimWait ?? 40) && t3 - B * 10 < (plan.aimWait ?? 40) + 2) a = 1;
      }
    } else if (g.mark === "address") {
      if (!m && st.since === 25) {                     // the page's preview, and the deck map's marks, at this moment
        const ap = window.__aimPower, res = ap && ap.preview.get(w), dm = window.__deckMap;
        st.pv = res && { end: [res.end[0], res.end[2]], land: [res.path[res.land][0], res.path[res.land][2]], outcome: res.outcome, carry: res.carry, rest: res.rest, club: r6[0x329] };
        st.deck = dm && dm.marks ? JSON.parse(JSON.stringify(dm.marks)) : null;
      }
      if (!m && st.since >= (plan.addrWait || 40) && st.since < (plan.addrWait || 40) + 2) a = 1;
      const pw = sp.power ?? 0x3C, imp = sp.impact ?? 0x78;
      if (m && m !== st.prevM && (m === pw || (r6[0x329] !== 0x0D && m === imp))) { a = 1; if (m === imp || r6[0x329] === 0x0D) st.impactAt = g.frames + 1; }
      st.prevM = m;
    } else a = g.frames % 20 < (plan.hold2 ? 2 : 1) ? 1 : 0;
    if (a !== st.down) { key("KeyZ", !!a); st.down = a; }
    if (b !== held) { if (held) key(held, false); if (b) key(b, true); held = b; }
  };
};

export async function openPage(browser, port, q, L, plan, init = {}) {
  const [vw, vh] = L.viewport;
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: L.dpr || 1, hasTouch: !!L.touch, isMobile: !!L.touch });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); if (/aim helpers|shot preview|putt lines|deck map|3D view stopped/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(([seed, store]) => {
    localStorage.clear(); for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v);
    const o = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = a => { if (a instanceof Uint16Array && a.length === 1) { a[0] = seed; return a; } return o(a); };
  }, [plan.seed || 4321, init]);
  await page.goto(`http://localhost:${port}/web/play.html?${q}${L.touch ? "&touch=1" : ""}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(() => { const m = document.getElementById("mode"); m.value = "stroke"; m.dispatchEvent(new Event("change")); });
  await page.waitForFunction(() => window.__golf && window.__golf.mark !== "menus" && window.__golf.frames > 0, null, { timeout: 60000 });
  await page.evaluate(`(${BOT})(${JSON.stringify(plan)})`);
  return { page, errors };
}
export async function holdAt(page, want, fast = true) {
  await page.evaluate(([w, f]) => { window.__want = w; delete window.__golf.done; dispatchEvent(new KeyboardEvent(f ? "keydown" : "keyup", { code: "Space" })); }, [want, fast]);
  await page.waitForFunction(() => (window.__golf.done && window.__golf.done.held) || window.__golf.error, null, { timeout: 900000, polling: 100 });
  await page.evaluate(() => dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
  return page.evaluate(() => ({ error: window.__golf.error, frames: window.__golf.frames, mark: window.__golf.mark, view: window.__golf.w.wram[6][0x443], club: window.__golf.w.wram[6][0x329] }));
}
export async function grab(page, file, whole) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))));
  await page.waitForTimeout(500);
  // (the deck's map settled: no new drawing for 800 ms, at most 30 s)
  await page.evaluate(() => new Promise(r => { const d = window.__deckMap; if (!d) return r(); let last = d.draws, at = performance.now(); const t0 = at;
    const chk = () => { if (d.draws !== last) { last = d.draws; at = performance.now(); } if (performance.now() - at > 800 || performance.now() - t0 > 30000) r(); else setTimeout(chk, 100); }; chk(); }));
  if (whole) await page.screenshot({ path: file, timeout: 180000 });
  else { const r = await page.locator("#screen").boundingBox(); await page.screenshot({ path: file, clip: r, timeout: 180000 }); }
}
