// Starting a match: the character records the menus build (bank $02 InitCa00RecordFromCharId, bank $38
// ApplyCpuDifficultyToCharRecords), the match settings, and RunMatch's own setup up to the play loop
// (InitMatchScene, the court intro). Drawing, fades and music are left to the page.
import * as ball from "./ball.js";
import * as chars from "./chars.js";
import * as flow from "./flow.js";
import * as shot from "./shot.js";

// the four 64-byte records: slot 0 player 1 main, 1 player 1 partner, 2 player 2 main, 3 player 2 partner
export const RECORD = slot => 0xCA00 + slot * 0x40;
export const COURT = { CLAY: 0, GRASS: 1, HARD: 2 };

// 02:4066 InitCa00RecordFromCharId, roster path: a cleared record, the 29 attribute bytes of
// StoryCharacterRecords_02 (02:52CF, 29 bytes per character) at +$0F, the remapped id at +$0B and the palette at
// +$0C. (The name the ROM also writes at +$00 is display text and is left to the page.)
export function initRosterRecord(E, slot, charId) {
  const m = E.mem, rec = RECORD(slot);
  for (let i = 0; i < 0x40; i++) m.w8(rec + i, 0);
  const src = 0x52CF + charId * 29;
  for (let i = 0; i < 29; i++) m.w8(rec + 0x0F + i, E.rom.u8(2, src + i));
  m.w8(rec + 0x0B, remapExtendedCharId(E, charId));
  m.w8(rec + 0x0C, E.rom.u8(2, 0x417E + charId));                       // GetCharPaletteIndex: CharPaletteIndexTable
  if (charId & 0x40) m.w8(rec + 0x2F, 0x02);                             // CHARREC_BUILD_KIND
}
// 02:4C58 RemapExtendedCharId: ids from $20 map through NameTextRemap_02
export function remapExtendedCharId(E, id) { return id < 0x20 ? id : E.rom.u8(2, 0x4C6A + ((id - 0x20) & 0x7F)); }
// 38:5F4C ApplyCpuDifficultyToCharRecords, one slot: 4 AI bytes at +$1B, the difficulty at +$1F and, for roster
// characters, the EXP tier at +$18, from the 6-byte rows of CpuDifficultyParamPtrs_38 (1 easy .. 4 intense; 0 = unset)
export function applyCpuDifficulty(E, slot, level, createdChar = false) {
  const m = E.mem, rec = RECORD(slot), row = E.rom.u16(0x38, 0x5FEB + level * 2);
  for (let i = 0; i < 4; i++) m.w8(rec + 0x1B + i, E.rom.u8(0x38, row + i));
  m.w8(rec + 0x1F, E.rom.u8(0x38, row + 4));
  if (!createdChar) m.w8(rec + 0x18, E.rom.u8(0x38, row + 5));
}

// 08:4106 InitDefaultMatchSettings, then the caller's choices
export function setMatchSettings(E, { court = COURT.HARD, sets = 1, games = 2, doubles = false, bgm = 0x33, context = 0, gameMode = 0 } = {}) {
  const S = E.S;
  S.matchTypeNumberOfSets = sets; S.matchTypeNumberOfGames = games; S.matchIsDoubles = doubles ? 1 : 0;
  S.onCourtCharCount = doubles ? 4 : 2; S.currentlyUsedCourt = court; S.matchBGM = bgm; S.matchContext = context; S.gameMode = gameMode;
}

// 08:4145 InitMatchScene (gameplay parts) + RunMatch's setup before PlayCourtIntro
export function initMatchScene(E, { vblankCounter = 0, viewOption = 0 } = {}) {
  const S = E.S, m = E.mem;
  flow.resetMatchState(E, vblankCounter);
  // InitViewFlipPreference 08:450E: link/minigame matches lock the view, else the story option decides
  const locked = S.gameMode === 0x09 || S.matchContext === 2 || S.gameMode === 0x08;
  S.courtViewOption = locked ? 0 : viewOption; S.courtViewLocked = locked ? 1 : 0;
  // LoadCourtSceneData 08:5E28: scroll 0, the court's friction and restitution from CourtSceneDataTable 08:5DC4
  m.w8(0xFF8B, 0); m.w8(0xFF8A, 0);
  S.courtSurfaceFriction = E.rom.u8(8, 0x5DC4 + S.currentlyUsedCourt * 4);
  S.courtSurfaceBounce = E.rom.u8(8, 0x5DC4 + S.currentlyUsedCourt * 4 + 1);
  E.setBank(4);
  ball.resetBallState(E, c => shot.setBallTrailColor(E, c));
  chars.initAllChars(E);
  flow.assignCourtPositions(E);
  S.changeEndsPending = 0;
  E.setBank(4);
  // RunMatch 08:4190 after the scene: mode scratch cleared, no serve-aim override
  for (let i = 0; i < 0x80; i++) m.w8(0xC780 + i, 0);
  m.w8(0xC7B5, 0xFF);                                                     // wAiServeAimOverride
}
// 08:6117 PlayCourtIntro: a camera pan over the court (skipped with A/B/START), then the serve camera
export function* playCourtIntro(E) {
  const S = E.S, m = E.mem;
  E.ext.playMusic(E, S.matchContext ? 0x45 : 0x44);                       // the fanfare
  if (S.gameMode === 0x02 || !S.matchContext) {
    m.w8(0xFF8B, 0); m.w8(0xFF8A, 0);
    yield* flow.stepMatchFrames(E, 5);
    let d = 0, e = 0;
    const pan = function* (b, hl) {                                       // 08:6152 PanCamera: d/e += h/l per frame
      do {
        m.w8(0xFF8B, d); m.w8(0xFF8A, e);
        d = (d + (hl >> 8)) & 0xFF; e = (e + (hl & 0xFF)) & 0xFF;
        if (flow.inputPressed(E) & 0x0B) return true;
        yield* flow.stepMatchFrame(E);
      } while (--b & 0xFF);
      return false;
    };
    for (const [b, hl] of [[0x30, 0x0200], [0x38, 0x0002], [0x30, 0xFE00], [0x1E, 0x00FE], [0x1A, 0x0200]])
      if (yield* pan(b, hl)) break;
  }
  flow.resetCameraForServe(E);
  flow.updateMatchCamera(E);
}
// RunMatch from the scene on: the intro, then the match (the page shows results and rewards)
export function* runMatch(E, opts = {}) {
  initMatchScene(E, opts);
  E.S.matchSimFrozen = 0xFF;
  yield* playCourtIntro(E);
  E.S.matchSimFrozen = 0;
  yield* flow.runMatchPlayLoop(E);
}
