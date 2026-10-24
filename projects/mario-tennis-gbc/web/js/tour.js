// "TOUR+: on / off" (remembered, mt-tourplus; ?tourplus=on|off): the tour's own systems on top of the story, kept per tour file in
// this browser (localStorage mt-tour-<slot>). It only READS the game: nothing here writes the machine, so recordings, saves and the
// lockstep are untouched. One exception is opt-in through PLAY+ (engine/plus.js): a tired player tires sooner in long rallies.
//   RANKINGS    each class's ladder (Junior / Senior / Varsity, singles and doubles) from the game's own match table (bank $0A
//               Singles- / DoublesMatchSettingsTable_0a: the opponent of every ranking match) and its won-rank flags (wGameFlags
//               $C9C0: FLAG_WON_<CLASS>_<KIND>_RANK_<N>), so a file played before TOUR+ existed still shows where it stands; every
//               player with their level (StoryCharacterRecords_02 $02:52CF) and your record against them; news from around the
//               academy, a few results a day among the other players (seeded by the day: the same on every look)
//   RIVALS      everyone you have played in the tour: wins, losses, the last score and how long ago; a rival you have met before
//               says something about it on the VS screen (intro.js: the opponent's speech bubble)
//   TRAINING    what you practise: your shots in matches (wShotType $C4A0 / wShotPower $C4A6 of each of your hits: spin, power,
//               control) and your legs (shots past the 6th of a rally: speed), and the drills by kind; the coach's pick for your next
//               level-up points, shown on the game's own stat screen too (port/menus/char_data/screen.js: P.charDataSeen)
//   EQUIPMENT   your racket and shoes (wMainCharEquipmentBits $C83C) with what each one does to the eleven stats, read from the ROM
//               (RacketStatDeltas_02 $02:46EF, ShoeStatDeltas_02 $02:475F), and the ones you own (FLAG_HAVE_*)
//   SCHEDULE    the tour's days: a match costs energy (a ranking or Island Open match 25, a practice match 15, a drill or a
//               mini-game 10), a meal at the cafeteria or the restaurant gives 15 back (once a day each), and resting in your dorm
//               room starts a new day with full energy; under 50 energy, with PLAY+ on, long rallies tire you sooner (plus.fatigue)
//   SPONSORS    brands that sign you as you go (your first ranking win, three wins in a row, beating someone you had lost to, the
//               senior class, ten wins, the Island Open, winning it); in your tour matches the stadium's boards carry their adverts
//               (stadium3d.js sponsorAds)
// The panel opens from the TOUR button in the menu bar (and OPTIONS > PLAY); it pauses the game; LEFT / RIGHT change the page,
// UP / DOWN scroll, B or START close it.
import { MenuSkins } from "./menuskins.js";

const KEY = "mt-tourplus", SLOT_KEY = s => "mt-tour-" + s;
const textAt = MenuSkins.prototype.textAt;
const romOff = (bank, addr) => bank * 0x4000 + (addr - 0x4000);
// RAM ($C000-$CFFF: WRAM bank 0)
const W = { map: 0x32E, location: 0x280, slot: 0x36C, mode: 0x8A6, list: 0x8F6, match: 0x8F7, sets: 0x8E0, games: 0x8E2, result: 0x8E8,
  flags: 0x9C0, equip: 0x83C, hero: 0x900, trainLevels: 0x938, ballVy: 0x423, shotType: 0x4A0, shotPower: 0x4A6, hits: 0x4B6, opp: 0xA80 };
