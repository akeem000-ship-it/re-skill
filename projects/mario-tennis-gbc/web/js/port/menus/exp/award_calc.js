// The EXP a match earns (bank $1E): the match statistics (games won, aces, winners) weighed by the player's and the
// opponents' tiers, the match settings' bonus (3 sets, 6 games), the minigame score bonus and the story's level
// scaling; and the award screens these totals are shown on (ShowExpAwardFor*: one pending award each, then the
// results screen's EXP part), the exhibition and link-play awards stored in the story file that played, and
// ApplyPendingExpAwards, which shows and distributes everything a story file has pending.
// Port of the code of src/engine/menus/exp/award_calc_1e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
// Covered by the lockstep on out/engine/rec2.mtrec (a minigame's award) and the out/port/xr_* recordings (story
// match awards; xr_rw_exhib, xr_rw_link: the exhibition and link awards to a story file; xr_award:
// ApplyPendingExpAwards, which in the game only the story's debug map calls), and by
// web/tests/port/routines_menus_exp.mjs.
import {
  FZ, FN, FH, FC, rd, wr, u8, ix, far, farGen, hook, hookGen, rom, FAR, testFlag, setFlag, clearFlag, addHLFlags, cpFlags,
  romByte, BANK_EXP, BANK_EXP_DISTRIBUTE, BANK_SAVE, BANK_BRACKET, BANK_CHAR_DATA, WRAM_TEXT, WRAM_SCENE, WRAM_SOUND, CHAR,
  GAMEMODE, FLAG, rIE, farcallWait, RunExpDistributionFlow, CharDataScreen_Show,
} from "./defs.js";
import { mulHLByA, divAHLByE } from "../../home/math.js";
import { checkStorySlot, saveStorySlot } from "../../save/storyslots.js";
import { readExhibitionSaveBlock } from "../../save/saveslots.js";
import { clearPendingExpAwards, setPendingExpAward } from "./distribute.js";
import { computeTrophyExpAwards, applyStatGapProgressFlag } from "./reward.js";
import { recordExhibitionVictory } from "../ranking/bracket.js";
import { showMatchResultsScreen } from "../results/results_screen.js";

export const BANK = BANK_EXP;
// ROM data (bank $1E)
const MatchStatsRewardTable = [0x67D7, 0x67DF, 0x67E7, 0x67EF, 0x67F7, 0x67FF];   // EXP per stat by tier (0-6)
const LookupExpTierForCharTable = 0x695B;                           // a story character's tier by level / 10
const SCORE_BONUS = [[0x03E7, 0x01F4], [0x01F3, 0x00FA], [0x0063, 0x0032]];   // score over 999 / 499 / 99: bonus
const TIER_CAP = 6;
const PENDING_N64 = 0, PENDING_EXHIBITION = 1, PENDING_LINKED = 2, PENDING_MATCH = 3, PENDING_TROPHY = 4;
const SHOW_EXP = 1;                                                  // ShowMatchResultsScreen's c: the EXP award part
const word = (P, name) => P.bus.u16(P.A[name]);
const setWord = (P, name, v) => P.bus.w16(P.A[name], v & 0xFFFF);
// `add hl, de / jr nc / ld hl, rIE`: a 16-bit sum, $FFFF when it carries
const capped = (a, b) => (a + b > 0xFFFF ? rIE : a + b);

