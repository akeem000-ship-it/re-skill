// The EXP award screen's sequence and the match-end rewards (bank $1E): each pending award's message, its amount
// counted into the running total point by point (A / B adds the rest at once), then a wait (A / B or 3 seconds);
// and ProcessMatchRewards, run after every match, drill and minigame: the EXP earned (match statistics, the score,
// first-clear rewards), shown and shared out, the reward and unlock flags, the Island Open board, the minigame
// records, and the story file saved.
// Port of the code of src/engine/menus/exp/award_sequence_1e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
// Covered by the lockstep on out/engine/rec2.mtrec (a minigame) and the out/port/xr_* recordings.
import {
  FZ, FH, u8, w8, rd, wr, ix, far, farGen, hook, hookGen, rom, home, HOME, FAR, sound, advanceFrame, waitFrames,
  queueVRAMCopy, romWord, testFlag, BANK_EXP, BANK_EXP_DISTRIBUTE, BANK_CHAR_DATA, BANK_SAVE, BANK_BOOT, WRAM_COURT_PLANES,
  WRAM_SCREEN, WRAM_SCENE, WRAM_ACTORS, WRAM_TEXT, VRAM_BANK1, vBGMap0, wShadowTilemap, wScreenAttrmap, TILEMAP_WIDTH,
  PADF_A, PADF_B, BGM_NONE, BGM_EXP_AWARD, SFX_MENU_MOVE, SFX_MENU_SELECT, GAMEMODE, FLAG, SAVEFLAG, WINLOSE_WIN,
  WINLOSE_LOSE, LINKSTATE_SLAVE, addHLFlags, farcallWait, RunExpDistributionFlow, CharDataScreen_Show,
} from "./defs.js";
import { enableLCD } from "../../home/system.js";
import { mulHLByAFracSigned, divAHLByE } from "../../home/math.js";
import { saveStorySlot, setSaveFlag } from "../../save/storyslots.js";
import { loadMenuFontGfx } from "../main_menu/boot.js";
import { drawNextExpAwardMessage } from "./award_screen.js";
import {
  getScoreBonus, computeMatchStatsReward, applyMatchSettingsExpBonus, awardExhibitionMatchExp, awardLinkedPlayMatchExp,
  showExpAwardForMinigame, showExpAwardForMatch,
} from "./award_calc.js";
import {
  applyStatGapProgressFlag, applyClassProgressFlags, setRewardGameFlag, testRewardGameFlag, getRewardTableIndex,
  applyRewardUnlockFlags, setMinigameClearFlag, updateMinigameBestScore, checkAllProgressComplete,
  showIslandOpenRankingBoard,
} from "./reward.js";

export const BANK = BANK_EXP;
const FirstClearExpTablePtrs_1e = 0x66F7;                            // the first-clear EXP by match list and number
const hInputRisingEdge = 0xFF94;
const CONFIRM_TIMEOUT = 0xB4, AWARD_WAIT = 10, MAX_SCORE = 0x270F;
const DIGIT_TILE_BASE = 0x6C, DIGIT_ATTR = 0x08;

