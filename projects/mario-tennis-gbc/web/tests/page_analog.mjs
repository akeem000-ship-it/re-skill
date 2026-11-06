// STICK FEEL: Analog on the page (web/full.html, CODE: PORT) in headless Chromium: the stored "walk" feel becomes
// "analog"; a recorded exhibition is played into the page frame by frame (paused, __gb.step) to a rally, then the
// touch stick is pushed at 22 degrees below right, half way: the port gets the stick's angle and tilt (port.analog),
// your player faces that way, the session log has the stick events and replays exactly (replay.mjs), and quick save says
// it needs CODE: ROM.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/page_analog.mjs [REC.mtrec] [FRAME]
import fs from "fs"; import zlib from "zlib"; import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [recPath = "out/engine/exh1.mtrec", at = "3000"] = process.argv.slice(2);
const raw = fs.readFileSync(recPath), rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
const inputs = [...Buffer.from(rec.inputs, "base64").subarray(0, +at)];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { localStorage.setItem("mt-engine", "port"); localStorage.setItem("mt-stickfeel", "walk"); localStorage.setItem("mt-reset-0.35.18", "1"); localStorage.setItem("mt-3d", "off"); });   // (2D: the 3D view is slow in headless Chromium)
await page.goto("http://localhost:8765/web/full.html");
await page.waitForFunction(() => window.__gb && window.__gb.port && window.__gb.gb, null, { timeout: 60000 });
const r = await page.evaluate(async inputs => {
  const G = window.__gb, S = await import("./js/stick.js"), K = G.keys;
  G.pause(true);
  const feel0 = S.stickFeel, btn = document.getElementById("stickfeelbtn").textContent;
  const names = [["KeyZ", 1], ["KeyX", 2], ["ShiftRight", 4], ["Enter", 8], ["ArrowRight", 16], ["ArrowLeft", 32], ["ArrowUp", 64], ["ArrowDown", 128]];
  for (const m of inputs) { for (const [k, b] of names) K[k] = !!(m & b); G.step(1); }
  for (const [k] of names) K[k] = false;
  const P = G.port, me = [4, 5, 6, 7].find(k => [0, 2, 3].includes(P.gb.mem.wram[k][0xF1E]));
  const x = Math.cos(22.5 * Math.PI / 180) * 0.53, y = Math.sin(22.5 * Math.PI / 180) * 0.53;   // half way between the dead zone and full
  S.STICK.x = x; S.STICK.y = y; S.STICK.src = "touch"; S.STICK.held = true; S.STICK.at = performance.now();
  G.step(30);
  const analog = P.analog, facing = P.gb.mem.wram[me][0xF0D];
  S.STICK.x = 0; S.STICK.y = 0; S.STICK.src = ""; S.STICK.held = false; G.step(2);
  const after = P.analog;
  document.getElementById("qsave1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await new Promise(ok => setTimeout(ok, 100));
  const hint = [...document.body.children].filter(d => d.tagName === "DIV" && /quick save/i.test(d.textContent)).map(d => d.textContent).join(" ");
  return { feel0, btn, analog, facing, after, hint };
}, inputs);
// the session log (the REC button's recording from power-on) has the stick's events
const ev = await page.evaluate(() => { const s = window.__gb.session; return s ? s.events.filter(([, e]) => typeof e === "string" && e.startsWith("stick:")) : null; });
// the session as REC would save it (meta.from 0), replayed in Node (web/tests/replay.mjs): exact with the stick's events
const snap = await page.evaluate(() => { const G = window.__gb; return JSON.stringify(G.session.snapshot(G.gb, "")); });
fs.mkdirSync("out", { recursive: true }); fs.writeFileSync("out/page_analog.mtrec", zlib.gzipSync(snap));
const { execFileSync } = await import("child_process");
const rep = JSON.parse(execFileSync("node", ["web/tests/replay.mjs", "out/page_analog.mtrec"], { encoding: "utf8" }).trim().split("\n").pop());
const fail = [];
if (!rep.exact || !rep.hashChecks) fail.push(`the session's replay: ${JSON.stringify({ exact: rep.exact, hashChecks: rep.hashChecks, firstMismatchFrame: rep.firstMismatchFrame })}`);
if (r.feel0 !== "analog") fail.push(`stored "walk" read as ${r.feel0}`);
if (!/Analog/.test(r.btn)) fail.push(`button: ${r.btn}`);
if (!r.analog || r.analog.facing !== 16 || r.analog.speed !== 0.5) fail.push(`port.analog ${JSON.stringify(r.analog)}`);
if (r.facing !== 16) fail.push(`facing $${r.facing.toString(16)}`);
if (r.after !== null) fail.push(`after release port.analog ${JSON.stringify(r.after)}`);
if (ev && !(ev.length >= 2 && ev[0][1] === "stick:16,50" && ev[ev.length - 1][1] === "stick:")) fail.push(`session events ${JSON.stringify(ev)}`);
if (!/CODE: ROM only/.test(r.hint)) fail.push(`quick save hint: ${r.hint}`);
if (errors.length) fail.push("page errors: " + errors.slice(0, 3).join(" | "));
console.log(JSON.stringify({ ...r, stickEvents: ev, replay: { exact: rep.exact, hashChecks: rep.hashChecks } }));
console.log(fail.length ? "FAIL: " + fail.join("; ") : "ok");
await browser.close();
process.exit(fail.length ? 1 : 0);
