// What the menus do before a round: a new character record ($C800), the player records ($C880 / $C8C0), the golf
// session and the course and hole. The play page starts a Stroke round with the path the game takes through
// ModeSelectMain 32:5037 for a new game (no save): CharacterSelectScreen picks a preset golfer (32:50B1-32:5111:
// NewGame, SetupPlayerGolfer, SetPlayerControl), then the mode menu (32:51A3-32:51D9) and Stroke (32:52A3-32:52C6:
// CourseSelect, GolfSessionInit, SetCourseHole, no second player, wGameMode 3, GolfRound for $12 holes).
// The menus' screens are not ported: the page picks the golfer and the course itself.
import { rb, rw } from "./rom.js";
import { mulHLByA, mulSignedFull, subHLDE } from "./math.js";
import { advanceRandomSeed, holeIdFromCourse } from "./round.js";

const CHAR = 0x800;                              // wPlayerName: the character record ($C800, $40 bytes)
const player = c => (c & 1 ? 0x8C0 : 0x880);     // wPlayer1 / wPlayer2

// 05:40C2 CopyTextShortToDE: LoadTextShort 05:61D4 (bank $18 + ((id >> 10) & 7), index id & $3FF; each text bank's
// export 1 copies $20 bytes from its string table to wTextShortBuffer WRAM5 $D880), then the string with its $00 to de
export function copyTextShort(w, id, de) {
  const bank = 0x18 + ((id >> 10) & 7), index = id & 0x3FF;
  const copy = rw(bank, 0x4002) + 8;             // TextBankXX_LoadShort -> TextBankXX_Copy (18:7D14 and the others)
  const offsets = rw(bank, copy + 4), strings = rw(bank, copy + 0x0F);   // ld hl, $4004 / ld hl, StringTable
  const src = (strings + rw(bank, (offsets + 2 * index) & 0xFFFF)) & 0xFFFF;
  const buf = w.wram[5];
  for (let k = 0; k < 0x20; k++) buf[0x880 + k] = rb(bank, src + k);
  const w0 = w.wram[0];
  for (let k = 0; ; k++) {
    const v = buf[0x880 + k];
    w0[de - 0xC000 + k] = v;
    if (!v) break;
  }
}

const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };      // 00:2D2E SetGameFlag
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); }; // 00:2D49 ClearGameFlag

// 02:4E5D CharTablePtr: the per-type table (02:4D3D by record +$10 & 3) + a
const charTable = (w, a) => (rw(2, 0x4D3D + 2 * (w.wram[0][CHAR + 0x10] & 3)) + a) & 0xFFFF;
// 02:4EDA ClampToPlus78: d = l unless hl + $78 is negative (then $78; so is any hl >= $78)
function clamp78(hl) {
  if (!(((hl + 0xFF88) & 0xFFFF) & 0x8000)) return 0x78;
  if (((hl + 0x78) & 0xFFFF) & 0x8000) return 0x78;
  return hl & 0xFF;
}
// the index of the first table byte that d is not below (signed: d - t has bit 7 clear)
function steps(d, t) {
  let e = 0;
  while ((d - rb(2, t)) & 0x80) { e++; t++; }
  return e;
}
const sext = l => (l & 0x80 ? 0xFF00 | l : l);  // 02:4E78 SignExtendL

export function charComputeStats(w) {            // 02:4F07 CharComputeStats
  const r = w.wram[0], b = CHAR;
  const p20 = r[b + 0x20];
  let t = (charTable(w, 0) + 2 * (p20 >> 3)) & 0xFFFF;
  const de = rw(2, t), hi = rw(2, t + 2);
  let hl = mulHLByA(subHLDE(hi, de), p20 & 7) >> 3;
  hl = (hl + de) & 0xFFFF;
  r[b + 0x1A] = hl & 0xFF; r[b + 0x1B] = hl >> 8;
  const lvl = r[b + 0x12];
  let d = clamp78(subHLDE(mulSignedFull(sext(r[b + 0x21]), 3), lvl));
  r[b + 0x1C] = (steps(d, charTable(w, 0x1C)) - 4) & 0xFF;
  d = clamp78(subHLDE(mulSignedFull(sext(r[b + 0x22]), 4), lvl));
  let e = steps(d, charTable(w, 0x25));
  if (r[b + 0x19] & 1) e = (-e) & 0xFF;
  r[b + 0x1D] = e;
  d = clamp78(subHLDE(mulSignedFull(sext(r[b + 0x24]), 5), lvl));
  e = steps(d, charTable(w, 0x2A));
  r[b + 0x1F] = (-(e - 4)) & 0xFF;
  r[b + 0x1E] = rb(2, (charTable(w, 0x33) + e) & 0xFFFF);
}

export function charLevelUp(w, d) {              // 02:4FFA CharLevelUp / 02:4FFD CharLevelUpBC: d = stat to raise
  const r = w.wram[0], b = CHAR;
  if (r[b + 0x12] >= 0x63) return;
  const f = [0x20, 0x21, 0x22, 0x24][d];
  if (f !== undefined) r[b + f] = (r[b + f] + 1) & 0xFF;
  charComputeStats(w);
  r[b + 0x12]++;
}

