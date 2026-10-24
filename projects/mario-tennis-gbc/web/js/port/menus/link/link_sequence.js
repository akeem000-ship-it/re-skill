// Bank $38: the name entry's buffer editing (a letter appended from the charset under the cursor, the last letter
// deleted, the name drawn, its length, the trailing spaces trimmed, the blinking underline) and the link match
// sequence: the match rules, the unlock flags exchanged and merged with the partner's, the link character select,
// the court select, the characters exchanged, then the match (RunLinkMatchSequence).
// Port of src/engine/menus/link/link_sequence_38.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables are read from the ROM.
// Tests: the name entry routines in the lockstep on out/port/cs_story_new*.mtrec, story1.mtrec and story_walk1.mtrec
// (a story file's name typed, letters deleted); the rest by web/tests/port/routines_menus_misc.mjs (the link
// sequence itself needs a link partner: the emulator has none, so RunLinkMatchSequence, ExchangeLinkCharSelection
// and ExchangeLinkUnlockFlags are unverified).
import {
  FZ, FN, FAR, HOME, farGen, rom, romWait, home, homeWait, near, wram, u8, w8, idx, cpFlags, sound, clearFrameTasks,
  enableLCD, beginFadeIn, fadeOut, setFlag, clearFlag, setFlagF, queueCopy, disableLCDSafely, hook, hookGen,
  WRAM_SCREEN, WRAM_COURT_PLANES, TILEMAP_WIDTH, vBGMap0, wShadowTilemap, OAM_BANK1, SFX_MENU_SELECT, MENUSLIDE_BACK,
  MENUSLIDE_FORWARD, FLAG_DOUBLES, chain, nested, getRegs,
} from "../equipment/defs.js";
import { getMenuCursorIndex } from "../common/cursors.js";
import { drawNameWithDiacritics } from "../char_select/matchtype.js";
import { queueSprite } from "../../home/fade.js";
import { clearBytes } from "../../home/system.js";
import { initSerialLink, resetSerialState } from "../../home/link.js";
import { runLinkMatchRulesMenu, restoreMenuScreenAndFadeIn } from "./rules.js";

export const BANK = 0x38;
const BANK_RULES = 0x3E;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF);
const NameEntryCharset_38 = 0x71B6, MatchTypeSettingsLinkTable0 = 0x751D, MatchTypeSettingsLinkTable1 = 0x7520;
const NAME_CELL = wShadowTilemap + 6 * TILEMAP_WIDTH + 7, NAME_MAX = 7, NAME_BUFFER_END = 10;
const CHARSET_COLUMNS = 15;
const DAKUTEN = 0xDE, HANDAKUTEN = 0xDF, MARK_KEY_DAKUTEN = 0x9E, MARK_KEY_HANDAKUTEN = 0x9F, MARK_KEY_TO_MARK = 0x40;
const BLANK = 0x20;
const DONE_CURSOR_X = 0x0A, DONE_CURSOR_Y = 0x05;          // the "end" key, where a full name moves the cursor
const UNDERLINE_TILE = 0x10, UNDERLINE_ATTR = OAM_BANK1 | 2, UNDERLINE_XY = 0x3C38, BLINK_BIT = 0x10;
const GAMEMODE_LINK_MATCH = 0x09, CHAR_NINA = 0x01;
const LINKSTATE_MASTER = 1, LINKSTATE_SLAVE = 2;
const EXCHANGE_SINGLES = 0x00, EXCHANGE_DOUBLES = 0x40;    // ExchangeLinkCharSelection's c: the main or partner block
const BLOCK_WITH_COURTS = 0x26, BLOCK_PARTNERS = 0x25;     // the block lengths sent
const UNLOCK_BYTES = 4, CHAR_FLAGS = 8, COURT_FLAGS_AT = 15, ITEM_FLAGS_AT = 23, CHAR_UNLOCK_FLAGS_SIZE = 0x28;
const CHAR_GRID_ENTRIES_SIZE = 0x80, CREATED_RECORD_SIZE = 0x20, CREATED_RECORD_LEVEL = 2;
// bank $38's character-select routines (menus/char_select) and the rest, by address
const BuildCharUnlockFlags = 0x5A82, RunLinkCharSelectScreen = [0x38, 0x63BD];
const ComputeUnlockedCourtFlags = [0x3E, 0x69A0], LoadCourtSelectGraphics = [0x3E, 0x5D11];
const RunLinkCourtSelect4Menu = [0x3E, 0x5C38], RunLinkCourtSelect9Menu = [0x3E, 0x65C9];
const RunMatch = [0x08, 0x4190], ResyncLinkSession = [0x07, 0x4A51], ExchangeLinkDataBlock = [0x07, 0x496E];
const PrintHexByte = 0x1AB7;

