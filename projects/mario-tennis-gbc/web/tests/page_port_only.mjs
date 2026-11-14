// The page as a player gets it (navigator.webdriver false, as on a phone): the JS port runs the game even with an old
// CODE: ROM choice stored, and the buttons for what needs the original code are hidden (engine switch, run-ahead,
// quick save). The other page tests run with navigator.webdriver set, where the original code stays available.
// usage: (python3 -m http.server 8765 from the project root) node web/tests/page_port_only.mjs
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
const page = await browser.newPage(); const errors = [];
page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => { localStorage.setItem("mt-engine", "rom"); });
await page.goto("http://localhost:8765/web/full.html");
await page.waitForFunction(() => window.__gb && window.__gb.gb && window.__gb.gb.frames > 120, null, { timeout: 60000 });
const r = await page.evaluate(() => ({ webdriver: navigator.webdriver, status: document.getElementById("romstatus").textContent, port: !!window.__gb.port,
  shown: ["engbtn", "runaheadbtn", "qsave1", "qsave2", "qload1", "qload2"].filter(id => { const e = document.getElementById(id); return e && !e.hidden; }) }));
const fail = [];
if (r.webdriver) fail.push("navigator.webdriver is set: this test needs it off");
if (!r.port || !/JS port/.test(r.status)) fail.push(`not the port: ${r.status}`);
if (r.shown.length) fail.push(`still shown: ${r.shown.join(", ")}`);
if (errors.length) fail.push("page errors: " + errors.slice(0, 3).join(" | "));
console.log(JSON.stringify(r)); console.log(fail.length ? "FAIL: " + fail.join("; ") : "ok");
await browser.close(); process.exit(fail.length ? 1 : 0);
