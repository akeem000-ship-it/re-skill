// What a win unlocks (bank $1E): the reward flag of the match or drill just won (by its match list and number), the
// class and racket unlocks it brings, the minigames' clear flags and best scores, the N64 trophies' EXP (four tiers a
// trophy group, each paid once: a game flag), the Island Open ranking board after a round, and the "everything
// done" check that opens the Star court.
// Port of the code of src/engine/menus/exp/reward_1e.asm and trophy_1e.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Flag lists and tables are read from
// the ROM.
// Covered by the lockstep on out/engine/rec2.mtrec and the out/port/xr_* recordings (story wins, a drill).
import {
  FZ, FH, u8, ix, far, farGen, hook, hookGen, romWord, romByte, testFlag, setFlag, testGameFlag, setGameFlag,
  testFlagF, BANK_EXP, BANK_SAVE, BANK_RANKING, BANK_EXP_DISTRIBUTE, WRAM_SCENE, WRAM_SOUND, GAMEMODE, FLAG, SAVEFLAG,
  WINLOSE_WIN, MATCHLIST_TRAINING, MINIGAME_TENNIS_MACHINE_HIGH_SCORE, MINIGAME_BOO_BLAST, MINIGAME_SHOOTING_STAR,
  MINIGAME_TARGET_SHOT, MINIGAME_BANANA_BUNCH,
} from "./defs.js";
import { setSaveFlag } from "../../save/storyslots.js";
import { readMinigameRecord, updateMinigameRecord } from "../../save/saveslots.js";
import { setPendingExpAward } from "./distribute.js";
import { showRankingBoard } from "../ranking/board.js";

export const BANK = BANK_EXP;
// ROM data (bank $1E)
const RewardFlagListPtrs_1e = 0x6D14;                               // the reward flags by match list (0-2)
const AllProgressFlagList_1e = 0x6D82;                              // (read on through RewardFlagListMode2_1e)
const RewardUnlockFlagTable = 0x6E63, RewardUnlockFlagsTable = 0x6E7D;
const MinigameClearFlagTable_1e = 0x6F02;
const TrophyExpValueTable = 0x67A7, TrophyExpTierFlags = 0x7227;
const TrophyExpGroupThresholds = 0x7257, TrophyExpGroupMasks = 0x725D;
const ALL_PROGRESS_FLAGS = 0x24, REWARD_UNLOCK_ROWS = 0x0D, TROPHY_GROUPS = 6, MINIGAMES_WITH_RECORDS = 9;
const STAT_GAP_FOR_DRIVE_RACKET = 5, BEST_SCORE_LEVEL = 2, FIRST_MINIGAME_RECORD = 2;
const PENDING_TROPHY = 4;
const word = (P, name) => P.bus.u16(P.A[name]);

// ApplyStatGapProgressFlag (1E:6C62): after the senior singles rank 1, spin 5 or more above power gives the drive racket
export function applyStatGapProgressFlag(P) {
  if (!testFlag(P, FLAG.WON_SENIOR_SINGLES_RANK_1)) return { f: FZ | FH };
  const gap = (P.V.storyMainCharSpinLevel - P.V.storyMainCharPowerLevel) & 0xFF;
  if (gap & 0x80 || gap < STAT_GAP_FOR_DRIVE_RACKET) return { a: gap };
  setFlag(P, FLAG.HAVE_DRIVE_RACKET);
  return { a: gap };
}
// ApplyClassProgressRule1-3 (1E:6C7C / 6C86 / 6C93): a class's rank-1 (varsity: rank-4) win brings its rackets and shoes
const RULES = [[FLAG.WON_JUNIOR_SINGLES_RANK_1, [FLAG.HAVE_LARGE_RACKET]],
  [FLAG.WON_SENIOR_SINGLES_RANK_1, [FLAG.HAVE_SMALL_RACKET, FLAG.HAVE_LIGHT_SHOES]],
  [FLAG.WON_VARSITY_SINGLES_RANK_4, [FLAG.HAVE_IRON_RACKET, FLAG.HAVE_IRON_SHOES]]];
