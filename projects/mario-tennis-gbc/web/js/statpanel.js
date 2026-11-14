// The level-up stat screen's HD panel (UI: HD): over the game's "Change which skill?" screen while its input loop runs
// (port/menus/char_data/screen.js sets P.charDataSeen each frame, read only), every stat with its dots and, for the skill page under
// the cursor, what a point there would change: the game's own deltas (ComputeLevelUpStatDeltas, the stats the rebuild would give),
// each turned into what it means in a match, in real units from the ROM's own tables:
//   Top / Slice    the spin of a topspin / slice stroke (07:4D31 / 07:4DD1 rows: wBallTopspin, wBallSideSpin), as a share of the strongest
//   Serve          a flat serve's speed (07:5111), Stroke a ground stroke's (07:4E71), Volley a volley's (07:5001), before the charge
//                  and the incoming ball's pace: km/h by ballfx.js's KMH
//   Angle          how wide the shot can be aimed (07:5C90, wAimOffsetScale), Placement the aim's random wobble (07:5C9A)
//   Speed          the top running speed (07:5C4A, km/h on the real court: 2496 units = 23.77 m), Dash the time to reach it (07:5C5E),
//                  Stop the time to stop from it (07:5C72), Reaction the time to turn right round (07:5C86, EaseCharFacing's step)
//   STAMINA        (PLAY+, engine/plus.js) the swings in a point before the shots weaken: 12 + endurance(base + 2 x level)
// The game keeps its input: the d-pad still moves between the pages, A gives the point, B takes it back.
import { KMH } from "./ballfx.js";

const romOff = (bank, addr) => bank * 0x4000 + (addr - 0x4000);
const GROUPS = [["SPIN", "#e2403a", [0, 1]], ["POWER", "#f08c28", [2, 3, 4]], ["CONTROL", "#3caa5a", [5, 6]], ["SPEED", "#3c82eb", [7, 8, 9, 10]]];
const NAMES = ["TOP", "SLICE", "SERVE", "STROKE", "VOLLEY", "ANGLE", "PLACEMENT", "SPEED", "DASH", "REACTION", "STOP"];
const STAMINA_COL = "#9a5ae0";
const RUN_KMH = 60 * 23.77 / 2496 * 3.6;                  // km/h per world unit per frame (a player's run: the real court's scale)

