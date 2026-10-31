// Ported screens against the ROM's, each from a core state at the routine's entry (web/tests/golf/screenstep.mjs):
// frame by frame the display, at the end all RAM. The states are made once with web/tests/golf/mkstate.mjs (the
// command is printed when one is missing).
// usage: node web/tests/golf_screens_vs_core.mjs [name filter] [--verbose]
import fs from "fs";
import path from "path";
import { runScreen } from "./golf/screenstep.mjs";
import { matchStandingsScreen } from "../js/golf/standings.js";
import { showScorecard } from "../js/golf/scorecard.js";
import { roundResultScreen } from "../js/golf/result.js";
import { pauseMenu } from "../js/golf/pause.js";
import { Hole } from "../js/golf/ball.js";
import { shotSetup } from "../js/golf/hole.js";
import { showPlayerPicture } from "../js/golf/pictures.js";
import { titleScreen } from "../js/golf/title.js";
import { linkMenu } from "../js/golf/menu09.js";
import { characterSelectScreen } from "../js/golf/charsel.js";
import { gameModeSelect, courseSelect } from "../js/golf/select.js";
import { modeSelectMain } from "../js/golf/modesel.js";
import { powerOn } from "../js/golf/boot.js";
import { playRoundFrames } from "../js/golf/game.js";
import { gameFromPowerOn } from "../js/golf/boot.js";
import { GolfMemory } from "../js/golf/memory.js";
import { saveBlockStore, saveBlockLoad } from "../js/golf/save.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
const verbose = process.argv.includes("--verbose");
// --shard k/n: only the cases whose index is k mod n (to run the cases in n processes)
const shardArg = process.argv.find(a => a.startsWith("--shard="));
const shard = shardArg ? shardArg.slice(8).split("/").map(Number) : null;
const onHole = (sh, g) => { sh.hole = new Hole(sh.w.wram[6][0x320]); return g; };   // the hole's frame tasks run
const inBank = (sh, bank, g) => (function* () {
  const old = sh.w.high[0x195]; sh.w.high[0x195] = bank;
  try { return yield* g; } finally { sh.w.high[0x195] = old; }
})();

// the front end's buttons by the screen the native side is on (its frame tasks): Start at frame 2600 (the title),
// then every 40 frames A, except Right in the character select until the cursor ($D214, WRAM6) is on Mario (4)
let menuW = null;
const hasTask = (w, bank, addr) => { const t = w.wram[0]; for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === bank && (t[p + 1] | t[p + 2] << 8) === addr) return true; return false; };
function frontEndPolicy(f) {
  if (f < 2600) return 0;
  if (f === 2600) return 8;
  if (f % 40) return 0;
  if (menuW && hasTask(menuW, 0x06, 0x65D9) && menuW.wram[6][0x214] !== 4) return 0x10;
  return 1;
}

// a new character from power-on: Start at frame 2600, then A every 40 frames, but in the name entry (its task 06:51CC)
// Start 60 frames in (the cursor to END), A 40 frames later (no letters: the default name) and A again (END)
function newCharPolicy() {
  let at = -1;
  return f => {
    frameNow = f;
    if (f < 2600) return 0;
    if (f === 2600) return 8;
    if (menuW && hasTask(menuW, 0x06, 0x51CC)) {
      if (at < 0) at = f;
      return f === at + 60 ? 8 : f === at + 100 || f === at + 140 ? 1 : 0;
    }
    return f % 40 ? 0 : 1;
  };
}

// on the overworld: `base` until the native side is first on map $03 in story mode (wMapId, wGameMode 9; walkAt =
// that frame), then the buttons of `script` ([from, to, bits]: held from frame walkAt + from to walkAt + to); the
// case stops at walkAt + end. Returns the case's { run, policy }.
let walkAt = -1;
function walkCase(base, script, end) {
  const policy = f => {
    frameNow = f;
    if (f === 0) walkAt = -1;
    if (walkAt < 0 && menuW && menuW.wram[0][0x450] === 3 && menuW.wram[0][0x834] === 9) { walkAt = f; if (process.env.MARKS) console.error("WALK", f); }
    if (walkAt < 0) return base(f);
    const d = f - walkAt;
    for (const [a, b, bits] of script) if (d >= a && d < b) return bits;
    return 0;
  };
  return { policy, run: sh => { walkAt = -1; return gameCase(sh, 1, () => walkAt >= 0 && frameNow > walkAt + end); } };
}

// a path of cells from (cx, cy) to (tx, ty) over the map's terrain (blocked: low nibble $F; trigger cells avoided),
// or [] when none
function cellPath(w, cx, cy, tx, ty, avoid = new Set(), triggers = false) {
  const blocked = (x, y) => x < 0 || y < 0 || x > 31 || y > 31 || (w.wram[6][y * 32 + x] & 0x0F) === 0x0F || avoid.has(y * 32 + x) ||
    (!triggers && (w.wram[6][0x400 + y * 32 + x] & 0x0F) === 1);   // (around trigger cells but the target's)
  const prev = new Map(), q = [[cx, cy]];
  prev.set(cy * 32 + cx, null);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy, key = ny * 32 + nx;
      if (prev.has(key) || (blocked(nx, ny) && !(nx === tx && ny === ty))) continue;
      prev.set(key, [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(ty * 32 + tx) && !triggers) return cellPath(w, cx, cy, tx, ty, avoid, true);   // (else through them)
  const out = [];
  for (let c = prev.has(ty * 32 + tx) ? [tx, ty] : null; c && !(c[0] === cx && c[1] === cy); c = prev.get(c[1] * 32 + c[0])) out.unshift(c);
  return out;
}

// the same with steps run one after another from walkAt + 300: [n, bits] holds bits n frames (bits 0: waits), {to:
// [x, y]} walks into that tile's cell (2 x 2 tiles; or, with map: m, until the map is m; with at: [x, y] (8.8), to
// that point) (the player actor's x / y high bytes, read on the native side: the two sides are the
// same while the case passes) along the longer axis first, switching axes for 24 frames when the position stops
// changing; {press: bits, every: n, times: k} presses k times n frames apart (or, with until: f, until f()). The case stops `end` frames after the
// last step.
function routeCase(base, steps, end) {
  let k = 0, until = -1, last = null, stuck = 0, swap = 0, doneAt = -1, presses = 0, route = null, avoid = new Set();
  const pos = () => {
    const w = menuW, p = w.wram[0][0x290] | w.wram[0][0x291] << 8;
    const r = w.wram[4], o = p - 0xD000;
    return [r[o + 5], r[o + 7], r[o + 4] | r[o + 5] << 8, r[o + 6] | r[o + 7] << 8];
  };
  const policy0 = f => {
    frameNow = f;
    if (menuW && menuW.wram[5][0x822]) lastWinFrame = f;
    if (process.env.ACTORSMAP && menuW && menuW.wram[0][0x450] === +process.env.ACTORSMAP && !actorsShown && (actorsShown = f)) process.env.ACTORS = String(f + 200);
    if (process.env.ACTORS && f === +process.env.ACTORS) process.env.GRID = process.env.GRID || String(f);
    if (process.env.ACTORS && f === +process.env.ACTORS) for (let k = 0; k < 24; k++) { const r = menuW.wram[4], o = k * 64; if (r[o + 0x17]) console.error("ACTOR", k, (r[o + 4] | r[o + 5] << 8).toString(16), (r[o + 6] | r[o + 7] << 8).toString(16)); }
    if (process.env.GRID && f === +process.env.GRID) for (let r = 0; r < 32; r++) console.error("GRID", r.toString().padStart(2), [...menuW.wram[6].subarray(r * 32, r * 32 + 32)].map(v => (v & 15).toString(16)).join(""), [...menuW.wram[6].subarray(0x400 + r * 32, 0x400 + r * 32 + 32)].map(v => v.toString(16).padStart(2, "0")).join(""));
    if (f === 0) { walkAt = -1; k = 0; until = -1; doneAt = -1; presses = 0; }
    if (walkAt < 0 && menuW && menuW.wram[0][0x450] === 3 && menuW.wram[0][0x834] === 9) walkAt = f;
    if (walkAt < 0) return base(f);
    if (f < walkAt + 300) return 0;
    for (;;) {
      const s = steps[k];
      if (!s) { if (doneAt < 0) doneAt = f; return 0; }
      if (Array.isArray(s)) {
        if (until < 0) until = f + s[0];
        if (f < until) return s[1];
        until = -1; k++; continue;
      }
      if (s.talkWait) {                          // A every 40 frames while a window is open, until none has been for 150
        if (process.env.ROUTE > 2) console.error("TW", f, menuW.wram[5][0x822], lastWinFrame, frameNow);
        if (talkQuiet()) { k++; continue; }
        if (menuW.wram[5][0x822] && f - talkPress >= 40) { talkPress = f; return 1; }
        return 0;
      }
      if (s.press !== undefined) {
        if (until < 0) until = f;
        if (f < until) return 0;
        if (s.until ? s.until() : presses >= s.times) { presses = 0; until = -1; k++; continue; }
        presses++; until = f + s.every;
        return s.press;
      }
      const [x, y, xw, yw] = pos();
      if (s.actor !== undefined) {               // {actor: n, off: [dx, dy]}: straight to a (walking) actor's point
        const r = menuW.wram[4], o = s.actor * 64;
        const ax = (r[o + 4] | r[o + 5] << 8) + s.off[0], ay = (r[o + 6] | r[o + 7] << 8) + s.off[1];
        const dx = ax - xw, dy = ay - yw;
        if (Math.abs(dx) <= 0x30 && Math.abs(dy) <= 0x30) { k++; until = -1; continue; }
        if (until < 0) until = f + 900;
        if (f > until) throw new Error(`the route's step ${k} did not reach actor ${s.actor}`);
        if (Math.abs(dx) > 0x30) return dx > 0 ? 0x10 : 0x20;
        return dy > 0 ? 0x80 : 0x40;
      }
      if (process.env.ROUTE && (!(f % 10) || process.env.ROUTE > 1)) console.error("ROUTE", f, k, x, y, xw.toString(16), yw.toString(16), JSON.stringify(route && route.slice(0, 3)));
      if (s.map !== undefined ? menuW.wram[0][0x450] === s.map : s.at ? Math.abs(xw - s.at[0]) <= 0x20 && Math.abs(yw - s.at[1]) <= 0x20 : x >> 1 === s.to[0] >> 1 && y >> 1 === s.to[1] >> 1) { k++; last = null; until = -1; route = null; continue; }
      // the next waypoint: a breadth-first path over the terrain cells (WRAM6 $D000: 32 x 32 cells of 2 x 2 tiles,
      // low nibble $F blocked), aimed at the next cell's tile on the target's parity
      if (!route) { avoid = new Set(); route = cellPath(menuW, x >> 1, y >> 1, s.to[0] >> 1, s.to[1] >> 1, avoid); }
      while (route.length && route[0][0] === x >> 1 && route[0][1] === y >> 1) route.shift();
      if (route.length && Math.abs(route[0][0] - (x >> 1)) + Math.abs(route[0][1] - (y >> 1)) !== 1)
        route = cellPath(menuW, x >> 1, y >> 1, s.to[0] >> 1, s.to[1] >> 1, avoid);   // (off the path: again)
      // (aimed at the next cell's centre, or the target tile's, in 8.8 tiles: the larger error first, after
      // centring on the other axis)
      const [tx, ty] = route.length ? [route[0][0] * 2 + 1 << 8, route[0][1] * 2 + 1 << 8] : s.at || [s.to[0] << 8 | 0x80, s.to[1] << 8 | 0x80];
      const key = `${xw},${yw}`;
      if (key === last) stuck++; else { stuck = 0; last = key; }
      if (stuck === 10 && route && route.length) {   // (an actor in the way: around it)
        avoid.add(route[0][1] * 32 + route[0][0]);
        route = cellPath(menuW, x >> 1, y >> 1, s.to[0] >> 1, s.to[1] >> 1, avoid);
      }
      if (stuck > 20 && stuck <= 30 && !s.noA) return f & 1 ? 0 : 1;   // (a message box from bumping into someone: A)
      if (stuck > 30) { stuck = 0; swap = 24; avoid = new Set(); route = null; }   // (else the other axis a while)
      if (until < 0) until = f + 900;
      if (f > until) throw new Error(`the route's step ${k} did not reach ${s.to} (at ${x},${y})`);
      const dx = tx - xw, dy = ty - yw;
      let horiz = Math.abs(dx) >= Math.abs(dy);
      if (horiz && Math.abs(dy) > 0x40 && route && route.length) horiz = false;   // (centred on the other axis first)
      else if (!horiz && Math.abs(dx) > 0x40 && route && route.length) horiz = true;
      if (swap > 0) { swap--; horiz = !horiz; }
      if (horiz && dx) return dx > 0 ? 0x10 : 0x20;
      if (!horiz && dy) return dy > 0 ? 0x80 : 0x40;
      return dx ? (dx > 0 ? 0x10 : 0x20) : dy > 0 ? 0x80 : 0x40;
    }
  };
  let lastK = -1;
  const policy = f => { const v = policy0(f); if (process.env.ROUTE && k !== lastK) { console.error("STEP", f, k); lastK = k; } if (process.env.ROUTE > 1) console.error("KEY", f, v, stuck, swap, JSON.stringify(route && route.slice(0, 2))); return v; };
  return { policy, run: sh => { walkAt = -1; return gameCase(sh, 1, () => doneAt >= 0 && frameNow > doneAt + end); } };
}

// the same, with Right `rights` times in the game mode select first
function frontEndRights(rights) {
  let n = 0, last = -100;
  return f => {
    if (f < 2600) { n = 0; last = -100; return 0; }
    if (f === 2600) return 8;
    if (f - last < 40) return 0;
    last = f;
    if (menuW && hasTask(menuW, 0x0D, 0x428E) && n < rights) { n++; return 0x10; }
    if (menuW && hasTask(menuW, 0x06, 0x65D9) && menuW.wram[6][0x214] !== 4) return 0x10;
    return 1;
  };
}

// with a saved character (a save RAM the game made: out/kid.sav, see REVERSE.md "Saved games"): Start on the title,
// then every 40 frames A (LinkMenu's one player, the character select's slot 0), in the game mode select Right
// `rights` times (from the story's item), then A on the mode, the course, ...
const savedPolicy2 = (() => { let p = null; return f => { if (f < 2600 || !p) p = p || savedPolicy(2); return p(f); }; })();
function savedPolicy(rights) {
  let n = 0, last = -100;
  return f => {
    if (f < 2600) { n = 0; last = -100; return 0; }
    if (f === 2600) return 8;
    if (f - last < 40) return 0;
    last = f;
    if (menuW && hasTask(menuW, 0x0D, 0x428E) && n < rights) { n++; return 0x10; }
    // (match play: the opponent's character select, Right to Luigi, the first listed: 3)
    if (menuW && menuW.wram[0][0x834] === 2 && hasTask(menuW, 0x06, 0x65D9) && menuW.wram[6][0x214] !== 3) return 0x10;
    return 1;
  };
}

// in the level-up screen (its banner task 41:5694 registered): `script` ([frames after it began, bits]); else `base`
function levelUpPolicy(script, base) {
  let at = -1;
  return f => {
    frameNow = f;
    if (!(menuW && hasTask(menuW, 0x41, 0x5694))) return base(f);
    if (at < 0) at = f;
    for (const [d, b] of script) if (f === at + d) return b;
    return 0;
  };
}
// game flag n set on both sides when the mode select first shows (a test's poke: #72 makes the story's club rounds
// one hole, 33:66CB)
function flagPoke(...ns) {
  let done = false;
  return (f, w, core) => {
    if (done || !hasTask(w, 0x0D, 0x428E)) return;
    done = true;
    for (const n of ns) for (const m of [w.wram[0], core.wram(0)]) m[0x840 + (n >> 3)] |= 0x80 >> (n & 7);
  };
}
// hDebugMode $FF9E set to `v` on both sides when the mode select first shows (a test's poke: the retail game never
// sets it; REVERSE.md "Debug code")
// the debug room's talks (map $01, by the debug warp: map record 3 -> 1; actors 2-8 at x 9, 9-$0F at x $0D, the player
// between): `talks` after the warp; each case ends where the talk's warp leads
const droom = (y, dir) => [{ to: [0x0B, y], at: [0x0B00, y << 8], noA: true }, [2, dir], [20, 0], [2, 1]];
const DEBUG_ROOM = [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 1], [90, 0], [2, 0x20], [30, 0], [2, 0x20], [30, 0], [2, 1], [90, 0],
  [2, 2], [400, 0]];
