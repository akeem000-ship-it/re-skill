// Renders the app's icon (web/js/crestlogo.js) to PNGs: the page's icons (web/icons) and the Android launcher's (legacy
// mipmaps at each density, and the adaptive icon's foreground). Run from the project root with a server on port 8765
// (python3 -m http.server 8765): node web/tests/make_icons.mjs
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { writeFileSync, mkdirSync } from "fs";
const RES = "android/app/src/main/res";
const b = await chromium.launch(), pg = await b.newPage();
await pg.goto("http://localhost:8765/web/style.css");
const out = await pg.evaluate(async res => {
  const m = await import("/web/js/crestlogo.js");
  await m.crestFont;
  const png = c => c.toDataURL("image/png").split(",")[1], o = {};
  for (const n of [32, 192, 512]) o[`web/icons/icon-${n}.png`] = png(m.crestIcon(n));
  for (const [d, n] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) o[`${res}/mipmap-${d}/ic_launcher.png`] = png(m.crestIcon(n));
  o[`${res}/mipmap-xxxhdpi/ic_launcher_fg.png`] = png(m.crestIcon(432, { round: false, bg: false, size: 0.6 }));   // inside the 66 dp safe circle of 108
  return o;
}, RES);
for (const [f, d] of Object.entries(out)) { mkdirSync(f.slice(0, f.lastIndexOf("/")), { recursive: true }); writeFileSync(f, Buffer.from(d, "base64")); console.log(f); }
await b.close();
