// The story ending's text window (bank $03): after each ending scene a black window slides up over the greyed
// picture and a page of text (lines of the dialogue text) scrolls through it; then the result screen.
// Port of src/engine/cutscenes/cutscenewindow_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// The text: page a's record in TextPageDescriptors_03 (7 bytes: the number of lines groups, then per group the first
// line's offset from text $30AB and the number of lines) is drawn into wCutsceneTextScrollBuffer (WRAM 1, rows of
// $50 bytes: up to 4 lines of 20 characters side by side), and ScrollCutsceneTextWindow shows it 20 columns at a
// time (BlitCutsceneTextWindow: 8 rows into the window map at $9C00).
// Covered by the lockstep on out/port/cs_credits.mtrec (the ending credits: the first scenes' pages) and
// out/port/cs_result.mtrec (ShowStoryResultScreen called alone), and the routine tests of the routines that do not
// wait (web/tests/port/routines_cutscenes.mjs).
import {
  WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_TEXT, WRAM_SCENE, TILE_SIZE, TILEMAP_WIDTH, SCREEN_HEIGHT,
  VRAM_BANK1, vTiles1, vBGMap0, vBGMap1, wDecompBuffer, wCutsceneTextScrollBuffer, wShadowTilemap, wScreenAttrmap,
  wWindowShadowTilemap, wTextBuffer, rWY, HOME, FAR, ram, callHome, farcall, queueVRAMCopy, registerFrameTask,
  unregisterFrameTask, advanceFrame, fadeIn, waitFramesCmd, wramBank, pushWramBank, popWramBank, push, pop, call, hook,
  hookSaving, FZ, cpFlags,
} from "./common.js";

const BANK = 0x03;
const rom = (P, addr) => P.rom.u8(BANK, addr);
const WindowSolidTile_03 = 0x7090, WindowAttrMap_03 = 0x70A0, WindowTileMap_03 = 0x71A0;
export const AnimateWindowSlideUpTask = 0x72A0;
const WindowSlideStepTable_03 = 0x7301;                // per page: the scroll step, the raster step
const TextPageDescriptors_03 = 0x7370, TEXT_PAGE_SIZE = 7;
const TEXT_LINES_BASE = 0x30AB;                        // the first text id of the pages' lines
const Text_5e_320 = 0x3140, Text_5e_322 = 0x3142;      // the result screen's two texts
const wCutsceneSlideDone = 0xD000, wCutsceneTextScrollRows = 0xD001, wCutsceneWindowSliding = 0xD1FE;   // WRAM 6
const WINDOW_HIDDEN_Y = 0x90, SLIDE_FRAMES = 0x3F;
const LINE_CHARS = 0x14, BUFFER_ROW = 0x50, WINDOW_ROWS = 8;
const SCROLL_BUFFER_TEXT = wCutsceneTextScrollBuffer + 99;   // where a page's first line goes
const BLANK = 0x20;                                     // the font's space

// FillMemoryDE (03:6FEF): de bytes of b from hl (de = 0: 65536). Leaves a = 0 (Z), de = 0, hl past the end.
export function fillMemoryDE(P, hl, b, de) {
  let n = de || 0x10000;
  for (; n > 0; n--) { P.bus.w8(hl, b); hl = (hl + 1) & 0xFFFF; }
  return { a: 0, de: 0, hl, f: FZ };
}