// the debug menu's Scene warp from the clubhouse (map record 3) to map record `rec`, entrance `ent` (Right / Left once
// each 20 frames), then B: the warp
const dwarp = (rec, ent) => [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 1], [90, 0],
  { press: rec > 3 ? 0x10 : 0x20, every: 20, times: Math.abs(rec - 3) }, [30, 0], [2, 0x80], [30, 0],
  { press: 0x10, every: 20, times: ent }, [30, 0], [2, 1], [90, 0], [2, 2], [400, 0]];
// a talk in routeCase steps: walk to the point `at` (8.8 tiles; a number: to that actor, 2 tiles before it), face `dir`, A, then A every 40 frames `n` times
// (`no`: the first question answered No: Down before its A); then A every 40 frames while a window is open, until none has been for
// 150 frames (or `n` times)
const talkSteps = (at, dir, n = null, no = false) => [typeof at === "number" ? { actor: at, off: dir === 0x40 ? [0, 0x200] : dir === 0x80 ? [0, -0x200] : dir === 0x10 ? [-0x200, 0] : [0x200, 0] } : { to: [at[0] >> 8, at[1] >> 8], at, noA: true }, [2, dir], [20, 0], [2, 1], [60, 0],
  ...(no ? [{ press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 0x80], [30, 0], [2, 1], [60, 0]] : []),
  n === null ? { talkWait: true } : { press: 1, every: 40, times: n }, [120, 0]];
const DEBUG_BOOT_CASES = [
  // no button: the menu's 180 frames run out, the game goes on (hDebugMode 1)
  ["timeout", [], [], 1500],
  // Start: on to the game at once
  ["start", [], [[20, 8]], 900],
  // Select: the sound test (01:516E): Right twice, A (sound 2), Down (to e), Right, A (sound $41), Up, Left (d to
  // $7F... past 0), A
  ["sound", [], [[20, 4], [60, 0x10], [80, 0x10], [100, 1], [160, 0x80], [180, 0x10], [200, 1], [260, 0x40], [280, 0x20], [300, 0x20],
    [320, 0x20], [340, 1]], 600],
  // Right: map $01 (the debug room) by MapEngine; B: map $23
  ["room", [], [[20, 0x10]], 1500],
  ["map23", [], [[20, 2]], 1500],
  // A: GolfDebugEntry (10:4415): the hole select (10:7BAC): Right (course 2), Down (to the hole), Left (hole 0 -> $12),
  // Right twice (past $12: 1, then 2), A: the round, to its first shot
  ["golf", [], [[20, 1], [80, 0x10], [110, 0x80], [140, 0x20], [170, 0x10], [200, 0x10], [230, 1]], 2600],
  // Down: the character editor (02:6176): Up / Left / Right / Down (stats), A x4 (types 1-4; 4 sets $C811), Select
  // (block 1), Start (stored), B: the name entry (06:51DC): Start (to END), A
  ["editor", [], [[20, 0x80], [100, 0x40], [130, 0x20], [160, 0x10], [190, 0x80], [220, 1], [250, 1], [280, 1], [310, 1], [340, 4],
    [370, 8], [600, 2], [800, 8], [860, 1]], 1300],
  // Up: the number (Right twice: 2), A: $C810 = 2 and the staff roll (41:7E07; the case stops inside it: the menu
  // hangs after it)
  ["credits", [], [[20, 0x40], [60, 0x10], [90, 0x10], [120, 1]], 1500],
];
const DEBUG_WARP_CASES = [
  // map $1F entrance 1: the two-player VS scene (32:4199, 32:44B4), A leaves the wait; entrance 2: the one-player scene
  ["1f_vs_results", 0x1F, 1, [[300, 0], [2, 1], [400, 0]]],
  ["1f_one_player", 0x1F, 2, [[300, 0], [2, 1], [400, 0]]],
  // entrance 0: no scene, A leaves the wait; talk 8 (actor 8, from its left: 32:40EB): the palette editor (44:42FB): Right, B leaves
  ["1f_talk8", 0x1F, 0, [[100, 0], [2, 1], [100, 0], { to: [0x03, 0x08], at: [0x0300, 0x0880], noA: true }, ...talkSteps([0x0300, 0x0480], 0x10, 0), [200, 0], [2, 0x10], [60, 0], [2, 2], [300, 0]]],
  // map $20 entrance 4: the paged character menu, Right (the next page), A: RoundResultScreen; A leaves it; the menu
  // again
  ["20_char_result", 0x20, 4, [[200, 0], [2, 0x10], [60, 0], [2, 0x80], [30, 0], [2, 1], [900, 0], [2, 1], [600, 0]]],
  // entrances 5-7: the fixed results
  ...[5, 6, 7].map(e => [`20_result${e}`, 0x20, e, [[900, 0], [2, 1], [400, 0]]]),
  // entrance 0: the paged menu, A; the score-name menu: Down, A (the eagle picture), A; Down twice, A (the par
  // picture), B; B: the paged menu
  ["20_pictures", 0x20, 0, [[200, 0], [2, 1], [200, 0], [2, 0x80], [30, 0], [2, 1], [400, 0], [2, 1], [200, 0], [2, 0x80], [30, 0],
    [2, 0x80], [30, 0], [2, 1], [400, 0], [2, 2], [200, 0], [2, 2], [200, 0]]],
  // map $21: the golfer grid: Up, Left, Down, Right, Right, Down (each bar redrawn tile by tile over frames); A: the round with that golfer (to its first shot)
  ["21_golfer_test", 0x21, 0, [[100, 0], [2, 0x40], [80, 0], [2, 0x20], [80, 0], [2, 0x80], [80, 0], [2, 0x10], [80, 0], [2, 0x10],
    [80, 0], [2, 0x80], [80, 0], [2, 1], [1500, 0]]],
  // map $22: nothing on entering; talk 8 (32:47B1 the palette editor) on map $20? (map $22's talks are texts)
  ["22", 0x22, 0, [[300, 0]]],
  // map $24 (35:791C, the sprite test): talks 3 (next sprite) twice, 2 (previous) three times (wrapping), 4 and 5
  // (animations 3 / 4); a d-pad press plays animation 1 (35:792F)
  ["24_sprites", 0x24, 0, [[100, 0], [2, 0x10], [20, 0], [2, 1], [120, 0], [2, 1], [120, 0], [2, 0x20], [20, 0], [2, 1], [120, 0], [2, 1],
    [120, 0], [2, 1], [120, 0], { to: [0x0B, 0x07], at: [0x0B00, 0x0700], noA: true }, [2, 0x20], [20, 0], [2, 1], [200, 0], [2, 0x10],
    [20, 0], [2, 1], [200, 0]]],
  // map $30 (the Match Game Event) entrances $0D / $0E (34:77EB's test entry: a won result, warp to entrance 3 / 4): the
  // Dune / Links Club's room (34:7CB5 / 34:7CD1) and the champion's scene
  ["30_dune", 0x30, 0x0D, [[2500, 0]]],
  ["30_links", 0x30, 0x0E, [[2500, 0]]],
  // map $23 (31:47D7): the angle tests, the menu (31:483E): Down n times, A: the row's handler
  ...[["23_tournament", 0, [[1500, 0]]], ["23_match", 1, [[1500, 0]]], ["23_practice", 2, [[1500, 0]]],
    ["23_clubhouse", 3, [[300, 0], [2, 0x80], [30, 0], [2, 2], [600, 0]]], ["23_vs_scorecard", 4, [[600, 0], [2, 1], [600, 0]]],
    ["23_start_over", 5, [[600, 0]]]].map(([n, k, after]) => [n, 0x23, 0, [[300, 0], { press: 0x80, every: 30, times: k }, [30, 0], [2, 1],
    ...after]]),
];
const DEBUG_ROOM_CASES = [
  // the sepia fade test (talk $0E, 35:7798: the room again by warp $0D), the Ranking screen (talk $0D, 35:778C; B
  // leaves; warp $0C: the Field)
  ["sepia_ranking", [...droom(0x0D, 0x10), [900, 0], ...droom(0x0B, 0x10), [200, 0], { press: 2, every: 60, times: 3 }, [400, 0]]],
  // the Stars screen (talk $0B, 35:7774; warp $0A: the mode select)
  ["stars", [...droom(0x07, 0x10), [200, 0], { press: 2, every: 60, times: 2 }, [300, 0]]],
  // the Stats screen (talk $0C, 35:7780; warp $0B: the mode select)
  ["stats", [...droom(0x09, 0x10), [200, 0], { press: 2, every: 60, times: 4 }, [300, 0]]],
  // the clubhouse's warp (talk 5, 35:7747: map $03 entrance 1)
  ["clubhouse", [...droom(0x09, 0x20), [400, 0]]],
];
function debugPoke(v) {
  let done = false;
  return (f, w, core) => {
    if (f === 0) done = false;
    if (done || !hasTask(w, 0x0D, 0x428E)) return;
    done = true;
    w.high[0x19E] = v; core.hram()[0x1E] = v;
  };
}
// the character's EXP ($C826-$C828) set to `v` on both sides when the mode select first shows (a test's poke)
function expPoke(v) {
  let done = false;
  return (f, w, core) => {
    if (done || !hasTask(w, 0x0D, 0x428E)) return;
    done = true;
    for (const m of [w.wram[0], core.wram(0)]) { m[0x826] = v & 0xFF; m[0x827] = (v >> 8) & 0xFF; m[0x828] = v >> 16; }
  };
}

// a scripted policy for the rounds: `scripts` = {"mark:n": [[frames after it, bits], ...]} for the n-th time (from
// 1) the native passes that mark (markLog; "holesel" when the hole select's task 0F:789F appears); while a script
// runs nothing else is pressed; otherwise `menus` before the first round, A every 40 frames after
function scriptedPolicy(scripts, menus) {
  const counts = {};
  let cur = null, at = 0, seen = 0, inHoleSel = false;
  const start = (n, f) => {
    const k = `${n}:${(counts[n] = (counts[n] || 0) + 1)}`;
    if (scripts[k]) { cur = scripts[k]; at = f; }
  };
  return f => {
    frameNow = f;
    const hs = !!(menuW && hasTask(menuW, 0x0F, 0x789F));
    if (hs && !inHoleSel) start("holesel", f);
    inHoleSel = hs;
    for (; seen < markLog.length; seen++) start(markLog[seen].n, f);
    if (cur) {
      for (const [d, b] of cur) if (f === at + d) return b;
      if (f > at + Math.max(...cur.map(([d]) => d))) cur = null;
      return 0;
    }
    if (!roundsDone && !markLog.length) return menus(f);
    return f % 40 ? 0 : 1;
  };
}
let markLog = [];
let sawMap18 = false;
let cards = 0;

// the game from power-on through rounds (boot.js gameFromPowerOn, game.js playRoundFrames), the marks the native
// engine passes noted; it stops when the mode select's input runs again after `rounds` rounds, or when stop() says
let lastMark = "", markAt = 0, roundsDone = 0, frameNow = 0;
function gameCase(sh, rounds = 1, stop = () => false) {
  menuW = sh.w; lastMark = ""; roundsDone = 0;
  const m = sh.mark.bind(sh);
  markLog = [];
  sh.mark = n => { if (n !== lastMark) markAt = frameNow; lastMark = n; markLog.push({ n, f: frameNow }); if (process.env.MARKS) console.error("MARK", n, frameNow, sh.w.wram[0][0x8AA]); m(n); };
  const g = gameFromPowerOn(sh, function* (holes) { yield* playRoundFrames(sh.w, holes, null, { sh }); roundsDone++; lastMark = "menus"; });
  return (function* () {
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      if (roundsDone >= rounds && hasTask(sh.w, 0x0D, 0x428E) || stop()) return roundsDone;
      yield r.value;
    }
  })();
}
// the pause menu in the first aiming menu: buttons by frames from the mark (`script`: [frames after, bits])
function pausePolicy(script, menus = frontEndPolicy) {
  return f => {
    frameNow = f;
    if (lastMark === "" || lastMark === "menus") return menus(f);
    if (lastMark !== "aimmenu") return 0;
    for (const [d, b] of script) if (f === markAt + d) return b;
    return 0;
  };
}

// steps run one after another: [cond, bits, delay] waits until cond() (null: at once), then `delay` frames (default
// 40), then presses bits for one frame; after the last step stepsDone is set (the frame). Start on the title first.
let stepsDone = -1;
function stepPolicy(steps) {
  let k = 0, at = -1;
  return f => {
    frameNow = f;
    if (f === 0) { k = 0; at = -1; stepsDone = -1; }
    if (f < 2600) return 0;
    if (f === 2600) return 8;
    const s = steps[k];
    if (!s) { if (stepsDone < 0) stepsDone = f; return 0; }
    if (!Array.isArray(s)) {                     // {press, every, until}: presses until until()
      if (s.until()) { k++; at = -1; return 0; }
      if (at < 0) at = f;
      if ((f - at) % s.every) return 0;
      return s.press;
    }
    const [cond, bits, delay = 40] = s;
    if (cond && !cond()) { at = -1; return 0; }   // (cond must hold for the whole delay)
    if (at < 0) at = f;
    if (f < at + delay) return 0;
    k++; at = -1;
    if (process.env.STEPS) console.error("STEP", k, f, bits);
    return bits;
  };
}
const menu09Items = n => () => menuW && hasTask(menuW, 0x09, 0x4990) && menuW.wram[6][0x202] === n;
const menuReady = n => () => menu09Items(n)() && !menuW.wram[5][0x822] && !menuW.high[0x1A2] && !menuW.high[0x1BC];
const msgOpen = () => menuW && hasTask(menuW, 0x09, 0x4990) && menuW.wram[5][0x822] > 0 && !hasTask(menuW, 0x05, 0x4F20);
const inDict = () => menuW && hasTask(menuW, 0x3F, 0x58DD);
const dictPage = p => () => inDict() && !!(menuW.wram[6][0x613] & 2) === (p === "list") && !(menuW.wram[6][0x613] & 1);
const inCharSel = () => menuW && hasTask(menuW, 0x06, 0x65D9);
const inCharPrompt = () => menuW && hasTask(menuW, 0x41, 0x6E3B);
const inMenuCursor = () => menuW && hasTask(menuW, 0x05, 0x4F20);
// the link menu: Up (to Options, the last item), A
const TO_OPTIONS = [[menu09Items(4), 0x40], [null, 1]];
// the link menu: Down twice (to Status), A
const TO_STATUS = [[menu09Items(4), 0x80], [null, 0x80], [null, 1]];
const menu07Items = n => () => menuW && hasTask(menuW, 0x07, 0x7DB0) && menuW.wram[6][0x202] === n && !menuW.high[0x1A2] && !menuW.high[0x1BC];
const inTask = (b, a) => () => menuW && hasTask(menuW, b, a);