export function applyClassProgressRule(P, rule) {
  const [won, unlocks] = RULES[rule];
  const set = testFlag(P, won);
  if (set) for (const f of unlocks) setFlag(P, f);
  return { f: testFlagF(set) };
}
// ApplyClassProgressFlags (1E:6CA0): the three rules
export function applyClassProgressFlags(P) {
  let r;
  for (let i = 0; i < RULES.length; i++) r = applyClassProgressRule(P, i);
  return r;
}
// the reward flag of the match just played: its list's entry (wCurrentMinigameStoryMatch: list, number) at
// GetRewardTableIndex
function rewardFlagId(P) {
  const list = romWord(P, ix(RewardFlagListPtrs_1e, P.V.currentMinigameStoryMatch * 2));
  return romWord(P, ix(list, getRewardTableIndex(P).a * 2));
}
// SetRewardGameFlag (1E:6CAA): the match's reward flag set. Registers kept.
export function setRewardGameFlag(P) { setGameFlag(P, rewardFlagId(P)); }
// TestRewardGameFlag (1E:6CD1): whether it is set (the flags of TestGameFlag; a = the flag id's low byte)
export function testRewardGameFlag(P) {
  const id = rewardFlagId(P);
  return { a: id & 0xFF, f: testFlagF(testGameFlag(P, id)) };
}
// GetRewardTableIndex (1E:6CF6): the match's number; for the training list's machine and wall high-score drills
// ($1A, $1B) two further on once their master level is cleared
export function getRewardTableIndex(P) {
  const list = P.V.currentMinigameStoryMatch, a = u8(P, P.A.currentMinigameStoryMatch + 1);
  if (list !== MATCHLIST_TRAINING || a < MINIGAME_TENNIS_MACHINE_HIGH_SCORE) return { a };
  const master = a === MINIGAME_TENNIS_MACHINE_HIGH_SCORE ? FLAG.CLEARED_MACHINE_MASTER : FLAG.CLEARED_WALL_MASTER;
  return { a: testFlag(P, master) ? (a + 2) & 0xFF : a };
}
// ApplyRewardUnlockFlags (1E:6E1C): RewardUnlockFlagsTable's 13 rows of two flags: a row with one of its flags set
// sets the row's unlock flag (RewardUnlockFlagTable)
export function applyRewardUnlockFlags(P) {
  let hl = RewardUnlockFlagsTable;
  for (let c = 0; c < REWARD_UNLOCK_ROWS; c++) {
    for (let k = 0; k < 2; k++) {
      const de = romWord(P, hl);
      hl = (hl + 2) & 0xFFFF;
      if (de && testGameFlag(P, de)) setRewardUnlockFlag(P, c);
    }
  }
  return { b: 0, c: REWARD_UNLOCK_ROWS, hl };
}
// SetRewardUnlockFlag (1E:6E50): unlock flag c
export function setRewardUnlockFlag(P, c) {
  const de = romWord(P, ix(RewardUnlockFlagTable, c * 2));
  setGameFlag(P, de);
  return { a: de & 0xFF, d: 0, e: de >> 8 };
}
// SetMinigameRecordSaveFlag (1E:6EB1): a best score in Shooting Star, Target Shot or Banana Bunch opens a court
export function setMinigameRecordSaveFlag(P) {
  const a = u8(P, P.A.currentMinigameStoryMatch + 1);
  const court = { [MINIGAME_SHOOTING_STAR]: SAVEFLAG.COURT_CASTLE, [MINIGAME_TARGET_SHOT]: SAVEFLAG.COURT_TROPICS,
    [MINIGAME_BANANA_BUNCH]: SAVEFLAG.COURT_JUNGLE }[a];
  if (court !== undefined) far(P, BANK_SAVE, () => setSaveFlag(P, court));
  return { a };
}
// SetMinigameClearFlag (1E:6EDC): the save flag of the minigame (from Boo Blast on) cleared at wMinigameLevel
// (MinigameClearFlagTable_1e: three levels a minigame)
export function setMinigameClearFlag(P) {
  const k = (u8(P, P.A.currentMinigameStoryMatch + 1) - MINIGAME_BOO_BLAST) & 0xFF;
  if (k & 0x80) return { a: k };
  const k2 = (k * 2) & 0xFF;
  let hl = ix(k2 * 2, k2);                                           // 6 bytes a minigame
  hl = ix(hl, P.V.minigameLevel * 2);
  hl = (hl + MinigameClearFlagTable_1e) & 0xFFFF;
  const de = romWord(P, hl);
  far(P, BANK_SAVE, () => setSaveFlag(P, de));
  return { a: romByte(P, hl), hl: (hl + 1) & 0xFFFF, d: 0, e: de >> 8 };
}
// UpdateMinigameBestScore (1E:6F38): at the top level, a minigame's score above its record (as signed 16-bit) becomes
// the record (saved), and SetMinigameRecordSaveFlag. The WRAM bank kept.
export function updateMinigameBestScore(P) {
  const bank = P.V.wramBank, k = (u8(P, P.A.currentMinigameStoryMatch + 1) - MINIGAME_BOO_BLAST) & 0xFF;
  if (P.V.minigameLevel === BEST_SCORE_LEVEL && !(k & 0x80) && k < MINIGAMES_WITH_RECORDS) {
    far(P, BANK_SAVE, () => readMinigameRecord(P, k + FIRST_MINIGAME_RECORD));
    P.wramBank(WRAM_SOUND);
    const record = P.bus.u16(P.A.minigameRecordValue), score = word(P, "minigamesCurrentScore");
    if ((record - score) & 0x8000) {
      P.bus.w16(P.A.minigameRecordValue, score);
      far(P, BANK_SAVE, () => updateMinigameRecord(P, k + FIRST_MINIGAME_RECORD));
      setMinigameRecordSaveFlag(P);
    }
  }
  P.wramBank(bank);
  return { a: bank };
}

