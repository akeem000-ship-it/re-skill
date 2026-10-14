// A story file's new game (bank $1B): pick the main character, confirm it on its data screen, name it, then the
// partner (named, or picked and named once the opening has been seen); plus the unused debug character select and
// debug save-data flow of the same file.
// Port of src/engine/menus/char_select/char_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
// RunNewGameSetup is covered by the lockstep on out/port/cs_story_new.mtrec and cs_story_new2.mtrec; the Unused_1b_*
// routines are reached from nothing (their non-waiting ones are checked by the routine tests).
import {
  FZ, rd, wr, u8, w8, idx, rom, FAR, WRAM_STAGING, vTiles1, vTiles2, VRAM_BANK1, vBGMap0, SCREEN_HEIGHT, TILEMAP_WIDTH,
  PADF_A, PADF_B, PADF_START, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, SAVEFLAG_OPENING_SEEN,
  Text_31_123, wStoryModeNameOfMainCharacter, wStorySlotData, wCharSelectRoster_SIZE, sound, advanceFrame, fadeIn,
  fadeOut, registerFrameTask, far, farGen, storyField, disableLCDSafely, queueVRAMCopy, copyMemoryBC, copyMemoryFast,
  hook, hookGen,
} from "./defs.js";
import { runCharacterSelectScreen } from "./character.js";
import { runNameEntryScreen } from "./name_entry.js";
import { testSaveFlag } from "../../save/storyslots.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";

export const BANK = 0x1B;
const BANK_CHARS = 0x38, BANK_SAVE = 0x03, BANK_CHAR_DATA = 0x1D;
const PromptCharDataConfirm = 0x5A63;                      // (1d: char_data/confirm.js)
const CharSelectNavGridTable = 0x5F7C, CharSelectRosterTable = 0x5F9C, Unused_1b_UpdateCharSelectCursorTask = 0x6035;
const NAV_GRID_SIZE = 0x20, ROSTER_ENTRY_SIZE = 8;
const STORY_RECORD_MUGSHOT = 0x0B;                         // a story record's +$0B: its mugshot
const CHAR_RECORD_BUFFER = 0xD580;                         // wCharRecordBuffer (WRAM 1): +14 palette... +12 color
const CHARS_IN_NEW_GAME = 4;
const SELECT_AGAIN = 0xFE;                                 // RunCharacterSelectScreen: (never returned) select again

// RunNewGameSetup (1B:61BA): the new game's characters (see the header). Returns a = 0, or $FF when backed out of
// the first character select. wStoryCharacterSlot is kept; the records end up in the story file image ($C800).
export function* runNewGameSetup(P) {
  for (;;) {                                                // (`jp RunNewGameSetup` restarts from the top)
    sound(P, BGM_MENU);
    rom(P, FAR.InitStoryModeState);
    rom(P, FAR.RollStoryRandomByte, { a: 0 });
    P.wramBank(WRAM_STAGING);
    wr(P, "charSelectCursorCol", 1);
    wr(P, "charSelectCursorRow", 1);
    let hl = P.A.newGameRosterFields;
    for (let ch = 0; ch < CHARS_IN_NEW_GAME; ch++) {
      rom(P, FAR.LoadCharacterRecordToBuffer, { a: ch, hl });
      w8(P, hl++, u8(P, CHAR_RECORD_BUFFER + 14));
      w8(P, hl++, u8(P, CHAR_RECORD_BUFFER + 12));
    }
    const savedSlot = rd(P, "storyCharacterSlot");          // (pushed; popped back on every way out)
    wr(P, "storyCharacterSlot", 0);
    const r = yield* setupMainAndPartner(P, savedSlot);
    if (r === "restart") continue;
    if (r !== 0xFF) copyMemoryFast(P, wStoryModeNameOfMainCharacter, wStorySlotData, 8);
    yield* fadeOut(P, 32);
    return { a: r, f: r ? 0 : FZ };
  }
}
// the character select (main b = 0 or partner 1), storing the cursor registers it leaves as the ROM does
function* selectCharacter(P, partner) {
  const r = yield* farGen(P, BANK_CHARS, runCharacterSelectScreen(P, partner));
  wr(P, "charSelectCursorCol", r.de >> 8);
  wr(P, "charSelectCursorRow", r.de & 0xFF);
  return r.a;
}
const nameEntry = (P, slot, partner) =>
  farGen(P, BANK_CHARS, runNameEntryScreen(P, partner, u8(P, storyField(slot, STORY_RECORD_MUGSHOT))));