// a records block (save block 3: nothing stores one, not even the debug character editor 02:6176, so the records menu and its
// screens are not reached in play) poked into the save RAM of both sides at frame 1: $400 pseudo-random bytes from
// `seed`, with `fix(data)` applied first (a case's own values), stored as the game stores a block (02:429B)
function recordsPoke(seed, fix = () => {}, then = null) {
  return (f, w, core) => {
    if (then) then(f, w, core);
    if (f !== 1) return;
    let s = seed >>> 0;
    const data = new Uint8Array(0x400);
    for (let i = 0; i < data.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; data[i] = s >>> 24; }
    fix(data);
    const t = new GolfMemory();
    t.sram.set(w.sram);
    t.wram[6].set(data, 0);
    t.high[0x196] = 6;
    saveBlockStore(t, 3, 0xD000, 0);
    w.sram.set(t.sram);
    core.gb.mem.sram.set(t.sram, 0);
  };
}

// the character's profile records ($C980-$C9FC: 5 courses x 25 bytes, the hole bits at +$16) poked with pseudo-random
// bytes from `seed` (the best scores near par: +2 = 54 +- 20) and game flags `flags` set, on both sides when the
// Status four-item menu (07:63EC) first shows
function profilePoke(seed, flags = []) {
  let done = false;
  return (f, w, core) => {
    if (f === 0) done = false;
    if (done || !(hasTask(w, 0x07, 0x7DB0) && w.wram[6][0x202] === 4)) return;
    done = true;
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 24; };
    for (const m of [w.wram[0], core.wram(0)]) {
      let t = s;
      s = seed >>> 0;
      for (let i = 0x980; i < 0x9FD; i++) m[i] = rnd();
      for (let c = 0; c < 5; c++) m[0x980 + 25 * c + 2] = 0x36 - 20 + (rnd() % 41);
      for (const n of flags) m[0x840 + (n >> 3)] |= 0x80 >> (n & 7);
      s = t;
    }
  };
}

// saved holes (save blocks 4-7, five $80-byte slots: +$10 the character, +$20 nonzero when used) poked into the save
// RAM of both sides at frame 1: pseudo-random bytes from `seed`, slot k of block b used when `used[b - 4]` has bit k
function shotsPoke(seed, used) {
  return (f, w, core) => {
    if (f !== 1) return;
    let s = seed >>> 0;
    const t = new GolfMemory();
    t.sram.set(w.sram);
    t.high[0x196] = 6;
    for (let b = 4; b < 8; b++) {
      const data = new Uint8Array(0x280);
      for (let i = 0; i < data.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; data[i] = s >>> 24; }
      for (let k = 0; k < 5; k++) {
        data[k * 0x80 + 0x10] %= 0x0B;
        if (!(used[b - 4] >> k & 1)) data[k * 0x80 + 0x20] = 0; else data[k * 0x80 + 0x20] |= 1;
      }
      t.wram[6].set(data, 0);
      saveBlockStore(t, b, 0xD000, 0);
    }
    w.sram.set(t.sram);
    core.gb.mem.sram.set(t.sram, 0);
  };
}

// name, the state (round, routine), the native routine, buttons
// a Yes / No question answered No: A until the menu's cursor task (05:4F20), Down, A
const ynNo = [{ press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 0x80], [30, 0], [2, 1]];
// the way into the Mini-Mini Lake Course (#86 poked), trigger 1 (the golfer's shot), the partner's debate answered No,
// the player's try (A every 40 frames), back on map $28
const MINILAKE = [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0A, 0x26], noA: true }, { to: [0x0A, 0x24], map: 0x28, noA: true },
  [300, 0], { to: [0x0E, 0x38], noA: true }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x28 }, [300, 0],
  { to: [0x19, 0x21], at: [0x1900, 0x2130], noA: true }, [2, 0x20], [20, 0], [2, 1], ...ynNo,
  { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x28 }];