// ---- trophies and progress ----
// CheckAllProgressComplete (1E:6F8D): the 36 flags from AllProgressFlagList_1e all set: the Star court. Registers kept.
export function checkAllProgressComplete(P) {
  for (let i = 0; i < ALL_PROGRESS_FLAGS; i++) if (!testGameFlag(P, romWord(P, AllProgressFlagList_1e + 2 * i))) return;
  far(P, BANK_SAVE, () => setSaveFlag(P, SAVEFLAG.COURT_STAR));
}
// ShowIslandOpenRankingBoard (1E:6FB2): after an Island Open round, the ranking board (SetupRankingBoardArgs)
export function* showIslandOpenRankingBoard(P) {
  if (P.V.gameMode !== GAMEMODE.ISLAND_OPEN) return { a: P.V.gameMode };
  const { b, c, d } = setupRankingBoardArgs(P);
  return yield* farGen(P, BANK_RANKING, showRankingBoard(P, b, c, d));
}
// SetupRankingBoardArgs (1E:6FBF): b = doubles (the match list's bit 0), c = the round's row (from match $13 on),
// d = 1 won / 2 lost
export function setupRankingBoardArgs(P) {
  const b = P.V.currentMinigameStoryMatch & 0x01, round = (u8(P, P.A.currentMinigameStoryMatch + 1) - 0x13) & 0xFF;
  const c = b ? (round + 3) & 0x03 : (round + 4) & 0x07;
  return { b, c, d: P.V.matchWinLoseFlag === WINLOSE_WIN ? 1 : 2 };
}
// GetTrophyExpValue (1E:6FEB): bc = the EXP of trophy group a's tier at byte b (0, 4, 2, 6) of TrophyExpValueTable
export function getTrophyExpValue(P, a, b) {
  const hl = ix(TrophyExpValueTable, ((a * 8) + b) & 0xFF);
  return { a: romByte(P, hl), bc: romWord(P, hl), hl: (hl + 1) & 0xFFFF };
}
// ComputeTrophyExpAwards (1E:6FFB): the EXP of every trophy tier newly reached (ComputeTrophyExpForGroup for the six
// groups), by group (wTrophyExpGroup0, wTrophyExpByGroup) and in all (wTrophyExpTotal, and hl). Registers but hl and
// the WRAM bank kept.
export function computeTrophyExpAwards(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCENE);
  let hl = 0;
  for (let g = 0; g < TROPHY_GROUPS; g++) {
    const bc = computeTrophyExpForGroup(P, g).bc;
    P.bus.w16(g ? P.A.trophyExpByGroup + 2 * (g - 1) : P.A.trophyExpGroup0, bc);
    hl = (hl + bc) & 0xFFFF;
  }
  P.bus.w16(P.A.trophyExpTotal, hl);
  P.wramBank(bank);
  return { hl };
}
// UnusedSetPendingTrophyExpAwards (1E:7065): each group's trophy EXP as a pending award (variant = the group); nothing
// calls it
export function unusedSetPendingTrophyExpAwards(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCENE);
  for (let g = 0; g < TROPHY_GROUPS; g++) {
    const de = P.bus.u16(g ? P.A.trophyExpByGroup + 2 * (g - 1) : P.A.trophyExpGroup0);
    if (de) far(P, BANK_EXP_DISTRIBUTE, () => setPendingExpAward(P, PENDING_TROPHY, g, de));
  }
  P.wramBank(bank);
}
// ComputeTrophyExpForGroup (1E:70FE) and ComputeTrophyExpGroup0-5 (1E:70DA ...): group a's four tiers (the trophy
// counts' nibbles: wN64TrophyCounts low, high, +1 low, high, masked) at or over the group's threshold, each whose
// tier flag is not yet set: the flag set and its EXP added. Returns bc = the group's EXP; af, de, hl kept.
const TIERS = [[0, 0, 0], [0, 4, 4], [1, 0, 2], [1, 4, 6]];          // [count byte, nibble shift, value byte]
export function computeTrophyExpForGroup(P, g) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_SCENE);
  P.bus.w8(P.A.trophyExpGroup, g);
  const threshold = romByte(P, ix(TrophyExpGroupThresholds, g)), mask = romByte(P, ix(TrophyExpGroupMasks, g));
  let accum = 0;
  P.bus.w16(P.A.trophyExpGroupAccum, 0);
  TIERS.forEach(([byte, shift, value], tier) => {
    const v = P.bus.u8(P.A.n64TrophyCounts + byte), count = (shift ? ((v >> 4) | (v << 4)) & 0xFF : v) & mask;
    if (count < threshold) return;
    const flag = romWord(P, ix(TrophyExpTierFlags + 2 * tier, (g * 8) & 0xFF));
    if (testGameFlag(P, flag)) return;
    setGameFlag(P, flag);
    accum = (accum + getTrophyExpValue(P, g, value).bc) & 0xFFFF;
    P.bus.w16(P.A.trophyExpGroupAccum, accum);
  });
  P.wramBank(bank);
  return { bc: accum };
}

