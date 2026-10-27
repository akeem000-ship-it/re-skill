// The EXP screen's HD panel (MENU: Wheel): over the game's EXP sharing screen after a match while its input loops run
// (port/menus/exp/distribute.js sets P.expSeen each frame, read only), "what the levels bring": for each of the two players the next
// levels as steps, each with the EXP still needed to reach it, lit gold (+1 skill point) once the EXP given reaches it; how far into
// the current level they are; the pool left as balls; TOUR+'s coach pick under your card; the game's "OK?" as a YES / NO bar.
// The level thresholds are the game's own table (02:4E7A, 3 bytes a level: the EXP total that leaves a level; CanLevelUp 02:4D99).
// The screen shows level D while the EXP is below T[D - 1] (D = the record's level + 1). The faces are the game's own portraits, taken
// from its picture (the one not selected is greyed by the game: its last colour picture is kept).
// The game keeps its input: UP / DOWN pick the player, RIGHT or A give EXP, LEFT takes it back, B held runs faster.
const romOff = (bank, addr) => bank * 0x4000 + (addr - 0x4000);
const FACES = [[64, 40], [64, 112]];                    // the portraits on the game's screen (24 x 24)
const COLS = ["#e84834", "#3c82eb"], SKILLS = ["SPIN", "POWER", "CONTROL", "SPEED"], STEPS = 5;