const GM = { RANKING: 1, OPEN: 2, PRACTICE: 3, DRILL: 5, MACHINE: 6, WALL: 7, MINIGAME: 8, DREAM: 10 };
const LOC = { DORM_ROOM: 0x0A, RESTAURANT: 0x0D, CAFETERIA: 0x0E };
// ROM
const MATCH_TABLES = [[0x0A, 0x4AB2], [0x0A, 0x4B2F]];                   // singles, doubles: 25 x { mode, opponent, court, sets << 4 | games, bgm }
const DOUBLES_PARTNER = [0x0A, 0x49D9];                                   // DoublesPartnerTable_0a: the opponent's partner by char id
const NAME_REMAP = [0x02, 0x4C6A];                                        // NameTextRemap_02: ids $20+ shown as a roster character
const CHAR_RECORDS = [0x02, 0x52CF], CHAR_RECORD = 29, REC_LEVEL = 0x18 - 0x0F;
const RACKETS = [0x02, 0x46EF], SHOES = [0x02, 0x475F];
const RACKET_NAMES = ["Normal", "Large", "Small", "Iron", "Gold", "Silver", "Drive"], SHOE_NAMES = ["Normal", "Iron", "Light"];
const RACKET_FLAGS = [-1, 97, 98, 99, 101, 100, 102], SHOE_FLAGS = [-1, 103, 104];
const STATS = ["Topspin", "Slice", "Serve", "Stroke", "Volley", "Angle", "Placement", "Speed", "Dash", "Reaction", "Stop"];
const SKILLS = ["SPIN", "POWER", "CONTROL", "SPEED"];                     // the character-data screen's four pages, in its order
// the ladders: [name, list (0 singles, 1 doubles), [match id, won flag] from the bottom rung to the top]
const LADDERS = [
  ["JUNIOR SINGLES", 0, [[1, 80], [2, 81], [3, 82], [4, 83]]],
  ["JUNIOR DOUBLES", 1, [[2, 64], [3, 65], [4, 66]]],
  ["SENIOR SINGLES", 0, [[6, 84], [7, 85], [8, 86], [9, 87]]],
  ["SENIOR DOUBLES", 1, [[7, 68], [8, 69], [9, 70]]],
  ["VARSITY SINGLES", 0, [[0x0B, 88]]],
  ["VARSITY DOUBLES", 1, [[0x0D, 72], [0x0E, 175]]],
];
const MATCH_NAMES = { 0: "Practice", 1: "Rank 4", 2: "Rank 3", 3: "Rank 2", 4: "Rank 1", 5: "Practice", 6: "Rank 4", 7: "Rank 3", 8: "Rank 2", 9: "Rank 1",
  0x0A: "Practice", 0x0B: "Rank 4", 0x0C: "Rank 3", 0x0D: "Rank 2", 0x0E: "Rank 1", 0x10: "Island Open 1st round", 0x11: "Island Open 2nd round",
  0x12: "Island Open semi-final", 0x13: "Island Open final", 0x16: "Dream Match MAX", 0x17: "Dream Match Intense", 0x18: "Dream Match Hard" };
const classOf = id => id <= 4 ? "Junior" : id <= 9 ? "Senior" : id <= 0x0E ? "Varsity" : id <= 0x13 ? "Island Open" : "Dream Match";
const SPONSORS = [
  { id: "mushroom", name: "SUPER MUSHROOM", ad: 1, goal: "Win your first ranking match", test: (L, s) => s.rankWins >= 1 },
  { id: "star", name: "STAR POWER", ad: 2, goal: "Win three matches in a row", test: (L, s) => s.bestStreak >= 3 },
  { id: "oneup", name: "1-UP", ad: 7, goal: "Beat a player you had lost to", test: (L, s) => s.revenge >= 1 },
  { id: "fire", name: "FIRE FLOWER", ad: 10, goal: "Reach the senior class", test: (L, s, f) => f(83) || f(66) },
  { id: "yoshi", name: "YOSHI'S ISLAND", ad: 4, goal: "Win ten tour matches", test: (L, s) => s.wins >= 10 },
  { id: "wario", name: "WARIO GOLD", ad: 8, goal: "Reach the Island Open", test: (L, s, f) => f(174) || f(175) },
  { id: "peach", name: "PEACH'S CASTLE", ad: 3, goal: "Win the Island Open", test: (L, s, f) => f(60) || f(53) },
];
const COST = { [GM.RANKING]: 25, [GM.OPEN]: 25, [GM.DREAM]: 25, [GM.PRACTICE]: 15, [GM.DRILL]: 10, [GM.MACHINE]: 10, [GM.WALL]: 10, [GM.MINIGAME]: 10 };
const DRILL_SKILL = { [GM.MACHINE]: 3, [GM.WALL]: 2, [GM.MINIGAME]: 3 };   // a drill's kind of practice (the lessons: by their match id below)
const fresh = () => ({ v: 1, day: 1, energy: 100, meals: {}, today: [], matches: [], practice: [0, 0, 0, 0], sponsors: [], news: 0 });
const css = c => `rgb(${c.join(",")})`;