// GetDigitSpriteTile (1E:5AFA): digit a's sprite: tile (a - '0') * 2 + $6C, attribute 8
export function getDigitSpriteTile(a) {
  const d = (a - 0x30) & 0xFF, c = ((((d << 1) | (d >> 7)) & 0xFF) + DIGIT_TILE_BASE) & 0xFF;
  return { a: c, b: DIGIT_ATTR, c };
}
// RunExpAwardSequence (1E:5B03): the pending awards one after another
export function* runExpAwardSequence(P) {
  for (;;) {
    P.wramBank(WRAM_SCENE);
    yield* advanceFrame(P);
    const r = yield* beginNextExpAward(P);
    if (!r.a) return r;
    yield* countUpExpTotal(P);
    yield* waitForConfirmOrTimeout(P);
  }
}
// BeginNextExpAward (1E:5B19): the next award's message (DrawNextExpAwardMessage) with the award jingle, its amount
// to count (wExpAwardAmount), the message rows queued. Returns a = 1, or 0 (after 10 frames) when none is left.
export function* beginNextExpAward(P) {
  const m = yield* drawNextExpAwardMessage(P);
  if (!m.a) { yield* waitFrames(P, AWARD_WAIT); return { a: 0, f: FZ }; }
  sound(P, BGM_NONE);
  sound(P, BGM_EXP_AWARD);
  P.wramBank(WRAM_SCENE);
  wr(P, "expAwardIndex", rd(P, "expAwardIndex") + 1);
  wr(P, "expAwardMessageTimer", 0);
  wr(P, "expAwardAmount", m.bc & 0xFF); wr(P, "expAwardAmount", m.bc >> 8, 1);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, 4 * TILEMAP_WIDTH / 16);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, 4 * TILEMAP_WIDTH / 16);
  return { a: 1 };
}
// CountUpExpTotal (1E:5B66): the award's amount moved into the running total one point every two frames (with a
// tick); A or B adds what is left at once
export function* countUpExpTotal(P) {
  for (;;) {
    P.wramBank(WRAM_SCENE);
    const amount = P.bus.u16(P.A.expAwardAmount);
    if (!amount) return { a: 0, f: FZ };
    let pressed = false;
    for (let i = 0; i < 2 && !pressed; i++) {
      yield* advanceFrame(P);
      pressed = (P.bus.u8(hInputRisingEdge) & (PADF_A | PADF_B)) !== 0;
    }
    const total = P.bus.u16(P.A.expAwardRunningTotal);
    if (pressed) {                                                   // .step
      P.bus.w16(P.A.expAwardRunningTotal, total + amount);
      sound(P, SFX_MENU_SELECT);
      return { de: (total + amount) & 0xFFFF };
    }
    P.bus.w16(P.A.expAwardAmount, amount - 1);
    P.bus.w16(P.A.expAwardRunningTotal, total + 1);
    sound(P, SFX_MENU_MOVE);
  }
}
// WaitForConfirmOrTimeout (1E:5BAD): until A or B, at most $B4 frames
export function* waitForConfirmOrTimeout(P) {
  for (let c = CONFIRM_TIMEOUT; c; c--) {
    yield* advanceFrame(P);
    const a = P.bus.u8(hInputRisingEdge) & (PADF_A | PADF_B);
    if (a) return { a, c };
  }
  return { a: 0, c: 0, f: FZ };
}
// HasPendingExpAwards (1E:5BBB): a = 1 when one of the five pending amounts (read through the WRAM bank mapped) is
// not 0
export function hasPendingExpAwards(P) {
  let hl = P.A.pendingExpAwardAmounts;
  for (let k = 0; k < 5; k++) {
    const lo = P.bus.u8(hl), d = P.bus.u8(hl + 1);
    hl = (hl + 2) & 0xFFFF;
    if (lo | d) return { a: 1, d, hl };
  }
  return { a: 0, f: FZ, d: P.bus.u8(hl - 1), hl };
}