export class StatPanel {
  constructor() { this.on = true; this.el = null; this.key = ""; }
  // stat i's level v (0-9: the record's byte, the screen shows v + 1) as [what it is, its value as text, a number to compare]
  effect(rom, i, v, s) {
    v = Math.max(0, Math.min(9, v));
    const w = (bank, addr, k, at = 0) => { const o = romOff(bank, addr) + k * 8 + at; return (rom[o] | rom[o + 1] << 8) << 16 >> 16; };
    const t16 = (addr, k) => { const o = romOff(7, addr) + k * 2; return rom[o] | rom[o + 1] << 8; }, t8 = (addr, k) => rom[romOff(7, addr) + k];
    const speedNow = t16(0x5C4A, Math.max(0, Math.min(9, s[7] - 1)));   // (Dash and Stop: from and to this player's top speed)
    const kmh = bc => Math.round(bc / 256 * KMH), sec = f => (f / 60).toFixed(2) + " s";
    switch (i) {
      case 0: return ["topspin dip", Math.round(w(7, 0x4D31, v) / 7680 * 100) + "%", w(7, 0x4D31, v)];
      case 1: return ["slice curve", Math.round(w(7, 0x4DD1, v, 2) / 4224 * 100) + "%", w(7, 0x4DD1, v, 2)];
      case 2: return ["flat serve", kmh(w(7, 0x5111, v, 4)) + " km/h", w(7, 0x5111, v, 4)];
      case 3: return ["ground stroke", kmh(w(7, 0x4E71, v, 4)) + " km/h", w(7, 0x4E71, v, 4)];
      case 4: return ["volley", kmh(w(7, 0x5001, v, 4)) + " km/h", w(7, 0x5001, v, 4)];
      case 5: return ["widest aim", Math.round(t8(0x5C90, v) / 255 * 100) + "%", t8(0x5C90, v)];
      case 6: return ["aim wobble", "±" + t8(0x5C9A, v), -t8(0x5C9A, v)];
      case 7: return ["top speed", (t16(0x5C4A, v) / 256 * RUN_KMH).toFixed(1) + " km/h", t16(0x5C4A, v)];
      case 8: return ["to full speed", sec(speedNow / t16(0x5C5E, v)), -speedNow / t16(0x5C5E, v)];
      case 9: return ["turning round", sec(128 / t8(0x5C86, v)), -128 / t8(0x5C86, v)];
      case 10: return ["stopping", sec(speedNow / t16(0x5C72, v)), -speedNow / t16(0x5C72, v)];
    }
    return ["", "", 0];
  }
  // PLAY+ STAMINA: the swings (uncharged) in a point before the shots weaken, at stamina level lv (engine/plus.js plusStamina, endurance)
  staminaSwings(s, lv) {
    const base = Math.round(((s[7] - 1) + (s[8] - 1) + (s[9] - 1) + (s[10] - 1)) / 4), st = base + 2 * Math.min(50, lv);
    return 12 + Math.round(16 * st / (st + 16));
  }
  build() {
    if (!document.getElementById("hdstat-css")) { const st = document.createElement("style"); st.id = "hdstat-css"; st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement("div"); this.el.className = "hdstat"; this.el.style.display = "none"; document.body.appendChild(this.el);
  }
  // per frame (full.js): canvas = the game's view on the page; coach = TOUR+'s pick (tour.js coach()) or null; shown with UI: HD
  // (on, full.js), whichever main menu is chosen
  frame(port, canvas, gb, coach) {
    const s = port && port.charDataSeen, live = !!(s && s.stats && port.frames - s.at <= 2 && this.on);
    globalThis.__statPanelOn = live;
    if (!live) { if (this.el && this.el.style.display !== "none") this.el.style.display = "none"; this.key = ""; return; }
    if (!this.el) this.build();
    const key = JSON.stringify([s.stats, s.deltas, s.page, s.left, s.stamina, s.staminaSel, coach && coach.pick]);
    if (key !== this.key) { this.key = key; this.el.innerHTML = this.html(s, gb.mem.rom, coach); }
    const r = canvas.getBoundingClientRect(), k = Math.min(r.width / 1000, r.height / 600);
    Object.assign(this.el.style, { display: "block", left: r.left + r.width / 2 + "px", top: r.top + r.height / 2 + "px", transform: `translate(-50%,-50%) scale(${k.toFixed(3)})` });
  }
  html(s, rom, coach) {
    const name = String.fromCharCode(...s.name.filter(c => c >= 0x20 && c < 0x7F)).trim() || "YOU";
    const page = s.staminaSel ? 4 : s.page < 4 ? s.page : -1;
    const dots = (v, d, col) => { let h = ""; for (let i = 1; i <= 10; i++) { const on = i <= Math.min(v, v + d), up = d > 0 && i > v && i <= v + d, down = d < 0 && i > v + d && i <= v; h += `<i style="background:${up ? "#ffd65a" : down ? "#5a2630" : on ? col : "#2c304c"}"></i>`; } return h; };
    let list = "";
    GROUPS.forEach(([g, col, ids], gi) => {
      list += `<div class="g${gi === page ? " on" : ""}"><b style="color:${col}">${g}</b>${coach && coach.pick === gi ? `<span class="coach">COACH'S PICK</span>` : ""}</div>`;
      for (const i of ids) { const v = s.stats[i], d = s.deltas[i]; list += `<div class="r${gi === page ? " on" : ""}"><span>${NAMES[i]}</span><span class="dots">${dots(v, d, col)}</span><span class="n">${v + d}${d ? `<em class="${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"}</em>` : ""}</span></div>`; }
    });
    if (s.stamina >= 0) { const v = s.stamina + 1, d = s.staminaSel ? 1 : 0; list += `<div class="g${page === 4 ? " on" : ""}"><b style="color:${STAMINA_COL}">STAMINA</b></div><div class="r${page === 4 ? " on" : ""}"><span>STAMINA</span><span class="dots">${dots(Math.min(10, v), Math.min(d, 10 - Math.min(10, v)), STAMINA_COL)}</span><span class="n">${v + d}${d ? `<em class="up">▲</em>` : ""}</span></div>`; }
    // the effect panel: the stats a point on this page changes, before and after, in what they mean in a match
    let fx = "";
    if (page === 4) {
      const a = this.staminaSwings(s.stats, s.stamina), b = this.staminaSwings(s.stats, s.stamina + 1);
      fx = `<h3 style="color:${STAMINA_COL}">STAMINA ${s.stamina + 1} → ${s.stamina + 2}</h3><p class="d">Every swing tires you; a tired player hits softer and runs slower. It comes back after each point.</p>` +
        `<div class="fx"><span>swings in a point before your shots weaken</span><b>${a} → ${b}</b></div><p class="d">(each charged power shot counts for up to five)</p>`;
    } else if (page >= 0) {
      const [g, col, ids] = GROUPS[page], ch = ids.concat(GROUPS.flatMap(x => x[2]).filter(i => !ids.includes(i) && s.deltas[i]));
      fx = `<h3 style="color:${col}">A POINT IN ${g}</h3><p class="d">The game rebuilds every stat from your level and training: this page goes up, and now and then another one slips.</p>`;
      for (const i of ch) {
        const v = s.stats[i] - 1, d = s.deltas[i], [what, a] = this.effect(rom, i, v, s.stats), [, b] = this.effect(rom, i, v + d, s.stats.map((x, j) => x + s.deltas[j]));
        fx += `<div class="fx${d > 0 ? " up" : d < 0 ? " dn" : ""}"><span>${NAMES[i]} <small>${what}</small></span><b>${d ? `${a} → ${b}` : a}</b></div>`;
      }
    } else {
      fx = `<h3>CHOOSE A SKILL</h3><p class="d">Move to a skill page to see what a point there would do.</p>`;
      for (let i = 0; i < 11; i++) { const [what, a] = this.effect(rom, i, s.stats[i] - 1, s.stats); fx += `<div class="fx"><span>${NAMES[i]} <small>${what}</small></span><b>${a}</b></div>`; }
    }
    const balls = Array.from({ length: Math.min(12, s.left) }, () => `<i class="ball"></i>`).join("");
    return `<div class="top"><b>${name}</b><span>LV ${s.level}</span><span class="left">${balls}<em>${s.left} LEFT</em></span></div><div class="cols"><div class="list">${list}</div><div class="fxp">${fx}</div></div><div class="hint">✚ choose a skill · A give a point · B take it back</div>`;
  }
}
const CSS = `
.hdstat { position: fixed; z-index: 30; width: 1000px; height: 600px; transform-origin: center; background: #12152c; border: 4px solid #ffcf3a; border-radius: 22px; color: #f0f2fa; font: 17px Itim, system-ui, sans-serif; padding: 16px 22px; box-sizing: border-box; pointer-events: none; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.hdstat .top { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; }
.hdstat .top b { font: 32px "MT Luckiest Guy", Impact, sans-serif; letter-spacing: .5px; } .hdstat .top span { color: #c8cde6; font-size: 20px; }
.hdstat .left { margin-left: auto; display: flex; align-items: center; gap: 4px; } .hdstat .left em { font: 22px "MT Luckiest Guy", Impact, sans-serif; color: #fff; font-style: normal; margin-left: 8px; }
.hdstat .ball { width: 20px; height: 20px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #f4ff8a, #c8de2c 60%, #8fa018); display: inline-block; }
.hdstat .cols { display: flex; gap: 18px; height: 490px; }
.hdstat .list { flex: 1.05; display: flex; flex-direction: column; justify-content: space-between; }
.hdstat .g { font: 18px "MT Luckiest Guy", Impact, sans-serif; letter-spacing: .5px; display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.hdstat .coach { font: 12px Itim, system-ui, sans-serif; background: #1d2b7a; color: #ffd65a; padding: 1px 8px; border-radius: 8px; }
.hdstat .r { display: flex; align-items: center; gap: 10px; padding: 1px 8px; border-radius: 8px; }
.hdstat .r.on { background: #463a14; }
.hdstat .r span:first-child { width: 110px; font-size: 16px; } .hdstat .dots { display: flex; gap: 3px; } .hdstat .dots i { width: 15px; height: 10px; border-radius: 3px; display: block; }
.hdstat .n { margin-left: auto; font: 18px "MT Luckiest Guy", Impact, sans-serif; } .hdstat .n em { font-style: normal; margin-left: 4px; font-size: 13px; } .hdstat em.up { color: #5adc78; } .hdstat em.dn { color: #ff6a6a; }
.hdstat .fxp { flex: 1; background: #0b0e20; border: 3px solid #ffd65a; border-radius: 18px; padding: 14px 18px; overflow: hidden; }
.hdstat h3 { margin: 0 0 4px; font: 26px "MT Luckiest Guy", Impact, sans-serif; letter-spacing: .5px; color: #ffd65a; }
.hdstat .d { color: #aab0d0; font-size: 14px; margin: 0 0 10px; }
.hdstat .fx { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 5px 0; border-bottom: 1px solid #22264a; }
.hdstat .fx span { font-size: 16px; } .hdstat .fx small { color: #9aa0c0; font-size: 13px; } .hdstat .fx b { font: 20px "MT Luckiest Guy", Impact, sans-serif; white-space: nowrap; }
.hdstat .fx.up b { color: #ffd65a; } .hdstat .fx.dn b { color: #ff8a8a; }
.hdstat .hint { position: absolute; bottom: 10px; right: 22px; color: #9aa0c0; font-size: 14px; }`;