export function createCharacter(w, d) {          // 02:4E82 CreateCharacter: d = type
  const r = w.wram[0], b = CHAR, e = d;
  d &= 3;
  r.fill(0, b, b + 0x40);
  r[b + 0x10] = e;
  copyTextShort(w, 0x43 + d, 0xC800);
  r[b + 0x12] = 0;
  r[b + 0x25] = 6;
  let a = rb(2, charTable(w, 0x3C));
  if (a >= 2) a = advanceRandomSeed(w) >> 8;
  r[b + 0x19] = (r[b + 0x19] & 0xFE) | (a & 1);
  charLevelUp(w, 0xFF);
  r[0x82D] = 1;                                  // wTextSpeed
}

export function newGame(w) {                     // 02:4E3D NewGame
  w.wram[0].fill(0, 0x800, 0xA00);
  createCharacter(w, 0);
  w.wram[0][0x450] = 0;                          // wMapId
  w.wram[0][0x46A] = 2;                          // wMapEntrance
  clearFlag(w, 14);
  setFlag(w, 15);
}

// 02:4A28 SetupPlayerGolfer: b = golfer for player c ($FF none / $80 own character / else preset 02:4B1D[b & $F]);
// the link partner ($82) is not ported; $81: the golfer of a saved hole's record at $C600 (+$13 = 2: its strokes
// replayed)
export function setupPlayerGolfer(w, b, c) {
  const r = w.wram[0], p = player(c);
  if (b === 0xFF) { r.fill(0, p, p + 0x40); r[p + 0x10] = 0xFF; return; }
  if (b === 0x82) {                              // 02:4A6C: the link partner's record as received (wSerialRecvBuf
    r.fill(0, p, p + 0x40);                      // $CB40, $20 bytes), field $13 = 3
    r[p + 0x28] = r[0x825];
    r.copyWithin(p, 0xB40, 0xB60);
    r[p + 0x13] = 3;
    return;
  }
  if (b === 0x81) {                              // 02:4A8C: the record at $C600 (a saved hole's), field $13 = 2
    r.fill(0, p, p + 0x40);
    r[p + 0x28] = r[0x825];
    r.copyWithin(p, 0x600, 0x620);
    r[p + 0x13] = 2;
    return;
  }
  if (b === 0x80) {
    if (r[0x2A5] === 0x0F) { r[p + 0x28] = 6; return; }   // no save slot: the record stays
    r.fill(0, p, p + 0x40);
    r[p + 0x28] = r[0x825];
    r.set(r.subarray(CHAR, CHAR + 0x20), p);
    return;
  }
  r.fill(0, p, p + 0x40);
  const src = rw(2, 0x4B1D + 2 * (b & 0x0F));
  for (let k = 0; k < 0x20; k++) r[p + k] = rb(2, src + k);
  r[p + 0x28] = 6;
  copyTextShort(w, 0x43 + r[p + 0x10], 0xC000 + p);
  if (b & 0x40) {
    r[p + 0x13] = 2;
    w.wram[6].set(r.subarray(0x600, 0x640), 0x680);
  }
}
// 02:4A28 SetupPlayerGolfer as above, returning the a it leaves (callers that pass it on, as SetCourseHole's wind
// byte): $FF: 0 (00:03A7 ClearMemory16); $80: the last byte copied, $C81F (00:03EB), or with no save slot the
// player record's low address byte + $28; a preset: b, or with bit 6 the WRAM bank it restores
export function setupPlayerGolferA(w, b, c) {
  setupPlayerGolfer(w, b, c);
  if (b === 0xFF) return 0;
  if (b === 0x82) return w.wram[0][0xB5F];
  if (b === 0x80) return w.wram[0][0x2A5] === 0x0F ? ((c & 1 ? 0xC0 : 0x80) + 0x28) & 0xFF : w.wram[0][0x81F];
  return b & 0x40 ? w.high[0x196] : b;
}
export function setPlayerControl(w, c, b) { w.wram[0][player(c) + 0x13] = b; }   // 02:4994 SetPlayerControl
export function setPlayerField11(w, c, b) { w.wram[0][player(c) + 0x11] = b; }   // 02:49A7 SetPlayerField11

export function golfSessionInit(w) {             // 10:4B28 GolfSessionInit
  const r = w.wram[0], r6 = w.wram[6];
  r6.fill(0, 0x000, 0x700);
  for (const a of [0x4DE, 0x4E3, 0x4E4, 0x4E7, 0x4ED, 0x4EF]) r6[a] = 0;
  for (const a of [0x2A6, 0x0F4, 0x832, 0x82C, 0x96C]) r[a] = 0;
  r.fill(0, 0x878, 0x880);
  r.fill(0, 0xAAD, 0xAB0);
  r[0x870] = 0; r[0x871] = 0; r[0x872] = 0;      // 10:4BC7 SetGolfEventHook with a = 0: none
  setupPlayerGolfer(w, 0x80, 0);
  setupPlayerGolfer(w, 0xFF, 1);
  r[0x834] = 0;                                  // wGameMode
  r6.fill(0, 0x680, 0x700);                      // 02:4616 ClearShotRecords
  mapSaveReturnPoint(w);                         // 0A:4D5B (b = $FF)
  const v = advanceRandomSeed(w);
  r[0x9FE] = v & 0xFF; r[0x9FF] = v >> 8;        // wRoundSeed
}