const promptConfirm = (P, slot) => P.runRom(BANK_CHAR_DATA, PromptCharDataConfirm, { a: slot });
// .loopB to .restore: returns 0 (done), $FF (backed out) or "restart"
function* setupMainAndPartner(P, savedSlot) {
  let state = "selectMain";
  for (;;) {
    switch (state) {
      case "selectMain": {                                   // .loopB
        const a = yield* selectCharacter(P, 0);
        if (a === 0xFF) { wr(P, "storyCharacterSlot", savedSlot); return 0xFF; }
        if (a !== SELECT_AGAIN) state = "confirmMain";
        break;
      }
      case "confirmMain":                                    // .loop2
        rom(P, FAR.RollStoryRandomByte, { a: 1 });
        if ((yield* promptConfirm(P, 0)).a) { state = "selectMain"; break; }
        rom(P, FAR.RollStoryRandomByte, { a: 2 });
        state = "nameMain";
        break;
      case "nameMain": {                                     // .loop3
        wr(P, "storyCharacterSlot", 0);
        if ((yield* nameEntry(P, 0, 0)).a) { state = "confirmMain"; break; }
        wr(P, "storyCharacterSlot", savedSlot);
        wr(P, "storyCharacterSlot", 1);
        if (far(P, BANK_SAVE, () => testSaveFlag(P, SAVEFLAG_OPENING_SEEN))) { state = "selectPartner"; break; }
        // the opening not seen yet: the partner is the main character's counterpart (sprite + 2), only named
        rom(P, FAR.InitPlayerRecordFromTemplate, { a: 1, d: (rd(P, "storyModeMainCharacterOverworldSprite") + 2) & 0xFF });
        if ((yield* nameEntry(P, 1, 1)).a) { state = "nameMain"; break; }
        wr(P, "storyCharacterSlot", savedSlot);
        return 0;
      }
      case "selectPartner": {                                // .loop4
        const a = yield* selectCharacter(P, 1);
        if (a === 0xFF) { wr(P, "storyCharacterSlot", savedSlot); return "restart"; }
        if (a !== SELECT_AGAIN) state = "confirmPartner";
        break;
      }
      case "confirmPartner":                                 // .loop5
        if ((yield* promptConfirm(P, 1)).a) { state = "selectPartner"; break; }
        if ((yield* nameEntry(P, rd(P, "storyCharacterSlot"), 1)).a) break;
        wr(P, "storyCharacterSlot", savedSlot);
        return 0;
    }
  }
}

