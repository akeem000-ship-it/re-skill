// An unused pause menu of bank $1a, built from the text engine's menu windows: a window of rows (character data,
// game progress, message speed, music, quit) whose handlers come from a table; the message speed and the music
// setting are shown beside their rows (tile writes into the window), left / right change them, and the quit row
// asks twice ("save and quit?", "quit?") through the dialogue window. A second, music-only menu shares the loop.
// Nothing in the game calls slot $4000 (Unused_1a_RunMinigameModePauseMenu) or UnusedRunMusicSettingMenu.
// RunPauseMenuWindow: CreateMenuWindowFromText (hl text, de cell), then each pick through
// Unused_05_RunMenuSelectionShared: a row with its wMenuKeepOpenRowMask bit set keeps the window open; the row's
// handler (bc table) either goes back to the loop or ends the menu.
// Port of src/engine/menus/pause/options_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own. (Its slot table's other entries belong to
// the debug and character-data screens of the bank.)
// Tests: web/tests/port/routines_menus_pause.mjs (the routines that do not wait); no recording reaches the menu.
import {
  FAR, HOME, rom, romWait, home, wram, rd, wr, sound, copyMemoryBC, hook, hookGen, setFlag, clearFlag, WRAM_TEXT,
  vBGMap0, SFX_MENU_MOVE, SFX_OPTION_TOGGLE, STORYLOC_MAIN_MENU, STORYENTRY_NONE, FLAG_VRAM_UPDATE_BUSY,
  FLAG_PAUSE_OPTIONS_MENU_OPEN, FLAG_MINIGAME_PAUSE_MENU_OPEN,
} from "./defs.js";
import { queueBGTileWrite } from "../../home/memory.js";

const BANK = 0x1A;
const MessageSpeedSettingPtrs = 0x416C, MusicSettingPtrs = 0x41DD;
// routines of other banks (the story script commands of bank $0a)
const WaitScriptFrames = [0x0A, 0x413F], InitDialogueTextCursor = [0x0A, 0x4156];
const ScriptShowSpeakerDialogueRestoreBG = [0x0A, 0x41C1];
const Text_31_156 = 0x049C, Text_31_157 = 0x049D;               // "save and quit?" / "quit?"
const MINIGAME_MENU_TEXT = 0x049A, MUSIC_MENU_TEXT = 0x049B;
const SPEAKER_NONE = 0x80, MENU_SELECTION_NONE = 0xFF, YES = 0;
const SHOW_MESSAGE_SPEED = 0x20, OPTION_ROW_BITS = 0x0F, OPTION_KEEP_OPEN = 0xC0;
const MESSAGE_SPEED_INSTANT = 0x80, MESSAGE_SPEEDS = 3;
const QUIT_ROW = 3;
const TILE_WRITE_ATTR = 0x80;
const WINDOW_SHADOW_TO_VRAM = 0x3000;                           // a cell of the window maps ($D000-) + $3000 + $9800
// the message speed's three tiles (fast, normal, slow) and the music's (on, off)
const SPEED_TILES = [[0x8A, 0x94, 0x72], [0x8C, 0x82, 0x73], [0x75, 0x7F, 0x72]];
const MUSIC_ON_TILE = 0xCC, MUSIC_OFF_TILE = 0xDD;

