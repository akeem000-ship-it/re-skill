// The portrait deck's shot map (web/js/hd/deckmap.js) on web/play.html in headless Chromium, with the Galaxy Z Fold8's screens held
// upright (the cover screen ~412 x 960 CSS px, the inner one ~906 x 1088) and a scripted golfer (golfbot.mjs).
//   node web/tests/deck_map.mjs                the check: perfect full swings (and full putts) on several holes; at the address the
//                                              map's landing and rest marks (window.__deckMap.marks, the world spots it drew them
//                                              at) must be the shot preview's, and the rest mark must be where the ball really came
//                                              to rest, to the last fraction; the full putt's stop likewise; the map draws only when
//                                              something changed (its draws counted while the game is held)
//   node web/tests/deck_map.mjs --shots [--root DIR] [--out DIR] [--only a,b]   pictures: aiming, the flight, putting, menus
import fs from "fs";
import path from "path";
import { HERE, serve, launch, LAYOUTS, openPage, holdAt, grab } from "./golfbot.mjs";

const args = process.argv.slice(2), arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const shots = args.includes("--shots");
const root = path.resolve(arg("--root", HERE)), outDir = path.resolve(HERE, arg("--out", "out/deckmap/after"));
const only = arg("--only", null)?.split(",");
const { server, port } = serve(root);
const browser = await launch();
let ok = true;

