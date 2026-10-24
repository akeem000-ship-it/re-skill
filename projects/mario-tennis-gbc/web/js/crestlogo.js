// The app's logo and icon ("Crest"): a red tournament shield with three gold stars, the ball in the middle and a gold 2D-HD
// ribbon across it, beside the MARIO / TENNIS wordmark (Luckiest Guy, stroked dark navy and white, red and gold fills).
// crestLogo() is the whole logo on a clear 1600 x 900 canvas (the title screen draws it); crestIcon(n) is the badge alone
// on a navy rounded square (the launcher icon and the page's icon: web/tests/make_icons.mjs renders their PNGs).
// All drawn here: nothing is taken from the game.
const FONT = "MT Luckiest Guy";
const fontReady = () => typeof document === "undefined" || !document.fonts ||                       // (fonts.check is true for a family not added yet)
  [...document.fonts].some(f => f.family.replace(/"/g, "") === FONT && f.status === "loaded");
export const crestFont = typeof FontFace !== "undefined" && !fontReady()
  ? new FontFace(FONT, `url(${new URL("../fonts/LuckiestGuy-Regular.ttf", import.meta.url)})`).load().then(f => document.fonts.add(f)).catch(() => {})
  : Promise.resolve();
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// a word stroked in layers: an outer dark stroke, an inner light one, a gradient fill and a highlight on its top third
function word(g, text, x, y, size, fill, opt = {}) {
  g.save(); g.font = `${size}px "${FONT}"`; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.lineJoin = "round";
  if (opt.shadow) { g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = size * 0.12; g.shadowOffsetY = size * 0.06; }
  g.lineWidth = size * (opt.outer ?? 0.24); g.strokeStyle = "#13183a"; g.strokeText(text, x, y);
  g.shadowColor = "transparent";
  if (opt.inner !== 0) { g.lineWidth = size * (opt.inner ?? 0.11); g.strokeStyle = "#fff"; g.strokeText(text, x, y); }
  const w = g.measureText(text).width, gr = g.createLinearGradient(0, y - size * 0.8, 0, y);
  gr.addColorStop(0, fill[0]); gr.addColorStop(1, fill[1]); g.fillStyle = gr; g.fillText(text, x, y);
  g.save(); g.beginPath(); g.rect(x - w / 2 - 20, y - size * 0.82, w + 40, size * 0.3); g.clip(); g.fillStyle = "rgba(255,255,255,.28)"; g.fillText(text, x, y); g.restore();
  g.restore();
}
// the ball: felt shading, a speckle of fuzz, the two seams, a navy rim
function ball(g, x, y, r, rot) {
  g.save(); g.translate(x, y);
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r); gr.addColorStop(0, "#f6ff8a"); gr.addColorStop(0.55, "#d8ec2e"); gr.addColorStop(1, "#8fae12");
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.save(); g.clip(); let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < r * 6; i++) { const a = rnd() * 7, d = Math.sqrt(rnd()) * r; g.fillStyle = rnd() < 0.5 ? "rgba(255,255,200,.25)" : "rgba(90,110,0,.18)"; g.fillRect(Math.cos(a) * d, Math.sin(a) * d, r * 0.02, r * 0.02); }
  g.rotate(rot); g.lineWidth = r * 0.11; g.strokeStyle = "#fbfbf2"; g.lineCap = "round";
  g.beginPath(); g.arc(-r * 1.15, 0, r * 0.82, -0.95, 0.95); g.stroke(); g.beginPath(); g.arc(r * 1.15, 0, r * 0.82, Math.PI - 0.95, Math.PI + 0.95); g.stroke();
  g.restore(); g.lineWidth = r * 0.06; g.strokeStyle = "#13183a"; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke();
  g.restore();
}
// the badge, centred at (x, y), 600 x 760 units at scale s
export function drawCrest(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  const shield = () => { g.beginPath(); g.moveTo(-300, -320); g.quadraticCurveTo(0, -380, 300, -320); g.lineTo(300, 40); g.quadraticCurveTo(280, 260, 0, 380); g.quadraticCurveTo(-280, 260, -300, 40); g.closePath(); };
  g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 40 * s; shield(); g.fillStyle = "#13183a"; g.fill(); g.shadowColor = "transparent";
  shield(); const gr = g.createLinearGradient(0, -360, 0, 380); gr.addColorStop(0, "#d11f35"); gr.addColorStop(1, "#7a0a1a"); g.fillStyle = gr; g.fill();
  g.lineWidth = 22; g.strokeStyle = "#ffd65a"; g.stroke(); g.lineWidth = 6; g.strokeStyle = "#13183a"; shield(); g.stroke();
  for (const [sx, sy] of [[-200, -240], [200, -240], [0, -280]]) {
    g.save(); g.translate(sx, sy); g.fillStyle = "#ffd65a"; g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i & 1 ? 14 : 34, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill(); g.restore();
  }
  ball(g, 0, 20, 150, 0.5);
  g.fillStyle = "#ffd65a"; g.beginPath(); g.moveTo(-360, 200); g.lineTo(360, 200); g.lineTo(330, 250); g.lineTo(360, 300); g.lineTo(-360, 300); g.lineTo(-330, 250); g.closePath(); g.fill();
  g.lineWidth = 8; g.strokeStyle = "#13183a"; g.stroke();
  g.font = `78px "${FONT}"`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#13183a"; g.fillText("2D-HD", 0, 256);
  g.restore();
}
// the whole logo (cached once the font is in: drawn before it, the words would be in a fallback face)
let logo = null;
export function crestLogo() {
  if (logo) return logo;
  const c = canvas(1600, 900), g = c.getContext("2d");
  drawCrest(g, 360, 460, 1.0);
  word(g, "MARIO", 1080, 420, 230, ["#ff5a48", "#c8102e"], { shadow: true });
  word(g, "TENNIS", 1080, 640, 230, ["#ffe27a", "#f0a818"], { shadow: true });
  if (fontReady()) logo = c;
  return c;
}
// the icon: the badge on a navy square with a soft light behind it. `round` rounds the corners (a launcher masks its own); with
// `bg` false the badge alone on clear (an adaptive icon's foreground layer), `size` its height as a share of the square
export function crestIcon(n, { round = true, bg = true, size = 0.89 } = {}) {
  const c = canvas(n, n), g = c.getContext("2d");
  if (round) { const r = n * 0.22; g.beginPath(); g.moveTo(r, 0); g.arcTo(n, 0, n, n, r); g.arcTo(n, n, 0, n, r); g.arcTo(0, n, 0, 0, r); g.arcTo(0, 0, n, 0, r); g.closePath(); g.clip(); }
  if (bg) { const b = g.createRadialGradient(n / 2, n / 2, n * 0.08, n / 2, n / 2, n * 0.7); b.addColorStop(0, "#2a3478"); b.addColorStop(1, "#0a0f2c"); g.fillStyle = b; g.fillRect(0, 0, n, n); }
  drawCrest(g, n / 2, n / 2 - n * size * 0.035, n * size / 760);
  return c;
}
