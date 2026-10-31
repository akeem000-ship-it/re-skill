// web/play.html (the native rewrite, no emulated CPU) in headless Chromium: the page loads the ROM from rom/ through
// a small static server this test starts, starts its Stroke round, and the test plays a few shots with keys:
// at each aiming menu it turns the aim a little, presses A to address the ball, A at full power and A for the
// impact, timed by the page's frame counter (window.__golf). Fails on page errors, a stopped round, or fewer
// shots than asked. Screenshots go to out/ (aiming, address, mid-swing, flight, after each shot).
// With --match the page's mode selector picks match play against Luigi (the computer plays its own turns; the test
// plays the human's).
// With --pause the first aiming menu opens the pause menu (Start), picks Scorecard, leaves it and aims on.
// By default the page starts at power-on and the test goes through the menus (A skips the demo, Start on the title,
// A on the link menu, Right to Mario and A in the character select, A for Stroke and course 1); --stroke starts the
// round directly (the page's selector).
// With --save F the browser's localStorage holds the save RAM file F (8 KB, e.g. out/kid.sav, a save the game made on
// the emulator core: web/tests/golf/coreplay.mjs) under the emulated page's key: the test picks save slot 0 in the
// character select and Stroke in the mode select, and at the end checks that the page stored the save RAM again
// (signature, checksum, slot 0's block holding the character).
// With --newchar (an empty save RAM) the test makes a new character in the character select's empty slot 0 (A through
// the opening's questions and texts; in the name entry Start, A: the default name, A: END), the first day at the club,
// then Stroke with the new save file; at the end it checks the stored save RAM holds the character in slot 0.
// With --link the page's link mode (two machines joined by the JS cable): a policy in the page gives both machines
// their buttons (as web/tests/golf/linkcores.mjs sessionPolicy: Start at frame 2600, the left one Down and A on the
// link menu's VS game, the right one waits; Right to slot 4 / 3 in the character selects, A every 40 frames, the
// swings by the meter) until the left machine has seen `shots` shots of the link round (both players' shots: the
// partner's come in by the cable) and both machines hold the partner as the other player (its field $13 = 3).
// usage: node web/tests/play_page.mjs [shots=3] [outdir=out] [--match] [--stroke] [--pause] [--save out/kid.sav] [--newchar] [--link]
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const match = process.argv.includes("--match");
const pause = process.argv.includes("--pause");
const direct = process.argv.includes("--stroke");
const newChar = process.argv.includes("--newchar");
const link = process.argv.includes("--link");
const saveFile = process.argv.includes("--save") ? process.argv[process.argv.indexOf("--save") + 1] : null;
const [shotsArg = "3", outDir = path.join(root, "out")] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--save");
const want = +shotsArg;
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".gbc": "application/octet-stream" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const SAVE_KEY = "mg-sram-7f2062e51b4f";        // js/main.js: "mg-sram-" + the ROM's SHA-1, 12 digits
if (saveFile) await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [SAVE_KEY, fs.readFileSync(path.resolve(root, saveFile)).toString("base64")]);
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`http://localhost:${port}/web/play.html`);
await page.waitForFunction(() => window.__golf && window.__golf.frames > 0, null, { timeout: 30000 });
if (match) {
  await page.selectOption("#mode", "match:9");
  await page.waitForFunction(() => window.__golf && window.__golf.w.wram[0][0x834] === 2 && window.__golf.frames > 0, null, { timeout: 30000 });
} else if (direct) {
  await page.selectOption("#mode", "stroke");
  await page.waitForFunction(() => window.__golf && window.__golf.mark !== "menus" && window.__golf.frames > 0, null, { timeout: 30000 });
}

const state = () => page.evaluate(() => { const g = window.__golf;
  return { frames: g.frames, mark: g.mark, shots: g.shots.length, error: g.error, done: !!g.done, hole: g.w.wram[0][0x837] }; });
const frames = () => page.evaluate(() => window.__golf.frames);
const untilFrames = async n => page.waitForFunction(n => window.__golf.frames >= n || window.__golf.error, n, { timeout: 60000 });
const until = async (fn, arg, ms = 120000) => page.waitForFunction(fn, arg, { timeout: ms });
const press = async (key, n = 3) => {                // held for n frames
  await page.keyboard.down(key);
  await untilFrames((await frames()) + n);
  await page.keyboard.up(key);
};
let shotN = 0;
const shot = async name => page.locator("#screen").screenshot({ path: path.join(outDir, `play_${String(shotN++).padStart(2, "0")}_${name}.png`) });

