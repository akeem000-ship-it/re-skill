// Screenshot the page in touch mode (?touch) at a phone-like viewport: checks the pad renders and a tap on A
// reaches the game (the title screen advances). usage: node web/tests/touch_frame.mjs OUT.png
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] || "out/touch_frame.png";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
await page.goto("http://localhost:8765/web/index.html?touch");
await page.waitForFunction(() => window.__mt && window.__mt.front, null, { timeout: 30000 });
await page.evaluate(() => { window.__mt.pause(); for (let i = 0; i < 200; i++) window.__mt.step(); });   // into the intro
const before = await page.evaluate(() => window.__mt.front.step);
const start = page.locator('[data-key="Enter"]');
await start.dispatchEvent("pointerdown", { pointerId: 1 });
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__mt.step(); });
await start.dispatchEvent("pointerup", { pointerId: 1 });
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__mt.step(); });
const after = await page.evaluate(() => ({ step: window.__mt.front && window.__mt.front.step, keys: window.__mt.keys.Enter }));
console.log("front step before", before, "after", JSON.stringify(after), "(Enter during the intro skips to the title)");
await page.screenshot({ path: out });
await browser.close();