let lastWinFrame = -1, talkPress = -100;
let linkLostAt = -1;   // (boot_link_lost: the frame of its poke)
let actorsShown = 0;   // (ACTORSMAP=n: the actors 200 frames after the map is first n, debugging a case)   // (the last frame a window was open: routeCase notes it)
const talkQuiet = () => frameNow - lastWinFrame > 150;
const CASES = [
  { name: "standings_match18", round: "match18", at: "3E:403F", run: sh => inBank(sh, 0x3E, matchStandingsScreen(sh)) },
  // the scorecard in match play (0E:43D6): Right on the standings page turns to the hole-by-hole card (0E:762F),
  // Left there back, A leaves
  { name: "scorecard_match18", round: "match18", at: "0E:43D6", run: sh => inBank(sh, 0x0E, showScorecard(sh)), noRet: true,
    policy: f => (f === 30 ? 0x10 : f === 70 ? 0x20 : f === 110 ? 0x10 : f > 150 && f & 1 ? 1 : 0) },
  // the two-player Stroke round's scorecard after hole 1 (tools/round_suite.py stroke2p): the score screen (0E:4436 ->
  // 3E:6361), Right to the hole-by-hole card (0E:7199), Left back, A leaves
  { name: "scorecard_stroke2p", round: "stroke2p", at: "0E:43D6", run: sh => inBank(sh, 0x0E, showScorecard(sh)), noRet: true,
    policy: f => (f === 60 ? 0x10 : f === 120 ? 0x20 : f === 200 ? 0x10 : f === 260 ? 0x80 : f > 300 && f & 1 ? 1 : 0) },
  // the two-player Stroke round's result (RoundResultScreen 0B:59DE, the figures 0B:6143)
  { name: "result_stroke2p", round: "stroke2p", at: "0B:59DE", run: (sh, r) => inBank(sh, 0x0B, roundResultScreen(sh, r.a)),
    policy: f => (f > 120 && f & 1 ? 1 : 0) },
  { name: "result_match18", round: "match18", at: "0B:59DE", run: (sh, r) => inBank(sh, 0x0B, roundResultScreen(sh, r.a)),
    policy: f => (f > 120 && f & 1 ? 1 : 0) },
  // the pause menu (08:4666, made with web/tests/golf/mkstate_core.mjs --via 10:5BA6 --wait 60 --press 08 --at
  // 08:4666): B closes it; Down / Up move the cursor (wrapping), Start closes it; Scorecard (A on row 2), then A
  { name: "pause_r18_b", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))), policy: f => (f === 60 ? 2 : 0) },
  { name: "pause_r18_move", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))),
    policy: f => (f === 40 || f === 50 ? 0x80 : f === 60 || f === 70 || f === 80 ? 0x40 : f === 120 ? 8 : 0) },
  { name: "pause_r18_scorecard", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))),
    policy: f => (f === 40 || f === 50 ? 0x80 : f === 70 ? 1 : f > 150 && f & 1 ? 1 : 0) },
  // the link-play pause menu (41:6E49, wLinkRole $C33F poked to 1 on both sides once the first frame is done, before
  // 08:4682 reads it; no partner is needed for these items): Scorecard (Down twice, A; A back), Camera Mode (A; B),
  // Course Map (Down, A; A), Settings (Down 3 times, A, Right, B; the menu again; B), Give Up (Down 4 times, A) on the
  // first stroke and (the stroke count poked) answered No, then Yes, Quit (Up, A) answered No then Yes
  // with hDebugMode poked (1) once the first frame is done: B with Select held closes the menu into the points editor
  // (08:46F3 -> 41:77EA; it reads the buttons every 6 frames): A held 13 frames (+100 twice), Right (+10 twice), B: the points as EXP (48:4D70; A through its
  // screen); the pause menu returns
  { name: "pause_r18_debug_points", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))),
    hook: (f, w, core) => { if (!f) { w.high[0x19E] = 1; core.hram()[0x1E] = 1; } },
    policy: f => (f >= 60 && f < 64 ? 6 : f >= 64 && f < 90 ? 4 : f >= 200 && f < 213 ? 1 : f >= 230 && f < 243 ? 0x10 : f >= 260 && f < 272 ? 2 : f > 300 && !(f % 40) ? 1 : 0) },
  // (the same Course Map from the stroke-play menu: 41:7451; open: CourseMapInit 17:436F counts the frames its load
  // takes in wLoadFrameCount $C3B6 and prints the count to the debug text $CD64: the game's lag frames, which the
  // native code has not, so those bytes and HRAM $FFA9 / $FFAA differ at the end, as in boot_coursemap)
  { name: "pause_r18_coursemap", state: "pause_r18", open: true, run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))), policy: f => (f === 40 ? 0x80 : f === 60 ? 1 : f === 400 ? 1 : 0) },
  ...[["scorecard", f => (f === 40 || f === 50 ? 0x80 : f === 70 ? 1 : f === 300 ? 1 : 0)],
    ["camera", f => (f === 40 ? 1 : f >= 120 && f < 160 ? 0x40 : f === 300 ? 2 : 0)],
    ["coursemap", f => (f === 40 ? 0x80 : f === 60 ? 1 : f === 400 ? 1 : 0)],
    ["settings", f => (f === 40 || f === 50 || f === 60 ? 0x80 : f === 80 ? 1 : f === 160 ? 0x10 : f === 200 ? 2 : f === 300 ? 2 : 0)],
    ["giveup1", f => (f >= 40 && f <= 70 && !(f % 10) ? 0x80 : f === 100 ? 1 : f > 200 && f < 400 && !(f % 40) ? 1 : 0)],
    ["giveup", f => (f >= 40 && f <= 70 && !(f % 10) ? 0x80 : f === 100 ? 1 : f === 200 ? 1 : f === 300 ? 1 : f === 340 ? 0x40 : f === 360 ? 1 : 0), true],
    ["quit_no", f => (f === 40 ? 0x40 : f === 60 ? 1 : f === 160 ? 1 : f === 300 ? 2 : 0)],
    ["quit", f => (f === 40 ? 0x40 : f === 60 ? 1 : f === 160 ? 0x40 : f === 200 ? 1 : 0)],
  ].map(([n, policy, stroke]) => ({ name: `pause_link_${n}`, state: "pause_r18", open: n === "coursemap", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))), policy,
    hook: (f, w, core) => { if (f) return; for (const m of [w.wram[0], core.wram(0)]) { m[0x33F] = 1; if (stroke) m[0x8A0] = 1; } } })),
  // ShotSetup 10:4798 at the first tee (mkstate_core.mjs --at 10:4798): Start in the aiming menu, Scorecard, A
  // back: the scene starts again (10:489D) and aiming goes on; up to the address step (10:56B0; the game is then
  // into the address step's first frame: its HRAM scratch $FFA7, $FFAC-$FFAE differ)
  { name: "pause_scorecard_back", state: "shotsetup_r18", noRet: true, open: true, run: sh => onHole(sh, inBank(sh, 0x10, shotSetup(sh))),
    policy: f => (f === 200 ? 8 : f === 260 || f === 270 ? 0x80 : f === 290 ? 1 : f === 400 ? 1 : f === 600 ? 1 : 0) },
  // ShowPlayerPicture 3B:7717 (r18's first picture, mkstate.mjs --name r18 --at 3B:7717) given a = 0: the hole in
  // one's picture with its full-screen cycling picture (4A:6205)
  { name: "picture_hole_in_one", state: "picture_r18", regs: { a: 0 },
    run: (sh, r) => onHole(sh, inBank(sh, 0x3B, showPlayerPicture(sh, r.a))), noRet: true },
  // the front end from power-on (web/tests/golf/boottrace.mjs --save-at ... --state out/state_boot_X.json): the title
  // with its attract loop (40:4032, a = 0), Start at its frame 2600
  { name: "boot_title", state: "boot_title", run: (sh, r) => inBank(sh, 0x40, titleScreen(sh, r.a)),
    policy: f => (f >= 2600 && f < 2606 ? 8 : 0) },
  // A during the demo skips to the title; the title times out back to the attract loop; Start skips that; Start
  { name: "boot_title_skip", state: "boot_title", run: (sh, r) => inBank(sh, 0x40, titleScreen(sh, r.a)),
    policy: f => (f >= 400 && f < 404 ? 1 : f >= 1900 && f < 1904 ? 8 : f >= 2200 && f < 2204 ? 8 : 0) },
  // LinkMenu 09:4A12: A on the first item; Up (wraps to the last), Up, Down, Down, Down, B
  { name: "boot_linkmenu", state: "boot_linkmenu", run: sh => inBank(sh, 0x09, linkMenu(sh)), policy: f => (f === 280 ? 1 : 0) },
  { name: "boot_linkmenu_b", state: "boot_linkmenu", run: sh => inBank(sh, 0x09, linkMenu(sh)),
    policy: f => (f === 60 || f === 100 ? 0x40 : f === 140 || f === 180 || f === 220 ? 0x80 : f === 300 ? 2 : 0) },
  // CharacterSelectScreen 06:6071 (hl = the roster $D658, b = 0): Right x4 to Mario, A (the boot script's presses)
  { name: "boot_charselect", state: "boot_charselect", run: (sh, r) => inBank(sh, 0x06, characterSelectScreen(sh, r.h << 8 | r.l, r.b)),
    policy: f => ([88, 118, 148, 178].includes(f) ? 0x10 : f === 238 ? 1 : 0) },
  // Down, Up, Left (wraps), Left, Down, Right, Select+A on a preset (sets its +$10), ...; then B
  { name: "boot_charselect_moves", state: "boot_charselect", run: (sh, r) => inBank(sh, 0x06, characterSelectScreen(sh, r.h << 8 | r.l, r.b)),
    policy: f => ({ 80: 0x80, 110: 0x40, 140: 0x20, 170: 0x20, 200: 0x80, 230: 0x10, 260: 0x80, 300: 2 })[f] || 0 },
  // GameModeSelect 0D:4AA7 and CourseSelect 0F:4AB7 (the boot script's A); Right, Right, Left, then A or B
  { name: "boot_modeselect", state: "boot_modeselect", run: sh => inBank(sh, 0x0D, gameModeSelect(sh)), policy: f => (f === 240 ? 1 : 0) },
  { name: "boot_modeselect_moves", state: "boot_modeselect", run: sh => inBank(sh, 0x0D, gameModeSelect(sh)),
    policy: f => ({ 100: 0x10, 160: 0x10, 220: 0x20, 300: 2 })[f] || 0 },
  { name: "boot_courseselect", state: "boot_courseselect", run: sh => inBank(sh, 0x0F, courseSelect(sh)), policy: f => (f === 280 ? 1 : 0) },
  { name: "boot_courseselect_moves", state: "boot_courseselect", run: sh => inBank(sh, 0x0F, courseSelect(sh)),
    policy: f => ({ 100: 0x10, 160: 0x10, 220: 0x20, 300: 1 })[f] || 0 },
  // ModeSelectMain 32:5037 (map $00's enter script) from the title to the Stroke round's GolfRound call: Start, A
  // (one player), Right x4 to Mario, A, A (Stroke), A (course 1); open: compared up to the native's return (the game
  // is then into GolfRound's first frame: $C833 $C839 $C96D $D4F0 and hFF96 differ)
  { name: "boot_modeselectmain", state: "boot_modeselectmain", open: true, noRet: true,
    run: sh => { menuW = sh.w; return inBank(sh, 0x32, modeSelectMain(sh)); }, policy: frontEndPolicy },
  // power-on (00:0100, an empty save RAM) to the Stroke round's GolfRound call, the same buttons
  { name: "boot_poweron", state: "boot_poweron", open: true, noRet: true,
    run: sh => { menuW = sh.w; return powerOn(sh); }, policy: frontEndPolicy },
  // power-on (an empty save RAM): Start, one player, A on the character select's slot 0 (empty: "Create a new
  // character here."): ModeSelectMain asks the map engine for warp 5, map $1E's enter script (31:43B9: the picks with
  // A, each the first; the name entry: Start to END, A: the default name; the confirm prompt: Yes), then map $05's
  // first-day scene (32:71D7) and map $00 entrance 2: the mode select with a save file (stopped there)
  { name: "boot_newchar", state: "boot_poweron", open: true, noRet: true, sram: true,
    run: sh => gameCase(sh, 0), policy: newCharPolicy() },
  // the saved character's story (the mode select's first item, Mario's story: warp 4, map $03 the clubhouse): walks
  // and talks by walkCase's script from the frame the map is first on (wMapId $03)
  { name: "boot_kid_story_walk", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...walkCase(savedPolicy(0), [
      [300, 390, 0x40], [390, 430, 0x10], [430, 460, 0x40], [500, 501, 1], [560, 561, 1], [620, 621, 1], [680, 681, 1],
      [740, 741, 1], [800, 860, 0x20], [900, 1000, 0x80], [1000, 1040, 0x22], [1060, 1120, 0x10]], 1200) },
  // the clubhouse's door 3 (up, left, up into it: trigger 5, 32:5CEF): the door opens, warp 5 to map $06 entrance 2
  // (the Locker Room, 34:42B6); right, up to a locker, A: it opens (object 9, 34:4240), A
  { name: "boot_kid_story_door3", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...walkCase(savedPolicy(0), [
      [300, 470, 0x40], [470, 620, 0x20], [620, 650, 0x40], [800, 816, 0x10], [830, 880, 0x40], [900, 901, 1],
      [980, 981, 1], [1040, 1041, 1], [1100, 1101, 1]], 1300) },
  // the clubhouse's door 4 (trigger 6, 32:5D0F) to the Lounge (map $04, 32:69B5): its first-visit tour of the Club
  // Champs (trigger 1, 32:6739; A every 40 frames: Yes at the end)
  { name: "boot_kid_story_lounge", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 }], 300) },
  // the same, then the Marion Club Champ (actor 7, talk 32:63A8 -> 32:6B81): "Want to be partners?" Yes twice: he
  // joins (32:6DCF: sound $94, following the player with the follow script 04:454B, op $0A 04:484D); a walk round the
  // Lounge with him following, out to the clubhouse (map $03: the partner spawned with the player, 04:51D0), the
  // counter's talk with a partner (32:5B5A)
  { name: "boot_kid_story_champ", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      [60, 0x80], [60, 0x10], [60, 0x40], [80, 0], { to: [0x18, 0x20], map: 0x03, noA: true }, [300, 0],
      { to: [0x22, 0x21], at: [0x22F0, 0x2100], noA: true }, [2, 0x40], [20, 0], { press: 1, every: 60, times: 3 },
      [200, 0]], 300) },
  // the same join, then A on the partner (talk 0A:5365 -> 0A:536E): "Stop being partners?" Yes: the flags cleared,
  // the map reloaded (warp $FA) without him
  { name: "boot_kid_story_champ_part", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      [2, 0x40], [20, 0], { press: 1, every: 40, times: 10 }, [300, 0]], 300) },
  // the Marion Club Champ joins (as above), the walk to the Caddie Master's office: his call with a partner (33:4ABB)
  // "A match?" Yes: the walk out (33:5105 / 33:5123), the Match Game against the partner (33:4F4B: wStoryRoundKind
  // $1E, game mode 2, golfer 4; one hole: #72 poked), back to the office (33:4666)
  { name: "boot_kid_story_partnermatch", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      { to: [0x18, 0x20], map: 0x03, noA: true }, [300, 0], { to: [0x1A, 0x02], map: 0x08, noA: true },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x08 },
      { press: 1, every: 40, times: 20 }], 300) },
  // the same Match Game won (the result poked to 1 on both sides once the round is over; #86 poked): the office
  // (33:464C) warps 9 to the Match Game Event (map $30, 34:77EB: #188, the beaten champion's scene with the other
  // champions), then back to the office (wStoryRoundKind $5A)
  { name: "boot_kid_story_matchwon", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    hook: (() => { const fp = flagPoke(72, 86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 1; core.wram(0)[0x96C] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      { to: [0x18, 0x20], map: 0x03, noA: true }, [300, 0], { to: [0x1A, 0x02], map: 0x08, noA: true },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x30 },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x08 }, { press: 1, every: 40, times: 10 }], 300) },
  // the same walk to the office with the partner, "A match?" No (33:4B91); out by the driving range's way (trigger
  // 3, 33:451B): the partner's question (33:4FEF) No: a step back; again, Yes: the partner leaves (fade out, put
  // away), the walk out to the range
  { name: "boot_kid_story_partnerleave", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      { to: [0x18, 0x20], map: 0x03, noA: true }, [300, 0], { to: [0x1A, 0x02], map: 0x08, noA: true },
      [200, 0], { to: [0x1A, 0x0A], noA: true }, ...ynNo, { press: 1, every: 40, times: 3 }, [100, 0],
      { to: [0x24, 0x0A], noA: true }, ...ynNo, [100, 0], { to: [0x24, 0x0A], noA: true },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1], { press: 1, every: 40, times: 6 },
      [300, 0]], 300) },
  // the champion joins, out to the Field with him, up onto Windy Valley's trigger (6, 34:4618): "Quitting this Match
  // Game?" (34:5530) No: he stays, nothing is warped, and the trigger asks again while the player stands on it
  { name: "boot_kid_story_partnerfield", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 },
      [400, 0], { to: [0x0B, 0x13] }, { press: 1, every: 30, times: 90 },
      { to: [0x07, 0x0B], at: [0x0710, 0x0B30], noA: true }, [2, 0x40], [20, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x298] !== 0xFF }, [200, 0],
      { to: [0x18, 0x20], map: 0x03, noA: true }, [300, 0], { to: [0x1A, 0x2E], map: 0x02, noA: true }, [200, 0],
      { to: [0x1C, 0x27], noA: true }, { to: [0x1C, 0x24], noA: true }, ...ynNo, { press: 1, every: 40, times: 2 }, [200, 0]], 300) },
  // the clubhouse's door 5 (trigger 7, 32:5D2F) to the Trophy Room (map $07; #112 #136 #113 poked: the Marion
  // victory trophy and a Palm place trophy, 35:41B2); A at each: 35:4115 / 4126 (35:4345, the place 35:4396)
  { name: "boot_kid_story_trophies", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(112, 136, 113),
    ...routeCase(savedPolicy(0), [{ to: [0x2C, 0x14], noA: true }, { to: [0x2C, 0x12], map: 0x07, noA: true }, [300, 0],
      { to: [0x04, 0x0C], noA: true }, [2, 0x40], [20, 0], [2, 1], { press: 1, every: 40, times: 4 },
      { to: [0x04, 0x06], at: [0x0500, 0x0700], noA: true }, [2, 0x40], [20, 0], [2, 1], { press: 1, every: 40, times: 4 }, [200, 0]], 300) },
  // the clubhouse's top door (trigger 2, 32:5C09) to the Caddie Master's office (map $08, 33:4722): his call
  // (trigger 1, 33:4BD3), the round menu (33:5166)
  { name: "boot_kid_story_office", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x08 },
      { press: 1, every: 40, times: 20 }], 300) },
  // the same office, a tutor (talk $0C, 33:42AB: the lingo; $11, 33:4305: all with the category hints): Yes, the
  // dictionary's list (3F:4002 mode 0 / 5): rows moved, an entry read, Right, B; the office again (warp $FA)
  ...[["lingo", [0x0D, 0x0D], 0x40], ["hints", [0x05, 0x0D], 0x20]].map(([n, at, face]) => ({
    name: `boot_kid_story_tutor_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: at }, [4, face], [20, 0],
      { press: 1, every: 40, until: inDict }, [150, 0], [2, 0x80], [30, 0], [2, 0x80], [30, 0], [2, 1],
      { press: 1, every: 40, until: dictPage("list") }, [30, 0], [2, 0x10], [60, 0], [2, 2],
      { press: 0, every: 40, until: () => !inDict() && menuW.wram[0][0x450] === 0x08 }, [300, 0]], 100),
  })),
  // the same, Practice Round in the menu (Down, A; the question: A): the walk out (33:50BB), the practice round (one
  // hole), back to the office
  { name: "boot_kid_story_practice", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 0x80],
      [30, 0], [2, 1], { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x08 },
      { press: 1, every: 40, times: 20 }], 300) },
  // the same with the round's result poked to 1 (won) on both sides once the round is over: the office asks warp 6,
  // the Marion Club's award ceremony (map $18 entrance 2, 31:7775: the champion 31:78E1), warp 1 back to the office
  // (entrance 6): the walk in and the winner's speech (33:4D97)
  { name: "boot_kid_story_ceremony", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    hook: (() => { const fp = flagPoke(72); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 1; core.wram(0)[0x96C] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x18 },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x08 }, { press: 1, every: 40, times: 20 }], 300) },
  // the clubhouse's way out (trigger 1, 32:5C25) to the Field (map $02, 34:4690), to the Palm Club (trigger 2,
  // 34:4497): its office (map $09, 33:4722 with 33:55A3), the Caddie Master's call and menu: Club Tournament without
  // the Marion Club's place (#112): base + 7
  { name: "boot_kid_story_field", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x04, 0x16], map: 0x09 }, [200, 0],
      { to: [0x1A, 0x0A] }, { press: 1, every: 40, times: 14 }], 300) },
  // the Palm Club's office (map $09; qualified: #112 poked, the Caddie Master out of the way) to its driving range
  // (map $0F, 31:5543): the first coach (actor 3, 31:540E): the intentional shot's demo (the coach's 210 drive and
  // $C89D, the hooks 31:5630 / 566D), the try (31:56A1 / 56DE, the judgement 31:5800), the result (31:5711), a retry
  { name: "boot_kid_story_palmrange", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(112),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x04, 0x16], map: 0x09 }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x0F },
      [100, 0], { to: [0x20, 0x3B], at: [0x2000, 0x3BC0], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x0F && menuW.wram[0][0x46A] === 6 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 31:54A2): the shot into the wind (the hooks 31:5943 / 598B / 59BF / 59FC),
  // the result (31:5A27)
  { name: "boot_kid_story_palmrange_wind", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(112),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x04, 0x16], map: 0x09 }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x0F },
      [100, 0], { to: [0x18, 0x3B], at: [0x1800, 0x3BC0], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x0F && menuW.wram[0][0x46A] === 7 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the Palm Club's office (#112 poked) to its approach range (map $10, 30:4B62): the first coach (actor 3, 30:4A26):
  // the bunker shot's demo (the hooks 30:4C27 / 4C6F), the try (30:4CA3 / 4CCB), the result (30:4CF9), a retry
  { name: "boot_kid_story_palmapproach", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(112),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x04, 0x16], map: 0x09 }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x10 },
      [100, 0], { to: [0x20, 0x23], at: [0x2000, 0x2330], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x10 && menuW.wram[0][0x46A] === 4 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 30:4AAF): the running approach on a sloped green (the hooks 30:4E67-4EF5),
  // the result (30:4F23: no ScriptEnd)
  { name: "boot_kid_story_palmapproach_sloped", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(112),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x04, 0x16], map: 0x09 }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x10 },
      [100, 0], { to: [0x1C, 0x26], noA: true }, { to: [0x1C, 0x21], at: [0x1C00, 0x2130], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x10 && menuW.wram[0][0x46A] === 5 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the Dune Club's office (map $0A, the Field's trigger 3; #113 poked: qualified) to its driving range (map $12,
  // 31:5E63): the first coach (actor 3, 31:5D2A): the high shot's demo (the hooks 31:5F27 / 5F52), the try (31:5F78 /
  // 5FB5 with the judgement 31:607B; the forced shot set twice), the result (31:5FE8), a retry
  { name: "boot_kid_story_dunerange", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(113),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x20, 0x2A], map: 0x0A }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x12 },
      [100, 0], { to: [0x24, 0x3B], at: [0x2400, 0x3BC0], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x12 && menuW.wram[0][0x46A] === 6 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 31:5DBF): the low shot out of the trees (player 1 off the tee after the tee:
  // 31:5E2F; the hooks 31:61B5-6263, the judgement 31:6321), the result (31:628E)
  { name: "boot_kid_story_dunerange_tree", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(113),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x20, 0x2A], map: 0x0A }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x12 },
      [100, 0], { to: [0x0D, 0x2D], at: [0x0CD0, 0x2D30], noA: true }, [2, 0x10], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x12 && menuW.wram[0][0x46A] === 7 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the Dune Club's office (#113 poked) to its approach range (map $13, 30:52CB): the first coach (actor 3, 30:51A7):
  // the backspin approach's demo (the hooks 30:538F / 53C9), the try (30:53F5 / 541D), the result (30:545F), a retry
  { name: "boot_kid_story_duneapproach", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(113),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x20, 0x2A], map: 0x0A }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x13 },
      [100, 0], { to: [0x23, 0x21], at: [0x2300, 0x2130], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x13 && menuW.wram[0][0x46A] === 4 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 30:5230): the approach up the climb (the hooks 30:55E1-566F), the result
  // (30:56AE: no ScriptEnd)
  { name: "boot_kid_story_duneapproach_uphill", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(113),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x20, 0x2A], map: 0x0A }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x13 },
      [100, 0], { to: [0x1F, 0x21], at: [0x1F00, 0x2130], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x13 && menuW.wram[0][0x46A] === 5 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the Links Club's office (map $0B, the Field's trigger 4; #114 poked: qualified) to its driving range (map $15,
  // 31:67C8): the first coach (actor 3, 31:65B8): the tree shot's demo (course 0 hole $0A; the hooks 31:6909 /
  // 697D), the try (31:69BC / 6A02, the judgement 31:6B8B), the result (31:6A56), a retry
  { name: "boot_kid_story_linksrange", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x15 },
      [100, 0], { to: [0x2F, 0x21], at: [0x2F30, 0x2130], noA: true }, [2, 0x20], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x15 && menuW.wram[0][0x46A] === 6 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same after the Links tournament won (#114 #115 #139, the path past the tree open #125 and the tree shot's lesson
  // passed #174 poked): the contest
  // (31:7051 sets #224): the coach's demo for his distance, the player's shot for hers (wind $6000), the result
  // (31:6AE3)
  { name: "boot_kid_story_linkscontest", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114, 115, 125, 139, 174),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x15 },
      [100, 0], { to: [0x2F, 0x21], at: [0x2F30, 0x2130], noA: true }, [2, 0x20], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x15 && menuW.wram[0][0x46A] === 6 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 31:666F): the buried lie in a bunker (wP1OffTee written $21; the hooks
  // 31:6CD6-6DB8, the judgement 31:6F45), the result (31:6DF8)
  { name: "boot_kid_story_linksrange_buried", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x24, 0x0C], noA: true }, { to: [0x24, 0x0A], map: 0x15 },
      [100, 0], { to: [0x12, 0x25], at: [0x11D0, 0x2530], noA: true }, [2, 0x10], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x15 && menuW.wram[0][0x46A] === 7 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the Links Club's office (#114 poked) to its approach range (map $16, 30:597C): the first coach (actor 3, 30:5A94):
  // the approach over a mound (the demo's music 7; the hooks 30:5BF2-5C80; the try without a forced shot), the result
  // (30:5CC2), a retry
  { name: "boot_kid_story_linksapproach", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x16 },
      [100, 0], { to: [0x20, 0x22], at: [0x2000, 0x2230], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x16 && menuW.wram[0][0x46A] === 4 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same after the Links won (#114 #115 #125 #139 and the mound lesson passed #172 poked): the contest (30:6414 sets
  // #224; the offer 30:6159, game mode 5: ten approaches, the hooks 30:6052 / 605C counting them on the HUD), the result
  // (30:60DA)
  { name: "boot_kid_story_linksapproachcontest", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114, 115, 125, 139, 172),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x16 },
      [100, 0], { to: [0x20, 0x22], at: [0x2000, 0x2230], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x16 && menuW.wram[0][0x46A] === 4 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the second coach (actor 4, 30:5B2B): across a steep slope (the hooks 30:5E3C-5ECA), the result (30:5EF8:
  // no ScriptEnd)
  { name: "boot_kid_story_linksapproach_slope", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x34, 0x0C], noA: true }, { to: [0x34, 0x0A], map: 0x16 },
      [100, 0], { to: [0x1D, 0x25], at: [0x1D00, 0x2530], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x16 && menuW.wram[0][0x46A] === 5 },
      { press: 1, every: 40, times: 25 }], 300) },
  // after the Links Club is won (#114 #115 #139 poked): the Field's tree (trigger $0F, 34:483B, its cell set by 34:4719):
  // the sparkle (34:52C0), the letter falls (34:512E), map $25 reads it (35:79D2: #123 and the save flag $1E0), the
  // Field's entrance $0F: the path's opening (34:5019: the flying sprite, the burst, #125, the path, the marker)
  { name: "boot_kid_story_letter", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114, 115, 139),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x18], at: [0x1CD0, 0x19F0], noA: true }, [2, 0x40], [20, 0], [2, 1], { to: [0x1C, 0x18], map: 0x25 },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [1500, 0]], 300) },
  // the path open (#114 #115 #139 #123 #125 poked; #149: the clubhouse member's "Going outside?" seen): the Field's
  // trigger 5 (34:450C: the palette flash 34:532E, the walk script 34:55A6) to the Road to Peach's Castle (map $1C, 33:588F); A on the launcher (talk 6, 33:5737): the Bob-omb's launch
  // (33:57CE, the launcher 33:5899 / 5912) to Peach's Castle (map $1D, 33:5F42): the first visit's welcome (33:60B2,
  // the arrival 33:6040, Yoshi's effect 33:6E5D / 6EAA), "May we begin the tournament?" (33:66DC) No
  { name: "boot_kid_story_castle", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(114, 115, 139, 123, 125, 149),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x12], map: 0x1C, noA: true },
      [300, 0], { to: [0x0D, 0x0D], noA: true }, [2, 0x20], [20, 0], [2, 1], { press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x1D }, ...ynNo, { press: 1, every: 40, times: 5 }, [200, 0]], 300) },
  // the same, "May we begin the tournament?" Yes: the opening (33:642C: the door opened, #127, the cheering), Peach's
  // Tournament (course 5, one hole: #72 poked; the result poked to 5, out of the places, once it is over), back at
  // the castle's entrance 6 (33:5F8F: #106, #240, #243)
  { name: "boot_kid_story_peachround", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000,
    hook: (() => { const fp = flagPoke(114, 115, 139, 123, 125, 149, 72); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 5; core.wram(0)[0x96C] = 5; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x12], map: 0x1C, noA: true },
      [300, 0], { to: [0x0D, 0x0D], noA: true }, [2, 0x20], [20, 0], [2, 1], { press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x1D },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x1D }, [400, 0]], 300) },
  // the same with the result poked to 2: the award ceremony (33:672A: the stage, Peach and the trophy actors 33:6A00,
  // the second place's trophy, $147A with the place, $147B), then the castle again (33:69B2)
  { name: "boot_kid_story_peachsecond", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000,
    hook: (() => { const fp = flagPoke(114, 115, 139, 123, 125, 149, 72); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 2; core.wram(0)[0x96C] = 2; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x12], map: 0x1C, noA: true },
      [300, 0], { to: [0x0D, 0x0D], noA: true }, [2, 0x20], [20, 0], [2, 1], { press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x1D },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x1D }, { press: 1, every: 40, times: 30 },
      [400, 0]], 300) },
  // the same with the result poked to 1: the winner's ceremony (#111, the save), the character's picture (40:6666),
  // the ending (0A:56B1: the maps $31-$3E in sepia under the credits 0B:5395, the copyright 0B:58B0, the final
  // screen 0A:6747 for 3600 frames), then map 0 by warp $FA
  { name: "boot_kid_story_peachwin", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 200000,
    hook: (() => { const fp = flagPoke(114, 115, 139, 123, 125, 149, 72); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 1; core.wram(0)[0x96C] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x12], map: 0x1C, noA: true },
      [300, 0], { to: [0x0D, 0x0D], noA: true }, [2, 0x20], [20, 0], [2, 1], { press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x1D },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x1D }, { press: 1, every: 40, times: 30 },
      { press: 0, every: 60, until: () => menuW.wram[0][0x450] === 0x00 }, [600, 0]], 300) },
  // the castle again with the door open (#127 poked: #126, the arrival 33:5FCE): the 1-Up Mushroom (object 4,
  // 33:6F47: the EXP, the level-up screen, the map again), Toad's practice round (talk 6, 33:5D8D: Yes, course 5, one
  // hole: #72 poked), back at entrance 2
  { name: "boot_kid_story_castletoad", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000,
    hook: flagPoke(114, 115, 139, 123, 125, 149, 127, 72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x12], map: 0x1C, noA: true },
      [300, 0], { to: [0x0D, 0x0D], noA: true }, [2, 0x20], [20, 0], [2, 1], { press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x1D },
      [400, 0], { to: [0x0C, 0x1A], noA: true }, [2, 0x20], [20, 0], [2, 1], 
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) }, [500, 0],
      { to: [0x0C, 0x14], noA: true }, { to: [0x1E, 0x14], noA: true }, { to: [0x1E, 0x0C], noA: true }, { to: [0x1F, 0x0B], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x1D }, [400, 0]], 300) },
  // the Field's trigger $0D (34:4681) to the Club Maker's Hut (map $2E, 33:795C)
  { name: "boot_kid_story_hut", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(86, 114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x22], noA: true }, { to: [0x14, 0x20], map: 0x2E, noA: true },
      [300, 0], { to: [0x0B, 0x0C], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, times: 8 }, [200, 0], { to: [0x04, 0x06], at: [0x0500, 0x0700], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) }, [500, 0],
      { to: [0x0A, 0x12], noA: true }, { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [300, 0]], 300) },
  // the same hut with the club already made (#215 #216 poked): the exchange (33:7A73: Yes, Yes: the club given back,
  // #216 cleared, SetCharFlags12 0, the return point, SaveGame), the maker again ($181A)
  { name: "boot_kid_story_hutswap", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(86, 114, 215, 216),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x14, 0x22], noA: true }, { to: [0x14, 0x20], map: 0x2E, noA: true },
      [300, 0], { to: [0x0B, 0x0C], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, times: 8 }, [200, 0], [2, 1], { press: 1, every: 40, times: 4 }, [200, 0]], 300) },
  // the Field's trigger 6 (34:4618) to Windy Valley (map $26, 33:7184): trigger 1 (33:70F8: the guardian's talk
  // 33:701F, he steps aside; "Shoot from here?" 33:72BE Yes): the target shot (game mode 5, course 0 hole 7, the hooks
  // 33:736F; the result poked to a hit, $C3E0 = 1, on both sides once the round is over), back at entrance $FA
  // (33:73BB: 40 EXP, the level-up screen, the save, warp $0F), entrance $0F (33:71FA: #198, the save, the guardian
  // walks off, warp 1): the Field
  { name: "boot_kid_story_windy", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    hook: (() => { const fp = flagPoke(86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x3E0] = 1; core.wram(0)[0x3E0] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x26], noA: true }, { to: [0x1C, 0x24], map: 0x26, noA: true },
      [300, 0], { to: [0x20, 0x1E], noA: true }, { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x26 },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [300, 0]], 300) },
  // Windy Valley after its first target (#114 #198 #199 #200 #212 poked): the door (trigger 4, 33:7116) to the hut's
  // other half (map $2F): the guardian (talk 3, 33:78B6: #213, warp 3), Windy Valley's entrance 3 (33:71D5); trigger 1
  // (33:70F8, Yes): the second target (game mode 5, course 8 hole $0B; a hit poked as above), entrance $FA (33:755B:
  // 180 EXP, #201, the level-up screen, the save, warp $0E), the guru (33:7660: Yes, Yes, Yes: SwapShotCurve 33:779F)
  { name: "boot_kid_story_windy2", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    hook: (() => { const fp = flagPoke(86, 114, 198, 199, 200, 212); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x3E0] = 1; core.wram(0)[0x3E0] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x26], noA: true }, { to: [0x1C, 0x24], map: 0x26, noA: true },
      [300, 0], { to: [0x22, 0x18], noA: true }, { to: [0x22, 0x16], map: 0x2F, noA: true }, [300, 0],
      { to: [0x25, 0x0D], at: [0x2500, 0x0D00], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x26 }, [300, 0],
      { to: [0x23, 0x23], noA: true }, { to: [0x23, 0x1F], noA: true }, { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x26 },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, times: 16 }, [300, 0]], 300) },
  // the Field's trigger 7 (34:4627) to the Tiny-Tots Golf Grounds (map $27, 34:5820): trigger 1 (34:576F, the
  // caretaker grumbles, #203); the caretaker (talk 2, 34:56C6 -> 34:584B: Yes): his demo (golfer $4E, hooks 34:58E6),
  // the clean-up (entrance 5, 34:590D: game mode $0B, ten balls on the shot clock, the hooks 34:5C61: 34:5C82 after
  // each shot, 34:5D40 the piles removed, 34:5D9E the clock), the result (entrance 6, 34:597D: one ball, $14F4)
  { name: "boot_kid_story_tinytots", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 60000, hook: flagPoke(86),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0E, 0x2E], noA: true }, { to: [0x0E, 0x2C], map: 0x27, noA: true },
      [300, 0], { to: [0x1A, 0x34], noA: true }, { press: 1, every: 40, times: 6 }, [200, 0], { to: [0x1F, 0x2B], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x27 }, { press: 1, every: 40, times: 10 }, [300, 0]], 300) },
  // the same with all ten balls in (the count $C3E1 poked to 10 on both sides after the clean-up): the result's "You
  // could manage this place!" (34:59F9: Yes), 50 EXP and a quarter (34:5A99: #202, the level-up screen, the save),
  // warp 1: the Field
  { name: "boot_kid_story_tinytots10", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 60000,
    hook: (() => { const fp = flagPoke(86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 2) { done = true; w.wram[0][0x3E1] = 10; core.wram(0)[0x3E1] = 10; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0E, 0x2E], noA: true }, { to: [0x0E, 0x2C], map: 0x27, noA: true },
      [300, 0], { to: [0x1A, 0x34], noA: true }, { press: 1, every: 40, times: 6 }, [200, 0], { to: [0x1F, 0x2B], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x27 },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [300, 0]], 300) },
  // the Field's trigger 8 (34:4636) to the Mini-Mini Lake Course (map $28, 34:5E53): trigger 1 (34:5EE1: #211, the
  // golfer's shot from the rough, game mode 5, golfer $4F replaying 34:5F83, the hooks 34:5F93), entrance 5 (34:5FBE);
  // his partner (talk 3, 34:6064: the debate, No): the player's try (34:64B1, the hooks 34:6507), entrance 6 (34:6568:
  // as played, missed: 34:6114, #218)
  { name: "boot_kid_story_minilake", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000, hook: flagPoke(86),
    ...routeCase(savedPolicy(0), MINILAKE.concat([[300, 0]]), 300) },
  // the same with the try poked to a ball skipped over the water onto the green ($C3E0 = $C3E1 = 1 on both sides): "NICE
  // ON!" (34:61BB), the golfer's try (34:6299), entrance $0D (34:62C0: 175 EXP, the level-up screen, the save), entrance
  // $0F (34:6362: #210, they walk off), the Field
  { name: "boot_kid_story_minilake2", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 60000,
    hook: (() => { const fp = flagPoke(86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 2) { done = true; for (const m of [w.wram[0], core.wram(0)]) { m[0x3E0] = 1; m[0x3E1] = 1; } }
    }; })(),
    ...routeCase(savedPolicy(0), MINILAKE.concat([{ press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [300, 0]]), 300) },
  // the Field's trigger $0B (34:4663) to the Golf Guru's Pitch and Putt (map $2C, 34:74B5): the guru (talk 2, 34:7407:
  // Yes): course 9's nine holes in game mode $0A (34:7547, the hooks 34:75C8), entrance 6 (34:75F6: the card, $1554)
  { name: "boot_kid_story_pitchputt", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 80000, hook: flagPoke(86),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x22, 0x1C], noA: true }, { to: [0x22, 0x1A], map: 0x2C, noA: true },
      [300, 0], { to: [0x1D, 0x21], at: [0x1D00, 0x2100], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x2C }, { press: 1, every: 40, times: 8 }, [300, 0]], 300) },
  // the same with a perfect card poked after the round (each hole on in one and one putt, $C8AC = $12, 9 under par,
  // $C8BE = $F7, on both sides): $155A (34:76B5), 300 EXP, #208 #159, the save flag $0200, the level-up screen, the
  // save, warp $0F: entrance 7 (34:770F)
  { name: "boot_kid_story_pitchputt9", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 80000,
    hook: (() => { const fp = flagPoke(86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; for (const m of [w.wram[0], core.wram(0)]) { m.fill(0x12, 0x8AC, 0x8B5); m[0x8BE] = 0xF7; } }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x22, 0x1C], noA: true }, { to: [0x22, 0x1A], map: 0x2C, noA: true },
      [300, 0], { to: [0x1D, 0x21], at: [0x1D00, 0x2100], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x2C },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, until: () => menuW.wram[0][0x46A] === 0x07 }, { press: 1, every: 40, times: 4 }, [300, 0]], 300) },
  // the Field's trigger 9 (34:4645) to Raven Woods (map $29, 34:6B37): trigger 3 (34:6BFE: the hat stolen, #204),
  // trigger 1 (34:69A4: the crow flies off, the first time's scene with the hat's sprite near the player 34:7070,
  // #205 #206), trigger 2 with A held (34:6ABE: the crow back, #206 cleared; "Play from here?" 34:7144 Yes): the pin
  // shot (34:716B: game mode 5, the hooks 34:71CC, the crow on the pin in the green view 34:66A0), missed
  { name: "boot_kid_story_ravenwoods", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000, hook: flagPoke(86),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0E, 0x18], noA: true }, { to: [0x0E, 0x16], map: 0x29, noA: true },
      [300, 0], { to: [0x14, 0x2C], noA: true }, { press: 1, every: 40, times: 10 }, [100, 0],
      { to: [0x1A, 0x1A], noA: true }, { press: 1, every: 40, times: 14 }, [200, 0],
      { to: [0x14, 0x16], noA: true },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x29 }, [300, 0]], 300) },
  // the same with the pin hit (the shot's $C3E1 poked to 1 on both sides after the round): entrance $FA warps 2,
  // entrance 6 (34:6D46: the crow drops the hat, 200 EXP, the level-up screen, warp 3), entrance 7 (34:6E5F: #207,
  // the save, the hat returned, the golfer leaves, warp 1): the Field
  { name: "boot_kid_story_ravenwoods2", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000,
    hook: (() => { const fp = flagPoke(86); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x3E1] = 1; core.wram(0)[0x3E1] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0E, 0x18], noA: true }, { to: [0x0E, 0x16], map: 0x29, noA: true },
      [300, 0], { to: [0x14, 0x2C], noA: true }, { press: 1, every: 40, times: 10 }, [100, 0],
      { to: [0x1A, 0x1A], noA: true }, { press: 1, every: 40, times: 14 }, [200, 0],
      { to: [0x14, 0x16], noA: true },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x29 },
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x02 }, [300, 0]], 300) },
  // the Field's trigger $0C (34:4672) to the Golf Clinic (map $2D, 31:72A3): the first coach (talk 5, 31:7199 Yes):
  // the judged shot (31:7252, game mode 6, the hooks 31:75C0: 31:760C's class), entrance 2: both coaches' comments
  // (31:72CF / 31:7444)
  { name: "boot_kid_story_clinic", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 40000, hook: flagPoke(86),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0A, 0x1A], noA: true }, { to: [0x0A, 0x18], map: 0x2D, noA: true },
      [300, 0], { to: [0x1E, 0x3B], at: [0x1E00, 0x3B00], noA: true }, [2, 0x40], [20, 0], [2, 1], { press: 1, every: 40, until: () => hasTask(menuW, 0x05, 0x4F20) }, [30, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x2D }, { press: 1, every: 40, times: 8 }, [300, 0]], 300) },
  // Raven Woods with Sherry and Azalea already found (#86 #141 #142 poked; #204: the hat already stolen): hidden Joe
  // (object $0F, 34:692C: #143), all the hidden friends found (34:7E12: 300 EXP, the level-up screen, the save, the
  // map again where the player stood)
  { name: "boot_kid_story_joe", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(86, 141, 142, 204),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x0E, 0x18], noA: true }, { to: [0x0E, 0x16], map: 0x29, noA: true },
      [300, 0], { to: [0x0E, 0x20], noA: true }, [2, 0x20], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => hasTask(menuW, 0x41, 0x5694) },
      { press: 1, every: 60, until: () => !hasTask(menuW, 0x41, 0x5694) }, [400, 0]], 300) },
  // the Dune Club's putting green (map $14; #113 #114 poked): its golfers' invitation to the Alternate Game
  { name: "boot_kid_story_altgame", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 150000, hook: flagPoke(113, 114),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x20, 0x2A], map: 0x0A }, [200, 0],
      { to: [0x3A, 0x0C] }, { to: [0x3C, 0x0C], map: 0x14 }, [300, 0], { to: [0x1F, 0x17], at: [0x1F00, 0x1700], noA: true }, [2, 0x40], [20, 0], [2, 1],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x2B }, { press: 1, every: 40, times: 20 }, [300, 0]], 300) },
  // the clubhouse (map $03) after the club rounds, talks of the lists the enter script patches in (32:5853 5928 59C7
  // 5A4C 5B09; flags poked by the progress): the counter's member and visitor (actors 2 / 3, from inside the counter),
  // the dogleg quiz (actor 9, after Marion), the fan (actor $0A), the Grand Champ quiz (actor 5); "y" / "n" answer the
  // talk's question Yes / No
  ...[["marion_lost", [112], "mvqqf"], ["marion_won", [112, 136], "mvQf"], ["palm_lost", [112, 113], "Mvf"],
    ["palm_won", [112, 113, 136, 137], "mvf"], ["palm_wonno", [112, 113, 137], "Nvf"], ["dune_lost", [112, 113, 114], "mvf"],
    ["dune_won", [112, 113, 114, 138], "mvf"], ["links_lost", [112, 113, 114, 115], "mvf"],
    ["links_won", [112, 113, 114, 115, 139, 137], "mvfg"], ["links_wonno", [112, 113, 114, 115, 139], "G"]].map(([n, flags, talks]) => ({
    name: `boot_kid_story_counter_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(...flags), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [...talks].flatMap(t => ({
      m: talkSteps([0x2300, 0x2100], 0x20), M: talkSteps([0x2300, 0x2100], 0x20), N: talkSteps([0x2300, 0x2100], 0x20, null, true),
      v: talkSteps([0x2300, 0x1F00], 0x20),
      q: [{ to: [0x1C, 0x0C], noA: true }, ...talkSteps(9, 0x40)], Q: [{ to: [0x1C, 0x0C], noA: true }, ...talkSteps(9, 0x40, null, true)],
      f: [{ to: [0x18, 0x1C], noA: true }, ...talkSteps(10, 0x40)],
      g: talkSteps([0x1B00, 0x1F00], 0x10), G: talkSteps([0x1B00, 0x1F00], 0x10, null, true) })[t]), 200),
  })),
  // the Lounge (map $04, door 4) after the club rounds (#96: the tour seen), the talk lists 32:64E7 6530 6579 65C2:
  // the member (actor 2: "Got a second?" Yes; "n": No), after the Grand Champ the two members (actors 6 / 5) and, while
  // they are in the Lounge (not with all four clubs won), the champs (actors 7-$0A: their pair flags #80-#86 poked for
  // the Grand Champ's lines; the Links champ's twice)
  ...[["palm", [96, 112, 113], "2n"], ["dune", [96, 112, 113, 114], "2n"], ["links", [96, 112, 113, 114, 115], "2n"],
    ["grand", [96, 112, 113, 114, 115, 139, 136, 80, 82, 84, 86], "2657AA89"],
    ["grand_won", [96, 112, 113, 114, 115, 139, 136, 137, 138, 189], "2n65"]].map(([n, flags, talks]) => ({
    name: `boot_kid_story_lounge_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(...flags), maxFrames: 40000,
    ...routeCase(savedPolicy(0), [{ to: [0x2D, 0x05], map: 0x04 }, [400, 0], ...[...talks].flatMap(t => ({
      2: talkSteps([0x1D00, 0x1900], 0x40), n: talkSteps([0x1D00, 0x1900], 0x40, null, true),
      6: talkSteps([0x0900, 0x1500], 0x80), 5: talkSteps([0x0B00, 0x1B00], 0x40), 7: talkSteps([0x0710, 0x0B30], 0x40),
      A: talkSteps([0x0D10, 0x0B30], 0x40), 8: talkSteps([0x0900, 0x0500], 0x80), 9: talkSteps([0x0B00, 0x0500], 0x80) })[t])], 200),
  })),
  // debug mode (hDebugMode $FF9E poked to 1 on both sides when the mode select shows; the retail game never sets it):
  // the frame meter (00:2E4E) and the overlay (00:203E) every frame; on the clubhouse's floor A with nothing ahead
  // opens the debug menu (05:6B2E), Scene (05:6C25): Right twice (map record 3 -> 5), Down, Right (entrance 1), A (the
  // map and entrance set, the warp $FA asked; the debug menu again), B: the warp to the Director's Room
  { name: "boot_kid_debug_warp", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: debugPoke(1), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 1], [90, 0], [2, 0x10], [30, 0], [2, 0x10], [30, 0],
      [2, 0x80], [30, 0], [2, 0x10], [30, 0], [2, 1], [90, 0], [2, 2], [400, 0]], 100) },
  // the developer's boot menu (01:40A6: the core's jump over it at 01:40A3 skipped, w.debugBoot on the native side;
  // DEBUG_BOOT_CASES): `held` ([from, to, bits]) then `steps` ([frame, bits] pressed for 2 frames)
  // (`frames`: the case's length)
  ...DEBUG_BOOT_CASES.map(([n, held, steps, frames]) => ({ name: `boot_kid_debugboot_${n}`, state: "boot_poweron_kid", open: true,
    noRet: true, sram: true, maxFrames: frames + 100, jumps: { "01:40a3": 0x40A6 },
    run: sh => { sh.w.debugBoot = 1; return gameCase(sh, 0, () => frameNow >= frames); },
    policy: f => {
      frameNow = f;
      for (const [a, b, bits] of held) if (f >= a && f < b) return bits;
      for (const [g, bits] of steps) if (f >= g && f < g + 2) return bits;
      return 0;
    } })),
  // the debug warp to the test maps (DEBUG_WARP_CASES)
  ...DEBUG_WARP_CASES.map(([n, rec, ent, after]) => ({ name: `boot_kid_debug_map_${n}`, state: "boot_poweron_kid", open: true, noRet: true,
    sram: true, hook: debugPoke(1), maxFrames: 40000, ...routeCase(savedPolicy(0), [...dwarp(rec, ent), ...after], 100) })),
  // the debug room (DEBUG_ROOM_CASES)
  ...DEBUG_ROOM_CASES.map(([n, talks]) => ({ name: `boot_kid_debug_room_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    hook: debugPoke(1), maxFrames: 40000, ...routeCase(savedPolicy(0), [...DEBUG_ROOM, ...talks], 100) })),
  // the debug room's save viewer (talk $0A, 35:7768: 02:5D2F) with a records block poked (save block 3): Right through
  // all ten pages and on (wrapping), then Left back past page 0
  { name: "boot_kid_debug_room_save_viewer", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    hook: recordsPoke(5, () => {}, debugPoke(1)), maxFrames: 40000,
    ...routeCase(savedPolicy(0), [...DEBUG_ROOM, ...droom(0x05, 0x10), [200, 0], { press: 0x10, every: 40, times: 11 }, [60, 0],
      { press: 0x20, every: 40, times: 3 }, [200, 0]], 100) },
  // the debug menu's Map (Down, A: 0B:4579): the paged menu of graphics ids (05:5197): Right (the next page), Left,
  // Right, Down, A: that id's map graphics (0B:44C4) and tile animation; the debug menu again: B
  { name: "boot_kid_debug_mapgfx", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: debugPoke(1), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 0x80], [30, 0], [2, 1], [120, 0],
      [2, 0x10], [90, 0], [2, 0x20], [90, 0], [2, 0x10], [90, 0], [2, 0x80], [30, 0], [2, 1], [300, 0], [2, 2], [300, 0]], 100) },
  // the debug menu's Palette (Down twice, A: 44:42FB): the cursor Right, Down twice; A: the colour dialog (44:4156):
  // Up held a while (red + 1 each frame), Right, Down held (green - 1), A closes; Left; B leaves; B closes the menu
  { name: "boot_kid_debug_palette", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: debugPoke(1), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 0x80], [30, 0], [2, 0x80], [30, 0], [2, 1], [120, 0],
      [2, 0x10], [30, 0], [2, 0x80], [30, 0], [2, 0x80], [30, 0], [2, 1], [90, 0], [6, 0x40], [30, 0], [2, 0x10], [30, 0], [4, 0x80],
      [30, 0], [2, 1], [60, 0], [2, 0x20], [30, 0], [2, 2], [90, 0], [2, 2], [200, 0]], 100) },
  // the same, the debug menu's Flag (Down 3 times, A: 05:6A57): A toggles flag 0, the cursor held right and down a
  // while (moves every frame), A, Start (the next page) twice, A, B; the menu again: B
  { name: "boot_kid_debug_flags", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: debugPoke(1), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [[30, 0x40], [60, 0], [2, 1], [90, 0], [2, 0x80], [30, 0], [2, 0x80], [30, 0], [2, 0x80], [30, 0],
      [2, 1], [90, 0], [2, 1], [30, 0], [5, 0x10], [10, 0], [3, 0x80], [30, 0], [2, 1], [30, 0], [2, 8], [30, 0], [2, 8], [30, 0], [2, 1],
      [30, 0], [2, 2], [90, 0], [2, 2], [200, 0]], 100) },
  // the Director's Room (map $05, door 1) after the Palm / Dune / Links rounds: the Caddie Master's talk (actor 4,
  // 32:6FB8 / 6FC7 / 6FD6: with a club won, the champion's line)
  ...[["palm", [112, 113]], ["palm_won", [112, 113, 136]], ["dune", [112, 113, 114, 137]], ["links", [112, 113, 114, 115, 138]]].map(([n, flags]) => ({
    name: `boot_kid_story_director_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(...flags), maxFrames: 30000,
    ...routeCase(savedPolicy(0), [{ to: [0x07, 0x05], map: 0x05 }, [300, 0], ...talkSteps(4, 0x40)], 200),
  })),
  // Mario beaten (#117 poked): the story begins in the Director's Room (map $05 entrance 1, 32:7461):
  // the staff's cover-up scene (32:7533: #120), warp 1: the clubhouse
  { name: "boot_kid_story_coverup", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(117),
    ...routeCase(savedPolicy(0), [{ press: 0, every: 40, until: () => menuW.wram[0][0x450] === 0x05 },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x03 }, [300, 0]], 300) },
  // the Links Club's tournament (#114 qualified, #72 one hole poked; the result poked to 1, won): the Links Champion's
  // ceremony (map $1B entrance 2: 31:78E1), then 31:7827: the character's picture (40:6666), the staff roll (41:7E07),
  // #110, the picture until a button (40:66B5), the save, warp 3: the mode select
  { name: "boot_kid_story_linkschamp", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 60000,
    hook: (() => { const fp = flagPoke(72, 114); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (!done && roundsDone >= 1) { done = true; w.wram[0][0x96C] = 1; core.wram(0)[0x96C] = 1; }
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], { to: [0x1C, 0x12], map: 0x0B }, [200, 0],
      { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x1B },
      { press: 1, every: 40, until: () => menuW.wram[0][0x450] === 0x00 }, [300, 0]], 300) },
  // the Field, A with nothing ahead: the Navigation menu (0A:7174): Down twice, Up, Down, A: the place's guide on the
  // Field again (0A:7878: its name, the arrow, the marker); a walk; Start: the start menu's Navigation (41:7413): B
  { name: "boot_kid_story_nav", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x2E], map: 0x02 }, [200, 0], [2, 1], [120, 0], [2, 0x80], [20, 0],
      [2, 0x80], [20, 0], [2, 0x40], [20, 0], [2, 0x80], [40, 0], [2, 1], [200, 0], [40, 0x80], [30, 0x10], [100, 0],
      [2, 8], [60, 0], [2, 1], [150, 0], [2, 2], [100, 0]], 300) },
  // the office's way to Hole 1 (trigger 2, 33:44F1): the Marion Club's driving range (map $0C, 31:4BEC); its
  // practice (trigger $0F, 31:51F4: "Practice here?" Yes): the same shot again and again (the hooks 31:5296) until the
  // pause menu's Quit Practice (41:6F08): back on the range
  { name: "boot_kid_story_range", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x24, 0x0C] }, { to: [0x24, 0x0A], map: 0x0C },
      [100, 0], { to: [0x1A, 0x38] }, { press: 1, every: 40, until: () => markLog.filter(m => m.n === "aimmenu").length >= 3 },
      [60, 0], [2, 8], [60, 0], [2, 1], { press: 0, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x0C }, [400, 0]], 300) },
  // the same practice, its pause menu's other items (41:6F08 with #100): Wind Direction Right (41:770F), Wind Speed Left
  // (41:7721), Settings (41:7733: B, the menu again), then Quit Practice
  { name: "boot_kid_story_range_menu", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x24, 0x0C] }, { to: [0x24, 0x0A], map: 0x0C },
      [100, 0], { to: [0x1A, 0x38] }, { press: 1, every: 40, until: () => markLog.filter(m => m.n === "aimmenu").length >= 3 },
      [60, 0], [2, 8], [60, 0], [2, 0x80], [30, 0], [2, 0x10], [30, 0], [2, 0x10], [30, 0], [2, 0x80], [30, 0], [2, 0x20], [30, 0],
      [2, 0x80], [30, 0], [2, 1], [120, 0], [2, 2], [90, 0], [2, 0x40], [30, 0], [2, 0x40], [30, 0], [2, 0x40], [30, 0], [2, 1],
      { press: 0, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x0C }, [400, 0]], 300) },
  // the same range, the first coach (actor 3, talk 3: 31:4A8B): his demo (golfer $4F replaying 31:4C88, the hooks
  // 31:4C98: the texts 05:5E70), back on the range (entrance 4: 31:4EA9), the player's try (the hooks 31:4D14, the
  // judgement 31:4E5A), the result (entrance 6: 31:4D9C)
  { name: "boot_kid_story_lesson", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x24, 0x0C] }, { to: [0x24, 0x0A], map: 0x0C },
      [100, 0], { to: [0x14, 0x3B], at: [0x1400, 0x3B00] }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x0C && menuW.wram[0][0x46A] === 6 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the office's way to the approach range (trigger 3, 33:451B): map $0D (30:429A), its first coach (actor 3, talk 3:
  // 30:4119): the running approach's demo and try (the hooks 30:433E / 30:43AF), the result (30:4448)
  { name: "boot_kid_story_approach", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x34, 0x0C] }, { to: [0x34, 0x0A], map: 0x0D },
      [100, 0], { to: [0x1F, 0x22], at: [0x1F00, 0x2250], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === 0x0D && menuW.wram[0][0x46A] === 4 },
      { press: 1, every: 40, times: 25 }], 300) },
  // the second coaches' lessons the same way (map $0D: the chip shot, actor 4, 30:41A2, after the demo 30:4726, the
  // try, the result at entrance 5; map $0C: the iron shot, 31:4B11, 31:5137, entrance 7), then each coach again: tried,
  // "Try again?" (30:471C / 31:512D) answered No
  ...[["chip", 0x0D, [0x34, 0x0C], [0x34, 0x0A], [{ to: [0x1A, 0x1F], noA: true }, { to: [0x1B, 0x1D], at: [0x1B80, 0x1D00], noA: true }], 0x10, 5],
    ["iron", 0x0C, [0x24, 0x0C], [0x24, 0x0A], [{ to: [0x20, 0x3B], at: [0x2000, 0x3B00], noA: true }], 0x40, 7]]
    .map(([n, map, door, inside, walk, dir, ent]) => ({
      name: `boot_kid_story_lesson_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72), maxFrames: 60000,
      ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: door }, { to: inside, map },
        [100, 0], ...walk, [2, dir], [30, 0],
        { press: 1, every: 40, until: () => roundsDone >= 2 && menuW.wram[0][0x450] === map && menuW.wram[0][0x46A] === ent },
        { press: 1, every: 40, times: 25 }, [200, 0], ...walk, ...talkSteps(0, dir, null, true).slice(1)], 300),   // (its walk, then the talk)
    })),
  // the office's way to the putting green (trigger 4, 33:4545): map $0E (30:69B9), "Practice here?" (30:6AEC) declined
  // on the way onto the green, the pro (actor 8, talk 30:6666): the putting challenge (30:6739: game mode 5, ten
  // putts on five holes, the hooks 30:6C2F / 6C58), the result (30:6CF2: not cleared)
  { name: "boot_kid_story_green", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x3A, 0x0C] }, { to: [0x3C, 0x0C], map: 0x0E },
      [100, 0], { to: [0x25, 0x26], at: [0x2500, 0x2600], noA: true }, [16, 0x40], [80, 0], [2, 2], [60, 0],
      { to: [0x25, 0x1E], at: [0x2500, 0x1E00], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x0E },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, at the aim after the second putt: Start, the mini-game pause menu (41:6F9F: Down, Up, A on Quit
  // Mini-Game): the challenge over (wGameMode 0: wStoryRoundKind 0, no result)
  { name: "boot_kid_story_green_quit", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x3A, 0x0C] }, { to: [0x3C, 0x0C], map: 0x0E },
      [100, 0], { to: [0x25, 0x26], at: [0x2500, 0x2600], noA: true }, [16, 0x40], [80, 0], [2, 2], [60, 0],
      { to: [0x25, 0x1E], at: [0x2500, 0x1E00], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => menuW.wram[0][0x3E0] === 1 && lastMark === "aimmenu" }, [60, 0], [2, 8], [60, 0], [2, 0x80], [30, 0],
      [2, 0x40], [30, 0], [2, 1], [60, 0],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x0E },
      { press: 1, every: 40, times: 25 }], 300) },
  // the same, the made putts ($C3E1) set to 10 on both sides after the tenth putt: cleared (#194), the EXP (30:6EC8,
  // a quarter more for 10), the level-up screen, SaveGame and the map again (entrance $FA)
  { name: "boot_kid_story_green_cleared", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: (() => { const fp = flagPoke(72); let done = false; return (f, w, core) => {
      fp(f, w, core);
      if (done || w.wram[0][0x3E0] !== 0x0A) return;
      done = true;
      for (const m of [w.wram[0], core.wram(0)]) m[0x3E1] = 0x0A;
    }; })(),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 }, [200, 0], { to: [0x3A, 0x0C] }, { to: [0x3C, 0x0C], map: 0x0E },
      [100, 0], { to: [0x25, 0x26], at: [0x2500, 0x2600], noA: true }, [16, 0x40], [80, 0], [2, 2], [60, 0],
      { to: [0x25, 0x1E], at: [0x2500, 0x1E00], noA: true }, [2, 0x40], [30, 0],
      { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x0E && menuW.wram[0][0x46A] === 0xFA },
      { press: 1, every: 40, times: 25 }], 300) },
  // the clubhouse, Start: the start menu's Char. Data (41:7943): the character's stats screen (41:6506: the level-up
  // screen's set-up read only, the name and EXP header 41:5598 with its clock task 41:587C, the badge 41:65D1); A
  // leaves, the map again; Start, Down, A: Stars (0A:6F56, the event list): Right through the pages, Down to scroll,
  // B leaves
  { name: "boot_kid_story_chardata", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...routeCase(savedPolicy(0), [[60, 0], [2, 8], [60, 0], [2, 1], [240, 0], [2, 1], [200, 0],
      [2, 8], [60, 0], [2, 0x80], [20, 0], [2, 1], [200, 0], [2, 0x10], [120, 0], [2, 0x10], [120, 0],
      [40, 0x80], [60, 0], [2, 0x20], [120, 0], [2, 2], [200, 0]], 300) },
  // the same, then the start menu (41:6E6E): Message (Down twice) Right, Left, Right (the text speed), B; again: Up
  // (wraps to Save & Quit), A, "Save current progress?" Yes: SaveGame, map 0 entrance 1: the link menu (the save RAM
  // compared at the end)
  { name: "boot_kid_story_menu", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    ...walkCase(savedPolicy(0), [
      [300, 360, 0x40], [420, 421, 8], [480, 481, 0x80], [500, 501, 0x80], [530, 531, 0x10], [560, 561, 0x20],
      [590, 591, 0x10], [620, 621, 2], [700, 701, 8], [760, 761, 0x40], [800, 801, 1], [900, 901, 1]], 1300) },
  // power-on with a save RAM the game made (a new character "Kid" created, saved at the mode select; out/kid.sav from
  // web/tests/golf/coreplay.mjs, then boottrace.mjs --sram out/kid.sav --save-at 00:0100): slot 0 loaded
  // (SaveBlockLoad, MapWarpToReturnPoint), SaveGame, the mode select with a save file, Stroke, course 1
  { name: "boot_poweron_kid_stroke", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    run: sh => { menuW = sh.w; return powerOn(sh); }, policy: savedPolicy(3) },
  // the same with the Links won (#139 poked at the mode select, #123 clear): Stroke drops ModeSelectMain (32:5304 /
  // 32:530C), warp 6: map $25 entrance 3 (35:79D2: Peach's invitation, #123, the save), map 0's mode select again
  { name: "boot_poweron_kid_stroke_links", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(139),
    policy: (() => { const p = savedPolicy(3); return f => { frameNow = f; return p(f); }; })(),
    run: sh => { let seen = false, back = -1; return gameCase(sh, 1, () => {
      if (sh.w.wram[0][0x450] === 0x25) seen = true;
      if (seen && back < 0 && hasTask(sh.w, 0x0D, 0x428E)) back = frameNow;
      return back >= 0 && frameNow > back + 20;
    }); } },
  // Match (Right twice), Luigi, course 1
  { name: "boot_poweron_kid_match", state: "boot_poweron_kid", open: true, noRet: true,
    run: sh => { menuW = sh.w; return powerOn(sh); }, policy: savedPolicy(2) },
  // the save Save & Quit made in a round (out/kidsq.sav: SRAM_OUT of boot_kid_savequit): loading it shows the card and
  // the continue prompts (32:7D35 LoadSummaryPrompt), then the round goes on (GolfRound $FF), stopped 300 frames into
  // its second shot. (At the end the play clock SaveGame copied, $C82E and the save, is 2 frames on: the game saved
  // before its code ran past two VBlanks that the native side replays at the frame's start.)
  { name: "boot_kidsq_continue", state: "boot_poweron_kidsq", open: true, noRet: true, sram: true,
    run: sh => gameCase(sh, 1, () => markLog.filter(m => m.n === "aimmenu").length >= 2 && frameNow > markLog.filter(m => m.n === "aimmenu")[1].f + 300),
    policy: scriptedPolicy({}, savedPolicy(0)) },
  // the saved round made a match (save slot 0's block poked at frame 1: game mode 2, hole `hole`, wMatchHoles
  // $C96E from `holes`, playoff `po`): the card's holes-up line (48:4724), then B (back to the character select)
  ...[["ahead", 9, [1, 1, 0, 2, 1, 1, 1, 2, 1], 0], ["behind", 5, [2, 2, 1, 2, 0], 0], ["level", 4, [1, 2, 2, 1], 0], ["playoff", 3, [1, 0, 0], 1]].map(([n, hole, holes, po]) => ({
    name: `boot_kidsq_matchcard_${n}`, state: "boot_poweron_kidsq", open: true, noRet: true, sram: true,
    hook: (f, w, core) => {
      if (f !== 1) return;
      const t = new GolfMemory();
      t.sram.set(w.sram);
      t.high[0x196] = 1;
      if (saveBlockLoad(t, 0, 0xD000)) throw new Error("no saved block 0");
      const m = t.wram[1];
      m[0x034] = 2; m[0x037] = hole; m[0x03A] = po;
      holes.forEach((v, k) => { m[0x16E + k] = v; });
      for (let k = 0; k < 0x18; k++) m[0xE00 + k] = t.sram[0x48 + k];   // (the block's header kept)
      saveBlockStore(t, 0, 0xD000, 0xDE00);
      w.sram.set(t.sram);
      core.gb.mem.sram.set(t.sram, 0);
    },
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([[menu09Items(4), 1], [inCharSel, 1, 60], [inTask(0x48, 0x42F7), 2, 80], [inCharSel, 0, 60]]),
  })),
  // the same, the prompts: No ("Saved data will be erased, OK?"), B (back), No, No (the first prompt again), B: the
  // character select;
  // the card again: No, Yes on the second prompt: the mode select
  { name: "boot_kidsq_prompts", state: "boot_poweron_kidsq", open: true, noRet: true, sram: true,
    run: sh => gameCase(sh, 9, () => cards >= 2 && hasTask(sh.w, 0x0D, 0x428E)),
    policy: (() => {
      const base = savedPolicy(0), scripts = [
        [[40, 0x80], [80, 1], [140, 2], [200, 0x80], [240, 1], [300, 1], [360, 2]],
        [[40, 0x80], [80, 1], [120, 0x40], [160, 1]]];
      let on = false, at = 0;
      return f => {
        frameNow = f;
        const t = menuW && hasTask(menuW, 0x48, 0x42F7);
        if (t && !on) { cards++; at = f; if (process.env.MARKS) console.error("CARD", cards, f); }
        on = t;
        if (!t) return base(f);
        for (const [d, b] of scripts[cards - 1] || []) if (f === at + d) return b;
        return 0;
      };
    })() },
  // Tournament (Right once) with the kid74 save (game flag #74: one hole, hole 18): at the second shot the pause
  // menu's Scorecard: the standings page (0E:5209), Right: the strokes page, A; the hole, the standings, the placing
  // (0B:5B00), the EXP
  { name: "boot_kid74_tournament", state: "boot_poweron_kid74", open: true, noRet: true, sram: true, run: sh => gameCase(sh),
    policy: scriptedPolicy({ "aimmenu:2": [[60, 8], [100, 0x80], [120, 0x80], [150, 1], [300, 0x10], [450, 1]] }, savedPolicy(1)) },
  // the same without the pause, the return point poked when the round's place is known (wRoundResult set; on both
  // sides: map $18 entrance 2, wStoryRoundKind $32, as 08:4C6E sets them for a win): GolfSessionEnd warps to the Marion Club's award ceremony
  // (31:7775, the champion), then warp 2: the mode select
  { name: "boot_kid74_ceremony", state: "boot_poweron_kid74", open: true, noRet: true, sram: true,
    run: sh => { sawMap18 = false; return gameCase(sh, 99, () => sawMap18 && sh.w.wram[0][0x450] === 0 && hasTask(sh.w, 0x0D, 0x428E)); },
    hook: (() => { let done = false; return (f, w, core) => {
      if (w.wram[0][0x450] === 0x18) sawMap18 = true;
      if (process.env.MAPS && (w.wram[0][0x960] | w.wram[0][0x961] << 8) !== (w.lastRet ?? -1)) { w.lastRet = w.wram[0][0x960] | w.wram[0][0x961] << 8; console.error("RET", f, w.lastRet.toString(16), roundsDone, core.wram(0)[0x960], core.wram(0)[0x961]); }
      if (process.env.MAPS && w.wram[0][0x450] !== (w.lastMapLog ?? -1)) { w.lastMapLog = w.wram[0][0x450]; console.error("MAP", f, w.lastMapLog, w.wram[0][0x46A], roundsDone); }
      if (done || f < 3000 || !w.wram[0][0x96C]) return;
      done = true;
      for (const m of [w.wram[0], core.wram(0)]) { m[0x960] = 0x18; m[0x961] = 0x02; m[0x967] = 0x32; }
    }; })(),
    policy: scriptedPolicy({}, savedPolicy(1)) },
  // a new game's Stroke round from power-on; in the first aiming menu Start, Up (to Quit), A, "OK to quit this round?":
  // Up (Yes), A: the round ends (wGameMode 0), GolfSessionEnd, the map engine runs map 0 again: the mode select
  { name: "boot_quit", state: "boot_poweron", open: true, noRet: true, run: sh => gameCase(sh),
    policy: pausePolicy([[60, 8], [120, 0x40], [150, 1], [420, 0x40], [450, 1]]) },
  // Give Up on the first stroke (Up twice: row 4): "You can't give up on the 1st stroke." (A), back to aiming; then
  // Start, Give Up, Down, A: Settings... no: B closes the menu; stopped 200 frames after the second aiming menu
  { name: "boot_giveup_first", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 800),
    policy: pausePolicy([[60, 8], [120, 0x40], [140, 0x40], [170, 1], [400, 1]]) },
  // Give Up at the second stroke: "Give up on this hole?" (No first): B (the menu again on Give Up), Give Up again,
  // Up (Yes), A: the strokes become 3 x par (10:488B), the ball is picked up, the scorecard, the next hole; stopped 300
  // frames into its aiming
  { name: "boot_giveup", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => { const h = markLog.findIndex((m, k) => m.n === "hole" && k > 0); const a = h > 0 && markLog.slice(h).find(m => m.n === "aimmenu"); return !!a && frameNow > a.f + 300; }),
    policy: scriptedPolicy({ "aimmenu:2": [[60, 8], [120, 0x40], [140, 0x40], [170, 1], [400, 2], [520, 1], [700, 0x40], [730, 1]] },
      frontEndPolicy) },
  // Quit, then No on "OK to quit this round?": the menu again on Quit; B
  { name: "boot_quit_no", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 800),
    policy: pausePolicy([[60, 8], [120, 0x40], [150, 1], [450, 1], [600, 2]]) },
  // Settings (Down x3, A): Right (Music off), Down, Right (3-D Screen on), Left (off), B: the pause menu again on
  // Settings; B closes it
  { name: "boot_settings", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 900),
    policy: pausePolicy([[60, 8], [130, 0x80], [150, 0x80], [170, 0x80], [200, 1], [340, 0x10], [380, 0x80], [420, 0x10], [460, 0x20], [510, 2], [640, 2]]) },
  // Camera Mode (row 0, A): the look cursor moved Up (held 90 frames: to the green view), Left, then Down and Right; B
  { name: "boot_camera", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 1200),
    policy: (() => { const p = pausePolicy([[60, 8], [140, 1], [700, 2]]); return f => { const b = p(f);
      if (lastMark !== "aimmenu") return b; const d = f - markAt;
      return b | (d >= 250 && d < 340 ? 0x40 : d >= 340 && d < 380 ? 0x20 : d >= 450 && d < 600 ? 0x90 : 0); }; })() },
  // Course Map (Down, A): Up (a club up), Left held (the aim), B (the shot mode), Right, Down; A leaves
  { name: "boot_coursemap", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 1300),
    policy: (() => { const p = pausePolicy([[60, 8], [130, 0x80], [170, 1], [500, 0x40], [600, 2], [700, 0x80], [800, 1]]); return f => { const b = p(f);
      if (lastMark !== "aimmenu") return b; const d = f - markAt;
      return b | (d >= 530 && d < 580 ? 0x20 : d >= 640 && d < 660 ? 0x10 : 0); }; })() },
  // the saved character's Stroke round: Save & Quit (Up: row 5), "Save current progress?" A (Yes): SaveGame, $C2A6 = 1:
  // GolfSessionEnd warps to map 0 entrance 1, the link menu (stopped 10 frames into it); the save RAM compared
  { name: "boot_kid_savequit", state: "boot_poweron_kid", open: true, noRet: true,
    run: sh => { let at = 0; return gameCase(sh, 1, () => roundsDone && hasTask(sh.w, 0x09, 0x4990) && (at = at || frameNow) && frameNow > at + 10); },
    policy: pausePolicy([[60, 8], [120, 0x40], [150, 1], [420, 1]], savedPolicy(3)) },
  // a saved character with game flag #74 (out/kid74.sav: coreplay.mjs --recipe kid74): match play against Luigi is
  // one hole (hole 18); the result screen, the EXP screen (48:4D70 AwardExpPoints after 08:4F03), GolfSessionEnd and the
  // mode select again; the save RAM compared at the end
  { name: "boot_kid74_match_exp", state: "boot_poweron_kid74", open: true, noRet: true, run: sh => gameCase(sh),
    policy: f => { frameNow = f; return savedPolicy2(f); } },
  // the same from the save made after that match (out/kid74b.sav): the EXP reaches level 2, so after the EXP screen
  // the level-up screen (41:402A): A picks Drive, A gives the point, A on Yes, A ends the cheer; then the EXP screen
  // again (message 4) and the mode select
  { name: "boot_kid74b_levelup", state: "boot_poweron_kid74b", open: true, noRet: true, sram: true, run: sh => gameCase(sh),
    policy: f => { frameNow = f; return savedPolicy2(f); } },
  // the same with the EXP set to 100 at the mode select (several levels due): in the level-up screen the cursor, B,
  // the picks and their undo, No on the Yes / No box (start over), B there, and the cheer left to time out
  { name: "boot_kid74b_levelup_keys", state: "boot_poweron_kid74b", open: true, noRet: true, sram: true, run: sh => gameCase(sh),
    hook: expPoke(100), policy: levelUpPolicy([[260, 1], [280, 0x80], [300, 0x80], [320, 0x40], [340, 0x40], [360, 0x40],
      [380, 1], [400, 1], [420, 0x40], [440, 1], [460, 2], [480, 2], [500, 2], [520, 1], [540, 2], [560, 1], [580, 1], [600, 1],
      [620, 1], [640, 1], [660, 0x80], [680, 1], [700, 0x80], [720, 0x40], [740, 0x80], [760, 1], [780, 1], [800, 1], [820, 1],
      [840, 1], [860, 1], [880, 1], [900, 2], [920, 1], [940, 0x80], [960, 1], [980, 1], [1000, 1], [1020, 1], [1040, 1],
      [1060, 1]], savedPolicy2) },
  // a new game's Training (Right once in the mode select): course 1, hole 1 (CourseHoleSelect 0F:4AD6); after the
  // first shot Mulligan (the shot again), after the second Continue, after the third Hole Out: the hole select again
  // (Right, Right, Left: hole 2; B: the course select, Right: course 2, A; its hole select: Down, A: hole 2); there
  // the pause menu (TrainingPauseMenu 41:6EE0): Wind Direction Right twice,
  // Wind Speed Left, Right twice, B; the next time Back to Menu (Up: the last row): the mode select
  { name: "boot_training", state: "boot_poweron", open: true, noRet: true, run: sh => gameCase(sh, 2),
    policy: scriptedPolicy({
      "aftershot:1": [[100, 0x80], [120, 1]],
      "aftershot:2": [[100, 1]],
      "aftershot:3": [[100, 0x80], [120, 0x80], [140, 1]],
      "holesel:2": [[60, 0x10], [80, 0x10], [100, 0x20], [130, 2], [220, 0x10], [320, 1], [420, 0x80], [460, 1]],
      "aimmenu:4": [[60, 8], [100, 0x80], [115, 0x80], [130, 0x80], [160, 0x10], [180, 0x10], [200, 0x80], [220, 0x20],
        [240, 0x10], [260, 0x10], [300, 2]],
      "aimmenu:5": [[60, 8], [100, 0x40], [130, 1]],
    }, frontEndRights(1)) },
  // Training with A every 40 frames until the ball is holed (the 27th shot): Continue / Mulligan / Start Over / Back to
  // Main Menu (41:6F7A): Mulligan (holed again), then Start Over: the hole again; there the pause menu: Settings, B,
  // Hole Out (Up x 3); the hole select (A), the pause menu again: Back to Menu
  { name: "boot_holed_training", state: "boot_poweron", open: true, noRet: true, run: sh => gameCase(sh, 2),
    policy: scriptedPolicy({ "aftershot:27": [[100, 0x80], [120, 1]], "aftershot:28": [[100, 0x80], [120, 0x80], [140, 1]],
      "hole:2": [[160, 8], [200, 0x80], [215, 0x80], [230, 0x80], [245, 0x80], [260, 0x80], [290, 1], [450, 2], [560, 0x40],
        [580, 0x40], [600, 0x40], [630, 1]],
      "hole:3": [[160, 8], [200, 0x40], [230, 1]] }, frontEndRights(1)) },
  // the same into the round, two holes (the saved character's round: SaveGameMidRound at each hole's start), A every
  // 40 frames for the swings
  // Options (32:79D8): the golf dictionary from the index (3F:4002 mode 6): the greeting read, letters moved, a
  // letter's list, rows and letters moved, an explanation read, back to the index, out; B out of Options
  { name: "boot_options_dict", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_OPTIONS, [menu09Items(2), 1],
      [inDict, 0, 100], {press: 1, every: 40, until: dictPage("index")}, [dictPage("index"), 0x10], [null, 0x80], [null, 0x10],
      [null, 0x20], [null, 0x40], [null, 1],
      [dictPage("list"), 0x80], [null, 0x80], [null, 0x80], [null, 0x80], [null, 0x80], [null, 0x80],
      [null, 0x80], [null, 0x40], [null, 0x10], [null, 0x10], [null, 0x20], [null, 0x40],
      [null, 0x40], [null, 1], {press: 1, every: 40, until: dictPage("list")},
      [dictPage("list"), 2], [dictPage("index"), 0x80], [null, 2], [menu09Items(2), 2]]) },
  // the link menu's link game with no cable partner (09:488D): Down, A: $71 asked for (00:306E, two WaitVBlankFlag
  // frames), nobody answers: sound $5D and the menu on; A again, then Up (the first item), A: the character select
  { name: "boot_link_nopartner", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([[menu09Items(4), 0x80], [null, 1], [null, 1, 60], [null, 0x40, 60], [null, 1, 60]]) },
  // the cable lost (a poke: hLinkActive 1 and hLinkIdleCount $20 on both sides once the link menu shows): the next
  // AdvanceFrame gives up (00:2E3F -> 00:2F8D): the Link Lost screen (08:555F) until A, then SoftReset 00:2DAA: the
  // game from the start again (to the link menu)
  { name: "boot_link_lost", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    hook: (f, w, core) => {
      if (f === 0) linkLostAt = -1;
      if (linkLostAt >= 0 || !menu09Items(4)()) return;
      linkLostAt = f;
      w.high[0x1C8] = 1; w.high[0x1C3] = 0x20; core.hram()[0x48] = 1; core.hram()[0x43] = 0x20;
    },
    run: sh => gameCase(sh, 1, () => linkLostAt >= 0 && frameNow > linkLostAt + 3400),
    policy: f => { frameNow = f; return f === 2600 ? 8 : linkLostAt >= 0 && (f === linkLostAt + 200 || f === linkLostAt + 201) ? 1 : 0; } },
  // Options, data management (32:7A0A): copy Kid (to slot 1), erase the copy, erase all answered No, then Yes
  { name: "boot_options_data", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_OPTIONS, [menuReady(2), 0x80], [null, 1],
      [menuReady(3), 1], [inCharSel, 1, 60], [inCharPrompt, 1, 60], [msgOpen, 1, 60],
      [menuReady(3), 0x80], [null, 1], [inCharSel, 0x10, 60], [null, 1], [inCharPrompt, 0x40, 60], [null, 1, 30], [msgOpen, 1, 60],
      [menuReady(3), 0x80], [null, 1], [inMenuCursor, 1, 60],
      [menuReady(3), 1], [inMenuCursor, 0x40, 60], [null, 1, 30], [msgOpen, 1, 120],
      [menuReady(2), 2]]) },
  // Status (0B:4D9D): the records (Down twice, A), the stars (Up, A): courses changed both ways, back out
  { name: "boot_status_stars", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000, hook: recordsPoke(1),
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(3), 0x80], [null, 0x80], [null, 1],
      [menu07Items(5), 0x40], [null, 1], [inTask(0x0C, 0x4821), 0x10, 60], [null, 0x10], [null, 0x20], [null, 0x10], [null, 2],
      [menu07Items(5), 2], [menu07Items(3), 2], [menu09Items(4), 0]]) },
  // Status, a character (Kid): Char. Data, the VS results (0C:65B2), Stars (the event list); B back through the
  // character select and the menu (no records block: the two-item menu)
  { name: "boot_status_char", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(2), 1], [inCharSel, 1, 60],
      [menu07Items(4), 1], [null, 1, 150],
      [menu07Items(4), 0x80], [null, 0x80], [null, 1], [inTask(0x0C, 0x4821), 2, 80],
      [menu07Items(4), 0x80], [null, 1], [null, 2, 150],
      [menu07Items(4), 2], [inCharSel, 2, 60], [menu07Items(2), 2], [menu09Items(4), 0]]) },
  // Status, a character, its stats (0C:4A15 with $D23B = 1): the profile's course records ($C980, 25 bytes x 5) and
  // the hole bits poked with pseudo-random values and #112 #113 set when the four-item menu first shows; the total
  // page, scrolled, the pages both ways
  { name: "boot_status_stats", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    hook: profilePoke(7, [112, 113]),
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(2), 1], [inCharSel, 1, 60],
      [menu07Items(4), 0x80], [null, 1], [inTask(0x0C, 0x4C63), 0x80, 60], ...Array(30).fill([null, 0x80, 1]),
      ...Array(20).fill([null, 0x40, 1]), [null, 0x10, 60], [null, 0x10, 80], [null, 0x10, 80], [null, 0x10, 80],
      [null, 0x20, 80], [null, 0x20, 80], [null, 2, 80],
      [menu07Items(4), 2], [inCharSel, 2, 60], [menu07Items(2), 2], [menu09Items(4), 0]]) },
  // Status, the shot records (0C:67F8) with no saved holes (B only), then with some (save blocks 4-7 poked): the
  // cursor moved every way past the empty slots, B
  { name: "boot_status_shots_empty", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(2), 0x80], [null, 1], [inTask(0x0C, 0x4821), 0x80, 60], [null, 2],
      [menu07Items(2), 2], [menu09Items(4), 0]]) },
  { name: "boot_status_shots", state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000,
    hook: shotsPoke(5, [0x13, 0x04, 0x1A, 0x01]),
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(2), 0x80], [null, 1], [inTask(0x0C, 0x698F), 0x80, 60],
      [null, 0x80], [null, 0x80], [null, 0x10], [null, 0x10], [null, 0x10], [null, 0x40], [null, 0x40], [null, 0x40],
      [null, 0x20], [null, 0x20], [null, 0x80], [null, 0x20], [null, 2],
      [menu07Items(2), 2], [menu09Items(4), 0]]) },
  // the records (a records block poked) item `item` of the five-item menu, then `keys` there, B out
  ...[["ranking", 3, 0x4821, 11], ["winners", 2, 0x61A8, 12], ["bestscore", 1, 0x705D, 13], ["recstats", 0, 0x4C63, 14]].map(([n, item, task, seed]) => ({
    name: `boot_status_${n}`, state: "boot_poweron_kid", open: true, noRet: true, sram: true, maxFrames: 30000, hook: recordsPoke(seed),
    run: sh => { stepsDone = -1; return gameCase(sh, 1, () => stepsDone >= 0 && frameNow > stepsDone + 200); },
    policy: stepPolicy([...TO_STATUS, [menu07Items(3), 0x80], [null, 0x80], [null, 1],
      ...(item ? [[menu07Items(5), 0x80], ...Array(item - 1).fill([null, 0x80]), [null, 1]] : [[menu07Items(5), 1]]),
      [inTask(0x0C, task), 0x10, 80], [null, 0x10, 80], [null, 0x20, 80], [null, 0x20, 80], [null, 0x80, 30], [null, 0x80, 2], [null, 0x40, 30],
      [null, 2, 80], [menu07Items(5), 2], [menu07Items(3), 2], [menu09Items(4), 0]]),
  })),
  { name: "boot_kid_round", state: "boot_poweron_kid", open: true, noRet: true,
    run: sh => (function* () {
      menuW = sh.w;
      const holes = yield* powerOn(sh);
      return (yield* playRoundFrames(sh.w, holes, null, { sh, maxHoles: 2 })).shots.length;
    })(), policy: savedPolicy(3) },
];

