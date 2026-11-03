// HD text (web/js/hd/hdtext.js) on the new character's opening (map $1E, StoryOpeningCreateCharacter 31:43B9) in headless Chromium:
// power-on with no save and ?font=itim, the character select's empty slot ("Create a new character here."), then the opening's first
// boxes. Every frame from 2600 to 3200 the text lines the HD font draws (window.__hd.view.hd.lines) must be words of those boxes:
// each line a piece of "Create a new / character here.", "Start by creating / a new character." or "First, select a player.", and
// the opening's first box read whole. It caught the room coming in (a white fade) with its map pointing at the character select's
// font tiles, read as "FGFGFGFGF45GFGFGFGFG" / "45" in ink a few steps off the box's white (the game's screen showed next to nothing).
// usage: node web/tests/hdtext_newchar.mjs [--font itim|kode]
import { createRequire } from "module";
import { serve, HERE } from "./golfbot.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2), font = args.includes("--font") ? args[args.indexOf("--font") + 1] : "itim";
const { server, port } = serve(HERE);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.addInitScript(() => localStorage.clear());
await page.goto(`http://localhost:${port}/web/play.html?font=${font}&g3d=off`);
await page.waitForFunction(() => window.__golf && window.__golf.frames > 0 && window.__hd, null, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__golf; let down = null, last = ""; window.__seen = [];
  const key = (c, d) => dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c }));
  key("Space", true);                                // (the page's fast mode)
  g.onFrame = () => {
    const f = g.frames; if (down) { key(down, false); down = null; }
    let k = null;
    if (f === 2600) k = "Enter"; else if (f > 2600 && f % 40 === 0) k = f % 400 === 200 ? "Enter" : "KeyZ";   // (as story3d.mjs "new")
    if (k) { key(k, true); down = k; }
    const hd = window.__hd.view.hd;
    if (hd && f >= 2600 && f <= 3200) { const t = JSON.stringify(hd.lines.map(l => l.text)); if (t !== last) { last = t; window.__seen.push([f, hd.lines.map(l => l.text), hd.lines.map(l => l.c.map(x => x.toString(16)).join(","))]); } }
  };
});
await page.waitForFunction(() => window.__golf.frames > 3200 || window.__golf.error, null, { timeout: 1200000, polling: 500 });
const seen = await page.evaluate(() => window.__seen), error = await page.evaluate(() => window.__golf.error);
const WORDS = ["Create a new", "character here.", "Start by creating", "a new character.", "First, select a player.", "Which are you?"];
let ok = !error && !errors.length, whole = false;
for (const [f, lines, cols] of seen) {
  const bad = lines.filter(l => !WORDS.some(w => w.startsWith(l)));
  if (bad.length) { ok = false; console.log(`frame ${f}: not the boxes' words: ${JSON.stringify(bad)} (colours ${JSON.stringify(cols)})`); }
  if (lines.includes("Start by creating") && lines.includes("a new character.")) whole = true;
}
if (!whole) { ok = false; console.log("the opening's first box was never read whole"); }
console.log(`${seen.length} changes of the HD text from frame 2600 to 3200${error ? "; game error " + error : ""}${errors.length ? "; page errors " + errors.slice(0, 2) : ""}`);
console.log(ok ? "hdtext new character: OK" : "hdtext new character: FAILED");
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