// GetScoreBonus (1E:6807): in a minigame's high-score mode, de = the bonus for a score over 999 (500), 499 (250) or
// 99 (50), else 0 (the score's comparisons as signed 16-bit subtractions). hl kept.
export function getScoreBonus(P) {
  if (!P.V.minigameHighScoreMode) return { a: 0, f: FZ, de: 0 };
  const score = word(P, "minigamesCurrentScore");
  let r = 0, f = 0;
  for (const [limit, bonus] of SCORE_BONUS) {
    r = (limit - score) & 0xFFFF;
    f = (r & 0x8000 ? 0 : FZ) | FH | (score > limit ? FC : 0);         // `bit 7, h` after the `sbc` (C kept)
    if (r & 0x8000) return { a: r >> 8, f, de: bonus };
  }
  return { a: r >> 8, f, de: 0 };
}
// ComputeMatchStatsReward (1E:6851): the match's EXP for the player whose character struct is mapped (WRAM 4 or
// 5), added to hl: games won x the player's tier's rate; outside link play also both opponents' aces and winners,
// each at the opponents' tier's rate. Not for a character past the story four (a created one): hl as it was.
export function computeMatchStatsReward(P, hl) {
  const id = u8(P, CHAR.Id);
  if (id >= 4) return { a: id, f: cpFlags(id, 4), hl };
  let { c } = getPlayerExpTier(P), de = hl;
  de = accumulateStatExp(P, MatchStatsRewardTable[0], P.V.totalGamesWonInMatch, c, de).hl;
  if (P.V.gameMode === GAMEMODE.LINK_MATCH) return { a: GAMEMODE.LINK_MATCH, f: FZ | FN, hl: de, de, c };
  c = getOpponentExpTier(P).c;
  const V = P.V, stats = [
    [1, V.character1ServiceAces], [1, V.character3ServiceAces], [2, V.character1ReturnAces], [2, V.character3ReturnAces],
    [3, V.character1SmashAces], [3, V.character3SmashAces], [4, V.character1LobShotWinners], [4, V.character3LobShotWinners],
    [5, V.character1DropShotWinners], [5, V.character3DropShotWinners]];
  let r;
  for (const [table, count] of stats) { r = accumulateStatExp(P, MatchStatsRewardTable[table], count, c, de); de = r.hl; }
  return { ...r, hl: de, de, c };
}
// AccumulateStatExp (1E:68CF): de + table[c] * a (hl = de = the sum; b = 0)
export function accumulateStatExp(P, table, a, c, de) {
  const rate = romByte(P, (table + c) & 0xFFFF), product = mulHLByA(P, rate, a).hl;
  const sum = (product + de) & 0xFFFF;
  return { a, b: 0, hl: sum, de: sum, f: addHLFlags(product, de, a ? 0 : FZ) };
}
// ApplyMatchSettingsExpBonus (1E:68DC): hl x 1.5 for a match of 3 sets or of 6 games (d: games in the low nibble,
// sets in the high one; the ROM's codes 3 and 1), x 2 for both
export function applyMatchSettingsExpBonus(P, hl, d) {
  let b = 0;
  if ((d & 0x0F) === 0x03) b++;
  if (((d >> 4) & 0x0F) === 0x01) b++;
  if (!b) return { a: 0, b, f: FZ | FH, hl };                        // (`and a`)
  if (b === 2) return { a: 2, b, hl: (hl * 2) & 0xFFFF, f: addHLFlags(hl, hl, FZ) };   // (Z from `cp $02`)
  const half = ((hl >> 1) | (hl & 0x8000)) & 0xFFFF;                 // `sra d / rr e`
  // (Z from `rr e`: add hl, de keeps it)
  return { a: 1, b, de: half, hl: (hl + half) & 0xFFFF, f: addHLFlags(hl, half, (half & 0xFF) ? 0 : FZ) };
}
// GetOpponentExpTier (1E:6901): the opponent's tier (character 1, WRAM 5); in doubles the mean of both opponents'
// (characters 1 and 3, rounded up); at most 6
export function getOpponentExpTier(P) {
  const old = P.V.wramBank;
  P.wramBank(WRAM_TEXT);
  let { c } = lookupExpTierForChar(P);
  if (P.V.matchIsDoubles) {
    P.wramBank(WRAM_SOUND);
    const other = lookupExpTierForChar(P).c;
    c = (((other + c) & 0xFF) + 1 & 0xFF) >> 1;
  }
  if (c >= TIER_CAP) c = TIER_CAP;
  P.wramBank(old);
  return { a: old, c };
}
// GetPlayerExpTier (1E:6932): the mapped character's tier, at most 6
export function getPlayerExpTier(P) {
  let { c } = lookupExpTierForChar(P);
  if (c >= TIER_CAP) c = TIER_CAP;
  return { a: c, c };
}
// LookupExpTierForChar (1E:693E): the mapped character's tier: a story character's from LookupExpTierForCharTable by
// its level / 10 (wCharExpTier holds the level), another's its wCharExpTier - 1
export function lookupExpTierForChar(P) {
  const level = u8(P, CHAR.ExpTier), id = u8(P, CHAR.Id);
  if (id >= 4) return { a: id, c: (level - 1) & 0xFF };             // LookupExpTierForChar.ge04
  const tens = divAHLByE(P, 0, level, 10).hl & 0xFF;
  const hl = ix(LookupExpTierForCharTable, tens);
  return { a: hl >> 8, c: romByte(P, hl), hl };                      // (ld_hl_indexed leaves a = h)
}

