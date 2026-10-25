// Modes and conveniences (each remembered in this browser; the ones that change play act only through the JS port, CODE: PORT):
//   RULES       an exhibition's SETS (1 / 3 / 5), GAMES a set (2 / 3 / 4 / 6), TIEBREAK (on, or an advantage set), NO-AD games (the
//               next point at 40-40 wins): P.rules, read by engine/flow.js (resetMatchState, checkSetWon, gameWon) in exhibitions only
//   REMATCH     after an exhibition, "REMATCH?" over the menu: yes plays the same match again (P.rematchOn; story_scripts/devmap_10.js
//               askRematch, which this draws from P.rematchAsk)
//   MACHINE     the Tennis Machine's drills on another court (P.machineCourt: minigames/drills.js), the machine and its balls the same
//   MINI-GAMES  Hard: the Mario mini-games want half as many points again to clear (P.minigameHard: minigame_core.js)
//   PARTNER     in doubles, SELECT + a direction tells your partner what to do: UP play at the net, DOWN stay back, LEFT / RIGHT poach
//               (go for the balls in the middle), SELECT alone their own game again (P.partnerCmd: engine/ai.js); SELECT and the
//               direction are kept from the game meanwhile
//   FAST TEXT   hold B while a dialogue window is open (off the court) and the game runs four times as fast
//   RECORDS     a panel: the DAILY challenge (one a day, the same for everyone that day, a streak for days in a row), career STATS
//               (every match you play on a court: points, aces, winners, errors, double faults, the fastest serve, the longest
//               rally), the MINI-GAMES' best scores by level, and practice GOALS: in the tour's practice matches a 10-shot rally, an
//               ace, a game won to love and the match itself each give bonus EXP, counted into the match's own EXP award (the
//               game's EXP screen shares it out: P.extraMatchExp); with CODE: ROM added to your tour character when you are back on
//               the campus (wC900 + $2C, capped at 99999 like the game's own)
// Reading the game: the score ($C8E0-$C8E8), wRallyLength $C4B6, wPointOutcome $C4D8, the ball's velocity, wGameMode $C8A6,
// wCurrentlyUsedCourt $C8F4, wMatchIsDoubles $C8F2, the minigame's score $C47C and level $C376.
import { HdPanel, hdStyle, esc } from "./hdpanel.js";
import { MenuSkins } from "./menuskins.js";
import { KMH } from "./ballfx.js";

