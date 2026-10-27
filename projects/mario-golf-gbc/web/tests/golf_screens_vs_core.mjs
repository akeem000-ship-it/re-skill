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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
const verbose = process.argv.includes("--verbose");
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
      if (s.press !== undefined) {
        if (until < 0) until = f;
        if (f < until) return 0;
        if (s.until ? s.until() : presses >= s.times) { presses = 0; until = -1; k++; continue; }
        presses++; until = f + s.every;
        return s.press;
      }
      const [x, y, xw, yw] = pos();
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
  const policy = f => { const v = policy0(f); if (process.env.ROUTE > 1) console.error("KEY", f, v, stuck, swap, JSON.stringify(route && route.slice(0, 2))); return v; };
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

// name, the state (round, routine), the native routine, buttons
const CASES = [
  { name: "standings_match18", round: "match18", at: "3E:403F", run: sh => inBank(sh, 0x3E, matchStandingsScreen(sh)) },
  // the scorecard in match play (0E:43D6): Right on the standings page turns to the hole-by-hole card (0E:762F),
  // Left there back, A leaves
  { name: "scorecard_match18", round: "match18", at: "0E:43D6", run: sh => inBank(sh, 0x0E, showScorecard(sh)), noRet: true,
    policy: f => (f === 30 ? 0x10 : f === 70 ? 0x20 : f === 110 ? 0x10 : f > 150 && f & 1 ? 1 : 0) },
  { name: "result_match18", round: "match18", at: "0B:59DE", run: (sh, r) => inBank(sh, 0x0B, roundResultScreen(sh, r.a)),
    policy: f => (f > 120 && f & 1 ? 1 : 0) },
  // the pause menu (08:4666, made with web/tests/golf/mkstate_core.mjs --via 10:5BA6 --wait 60 --press 08 --at
  // 08:4666): B closes it; Down / Up move the cursor (wrapping), Start closes it; Scorecard (A on row 2), then A
  { name: "pause_r18_b", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))), policy: f => (f === 60 ? 2 : 0) },
  { name: "pause_r18_move", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))),
    policy: f => (f === 40 || f === 50 ? 0x80 : f === 60 || f === 70 || f === 80 ? 0x40 : f === 120 ? 8 : 0) },
  { name: "pause_r18_scorecard", state: "pause_r18", run: sh => onHole(sh, inBank(sh, 0x08, pauseMenu(sh))),
    policy: f => (f === 40 || f === 50 ? 0x80 : f === 70 ? 1 : f > 150 && f & 1 ? 1 : 0) },
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
  // the clubhouse's top door (trigger 2, 32:5C09) to the Caddie Master's office (map $08, 33:4722): his call
  // (trigger 1, 33:4BD3), the round menu (33:5166)
  { name: "boot_kid_story_office", state: "boot_poweron_kid", open: true, noRet: true, sram: true, hook: flagPoke(72),
    ...routeCase(savedPolicy(0), [{ to: [0x1A, 0x02], map: 0x08 },
      [200, 0], { to: [0x1A, 0x0A] }, { press: 1, every: 40, until: () => roundsDone >= 1 && menuW.wram[0][0x450] === 0x08 },
      { press: 1, every: 40, times: 20 }], 300) },
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
  const stateFile = `out/state_${c.state || c.name}.json`;
  if (!fs.existsSync(path.join(root, stateFile))) {
    console.log(`skip ${c.name}: no ${stateFile} (node web/tests/golf/mkstate.mjs --name ${c.round} --at ${c.at} --out ${stateFile})`);
    continue;
  }
  let r;
  try { r = runScreen({ stateFile, run: c.run, policy: c.policy, hook: dumpHook(c.hook), verbose, open: c.open, setRegs: c.regs, trace: process.argv.includes("--trace") }); }
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