// ---- the awards stored in a story file ----
// AwardExhibitionMatchExp (1E:6967): an exhibition match's EXP (hl): for a story character on the court (slot ref bit
// 7: its story file in bits 1-2) shown, then added to that file's pending exhibition EXP and saved; then the victory
// recorded (RecordExhibitionVictory) and the exhibition save block read back
export function* awardExhibitionMatchExp(P, hl) {
  const exp = hl;
  setWord(P, "pendingExpExhibition", exp);
  const ref = P.V.matchSlotCharRefs;
  if (ref & 0x80) {
    yield* showExpAwardForExhibition(P, exp);
    yield* addToStoryFile(P, (ref >> 1) & 0x03, "pendingExpExhibition", exp);
  }
  far(P, BANK_BRACKET, () => recordExhibitionVictory(P));
  const a = far(P, BANK_SAVE, () => readExhibitionSaveBlock(P));
  return { a, f: a === 0xFF ? 0 : FZ };
}
// AwardLinkedPlayMatchExp (1E:69B4): a link match's EXP (hl): for this side's story character (its slot ref, by
// wLinkMatchRole) shown, then added to its story file's pending linked EXP and saved
export function* awardLinkedPlayMatchExp(P, hl) {
  const exp = hl;
  setWord(P, "pendingExpLinked", exp);
  const ref = u8(P, ix(P.A.matchSlotCharRefs, (P.V.linkMatchRole >> 1) << 1));
  if (!(ref & 0x80) || ref === 0xFF) return {};
  yield* showExpAwardForLinkedPlay(P, exp);
  const ref2 = u8(P, ix(P.A.matchSlotCharRefs, ((P.V.linkMatchRole & 0x03) >> 1) << 1));
  yield* addToStoryFile(P, (ref2 >> 1) & 0x03, "pendingExpLinked", exp);
  return {};
}
// the story file `slot` read (CheckStorySlot: its $C800 image, the pending words with it), exp added to its word
// `name` (capped at $FFFF) and saved; wCurrentStorySlot as it was
function* addToStoryFile(P, slot, name, exp) {
  const keep = P.V.currentStorySlot;
  P.V.currentStorySlot = slot;
  far(P, BANK_SAVE, () => checkStorySlot(P));
  setWord(P, name, capped(word(P, name), exp));
  far(P, BANK_SAVE, () => saveStorySlot(P));
  P.V.currentStorySlot = keep;
}

