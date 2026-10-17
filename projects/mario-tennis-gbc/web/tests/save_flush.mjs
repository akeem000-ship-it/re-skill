// Save persistence check: resume a core state whose game has just written its save, let the page notice the write,
// hide the page before the 0.5 s debounce, and verify the save reached localStorage. usage: node web/tests/save_flush.mjs STATE.json.gz
import fs from "fs"; import zlib from "zlib";
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
await page.goto("http://localhost:8765/web/full.html?touch");
await page.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("loader").hidden, null, { timeout: 90000 });
const r = await page.evaluate(s => {
  const G = window.__gb; G.pause(); for (const k of Object.keys(localStorage)) if (k.startsWith("mt-sram")) localStorage.removeItem(k);
  G.loadState(s); G.gb.mem.sram[0x1FF0] ^= 0x5A; G.gb.mem.sramDirty = true;     // a fresh game write
  G.pause(false); return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
    const before = Object.keys(localStorage).filter(k => k.startsWith("mt-sram")).length;
    window.__flushSave();                                                        // what hiding the page / onPause does
    const key = Object.keys(localStorage).find(k => k.startsWith("mt-sram"));
    const b = key ? Uint8Array.from(atob(localStorage.getItem(key)), c => c.charCodeAt(0)) : null;
    res({ storedBeforeFlush: before, storedAfterFlush: !!key, matches: !!b && b.length === G.gb.mem.sram.length && b.every((v, i) => v === G.gb.mem.sram[i]) });
  })));
}, st);
console.log(JSON.stringify(r));
await browser.close();