// ---- the unused debug character select (a grid of the four created characters with mugshots) ----
// Unused_1b_FindCharSelectRosterEntry (1B:5FC4): Unused_18_FindRosterEntry on wCharSelectRoster. Returns its hl.
export const unusedFindCharSelectRosterEntry = (P, a, de) => rom(P, FAR.Unused_18_FindRosterEntry, { a, de, hl: P.A.charSelectRoster });
// Unused_1b_GetCharSelectRosterField (1B:5FCB): de = the word at character a's roster entry + de. hl kept.
export function unusedGetCharSelectRosterField(P, a, de) {
  const at = unusedFindCharSelectRosterEntry(P, a, de).hl;
  return { de: P.bus.u8(at + 1) << 8 | P.bus.u8(at) };
}
// Unused_1b_LoadCharSelectNavGrid (1B:5FD4) / Unused_1b_LoadCharSelectRosterTable (1B:5FE1): the tables into RAM
export const unusedLoadCharSelectNavGrid = P => copyMemoryBC(P, CharSelectNavGridTable, P.A.navGridBuffer, NAV_GRID_SIZE);
export const unusedLoadCharSelectRosterTable = P => copyMemoryBC(P, CharSelectRosterTable, P.A.charSelectRoster, wCharSelectRoster_SIZE);
// Unused_1b_LoadCharSelectScreenGfx (1B:5FEE): Unused_1b_LoadUnlockDebugScreenGfx's loader with CharSelectNavGridTable
// (not graphics) as every source: "decompressed" into WRAM, queued to VRAM, loaded as palettes
export function unusedLoadCharSelectScreenGfx(P) {
  decompressData(P, CharSelectNavGridTable, 0xD000);
  queueVRAMCopy(P, 0xD000, vTiles2 + VRAM_BANK1, 128);
  queueVRAMCopy(P, 0xD800, vTiles1 + VRAM_BANK1, 128);
  decompressData(P, CharSelectNavGridTable, 0xDC00);
  decompressData(P, CharSelectNavGridTable, 0xD800);
  return loadPaletteShadow(P, CharSelectNavGridTable, 0, 8);
}
// Unused_1b_StartCharSelectCursorTask (1B:6029): the cursor's graphics and its frame task
export function unusedStartCharSelectCursorTask(P) {
  rom(P, FAR.Unused_18_LoadCharSelectCursorGfx);
  registerFrameTask(P, 0x0A, Unused_1b_UpdateCharSelectCursorTask);
}
// Unused_1b_UpdateCharSelectCursorTask (1B:6035), a frame task: the cursor at the character's roster position
export function unusedUpdateCharSelectCursorTask(P) {
  const { de } = unusedGetCharSelectRosterField(P, rd(P, "charSelectChar"), 0x0004);
  rom(P, FAR.Unused_18_DrawCharSelectCursor, { a: rd(P, "charSelectChar"), de });
}
// Unused_1b_DrawCharSelectPrompt (1B:6045): 16 tiles queued from $D000, a box, and a prompt (text $0470, or 31:123
// for the partner)
export function unusedDrawCharSelectPrompt(P) {
  queueVRAMCopy(P, 0xD000, vTiles2, 16);
  rom(P, FAR.Unused_18_DrawBox, { hl: 0xD9E0, de: 0xDDE0, bc: 0x1403 });
  rom(P, FAR.Unused_18_RenderProportionalTextAt32, { hl: rd(P, "storyCharacterSlot") ? Text_31_123 : 0x0470, de: 0xDA01 });
}
// Unused_1b_DrawCharSelectMugshots (1B:606F): each unlocked roster character's mugshot and attributes at its place
export function unusedDrawCharSelectMugshots(P) {
  rom(P, FAR.Unused_1b_ResetMugshotPalettes);
  const scratch11 = 0xD58B;                                 // wCharRecordScratch + 11, through the bank mapped
  for (let hl = P.A.charSelectRoster; ; ) {
    const ch = u8(P, hl);
    rom(P, FAR.LoadCharacterRecordToBuffer, { a: ch, hl });
    if (!(rom(P, FAR.CheckCharacterUnlocked, { a: ch, hl }).f & FZ)) {
      rom(P, FAR.LoadCharMugshotToBuffer, { a: u8(P, scratch11), hl });
      rom(P, FAR.CopyMugshotBufferToVram, { de: unusedGetCharSelectRosterField(P, u8(P, hl), 0x0002).de, hl });
      const { de } = unusedGetCharSelectRosterField(P, u8(P, hl), 0x0006);
      const sum = ((u8(P, scratch11) * 2) & 0xFF) + 0xC1, c = sum & 0xFF, b = (0xC7 + (sum >> 8)) & 0xFF;   // bc = $C7C1 + 2 * id
      rom(P, FAR.Unused_1b_SetMugshotAttrs, { a: u8(P, b << 8 | c), bc: b << 8 | c, de, hl });
    }
    hl = (hl + ROSTER_ENTRY_SIZE) & 0xFFFF;
    if (u8(P, hl) === 0xFF) break;
  }
  rom(P, FAR.LoadCharacterRecordToBuffer, { a: rd(P, "charSelectChar") });
  rom(P, FAR.Unused_1b_StubNop_1b_01, { a: u8(P, scratch11) });
}
// Unused_1b_RunCharSelectLoop (1B:60BD): the debug character select: column d, row e of the nav grid; START or A
// sets up the record of the character (for player a & 1) and returns $FE / the character, B returns $FF; d, e the
// cursor
export function* unusedRunCharSelectLoop(P, player, col, row) {
  wr(P, "targetZoneX2", player & 1);
  clearFrameTasks(P);
  yield* advanceFrame(P);
  unusedLoadCharSelectNavGrid(P);
  unusedLoadCharSelectRosterTable(P);
  wr(P, "charSelectCol", col);
  wr(P, "charSelectRow", row);
  yield* unusedUpdateCharSelectSelection(P);
  wr(P, "charSelectPrevChar", rd(P, "charSelectChar"));
  yield* fadeOut(P, 32);
  disableLCDSafely(P);
  unusedLoadCharSelectScreenGfx(P);
  unusedDrawCharSelectMugshots(P);
  unusedDrawCharSelectPrompt(P);
  queueVRAMCopy(P, 0xDC00, vBGMap0 + VRAM_BANK1, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  queueVRAMCopy(P, 0xD800, vBGMap0, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  enableLCD(P);
  yield* fadeIn(P, 32);
  unusedStartCharSelectCursorTask(P);
  let a;
  for (;;) {
    P.wramBank(WRAM_STAGING);
    const edge = P.V.inputRisingEdge;
    if (edge & PADF_START) {
      rom(P, FAR.Unused_18_InitPlayerRecordForCharacter, { a: rd(P, "charSelectChar"), b: rd(P, "targetZoneX2") });
      sound(P, SFX_MENU_SELECT); a = 0xFE; break;
    }
    if (edge & PADF_A) {
      rom(P, FAR.Unused_18_InitPlayerRecordForCharacter, { a: rd(P, "charSelectChar"), b: rd(P, "targetZoneX2") });
      sound(P, SFX_MENU_SELECT); a = rd(P, "charSelectChar"); break;
    }
    if (edge & PADF_B) { sound(P, SFX_MENU_CANCEL); a = 0xFF; break; }
    unusedMoveCharSelectCursor(P);
    yield* unusedUpdateCharSelectSelection(P);
    rom(P, FAR.LoadCharacterRecordToBuffer, { a: rd(P, "charSelectChar") });
    yield* advanceFrame(P);
  }
  return { a, d: rd(P, "charSelectCol"), e: rd(P, "charSelectRow") };
}
// Unused_1b_UpdateCharSelectSelection (1B:6172): wCharSelectChar = the character at the cursor in the nav grid
// ($C7A0 + 8 * row + col); an empty cell ($FF) hangs the game (`jr z` onto itself), here a CPU that only takes
// interrupts. A generator only for that case.
export function* unusedUpdateCharSelectSelection(P) {
  wr(P, "charSelectPrevChar", rd(P, "charSelectChar"));
  const a = u8(P, 0xC7A0 + ((rd(P, "charSelectRow") * 8 + rd(P, "charSelectCol")) & 0xFF));
  if (a === 0xFF) for (;;) yield "cpuhalt";
  wr(P, "charSelectChar", a);
}
// Unused_1b_MoveCharSelectCursor (1B:6192): a direction moves the cursor in the nav grid (Unused_18_MoveGridCursor)
// until it lands on an unlocked character
export function unusedMoveCharSelectCursor(P) {
  const b = P.V.inputPressed;
  if (!(b & 0xF0)) return;
  sound(P, SFX_MENU_MOVE);
  let r = { b, d: rd(P, "charSelectCol"), e: rd(P, "charSelectRow") };
  for (;;) {
    r = rom(P, FAR.Unused_18_MoveGridCursor, { ...r, hl: P.A.navGridBuffer });
    r = rom(P, FAR.LoadCharacterRecordToBuffer, r);
    r = rom(P, FAR.CheckCharacterUnlocked, r);
    if (!(r.f & FZ)) break;
  }
  wr(P, "charSelectCol", r.d);
  wr(P, "charSelectRow", r.e);
}
// Unused_1b_RunDebugSaveDataFlow (1B:62F8): its dispatch constant (a = 1: `or a` not zero, bit 7 clear) sends it back
// to its own start for ever: the game spins re-requesting the menu music. The rest of the routine is never reached.
export function* unusedRunDebugSaveDataFlow(P) {
  for (;;) { sound(P, BGM_MENU); yield "cpuhalt"; }
}

export const HOOKS = [
  [BANK, 0x5FC4, hook((P, c) => ({ hl: unusedFindCharSelectRosterEntry(P, c.a, c.de).hl }))],
  [BANK, 0x5FCB, hook((P, c) => unusedGetCharSelectRosterField(P, c.a, c.de))],
  [BANK, 0x5FD4, hook(P => { unusedLoadCharSelectNavGrid(P); })],
  [BANK, 0x5FE1, hook(P => { unusedLoadCharSelectRosterTable(P); })],
  [BANK, 0x5FEE, hook(P => { unusedLoadCharSelectScreenGfx(P); })],
  [BANK, 0x6029, hook(P => unusedStartCharSelectCursorTask(P))],
  [BANK, 0x6035, hook(P => unusedUpdateCharSelectCursorTask(P))],
  [BANK, 0x6045, hook(P => unusedDrawCharSelectPrompt(P))],
  [BANK, 0x606F, hook(P => unusedDrawCharSelectMugshots(P))],
  [BANK, 0x60BD, hookGen((P, c) => unusedRunCharSelectLoop(P, c.a, c.d, c.e))],
  [BANK, 0x6172, hookGen(P => unusedUpdateCharSelectSelection(P))],
  [BANK, 0x6192, hook(P => unusedMoveCharSelectCursor(P))],
  [BANK, 0x61BA, hookGen(P => runNewGameSetup(P))],
  [BANK, 0x62F8, hookGen(P => unusedRunDebugSaveDataFlow(P))],
];