// ---- the award screens ----
// ShowExpAwardForMinigame (1E:6A13): de EXP (if any) as the one pending award (a match's, variant 1: a minigame),
// shown on the results screen's EXP part. Registers and the WRAM bank kept.
export function* showExpAwardForMinigame(P, de) {
  if (!de) return { a: 0, f: FZ };
  yield* showOneAward(P, PENDING_MATCH, 1, de);
}
// ShowExpAwardForMatch (1E:6A36): the same for a story match: variant 0, 2 Island Open, 3 practice, 4 dream match
export function* showExpAwardForMatch(P, de) {
  if (!de) return { a: 0, f: FZ };
  const mode = P.V.gameMode;
  const variant = mode === GAMEMODE.DREAM_MATCH ? 4 : mode === GAMEMODE.PRACTICE_MATCH ? 3 : mode === GAMEMODE.ISLAND_OPEN ? 2 : 0;
  yield* showOneAward(P, PENDING_MATCH, variant, de);
}
// ShowExpAwardForExhibition (1E:6A6E) / ShowExpAwardForLinkedPlay (1E:6AA4): the exhibition / linked-play award,
// shown as for singles (FLAG_DOUBLES cleared meanwhile)
export function* showExpAwardForExhibition(P, de) {
  if (!de) return { a: 0, f: FZ };
  yield* showOneAward(P, PENDING_EXHIBITION, 0, de, true);
}
export function* showExpAwardForLinkedPlay(P, de) {
  if (!de) return { a: 0, f: FZ };
  yield* showOneAward(P, PENDING_LINKED, 0, de, true);
}
// UnusedShowExpAwardForN64 (1E:6ADA): the N64 (Transfer Pak) award; nothing calls it
export function* unusedShowExpAwardForN64(P, de) {
  if (!de) return { a: 0, f: FZ };
  yield* showOneAward(P, PENDING_N64, 0, de);
}
function* showOneAward(P, award, variant, de, asSingles = false) {
  const bank = P.V.wramBank;
  far(P, BANK_EXP_DISTRIBUTE, () => clearPendingExpAwards(P));
  far(P, BANK_EXP_DISTRIBUTE, () => setPendingExpAward(P, award, variant, de));
  const doubles = asSingles && testFlag(P, FLAG.DOUBLES);
  if (asSingles) clearFlag(P, FLAG.DOUBLES);
  yield* showMatchResultsScreen(P, SHOW_EXP);
  if (doubles) setFlag(P, FLAG.DOUBLES);
  P.wramBank(bank);
}