if (shots) {
  fs.mkdirSync(outDir, { recursive: true });
  const P = { seed: 4321, putter: true, aimWait: -5, addrWait: 30, hold2: true };
  const SCEN = [
    ["tee", "course=1&hole=1", { seed: 4321, shots: [{}, {}] }, [["aim", { shot: 0, phase: "aim", n: 75 }], ["flight30", { shot: 0, phase: "flight", n: 30 }], ["flight90", { shot: 0, phase: "flight", n: 90 }], ["second", { shot: 1, phase: "aim", n: 75 }]]],
    ["wind", "course=3&hole=12", { seed: 2024, shots: [{ aim: 30 }] }, [["aim", { shot: 0, phase: "aim", n: 75 }]]],
    ["water", "course=2&hole=1", { seed: 777, shots: [{ aim: -14 }, { club: 1 }] }, [["aim", { shot: 0, phase: "aim", n: 75 }], ["second", { shot: 1, phase: "aim", n: 75 }]]],
    ["putt", "course=3&hole=2", { ...P, shots: [{ power: 52 }, {}] }, [["aim", { phase: "putt", n: 150 }]]],
    ["putt2", "course=4&hole=18", { ...P, shots: [{ power: 60 }, {}] }, [["aim", { phase: "putt", n: 150 }]]],
  ];
  for (const [name, q, plan, moments] of SCEN) {
    if (only && !only.includes(name)) continue;
    for (const [lay, mode, mq] of [["cover", "3d", "g3d=all"], ["inner", "3d", "g3d=all"], ["cover", "2d", "g3d=none&ui=hd&font=itim"]]) {
      if (mode === "2d" && name !== "tee" && name !== "putt") continue;
      const L = LAYOUTS[lay], { page, errors } = await openPage(browser, port, `${mq}&${q}`, L, plan);
      for (const [m, want] of moments) {
        const s = await holdAt(page, want);
        if (s.error) { console.log(name, lay, m, "game error", s.error); ok = false; break; }
        const f = path.join(outDir, `${name}_${lay}_${mode}_${m}.png`);
        await grab(page, f, true);
        console.log(path.basename(f), JSON.stringify(s), await page.evaluate(() => JSON.stringify(window.__deckMap ? { draws: window.__deckMap.draws, marks: window.__deckMap.marks && { rest: window.__deckMap.marks.restY, carry: window.__deckMap.marks.carry } } : null)));
      }
      if (errors.length) { console.log(name, lay, "page errors", errors.slice(0, 3)); ok = false; }
      await page.close();
    }
  }
  // outside golf: the menus keep the art
  if (!only || only.includes("menus")) for (const lay of ["cover", "inner"]) {
    const L = LAYOUTS[lay], [vw, vh] = L.viewport;
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: L.dpr, hasTouch: true, isMobile: true });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`http://localhost:${port}/web/play.html?g3d=all&touch=1`);
    await page.waitForFunction(() => window.__golf && window.__golf.frames > 400, null, { timeout: 120000 });
    await grab(page, path.join(outDir, `menus_${lay}.png`), true);
    console.log(`menus_${lay}.png`, await page.evaluate(() => window.__deckMap && window.__deckMap.active));
    await page.close();
  }
} else {
  // the check
  const CASES = [
    { q: "g3d=none&course=1&hole=1", seed: 4321, shots: [{}, { aim: 8 }, {}, {}, {}] },
    { q: "g3d=all&g3dq=lite&course=2&hole=1", seed: 777, shots: [{ aim: -14 }, { club: 1 }] },
    { q: "g3d=none&ui=hd&course=3&hole=5", seed: 4242, shots: [{ aim: 20 }, { aim: -10 }, {}, {}] },
    { q: "g3d=none&course=1&hole=7", seed: 31337, shots: [{ aim: -25, club: 1 }, { aim: 30 }, {}, {}] },
    { q: "g3d=none&course=3&hole=2", seed: 4321, putter: true, aimWait: -5, addrWait: 30, hold2: true, shots: [{ power: 52 }, {}, {}] },
  ];
  let n = 0, same = 0;
  for (const C of CASES) {
    const { page, errors } = await openPage(browser, port, C.q, LAYOUTS.cover, C);
    const want = C.shots.length;
    await page.waitForFunction(n => window.__bot.log.length >= n || window.__golf.error || window.__golf.done, want, { timeout: 900000, polling: 500 });
    const r = await page.evaluate(() => ({ log: window.__bot.log, error: window.__golf.error, portrait: document.body.classList.contains("portrait") }));
    for (const s of r.log) {
      if (!s.full) continue;
      const d = s.deck, pv = s.pv, real = s.real;
      const restMark = d && (d.rest || (d.putts && d.putts[0].end));
      const pvSame = d && pv && restMark && restMark[0] === pv.end[0] && restMark[1] === pv.end[1] && (!d.land || (d.land[0] === pv.land[0] && d.land[1] === pv.land[1])) && (d.restY === undefined || (d.restY === pv.rest && d.carry === pv.carry));
      const realSame = restMark && real && restMark[0] === real[0] && restMark[1] === real[1];
      n++; if (pvSame && realSame) same++; else ok = false;
      console.log(`${C.q} shot ${s.shot + 1}: club ${s.club}: map rest (${restMark ? restMark.map(v => v.toFixed(3)).join(", ") : "-"})${d && d.restY !== undefined ? ` ${d.restY} y carry ${d.carry}` : ""}; preview ${pvSame ? "same" : "DIFFERS"}; real (${real ? real.map(v => v.toFixed(3)).join(", ") : "-"}) ${realSame ? "SAME" : "differs"}`);
    }
    // held: the map draws only when something changed
    await holdAt(page, { shot: r.log.length, phase: "aim", n: 70 }).catch(() => null);
    // (first settled: the pan and zoom to the new shot can take seconds of software rendering here)
    await page.evaluate(() => new Promise(r => { const d = window.__deckMap; let last = d.draws, at = performance.now(); const t0 = at;
      const chk = () => { if (d.draws !== last) { last = d.draws; at = performance.now(); } if (performance.now() - at > 1000 || performance.now() - t0 > 30000) r(); else setTimeout(chk, 100); }; chk(); }));
    const d0 = await page.evaluate(() => window.__deckMap.draws); await page.waitForTimeout(1500);
    const d1 = await page.evaluate(() => window.__deckMap.draws);
    console.log(`  portrait ${r.portrait}; map draws while held 1.5 s: ${d1 - d0}`);
    if (!r.portrait || d1 - d0 > 0) ok = false;
    if (r.error || errors.length) { console.log("  errors", r.error, errors.slice(0, 3)); ok = false; }
    await page.close();
  }
  console.log(`${ok ? "ok  " : "FAIL"} deck map: ${same} of ${n} perfect full shots: the map's marks are the preview's and the ball came to rest at the map's rest mark`);
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