// Unused_1a_RunMinigameModePauseMenu (1A:4014), slot $4000: the menu with the message speed shown instant
// meanwhile; returns a = wPauseMenuIsMinigame
export function* unusedRunMinigameModePauseMenu(P) {
  const bank = P.V.wramBank;
  unusedForceInstantMessageSpeed(P);
  const menu = unusedBuildMinigameModePauseMenu(P);
  yield* unusedRunPauseMenuWindow(P, menu);
  unusedRestoreMessageSpeed(P);
  wram(P, bank);
  return { a: rd(P, "pauseMenuIsMinigame") };
}
// Unused_1a_RunPauseMenuWindow (1A:402C): the menu window loop (see the header). menu: { text (hl), table (bc),
// cell (de) }.
export function* unusedRunPauseMenuWindow(P, menu) {
  for (;;) {                                                       // (a handler's `jp Unused_1a_RunPauseMenuWindow`)
    wr(P, "pauseMenuIsMinigame", 0);
    wram(P, WRAM_TEXT);
    const { a: window } = rom(P, FAR.CreateMenuWindowFromText, { hl: menu.text, bc: menu.table, de: menu.cell });
    setFlag(P, FLAG_VRAM_UPDATE_BUSY);
    wr(P, "pauseMenuWindowId", window);
    rom(P, FAR.RestoreShadowTilemap);
    rom(P, FAR.RenderMenuWindowText);
    clearFlag(P, FLAG_VRAM_UPDATE_BUSY);
    let table = menu.table, next;
    for (;;) {                                                     // .menuLoop
      unusedDrawPauseMenuSettingValues(P);
      const r = yield* romWait(P, FAR.Unused_05_RunMenuSelectionShared, { a: rd(P, "pauseMenuWindowId"), bc: table });
      const pick = r.a;
      table = r.bc;
      if (!(pick !== MENU_SELECTION_NONE && keepsWindowOpen(P))) {
        setFlag(P, FLAG_VRAM_UPDATE_BUSY);
        rom(P, FAR.CloseWindow, { a: rd(P, "pauseMenuWindowId") });
        clearFlag(P, FLAG_VRAM_UPDATE_BUSY);
      }
      if (pick === MENU_SELECTION_NONE) { unusedResetPauseMenuState(P); return; }
      const handler = P.rom.u16(BANK, (table + ((pick * 2) & 0xFF)) & 0xFFFF);
      next = yield* runHandler(P, handler);
      if (next === "done") { unusedResetPauseMenuState(P); return; }
      if (next === "restart") break;
      table = next;
    }
    menu = unusedBuildMinigameModePauseMenu(P, true);
  }
}
// a row whose wMenuKeepOpenRowMask bit is set (mask bit 7: the mask is on) keeps the window open: the mask's low
// 7 bits rotated right (row + 1) times, then left once, bit 0
function keepsWindowOpen(P) {
  const mask = rd(P, "menuKeepOpenRowMask");
  if (!(mask & 0x80)) return false;
  let b = mask & 0x7F;
  for (let n = ((rd(P, "menuCursorRow") + 1) & 0xFF) || 0x100; n > 0; n--) b = ((b >> 1) | (b << 7)) & 0xFF;
  b = ((b << 1) | (b >> 7)) & 0xFF;
  return (b & 1) !== 0;
}
// the handlers of the two tables: "done" ends the menu, "restart" rebuilds it, a table goes back to the loop
function* runHandler(P, handler) {
  switch (handler) {
    case 0x4176: return yield* unusedMessageSpeedSettingHandler0(P);
    case 0x4195: return yield* unusedShowGameProgressScreenThunk(P);
    case 0x41B2: return unusedAdjustMessageSpeedSettingThunk(P);
    case 0x41C4: return unusedToggleMusicSettingThunk(P);
    case 0x41D6: return yield* unusedMessageSpeedSettingHandler4(P);
    case 0x41E1: return unusedMusicSettingHandler(P, 0);
    case 0x420F: return unusedMusicSettingHandler(P, 1);
    default: throw new Error(`Unused_1a_RunPauseMenuWindow: no handler at ${handler.toString(16)}`);
  }
}
// Unused_1a_ResetPauseMenuState (1A:4092)
export function unusedResetPauseMenuState(P) {
  wr(P, "menuInitialRow", 0);
  wr(P, "menuAdjustRowMask", 0);
  wr(P, "pauseMenuOptionBits", 0);
  wr(P, "menuKeepOpenRowMask", 0);
}
// Unused_1a_DrawPauseMenuSettingValues (1A:40A0): with option bit 5, the message speed's word beside its row, the
// music value and the sound bits in hex (debug text) and the music's on / off tile. Every register kept.
export function unusedDrawPauseMenuSettingValues(P) {
  if (!(rd(P, "pauseMenuOptionBits") & SHOW_MESSAGE_SPEED)) return;
  const speed = rd(P, "messageSpeed") & 0x7F;
  const tiles = SPEED_TILES[speed === 0 ? 0 : speed === 1 ? 1 : 2];
  tiles.forEach((tile, i) => unusedQueueWindowTileWrite(P, tile, (0x0A + i) << 8 | 0x05));
  const music = P.V.music;
  home(P, HOME.PrintHexByte, { a: music, de: 0x0404 });
  home(P, HOME.PrintHexByte, { a: rd(P, "soundOptionBits"), de: 0x0405 });
  unusedQueueWindowTileWrite(P, music & 1 ? MUSIC_ON_TILE : MUSIC_OFF_TILE, 0x0B07);
}
// Unused_1a_QueueWindowTileWrite (1A:413C): tile l at cell de of the menu window, to VRAM (QueueBGTileWrite)
export function unusedQueueWindowTileWrite(P, tile, cell) {
  return queueBGTileWrite(P, TILE_WRITE_ATTR << 8 | tile, unusedGetTilemapBufferCellDest(P, cell));
}
// Unused_1a_GetTilemapBufferCellDest (1A:4145): the VRAM address of cell de of the menu window (its origin from
// the window struct + de, through GetTilemapCellAddress). Every register kept but de.
export function unusedGetTilemapBufferCellDest(P, cell) {
  const { hl } = rom(P, FAR.GetWindowStructPtr, { a: rd(P, "pauseMenuWindowId") });
  const d = (P.bus.u8(hl) + (cell >> 8)) & 0xFF, e = (P.bus.u8((hl + 1) & 0xFFFF) + cell) & 0xFF;
  const { de } = rom(P, FAR.GetTilemapCellAddress, { d, e });
  return (de + WINDOW_SHADOW_TO_VRAM + vBGMap0) & 0xFFFF;
}