// ApplyPendingExpAwards (1E:6AFD): everything the story file has pending (its story matches' EXP scaled by the
// players' levels, the N64 trophies' EXP, the exhibition and linked-play EXP): if any, shown (the doubles layout),
// shared out on the EXP distribution screen, the two characters' data screens, then cleared and saved.
// wGameMode is GAMEMODE_NONE meanwhile. Returns a = 1, or 0 when nothing was pending. Registers and the WRAM bank
// kept.
export function* applyPendingExpAwards(P) {
  const bank = P.V.wramBank, mode = P.V.gameMode;
  P.V.gameMode = GAMEMODE.NONE;
  let total;
  const storyTrophy = word(P, "pendingExpStory") + word(P, "pendingExpTrophy");
  if (storyTrophy > 0xFFFF) total = rIE;                             // (each sum stops at the first carry)
  else {
    const scaled = scaleExpByPlayerLevel(P, storyTrophy).de;
    total = computeTrophyExpAwards(P).hl + scaled;
    if (total <= 0xFFFF) total += word(P, "pendingExpExhibition");
    if (total <= 0xFFFF) total += word(P, "pendingExpLinked");
    if (total > 0xFFFF) total = rIE;
  }
  if (!total) {                                                      // .restore2
    P.V.gameMode = mode;
    P.wramBank(bank);
    return { a: 0, f: FZ };
  }
  far(P, BANK_EXP_DISTRIBUTE, () => clearPendingExpAwards(P));
  let de = word(P, "pendingExpStory") + word(P, "pendingExpTrophy");
  if (de > 0xFFFF) de = 0xFFFF;
  const s = scaleExpByPlayerLevel(P, de);
  de = s.f & FC ? 0xFFFF : s.de;
  const set = (award, amount) => { if (amount) far(P, BANK_EXP_DISTRIBUTE, () => setPendingExpAward(P, award, 0, amount)); };
  set(PENDING_N64, de);
  set(PENDING_EXHIBITION, word(P, "pendingExpExhibition"));
  set(PENDING_LINKED, word(P, "pendingExpLinked"));
  P.wramBank(WRAM_SCENE);
  set(PENDING_TROPHY, P.bus.u16(P.A.trophyExpTotal));
  const wasSingles = !testFlag(P, FLAG.DOUBLES);                     // .checkDoubles
  setFlag(P, FLAG.DOUBLES);
  yield* showMatchResultsScreen(P, SHOW_EXP);
  if (wasSingles) clearFlag(P, FLAG.DOUBLES);
  // .restore: through the ROM's addresses with the ROM's stack (af, bc, de, hl, the WRAM bank and the game mode
  // pushed): the screens keep stack addresses; menus/char_data runs them where it is hooked
  yield* farcallWait(P, RunExpDistributionFlow, { hl: total }, 6);
  yield* farcallWait(P, CharDataScreen_Show, { c: 0 }, 6);
  yield* farcallWait(P, CharDataScreen_Show, { c: 1 }, 6);
  applyStatGapProgressFlag(P);
  for (const name of ["pendingExpStory", "pendingExpTrophy", "pendingExpExhibition", "pendingExpLinked"]) setWord(P, name, 0);
  P.V.gameMode = mode;
  far(P, BANK_SAVE, () => saveStorySlot(P));
  P.wramBank(bank);
  return { a: 1 };
}
// ScaleExpByPlayerLevel (1E:6C09): de scaled by the mean of the two story characters' levels (wStory*ExpTier):
// under 10 as it is, then x 1.5, x 2, x 2.5, x 3, x 3.5 for each 10 more, x 4 from 60 (16-bit steps). Returns de
// (and hl) and C when the last addition carried.
export function scaleExpByPlayerLevel(P, de) {
  const level = ((P.V.storyMainCharExpTier + P.V.storyPartnerCharExpTier) & 0xFF) >> 1;
  const half = de >> 1, add = (x, y) => ({ v: (x + y) & 0xFFFF, c: x + y > 0xFFFF });
  // Z is left by the last `rr e` (de halved) or the `cp` of the level band; `add hl` keeps it
  const halfZ = (half & 0xFF) ? 0 : FZ;
  let r, z = 0;
  if (level < 10) return { a: level, de, f: 0 };          // (`cp $0a / ccf`: all clear)
  if (level < 20) { r = add(de, half); z = halfZ; }
  else if (level < 30) r = add(de, de);
  else if (level < 40) { r = add((de * 2) & 0xFFFF, half); z = halfZ; }
  else if (level < 50) r = add((de * 2) & 0xFFFF, de);
  else if (level < 60) { r = add(add((de * 2) & 0xFFFF, de).v, half); z = halfZ; }
  else { r = add((de * 2) & 0xFFFF, (de * 2) & 0xFFFF); z = level === 60 ? FZ : 0; }
  return { a: level, de: r.v, hl: r.v, f: z | (r.c ? FC : 0) };
}
export const HOOKS = [
  [BANK, 0x6807, hook(P => getScoreBonus(P))],
  [BANK, 0x6851, hook((P, c) => computeMatchStatsReward(P, c.hl))],
  [BANK, 0x68CF, hook((P, c) => accumulateStatExp(P, c.hl, c.a, c.c, c.de))],
  [BANK, 0x68DC, hook((P, c) => applyMatchSettingsExpBonus(P, c.hl, c.d))],
  [BANK, 0x6901, hook(P => getOpponentExpTier(P))],
  [BANK, 0x6932, hook(P => getPlayerExpTier(P))],
  [BANK, 0x693E, hook(P => lookupExpTierForChar(P))],
  [BANK, 0x6967, hookGen((P, c) => awardExhibitionMatchExp(P, c.hl))],
  [BANK, 0x69B4, hookGen((P, c) => awardLinkedPlayMatchExp(P, c.hl))],
  [BANK, 0x6A13, hookGen((P, c) => showExpAwardForMinigame(P, c.de))],
  [BANK, 0x6A36, hookGen((P, c) => showExpAwardForMatch(P, c.de))],
  [BANK, 0x6A6E, hookGen((P, c) => showExpAwardForExhibition(P, c.de))],
  [BANK, 0x6AA4, hookGen((P, c) => showExpAwardForLinkedPlay(P, c.de))],
  [BANK, 0x6ADA, hookGen((P, c) => unusedShowExpAwardForN64(P, c.de))],
  [BANK, 0x6AFD, hookGen(P => applyPendingExpAwards(P))],
  [BANK, 0x6C09, hook((P, c) => scaleExpByPlayerLevel(P, c.de))],
];