// PlayScrollingStoryCutscene (03:6FF7): page a: the window (a solid tile, blank map rows) slid up from the bottom
// (AnimateWindowSlideUpTask), 32 frames, the scroll buffer and the window's shadow map blanked, then the page drawn
// and scrolled through. All registers kept.
export function* playScrollingStoryCutscene(P, page) {
  const { bus, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  const entryBank = P.V.wramBank;
  push(P, entryBank << 8 | cpu.f); push(P, page << 8 | cpu.f);                   // (the bank, then the page)
  queueVRAMCopy(P, WindowSolidTile_03, vTiles1 + 0x7F * TILE_SIZE, 1);
  queueVRAMCopy(P, WindowAttrMap_03, vBGMap1 + VRAM_BANK1, WINDOW_ROWS * TILEMAP_WIDTH / 16);
  queueVRAMCopy(P, WindowTileMap_03, vBGMap1, WINDOW_ROWS * TILEMAP_WIDTH / 16);
  yield* advanceFrame(P);
  farcall(P, FAR.StopSceneScrollTask);
  bus.w8(rWY, WINDOW_HIDDEN_Y);
  wramBank(P, WRAM_SCENE);
  bus.w8(wCutsceneSlideDone, 0);
  ram(P).cutsceneSlideTimer = 0;
  bus.w8(wCutsceneWindowSliding, page);
  registerFrameTask(P, 1, AnimateWindowSlideUpTask);
  do yield* advanceFrame(P); while (!bus.u8(wCutsceneSlideDone));
  for (let n = 0x20; n; n--) yield* advanceFrame(P);
  wramBank(P, WRAM_STAGING);
  fillMemoryDE(P, wDecompBuffer, BLANK, 0x300);
  wramBank(P, WRAM_TEXT);
  fillMemoryDE(P, wWindowShadowTilemap, BLANK, 0x100);
  yield* advanceFrame(P);
  pop(P);                                                 // (the page)
  yield* call(P, 0x7081, drawCutsceneTextPage(P, page));
  yield* call(P, 0x7084, scrollCutsceneTextWindow(P));
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;                     // (pop hl, de, bc, af: the hook puts them back)
}

// AnimateWindowSlideUpTask (03:72A0), a frame task: the window up one line a frame (rWY from $90) for $3F
// frames; every other frame hScrollY and the raster split (wRasterScrollStartLY and EndLY as one word) move by the
// page's steps (WindowSlideStepTable_03). At the end the task ends and wCutsceneSlideDone is set.
export function animateWindowSlideUpTask(P) {
  const { bus } = P, R = ram(P);
  pushWramBank(P, WRAM_SCENE);
  const page = bus.u8(wCutsceneWindowSliding), at = WindowSlideStepTable_03 + ((page * 2) & 0xFF);
  const c = rom(P, at), e = rom(P, at + 1);
  popWramBank(P);
  let hl = at + 1, de = e;
  if (!(P.V.vBlankCounter & 1)) {
    P.V.scrollY = P.V.scrollY + c;
    de = (bus.u16(P.A.rasterScrollStartLY) + e) & 0xFFFF;
    bus.w16(P.A.rasterScrollStartLY, de);
    hl = P.A.rasterScrollStartLY + 1;
  }
  R.cutsceneSlideTimer += 1;
  const b = R.cutsceneSlideTimer & 0x3F;
  bus.w8(rWY, WINDOW_HIDDEN_Y - b);
  if (b !== SLIDE_FRAMES) return { a: b, b, c, de, hl, f: cpFlags(b, SLIDE_FRAMES) };
  const r = unregisterFrameTask(P, AnimateWindowSlideUpTask);
  wramBank(P, WRAM_SCENE);
  bus.w8(wCutsceneSlideDone, 1);
  return { ...r, a: 1, b };
}

// DrawCutsceneTextPage (03:7333): page a's line groups (TextPageDescriptors_03) into the scroll buffer, a frame
// after each group; wCutsceneTextScrollRows = the number of groups. All registers kept.
export function* drawCutsceneTextPage(P, page) {
  const { bus, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  push(P, P.V.wramBank << 8 | cpu.f);
  let hl = TextPageDescriptors_03 + ((page * TEXT_PAGE_SIZE) & 0xFF);
  wramBank(P, WRAM_SCENE);
  const groups = rom(P, hl);
  bus.w8(wCutsceneTextScrollRows, groups);
  hl += 1;
  let group = 0;
  do {
    yield* call(P, 0x735C, drawCutsceneTextLines(P, hl, group));
    yield* advanceFrame(P);
    hl += 2;
    group = (group + 1) & 0xFF;
  } while (group !== groups);
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;
}
// DrawCutsceneTextLines (03:7403): the line group at hl (offset from text $30AB, count) into the scroll buffer
// from row 1 + 20 * group (each line a buffer row below the last), a frame after each line. All registers kept.
export function* drawCutsceneTextLines(P, hl, group) {
  const { cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  push(P, P.V.wramBank << 8 | cpu.f);
  const offset = group ? callHome(P, HOME.MulHLByA, { h: 0, l: LINE_CHARS, a: group }).hl : 0;
  let de = (SCROLL_BUFFER_TEXT + offset) & 0xFFFF;
  let id = TEXT_LINES_BASE + rom(P, hl);
  let lines = rom(P, hl + 1);
  wramBank(P, WRAM_STAGING);
  do {
    drawDialogueLineToBuffer(P, id, de, BUFFER_ROW);
    yield* advanceFrame(P);
    de = (de + BUFFER_ROW) & 0xFFFF;
    id = (id + 1) & 0xFFFF;
    lines = (lines - 1) & 0xFF;
  } while (lines);
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;
}
// ScrollCutsceneTextWindow (03:7452): for each group (wCutsceneTextScrollRows & 3, at least 1): a frame, 20 blits a
// column further each, then 255 frames. All registers kept.
export function* scrollCutsceneTextWindow(P) {
  const { cpu, bus } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  pushWramBank(P, WRAM_SCENE);
  const groups = (bus.u8(wCutsceneTextScrollRows) & 3) || 1;
  let column = 0;
  for (let g = 0; g !== groups; g = (g + 1) & 0xFF) {
    yield* advanceFrame(P);
    for (let n = LINE_CHARS; n; n--) {
      yield* call(P, 0x7475, blitCutsceneTextWindow(P, column));
      column = (column + 1) & 0xFF;
    }
    for (let n = 0xFF; n; n--) yield* advanceFrame(P);
  }
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;
}
// BlitCutsceneTextWindow (03:7490): 8 rows of 20 characters of the scroll buffer from column c into the window's
// shadow map (WRAM 5), queued to $9C00, and a frame. All registers kept.
export function* blitCutsceneTextWindow(P, column) {
  const { cpu, bus } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  push(P, P.V.wramBank << 8 | cpu.f);
  let src = (wCutsceneTextScrollBuffer + column) & 0xFFFF, dest = wWindowShadowTilemap;
  for (let row = 0; row < WINDOW_ROWS; row++) {
    for (let i = 0; i < LINE_CHARS; i++) {
      wramBank(P, WRAM_STAGING);
      const ch = bus.u8(src + i);
      wramBank(P, WRAM_TEXT);
      bus.w8(dest + i, ch);
    }
    src = (src + BUFFER_ROW) & 0xFFFF; dest = (dest + TILEMAP_WIDTH) & 0xFFFF;
  }
  wramBank(P, WRAM_TEXT);
  queueVRAMCopy(P, wWindowShadowTilemap, vBGMap1, WINDOW_ROWS * TILEMAP_WIDTH / 16);
  yield* advanceFrame(P);
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;
}
// DrawDialogueLineToBuffer (03:74F2): text hl fetched (FetchDialogueText into wTextBuffer) and its first 20
// characters (up to its end) written to de in WRAM 1. (The count in c is not used: it loads $14.) All registers
// kept.
export function drawDialogueLineToBuffer(P, id, de, c) {
  const { bus, cpu } = P;
  const bank = P.V.wramBank;
  farcall(P, FAR.FetchDialogueText, { a: bank, b: cpu.b, c, h: id >> 8, l: id & 0xFF, d: de >> 8, e: de & 0xFF });
  wramBank(P, WRAM_STAGING);
  for (let i = 0; i < LINE_CHARS; i++) {
    const ch = bus.u8(wTextBuffer + i);
    if (!ch) break;
    bus.w8(de + i, ch);
  }
  wramBank(P, bank);
}

// ShowStoryResultScreen (03:751E): a blank screen with the two result texts (rows 6 and 12), faded in, 120 frames.
// All registers kept.
export function* showStoryResultScreen(P) {
  const { cpu } = P, R = ram(P);
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  pushWramBank(P, WRAM_COURT_PLANES);
  fillMemoryDE(P, wScreenAttrmap, 0x00, 0x240);
  wramBank(P, WRAM_SCREEN);
  fillMemoryDE(P, wShadowTilemap, BLANK, 0x240);
  for (const [text, row] of [[Text_5e_320, 6], [Text_5e_322, 12]]) {
    const de = wShadowTilemap + row * TILEMAP_WIDTH;
    farcall(P, FAR.FetchAndDrawDialogueText, { h: text >> 8, l: text & 0xFF, d: de >> 8, e: de & 0xFF, b: 0x00, c: 0x20 });
  }
  wramBank(P, WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  wramBank(P, WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  P.V.scrollX = 0; P.V.scrollY = 0;
  R.cameraX = 0; R.cameraY = 0;
  yield* advanceFrame(P);
  yield* fadeIn(P, 4);
  yield* waitFramesCmd(P, 120, 0x75A1);
  popWramBank(P);
  P.cpu.sp = (P.cpu.sp + 8) & 0xFFFF;
}

export const HOOKS = [
  hook(BANK, 0x6FEF, (P, c) => fillMemoryDE(P, c.hl, c.b, c.de)),
  hookSaving(BANK, 0x6FF7, (P, c) => playScrollingStoryCutscene(P, c.a)),
  hook(BANK, AnimateWindowSlideUpTask, animateWindowSlideUpTask),
  hookSaving(BANK, 0x7333, (P, c) => drawCutsceneTextPage(P, c.a)),
  hookSaving(BANK, 0x7403, (P, c) => drawCutsceneTextLines(P, c.hl, c.c)),
  hookSaving(BANK, 0x7452, scrollCutsceneTextWindow),
  hookSaving(BANK, 0x7490, (P, c) => blitCutsceneTextWindow(P, c.c)),
  hookSaving(BANK, 0x74F2, (P, c) => drawDialogueLineToBuffer(P, c.hl, c.de, c.c)),
  hookSaving(BANK, 0x751E, showStoryResultScreen),
];
