// Plays the game from power-on through the menus into an exhibition match and lets a simple bot (P1) play
// it to the end on the page's core, taking 2D + 3D screenshots at every menu step, every point and the
// end. usage: node web/tests/play_match.mjs OUTDIR [--max FRAMES] [--size WxH] [--cam PRESET] [--vox] [--video]
import fs from "fs";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0] || "out/match", MAX = +opt("--max", 60000), cam = opt("--cam", "low"), [W, H] = opt("--size", "720x690").split("x").map(Number);
// --video FROM:TO:STEP captures the 3D canvas every STEP frames in that range (out/video/NNNNN.png; assemble
// with ffmpeg -framerate 30 -i out/video/%05d.png -pix_fmt yuv420p out/match.mp4)
const vid = a.includes("--video") ? opt("--video", "1500:3000:2").split(":").map(Number) : null;
fs.mkdirSync(out, { recursive: true }); if (vid) fs.mkdirSync(`${out}/video`, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", e => console.log("pageerror", e.message)); page.on("console", m => { if (m.type() === "error" && !m.text().includes("404")) console.log("console", m.text()); });
await page.goto(`http://localhost:8765/web/full.html?touch&cam=${cam}` + (a.includes("--vox") ? "&vox" : ""));
await page.waitForFunction(() => window.__gb && window.__gb.gb, null, { timeout: 60000 });
await page.evaluate(() => {
  const G = window.__gb; G.pause();
  // menu key script (title -> exhibition -> singles -> character -> opponent -> court -> match), then the bot
  const keys = { 332: "Enter", 632: "Enter", 1300: "ArrowLeft", 1360: "KeyZ" };
  for (let k = 700; k < 1300; k += 60) keys[k] = "KeyZ";
  for (let k = 1420; k < 1600; k += 60) keys[k] = "KeyZ";
  window.__bot = { f: 0, keys, log: [], lastScore: "", pressAt: -99, lastSwing: -99, serveAt: -99, idle: 0 };
});
const shots = [];
async function shot(name) {
  const base = `${out}/${String(shots.length).padStart(3, "0")}_${name}`;
  await page.evaluate(() => { window.__gb.view3d(true, location.search.includes("vox")); window.__gb.step(0); window.__gb.view3d(true, location.search.includes("vox")); });
  await page.evaluate(() => { const G = window.__gb; G.step(0); }); await page.locator("#gl").screenshot({ path: base + "_3d.png" });
  await page.evaluate(() => { window.__gb.view3d(false); window.__gb.step(0); }); await page.locator("#screen").screenshot({ path: base + "_2d.png" });
  shots.push(name);
}
// advance n frames with the bot; returns an event name when something worth a screenshot happened
async function run(n) {
  return await page.evaluate(n => {
    const G = window.__gb, B = window.__bot, gb = G.gb, w = gb.mem.wram[0], w4 = gb.mem.wram[4];
    const s16 = (b, a) => (b[a] | (b[a + 1] << 8)) << 16 >> 16, r32 = a => ((w[a] | (w[a + 1] << 8) | (w[a + 2] << 16) | (w[a + 3] << 24)) / 65536);
    let ev = null;
    for (let i = 0; i < n && !ev; i++) {
      const f = B.f;
      for (const [kf, code] of Object.entries(B.keys)) { if (f === +kf) G.keys[code] = true; if (f === +kf + 6) G.keys[code] = false; }
      const map = w[0x32E], inCourt = map <= 15;
      if (f > 1600) {
        // ---- bot: P1 in WRAM4; ball wC400/04/08 (16.16); ball speed wC42C (8.8); hit count wC4B6; landing wC450/52
        const px = s16(w4, 0xF01), py = s16(w4, 0xF04), bx = r32(0x400), by = r32(0x404), bz = r32(0x408);
        const speed = (w[0x42C] | (w[0x42D] << 8)) / 256, vy = (w[0x424] << 24 >> 24), hits = w[0x4B6];
        const near = py > 0, toward = speed > 0 && (near ? vy > 0 : vy < 0);
        G.keys.ArrowLeft = G.keys.ArrowRight = G.keys.ArrowUp = G.keys.ArrowDown = false;
        if (inCourt && speed > 0 && toward) {
          const lx = s16(w, 0x450), ly = s16(w, 0x452), tx = Math.abs(ly) < 2600 ? lx : bx, ty = Math.abs(ly) < 2600 ? ly : by;
          if (tx > px + 24) G.keys.ArrowRight = true; else if (tx < px - 24) G.keys.ArrowLeft = true;
          const goalY = Math.max(700, Math.min(1300, Math.abs(ty) + 80)) * (near ? 1 : -1);
          if (goalY > py + 40) G.keys.ArrowDown = true; else if (goalY < py - 40) G.keys.ArrowUp = true;
          const dy = Math.abs(by - py), dx = Math.abs(bx - px);
          if (dy < 120 + speed * 10 && dx < 140 && f - B.lastSwing > 40) { B.lastSwing = f; B.pressAt = f; }
        }
        if (inCourt && speed > 0 && !toward && Math.abs(bx - px) < 16 && Math.abs(by - py) < 16) {   // own toss: hit on the way down
          if (bz > B.lastBz && bz >= -300 && f - B.lastSwing > 40) { B.lastSwing = f; B.pressAt = f; }
        }
        B.lastBz = bz;
        if (inCourt && speed === 0) {                           // waiting (serve toss, between points): tap A every 50 frames
          if (f - B.serveAt > 50) { B.serveAt = f; B.pressAt = f; }
        } else if (!inCourt && f - B.serveAt > 90) { B.serveAt = f; B.pressAt = f; }   // results / dialogs
        if (f % 300 === 0) B.log.push(`dbg ${f} map ${map} p1 ${px},${py} ball ${bx | 0},${by | 0},${bz | 0} speed ${speed} vy ${vy} hits ${hits}`);
        G.keys.KeyZ = f - B.pressAt < 3;
      }
      G.step(1); B.f++;
      const score = `${w[0x8E0]}-${w[0x8E1]} s ${w[0x8E2]}-${w[0x8E3]} g ${w[0x8E4]}-${w[0x8E5]} p`;
      if (f > 1600 && score !== B.lastScore) { B.log.push(`${f} ${score} winner ${w[0x8E8]}`); B.lastScore = score; ev = "point"; B.after = f + 70; }
      if (B.after && f === B.after) { B.after = 0; ev = "caption"; }
      if (f > 1600 && f % 1500 === 0) ev = "rally";
      if (f === 400 || f === 700 || f === 1000 || f === 1180 || f === 1300 || f === 1540) ev = "menu";
      if (w[0x8E8] && !B.done) { B.done = f; ev = "matchend"; }
    }
    return { ev, f: B.f, map: w[0x32E], log: B.log.splice(0), done: B.done || 0 };
  }, n);
}
let st = { f: 0 }; let endAt = 0, vn = 0;
while (st.f < MAX) {
  if (vid && st.f >= vid[0] && st.f < vid[1]) {              // video window: step frame by frame, shoot every STEP frames
    await page.evaluate(() => { window.__gb.view3d(true, location.search.includes("vox")); });
    for (let k = 0; k < 100 && st.f < vid[1]; k += vid[2]) {
      st = await run(vid[2]); if (st.log.length) console.log(st.log.join("\n"));
      await page.locator("#gl").screenshot({ path: `${out}/video/${String(vn++).padStart(5, "0")}.png` });
      if (st.done && !endAt) endAt = st.f;
    }
    continue;
  }
  st = await run(100);
  if (st.log.length) console.log(st.log.join("\n"));
  if (st.ev) await shot(`${st.ev}_f${st.f}`);
  if (st.done && !endAt) endAt = st.f;
  if (endAt && st.f > endAt + 900) break;
}
console.log(JSON.stringify({ frames: st.f, done: st.done, shots: shots.length }));
await browser.close();