export const HOOKS = [
  [BANK, 0x6C62, hook(P => applyStatGapProgressFlag(P))],
  [BANK, 0x6C7C, hook(P => applyClassProgressRule(P, 0))],
  [BANK, 0x6C86, hook(P => applyClassProgressRule(P, 1))],
  [BANK, 0x6C93, hook(P => applyClassProgressRule(P, 2))],
  [BANK, 0x6CA0, hook(P => applyClassProgressFlags(P))],
  [BANK, 0x6CAA, hook(P => { setRewardGameFlag(P); })],
  [BANK, 0x6CD1, hook(P => testRewardGameFlag(P))],
  [BANK, 0x6CF6, hook(P => getRewardTableIndex(P))],
  [BANK, 0x6E1C, hook(P => applyRewardUnlockFlags(P))],
  [BANK, 0x6E50, hook((P, c) => setRewardUnlockFlag(P, c.c))],
  [BANK, 0x6EB1, hook(P => setMinigameRecordSaveFlag(P))],
  [BANK, 0x6EDC, hook(P => setMinigameClearFlag(P))],
  [BANK, 0x6F38, hook(P => updateMinigameBestScore(P))],
  [BANK, 0x6F8D, hook(P => { checkAllProgressComplete(P); })],
  [BANK, 0x6FB2, hookGen(P => showIslandOpenRankingBoard(P))],
  [BANK, 0x6FBF, hook(P => setupRankingBoardArgs(P))],
  [BANK, 0x6FEB, hook((P, c) => getTrophyExpValue(P, c.a, c.b))],
  [BANK, 0x6FFB, hook(P => computeTrophyExpAwards(P))],
  [BANK, 0x7065, hook(P => { unusedSetPendingTrophyExpAwards(P); })],
  ...[0x70DA, 0x70E0, 0x70E6, 0x70EC, 0x70F2, 0x70F8].map((addr, g) => [BANK, addr, hook(P => computeTrophyExpForGroup(P, g))]),
  [BANK, 0x70FE, hook((P, c) => computeTrophyExpForGroup(P, c.a))],
];
