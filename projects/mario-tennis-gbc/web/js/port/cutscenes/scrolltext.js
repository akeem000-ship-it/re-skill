// The scrolling text screen (bank $03): the epilogue's credits text rolling up the screen line by line, until the
// text's end mark; then A, B or START leaves. Also two memory fills of the bank and a debug routine.
// Port of the routines of src/engine/cutscenes/scrolltext_03.asm up to ScrollTextPalette_03 (the scene animation
// after it is in scene_anim.js) of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm):
// names and addresses are its own.
//
// The screen: the background map at $9800 blank (tile $20, attribute 0); every 2 frames hScrollY moves up a line;
// each 8 lines the next text (wScrollTextId, from $1863) is drawn into a row of the shadow map (WRAM 3) and queued
// to the map row just below the screen (GetScrollTextRowVramAddr: hScrollY + $90 lines). A text starting with '#'
// ends it (wScrollTextDone). In debug step mode the buttons leave at once.
// Reached from the story's epilogue scene (match_10.asm: the debug match-select map) and the ending
// (sequences_18.asm), which no recording reaches: covered by the routine tests of the routines that do not wait
// (web/tests/port/routines_cutscenes.mjs).
import {
  WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, WRAM_SOUND, TILEMAP_WIDTH, TILEMAP_AREA, VRAM_BANK1, vBGMap0,
  wShadowTilemap, wScreenAttrmap, rWY, BGM_CREDITS, HOME, FAR, ram, callHome, farcall, sound, queueVRAMCopy,
  loadPaletteShadow, clearFrameTasks, enableLCD, disableLCDSafely, advanceFrame, fadeOut, waitFadeEnd, wramBank,
  hook, hookSaving, FZ, FN, FC, cpFlags,
} from "./common.js";

const BANK = 0x03;
const ScrollTextPalette_03 = 0x5B20;                  // background palette 0
const UpdateMinigameRecord = 0x5072, ReadMinigameRecord = 0x5015;   // (bank 3, the save code's)
const wScrollTextDelay = 0xD230, wScrollTextDelayReload = 0xD231, wScrollTextId = 0xD232, wScrollTextDone = 0xD234;   // WRAM 6
const FIRST_TEXT = 0x1863, TEXT_END_MARK = 0x23;      // '#'
const SCROLL_DELAY = 2, ROW_LINES = 8, NEXT_ROW_LINES = 0x90;
const LEAVE_BUTTONS = 0x0B;                           // A, B or START (held)
const BLANK = 0x20;

// FillMemory16 (03:59B1): c blocks of 16 bytes of a from hl (c = 0: 256). Leaves c = 0, hl past the end, the
// flags of the last `dec c` (Z, N; C kept).
export function fillMemory16(P, hl, a, c, f) {
  for (let n = (c || 0x100) * 16; n > 0; n--) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  return { c: 0, hl, f: FZ | FN | (f & FC) };
}
// FillMemoryBC (03:5AF9): bc bytes of d from hl (bc = 0: 65536). Leaves a = bc = 0 (Z), hl past the end.
export function fillMemoryBC(P, hl, d, bc) {
  for (let n = bc || 0x10000; n > 0; n--) { P.bus.w8(hl, d); hl = (hl + 1) & 0xFFFF; }
  return { a: 0, bc: 0, hl, f: FZ };
}

// Unused_03_DebugTestMinigameRecords (03:5975): records 9999 for minigame 0 and 999 for 1 (UpdateMinigameRecord
// with the value in WRAM 7's wMinigameRecordValue), then reads both back. Leaves WRAM 7 mapped. Nothing calls it.
export function debugTestMinigameRecords(P) {
  const R = ram(P);
  wramBank(P, WRAM_SOUND);
  const value = P.A.minigameRecordValue, hl = { h: (value + 1) >> 8, l: (value + 1) & 0xFF };
  R.minigameRecordValue = 9999;
  P.callRom(BANK, UpdateMinigameRecord, { ...hl, d: 0x27, e: 0x0F, a: 0 });
  R.minigameRecordValue = 999;
  P.callRom(BANK, UpdateMinigameRecord, { ...hl, d: 0x03, e: 0xE7, a: 1 });
  R.minigameRecordValue = 0;
  P.callRom(BANK, ReadMinigameRecord, { ...hl, d: 0, e: 0, a: 0 });
  P.callRom(BANK, ReadMinigameRecord, { a: 1 });
}