// leaving the menu for another screen: the player's position is the spawn point when the overworld comes back
function keepPlayerPosition(P) {
  copyMemoryBC(P, P.A.storyModePlayersXPosition, P.A.storyModeSpawnPosition, 5);
  wr(P, "storyModeEntryPoint", STORYENTRY_NONE);
  wr(P, "unusedExitTriggerIdMirror", STORYENTRY_NONE);
  wr(P, "storyModeExitTriggerRequest", STORYENTRY_NONE);
}
// Unused_1a_MessageSpeedSettingHandler0 (1A:4176): the character data screen
export function* unusedMessageSpeedSettingHandler0(P) {
  yield* romWait(P, FAR.ShowCharDataScreen, { a: 1 });
  keepPlayerPosition(P);
  return "done";
}
// Unused_1a_ShowGameProgressScreenThunk (1A:4195): the game progress screen
export function* unusedShowGameProgressScreenThunk(P) {
  yield* romWait(P, FAR.ShowGameProgressScreen);
  keepPlayerPosition(P);
  return "done";
}
// Unused_1a_AdjustMessageSpeedSettingThunk (1A:41B2) / Unused_1a_ToggleMusicSettingThunk (1A:41C4): change the
// setting, back to the loop on the same row
export function unusedAdjustMessageSpeedSettingThunk(P) {
  unusedAdjustMessageSpeedSetting(P);
  wr(P, "menuInitialRow", rd(P, "menuCursorRow"));
  return MessageSpeedSettingPtrs;
}
export function unusedToggleMusicSettingThunk(P) {
  unusedToggleMusicSetting(P);
  wr(P, "menuInitialRow", rd(P, "menuCursorRow"));
  return MessageSpeedSettingPtrs;
}
// Unused_1a_MessageSpeedSettingHandler4 (1A:41D6): quit. "Save and quit?": yes saves the story and leaves for the
// main menu; B rebuilds the menu on the quit row. No: "quit?": yes leaves for the main menu, no rebuilds the menu.
export function* unusedMessageSpeedSettingHandler4(P) {
  wr(P, "suppressMinigamePauseFlag", 0);
  clearFlag(P, FLAG_MINIGAME_PAUSE_MENU_OPEN);
  let answer = yield* askYesNo(P, Text_31_156);
  if (answer === YES) {
    wr(P, "saveAndQuitRequest", 1);
    wr(P, "messageSpeed", rd(P, "messageSpeed") & ~MESSAGE_SPEED_INSTANT);
    rom(P, FAR.SaveStoryReturnPoint, { bc: 0xFFFF });
    rom(P, FAR.SaveStorySlotWithTimer);
    wr(P, "storyModeCurrentLocation", STORYLOC_MAIN_MENU);
    wr(P, "storyModeEntryPoint", 1);
    wr(P, "unusedExitTriggerIdMirror", 0xFF);
    wr(P, "storyModeExitTriggerRequest", 0xFF);
    return "done";
  }
  if (answer !== 0xFF) {
    answer = yield* askYesNo(P, Text_31_157, 1);
    if (answer === YES) {
      wr(P, "storyModeCurrentLocation", STORYLOC_MAIN_MENU);
      wr(P, "storyModeEntryPoint", STORYENTRY_NONE);
      wr(P, "unusedExitTriggerIdMirror", 0xFF);
      wr(P, "storyModeExitTriggerRequest", 0xFF);
      return "done";
    }
  }
  return "restart";
}
// a question in the dialogue window (script_set_text, script_speak_restore, RunDialogueYesNoPrompt,
// ScriptCloseDialogueWindow, script_wait_frames 5); initialRow: wMenuInitialRow set before the prompt
function* askYesNo(P, text, initialRow = null) {
  yield* romWait(P, InitDialogueTextCursor, { hl: text });
  yield* romWait(P, ScriptShowSpeakerDialogueRestoreBG, { a: SPEAKER_NONE });
  if (initialRow !== null) wr(P, "menuInitialRow", initialRow);
  const answer = yield* romWait(P, FAR.RunDialogueYesNoPrompt);
  const { a } = yield* romWait(P, FAR.ScriptCloseDialogueWindow, { a: answer.a });   // (its a is the one tested)
  yield* romWait(P, WaitScriptFrames, { a: 5 });
  return a;
}
// Unused_1a_MusicSettingHandler0 (1A:41E1) / ...1 (1A:420F): row 0 / 1 of the music menu: a click unless the row
// bits are 0 or 3 (the bit flipped is not kept: the bits are read again); back to the loop, the menu kept open
export function unusedMusicSettingHandler(P, row) {
  const bits = rd(P, "pauseMenuOptionBits") & OPTION_ROW_BITS;
  if (bits && bits !== 3) sound(P, SFX_OPTION_TOGGLE);
  wr(P, "pauseMenuOptionBits", rd(P, "pauseMenuOptionBits") | OPTION_KEEP_OPEN);
  wr(P, "menuInitialRow", rd(P, "menuCursorRow"));
  return MusicSettingPtrs;
}
// UnusedRunMusicSettingMenu (1A:423E): the music-only menu. Nothing calls it.
export function* unusedRunMusicSettingMenu(P) {
  unusedResetPauseMenuState(P);
  wr(P, "pauseMenuOptionBits", OPTION_KEEP_OPEN);
  wr(P, "menuAdjustRowMask", 0x83);
  wr(P, "menuKeepOpenRowMask", 0x83);
  setFlag(P, FLAG_PAUSE_OPTIONS_MENU_OPEN);
  yield* unusedRunPauseMenuWindow(P, { text: MUSIC_MENU_TEXT, table: MusicSettingPtrs, cell: 0x0305 });
  unusedResetPauseMenuState(P);
  wr(P, "pauseMenuOptionBits", rd(P, "pauseMenuOptionBits") | 0x80);
  clearFlag(P, FLAG_PAUSE_OPTIONS_MENU_OPEN);
}
// Unused_1a_AdjustMessageSpeedSetting (1A:426B): row bits 1 / 2 (right / left): the speed one up / down, wrapping
// (0-2, kept instant: bit 7 set)
export function unusedAdjustMessageSpeedSetting(P) {
  const bits = rd(P, "pauseMenuOptionBits") & OPTION_ROW_BITS;
  if (bits === 1) {
    sound(P, SFX_MENU_MOVE);
    const v = ((rd(P, "messageSpeed") & 0x7F) + 1) & 0xFF;
    wr(P, "messageSpeed", v === MESSAGE_SPEEDS ? MESSAGE_SPEED_INSTANT : v | MESSAGE_SPEED_INSTANT);
  } else if (bits === 2) {
    sound(P, SFX_MENU_MOVE);
    const v = ((rd(P, "messageSpeed") & 0x7F) - 1) & 0xFF;
    wr(P, "messageSpeed", v & 0x80 ? MESSAGE_SPEED_INSTANT | (MESSAGE_SPEEDS - 1) : v | MESSAGE_SPEED_INSTANT);
  }
}
// Unused_1a_ToggleMusicSetting (1A:42A9): wSoundOptionBits bit 0 flipped
export function unusedToggleMusicSetting(P) {
  sound(P, SFX_MENU_MOVE);
  const b = rd(P, "soundOptionBits");
  wr(P, "soundOptionBits", (b & 0xFE) | ((b & 1) ^ 1));
}
// Unused_1a_ForceInstantMessageSpeed (1A:42BC) / Unused_1a_RestoreMessageSpeed (1A:42C5): wMessageSpeed bit 7
export function unusedForceInstantMessageSpeed(P) { wr(P, "messageSpeed", rd(P, "messageSpeed") | MESSAGE_SPEED_INSTANT); }
export function unusedRestoreMessageSpeed(P) { wr(P, "messageSpeed", rd(P, "messageSpeed") & ~MESSAGE_SPEED_INSTANT); }
// Unused_1a_BuildMinigameModePauseMenu (1A:437C): the main menu's state (rows 2 and 3 adjust and keep the window
// open); returns its text, table and cell. rebuild: from the quit row's answers (wMenuInitialRow = the quit row;
// the menu flag not set again when wSuppressMinigamePauseFlag is)
export function unusedBuildMinigameModePauseMenu(P, rebuild = false) {
  unusedResetPauseMenuState(P);
  wr(P, "pauseMenuOptionBits", 0xA0);
  wr(P, "menuAdjustRowMask", 0x8C);
  wr(P, "menuKeepOpenRowMask", 0x8C);
  setFlag(P, FLAG_MINIGAME_PAUSE_MENU_OPEN);
  if (rebuild) {
    wr(P, "menuInitialRow", QUIT_ROW);
    if (!rd(P, "suppressMinigamePauseFlag")) setFlag(P, FLAG_MINIGAME_PAUSE_MENU_OPEN);
  }
  return { text: MINIGAME_MENU_TEXT, table: MessageSpeedSettingPtrs, cell: 0x0304 };
}

