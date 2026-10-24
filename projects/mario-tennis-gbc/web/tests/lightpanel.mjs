// The LIGHT settings panel (web/js/lightpanel.js, lighting.js settings): the panel opens from the LIGHT button and everything in it is remembered
// (localStorage mt-lightcfg); matches can be Day / Night / Random (seeded by the frame the match starts at: the same on a replay, varied between
// matches); the effect toggles change the picture; none of it changes the game (frame hash identical).
// usage: (python3 -m http.server 8765 from the project root) node web/tests/lightpanel.mjs
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const readRec = f => { const raw = fs.readFileSync(f); return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString()); };
const rec = readRec("out/engine/rec1.mtrec");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } }), errors = [];
async function open(url) {
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url); await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.voxel && window.__gb.voxel.light, null, { timeout: 60000, polling: 200 }); await page.waitForTimeout(500); return page;
}
const play = (page, F) => page.evaluate(async ([rec, F]) => {
  const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb; G.pause(true); G.loadState(rec.start);
  const inp = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0)); for (let f = 0; f < F; f++) { G.gb.setInput(stateOf(inp[f] || 0)); G.gb.runFrame(); G.voxel.tick(); }
  G.step(1); G.step(1); return { hour: G.voxel.light.sky && G.voxel.light.sky.h, hash: G.frameHash(), lamps: G.voxel.light.sky && G.voxel.light.sky.lamps };
}, [rec, F]);
let page = await open("http://localhost:8765/web/full.html?vox&smooth=0");
check("LIGHT button opens the panel", await page.evaluate(() => { document.getElementById("lightbtn").dispatchEvent(new PointerEvent("pointerdown")); return !document.getElementById("lightpanel").hidden && document.querySelectorAll("#lightpanel .card").length >= 4; }));
await page.evaluate(() => { document.getElementById("lightbtn").dispatchEvent(new PointerEvent("pointerdown")); });
const clickPill = (p, text, sec = "Matches") => p.evaluate(([t, sec]) => { const c = [...document.querySelectorAll("#lightpanel .card")].find(x => x.firstChild.textContent.startsWith(sec)); [...c.querySelectorAll(".pill")].find(x => x.textContent.startsWith(t)).click(); }, [text, sec]);
await page.evaluate(() => document.getElementById("lightbtn").dispatchEvent(new PointerEvent("pointerdown")));
await clickPill(page, "Day", "Overworld");                       // overworld: Day
await clickPill(page, "Night");                                  // matches: Night
const night = await play(page, 5792);
check("Matches: Night lights the court at night", night.lamps > 0.9 && night.hour >= 21, JSON.stringify([night.hour, night.lamps]));
await clickPill(page, "Day");
const day = await play(page, 5792); check("Matches: Day", day.lamps === 0, JSON.stringify([day.hour, day.lamps]));
check("the game is untouched (same frame hash)", night.hash === day.hash, night.hash);
// effects: shadows off changes the picture
const shot = async () => (await page.locator("#gl").screenshot()).toString("base64").length;
const withFx = await page.evaluate(() => { const L = window.__gb.voxel.light; L.setFx("shadows", false); L.setFx("vignette", false); L.setFx("bloom", false); L.setFx("tilt", false); L.setFx("night", false); window.__gb.step(1); window.__gb.step(1); return JSON.stringify(L.cfg.fx); });
check("effect toggles are stored", withFx === JSON.stringify({ shadows: false, bloom: false, tilt: false, vignette: false, night: false }), withFx);
await page.evaluate(() => { const L = window.__gb.voxel.light; L.setQuality("medium"); L.setCustomHour(6.5); });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mt-lightcfg")));
check("settings are remembered in localStorage", stored.matches === "day" && stored.quality === "medium" && stored.fx.night === false && stored.customHour === 6.5, JSON.stringify(stored).slice(0, 140));
await page.close();
page = await open("http://localhost:8765/web/full.html?vox&smooth=0");
const back = await page.evaluate(() => { const L = window.__gb.voxel.light; return JSON.stringify([L.cfg.matches, L.cfg.quality, L.tier, L.cfg.fx.night, L.cfg.world]); });
check("... and come back after a reload", back === JSON.stringify(["day", "medium", 1, false, "day"]), back);
// random: seeded by the frame the match scene starts at: the same twice, and varied over start frames
await page.evaluate(() => { const L = window.__gb.voxel.light; L.setMatches("random"); L.setWorld("clock"); for (const k of Object.keys(L.cfg.fx)) L.setFx(k, true); });
const hrs = await page.evaluate(() => { const L = window.__gb.voxel.light, out = []; for (let fr = 1000; fr < 1000 + 24 * 1000; fr += 1000) { L.matchAt = -1; L.v.gb.ppu.frames = fr; L.activeFor("court"); out.push(L.matchHour); } const a = [], b = []; for (const fr of [5000, 5000]) { L.matchAt = -1; L.v.gb.ppu.frames = fr; L.activeFor("court"); a.push(L.matchHour); } return { out, same: a[0] === a[1] }; });
check("Random: the same start frame rolls the same time, other matches roll different ones", hrs.same && new Set(hrs.out).size === 4, JSON.stringify(hrs.out));
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close(); process.exit(bad ? 1 : 0);