const textAt = MenuSkins.prototype.textAt;
const REC_KEY = "mt-records";
const OUT_WINNER = 6, OUT_NET = 4, OUT_OUT = 5, OUT_DOUBLE = 2;
const GM_EXHIB = 4, GM_MINIGAME = 8, GM_PRACTICE = 3, MATCH_MODES = [1, 2, 3, 4, 9, 10];
const COURTS = ["Hard", "Clay", "Grass", "Composition", "Star", "Castle", "Tropics", "Jungle", "Warehouse"];
const SETTINGS = {
  sets: { key: "mt-ex-sets", vals: ["game", "1", "3", "5"], def: "game", name: "SETS", label: v => v === "game" ? "Game's" : v,
    title: "exhibition matches: how many sets (best of 1, 3 or 5), or the game's choice in the format menu (needs CODE: PORT)" },
  games: { key: "mt-ex-games", vals: ["game", "2", "3", "4", "6"], def: "game", name: "GAMES", label: v => v === "game" ? "Game's" : v,
    title: "exhibition matches: games to win a set, or the game's choice (needs CODE: PORT)" },
  tiebreak: { key: "mt-ex-tb", vals: ["on", "off"], def: "on", name: "TIEBREAK", label: v => v === "on" ? "On" : "Off (advantage set)",
    title: "exhibition matches: a tiebreak at 6-6, or play on until someone is two games clear (needs CODE: PORT)" },
  noAd: { key: "mt-ex-noad", vals: ["off", "on"], def: "off", name: "NO-AD", label: v => v === "on" ? "On" : "Off",
    title: "exhibition matches: no advantage: at 40-40 the next point wins the game (needs CODE: PORT)" },
  rematch: { key: "mt-rematch", vals: ["on", "off"], def: "on", name: "REMATCH", label: v => v === "on" ? "On" : "Off",
    title: "after an exhibition match: play it again straight away, same players and court (needs CODE: PORT)" },
  machine: { key: "mt-machine", vals: ["room", "0", "1", "2", "3", "4", "5", "6", "7", "8"], def: "room", name: "MACHINE", label: v => v === "room" ? "Room" : COURTS[+v],
    title: "the Tennis Machine's drills on the court you pick, or in its own room (needs CODE: PORT)" },
  mgHard: { key: "mt-mghard", vals: ["off", "on"], def: "off", name: "MINI-GAMES", label: v => v === "on" ? "Hard" : "Normal",
    title: "the Mario mini-games: Hard wants half as many points again to clear each level (needs CODE: PORT)" },
  partner: { key: "mt-partner", vals: ["on", "off"], def: "on", name: "PARTNER", label: v => v === "on" ? "Commands" : "Off",
    title: "doubles: SELECT + UP your partner plays the net, + DOWN stays back, + LEFT / RIGHT poaches, SELECT alone their own game (needs CODE: PORT)" },
  fastText: { key: "mt-fasttext", vals: ["on", "off"], def: "on", name: "FAST TEXT", label: v => v === "on" ? "Hold B" : "Off",
    title: "hold B while a dialogue window is open and the text runs four times as fast" },
};
const PARTNER_NAMES = { net: "AT THE NET", back: "STAY BACK", poach: "POACH" };
const DAILY = [
  { id: "court", text: d => `Win an exhibition match on the ${COURTS[d.court]} court`, test: (m, d) => m.mode === GM_EXHIB && m.won && m.court === d.court },
  { id: "love", text: () => "Win a game to love (any match)", test: m => m.loveGames > 0 },
  { id: "aces", text: () => "Hit 3 aces in one match", test: m => m.aces >= 3 },
  { id: "rally", text: () => "Win a point after a rally of 15 shots or more", test: m => m.longWin >= 15 },
  { id: "doubles", text: () => "Win an exhibition doubles match", test: m => m.mode === GM_EXHIB && m.won && m.doubles },
  { id: "clean", text: () => "Win a match without a double fault", test: m => m.won && m.doubleFaults === 0 },
];
const GOALS = [
  { id: "rally", name: "A rally of 10 shots", exp: 150, test: m => m.longest >= 10 },
  { id: "ace", name: "An ace", exp: 100, test: m => m.aces >= 1 },
  { id: "love", name: "A game won to love", exp: 150, test: m => m.loveGames >= 1 },
  { id: "win", name: "The match won", exp: 200, test: m => m.won },
];
const today = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const freshRec = () => ({ v: 1, stats: { matches: 0, wins: 0, won: 0, lost: 0, aces: 0, winners: 0, errors: 0, doubleFaults: 0, longest: 0, fastest: 0, loveGames: 0 }, mg: {}, daily: { date: 0, done: false, streak: 0, last: 0 }, goals: { pending: 0, total: 0 } });