const B = BANK;
export const HOOKS = [
  [B, 0x4014, hookGen(P => unusedRunMinigameModePauseMenu(P))],
  [B, 0x402C, hookGen((P, c) => unusedRunPauseMenuWindow(P, { text: c.hl, table: c.bc, cell: c.de }))],
  [B, 0x4092, hook(P => { unusedResetPauseMenuState(P); return { a: 0 }; })],
  [B, 0x40A0, hook(P => { unusedDrawPauseMenuSettingValues(P); })],
  [B, 0x413C, hook((P, c) => { unusedQueueWindowTileWrite(P, c.l, c.de); })],
  [B, 0x4145, hook((P, c) => ({ de: unusedGetTilemapBufferCellDest(P, c.de) }))],
  [B, 0x426B, hook(P => { unusedAdjustMessageSpeedSetting(P); })],
  [B, 0x42A9, hook(P => { unusedToggleMusicSetting(P); })],
  [B, 0x42BC, hook(P => { unusedForceInstantMessageSpeed(P); })],
  [B, 0x42C5, hook(P => { unusedRestoreMessageSpeed(P); })],
  [B, 0x423E, hookGen(P => unusedRunMusicSettingMenu(P))],
  [B, 0x437C, hook(P => { const m = unusedBuildMinigameModePauseMenu(P); return { hl: m.text, bc: m.table, de: m.cell }; })],
];