// DUMP=frame:bank:addr:len[,...] prints both sides' bytes there at those frames (WRAM bank 0-7, addresses $C000-$DFFF;
// bank h: HRAM $FF80-) (debugging a case)
const dumps = (process.env.DUMP || "").split(",").filter(Boolean).map(s => { const [f, b, a, n] = s.split(":"); return { f: +f, b, a: parseInt(a, 16), n: parseInt(n, 16) }; });
const dumpHook = h => (f, w, core) => {
  if (h) h(f, w, core);
  for (const d of dumps) if (d.f === f) {
    const js = [], game = [];
    for (let i = 0; i < d.n; i++) {
      if (d.b === "h") { js.push(w.high[0x180 + d.a - 0xFF80 + i]); game.push(core.hram()[d.a - 0xFF80 + i]); }
      else { const b = +d.b, o = (d.a & 0xFFF) + i; js.push(w.wram[b][o]); game.push(core.wram(b)[o]); }
    }
    const hx = a => a.map(v => v.toString(16).padStart(2, "0")).join(" ");
    console.log(`frame ${f} ${d.b}:${d.a.toString(16)}\n  js   ${hx(js)}\n  game ${hx(game)}`);
  }
};
let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  if (shard && CASES.indexOf(c) % shard[1] !== shard[0]) continue;
  const stateFile = `out/state_${c.state || c.name}.json`;
  if (!fs.existsSync(path.join(root, stateFile))) {
    console.log(`skip ${c.name}: no ${stateFile} (node web/tests/golf/mkstate.mjs --name ${c.round} --at ${c.at} --out ${stateFile})`);
    continue;
  }
  let r;
  try { r = runScreen({ stateFile, run: c.run, policy: c.policy, maxFrames: c.maxFrames, hook: dumpHook(c.hook), verbose, open: c.open, setRegs: c.regs, jumps: c.jumps, trace: process.argv.includes("--trace") }); }
  catch (e) { console.log(`FAIL ${c.name}: ${e.stack}`); bad++; continue; }
  if (c.open) r.sounds.core = r.sounds.core.filter(x => +x.split(":")[0] < r.frames);   // (the game's next frame's)
  const sounds = r.sounds.core.join(" ") === r.sounds.native.join(" ");
  // (an open routine's end is compared with the core already into its next frame's code: listed, not failed)
  const ok = !r.bad.length && (c.open || !r.end.length) && sounds && (c.noRet || r.native === r.coreA);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: ${r.frames} frames, ${r.pixelExact} pixel-exact, ${r.modelExact} with the display state equal, ` +
    `${r.lag} differing after lag frames, ${r.bad.length} other; returned ${r.native} (game ${r.coreA}); sounds ${sounds ? "the same" : `differ: game ${r.sounds.core.join(" ")} / js ${r.sounds.native.join(" ")}`}`);
  for (const b of r.bad.slice(0, 5)) console.log(`    frame ${b.frame}: ${b.px} px; ${b.out.join("; ")}`);
  for (const e of r.end) console.log(`    at the end: ${e}`);
}
process.exit(bad ? 1 : 0);