export class Modes extends HdPanel {
  constructor({ getGb, getPort, pause, pad }) {
    super({ pause, pad }); this.getGb = getGb; this.getPort = getPort;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    this.s = {};
    for (const [k, S] of Object.entries(SETTINGS)) { let v = q.get(S.key.slice(3)); if (!S.vals.includes(v)) { try { v = localStorage.getItem(S.key); } catch (e) { v = null; } } this.s[k] = S.vals.includes(v) ? v : S.def; }
    try { this.rec = { ...freshRec(), ...JSON.parse(localStorage.getItem(REC_KEY) || "null") }; } catch (e) { this.rec = freshRec(); }
    if (!this.rec || this.rec.v !== 1) this.rec = freshRec();
    this.m = null; this.prev = null; this.lastMap = -1; this.mg = null; this.partnerHeld = false; this.partnerUsed = false; this.chipT = 0;
    this.buttons = {};
  }
  set(k, v) { this.s[k] = v; try { localStorage.setItem(SETTINGS[k].key, v); } catch (e) { /* private mode */ } this.apply(); if (this.buttons[k]) this.buttons[k](); }
  save() { try { localStorage.setItem(REC_KEY, JSON.stringify(this.rec)); } catch (e) { /* full */ } }
  // the port's switches, from the settings (full.js calls this when the port is made and after each change)
  apply() {
    const P = this.getPort && this.getPort(); if (!P) return; const s = this.s;
    const rules = { sets: s.sets === "game" ? 0 : +s.sets, games: s.games === "game" ? 0 : +s.games, tiebreak: s.tiebreak === "on", noAd: s.noAd === "on" };
    P.rules = rules.sets || rules.games || !rules.tiebreak || rules.noAd ? rules : null;
    P.rematchOn = s.rematch === "on";
    P.machineCourt = s.machine === "room" ? null : +s.machine;
    P.minigameHard = s.mgHard === "on";
    P.extraMatchExp = mode => this.takeMatchExp(mode);
    if (s.partner !== "on") P.partnerCmd = null;
  }
  w0() { const gb = this.getGb(); return gb && gb.mem.wram[0]; }

  // ---------------- the pad, before the game reads it (full.js frame): the partner's commands ----------------
  filterInput(inp) {
    const w = this.w0(), P = this.getPort && this.getPort(); if (!w || !P || this.s.partner !== "on") return inp;
    const doubles = w[0x32E] <= 15 && w[0x8F2] && MATCH_MODES.includes(w[0x8A6]);
    if (!doubles) { if (P.partnerCmd && w[0x32E] > 15) P.partnerCmd = null; this.partnerHeld = false; return inp; }
    if (inp.select) {
      const dir = inp.up ? "net" : inp.down ? "back" : inp.left || inp.right ? "poach" : null;
      if (dir && dir !== P.partnerCmd) { P.partnerCmd = dir; this.chip(`PARTNER: <b>${PARTNER_NAMES[dir]}</b>`); }
      if (dir) this.partnerUsed = true;
      this.partnerHeld = true;
      return { ...inp, select: false, up: false, down: false, left: false, right: false };
    }
    if (this.partnerHeld && !this.partnerUsed && P.partnerCmd) { P.partnerCmd = null; this.chip("PARTNER: <b>OWN GAME</b>"); }   // SELECT alone: their own game
    this.partnerHeld = false; this.partnerUsed = false;
    return inp;
  }
  // FAST TEXT (full.js loop): B held with a dialogue window open, off the court
  fastText(inp) {
    if (this.s.fastText !== "on" || !inp || !inp.b) return false;
    const gb = this.getGb(); if (!gb) return false;
    return gb.mem.wram[0][0x32E] > 15 && gb.mem.wram[5][0x824] !== 0xFF;    // wDialogueWindowId (WRAM 5 $D824): a window is open
  }

