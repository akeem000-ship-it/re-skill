// Shared pieces of the debug-screen ports (web/js/port/menus/debug): the helpers of ../equipment/defs.js, the far
// routines these screens call, the EXP screen's variables (WRAM 6), and the ROM's 16-bit subtraction with its
// flags. Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import { FZ, FN, FH, FC, FAR as FAR_EQUIP } from "../equipment/defs.js";
import { farcallFlags } from "../common/defs.js";

export * from "../equipment/defs.js";
export { farcallFlags };

export const FAR = {
  ...FAR_EQUIP,
  GetCharPaletteIndex: [0x02, 0x4173], AddPlayerExp: [0x02, 0x4D8F], GetExpRemainingToNextLevel: [0x02, 0x4DC8],
  WriteSaveBlock: [0x03, 0x4A89], ReadSaveBlock: [0x03, 0x4B9B],
  InitActorEngine: [0x04, 0x4041], LoadActorObjectDefIfValid: [0x04, 0x4AC3], SetActorAnimationChecked: [0x04, 0x4BBB],
  Unused_04_GetCharObjectId: [0x04, 0x4C1D], SpawnActorsFromList: [0x04, 0x4CF7],
  Unused_05_StubNop_05_0: [0x05, 0x4626], CreateWindow: [0x05, 0x4684], RunMenuSelection: [0x05, 0x477F],
  FetchDialogueText: [0x05, 0x5C18], WriteStringToWindow: [0x05, 0x600E],
  InitChar: [0x08, 0x684A], SetCharAnimation: [0x08, 0x69EA],
  LoadIndexedPalette_18: [0x18, 0x4339], Unused_18_FindRosterEntry: [0x18, 0x44EF],
  LoadCharacterRecordToBuffer: [0x18, 0x4507], Unused_18_CheckUnlockFlag: [0x18, 0x4557],
  Unused_18_LoadCharSelectCursorGfx: [0x18, 0x59C1], Unused_18_DrawCharSelectCursor: [0x18, 0x59D6],
  Unused_18_ApplySpriteBobOffset: [0x18, 0x5A6A], LoadOnCourtCharTilesA: [0x18, 0x5AB9],
  Unused_1b_ResetMugshotPalettes: [0x1B, 0x4E0D], Unused_1b_SetMugshotAttrs: [0x1B, 0x4E18],
  LoadCharMugshotToBuffer: [0x1B, 0x4E37], Unused_1b_StubNop_1b_01: [0x1B, 0x4E43],
  CopyMugshotBufferToVram: [0x1B, 0x4E46],
};

// ---- WRAM 0 ----
export const wStoryModeNameOfMainCharacter = 0xC900, STORY_RECORD_SIZE = 0x40, STORY_RECORD_LEVEL = 0x18;
export const wStoryModeMainCharacterOverworldSprite = 0xC90B, wStoryModeMainCharacterOverworldSpriteColor = 0xC90C;
export const wStoryMainCharExp = 0xC92C, wStoryPartnerCharExp = 0xC96C, wStoryCharacterSlot = 0xCB00;
export const wExpBonusPending = 0xC36F, wExpBonusAmount = 0xC370, wPauseMenuWindowId = 0xCB26;
export const wTextBuffer = 0xC600;
// ---- the EXP screen's variables (WRAM 6) ----
export const wCharDataAnimCounter = 0xD000, wExpScreenFlags = 0xD151;
export const wExpAwardTotal = 0xD230, wExpAwardCounted = 0xD232, wExpCountedSprite = 0xD234, wExpCountDone = 0xD238;
export const wExpCountFastForward = 0xD239, wExpNumberSpriteShiftX = 0xD23A, wExpLevelUpQueued = 0xD23B;
export const wExpToNextLevel = 0xD23C, wExpToNextSprite = 0xD23E, wExpToNextDisplayed = 0xD242;
export const wExpToNextDigits = 0xD244, wExpCountedDigits = 0xD24E, wExpAwardSlot = 0xD254;
export const EXPSCREEN_MESSAGE = 0x01, EXPSCREEN_REDRAW_CAPTION = 0x80;   // wExpScreenFlags bits
export const MAX_LEVEL = 99;
export const SFX_CAPTION = 0x73;

// the record (name, level, ...) of the story character in wStoryCharacterSlot
export const storyRecord = P => (P.bus.u8(wStoryCharacterSlot) ? wStoryModeNameOfMainCharacter + STORY_RECORD_SIZE : wStoryModeNameOfMainCharacter);

// ---- 16-bit arithmetic as the ROM writes it ----
// `ld a, l / sub e / ld l, a / ld a, h / sbc d / ld h, a`: hl - de, a = the new h, the flags of the `sbc d`
export function sub16(x, y) {
  const lo = (x & 0xFF) - (y & 0xFF), borrow = lo < 0 ? 1 : 0;
  const hx = (x >> 8) & 0xFF, hy = (y >> 8) & 0xFF, hi = hx - hy - borrow, h = hi & 0xFF;
  const f = (h === 0 ? FZ : 0) | FN | ((hx & 0xF) - (hy & 0xF) - borrow < 0 ? FH : 0) | (hi < 0 ? FC : 0);
  return { hl: h << 8 | (lo & 0xFF), a: h, f };
}
// `bit 7, h`: Z when h's bit 7 is clear, H set, C kept
export const bit7F = (h, f) => (h & 0x80 ? 0 : FZ) | FH | (f & FC);
// `add hl, de`: Z kept, H from bit 11, C from bit 15
export const addHLF = (hl, de, f) => (f & FZ) | ((hl & 0xFFF) + (de & 0xFFF) > 0xFFF ? FH : 0) | (hl + de > 0xFFFF ? FC : 0);
// a farcall made after the routine pushed `words` words (FarCall's flags depend on sp)
export const farFlagsAt = (P, words) => farcallFlags((P.cpu.sp - 2 * words) & 0xFFFF);
// the registers a sequence of calls leaves: each call's result over the last (undefined ones skipped)
export function chain(r, x) {
  for (const k in x) if (x[k] !== undefined) {
    r[k] = x[k];
    if (k.length === 2) { delete r[k[0]]; delete r[k[1]]; }               // a pair given replaces its halves
    else if ("bc de hl".includes(k)) { /* unreachable */ }
  }
  return r;
}