// ---- the name entry ----
// DrawEnteredName (38:728F): the name buffer drawn over 7 blank cells at (7, 6) of the WRAM 3 map
export function drawEnteredName(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  for (let i = 0; i < NAME_MAX; i++) w8(P, NAME_CELL + i, BLANK);
  const r = drawNameWithDiacritics(P, P.A.nameEntryBuffer, NAME_CELL);
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// AppendCharToName (38:72B3): the charset key under the cursor (a 15-wide grid) appended to the name; the mark keys
// ($9E / $9F) append the dakuten / handakuten ($DE / $DF). When the name is full the key replaces the last letter
// (with its mark). The name redrawn and queued, SFX_MENU_SELECT; a 7-letter name moves the cursor to "end".
// (The ROM picks the charset by wScreenAttrmap's first byte in WRAM 2, but both choices are NameEntryCharset_38.)
export function appendCharToName(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  let hl = P.A.nameEntryBuffer;
  while (u8(P, hl)) hl = (hl + 1) & 0xFFFF;
  const { a: key, b: row } = getMenuCursorIndex(P, CHARSET_COLUMNS);
  wram(P, WRAM_COURT_PLANES);                                       // (to read wScreenAttrmap: see above)
  let ch = rb(P, idx(NameEntryCharset_38, key));
  if (ch === MARK_KEY_DAKUTEN || ch === MARK_KEY_HANDAKUTEN) ch = (ch + MARK_KEY_TO_MARK) & 0xFF;
  wram(P, WRAM_SCREEN);
  if (isNameBufferFull(P).a) {
    hl = (hl - 1) & 0xFFFF;
    const last = u8(P, hl);
    if (last === DAKUTEN || last === HANDAKUTEN) { w8(P, hl, 0); hl = (hl - 1) & 0xFFFF; }
  }
  w8(P, hl, ch);
  const r = { ...getRegs(P.cpu), b: row, d: ch };
  chain(r, nested(P, 1, () => drawEnteredName(P, entryF)));
  const src = wShadowTilemap + 5 * TILEMAP_WIDTH, dest = vBGMap0 + 5 * TILEMAP_WIDTH;
  chain(chain(r, { hl: src, de: dest }), queueCopy(P, src, dest, 2 * TILEMAP_WIDTH / 16));
  sound(P, SFX_MENU_SELECT);
  if (getEnteredNameLength(P).a === NAME_MAX) { P.V.menuCursorY = DONE_CURSOR_Y; P.V.menuCursorX = DONE_CURSOR_X; }
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// DeleteLastNameChar (38:7341): the last letter (and the marks after it) cleared, the name redrawn and queued
export function deleteLastNameChar(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  let r = {};
  if (getEnteredNameLength(P).a) {
    wram(P, WRAM_SCREEN);
    let hl = P.A.nameEntryBuffer;
    while (u8(P, hl)) hl = (hl + 1) & 0xFFFF;
    let ch;
    do {
      hl = (hl - 1) & 0xFFFF;
      ch = u8(P, hl);
      w8(P, hl, 0);
    } while (ch === DAKUTEN || ch === HANDAKUTEN);
    drawEnteredName(P);
    r = queueCopy(P, wShadowTilemap + 5 * TILEMAP_WIDTH, vBGMap0 + 5 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  }
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// IsNameBufferFull (38:7379): a = $FF when the name has 7 letters, else 0
export function isNameBufferFull(P) {
  const n = getEnteredNameLength(P).a;
  return n >= NAME_MAX ? { a: 0xFF, f: cpFlags(n, NAME_MAX) } : { a: 0, f: FZ };
}
// DrawNameEntryUnderlineSprites (38:7385), a frame task: an underline under each of the 7 cells, the one where the
// next letter goes blinking (every 16 frames)
export function drawNameEntryUnderlineSprites(P) {
  const n = getEnteredNameLength(P).a;
  let x = UNDERLINE_XY >> 8, hl;
  const y = UNDERLINE_XY & 0xFF;
  for (let c = 0; c < NAME_MAX; c++) {
    if (n !== c || P.V.vBlankCounter & BLINK_BIT) hl = queueSprite(P, UNDERLINE_ATTR, UNDERLINE_TILE, x, y).hl;
    x = (x + 8) & 0xFF;
  }
  return { a: NAME_MAX, b: n, c: NAME_MAX, d: x, e: y, hl, f: FZ | FN };
}
// TrimTrailingSpacesFromName (38:73AE): from the buffer's last byte back, spaces become 0 until a letter
export function trimTrailingSpacesFromName(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  let hl = (P.A.nameEntryBuffer + NAME_BUFFER_END) & 0xFFFF;
  for (;;) {
    const ch = u8(P, hl);
    if (ch === BLANK) { w8(P, hl, 0); hl = (hl - 1) & 0xFFFF; continue; }
    if (ch) break;
    hl = (hl - 1) & 0xFFFF;
  }
  wram(P, bank);
  return { a: bank, hl, f: entryF };
}
// GetEnteredNameLength (38:73CF): a = the letters in the name (marks not counted); bc, hl kept
export function getEnteredNameLength(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  let n = 0;
  for (let hl = P.A.nameEntryBuffer; ; hl = (hl + 1) & 0xFFFF) {
    const ch = u8(P, hl);
    if (!ch) break;
    if (ch !== DAKUTEN && ch !== HANDAKUTEN) n = (n + 1) & 0xFF;
  }
  wram(P, bank);
  return { a: n, f: entryF };
}
// GetActiveStoryNameBuffer (38:73FA): bc = the story character's name (the main character's or the partner's)
export function getActiveStoryNameBuffer(P) {
  const slot = P.V.storyCharacterSlot;
  return { a: slot, bc: slot ? P.A.storyModeNameOfPartnerCharacter : P.A.storyModeNameOfMainCharacter, f: slot ? 0 : FZ };
}

// ---- the link match ----
// RunLinkMatchSequence (38:7408), slot $4010: see the header. Returns a = 1 after the match, $FF if the rules menu
// was left with B.
export function* runLinkMatchSequence(P) {
  let r;
  rules: for (;;) {
    r = yield* farGen(P, BANK_RULES, runLinkMatchRulesMenu(P));
    if (r.a === 0xFF) break;
    yield* fadeOut(P, 16);
    for (;;) {                                                       // .startMatch
      const bank = P.V.wramBank;
      wram(P, WRAM_SCREEN);
      clearBytes(P, P.A.charGridEntries, CHAR_GRID_ENTRIES_SIZE);
      near(P, BuildCharUnlockFlags);
      packUnlockFlagsForLink(P);
      yield* exchangeLinkUnlockFlags(P);
      mergeLinkUnlockFlags(P);
      unpackUnlockFlagsFromLink(P);
      wram(P, bank);
      applyMatchTypeSettingsLink(P);
      const chosen = (yield* romWait(P, RunLinkCharSelectScreen)).a;
      P.V.gameMode = GAMEMODE_LINK_MATCH;
      storeLinkMatchCharInfo(P);
      if (chosen === 0xFF) {
        yield* farGen(P, BANK_RULES, restoreMenuScreenAndFadeIn(P));
        P.V.menuSlideDirection = MENUSLIDE_BACK;
        continue rules;
      }
      rom(P, ComputeUnlockedCourtFlags);
      yield* exchangeLinkCharSelection(P, EXCHANGE_SINGLES);
      disableLCDSafely(P);
      rom(P, FAR.LoadMenuFontGfx);
      yield* romWait(P, FAR.ResetScreenAndTextWindows);
      rom(P, LoadCourtSelectGraphics);
      enableLCD(P);
      beginFadeIn(P, 16);
      P.V.linkExchangeActive = 0;
      resetSerialState(P);
      P.V.menuSlideDirection = MENUSLIDE_FORWARD;
      applyMatchTypeSettingsLink(P);
      const bonus = P.V.unlockedCourtMask | P.V.linkPartnerCourtMask;
      const court = (yield* romWait(P, bonus ? RunLinkCourtSelect9Menu : RunLinkCourtSelect4Menu)).a;
      if (court === 0xFF) continue;
      P.V.currentlyUsedCourt = court;
      yield* fadeOut(P, 16);
      P.V.matchPlayerChar = CHAR_NINA;
      P.V.matchOpponentChar = CHAR_NINA;
      if (P.V.matchIsDoubles) yield* exchangeLinkCharSelection(P, EXCHANGE_DOUBLES);
      clearFrameTasks(P);
      P.V.linkExchangeActive = 0;
      resetSerialState(P);
      home(P, HOME.EnableTimerInterrupt);
      P.V.linkSessionActive = 1;
      r = { ...(yield* romWait(P, RunMatch)), a: 1 };
      break rules;
    }
  }
  initSerialLink(P);
  return { a: r.a, f: r.f };
}
// ApplyMatchTypeSettingsLink (38:74E3): the match rules chosen (wMatchFormat*) into the match settings: sets and
// games by MatchTypeSettingsLinkTable0/1, doubles with four characters on court (FLAG_DOUBLES) or singles with two
export function applyMatchTypeSettingsLink(P) {
  const { V } = P;
  V.matchTypeNumberOfSets = rb(P, idx(MatchTypeSettingsLinkTable0, V.matchFormatSets));
  const hl = idx(MatchTypeSettingsLinkTable1, V.matchFormatGames);
  V.matchTypeNumberOfGames = rb(P, hl);
  V.matchIsDoubles = V.matchFormatDoubles;
  if (V.matchFormatDoubles) { V.onCourtCharCount = 4; setFlag(P, FLAG_DOUBLES); }
  else { V.onCourtCharCount = 2; clearFlag(P, FLAG_DOUBLES); }
  return { a: V.onCourtCharCount, hl, f: setFlagF(P) };
}
// The link's frame resync before an exchange: the frame tasks and serial state reset, the sound stopped, the
// session resynced and two link frames run; the master waits a VBlank more
function* resyncForExchange(P) {
  clearFrameTasks(P);
  P.V.linkExchangeActive = 0;
  resetSerialState(P);
  sound(P, 0x50);                                                    // SFX_STOP
  sound(P, 0x00);                                                    // BGM_NONE
  yield* romWait(P, ResyncLinkSession);
  yield* romWait(P, FAR.RunLinkInputFrame);
  yield* romWait(P, FAR.RunLinkInputFrame);
  P.V.linkExchangeActive = 0;
  resetSerialState(P);
  if (P.V.linkState === LINKSTATE_MASTER) yield* homeWait(P, HOME.WaitVBlank);
}
// ExchangeLinkCharSelection (38:7522): the characters chosen exchanged with the partner: c = 0, the main
// characters' block ($26 bytes from the court mask before wPlayer*CurrentMainCharacter, ours carrying our unlocked
// courts; the partner's court mask kept in wLinkPartnerCourtMask) or c = $40, the partners' ($25 bytes). Each side
// sends its own player's block and receives the other's (the master is player 1). The debug text shows the ids.
export function* exchangeLinkCharSelection(P, which) {
  yield* resyncForExchange(P);
  const state = P.V.linkState;
  if (which !== EXCHANGE_SINGLES && which !== EXCHANGE_DOUBLES) yield* homeWait(P, HOME.LinkErrorReset);
  if (state !== LINKSTATE_SLAVE && state !== LINKSTATE_MASTER) yield* homeWait(P, HOME.LinkErrorReset);
  const p1 = P.A.player1CurrentMainCharacter, p2 = P.A.player2CurrentMainCharacter;
  let hl = state === LINKSTATE_SLAVE ? p1 : p2, de = state === LINKSTATE_SLAVE ? p2 : p1, length;
  if (which === EXCHANGE_SINGLES) {
    hl = (hl - 1) & 0xFFFF; de = (de - 1) & 0xFFFF;                 // (from the court mask byte)
    home(P, PrintHexByte, { a: P.V.player1CurrentMainCharacter, de: 0x0A01 });
    home(P, PrintHexByte, { a: P.V.player2CurrentMainCharacter, de: 0x0A02 });
    w8(P, de, P.V.unlockedCourtMask);
    length = BLOCK_WITH_COURTS;
  } else {
    home(P, PrintHexByte, { a: P.V.player1CurrentPartnerCharacter, de: 0x0A03 });
    home(P, PrintHexByte, { a: P.V.player2CurrentPartnerCharacter, de: 0x0A04 });
    length = BLOCK_PARTNERS;
  }
  hl = idx(hl, which); de = idx(de, which);
  yield* romWait(P, ExchangeLinkDataBlock, { hl, de, c: length });
  if (length !== BLOCK_WITH_COURTS) return { a: length, f: cpFlags(length, BLOCK_WITH_COURTS) };
  const st = P.V.linkState;
  if (st !== LINKSTATE_SLAVE && st !== LINKSTATE_MASTER) yield* homeWait(P, HOME.LinkErrorReset);
  P.V.linkPartnerCourtMask = st === LINKSTATE_SLAVE ? P.V.player1MainLinkCourtMask : P.V.player2MainLinkCourtMask;
  P.V.player1MainLinkCourtMask = 0;
  P.V.player2MainLinkCourtMask = 0;
  return { a: 0, f: FZ };
}
// ExchangeLinkUnlockFlags (38:7603): the packed unlock flags (wLinkUnlockFlagsSend) exchanged for the partner's
// (wLinkUnlockFlagsRecv). Registers kept.
export function* exchangeLinkUnlockFlags(P) {
  yield* resyncForExchange(P);
  yield* romWait(P, ExchangeLinkDataBlock, { hl: P.A.linkUnlockFlagsRecv, de: P.A.linkUnlockFlagsSend, c: UNLOCK_BYTES });
  P.V.linkExchangeActive = 0;
  resetSerialState(P);
}
// StoreLinkMatchCharInfo (38:7646): the four slots' characters into wMatchSlotCharRefs, our link role into
// wLinkMatchRole, and for a created character in slot 2 its level (wLinkMatchCharLevel). af, bc kept.
export function storeLinkMatchCharInfo(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const from = P.A.charSelectSlotChars, to = P.A.matchSlotCharRefs;
  for (let i = 0; i < 4; i++) w8(P, to + i, u8(P, from + i));
  P.V.linkMatchRole = P.V.linkState;
  const third = u8(P, to + 2);
  let hl = (from + 4) & 0xFFFF, de = (to + 3) & 0xFFFF;
  if (third & 0x80) {
    de = (P.A.createdCharRecords + CREATED_RECORD_LEVEL) & 0xFFFF;
    hl = (((third & 0x07) * CREATED_RECORD_SIZE) + de) & 0xFFFF;
    P.V.linkMatchCharLevel = u8(P, hl);
  }
  wram(P, bank);
  return { de, hl };
}
// a byte of eight flags: bit i set when flags[first + i] is
function packFlags(P, first) {
  let d = 0;
  for (let i = 0, b = 1; i < 8; i++, b <<= 1) if (u8(P, P.A.charUnlockFlags + first + i)) d |= b;
  return d;
}
// PackUnlockFlagsForLink (38:7686): wCharUnlockFlags (WRAM 3, mapped) packed for the link: the characters (flags
// 0-7) as bits, flag 8 as 0 / 1, the courts (15-22) and items (23-30) as bits; the receive buffer cleared
export function packUnlockFlagsForLink(P) {
  const send = P.A.linkUnlockFlagsSend;
  clearBytes(P, send, UNLOCK_BYTES);
  clearBytes(P, P.A.linkUnlockFlagsRecv, UNLOCK_BYTES);
  w8(P, send, packFlags(P, 0));
  w8(P, send + 1, u8(P, P.A.charUnlockFlags + CHAR_FLAGS) ? 1 : 0);
  w8(P, send + 2, packFlags(P, COURT_FLAGS_AT));
  const d = packFlags(P, ITEM_FLAGS_AT);
  w8(P, send + 3, d);
  return { a: 8, b: 0, c: 8, d, hl: send + 3, f: FZ | FN };
}
// UnpackUnlockFlagsFromLink (38:76FA): wCharUnlockFlags rebuilt from the merged flags (the inverse of the above)
export function unpackUnlockFlagsFromLink(P) {
  const flags = P.A.charUnlockFlags, send = P.A.linkUnlockFlagsSend;
  clearBytes(P, flags, CHAR_UNLOCK_FLAGS_SIZE);
  const unpack = (byte, first) => { for (let i = 0, b = 1; i < 8; i++, b <<= 1) if (byte & b) w8(P, flags + first + i, 1); };
  unpack(u8(P, send), 0);
  if (u8(P, send + 1)) w8(P, flags + CHAR_FLAGS, 1);
  unpack(u8(P, send + 2), COURT_FLAGS_AT);
  unpack(u8(P, send + 3), ITEM_FLAGS_AT);
  return { a: 8, b: 0, c: 8, hl: send + 3, f: FZ | FN };
}
// MergeLinkUnlockFlags (38:7773): our flags or'ed with the partner's (into wLinkUnlockFlagsSend)
export function mergeLinkUnlockFlags(P) {
  const send = P.A.linkUnlockFlagsSend, recv = P.A.linkUnlockFlagsRecv;
  let b = 0;
  for (let i = 0; i < UNLOCK_BYTES; i++) { b = u8(P, send + i); w8(P, send + i, b | u8(P, recv + i)); }
  return { a: UNLOCK_BYTES, b, c: UNLOCK_BYTES, de: recv + UNLOCK_BYTES, hl: send + UNLOCK_BYTES, f: FZ | FN };
}

export const HOOKS = [
  [BANK, 0x728F, hook((P, c) => drawEnteredName(P, c.f))],
  [BANK, 0x72B3, hook((P, c) => appendCharToName(P, c.f))],
  [BANK, 0x7341, hook((P, c) => deleteLastNameChar(P, c.f))],
  [BANK, 0x7379, hook(P => isNameBufferFull(P))],
  [BANK, 0x7385, hook(P => drawNameEntryUnderlineSprites(P))],
  [BANK, 0x73AE, hook((P, c) => trimTrailingSpacesFromName(P, c.f))],
  [BANK, 0x73CF, hook((P, c) => getEnteredNameLength(P, c.f))],
  [BANK, 0x73FA, hook(P => getActiveStoryNameBuffer(P))],
  [BANK, 0x7408, hookGen(P => runLinkMatchSequence(P))],
  [BANK, 0x74E3, hook(P => applyMatchTypeSettingsLink(P))],
  [BANK, 0x7522, hookGen((P, c) => exchangeLinkCharSelection(P, c.c))],
  [BANK, 0x7603, hookGen(P => exchangeLinkUnlockFlags(P))],
  [BANK, 0x7646, hook(P => storeLinkMatchCharInfo(P))],
  [BANK, 0x7686, hook(P => packUnlockFlagsForLink(P))],
  [BANK, 0x76FA, hook(P => unpackUnlockFlagsFromLink(P))],
  [BANK, 0x7773, hook(P => mergeLinkUnlockFlags(P))],
];