  // ---------------- per frame (full.js, after each emulated frame): matches and mini-games ----------------
  frame() {
    const w = this.w0(); if (!w) return;
    const map = w[0x32E], mode = w[0x8A6], onCourt = map <= 15;
    if (onCourt && MATCH_MODES.includes(mode)) this.watch(w, mode);
    else if (this.m && !onCourt) this.m = null;
    if (onCourt && mode === GM_MINIGAME) { const sc = w[0x47C] | w[0x47D] << 8; if (!this.mg) this.mg = { id: w[0x8F7], lv: w[0x376], best: 0 }; this.mg.best = Math.max(this.mg.best, sc); }
    if (!onCourt && this.lastMap <= 15 && this.mg) this.mgEnd();
    if (!onCourt && this.rec.goals.pending && map >= 17 && map <= 36 && !(this.getPort && this.getPort())) this.payGoals(w);
    this.lastMap = map;
  }
  watch(w, mode) {
    const S = { sets: [w[0x8E0], w[0x8E1]], games: [w[0x8E2], w[0x8E3]], pts: [w[0x8E4], w[0x8E5]], won: w[0x8E8], hits: w[0x4B6] };
    const p = this.prev; this.prev = S;
    const zero = ![...S.sets, ...S.games, ...S.pts].some(x => x), sig = s => [...s.sets, ...s.games, ...s.pts].join();
    if (!this.m || (zero && p && sig(p) !== sig(S))) this.m = { mode, court: this.court(w), doubles: !!w[0x8F2], won: false, done: false, points: [0, 0], aces: 0, winners: 0, errors: 0, doubleFaults: 0, longest: 0, longWin: 0, fastest: 0, loveGames: 0, ptMax: 0, serveAt: 0, lost: [0, 0], gamePts: [0, 0] };
    const m = this.m; if (!p || m.done) return;
    const h = S.hits; m.ptMax = Math.max(m.ptMax, h);
    const gb = this.getGb();
    if (h === 1 && p.hits === 0) m.serveAt = gb.ppu.frames + 2;
    if (m.serveAt && gb.ppu.frames >= m.serveAt) {                         // the serve's launch speed (as MATCH FX reads it), yours only
      m.serveAt = 0;
      const s24 = a => ((w[a] | (w[a + 1] << 8) | (w[a + 2] << 16)) << 8 >> 8) / 65536, kmh = Math.round(Math.hypot(s24(0x420), s24(0x423), s24(0x426)) * KMH);
      if (!(w[0x4B8] & 1)) m.fastest = Math.max(m.fastest, kmh);
    }
    if (sig(S) !== sig(p) && !zero) {                                       // a point went into the score
      const d = i => (S.sets[i] - p.sets[i]) * 1e4 + (S.games[i] - p.games[i]) * 100 + (S.pts[i] - p.pts[i]), win = d(0) > d(1) ? 0 : 1, o = w[0x4D8], r = m.ptMax; m.ptMax = 0;
      m.points[win]++; m.longest = Math.max(m.longest, r);
      if (win === 0) { if (o === OUT_WINNER) { m.winners++; if (r === 1) m.aces++; } if (r >= m.longWin) m.longWin = r; }
      else if (o === OUT_NET || o === OUT_OUT) m.errors++;
      else if (o === OUT_DOUBLE) m.doubleFaults++;
      const gameDone = S.games[0] + S.games[1] !== p.games[0] + p.games[1] || S.sets[0] + S.sets[1] !== p.sets[0] + p.sets[1];
      m.gamePts[win]++;
      if (gameDone) { if (win === 0 && m.gamePts[1] === 0) m.loveGames++; m.gamePts = [0, 0]; }
    }
    if (S.won && !p.won) this.end(m, S.won === 1);
  }
  court(w) { return w[0x8F4]; }                                          // wCurrentlyUsedCourt $C8F4
  end(m, won) {
    m.done = true; m.won = won; const T = this.rec.stats;
    T.matches++; if (won) T.wins++; T.won += m.points[0]; T.lost += m.points[1]; T.aces += m.aces; T.winners += m.winners; T.errors += m.errors;
    T.doubleFaults += m.doubleFaults; T.longest = Math.max(T.longest, m.longest); T.fastest = Math.max(T.fastest, m.fastest); T.loveGames += m.loveGames;
    const D = this.daily();
    if (!D.done && D.c.test(m, D)) {
      const R = this.rec.daily; R.done = true; R.streak = R.last === this.yesterday() ? R.streak + 1 : 1; R.last = R.date;
      this.toast(`DAILY CHALLENGE DONE! ${R.streak > 1 ? R.streak + " days in a row" : "Come back tomorrow for the next"}`);
    }
    if (m.mode === GM_PRACTICE) {                                           // GOALS: the tour's practice matches
      const got = GOALS.filter(g => g.test(m)); const exp = got.reduce((a, g) => a + g.exp, 0);
      if (exp) { this.rec.goals.pending += exp; this.toast(`Practice goals: ${got.map(g => g.name.toLowerCase()).join(", ")}: +${exp} EXP`); }
    }
    this.save();
  }
  // the port's award sequence (port/menus/exp/award_sequence.js), as a story match's EXP is worked out: the practice
  // goals' EXP goes into the match's award, so the game's own EXP screen counts it in and shares it out (level-ups,
  // the stats screen) like the rest. Bonus EXP still owed from before (CODE: ROM) comes with it.
  takeMatchExp(mode) {
    const G = this.rec.goals, exp = G.pending;
    if (mode !== GM_PRACTICE || !exp) return 0;
    G.total += exp; G.pending = 0; this.save();
    return exp;
  }
  // CODE: ROM only (its code cannot be changed): the EXP added straight to the tour character's total (wC900 + $2C)
  // back on the campus
  payGoals(w) {
    let name = ""; for (let i = 0; i < 8; i++) { const c = w[0x900 + i]; if (c < 0x20 || c > 0x7E) break; name += String.fromCharCode(c); }
    if (!name.trim()) return;
    const G = this.rec.goals, o = 0x92C, v = Math.min(99999, (w[o] | (w[o + 1] << 8) | (w[o + 2] << 16)) + G.pending);
    w[o] = v & 0xFF; w[o + 1] = (v >> 8) & 0xFF; w[o + 2] = v >> 16;
    G.total += G.pending; G.pending = 0; this.save();
  }
  mgEnd() {
    const g = this.mg; this.mg = null; if (g.id < 0x1C || g.id > 0x23 || !g.best) return;
    const R = this.rec.mg[g.id] || (this.rec.mg[g.id] = {}), k = String(g.lv);
    if (!(R[k] >= g.best)) { const first = R[k] === undefined; R[k] = g.best; this.save(); if (!first) this.toast(`New best: ${g.best} (${this.mgName(g.id)}, level ${g.lv + 1})`); }
  }
  mgName(id) { try { const gb = this.getGb(), t = gb ? textAt(gb.mem.rom, 0x30, 0xB2 + id - 0x1C) : ""; return t ? t.toLowerCase().replace(/(^|[ .-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : "Mini-game " + (id - 0x1B); } catch (e) { return "Mini-game " + (id - 0x1B); } }
  yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  // today's challenge (seeded by the date): which one, and the court for the court challenge
  daily() {
    const R = this.rec.daily, t = today();
    if (R.date !== t) { R.date = t; R.done = false; this.save(); }
    let s = (t * 2654435761) >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const c = DAILY[(rnd() * DAILY.length) | 0], court = (rnd() * 4) | 0;
    return { c, court, done: R.done, text: c.text({ court }) };
  }

  // ---------------- the overlays: the rematch question, the partner's command ----------------
  overlay() {
    const P = this.getPort && this.getPort();
    const a = P && P.rematchAsk, live = a && P.frames - a.at <= 2;
    if (!this.askEl) { if (!live) return; hdStyle(); this.askEl = document.createElement("div"); this.askEl.className = "hdchip"; this.askEl.style.cssText = "bottom:auto;top:40%;font-size:22px;padding:14px 30px"; document.body.appendChild(this.askEl); }
    if (live) this.askEl.innerHTML = `<b style="font-size:30px">REMATCH?</b><br><span style="${a.sel ? "opacity:.5" : "color:#ffcf3a"}">▶ YES</span> &nbsp; &nbsp; <span style="${a.sel ? "color:#ffcf3a" : "opacity:.5"}">▶ NO</span><br><span style="font-size:14px;opacity:.8">A ok · B no</span>`;
    this.askEl.style.display = live ? "block" : "none";
  }
  chip(html) {
    hdStyle(); if (!this.chipEl) { this.chipEl = document.createElement("div"); this.chipEl.className = "hdchip"; this.chipEl.style.bottom = "20%"; document.body.appendChild(this.chipEl); }
    this.chipEl.innerHTML = html; this.chipEl.style.display = "block"; clearTimeout(this.chipT); this.chipT = setTimeout(() => { this.chipEl.style.display = "none"; }, 1800);
  }

  // ---------------- the RECORDS panel ----------------
  pages() { return ["DAILY", "STATS", "MINI-GAMES", "GOALS"]; }
  pageFns() { return [this.pDaily, this.pStats, this.pMinigames, this.pGoals]; }
  pDaily() {
    const D = this.daily(), R = this.rec.daily;
    return `<h3>TODAY'S CHALLENGE</h3><p class="big">${esc(D.text)}</p><p>${D.done ? '<span class="up">✔ Done today!</span>' : "Not done yet."} ${R.streak ? `Streak: <b>${R.streak}</b> day${R.streak > 1 ? "s" : ""}${R.last === today() || R.last === this.yesterday() ? "" : " (broken: do today's to start again)"}` : ""}</p><p class="hint">A new challenge every day, the same for everyone that day. Do one on consecutive days for a streak. Exhibition matches count, and so do the tour's where it says "any match".</p>`;
  }
  pStats() {
    const T = this.rec.stats, pc = (a, b) => b ? Math.round(a * 100 / b) + "%" : "-";
    const rows = [["Matches", T.matches], ["Won", `${T.wins} (${pc(T.wins, T.matches)})`], ["Points won", `${T.won} of ${T.won + T.lost} (${pc(T.won, T.won + T.lost)})`], ["Aces", T.aces], ["Winners", T.winners],
      ["Errors (net or out)", T.errors], ["Double faults", T.doubleFaults], ["Games won to love", T.loveGames], ["Fastest serve", T.fastest ? T.fastest + " km/h" : "-"], ["Longest rally", T.longest ? T.longest + " shots" : "-"]];
    return `<p class="hint">Every match you play on a court (exhibition, tour, link), on this phone or browser.</p><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td class="n"><b>${b}</b></td></tr>`).join("")}</table>`;
  }
  pMinigames() {
    const M = this.rec.mg, ids = Object.keys(M).map(Number).sort((a, b) => a - b);
    let h = `<p class="hint">Your best score in each Mario mini-game, by level${this.s.mgHard === "on" ? " (MINI-GAMES: Hard is on: half as many points again to clear)" : ""}.</p>`;
    if (!ids.length) return h + "<p>Play a mini-game and your best scores are kept here.</p>";
    return h + `<table>${ids.map(id => `<tr><td>${esc(this.mgName(id))}</td>${[0, 1, 2].map(l => `<td class="n">L${l + 1}: <b>${M[id][l] ?? "-"}</b></td>`).join("")}</tr>`).join("")}</table>`;
  }
  pGoals() {
    const G = this.rec.goals;
    const port = !!(this.getPort && this.getPort());
    return `<p class="hint">In the tour's practice matches each of these gives bonus EXP once per match, ${port ? "counted into the match's EXP on the game's own EXP screen" : "added to your tour character when you are back on the campus (the game's own level-up screen comes after your next match or mini-game)"}.</p><table>${GOALS.map(g => `<tr><td>${g.name}</td><td class="n"><b>+${g.exp} EXP</b></td></tr>`).join("")}</table><p>Bonus EXP so far: <b>${G.total}</b>${G.pending ? ` (+${G.pending} waiting for ${port ? "your next practice match" : "the campus"})` : ""}</p>`;
  }
}

// the HUD buttons (each also in OPTIONS > MODES): one per setting, and RECORDS (the panel)
export function addModeButtons(hud, modes) {
  for (const [k, S] of Object.entries(SETTINGS)) {
    const b = document.createElement("span"); b.className = "k"; b.id = "mode-" + k; b.title = S.title;
    const show = () => { const v = modes.s[k]; b.textContent = S.name + ": " + S.label(v); b.classList.toggle("on", v !== S.def); };
    modes.buttons[k] = show; show();
    b.addEventListener("pointerdown", () => { const i = S.vals.indexOf(modes.s[k]); modes.set(k, S.vals[(i + 1) % S.vals.length]); });
    hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
  }
  const r = document.createElement("span"); r.className = "k"; r.id = "recordsbtn"; r.textContent = "RECORDS"; r.title = "the daily challenge, your career stats, mini-game best scores and practice goals";
  r.addEventListener("pointerdown", () => modes.toggle());
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(r);
}
export const MODE_BUTTON_IDS = [...Object.keys(SETTINGS).map(k => "mode-" + k), "recordsbtn"];