// RunScrollingTextScreen (03:59C5): the screen (above)
export function* runScrollingTextScreen(P) {
  const { V, bus } = P, R = ram(P);
  clearFrameTasks(P);
  farcall(P, FAR.LoadMenuFontGfx);
  disableLCDSafely(P);
  V.scrollX = 0; V.scrollY = 0;
  R.cameraX = 0; R.cameraY = 0;
  bus.w8(rWY, 0x90);
  callHome(P, HOME.ClearSpriteQueue);
  loadPaletteShadow(P, ScrollTextPalette_03, 0, 1);
  initScrollingTextScreen(P);
  enableLCD(P);
  sound(P, BGM_CREDITS);
  callHome(P, HOME.ForceFadeIn, { c: 8 });
  yield* waitFadeEnd(P);
  for (;;) {
    wramBank(P, WRAM_SCENE);
    bus.w8(wScrollTextDelay, bus.u8(wScrollTextDelay) - 1);
    if (!bus.u8(wScrollTextDelay)) {
      bus.w8(wScrollTextDelay, SCROLL_DELAY);
      if (!bus.u8(wScrollTextDone)) {
        V.scrollY = V.scrollY + 1;
        if (!(V.scrollY & (ROW_LINES - 1))) {
          const id = bus.u16(wScrollTextId);
          wramBank(P, WRAM_SCREEN);
          // (b is 0: left so by the clearing loop below)
          farcall(P, FAR.FetchAndDrawDialogueText, { h: id >> 8, l: id & 0xFF, d: wShadowTilemap >> 8, e: wShadowTilemap & 0xFF, b: 0, c: 0x10 });
          if (!testTextEndMarker(P).a) {
            wramBank(P, WRAM_SCENE);
            bus.w8(wScrollTextDone, 1);
          } else {
            const row = getScrollTextRowVramAddr(P, NEXT_ROW_LINES).de;
            wramBank(P, WRAM_SCREEN);
            queueVRAMCopy(P, wShadowTilemap, row, TILEMAP_WIDTH / 16);
            wramBank(P, WRAM_SCENE);
            bus.w16(wScrollTextId, bus.u16(wScrollTextId) + 1);
          }
        }
      }
    }
    if ((V.debugStepMode || bus.u8(wScrollTextDone)) && V.playerInputFlags & LEAVE_BUTTONS) break;
    yield* advanceFrame(P);
    wramBank(P, WRAM_SCREEN);
    for (let i = 0; i < 0xC0; i++) bus.w8(wShadowTilemap + i, 0);   // (b counts $40 up to 0)
  }
  yield* fadeOut(P, 1);
  clearFrameTasks(P);
  farcall(P, FAR.LoadMenuFontGfx);
}
// InitScrollingTextScreen (03:5AA9): the delays (2), the first text, not done; the attribute map ($9800 bank 1)
// all 0 and the tile map all blank, through WRAM 2 and 3
export function initScrollingTextScreen(P) {
  const { bus } = P;
  wramBank(P, WRAM_SCENE);
  bus.w8(wScrollTextDelay, SCROLL_DELAY); bus.w8(wScrollTextDelayReload, SCROLL_DELAY);
  bus.w16(wScrollTextId, FIRST_TEXT);
  bus.w8(wScrollTextDone, 0);
  wramBank(P, WRAM_COURT_PLANES);
  fillMemoryBC(P, wScreenAttrmap, 0x00, TILEMAP_AREA);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, TILEMAP_AREA / 16);
  wramBank(P, WRAM_SCREEN);
  fillMemoryBC(P, wShadowTilemap, BLANK, TILEMAP_AREA);
  return queueVRAMCopy(P, wShadowTilemap, vBGMap0, TILEMAP_AREA / 16);
}
// GetScrollTextRowVramAddr (03:5B01): de = the $9800 map row (hScrollY + de) / 8 lines down
export function getScrollTextRowVramAddr(P, de) {
  const raw = ((P.V.scrollY + de) << 2) & 0xFFFF, h = (raw >> 8) & 3, addr = vBGMap0 + (h << 8 | (raw & 0xFF));
  return { a: h, de: addr, hl: addr, f: h ? 0 : FZ };
}
// TestTextEndMarker (03:5B1A): a = the shadow map's first tile - '#' (0: the text was the end mark)
export function testTextEndMarker(P) {
  const t = P.bus.u8(wShadowTilemap);
  return { a: (t - TEXT_END_MARK) & 0xFF, f: cpFlags(t, TEXT_END_MARK) };
}

export const HOOKS = [
  hookSaving(BANK, 0x5975, debugTestMinigameRecords),
  hook(BANK, 0x59B1, (P, c) => fillMemory16(P, c.hl, c.a, c.c, c.f)),
  hook(BANK, 0x59C5, runScrollingTextScreen),
  hook(BANK, 0x5AA9, initScrollingTextScreen),
  hook(BANK, 0x5AF9, (P, c) => fillMemoryBC(P, c.hl, c.d, c.bc)),
  hook(BANK, 0x5B01, (P, c) => getScrollTextRowVramAddr(P, c.de)),
  hook(BANK, 0x5B1A, testTextEndMarker),
];
