// THE ONLINE LOBBY (web/js/lobby.js, the ONLINE panel in web/js/online.js): three browser profiles through a PeerJS broker run here
// (--peer PORT). A opens the lobby first (it keeps the list); B hosts a public game; C opens the lobby and must see B's game; A closes
// (the list moves to another app: C, or B) and C must still see B's game; C joins it from the list and both games start, each showing
// the other's name. No page errors.
// usage: (python3 -m http.server 8765 from the project root; a PeerJS server on --peer, 9000) node web/tests/online_lobby.mjs
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const peer = `peerhost=127.0.0.1&peerport=${opt("--peer", "9000")}&2d`, base = "http://localhost:8765/web/full.html";
const args = ["--disable-features=WebRtcHideLocalIpsWithMdns"];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args }).catch(() => chromium.launch({ args }));
const t0 = Date.now(), T = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`, errors = [];
async function open(who, url) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 480 } }), page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${who}: ${e.message}`)); page.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  await page.addInitScript(n => { localStorage.setItem("mt-reset-0.35.18", "1"); localStorage.setItem("mt-3d", "off"); localStorage.setItem("mt-online-name", n); }, who);
  await page.goto(url); return { page, ctx };
}
const panel = async p => { await p.waitForFunction(() => window.__gb && window.__gb.gb && document.getElementById("onlinebtn"), null, { timeout: 90000 });
  await p.evaluate(() => document.getElementById("onlinebtn").dispatchEvent(new PointerEvent("pointerdown"))); };
const rooms = p => p.evaluate(() => [...document.querySelectorAll('#onlinepanel [data-a="rooms"] b')].map(b => b.textContent));
const keeper = p => p.evaluate(() => !!(window.__lobby && window.__lobby.keeper));
let ok = true; const check = (what, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${what} (${T()})`); if (!cond) ok = false; };

const A = await open("Alice", `${base}?${peer}`); await panel(A.page);
await A.page.waitForFunction(() => window.__lobby && window.__lobby.keeper, null, { timeout: 60000 }).catch(() => {});
check("Alice, first in the lobby, keeps the list", await keeper(A.page));
const B = await open("Bob", `${base}?online=host&public=1&name=Bob&${peer}`);
const C = await open("Cara", `${base}?${peer}`); await panel(C.page);
await C.page.waitForFunction(() => [...document.querySelectorAll('#onlinepanel [data-a="rooms"] b')].some(b => b.textContent === "Bob"), null, { timeout: 60000 }).catch(() => {});
check("Cara sees Bob's game in OPEN GAMES", (await rooms(C.page)).includes("Bob"));
check("Alice sees it too", (await rooms(A.page)).includes("Bob"));
await A.ctx.close();                                                    // the keeper leaves
await C.page.waitForTimeout(3000);
await C.page.waitForFunction(() => [...document.querySelectorAll('#onlinepanel [data-a="rooms"] b')].some(b => b.textContent === "Bob"), null, { timeout: 60000 }).catch(() => {});
const kc = await keeper(C.page), kb = await B.page.evaluate(() => !!(window.__lobby && window.__lobby.keeper));
check(`after Alice left, another app keeps the list (${kc ? "Cara" : kb ? "Bob" : "nobody"})`, kc || kb);
check("Cara still sees Bob's game", (await rooms(C.page)).includes("Bob"));
// Cara joins from the list
await C.page.evaluate(() => [...document.querySelectorAll('#onlinepanel [data-a="rooms"] > div')].find(r => r.querySelector("b").textContent === "Bob").querySelector("button").click());
for (const [who, p] of [["Bob", B.page], ["Cara", C.page]]) await p.waitForFunction(() => document.getElementById("onlinechip")?.textContent.includes("ping"), null, { timeout: 90000 }).catch(() => {});
const chips = await Promise.all([B.page, C.page].map(p => p.evaluate(() => document.getElementById("onlinechip")?.textContent || "")));
check(`Bob's game started against Cara: "${chips[0]}"`, chips[0].includes("vs Cara"));
check(`Cara's game started against Bob: "${chips[1]}"`, chips[1].includes("vs Bob"));
await C.page.waitForTimeout(4000);
const F = await Promise.all([B.page, C.page].map(p => p.evaluate(() => window.__online && window.__online.F)));
check(`both games run (frames ${F.join(", ")})`, F.every(f => f > 100));
check(`no page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`, errors.length === 0);
console.log(ok ? "ok" : "FAIL"); await browser.close(); process.exit(ok ? 0 : 1);