// ProcessMatchRewards (1E:6534): after a match (not one left, nor one whose statistics are kept), by game mode:
//   - a Mario minigame: its best score and clear flag;
//   - a drill won: its first-clear EXP, shown, its reward flag;
//   - the tennis machine / wall practice: score x 15 (x 30 at the wall) / 100 x the settings' bonus, the first-clear
//     EXP (a high-score run: only at the 9999 cap once mastered) and the score bonus, shown;
//   - a story, ranking, Island Open, practice or dream match: the statistics' EXP x the bonus (+ the first-clear EXP
//     when won), shown; when won its reward, unlock and class flags;
//   - an exhibition / link match: the statistics' EXP, stored in the story file that played (AwardExhibitionMatchExp
//     / AwardLinkedPlayMatchExp; a link win, or the second player's loss, x 1.5) — and nothing more;
// then the EXP shared out and both characters' data screens, the Island Open board, the dream-match unlocks, the Star
// court check, and the story file saved (with the play time). wGameMode is GAMEMODE_NONE afterwards.
export function* processMatchRewards(P) {
  if (P.V.matchExitRequest) return { a: P.V.matchExitRequest };
  if (P.V.keepMatchStatsFlag) return { a: P.V.keepMatchStatsFlag };
  home(P, HOME.DisableLCDSafely);
  far(P, BANK_BOOT, () => loadMenuFontGfx(P));
  enableLCD(P);
  let hl = 0;
  const mode = P.V.gameMode;
  if (mode === GAMEMODE.MARIO_MINIGAME) {                            // .updateMinigameBestScore
    updateMinigameBestScore(P);
    if (P.V.pointWinLoseFlag !== WINLOSE_WIN) return {};
    return setMinigameClearFlag(P);
  }
  if (mode === GAMEMODE.LINK_MATCH) return yield* linkMatchRewards(P);
  if (mode === GAMEMODE.EXHIBITION) {                                // .eq04
    P.wramBank(WRAM_ACTORS);
    hl = computeMatchStatsReward(P, 0).hl;
    hl = applyMatchSettingsExpBonus(P, hl, P.V.player1MainEquipment).hl;
    return yield* awardExhibitionMatchExp(P, hl);
  }
  if (mode === GAMEMODE.TENNIS_MACHINE || mode === GAMEMODE.WALL_PRACTICE) {
    if (!P.V.matchExitRequest) hl = yield* scoreRewards(P, mode);    // .checkMatchExitRequest
  } else if (mode === GAMEMODE.DREAM_MATCH || mode < GAMEMODE.EXHIBITION) {   // .computeMatchStatsReward
    P.wramBank(WRAM_ACTORS);
    hl = computeMatchStatsReward(P, 0).hl;
    hl = applyMatchSettingsExpBonus(P, hl, P.V.player1MainEquipment).hl;
    const won = P.V.matchWinLoseFlag === WINLOSE_WIN;
    hl = (hl + (won ? getFirstClearRewardExp(P).de : 0)) & 0xFFFF;
    yield* showExpAwardForMatch(P, hl);
    if (P.V.matchWinLoseFlag === WINLOSE_WIN) {
      setRewardGameFlag(P);
      applyRewardUnlockFlags(P);
      applyClassProgressFlags(P);
    }
  } else if (P.V.pointWinLoseFlag === WINLOSE_WIN) {                // a drill won
    const de = getFirstClearRewardExp(P).de;
    yield* showExpAwardForMinigame(P, de);
    hl = de;
    setRewardGameFlag(P);
  }
  if (hl) {                                                          // .runExpDistributionFlow
    // (through the ROM's addresses, with the ROM's stack: the screens keep stack addresses; menus/char_data runs
    // them where it is hooked)
    yield* farcallWait(P, RunExpDistributionFlow, { hl });
    yield* farcallWait(P, CharDataScreen_Show, { c: 0 });
    yield* farcallWait(P, CharDataScreen_Show, { c: 1 });
    applyStatGapProgressFlag(P);
  }
  yield* showIslandOpenRankingBoard(P);                              // .showIslandOpenRankingBoard
  P.V.gameMode = GAMEMODE.NONE;
  if (testFlag(P, FLAG.WON_DREAM_MATCH_SINGLES)) far(P, BANK_SAVE, () => setSaveFlag(P, SAVEFLAG.UNLOCKED_SAMMI));
  if (testFlag(P, FLAG.WON_DREAM_MATCH_DOUBLES)) far(P, BANK_SAVE, () => setSaveFlag(P, SAVEFLAG.UNLOCKED_ELDEN));
  checkAllProgressComplete(P);
  return far(P, BANK_SAVE, () => saveStorySlot(P, { withTimer: true }));
}
// the tennis machine and wall practice: the score's EXP, the bonuses, shown; returns it (hl)
function* scoreRewards(P, mode) {
  const score = P.bus.u16(P.A.minigamesCurrentScore);
  const r = mulHLByAFracSigned(P, score, mode === GAMEMODE.WALL_PRACTICE ? 0x1E : 0x0F);
  // a:hl = the 24-bit product (whole part's two bytes, then the fraction) / 100
  let hl = divAHLByE(P, r.hl >> 8, ((r.hl & 0xFF) << 8) | r.a, 0x64).hl;
  hl = applyMatchSettingsExpBonus(P, hl, P.V.player1MainEquipment).hl;
  if (P.V.pointWinLoseFlag === WINLOSE_WIN) {
    let firstClear = true;
    if (P.V.minigameHighScoreMode) {
      const mastered = testFlag(P, mode === GAMEMODE.TENNIS_MACHINE ? FLAG.CLEARED_MACHINE_MASTER : FLAG.CLEARED_WALL_MASTER);
      if (mastered && score !== MAX_SCORE) firstClear = false;
    }
    if (firstClear) {                                                // .getFirstClearRewardExp
      hl = (hl + getFirstClearRewardExp(P).de) & 0xFFFF;
      setRewardGameFlag(P);
    }
  }
  hl = (hl + getScoreBonus(P).de) & 0xFFFF;                          // .getScoreBonus
  yield* showExpAwardForMinigame(P, hl);
  return hl;
}
// .eq09: a link match: this player's statistics (character 0, or 1 for the second player) x the bonus; a win
// (the second player: a loss of the first) x 1.5; stored by AwardLinkedPlayMatchExp
function* linkMatchRewards(P) {
  const second = P.V.linkMatchRole === LINKSTATE_SLAVE;
  P.wramBank(second ? WRAM_TEXT : WRAM_ACTORS);
  let hl = computeMatchStatsReward(P, 0).hl;
  hl = applyMatchSettingsExpBonus(P, hl, second ? P.V.player2MainEquipment : P.V.player1MainEquipment).hl;
  if (P.V.matchWinLoseFlag === (second ? WINLOSE_LOSE : WINLOSE_WIN)) {   // .step6
    const half = ((hl >> 1) | (hl & 0x8000)) & 0xFFFF;
    hl = (hl + half) & 0xFFFF;
  }
  return yield* awardLinkedPlayMatchExp(P, hl);
}
// GetFirstClearRewardExp (1E:66D2): the match's first-clear EXP (de; 0 once its reward flag is set), from
// FirstClearExpTablePtrs_1e by match list and GetRewardTableIndex. hl kept.
export function getFirstClearRewardExp(P) {
  const t = testRewardGameFlag(P);
  if (!(t.f & FZ)) return { ...t, de: 0 };
  const table = romWord(P, ix(FirstClearExpTablePtrs_1e, P.bus.u8(P.A.currentMinigameStoryMatch) * 2));
  const at = ix(table, getRewardTableIndex(P).a * 2);
  return { a: P.bus.u8(at), de: romWord(P, at) };
}

export const HOOKS = [
  [BANK, 0x5AFA, hook((P, c) => getDigitSpriteTile(c.a))],
  [BANK, 0x5B03, hookGen(P => runExpAwardSequence(P))],
  [BANK, 0x5B19, hookGen(P => beginNextExpAward(P))],
  [BANK, 0x5B66, hookGen(P => countUpExpTotal(P))],
  [BANK, 0x5BAD, hookGen(P => waitForConfirmOrTimeout(P))],
  [BANK, 0x5BBB, hook(P => hasPendingExpAwards(P))],
  [BANK, 0x6533, () => {}],                                          // StubNop_1e: ret
  [BANK, 0x6534, hookGen(P => processMatchRewards(P))],
  [BANK, 0x66D2, hook(P => getFirstClearRewardExp(P))],
];
