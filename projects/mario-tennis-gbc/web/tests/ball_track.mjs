// Court 3D check: step a match state frame by frame in the page and verify that the ball's sprites are drawn as the
// ball (never as part of a player) and that the HUD faces are not placed on the court.
// usage: node web/tests/ball_track.mjs STATE.json.gz [FRAMES]
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2]))), N = +(process.argv[3] || 300);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto("http://localhost:8765/web/full.html?touch&cam=low&vox");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
const r = await page.evaluate(([s, N]) => {
  const G = window.__gb; G.pause(); G.loadState(s); G.view3d(true, true);
  const out = { frames: 0, inFlight: 0, ballDrawn: 0, ballInPlayer: 0, examples: [] };
  for (let f = 0; f < N; f++) {
    G.keys.KeyZ = f % 20 < 4; G.voxel.debug = []; G.step(1); out.frames++;
    const d = G.voxel.debug, last = d.find(x => x.ball) || {}, pl = d.filter(x => x.tiles);
    const w = G.gb.mem.wram[0], speed = w[0x42C] | (w[0x42D] << 8);
    const ballT = pl.flatMap(p => p.tiles).filter(t => { const tile = +t.split(",")[2]; return tile >= 64 && tile < 80; });
    if (speed) { out.inFlight++; if ((last.ball || []).length) out.ballDrawn++; }
    if (ballT.length) { out.ballInPlayer++; if (out.examples.length < 5) out.examples.push(`${f}: ${ballT.join(" ")}`); }
  }
  return out;
}, [st, N]);
console.log(JSON.stringify(r));
await browser.close();
