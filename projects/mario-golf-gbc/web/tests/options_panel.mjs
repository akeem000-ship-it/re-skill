// The OPTIONS screen (web/js/hd/options.js) on web/play.html in headless Chromium.
//   node web/tests/options_panel.mjs           the check: on the Fold8's cover screen inside the MTenn3D app (its user agent: Back opens the
//                                              button bar, OPTIONS there the screen), on a computer (the OPTIONS button, then the keys): every
//                                              category is visited and one setting changed in each; the change must take effect (the
//                                              page's own objects), be kept in localStorage under the key it always used, and still be
//                                              there after a reload; the URL parameters must still set the options (and win over the
//                                              stored ones); the game keeps running while the screen is open, and gets no keys from it
//   node web/tests/options_panel.mjs --shots [--only cover,innerp,innerl,desk]   pictures of every category: the Fold8's cover screen, its inner screen upright and
//                                              sideways, a computer; in the app (its user agent) and standalone: out/options/
import fs from "fs";
import path from "path";
import { HERE, serve, launch } from "./golfbot.mjs";

const args = process.argv.slice(2);
const { server, port } = serve(HERE);
const browser = await launch();
const APP_UA = "Mozilla/5.0 (Linux; Android 16; SM-F976B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 MarioTennisWrapper MarioGolfWrapper";
const LAY = {
  cover: { viewport: [412, 960], touch: true, dpr: 2.625 },
  innerp: { viewport: [906, 1088], touch: true, dpr: 2 },
  innerl: { viewport: [1088, 906], touch: true, dpr: 2 },
  desk: { viewport: [1280, 900] },
};
const CATS = ["PLAY", "PICTURE", "3D VIEW", "EFFECTS", "STORY", "CONTROLS", "SOUND", "ABOUT"];
let ok = true;
const fail = (...m) => { ok = false; console.log("FAIL", ...m); };

async function open(lay, app, q = "", keep = false, ctxIn = null) {
  const L = LAY[lay], [w, h] = L.viewport;
  const ctx = ctxIn || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: L.dpr || 1, hasTouch: !!L.touch, isMobile: !!L.touch,
    ...(app ? { userAgent: APP_UA } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (!keep) await page.addInitScript(() => { if (!sessionStorage.getItem("kept")) { localStorage.clear(); sessionStorage.setItem("kept", "1"); } });
  const touch = L.touch && !app ? "touch=1&" : "";
  await page.goto(`http://localhost:${port}/web/play.html?${touch}${q}`);
  await page.waitForFunction(() => window.__golf && window.__golf.frames > 30 && window.__options, null, { timeout: 60000 });
  return { ctx, page, errors };
}
// the screen opened as a player would: the app's Back (the bar) or the gear, then OPTIONS; on a computer the OPTIONS button
async function openOptions(page, lay, app, force = false) {
  if (LAY[lay].touch) {
    if (app) await page.evaluate(() => window.__backPressed());
    else await page.click("#hdgear", { force });
    await page.waitForSelector("body.showside #mgside", { state: "visible" });
    await page.click("#mgside button:has-text('OPTIONS')", { force });
  } else await page.click("#optsbtn", { force });
  await page.waitForSelector("body.showopts #mgopts", { state: "visible" });
}
const tab = (page, c) => page.click(`#mgopts .mo-tab:has-text("${c}")`);
// (the pictures: a tap by the page's own click, as the 3D view under the screen can keep a slow software renderer too busy for a "stable" element)
const tabNow = (page, c) => page.evaluate(c => [...document.querySelectorAll("#mgopts .mo-tab")].find(t => t.textContent === c).click(), c);
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))));