export function setCourseHole(w, wind, course, hole) {   // 10:423B SetCourseHole
  w.wram[0][0x838] = wind; w.wram[0][0x836] = course; w.wram[0][0x837] = hole;
  holeIdFromCourse(w);
}

// a new game's Stroke round: golfer = preset golfer (02:4B1D index: 8 Mario), course = CourseSelect's answer.
// Returns the hole count GolfRound 10:4451 is called with.
export function strokeRoundSetup(w, { golfer = 8, course = 1, seed = 0 } = {}) {
  newGameMenus(w, golfer, seed);
  // 32:51D5 GameModeSelect -> 3 (Stroke); 32:52A6 CourseSelect -> course
  w.wram[0][0x834] = 3;
  golfSessionInit(w);                            // 32:52B0
  setCourseHole(w, course, course, 1);           // 32:52B7 (a, the wind direction, is still the course)
  setupPlayerGolfer(w, 0xFF, 1);                 // 32:52BD
  w.wram[0][0x834] = 3;                          // 32:52C1
  return 0x12;
}
// the path to the game mode menu for a new game (32:50E4-32:51D2)
function newGameMenus(w, golfer, seed) {
  w.high[0x1FC] = seed & 0xFF; w.high[0x1FD] = (seed >> 8) & 0xFF;
  w.wram[0][0x2A5] = 0x0F;                       // wSaveSlot: none (32:50E4)
  newGame(w);                                    // 32:50F0
  setupPlayerGolfer(w, golfer & 0x0F, 0);        // 32:50FE
  setPlayerControl(w, 0, 0);                     // 32:5104 (+$0F bit 0 of the list entry: SetPlayerField11, not set)
  w.wram[0][0x834] = 9;                          // 32:51A3
  w.wram[0][0x450] = 0; w.wram[0][0x46A] = 2;
  setupPlayerGolfer(w, 0x80, 0);                 // 32:51B8
  w.wram[0][0x96D] = 0;                          // wReplayActive
  mapSaveReturnPoint(w);                         // 32:51C3
  for (const n of [144, 145, 146, 147]) clearFlag(w, n);
  // 32:51D2 SaveGame: no save slot (< 3 only)
}
// a new game's match play against a computer golfer (ModeSelectMain's VS path 32:5240-32:52A2): the game mode menu
// gives 2; BuildGolferListByFlags 02:5985 and CharacterSelectScreen 06:6071 (not ported: their record writes are
// undone by GolfSessionInit) pick the opponent, a preset golfer (a new game lists 9 Luigi and 4 Putts); CourseSelect
// the course; GolfSessionInit, SetCourseHole, SetupPlayerGolfer(opponent, player 2), wGameMode 2, GolfRound for $12
// holes (flags #73 / #74 give 3 holes or hole 18 only: not set in a new game)
export function matchRoundSetup(w, { golfer = 8, opponent = 9, course = 1, seed = 0 } = {}) {
  newGameMenus(w, golfer, seed);
  w.wram[0][0x834] = 2;                          // 32:51DC
  golfSessionInit(w);                            // 32:526D
  setCourseHole(w, course, course, 1);           // 32:5274
  setupPlayerGolfer(w, opponent & 0x0F, 1);      // 32:527B
  w.wram[0][0x834] = 2;                          // 32:5280
  return 0x12;
}
// 0A:4D5B MapSaveReturnPoint with b = $FF: the current map, entrance $FF, the position $C2A0 (5 bytes) -> $C962
export function mapSaveReturnPoint(w) { const r = w.wram[0]; r[0x960] = r[0x450]; r[0x961] = 0xFF; r.copyWithin(0x962, 0x2A0, 0x2A5); }
// 0A:4D8A MapWarpToReturnPoint: warp request $FA (wMapEvent+1 $C441), wMapId = $C960, wMapEntrance = $C961; entrance $FF
// (a saved position): entrance $FA, the facing $C966 -> $C465, x $C962 -> $C466, y $C964 -> $C468
export function mapWarpToReturnPoint(w) {
  const r = w.wram[0];
  r[0x441] = 0xFA;
  r[0x450] = r[0x960];
  if (r[0x961] !== 0xFF) { r[0x46A] = r[0x961]; return; }
  r[0x46A] = 0xFA;
  r[0x465] = r[0x966];
  r[0x466] = r[0x962]; r[0x467] = r[0x963];
  r[0x468] = r[0x964]; r[0x469] = r[0x965];
}