export class Tour {
  constructor({ getGb, getPort, pause, pad, toast }) {
    this.getGb = getGb; this.getPort = getPort; this.pause = pause; this.pad = pad; this.toastFn = toast;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("tourplus"); if (m !== "on" && m !== "off") { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.on = m !== "off"; this.onChange = null;
    this.slot = -1; this.data = null; this.cur = null; this.lastLoc = -1; this.lastHits = 0; this.lastMap = -1; this.next = 0; this.fatigueNow = 0;
    this.root = null; this.page = 0; this.open = false;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (!this.on) this.close(); if (this.onChange) this.onChange(this.on); }

  // ---------------- the tour file's record ----------------
  load(slot) {
    this.slot = slot; let d = null;
    try { d = JSON.parse(localStorage.getItem(SLOT_KEY(slot)) || "null"); } catch (e) { d = null; }
    this.data = d && d.v === 1 ? { ...fresh(), ...d } : fresh();
  }
  save() { if (this.slot < 0 || !this.data) return; try { localStorage.setItem(SLOT_KEY(this.slot), JSON.stringify(this.data)); } catch (e) { /* full or private */ } }
  flag(n) { const w = this.getGb().mem.wram[0]; return !!(w[W.flags + (n >> 3)] & (0x80 >> (n & 7))); }
  inStory() { const gb = this.getGb(); if (!gb) return false; const w = gb.mem.wram[0]; return w[W.slot] <= 2 && w[W.location] !== 0; }

  // ---------------- the ROM's names, levels, matches ----------------
  rom() { return this.getGb().mem.rom; }
  displayId(ch) { const r = this.rom(); return ch < 0x20 ? ch : r[romOff(...NAME_REMAP) + ((ch - 0x20) & 0x7F)]; }
  nameOf(ch) { try { const t = textAt(this.rom(), 0x30, 0x1B + this.displayId(ch)); return t ? t.toLowerCase().replace(/(^|[ .&])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : "?"; } catch (e) { return "?"; } }
  levelOf(ch) { return this.rom()[romOff(...CHAR_RECORDS) + CHAR_RECORD * ch + REC_LEVEL]; }
  matchDef(list, id) { const r = this.rom(), o = romOff(...MATCH_TABLES[list]) + 5 * id; return { mode: r[o], opp: r[o + 1], court: r[o + 2] }; }
  partnerOf(ch) { return this.rom()[romOff(...DOUBLES_PARTNER) + ch]; }
  partnerName() { const w = this.getGb().mem.wram[0]; let s = ""; for (let i = 0; i < 7; i++) { const c = w[W.hero + 0x40 + i]; if (c < 0x20 || c > 0x7E) break; s += String.fromCharCode(c); } return s.trim() || "partner"; }
  heroName() { const w = this.getGb().mem.wram[0]; let s = ""; for (let i = 0; i < 7; i++) { const c = w[W.hero + i]; if (c < 0x20 || c > 0x7E) break; s += String.fromCharCode(c); } return s.trim() || "YOU"; }

  // ---------------- per frame (full.js, after each emulated frame) ----------------
  frame() {
    if (!this.on) return; const gb = this.getGb(); if (!gb) return;
    const w = gb.mem.wram[0], slot = w[W.slot];
    if (slot > 2) { this.cur = null; return; }
    if (slot !== this.slot) this.load(slot);
    const map = w[W.map], mode = w[W.mode], onCourt = map <= 15;
    if (onCourt && !this.cur && COST[mode] && w[W.location] !== 0) this.begin(w, mode);
    if (this.cur) {
      if (onCourt) this.watch(w);
      if (this.cur.match && w[W.result] && !this.cur.done) this.end(w);
      if (!onCourt && this.lastMap <= 15) this.leave();
    }
    this.lastMap = map;
    if (gb.frames < this.next) return; this.next = gb.frames + 15;
    const loc = w[W.location];
    if (loc !== this.lastLoc && this.lastLoc >= 0 && this.inStory()) this.arrive(loc);
    if (this.pendingSpots && !this.cur && map >= 17 && this.inStory()) this.afterMatch();
    this.lastLoc = loc;
  }
  begin(w, mode) {
    const match = mode === GM.RANKING || mode === GM.OPEN || mode === GM.PRACTICE || mode === GM.DREAM;
    const list = w[W.list], id = w[W.match], opp = w[W.opp + 0x0B];
    this.cur = { mode, match, list, id, opp, oppName: this.nameOf(opp), oppLevel: w[W.opp + 0x18], setLog: [], sets: [0, 0], games: [0, 0], done: false, hits: 0 };
    this.fatigueNow = this.data.energy < 50 ? Math.min(1, (50 - this.data.energy) / 50) : 0;     // PLAY+: fixed for the match
    this.lastHits = w[W.hits];
  }
  watch(w) {
    const c = this.cur, sets = [w[W.sets], w[W.sets + 1]], games = [w[W.games], w[W.games + 1]];
    if (sets[0] + sets[1] > c.sets[0] + c.sets[1]) c.setLog.push(sets[0] > c.sets[0] ? [c.games[0] + 1, c.games[1]] : [c.games[0], c.games[1] + 1]);
    c.sets = sets; c.games = games;
    const h = w[W.hits];
    if (h !== this.lastHits && h > 0) {                                     // a hit: yours when the ball now flies away from you (P1 plays the near end)
      const vy = ((w[W.ballVy] | w[W.ballVy + 1] << 8 | w[W.ballVy + 2] << 16) << 8 >> 8);
      if (vy < 0) {
        const t = w[W.shotType], P = this.data.practice;
        if (w[W.shotPower] || t === 9 || t === 12 || t === 14 || t === 4 || t === 1 || t === 3) P[1]++;
        else if (t === 5 || t === 6 || t === 8 || t === 10 || t === 11) P[2]++;
        else P[0]++;
        if (h >= 6) P[3]++;
      }
    }
    this.lastHits = h;
  }
  end(w) {
    const c = this.cur, D = this.data; c.done = true;
    const won = w[W.result] === 1, score = c.setLog.map(g => g.join("-")).concat(c.games[0] + c.games[1] ? [c.games.join("-")] : []).join(" ");
    const prev = D.matches.filter(m => m.opp === c.oppName); c.won = won;
    if (!this.pendingSpots) this.pendingSpots = this.ladderSpots();         // (the game sets its won-rank flags after the results: compared back on the campus)
    D.matches.push({ day: D.day, list: c.list, id: c.id, mode: c.mode, opp: c.oppName, oppId: c.opp, lv: c.oppLevel, won, score, sets: c.sets });
    if (won && prev.some(m => !m.won) && !prev.slice(prev.findLastIndex(m => !m.won) + 1).some(m => m.won)) D.revenge = (D.revenge || 0) + 1;
    this.save();
  }
  // back on the campus after a match: the ladders moved? new sponsors?
  afterMatch() {
    const before = this.pendingSpots; this.pendingSpots = null; if (!before) return;
    const spots = this.ladderSpots(), i = spots.findIndex((s, k) => s.you !== before[k].you);
    if (i >= 0) this.toast(`${spots[i].name}: you are now #${spots[i].you} (from #${before[i].you})`);
    this.checkSponsors();
  }
  leave() {
    const c = this.cur, D = this.data; this.cur = null; if (!c) return;
    const cost = COST[c.mode] || 0;
    if (cost && (c.done || !c.match)) {
      D.energy = Math.max(0, D.energy - cost); D.today.push(c.match ? `${MATCH_NAMES[c.id] || "Match"} vs ${c.oppName}: ${c.won ? "won" : "lost"}` : c.mode === GM.MINIGAME ? "A mini-game" : "A drill");
      if (!c.match) { const k = DRILL_SKILL[c.mode] ?? (c.id < 6 ? 1 : c.id < 12 ? 2 : c.id < 18 ? 0 : 3); D.practice[k] += 8; }   // (the lessons: service, net game, stroke)
      this.save();
      if (D.energy < 30) this.toast(`Energy ${D.energy}: rest in your dorm room to start a new day`);
    }
  }
  arrive(loc) {
    const D = this.data;
    if (loc === LOC.DORM_ROOM && (D.today.length || D.energy < 100)) {
      D.day++; D.energy = 100; D.meals = {}; D.today = []; this.save();
      this.toast(`Day ${D.day} of the tour: rested, energy 100`);
    } else if ((loc === LOC.CAFETERIA || loc === LOC.RESTAURANT) && !D.meals[loc] && D.energy < 100) {
      D.meals[loc] = 1; D.energy = Math.min(100, D.energy + 15); D.today.push(loc === LOC.CAFETERIA ? "A meal at the cafeteria" : "A meal at the restaurant"); this.save();
      this.toast(`A good meal: energy ${D.energy}`);
    }
  }
  // PLAY+ (full.js: port.plus.fatigue): 0 rested .. 1 exhausted, fixed at the start of a match
  fatigue() { return this.on && this.cur && this.cur.match ? this.fatigueNow : 0; }

  // ---------------- what the pages show ----------------
  stats() {
    const M = this.data.matches.filter(m => m.mode !== GM.PRACTICE); let streak = 0, best = 0;
    for (const m of M) { streak = m.won ? streak + 1 : 0; best = Math.max(best, streak); }
    return { wins: M.filter(m => m.won).length, losses: M.filter(m => !m.won).length, rankWins: M.filter(m => m.won && m.mode === GM.RANKING).length, bestStreak: best, revenge: this.data.revenge || 0 };
  }
  // every ladder: its players from the top, with you in your place
  ladders() {
    return LADDERS.map(([name, list, rungs]) => {
      const won = rungs.filter(([, f]) => this.flag(f)).length, rows = rungs.map(([id]) => {
        const d = this.matchDef(list, id), nm = this.nameOf(d.opp) + (list ? " & " + this.nameOf(this.partnerOf(d.opp)) : "");
        return { name: nm, opp: this.nameOf(d.opp), level: this.levelOf(d.opp), id };
      }).reverse();                                                       // top rung first
      const you = rows.length - won;                                     // (rows above you: the rungs not won yet)
      const out = rows.slice(); out.splice(you, 0, { you: true, name: this.heroName() + (list ? " & " + this.partnerName() : "") });
      return { name, list, rows: out, you: you + 1, won, total: rungs.length };
    });
  }
  ladderSpots() { return this.ladders().map(l => ({ name: l.name, you: l.you })); }
  rivals() {
    const by = new Map();
    for (const m of this.data.matches) { const r = by.get(m.opp) || { name: m.opp, w: 0, l: 0, last: null }; if (m.won) r.w++; else r.l++; r.last = m; by.set(m.opp, r); }
    return [...by.values()].sort((a, b) => (b.w + b.l) - (a.w + a.l) || b.last.day - a.last.day);
  }
  // the VS screen (intro.js): what an opponent you have met says, or ""
  rivalLine(oppChar) {
    if (!this.on || !this.data) return ""; const name = this.nameOf(oppChar), R = this.rivals().find(r => r.name === name); if (!R) return "";
    const m = R.last, ago = this.data.day - m.day, when = ago <= 0 ? "earlier today" : ago === 1 ? "yesterday" : `${ago} days ago`;
    if (m.won && R.l === 0) return R.w > 1 ? `${R.w}-0 to you so far. That ends today!` : `You beat me ${when}, ${m.score}. Not again!`;
    if (!m.won && R.w === 0) return R.l > 1 ? `${R.l}-0 to me. Back for more?` : `I beat you ${when}. Ready for round two?`;
    return `${R.w}-${R.l} between us. ${m.won ? "Revenge time!" : "I'm on a roll!"}`;
  }
  coach() {
    const P = this.data ? this.data.practice : [0, 0, 0, 0], sum = P.reduce((a, b) => a + b, 0);
    let k = 0; for (let i = 1; i < 4; i++) if (P[i] > P[k]) k = i;
    return { pick: sum ? k : -1, shares: P.map(v => sum ? v / sum : 0), sum };
  }
  equipment() {
    const w = this.getGb().mem.wram[0], r = this.rom(), bits = w[W.equip];
    const row = (tab, i) => { const o = romOff(...tab) + 16 * i; return STATS.map((s, k) => (r[o + k] << 24 >> 24)); };
    const mk = (names, tab, flags, cur) => names.map((n, i) => ({ name: n, deltas: row(tab, i), own: i === 0 || this.flag(flags[i]), on: i === cur }));
    return { rackets: mk(RACKET_NAMES, RACKETS, RACKET_FLAGS, bits & 15), shoes: mk(SHOE_NAMES, SHOES, SHOE_FLAGS, bits >> 4) };
  }
  // news: a few results each day among the ladder players (seeded by the day and the file: the same every time it is looked at)
  news() {
    const out = [], players = []; for (const L of this.ladders()) if (!L.list) for (const r of L.rows) if (!r.you) players.push(r);
    let s = (this.data.day * 2654435761 + this.slot * 97) >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 4 && players.length > 1; i++) {
      const a = players[(rnd() * players.length) | 0]; let b = players[(rnd() * players.length) | 0]; if (a === b) continue;
      const g = 6, h = (rnd() * 5) | 0, g2 = rnd() < 0.3 ? 7 : 6, h2 = g2 === 7 ? 5 : (rnd() * 5) | 0;
      const [x, y] = a.level + rnd() * 10 >= b.level + rnd() * 10 ? [a, b] : [b, a];
      out.push(`${x.opp} beat ${y.opp} ${g}-${h} ${g2}-${h2}`);
    }
    return out;
  }
  checkSponsors() {
    const D = this.data, st = this.stats(), f = n => this.flag(n);
    for (const S of SPONSORS) if (!D.sponsors.includes(S.id) && S.test(D, st, f)) { D.sponsors.push(S.id); this.save(); this.toast(`New sponsor: ${S.name} signs you!`); }
  }
  // stadium3d.js: the advert indices of your sponsors, for your tour matches
  sponsorAds() { return this.on && this.data && this.cur && this.cur.match ? SPONSORS.filter(S => this.data.sponsors.includes(S.id)).map(S => S.ad) : null; }

  // ---------------- the HD panel ----------------
  toast(msg) {
    if (this.toastFn) { this.toastFn(msg); return; } if (typeof document === "undefined") return;
    this.build(); const t = this.toastEl; t.textContent = msg; t.style.opacity = "1"; t.style.display = "block";
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { t.style.opacity = "0"; }, 3200);
  }
  build() {
    if (this.root) return;
    const st = document.createElement("style"); st.textContent = `
#tourpanel { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(6,12,30,.72); font: 16px Itim, system-ui, sans-serif; }
#tourpanel .tp { width: min(760px, 94vw); height: min(560px, 88vh); background: #f6f4ee; border-radius: 18px; border: 4px solid #ffcf3a; box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; color: #2a2016; }
#tourpanel .tabs { display: flex; gap: 4px; padding: 10px 12px 0; background: #1d2b7a; flex-wrap: wrap; }
#tourpanel .tab { font: 18px "MT Luckiest Guy", Impact, sans-serif; color: #c9d2ff; padding: 6px 12px 4px; border-radius: 10px 10px 0 0; cursor: pointer; letter-spacing: .5px; }
#tourpanel .tab.on { background: #f6f4ee; color: #1d2b7a; }
#tourpanel .body { flex: 1; overflow-y: auto; padding: 14px 18px; }
#tourpanel h3 { font: 20px "MT Luckiest Guy", Impact, sans-serif; color: #1d2b7a; margin: 10px 0 4px; letter-spacing: .5px; }
#tourpanel table { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
#tourpanel td { padding: 3px 6px; border-bottom: 1px solid #e4dfd2; }
#tourpanel tr.you td { background: #ffe58a; font-weight: bold; }
#tourpanel .n { text-align: right; color: #6a5d48; white-space: nowrap; }
#tourpanel td.rk { width: 34px; }
#tourpanel .hint { color: #6a5d48; font-size: 14px; }
#tourpanel .bar { height: 12px; border-radius: 6px; background: #e4dfd2; overflow: hidden; }
#tourpanel .bar i { display: block; height: 100%; border-radius: 6px; }
#tourpanel .foot { padding: 6px 16px 10px; color: #6a5d48; font-size: 14px; text-align: right; }
#tourpanel .chip { display: inline-block; padding: 1px 8px; border-radius: 9px; background: #1d2b7a; color: #fff; font-size: 13px; margin-left: 6px; }
#tourpanel .up { color: #2e9e3e; } #tourpanel .dn { color: #d03030; }
#tourpanel .sp { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #e4dfd2; }
#tourpanel .sp b { font: 17px "MT Luckiest Guy", Impact, sans-serif; letter-spacing: .5px; min-width: 170px; }
#tourpanel .sp.off { opacity: .45; }
#tourcoach { position: fixed; z-index: 30; left: 50%; bottom: 8%; transform: translateX(-50%); background: rgba(29,43,122,.92); color: #fff; border: 3px solid #ffcf3a; border-radius: 14px; padding: 6px 16px; font: 17px Itim, system-ui, sans-serif; pointer-events: none; display: none; }
#tourtoast { position: fixed; z-index: 35; left: 50%; top: 12%; transform: translateX(-50%); background: rgba(246,244,238,.96); color: #1d2b7a; border: 3px solid #ffcf3a; border-radius: 14px; padding: 8px 18px; font: 18px Itim, system-ui, sans-serif; pointer-events: none; transition: opacity .6s; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
#tourcoach b { font: 19px "MT Luckiest Guy", Impact, sans-serif; color: #ffcf3a; letter-spacing: .5px; }`;
    document.head.appendChild(st);
    const r = this.root = document.createElement("div"); r.id = "tourpanel"; r.hidden = true;
    r.innerHTML = `<div class="tp"><div class="tabs"></div><div class="body"></div><div class="foot">◀ ▶ page &nbsp; ▲ ▼ scroll &nbsp; B close</div></div>`;
    r.addEventListener("pointerdown", e => { if (e.target === r) this.close(); });
    document.body.appendChild(r);
    this.coachEl = document.createElement("div"); this.coachEl.id = "tourcoach"; document.body.appendChild(this.coachEl);
    this.toastEl = document.createElement("div"); this.toastEl.id = "tourtoast"; this.toastEl.style.display = "none"; document.body.appendChild(this.toastEl);
  }
  pages() { return ["RANKINGS", "RIVALS", "TRAINING", "EQUIPMENT", "SCHEDULE", "SPONSORS"]; }
  show() {
    if (!this.inStory() && !(this.data && this.slot >= 0)) { this.toast("TOUR+: load a tour file first (the campus)"); return; }
    if (!this.data) this.load(this.getGb().mem.wram[0][W.slot]);
    this.build(); this.open = true; this.root.hidden = false; this.wasPaused = this.pause(true); this.render();
    this.lastPad = null; const loop = () => { if (!this.open) return; this.padStep(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    this.keyH = e => { const k = { ArrowLeft: 0x20, ArrowRight: 0x10, ArrowUp: 0x40, ArrowDown: 0x80, Escape: 2, KeyX: 2, Enter: 8 }[e.code]; if (k) { e.preventDefault(); e.stopPropagation(); this.input(k); } };
    addEventListener("keydown", this.keyH, true);
  }
  close() { if (!this.open) return; this.open = false; this.root.hidden = true; removeEventListener("keydown", this.keyH, true); this.pause(this.wasPaused); }
  toggle() { if (this.open) this.close(); else this.show(); }
  padStep() {
    if (!this.pad) return; const p = this.pad(), m = (p.a ? 1 : 0) | (p.b ? 2 : 0) | (p.start ? 8 : 0) | (p.right ? 0x10 : 0) | (p.left ? 0x20 : 0) | (p.up ? 0x40 : 0) | (p.down ? 0x80 : 0);
    if (this.lastPad === null) { this.lastPad = m; return; }                // (the press that opened the panel)
    const edge = m & ~this.lastPad; this.lastPad = m; if (edge) this.input(edge);
  }
  input(edge) {
    const n = this.pages().length, body = this.root.querySelector(".body");
    if (edge & 0x0A) { this.close(); return; }
    if (edge & 0x30) { this.page = (this.page + (edge & 0x10 ? 1 : n - 1)) % n; this.render(); return; }
    if (edge & 0xC0) body.scrollTop += edge & 0x80 ? 90 : -90;
  }
  render() {
    const tabs = this.root.querySelector(".tabs"), body = this.root.querySelector(".body");
    tabs.innerHTML = this.pages().map((p, i) => `<span class="tab${i === this.page ? " on" : ""}" data-i="${i}">${p}</span>`).join("");
    tabs.querySelectorAll(".tab").forEach(t => t.addEventListener("pointerdown", e => { e.stopPropagation(); this.page = +t.dataset.i; this.render(); }));
    body.scrollTop = 0;
    try { body.innerHTML = [this.pRankings, this.pRivals, this.pTraining, this.pEquipment, this.pSchedule, this.pSponsors][this.page].call(this); }
    catch (e) { body.innerHTML = `<p class="hint">This page needs a tour file loaded (the campus).</p>`; console.warn("tour", e); }
  }
  esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }
  h2h(name) { const R = this.rivals().find(r => r.name === name); return R ? `<span class="chip">${R.w}-${R.l}</span>` : ""; }
  pRankings() {
    const L = this.ladders(); let cur = L.findIndex(l => l.won < l.total && !l.list); if (cur < 0) cur = 4;
    const order = [cur, ...L.keys()].filter((v, i, a) => a.indexOf(v) === i);
    let h = `<p class="hint">The academy's ladders: beat the player above you to take their place. Your record against each in the chip.</p>`;
    for (const i of order) {
      const l = L[i];
      h += `<h3>${l.name} ${l.won === l.total ? '<span class="chip">CHAMPION</span>' : ""}</h3><table>` + l.rows.map((r, k) =>
        `<tr class="${r.you ? "you" : ""}"><td class="n rk">#${k + 1}</td><td>${this.esc(r.name)}${r.you ? "" : this.h2h(r.opp)}</td><td class="n">${r.you ? "YOU" : "Lv " + r.level}</td></tr>`).join("") + `</table>`;
    }
    const N = this.news(); if (N.length) h += `<h3>AROUND THE ACADEMY · DAY ${this.data.day}</h3>` + N.map(s => `<div>• ${this.esc(s)}</div>`).join("");
    return h;
  }
  pRivals() {
    const R = this.rivals(), s = this.stats();
    if (!R.length) return `<p class="hint">Nobody yet: the players you meet in tour matches are kept here, with your record against each and the last score. They remember you on the VS screen.</p>`;
    let h = `<p>Tour matches: <b>${s.wins}</b> won, <b>${s.losses}</b> lost · best run ${s.bestStreak}</p><table>`;
    for (const r of R) { const m = r.last, ago = this.data.day - m.day; h += `<tr><td>${this.esc(r.name)}${r.w + r.l >= 2 && Math.abs(r.w - r.l) <= 1 ? '<span class="chip">RIVAL</span>' : ""}</td><td class="n">${r.w}-${r.l}</td><td>${m.won ? '<span class="up">W</span>' : '<span class="dn">L</span>'} ${this.esc(m.score || "")} · ${this.esc(MATCH_NAMES[m.id] || "")}</td><td class="n">${ago <= 0 ? "today" : ago === 1 ? "yesterday" : ago + " days ago"}</td></tr>`; }
    return h + `</table>`;
  }
  pTraining() {
    const C = this.coach(), cols = [[255, 140, 40], [230, 50, 60], [60, 140, 230], [60, 190, 90]];
    const w = this.getGb().mem.wram[0], lv = [0, 1, 2, 3].map(i => w[W.trainLevels + i]);
    let h = `<p class="hint">What you practise in matches (your shots: spin, power, control; your shots deep in long rallies: speed) and in drills.</p><table>`;
    for (let i = 0; i < 4; i++) h += `<tr><td style="width:110px"><b>${SKILLS[i]}</b></td><td><div class="bar"><i style="width:${Math.round(C.shares[i] * 100)}%;background:${css(cols[i])}"></i></div></td><td class="n" style="width:60px">${Math.round(C.shares[i] * 100)}%</td><td class="n" style="width:80px">level ${lv[i]}</td></tr>`;
    h += `</table>`;
    h += C.pick < 0 ? `<p>Play a match or a drill and the coach will have a word.</p>` : `<h3>COACH</h3><p>You play a lot of <b>${SKILLS[C.pick]}</b>: put your next level-up points into the <b>${SKILLS[C.pick]}</b> page to make the most of it. The coach says so on the stat screen too.</p>`;
    return h;
  }
  pEquipment() {
    const E = this.equipment(), cell = d => d ? `<span class="${d > 0 ? "up" : "dn"}">${d > 0 ? "+" : ""}${d}</span>` : "";
    const tab = (title, list) => `<h3>${title}</h3><table><tr><td></td>${STATS.map(s => `<td class="n" style="font-size:11px">${s.slice(0, 5)}</td>`).join("")}</tr>` +
      list.map(e => `<tr class="${e.on ? "you" : ""}" style="${e.own ? "" : "opacity:.4"}"><td>${e.name}${e.on ? '<span class="chip">ON</span>' : ""}</td>${e.deltas.map(d => `<td class="n">${cell(d)}</td>`).join("")}</tr>`).join("") + `</table>`;
    return `<p class="hint">What each racket and pair of shoes adds to or takes from your stats (the game's own numbers). Faded: not yours yet. Change them at the gym.</p>` + tab("RACKETS", E.rackets) + tab("SHOES", E.shoes);
  }
  pSchedule() {
    const D = this.data, col = D.energy >= 60 ? [60, 190, 90] : D.energy >= 30 ? [255, 190, 40] : [230, 60, 60];
    let h = `<h3>DAY ${D.day}</h3><table><tr><td style="width:90px"><b>ENERGY</b></td><td><div class="bar"><i style="width:${D.energy}%;background:${css(col)}"></i></div></td><td class="n" style="width:50px">${D.energy}</td></tr></table>`;
    h += `<p class="hint">A ranking or Island Open match costs 25, a practice match 15, a drill or a mini-game 10. A meal at the cafeteria or the restaurant gives 15 back (once a day each). Rest in your dorm room to start a new day.${D.energy < 50 ? " Tired: with PLAY+ on, long rallies wear you out sooner." : ""}</p>`;
    h += `<h3>TODAY</h3>` + (D.today.length ? D.today.map(s => `<div>• ${this.esc(s)}</div>`).join("") : `<div class="hint">Nothing yet.</div>`);
    const next = this.ladders().find(l => !l.list && l.won < l.total);
    if (next) { const r = next.rows[next.you - 2]; if (r) h += `<h3>NEXT UP</h3><div>${next.name}: ${this.esc(r.name)} (Lv ${r.level}), #${next.you - 1} on the ladder ${this.h2h(r.opp)}</div>`; }
    return h;
  }
  pSponsors() {
    const D = this.data;
    return `<p class="hint">Brands sign you as your tour goes; in your tour matches the stadium's boards carry their adverts.</p>` +
      SPONSORS.map(S => { const on = D.sponsors.includes(S.id); return `<div class="sp${on ? "" : " off"}"><b>${S.name}</b><span>${on ? "Signed ✔" : this.esc(S.goal)}</span></div>`; }).join("");
  }
  // the stat screen after a level-up (port/menus/char_data/screen.js sets P.charDataSeen each frame of its input loop): the coach's pick
  coachFrame() {
    const P = this.getPort && this.getPort(); if (!this.coachEl) { if (!this.on) return; this.build(); }
    const s = P && P.charDataSeen, live = this.on && s && P.frames - s.at <= 2 && s.left > 0 && this.data;
    const C = live ? this.coach() : null, show = !!(C && C.pick >= 0);
    if (show) this.coachEl.innerHTML = `COACH: <b>${SKILLS[C.pick]}</b> · ${Math.round(C.shares[C.pick] * 100)}% of your practice` + (s.page === C.pick ? " ✔" : "");
    this.coachEl.style.display = show ? "block" : "none";
  }
}

// the HUD buttons: "TOUR+: on / off" (remembered) and "TOUR" (the panel)
export function addTourButtons(hud, tour) {
  const b = document.createElement("span"); b.className = "k"; b.id = "tourplusbtn"; b.title = "the tour's own systems: rankings, rivals, training, equipment, a day schedule with energy, sponsors (kept per tour file)";
  const show = () => { b.textContent = "TOUR+: " + (tour.on ? "on" : "off"); b.classList.toggle("on", tour.on); }; show();
  b.addEventListener("pointerdown", () => { tour.setOn(!tour.on); show(); });
  const p = document.createElement("span"); p.className = "k"; p.id = "tourbtn"; p.textContent = "TOUR"; p.title = "the tour panel: rankings, rivals, training, equipment, schedule, sponsors";
  p.addEventListener("pointerdown", () => { if (tour.on) tour.toggle(); else tour.toast("Switch TOUR+ on first"); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); hud.appendChild(document.createTextNode(" ")); hud.appendChild(p);
  tour.onChange = show;
}