if (args.includes("--shots")) {
  const out = path.join(HERE, "out/options"); fs.mkdirSync(out, { recursive: true });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;   // (--only cover,desk: some layouts)
  for (const lay of Object.keys(LAY)) for (const app of [true, false]) {
    if (only && !only.includes(lay)) continue;
    const { ctx, page, errors } = await open(lay, app, "g3d=off");   // (the 2D picture behind: a software renderer takes most of a minute over each picture of the 3D view under the blur)
    await page.evaluate(() => { const m = document.getElementById("mode"); m.value = "stroke"; m.dispatchEvent(new Event("change")); });
    await page.evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { code: "Space" })));   // (fast to the first aim)
    await page.waitForFunction(() => window.__golf.mark === "aim" || window.__golf.frames > 1500, null, { timeout: 600000, polling: 250 });
    await page.evaluate(() => dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
    await openOptions(page, lay, app, true);
    for (const c of CATS) {
      await tabNow(page, c);
      if (c === "ABOUT") await page.evaluate(() => { const d = document.querySelector("#mgopts .mo-about details:last-of-type"); if (d) d.open = true; });
      await settle(page);
      const f = `${lay}_${app ? "app" : "web"}_${c.toLowerCase().replace(/\W+/g, "")}.png`;
      await page.screenshot({ path: path.join(out, f), timeout: 120000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll("#mgopts .mo-row")].some(r => r.offsetParent && r.getBoundingClientRect().right > innerWidth + 1));
      console.log(f, over ? "WIDER THAN THE SCREEN" : "");
      if (over) ok = false;
    }
    // the bar too (touch), the page with the screen closed
    await page.evaluate(() => document.querySelector("#mgopts .mo-close").click());
    await settle(page);
    await page.screenshot({ path: path.join(out, `${lay}_${app ? "app" : "web"}_closed.png`), timeout: 240000 });
    if (errors.length) fail(lay, app, errors.slice(0, 3));
    await ctx.close();
  }
} else {
  // ---- 1. the app on the cover screen: every category, one change in each ----
  {
    const { ctx, page, errors } = await open("cover", true);
    await openOptions(page, "cover", true);
    const f0 = await page.evaluate(() => window.__golf.frames);
    const store = () => page.evaluate(() => ({ ...localStorage }));
    // PLAY: the swing meter
    await tab(page, "PLAY"); await page.selectOption("#apmeter", "game");
    // PICTURE: the view
    await tab(page, "PICTURE"); await page.selectOption("#hdview", "wide");
    // 3D VIEW: the 3D view on, the camera TV
    await tab(page, "3D VIEW"); await page.click('.mo-row[data-id="g3d-view3d"] .mo-toggle'); await page.selectOption("#g3dcam", "tv");
    // EFFECTS: replay off
    await tab(page, "EFFECTS"); await page.click('.mo-row[data-id="g3d-replay"] .mo-toggle');
    // STORY: field life off
    await tab(page, "STORY"); await page.click('.mo-row[data-id="g3d-fieldlife"] .mo-toggle');
    // CONTROLS: the d-pad
    await tab(page, "CONTROLS"); await page.selectOption("#hdpad", "dpad");
    // SOUND: off
    await tab(page, "SOUND"); await page.selectOption("#optsound", "off");
    // ABOUT: the 3D view's news unfold
    await tab(page, "ABOUT"); await page.click("#mgopts .g3dnotes summary");
    await page.waitForFunction(() => document.querySelector("#mgopts .g3dnotes h3"), null, { timeout: 10000 });
    await settle(page);
    const s = await store(), mg3d = JSON.parse(s.mg3d || "{}");
    const live = await page.evaluate(() => ({ view: window.__hd.view.view, v3: window.__g3d.L.on("view3d"), cam: window.__g3d.L.camera, replay: window.__g3d.L.on("replay"),
      life: window.__g3d.L.on("fieldlife"), stick: document.body.classList.contains("stick"), muted: window.__options.muted,
      meter: document.getElementById("apmeter").value, frames: window.__golf.frames, visible: [...document.querySelectorAll("#mgopts .mo-sec")].filter(x => !x.hidden).length }));
    console.log("cover app", JSON.stringify(live), JSON.stringify({ meter: s["mg-meter"], view: s["mg-view"], pad: s["mg-pad"], mg3d }));
    if (live.view !== "wide" || s["mg-view"] !== "wide") fail("PICTURE view");
    if (live.meter !== "game" || s["mg-meter"] !== "game") fail("PLAY meter");
    if (!live.v3 || !mg3d.on.view3d || live.cam !== "tv" || mg3d.camera !== "tv") fail("3D VIEW");
    if (live.replay || mg3d.on.replay !== false) fail("EFFECTS replay");
    if (live.life || mg3d.on.fieldlife !== false) fail("STORY field life");
    if (live.stick || s["mg-pad"] !== "dpad") fail("CONTROLS pad");
    if (!live.muted) fail("SOUND");
    if (live.visible !== 1) fail("one category at a time");
    if (live.frames <= f0 + 30) fail("the game kept running", f0, live.frames);
    // Back closes it; Back again opens the bar (GAMES there in the app)
    await page.evaluate(() => window.__backPressed());
    if (await page.evaluate(() => document.body.classList.contains("showopts"))) fail("Back closes the options");
    await page.evaluate(() => window.__backPressed());
    if (!(await page.isVisible("#mgside button:has-text('GAMES')"))) fail("GAMES on the app's bar");
    await page.evaluate(() => window.__backPressed());
    // reload: everything kept (the stored settings read back as before)
    await page.reload();
    await page.waitForFunction(() => window.__golf && window.__golf.frames > 30 && window.__options, null, { timeout: 60000 });
    const back = await page.evaluate(() => ({ view: window.__hd.view.view, meter: document.getElementById("apmeter").value, v3: window.__g3d.L.on("view3d"), cam: document.getElementById("g3dcam").value,
      replay: document.getElementById("g3d-replay").checked, life: document.getElementById("g3d-fieldlife").checked, pad: document.getElementById("hdpad").value, cat: window.__options.state.cat }));
    console.log("after a reload", JSON.stringify(back));
    if (back.view !== "wide" || back.meter !== "game" || !back.v3 || back.cam !== "tv" || back.replay || back.life || back.pad !== "dpad") fail("kept after a reload");
    if (errors.length) fail("page errors", errors.slice(0, 3));
    await ctx.close();
  }
  // ---- 2. settings saved by an older page (the same keys), and the URL parameters over them ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear();
      localStorage.setItem("mg-view", "4:3"); localStorage.setItem("mg-font", "itim"); localStorage.setItem("mg-preview", "off");
      localStorage.setItem("mg3d", JSON.stringify({ on: { view3d: true, sky: false }, quality: "lite", camera: "behind", hour: "21", trees: "original", grass: "pixel", sand: "pixel", putting: "follow", green: "arrows" })); } });
    const { page, errors } = await open("desk", false, "", true, ctx);
    const old = await page.evaluate(() => ({ view: document.getElementById("hdview").value, font: document.getElementById("hdfont").value, pv: document.getElementById("appreview").value,
      v3: document.getElementById("g3d-view3d").checked, sky: document.getElementById("g3d-sky").checked, q: document.getElementById("g3dq").value, cam: document.getElementById("g3dcam").value,
      hour: document.getElementById("g3dhour").value, trees: document.getElementById("g3dtrees").value, putt: document.getElementById("g3dputt").value, green: document.getElementById("g3dgreen").value }));
    console.log("an older page's settings", JSON.stringify(old));
    if (old.view !== "4:3" || old.font !== "itim" || old.pv !== "off" || !old.v3 || old.sky || old.q !== "lite" || old.cam !== "behind" || old.hour !== "21" || old.trees !== "original" || old.putt !== "follow" || old.green !== "arrows") fail("an older page's settings");
    await page.goto(`http://localhost:${port}/web/play.html?view=fill&font=kode&ui=hd&meter=game&g3d=off&g3dcam=course&g3dq=full&g3dputt=green&course=3&hole=7`);
    await page.waitForFunction(() => window.__golf && window.__golf.frames > 30 && window.__options, null, { timeout: 60000 });
    const url = await page.evaluate(() => ({ view: window.__hd.view.view, font: window.__hd.view.font, ui: window.__hd.view.ui, meter: document.getElementById("apmeter").value,
      v3: window.__g3d.L.on("view3d"), cam: window.__g3d.L.camera, q: document.getElementById("g3dq").value, putt: document.getElementById("g3dputt").value,
      course: document.getElementById("optcourse").value, hole: document.getElementById("opthole").value }));
    console.log("URL parameters", JSON.stringify(url));
    if (url.view !== "fill" || url.font !== "kode" || url.ui !== "hd" || url.meter !== "game" || url.v3 || url.cam !== "course" || url.q !== "full" || url.putt !== "green" || url.course !== "3" || url.hole !== "7") fail("URL parameters");
    // the Stroke start from the URL's course and hole (PLAY: START Stroke)
    await page.evaluate(() => { const m = document.getElementById("mode"); m.value = "stroke"; m.dispatchEvent(new Event("change")); });
    await page.waitForFunction(() => window.__golf.w.wram[0][0x837] > 0, null, { timeout: 60000 });
    const hole = await page.evaluate(() => window.__golf.w.wram[0][0x837]);
    console.log("Stroke start: hole", hole);
    if (hole !== 7) fail("the URL's hole");
    // ---- 3. the keys: O opens it, the arrows and Z / X drive it, the game gets none of them ----
    await page.keyboard.press("KeyO");
    await page.waitForSelector("body.showopts #mgopts", { state: "visible" });
    const before = await page.evaluate(() => ({ frames: window.__golf.frames, cat: window.__options.state.cat }));
    const press = async k => { await page.keyboard.down(k); await settle(page); await page.keyboard.up(k); await settle(page); };
    // to PICTURE (from wherever it opened), into it, ▶ on its first row (VIEW: the next value), B, B
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__options.state.cat)) !== 1; i++) await press("ArrowDown");
    await press("KeyZ");
    const v0 = await page.evaluate(() => window.__hd.view.view);
    await press("ArrowRight");
    const v1 = await page.evaluate(() => ({ view: window.__hd.view.view, stored: localStorage.getItem("mg-view"), inCat: window.__options.state.inCat, cur: document.querySelector("#mgopts .mo-row.cur")?.dataset.id }));
    console.log("keys: PICTURE > VIEW", v0, "->", JSON.stringify(v1));
    if (v1.view === v0 || v1.stored !== v1.view || !v1.inCat || v1.cur !== "hdview") fail("the keys change a setting");
    await press("KeyX");
    if (await page.evaluate(() => window.__options.state.inCat)) fail("B back to the categories");
    await press("KeyX");
    const after = await page.evaluate(() => ({ open: window.__options.isOpen, frames: window.__golf.frames }));
    if (after.open) fail("B on the categories closes");
    if (after.frames <= before.frames + 10) fail("the game ran while it was open");
    await page.keyboard.press("KeyO"); await page.keyboard.press("Escape");
    if (await page.evaluate(() => window.__options.isOpen)) fail("Escape closes");
    if (errors.length) fail("page errors", errors.slice(0, 3));
    await ctx.close();
  }
}
await browser.close(); server.close();
console.log(ok ? "options panel: OK" : "options panel: FAILED");
process.exit(ok ? 0 : 1);
