// The play page's picture options (web/js/hd: HD text, HD menus, wide) in headless Chromium. A scripted session (buttons decided
// in the page per frame from the frame counter and the game's state: window.__golfInput, js/hd/page.js) goes from power-on through
// the title, the character select, the mode and course selects into a Stroke round, opens the pause menu and its scorecard,
// and plays shots.
//   node web/tests/play_hd.mjs shots [outdir]        screenshots of each screen with each option (out/hd/<screen>_<option>.png)
//   node web/tests/play_hd.mjs --same [frames]       the game unchanged: the session run with every option off and again with every
//                                                    option on (and the touch layouts); a hash of the game's whole state (all RAM,
//                                                    VRAM, OAM, palettes, LCD registers, save RAM) at every frame must be equal
//   --opts a,b  (screenshots) only these option sets (off text ui wide all portrait landscape)
//   --save F  the browser's localStorage holds the save RAM file F (slot 0 a saved character: the session then goes into story mode)
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const same = args.includes("--same");
const saveFile = args.includes("--save") ? args[args.indexOf("--save") + 1] : null;
const pos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--save" && args[i - 1] !== "--opts");
const only = args.includes("--opts") ? args[args.indexOf("--opts") + 1].split(",") : null;   // (screenshots: only these option sets)
const outDir = path.resolve(root, pos[1] || "out/hd");
fs.mkdirSync(outDir, { recursive: true });
const SAVE_KEY = "mg-sram-7f2062e51b4f";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".gbc": "application/octet-stream", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch();

// the session's buttons: a pure function of the frame counter and the game's state (the same in every run while the game is)
const POLICY = `(() => {
  const st = { mark: "", at: 0, aims: 0, seen: -1, story: ${saveFile ? "true" : "false"} };
  const has = (w, b, a) => { const t = w.wram[0]; for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === b && (t[p + 1] | t[p + 2] << 8) === a) return true; return false; };
  const pulse = (k, at, mask, n = 3) => k >= at && k < at + n ? mask : 0;
  window.__golfInput = g => {
    const k = g.frames, w = g.w;
    if (st.seen !== k) {                           // (held() may ask more than once a frame: the state moves once per frame)
      st.seen = k;
      if (g.mark !== st.mark) { st.mark = g.mark; st.at = k; if (g.mark === "aimmenu") st.aims++; }
    }
    const t = k - st.at;
    if (g.mark === "menus" || !g.mark) {
      if (k < 400) return 0;
      if (st.story && w.wram[0][0x450]) {                                       // (story: walk about the map, A now and then)
        if (!st.mapAt) st.mapAt = k;
        const p = (k - st.mapAt) % 600; return p >= 200 && p < 260 ? 0x40 : p >= 280 && p < 330 ? 0x20 : p >= 360 && p < 450 ? 0x10 : p % 40 < 2 && p > 450 ? 1 : 0;
      }
      if (k % 40 >= 3) return 0;
      if (has(w, 0x40, 0x4D1D)) return 8;                                        // the title: Start
      if (has(w, 0x06, 0x65D9)) return w.wram[6][0x214] !== (st.story ? 0 : 4) ? 0x10 : 1;   // the character select: Mario (or slot 0)
      if (st.story && has(w, 0x0D, 0x428E) && w.high[0x1B0] !== 5) return 0x10;    // (story: the mode list to its last entry, the story)
      return 1;
    }
    if (g.mark === "aimmenu") {
      if (st.aims === 1) return pulse(t, 60, 8) | pulse(t, 140, 0x80) | pulse(t, 160, 0x80) | pulse(t, 180, 1) | pulse(t, 420, 1) |
        pulse(t, 600, 0x10, 6) | pulse(t, 640, 1);
      return pulse(t, 60, st.aims & 1 ? 0x10 : 0x20, 6) | pulse(t, 90, 1);
    }
    if (g.mark === "address") return pulse(t, 20, 1, 2) | pulse(t, 78, 1, 2) | pulse(t, 130, 1, 2);
    return k % 50 < 2 ? 1 : 0;                                                   // captions, the scorecard between holes: A now and then
  };
})()`;

