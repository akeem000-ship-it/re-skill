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

// the game from power-on through rounds (boot.js gameFromPowerOn, game.js playRoundFrames), the marks the native
// engine passes noted; it stops when the mode select's input runs again after `rounds` rounds, or when stop() says
let lastMark = "", markAt = 0, roundsDone = 0, frameNow = 0;
function gameCase(sh, rounds = 1, stop = () => false) {
  menuW = sh.w; lastMark = ""; roundsDone = 0;
  const m = sh.mark.bind(sh);
  sh.mark = n => { if (n !== lastMark) markAt = frameNow; lastMark = n; m(n); };
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
  // power-on with a save RAM the game made (a new character "Kid" created, saved at the mode select; out/kid.sav from
  // web/tests/golf/coreplay.mjs, then boottrace.mjs --sram out/kid.sav --save-at 00:0100): slot 0 loaded
  // (SaveBlockLoad, MapWarpToReturnPoint), SaveGame, the mode select with a save file, Stroke, course 1
  { name: "boot_poweron_kid_stroke", state: "boot_poweron_kid", open: true, noRet: true, sram: true,
    run: sh => { menuW = sh.w; return powerOn(sh); }, policy: savedPolicy(3) },
  // Match (Right twice), Luigi, course 1
  { name: "boot_poweron_kid_match", state: "boot_poweron_kid", open: true, noRet: true,
    run: sh => { menuW = sh.w; return powerOn(sh); }, policy: savedPolicy(2) },
  // a new game's Stroke round from power-on; in the first aiming menu Start, Up (to Quit), A, "OK to quit this round?":
  // Up (Yes), A: the round ends (wGameMode 0), GolfSessionEnd, the map engine runs map 0 again: the mode select
  { name: "boot_quit", state: "boot_poweron", open: true, noRet: true, run: sh => gameCase(sh),
    policy: pausePolicy([[60, 8], [120, 0x40], [150, 1], [420, 0x40], [450, 1]]) },
  // Give Up on the first stroke (Up twice: row 4): "You can't give up on the 1st stroke." (A), back to aiming; then
  // Start, Give Up, Down, A: Settings... no: B closes the menu; stopped 200 frames after the second aiming menu
  { name: "boot_giveup_first", state: "boot_poweron", open: true, noRet: true,
    run: sh => gameCase(sh, 1, () => lastMark === "aimmenu" && frameNow > markAt + 800),
    policy: pausePolicy([[60, 8], [120, 0x40], [140, 0x40], [170, 1], [400, 1]]) },
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
  // the same into the round, two holes (the saved character's round: SaveGameMidRound at each hole's start), A every
  // 40 frames for the swings
  { name: "boot_kid_round", state: "boot_poweron_kid", open: true, noRet: true,
    run: sh => (function* () {
      menuW = sh.w;
      const holes = yield* powerOn(sh);
      return (yield* playRoundFrames(sh.w, holes, null, { sh, maxHoles: 2 })).shots.length;
    })(), policy: savedPolicy(3) },
];

let bad = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  const stateFile = `out/state_${c.state || c.name}.json`;
  if (!fs.existsSync(path.join(root, stateFile))) {
    console.log(`skip ${c.name}: no ${stateFile} (node web/tests/golf/mkstate.mjs --name ${c.round} --at ${c.at} --out ${stateFile})`);
    continue;
  }
  let r;
  try { r = runScreen({ stateFile, run: c.run, policy: c.policy, verbose, open: c.open, setRegs: c.regs, trace: process.argv.includes("--trace") }); }
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