export class ExpPanel {
  constructor() { this.el = null; this.key = ""; this.faces = [null, null]; this.faceKey = ["", ""]; this.faceSel = [-9, -9]; this.T = null; this.reached = null; }
  table(rom) {
    if (!this.T) { const o = romOff(2, 0x4E7A); this.T = Array.from({ length: 100 }, (_, i) => rom[o + 3 * i] | rom[o + 3 * i + 1] << 8 | rom[o + 3 * i + 2] << 16); }
    return this.T;
  }
  // the level the screen shows for EXP total e
  shownFor(e) { const T = this.T; let d = 2; while (d < 100 && e >= T[d - 1]) d++; return d; }
  build() {
    if (!document.getElementById("hdexp-css")) { const st = document.createElement("style"); st.id = "hdexp-css"; st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement("div"); this.el.className = "hdexp"; this.el.style.display = "none"; document.body.appendChild(this.el);
  }
  // a portrait from the game's picture as a data URL (null when there is no picture)
  face(gb, slot) {
    const f = gb && gb.ppu && gb.ppu.frame; if (!f) return null;
    const c = document.createElement("canvas"); c.width = c.height = 24; const g = c.getContext("2d"), im = g.createImageData(24, 24), px = new Uint32Array(im.data.buffer);
    const [x0, y0] = FACES[slot]; for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) px[y * 24 + x] = f[(y0 + y) * 160 + x0 + x] | 0xFF000000;
    g.putImageData(im, 0, 0); return c.toDataURL();
  }
  // per frame (full.js): canvas = the game's view on the page; coach = TOUR+'s pick (tour.js coach()) or null
  frame(port, canvas, gb, coach) {
    const s = port && port.expSeen, live = !!(s && s.chars && port.frames - s.at <= 2 && port.menuWheel && port.menuWheel.on);
    globalThis.__expPanelOn = live;
    if (!live) { if (this.el && this.el.style.display !== "none") this.el.style.display = "none"; this.key = ""; this.reached = null; return; }
    if (!this.el) this.build();
    this.table(gb.mem.rom);
    for (const slot of [0, 1]) {                        // the colour portraits: while selected (or with the prompt up, both in colour)
      const nk = s.chars[slot].name.join();
      const colour = s.sel === slot || s.prompt, fresh = colour && (this.faceSel[slot] !== port.frames - 1 || port.frames % 15 === 0);   // (just selected: at once)
      if (colour) this.faceSel[slot] = port.frames;
      if (this.faceKey[slot] !== nk || fresh || !this.faces[slot]) { const u = this.face(gb, slot); if (u) { this.faces[slot] = u; this.faceKey[slot] = nk; } }
    }
    const key = JSON.stringify([s.pool, s.sel, s.prompt, s.yes, s.chars.map(c => [c.shown, c.given, c.toNext]), coach && coach.pick, this.faces]);
    if (key !== this.key) { this.key = key; this.el.innerHTML = this.html(s, coach); }
    const r = canvas.getBoundingClientRect(), k = Math.min(r.width / 1000, r.height / 600);
    Object.assign(this.el.style, { display: "block", left: r.left + r.width / 2 + "px", top: r.top + r.height / 2 + "px", transform: `translate(-50%,-50%) scale(${k.toFixed(3)})` });
  }
  html(s, coach) {
    const T = this.T, reached = [new Set(), new Set()], prev = this.reached;
    const cards = s.chars.map((c, slot) => {
      const name = String.fromCharCode(...c.name.slice(0, c.name.indexOf(0) < 0 ? 7 : c.name.indexOf(0)).filter(x => x >= 0x20 && x < 0x7F)).trim() || (slot ? "PARTNER" : "YOU");
      const e = c.before + c.given, d = c.shown, d0 = Math.min(d, this.shownFor(c.before)), gained = d - d0, on = s.sel === slot;
      const first = Math.max(d0 + 1, d - 2), steps = [];
      for (let L = first; L < first + STEPS && L <= 100; L++) {
        const need = T[L - 2], got = e >= need, cost = need - (L > 2 ? T[L - 3] : 0);
        if (got) reached[slot].add(L);
        const pop = got && prev && !prev[slot].has(L) ? " pop" : "";
        steps.push(`<div class="st${got ? " got" : ""}${pop}"><b>LV ${L}</b>${got ? `<span class="ok">+1 skill point</span><small>reached</small>` :
          `<span>${(need - e).toLocaleString()} EXP</span><small>${L === d + 1 ? "to go" : `this level: ${cost.toLocaleString()}`}</small>`}</div>`);
      }
      const lo = T[d - 2], hi = d < 100 ? T[d - 1] : lo, frac = d >= 100 ? 1 : Math.max(0, Math.min(1, (e - lo) / Math.max(1, hi - lo)));
      const pic = this.faces[slot] ? `<img src="${this.faces[slot]}">` : "";
      const coachLine = slot === 0 && coach && coach.pick >= 0 ? `<div class="coach">COACH: you practise <b>${SKILLS[coach.pick]}</b> most (${Math.round(coach.shares[coach.pick] * 100)}%): put the new points there</div>` : "";
      return `<div class="card${on ? " on" : ""}" style="--c:${COLS[slot]}"><div class="who"><div class="pic">${pic}</div><b>${this.esc(name)}</b><span>LV ${d}${gained ? ` <em>+${gained}</em>` : ""}</span><small>${e.toLocaleString()} EXP${c.given ? ` (+${c.given.toLocaleString()})` : ""}</small></div>` +
        `<div class="mid"><div class="steps">${steps.join("")}</div><div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i><span>LV ${d}${d < 100 ? ` → ${d + 1}: ${c.toNext.toLocaleString()} to go` : " MAX"}</span></div>${coachLine}</div></div>`;
    });
    this.reached = reached;
    const total = s.pool + s.chars[0].given + s.chars[1].given, balls = Array.from({ length: total ? Math.ceil(12 * s.pool / total) : 0 }, () => `<i class="ball"></i>`).join("");   // the share left, in 12 balls
    const prompt = s.prompt ? `<div class="prompt"><b>OK?</b><span class="${s.yes ? "sel" : ""}">YES</span><span class="${s.yes ? "" : "sel"}">NO</span><small>▲ ▼ choose · A</small></div>` : "";
    return `<div class="top"><h2>EXP · WHAT YOU GET</h2><span class="left">${balls}<em>LEFT ${s.pool.toLocaleString()}</em></span></div>${cards.join("")}${prompt}` +
      `<div class="hint">▲ ▼ choose a player · ▶ or A give · ◀ take back · hold B: faster</div>`;
  }
  esc(t) { return t.replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]); }
}
const CSS = `
.hdexp { position: fixed; z-index: 30; width: 1000px; height: 600px; transform-origin: center; background: #12152c; border: 4px solid #ffcf3a; border-radius: 22px; color: #f0f2fa; font: 17px Itim, system-ui, sans-serif; padding: 14px 22px; box-sizing: border-box; pointer-events: none; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.hdexp .top { display: flex; align-items: center; margin-bottom: 8px; }
.hdexp h2 { margin: 0; font: 30px "MT Luckiest Guy", Impact, sans-serif; color: #ffd65a; letter-spacing: .5px; }
.hdexp .left { margin-left: auto; display: flex; align-items: center; gap: 4px; } .hdexp .left em { font: 24px "MT Luckiest Guy", Impact, sans-serif; color: #fff; font-style: normal; margin-left: 8px; }
.hdexp .ball { width: 20px; height: 20px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #f4ff8a, #c8de2c 60%, #8fa018); display: inline-block; }
.hdexp .card { display: flex; gap: 16px; height: 232px; margin-bottom: 12px; padding: 12px 16px; box-sizing: border-box; background: #0b0e20; border: 2px solid #3c4470; border-radius: 18px; opacity: .78; }
.hdexp .card.on { border: 4px solid #ffd65a; opacity: 1; }
.hdexp .who { width: 132px; display: flex; flex-direction: column; align-items: flex-start; }
.hdexp .pic { width: 96px; height: 96px; border-radius: 12px; border: 5px solid var(--c); background: var(--c); overflow: hidden; }
.hdexp .pic img { width: 96px; height: 96px; image-rendering: pixelated; display: block; }
.hdexp .who b { font: 26px "MT Luckiest Guy", Impact, sans-serif; margin-top: 8px; max-width: 132px; overflow: hidden; white-space: nowrap; }
.hdexp .who span { font: 22px "MT Luckiest Guy", Impact, sans-serif; color: #c8cde6; } .hdexp .who em { font-style: normal; color: #5adc78; }
.hdexp .who small { color: #9aa0c0; font-size: 13px; }
.hdexp .mid { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.hdexp .steps { display: flex; gap: 10px; }
.hdexp .st { flex: 1; height: 118px; border-radius: 14px; background: #1c2040; border: 2px solid #464c7a; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; }
.hdexp .st b { font: 26px "MT Luckiest Guy", Impact, sans-serif; } .hdexp .st span { font-size: 17px; } .hdexp .st small { color: #9aa0c0; font-size: 12px; padding: 0 4px; }
.hdexp .st.got { background: #4a3c10; border-color: #ffd65a; } .hdexp .st.got b { color: #ffd65a; } .hdexp .st .ok { color: #5adc78; }
.hdexp .st.pop { animation: hdexp-pop .6s ease-out; }
@keyframes hdexp-pop { 0% { transform: scale(1.25); box-shadow: 0 0 30px #ffd65a; } 100% { transform: scale(1); box-shadow: none; } }
.hdexp .bar { position: relative; height: 26px; border-radius: 13px; background: #262a4c; overflow: hidden; }
.hdexp .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--c); border-radius: 13px; }
.hdexp .bar span { position: absolute; left: 12px; top: 3px; font-size: 15px; text-shadow: 0 1px 2px #000; }
.hdexp .coach { color: #ffe196; font-size: 15px; } .hdexp .coach b { color: #ffd65a; }
.hdexp .prompt { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); display: flex; align-items: center; gap: 18px; background: #0b0e20; border: 4px solid #ffd65a; border-radius: 30px; padding: 10px 26px; box-shadow: 0 6px 30px rgba(0,0,0,.6); }
.hdexp .prompt b { font: 30px "MT Luckiest Guy", Impact, sans-serif; color: #ffd65a; }
.hdexp .prompt span { font: 24px "MT Luckiest Guy", Impact, sans-serif; padding: 4px 18px; border-radius: 20px; background: #262a4c; } .hdexp .prompt span.sel { background: #ffd65a; color: #12152c; }
.hdexp .prompt small { color: #9aa0c0; font-size: 13px; }
.hdexp .hint { position: absolute; bottom: 10px; right: 22px; color: #9aa0c0; font-size: 14px; }`;