const log = [];
// the menus: which screen the page is on, by its frame tasks (the title's PRESS START 40:4D1D, the character
// select's cursor 06:65D9 with the cursor at WRAM6 $D214)
const screenNow = () => page.evaluate(() => {
  const w = window.__golf.w, t = w.wram[0];
  const has = (b, a) => { for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === b && (t[p + 1] | t[p + 2] << 8) === a) return true; return false; };
  return { mark: window.__golf.mark, error: window.__golf.error, title: has(0x40, 0x4D1D), chars: has(0x06, 0x65D9), cursor: w.wram[6][0x214],
    modes: has(0x0D, 0x428E), mode: w.high[0x1B0], names: has(0x06, 0x51CC), map: t[0x450] };
});
try {
  if (link) {
    await page.selectOption("#mode", "link");
    await page.waitForFunction(() => window.__golf && window.__golf.link && window.__golf.frames > 0, null, { timeout: 30000 });
    await page.evaluate(() => {
      const g = window.__golf, ws = [g.w, g.link.w2], st = [{ menuAt: -1 }, {}];
      const has = (w, b, a) => { const t = w.wram[0]; for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === b && (t[p + 1] | t[p + 2] << 8) === a) return true; return false; };
      g.testInput = [0, 0];
      g.onFrame = () => {
        const k = g.frames;
        g.testInput = ws.map((w, id) => {
          if (k < 2600) return 0;
          if (k === 2600) return 8;
          if (has(w, 0x09, 0x4990) && w.wram[6][0x205] === 1 && w.wram[6][0x202] === 4) {
            if (id) return 0;
            if (st[0].menuAt < 0) st[0].menuAt = k;
            return k === st[0].menuAt + 60 ? 0x80 : k === st[0].menuAt + 100 ? 1 : 0;
          }
          const m = w.wram[6][0x44E];
          if (m) return w.wram[6][0x329] === 0x0D ? (m === 0x14 || m === 0x15 ? 1 : 0) : (m === 0x38 || m === 0x39 || m === 0x76 || m === 0x77 ? 1 : 0);
          if (k % 40) return 0;
          if (has(w, 0x06, 0x65D9) && w.wram[6][0x214] !== (id ? 3 : 4)) return 0x10;
          return 1;
        });
      };
    });
    await until(n => (window.__golf.shots.length >= n && window.__golf.link.w2.wram[0][0x893] === 3 && window.__golf.w.wram[0][0x8D3] === 3) || window.__golf.error, want, 900000);
    await page.locator("#stage").screenshot({ path: path.join(outDir, "play_link.png") });
    log.push(`link: ${await page.evaluate(() => `left ${window.__golf.frames} frames, right ${window.__golf.link.frames2}, link roles ${window.__golf.w.wram[0][0x33F]} / ${window.__golf.link.w2.wram[0][0x33F]}, hole ${window.__golf.w.wram[0][0x837]}`)}`);
  }
  if (!match && !direct && !link) {
    let shots = 0;
    for (;;) {
      const st = await screenNow();
      if (st.error || st.mark !== "menus") break;
      if (st.title) { if (!shots++) await shot("title"); await press("Enter"); }
      else if (st.chars && st.cursor !== (saveFile || newChar ? 0 : 4)) await press("ArrowRight");
      else if ((saveFile || newChar) && st.modes && st.mode !== 3) await press("ArrowRight");   // (the list 1 2 3 4 9 from 1: Stroke at 3)
      else if (st.names) {                         // the name entry: Start (to END), A (the default name), A (END)
        await shot("name_entry");
        for (const key of ["Enter", "KeyZ", "KeyZ"]) { await press(key); await untilFrames((await frames()) + 30); }
        log.push(`name entered at frame ${await frames()}`);
      }
      else { if (st.chars) await shot("character_select"); await press("KeyZ"); }
      await untilFrames((await frames()) + 40);
    }
    log.push(`menus done at frame ${await frames()}`);
  }
  for (let k = 0; k < (link ? 0 : want); k++) {
    await until(() => (window.__golf.mark === "aimmenu" && !window.__golf.w.wram[0][0x835]) || window.__golf.error, null, 600000);
    await untilFrames((await frames()) + 40);     // the menu's HUD frames
    await shot(`shot${k + 1}_aim`);
    if (pause && !k) {                             // Start: the pause menu; Down twice to Scorecard, A, A to leave
      await press("Enter");
      await untilFrames((await frames()) + 60);
      await shot("pause_menu");
      for (const key of ["ArrowDown", "ArrowDown", "KeyZ"]) { await press(key); await untilFrames((await frames()) + 10); }
      await untilFrames((await frames()) + 120);
      await shot("pause_scorecard");
      await press("KeyZ");
      await until(() => window.__golf.mark === "aimmenu" || window.__golf.error);
      await untilFrames((await frames()) + 60);
      await shot("pause_back");
    }
    await press(k % 2 ? "ArrowLeft" : "ArrowRight", 6);
    await press("KeyZ");                           // to the address step
    await until(() => window.__golf.mark === "address" || window.__golf.error);
    await untilFrames((await frames()) + 20);
    await shot(`shot${k + 1}_address`);
    const f0 = await frames();
    await press("KeyZ", 2);                        // the swing starts
    await untilFrames(f0 + 58);                    // the cursor near full power
    await press("KeyZ", 2);
    await untilFrames(f0 + 80);
    await shot(`shot${k + 1}_swing`);
    await untilFrames(f0 + 110);                   // back down to the impact zone
    await press("KeyZ", 2);
    await untilFrames(f0 + 220);
    await shot(`shot${k + 1}_flight`);
    await until(n => window.__golf.shots.length > n || window.__golf.error, k);
    const s = await state();
    log.push(`shot ${k + 1}: outcome $${(await page.evaluate(() => window.__golf.shots.at(-1))).toString(16)} at frame ${s.frames}, hole ${s.hole}`);
    await untilFrames(s.frames + 60);
    await shot(`shot${k + 1}_after`);
  }
} catch (e) {
  errors.push("script: " + e.message.split("\n")[0]);
}
const s = await state();
let saveOk = true;
if (newChar) {                                     // the new character in slot 0 of the stored save RAM
  const b = Buffer.from(await page.evaluate(k => localStorage.getItem(k) || "", SAVE_KEY), "base64");
  const sum = b.subarray(0x32, 0x1C0).reduce((a, v) => (a + v) & 0xFFFF, 0);
  const name = b.subarray(0x200, 0x207).toString("latin1").split("\0")[0];
  saveOk = b.length === 0x2000 && b.subarray(0x20, 0x2F).toString("latin1") === "CAMELOT GAMEBOY" && sum === b.readUInt16LE(0x30) &&
    b[0x40] === 1 && name.length > 0;
  log.push(`the stored save RAM: ${b.length} bytes, ${saveOk ? `valid, slot 0 holds ${name}` : "NOT as expected"}`);
}
if (saveFile) {                                    // the page stored the save RAM the game wrote (SaveGame 02:4489)
  const b = Buffer.from(await page.evaluate(k => localStorage.getItem(k) || "", SAVE_KEY), "base64");
  const sum = b.subarray(0x32, 0x1C0).reduce((a, v) => (a + v) & 0xFFFF, 0);
  saveOk = b.length === 0x2000 && b.subarray(0x20, 0x30).equals(fs.readFileSync(path.resolve(root, saveFile)).subarray(0x20, 0x30)) && sum === b.readUInt16LE(0x30) &&
    b[0x40] === 1 && b.subarray(0x200, 0x203).toString("latin1") === "Kid" && !b.equals(fs.readFileSync(path.resolve(root, saveFile)));   // (saved again: the play clock moved)
  log.push(`the stored save RAM: ${b.length} bytes, ${saveOk ? "valid, slot 0 holds Kid" : "NOT as expected"}`);
}
await page.screenshot({ path: path.join(outDir, "play_page.png") });
console.log(log.join("\n"));
console.log(JSON.stringify({ frames: s.frames, shots: s.shots, mark: s.mark, error: s.error, status: await page.locator("#status").textContent(), errors: errors.slice(0, 5) }));
await browser.close();
server.close();
const ok = !errors.length && !s.error && s.shots >= want && saveOk;
console.log(ok ? `ok   play page: ${s.shots} shots, ${s.frames} frames, no page errors` : "FAIL play page");
process.exit(ok ? 0 : 1);
