// "VOX: Blocky / Rounded" (web/js/voxround.js): the rounded body mesh builder and the setting.
//  - the mesh is closed and bounded: every solid pixel has a front and a back, the outline a wall, nothing outside the sprite's box,
//  - the front keeps the pixel colours (a flat plateau of the body is exactly the sprite colour, the soft shade only moves it a little),
//  - it is thickest in the middle and thin at the rim, and cheap to build (a 3x Detailed body in a few ms),
//  - in the page: the VOX button toggles and is remembered, both styles draw a rally with no errors, and the game state is identical.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/voxround.mjs
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
import { roundedMeshData } from "../js/voxround.js";
const { chromium } = createRequire(import.meta.url)("playwright");
let bad = 0; const check = (name, ok, info = "") => { console.log(ok ? "ok  " : "FAIL", name, info); if (!ok) bad++; };
// a 16 x 24 test sprite: an ellipse body of one colour with a darker pixel in the middle and an isolated pixel
const W = 16, H = 24, img = new Uint8Array(W * H * 4); let solid = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const e = ((x - 7.5) / 7.5) ** 2 + ((y - 11.5) / 11.5) ** 2; if (e <= 1) { const o = (y * W + x) * 4; img[o] = 200; img[o + 1] = 120; img[o + 2] = 60; img[o + 3] = 255; solid++; } }
const mid = (12 * W + 8) * 4; img[mid] = 10; img[mid + 1] = 200; img[mid + 2] = 30;
const t0 = performance.now(); const d = roundedMeshData(img, W, H, 5, 4.5); const ms = performance.now() - t0;
let zmax = 0, zmin = 1e9, inBox = true, finite = true;
for (let i = 0; i < d.pos.length; i += 3) { const [x, y, z] = [d.pos[i], d.pos[i + 1], d.pos[i + 2]]; if (!isFinite(x + y + z)) finite = false; if (x < -W / 2 - 1e-6 || x > W / 2 + 1e-6 || y < -1e-6 || y > H + 1e-6) inBox = false; zmax = Math.max(zmax, Math.abs(z)); }
check("mesh is finite and inside the sprite box", finite && inBox, `${d.pos.length / 9} triangles`);
check("at least a front and a back triangle pair per solid pixel", d.pos.length / 9 >= solid * 4, `${solid} solid pixels`);
check("thickest in the middle, thin at the rim", zmax > 3.5 && zmax <= 4.5 + 1e-6, `max half-depth ${zmax.toFixed(2)}`);
// the front plateau: triangles on the front (all z > 0) near the middle with the colour of the pixel under them
let exact = 0, plateau = 0;
for (let i = 0; i < d.pos.length; i += 9) {
  if (!(d.pos[i + 2] > 0 && d.pos[i + 5] > 0 && d.pos[i + 8] > 0)) continue;
  const cx = (d.pos[i] + d.pos[i + 3] + d.pos[i + 6]) / 3 + W / 2, cy = H - (d.pos[i + 1] + d.pos[i + 4] + d.pos[i + 7]) / 3;
  if (Math.hypot(cx - 8, cy - 12) > 3 || Math.hypot(cx - 8.5, cy - 12.5) < 1.2) continue;
  plateau++; const r = d.col[i] * 255, g = d.col[i + 1] * 255; if (Math.abs(r - 200) < 200 * 0.12 && Math.abs(g - 120) < 120 * 0.12) exact++;
}
check("front colours stay the sprite's colours (soft shade within 12%) at the centre", plateau > 10 && exact === plateau, `${exact} / ${plateau}`);
check("the same input builds the same mesh", (() => { const e = roundedMeshData(img, W, H, 5, 4.5); return e.pos.length === d.pos.length && e.col.every((v, i) => v === d.col[i]); })());
const big = new Uint8Array(48 * 72 * 4); for (let y = 0; y < 72; y++) for (let x = 0; x < 48; x++) { if (((x - 23.5) / 23.5) ** 2 + ((y - 35.5) / 35.5) ** 2 <= 1) { const o = (y * 48 + x) * 4; big[o] = big[o + 1] = 180; big[o + 2] = 90; big[o + 3] = 255; } }
const tb = performance.now(); roundedMeshData(big, 48, 72, 15, 13.5); const msb = performance.now() - tb;
check("a 3x Detailed body builds in a few ms (once per frame, cached)", msb < 120 && ms < 25, `${ms.toFixed(1)} ms / ${msb.toFixed(1)} ms`);
// the page
const readRec = f => { const raw = fs.readFileSync(f); return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString()); };
const rec = readRec("out/engine/rec1.mtrec");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gl-blocklist", "--ignore-gpu-blocklist"] }).catch(() => chromium.launch());
async function run(style) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } }); const errors = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:8765/web/full.html?vox&smooth=0&voxstyle=${style}`);
  await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.voxel, null, { timeout: 60000, polling: 200 }); await page.waitForTimeout(800);
  const out = await page.evaluate(async rec => {
    const { stateOf } = await import("/web/js/recorder.js"); const G = window.__gb, V = G.voxel; G.pause(true); G.loadState(rec.start);
    const inp = Uint8Array.from(atob(rec.inputs), c => c.charCodeAt(0));
    for (let f = 0; f < 5800; f++) { G.gb.setInput(stateOf(inp[f] || 0)); G.gb.runFrame(); V.tick(); if (f >= 5700) V.render(null, 1); }
    const m = G.gb.mem; let h = 0; for (const b of [...m.wram, ...m.vram, m.oam]) for (let i = 0; i < b.length; i++) h = (Math.imul(h, 31) + b[i]) | 0;
    return { hash: G.frameHash(), ram: h, rounded: V.rounded, meshes: V.objectMeshes.size, btn: document.getElementById("voxstylebtn").textContent };
  }, rec);
  let stored = null; if (style === "rounded") { await page.evaluate(() => document.getElementById("voxstylebtn").dispatchEvent(new PointerEvent("pointerdown"))); stored = await page.evaluate(() => [localStorage.getItem("mt-voxstyle"), window.__gb.voxel.rounded, document.getElementById("voxstylebtn").textContent]); }
  await page.close(); return { ...out, stored, errors };
}
const A = await run("rounded"), B = await run("blocky");
check("both styles draw a rally with no errors", !A.errors.length && !B.errors.length && A.meshes > 0 && B.meshes > 0, [...A.errors, ...B.errors].slice(0, 2).join(" | ") || `${A.meshes} / ${B.meshes} cached bodies`);
check("game state identical in both styles", A.hash === B.hash && A.ram === B.ram, `${A.hash} / ${B.hash}`);
check("button shows the style", A.rounded === true && A.btn === "VOX: Rounded" && B.rounded === false && B.btn === "VOX: Blocky", `${A.btn} / ${B.btn}`);
check("button toggles and is remembered", A.stored && A.stored[0] === "blocky" && A.stored[1] === false && A.stored[2] === "VOX: Blocky", JSON.stringify(A.stored));
await browser.close(); process.exit(bad ? 1 : 0);
