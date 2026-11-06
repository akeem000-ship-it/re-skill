// ONLINE (web/js/online.js): two players in two browsers (two profiles: separate saves), joined over WebRTC through a PeerJS broker
// run here (--peer PORT: PeerJS's own server, `peerjs --port PORT`). The host's buttons are a recorded exhibition from power-on
// (out/engine/exh1.mtrec: the menus to a match against the computer), the friend's a script that runs and swings. Checks: both
// start; the opponent in the match is the friend's (character 1's input source 4); it moves with the friend's buttons; the two games
// stay alike (the session's own check: the picture's hash every 120 frames, compared both ways) to the end; no page errors.
// usage: (python3 -m http.server 8765 from the project root; peerjs --port 9000) node web/tests/online_pair.mjs [--frames N] [--peer 9000] [--lag MS]
import fs from "fs"; import zlib from "zlib"; import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const frames = +opt("--frames", 4200), peerPort = opt("--peer", "9000"), lag = +opt("--lag", 0);   // --lag MS: each message held that long (both ways)
const raw = fs.readFileSync("out/engine/exh1.mtrec"), rec = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString());
const hostPad = [...Buffer.from(rec.inputs, "base64")];
const args = ["--disable-features=WebRtcHideLocalIpsWithMdns"];   // (the two browsers find each other on this machine)
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args }).catch(() => chromium.launch({ args }));
const base = "http://localhost:8765/web/full.html", peer = `&peerhost=127.0.0.1&peerport=${peerPort}&2d${lag ? "&netlag=" + lag : ""}`;
async function open(name, url) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 480 } }), page = await ctx.newPage(), errors = [];
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`)); page.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.addInitScript(() => { localStorage.setItem("mt-reset-0.35.18", "1"); localStorage.setItem("mt-3d", "off"); window.__onlinePad = () => 0; });
  await page.goto(url);
  return { page, errors };
}
const t0 = Date.now();
// the host: the recorded buttons, frame by frame (nothing after the recording)
const host = await open("host", `${base}?online=host${peer}`);
await host.page.evaluate(p => { window.__onlinePad = f => p[f] || 0; }, hostPad);
await host.page.waitForFunction(() => /your code: [A-Z0-9]+/.test(document.getElementById("onlinechip")?.textContent || ""), null, { timeout: 90000 });
const code = (await host.page.textContent("#onlinechip")).match(/your code: ([A-Z0-9]+)/)[1];
console.log("host code", code, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
// the friend: from frame 3000 (in the match) runs left and right and swings
const guest = await open("guest", `${base}?online=join&room=${code}${peer}`);
await guest.page.evaluate(() => { window.__onlinePad = f => (f < 3000 ? 0 : (Math.floor(f / 90) % 2 ? 0x10 : 0x20) | (f % 45 < 3 ? 1 : 0)); });
for (const s of [host, guest]) await s.page.waitForFunction(() => window.__gb && window.__gb.port && document.getElementById("onlinechip")?.textContent.includes("ping"), null, { timeout: 90000 })
  .catch(async e => { for (const x of [host, guest]) console.log(await x.page.evaluate(() => document.getElementById("onlinechip")?.textContent || "(no chip)"), x.errors.slice(0, 5)); throw e; });
console.log("both started", `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
// to the end, watching character 1 (WRAM bank 5: input source $DF1E, X $DF01-$DF02 (offset $F01 in the bank)) on both
const probe = () => { const G = window.__gb, w = G.gb.mem.wram, chip = document.getElementById("onlinechip").textContent;
  return { F: G.port && window.__online ? window.__online.F : -1, map: w[0][0x32E], src1: w[5][0xF1E], x1: w[5][0xF01] | w[5][0xF02] << 8, chip, hash: G.gb.frameHash() }; };
let moved = new Set(), src4 = false, last = null;
for (;;) {
  const [h, g] = await Promise.all([host.page.evaluate(probe), guest.page.evaluate(probe)]);
  if (h.map <= 15 && g.map <= 15) { if (h.src1 === 4) src4 = true; if (g.F > 3100) moved.add(g.x1); }
  last = { h, g };
  if (/out of step|left|lost/.test(h.chip + g.chip) || (h.F >= frames && g.F >= frames)) break;
  if (Date.now() - t0 > 900000) { console.log("timed out"); break; }
  await host.page.waitForTimeout(1500);
}
console.log("host", JSON.stringify(last.h)); console.log("guest", JSON.stringify(last.g));
const errors = [...host.errors, ...guest.errors];
const same = !/out of step/.test(last.h.chip + last.g.chip);
const ok = same && src4 && moved.size >= 3 && last.h.F >= frames && errors.length === 0;
console.log(`opponent seat 4: ${src4}; opponent x positions seen: ${moved.size}; games alike: ${same}; errors: ${errors.slice(0, 5).join(" | ") || "none"}`);
console.log(`${ok ? "ok" : "FAIL"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await browser.close(); process.exit(ok ? 0 : 1);