async function openPage(query, viewport = { width: 900, height: 1000 }, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if ((m.type() === "error" && !/Failed to load resource/.test(m.text())) || (m.type() === "warning" && /HD painter|hd menus/.test(m.text()))) errors.push(m.text()); });
  await page.addInitScript(([k, v, pol]) => { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); for (const o of ["mg-font", "mg-ui", "mg-view"]) localStorage.removeItem(o); eval(pol); },
    [SAVE_KEY, saveFile ? fs.readFileSync(path.resolve(root, saveFile)).toString("base64") : "", POLICY]);
  await page.goto(`http://localhost:${port}/web/play.html${query}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 30000 });
  return { page, errors };
}
const frames = page => page.evaluate(() => window.__golf.frames);

let ok = true;
if (same) {
  // every frame's state hash, from frame 1 to N, with the options off and on
  const N = +(pos[0] || 6000);
  const run = async (query, viewport, extra) => {
    const { page, errors } = await openPage(query, viewport, extra);
    await page.evaluate(() => {
      const g = window.__golf; g.hashes = {};
      const fnv = (h, a) => { for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h; };
      g.onFrame = () => {                          // (before each frame: the state the previous frame and the drawing left)
        const w = g.w; let h = 2166136261;
        for (const b of w.wram) h = fnv(h, b);
        h = fnv(h, w.high); h = fnv(h, w.vram[0]); h = fnv(h, w.vram[1]); h = fnv(h, w.oam); h = fnv(h, w.bgPal); h = fnv(h, w.objPal); h = fnv(h, w.sram);
        const l = w.lcd; h = fnv(h, [l.lcdc, l.scx, l.scy, l.wx, l.wy, l.vbk, l.bcps, l.ocps]);
        g.hashes[g.frames] = h >>> 0;
      };
    });
    await page.keyboard.down("Space");             // fast
    await page.waitForFunction(n => window.__golf.frames >= n || window.__golf.error || window.__golf.done, N, { timeout: 1800000 });
    const r = await page.evaluate(() => ({ hashes: window.__golf.hashes, error: window.__golf.error, mark: window.__golf.mark, shots: window.__golf.shots.length,
      hd: window.__hd ? { font: window.__hd.view.font, ui: window.__hd.view.ui, view: window.__hd.view.view, lines: window.__hd.view.hd ? window.__hd.view.hd.lines.length : 0 } : null }));
    await page.screenshot({ path: path.join(outDir, `same_${query ? "on" : "off"}_${viewport.width}x${viewport.height}.png`) });
    await page.close();
    return { ...r, errors };
  };
  const off = await run("", { width: 900, height: 1000 });
  const ons = [await run("?font=itim&ui=hd&view=wide", { width: 900, height: 1000 }),
    await run("?font=kode&ui=hd&view=wide&touch=1", { width: 412, height: 915 }, { hasTouch: true, isMobile: true }),
    await run("?font=itim&ui=hd&view=normal&touch=1", { width: 915, height: 412 }, { hasTouch: true, isMobile: true })];
  for (const on of ons) {
    let n = 0, diff = -1;
    for (let i = 1; i <= N; i++) { if (!(i in off.hashes) || !(i in on.hashes)) continue; n++; if (off.hashes[i] !== on.hashes[i]) { diff = i; break; } }
    console.log(`options ${JSON.stringify(on.hd)}: ${n} frames compared, ${diff < 0 ? "all equal" : "FIRST DIFFERENCE at frame " + diff}; off: ${off.shots} shots, mark ${off.mark}; on: ${on.shots} shots, mark ${on.mark}; errors ${JSON.stringify([...off.errors, ...on.errors].slice(0, 4))}`);
    if (diff >= 0 || n < N * 0.98 || off.error || on.error || off.errors.length || on.errors.length) ok = false;
  }
} else {
  // screenshots: one page per option set, each paused at the same screens
  const OPTS = { off: "", text: "?font=itim", ui: "?ui=hd", wide: "?view=wide", all: "?font=itim&ui=hd&view=wide",
    portrait: "?font=itim&ui=hd&touch=1", landscape: "?font=itim&ui=hd&view=wide&touch=1" };   // (the last two: a phone, the whole page)
  const PHONE = { portrait: [{ width: 412, height: 915 }, { hasTouch: true, isMobile: true }], landscape: [{ width: 915, height: 412 }, { hasTouch: true, isMobile: true }] };
  const STOPS = [
    ["title", g => g.mark === "menus" && (t => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x40 && (t[p + 1] | t[p + 2] << 8) === 0x4D1D) return true; return false; })(g.w.wram[0])],
    ["charselect", g => g.mark === "menus" && (t => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x06 && (t[p + 1] | t[p + 2] << 8) === 0x65D9) return true; return false; })(g.w.wram[0]) && g.w.wram[6][0x214] === 4],
    ["modeselect", g => g.mark === "menus" && (t => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x0D && (t[p + 1] | t[p + 2] << 8) === 0x415C) return true; return false; })(g.w.wram[0])],
    ["courseselect", g => g.mark === "menus" && (t => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x0F && (t[p + 1] | t[p + 2] << 8) === 0x4160) return true; return false; })(g.w.wram[0])],
    ["aim", g => g.mark === "aimmenu" && g.__aimAt !== undefined && g.frames - g.__aimAt > 45],
    ["pause", g => g.mark === "aimmenu" && g.frames - g.__aimAt > 125 && g.frames - g.__aimAt < 135],
    ["scorecard", g => g.mark === "aimmenu" && g.frames - g.__aimAt > 380 && g.frames - g.__aimAt < 390],
    ["address", g => g.mark === "address" && g.frames - g.__addrAt > 10],
    ["swing", g => g.mark === "address" && g.frames - g.__addrAt > 100],
    ["flight", g => g.mark !== "address" && g.mark !== "aimmenu" && g.__addrAt && g.frames - g.__addrAt > 260],
    ["caption", g => (t => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x3B && (t[p + 1] | t[p + 2] << 8) === 0x4433) return true; return false; })(g.w.wram[0])],
    ["aim2", g => g.mark === "aimmenu" && g.__aims >= 2 && g.frames - g.__aimAt > 45],
  ];
  const STORY_STOPS = [["story_map", g => g.w.wram[0][0x450] && g.frames > 1700], ["story_walk", g => g.w.wram[0][0x450] && g.frames > 2150], ["story_talk", g => g.w.wram[0][0x450] && g.frames > 2400], ["story_talk2", g => g.w.wram[0][0x450] && g.frames > 2700], ["story_more", g => g.w.wram[0][0x450] && g.frames > 3300]];
  for (const [name, q] of Object.entries(OPTS).filter(([n]) => !only || only.includes(n))) {
    const { page, errors } = await openPage(q, ...(PHONE[name] || []));
    await page.evaluate(() => {                    // (mark times for the stops)
      const g = window.__golf; let m = "";
      const prev = g.onFrame; g.onFrame = () => { if (prev) prev(); if (g.mark !== m) { m = g.mark; if (m === "aimmenu") { g.__aimAt = g.frames; g.__aims = (g.__aims || 0) + 1; } if (m === "address") g.__addrAt = g.frames; } };
    });
    for (const [stop, fn] of saveFile ? STORY_STOPS : STOPS) {
      try {
        await page.waitForFunction(`(${fn})(window.__golf) || window.__golf.error`, null, { timeout: 240000, polling: 16 });
      } catch (e) { errors.push(`${stop}: not reached`); continue; }
      if (PHONE[name]) await page.screenshot({ path: path.join(outDir, `${stop}_${name}.png`) });
      else await page.locator("#screen").screenshot({ path: path.join(outDir, `${stop}_${name}.png`) });
    }
    const r = await page.evaluate(() => ({ frames: window.__golf.frames, error: window.__golf.error, lines: window.__hd.view.hd ? window.__hd.view.hd.lines.map(l => l.text) : [] }));
    console.log(`${name}: ${r.frames} frames, error ${r.error}, last text lines ${JSON.stringify(r.lines.slice(0, 6))}, errors ${JSON.stringify(errors.slice(0, 4))}`);
    if (errors.length || r.error) ok = false;
    await page.close();
  }
}
await browser.close();
server.close();
console.log(ok ? "ok   play_hd" : "FAIL play_hd");
process.exit(ok ? 0 : 1);
