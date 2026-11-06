// Pictures of the aim marks (web/js/hd/aimpower.js + aimdraw.js: the flight, the landing reticle, the roll, the rings, the tags, the
// putting view's break lines) in the situations that matter: a tee shot, an approach, a curved shot in the wind, a bunker shot and
// putts on several courses; on a desktop window, the Galaxy Z Fold8's inner and cover screens held upright and a phone on its side;
// in 3D and in 2D (+HD).
//   node web/tests/arc_shots.mjs [--root DIR] [--out DIR] [--only scen,scen] [--layouts desk,inner,...]
//     --root: the tree to serve (a copy of an older one for "before" pictures; default this project); --out: default out/arcs/after
// Files: <out>/<scenario>_<layout>_<mode>_<moment>.png. Sheets: tools/sheet.py.
import fs from "fs";
import path from "path";
import { HERE, serve, launch, LAYOUTS, openPage, holdAt, grab } from "./golfbot.mjs";

const args = process.argv.slice(2), arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const root = path.resolve(arg("--root", HERE)), outDir = path.resolve(HERE, arg("--out", "out/arcs/after"));
const only = arg("--only", null)?.split(","), lays = arg("--layouts", "desk,inner,cover,land").split(",");
fs.mkdirSync(outDir, { recursive: true });
const { server, port } = serve(root);
const browser = await launch();

const HD = "g3d=none&ui=hd&font=itim", D3 = "g3d=all";
// [name, query, plan, moments, modes per layout]
const SCEN = [
  ["tee", "course=1&hole=1", { seed: 4321, shots: [{}] }, [["aim", { shot: 0, phase: "aim", n: 75 }], ["addr", { shot: 0, phase: "address", n: 30 }]]],
  ["approach", "course=1&hole=1", { seed: 4321, shots: [{}, { aim: 8 }] }, [["aim", { shot: 1, phase: "aim", n: 75 }]]],
  ["wind", "course=3&hole=12", { seed: 2024, shots: [{ aim: 30 }] }, [["aim", { shot: 0, phase: "aim", n: 75 }]]],
  ["bunker", "course=1&hole=3", { seed: 5, shots: [{ aim: 12 }, { aim: -20, club: 1 }, { club: -1, mode: 1 }, {}, {}, {}] }, [["aim", { shot: 5, phase: "aim", n: 75 }]]],
  ["putt_dune2", "course=3&hole=2", { seed: 4321, putter: true, aimWait: -5, addrWait: 30, hold2: true, shots: [{ power: 52 }, {}] }, [["aim", { phase: "putt", n: 150 }]]],
  ["putt_links18", "course=4&hole=18", { seed: 4321, putter: true, aimWait: -5, addrWait: 30, hold2: true, shots: [{ power: 60 }, {}] }, [["aim", { phase: "putt", n: 150 }]]],
  ["putt_marion1", "course=1&hole=1", { seed: 4321, putter: true, aimWait: -5, addrWait: 30, hold2: true, shots: [{ power: 60 }, { power: 48 }, {}] }, [["aim", { phase: "putt", n: 150 }]]],
];
const MODES = { desk: [["3d", D3], ["2d", HD]], inner: [["3d", D3]], cover: [["3d", D3], ["2d", HD]], land: [["3d", D3]] };
const PHONE_SCEN = ["tee", "wind", "bunker", "putt_dune2"];

let ok = true;
for (const [name, q, plan, moments] of SCEN) {
  if (only && !only.includes(name)) continue;
  for (const lay of lays) {
    if (lay !== "desk" && !PHONE_SCEN.includes(name)) continue;
    for (const [mode, mq] of MODES[lay]) {
      const L = LAYOUTS[lay], { page, errors } = await openPage(browser, port, `${mq}&${q}`, L, plan, { "mg-deck": "art" });
      for (const [m, want] of moments) {
        const s = await holdAt(page, want);
        if (s.error) { console.log(name, lay, mode, m, "game error", s.error); ok = false; break; }
        const f = path.join(outDir, `${name}_${lay}_${mode}_${m}.png`);
        await grab(page, f, !!L.touch);
        const info = await page.evaluate(() => { const r = window.__aimPower && window.__aimPower.preview.res, w = window.__golf.w; return r ? `club ${w.wram[6][0x329]} lie ${w.wram[6][0x4CD]} carry ${r.carry} rest ${r.rest}` : "-"; });
        console.log(path.basename(f), JSON.stringify(s), info);
      }
      if (errors.length) { console.log(name, lay, mode, "page errors", errors.slice(0, 3)); ok = false; }
      await page.close();
    }
  }
}
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
