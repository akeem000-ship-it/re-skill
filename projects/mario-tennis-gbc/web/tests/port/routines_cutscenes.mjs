// Routine tests for web/js/port/cutscenes (run by web/tests/port_routines.mjs; filter "CS " for all of them): the
// cutscene routines that do not wait, on states of recorded play, with prep() setting the variables they read to
// random and edge values (step timers past the tables' ends, palette steps at their ends, the frames of every
// animation group, ...). Interrupts are off (IE = 0) on both machines: the states are taken just before a VBlank,
// and the port's code takes no time where the ROM's does. The scene setups run with the LCD off. The waiting routines are checked by the lockstep
// (out/port/intro1.mtrec, out/port/intro_skip*.mtrec, out/engine/exh1.mtrec).
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
const regsOf = (gen, k) => s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
};
// a test of bank:addr; gen(r, s) draws registers, prep(mem, r) sets RAM (the same draws on both machines)
const T = (name, bank, addr, { gen = () => ({}), out = ALL, prep, wram } = {}) => {
  const k = ++salt * 7919;
  return { name: "CS " + name, bank, addr, out, wram, regs: regsOf(gen, k),
    prep: (mem, s) => { mem.ie = 0; mem.hram[0x16] = mem.svbk; if (prep) prep(mem, rng(s, k + 1)); } };
};
const w = (mem, a, v) => mem.write(a, v & 0xFF);                 // as mapped (WRAM0, HRAM, the mapped bank)
const w16 = (mem, a, v) => { w(mem, a, v); w(mem, a + 1, v >> 8); };
const wb = (mem, bank, a, v) => { mem.wram[bank][a - 0xD000] = v & 0xFF; };   // a WRAM bank's byte
const edge = (r, values, n = 256) => (r(3) ? r(n) : values[r(values.length)]);
// variables (WRAM0 / HRAM)
const STEP_TIMER = 0xCB40, CHECK = 0xCB41, SCROLL_X = 0xCB42, SUB_STATE = 0xCB43, AX = 0xCB44, AY = 0xCB45, BX = 0xCB46, BY = 0xCB47;
const ACCUM = 0xCB48, SCROLL_Y = 0xCB4A, ANIM_FRAME = 0xCB4C, ANIM_TICK = 0xCB4D, SLIDE_TIMER = 0xCB60, CAMERA_Y = 0xC322;
const RASTER_START = 0xCB02;
const hScrollY = 0xFF8A, hScrollX = 0xFF8B, hVBlankCounter = 0xFF8C, hInputRisingEdge = 0xFF94;
const B6B = 0x6B, B03 = 0x03;
const vblank = (mem, r) => w(mem, hVBlankCounter, r(4) ? (r(64) << 2) | 3 : r(256));   // mostly a step frame
// routines that switch the LCD off (DisableLCDSafely): with it already off (the core's harness steps the CPU alone:
// rLY would never reach $91)
const lcdOff = m => m.write(0xFF40, m.read(0xFF40) & 0x7F);
const randomBytes = (mem, bank, at, n, r, max = 256) => { for (let i = 0; i < n; i++) wb(mem, bank, at + i, r(max)); };

export const ROUTINES = [
  // ---- intro scenes (bank $6b) ----
  T("CheckIntroSkipInput", B6B, 0x53F1, { prep: (m, r) => { w(m, hInputRisingEdge, edge(r, [0, 1, 8, 9, 0xF6])); w(m, CHECK, 0); } }),
  T("InitCutsceneSceneA", B6B, 0x53FC, { prep: lcdOff }),
  T("Unused_6b_InitCutsceneSceneB", B6B, 0x545E, { prep: lcdOff }),
  T("InitCutsceneSceneC", B6B, 0x54B9, { prep: lcdOff }),
  T("LoadIntroTilesAndPalette", B6B, 0x6075),
  T("InitTitleSceneGraphics", B6B, 0x617C, { prep: lcdOff }),
  T("SetCameraYFromScrollPos", B6B, 0x60D5, { prep: (m, r) => w16(m, SCROLL_Y, edge(r, [0, 0x7FF, 0x800, 0xFFFF], 0x10000)) }),
  T("QueueScrollingSprite", B6B, 0x60F8, { prep: (m, r) => { w16(m, ACCUM, r(0x10000)); w16(m, SCROLL_Y, r(0x10000)); w(m, ANIM_FRAME, edge(r, [0, 1, 2, 3])); } }),
  T("AdvanceSpriteAnimTimer", B6B, 0x6115, { prep: (m, r) => w(m, ANIM_TICK, edge(r, [0x0F, 0x1F, 0x2F, 0x3F, 0xFF])) }),
  T("QueueIntroSpriteBlock", B6B, 0x6126, { gen: r => ({ bc: r(0x10000) & 0xFF00 | edge(r, [0, 1, 2, 3]) }) }),
  T("Unused_6b_RewriteCutsceneCameraY", B6B, 0x615E, { prep: (m, r) => { w(m, STEP_TIMER, edge(r, [0x13, 0x14])); w16(m, CAMERA_Y, edge(r, [0x00FF, 0x0100], 0x10000)); } }),
  T("UpdateCutsceneScrollX", B6B, 0x4C9E, { prep: (m, r) => { w(m, STEP_TIMER, r(0x80)); w16(m, SCROLL_Y, edge(r, [0, 0x100, 0x10], 0x10000)); } }),
  T("UpdateCutsceneScrollY", B6B, 0x4D61, { prep: (m, r) => { w(m, STEP_TIMER, r(0x80)); w16(m, ACCUM, edge(r, [0, 0x100, 0x10], 0x10000)); } }),
  T("QueueCutsceneAnimatedSprites", B6B, 0x4E2D, { prep: (m, r) => { w(m, STEP_TIMER, edge(r, [0x1F, 0x20, 0x7F], 0x80)); w16(m, SCROLL_Y, r(0x10000)); } }),
  T("ApplyCutsceneScrollToSpriteX", B6B, 0x518D, { prep: (m, r) => w16(m, SCROLL_Y, edge(r, [0, 0x100, 0xFFFF], 0x10000)) }),
  T("LoadCutsceneTileset", B6B, 0x520A),
  T("QueueCutsceneSpriteGroupA", B6B, 0x526A, { prep: (m, r) => { for (const a of [AX, AY, STEP_TIMER]) w(m, a, r(256)); } }),
  T("QueueCutsceneSpriteGroupB", B6B, 0x52F9, { prep: (m, r) => { for (const a of [BX, BY, STEP_TIMER]) w(m, a, r(256)); } }),
  T("ApplyCutsceneBobOffset", B6B, 0x53B8, { prep: (m, r) => w(m, STEP_TIMER, r(256)) }),
  T("UpdateCutsceneScroll", B6B, 0x53DB, { prep: (m, r) => { w(m, SCROLL_X, r(256)); w(m, SUB_STATE, edge(r, [0, 2, 3, 4])); } }),
  T("IntroSequenceTimerTask", B6B, 0x7083, { prep: (m, r) => w(m, AX, edge(r, [0x00, 0x59, 0xA9, 0xFF])) }),
  T("AnimateBgPalette1Task", B6B, 0x72AF, { prep: (m, r) => { vblank(m, r); w(m, AY, edge(r, [0x0E, 0x0F, 0xFF], 0x10)); } }),
  T("AnimateBgPalettes2And3Task", B6B, 0x72DD, { prep: (m, r) => { vblank(m, r); w(m, BX, edge(r, [0x0E, 0x0F, 0xFF], 0x10)); } }),
  T("CycleBgPalettes4To7Task", B6B, 0x731B, { prep: (m, r) => { vblank(m, r); w(m, BY, edge(r, [0x0E, 0x0F, 0x1F, 0x20, 0x25, 0xFF], 0x10)); } }),
  T("ScrollCutsceneXRightTask", B6B, 0x7366, { prep: (m, r) => { w(m, STEP_TIMER, edge(r, [0x0F, 0x10], 0x14)); w(m, SCROLL_X, r(256)); } }),
  T("ScrollCutsceneXLeftTask", B6B, 0x7395, { prep: (m, r) => { w(m, STEP_TIMER, edge(r, [0x0F, 0x10], 0x14)); w(m, SCROLL_X, r(256)); } }),
  T("ScrollCutsceneLeftTask", B6B, 0x73C4, { prep: (m, r) => { w(m, STEP_TIMER, edge(r, [0x0F, 0x10], 0x14)); w(m, SCROLL_X, r(256)); } }),
  // ---- title (bank $6b) ----
  T("DecompressIntroTitleTiles", B6B, 0x73F2),
  T("Unused_6b_IncrementCutsceneStepTimer", B6B, 0x7561, { prep: (m, r) => w(m, STEP_TIMER, edge(r, [0x0F, 0xFF])) }),
  T("ApplyScrollYFromWram", B6B, 0x7569, { prep: (m, r) => w(m, AX, r(256)) }),
  T("QueueTitleSprite", B6B, 0x76B6, { prep: (m, r) => wb(m, 3, 0xD801, edge(r, [0, 7], 8)) }),
  T("StepTitleSpriteAnimation", B6B, 0x771F, { wram: 3, prep: (m, r) => {
    vblank(m, r); wb(m, 3, 0xD802, r(2) ? 0 : edge(r, [0x0F, 0x10], 0x10)); wb(m, 3, 0xD801, edge(r, [6, 7], 8));
    w(m, hVBlankCounter, r(2) ? 7 : r(256)); } }),
  // ---- scrolling text, scene animation (bank $03) ----
  T("FillMemory16", B03, 0x59B1, { wram: 1, gen: r => ({ hl: 0xD000 + r(0x400), bc: r(0x10000) & 0xFF00 | (1 + r(16)) }) }),
  T("FillMemoryBC", B03, 0x5AF9, { wram: 1, gen: r => ({ hl: 0xD000 + r(0x400), bc: 1 + r(0x300) }) }),
  T("FillMemoryDE", B03, 0x6FEF, { wram: 1, gen: r => ({ hl: 0xD000 + r(0x400), de: 1 + r(0x300) }) }),
  T("InitScrollingTextScreen", B03, 0x5AA9),
  T("GetScrollTextRowVramAddr", B03, 0x5B01, { prep: (m, r) => w(m, hScrollY, r(256)), gen: r => ({ de: edge(r, [0x90, 0], 0x10000) }) }),
  T("TestTextEndMarker", B03, 0x5B1A, { wram: 3, prep: (m, r) => wb(m, 3, 0xD000, edge(r, [0x22, 0x23, 0x24])) }),
  T("Unused_03_DebugTestMinigameRecords", B03, 0x5975),
  T("SetupSceneAnimationPalettes", B03, 0x5B28),
  T("UpdateSceneAnimation", B03, 0x5B4D, { prep: (m, r) => { wb(m, 6, 0xD000, edge(r, [0x35, 0x36, 0x37, 0xFF], 0x36)); w(m, SLIDE_TIMER, r(2) ? 0 : r(256)); } }),
  ...[["00_08", 0x5B89, 0], ["09_11", 0x5D38, 9], ["12_1A", 0x5EEC, 0x12], ["1B_23", 0x60A0, 0x1B], ["24_2C", 0x6254, 0x24], ["2D_35", 0x6408, 0x2D]].map(([n, addr, first]) =>
    T("LoadCutsceneAnimFrameGfx_" + n, B03, addr, { prep: (m, r) => wb(m, 6, 0xD000, r(2) ? first + r(9) : edge(r, [first - 1, first + 9, 0x36, 0xFF], 0x36)) })),
  // ---- the story window (bank $03) ----
  T("AnimateWindowSlideUpTask", B03, 0x72A0, { prep: (m, r) => {
    wb(m, 6, 0xD1FE, r(25)); w(m, SLIDE_TIMER, edge(r, [0x3D, 0x3E, 0x3F, 0x7E])); vblank(m, r); w16(m, RASTER_START, r(0x10000)); } }),
  T("DrawDialogueLineToBuffer", B03, 0x74F2, { wram: 1, gen: r => ({ hl: 0x30AB + r(0x93), de: 0xD000 + r(0x500), bc: 0x0050 }) }),
  // ---- the palette fade (bank $03) ----
  T("InitGrayscalePaletteFade", B03, 0x75AB),
  T("Unused_03_InitBlackPaletteFade", B03, 0x75CA),
  T("CopyMasterPalettesToFadeBuffers", B03, 0x75E9, { wram: 6 }),
  T("Unused_03_ClearFadeTargetPalettes", B03, 0x7606, { wram: 6 }),
  T("DesaturateFadeTargetPalettes", B03, 0x7616, { wram: 6, prep: (m, r) => randomBytes(m, 6, 0xD0A0, 0x80, r) }),
  T("ComputeGrayscaleColor", B03, 0x7648, { wram: 6, gen: () => ({ de: 0xD1F2 }), prep: (m, r) => randomBytes(m, 6, 0xD1F2, 3, r, 32) }),
  T("SetupPaletteFadeMask", B03, 0x7687, { gen: r => ({ de: edge(r, [0, 0x1E00, 0x1F00, 0xFF00], 0x10000) }), prep: (m, r) => randomBytes(m, 6, 0xD1E0, 16, r, 2) }),
  T("StepPaletteColorsTowardTarget", B03, 0x7764, { wram: 6, gen: r => ({ bc: r(16) << 8 | r(256) }), prep: (m, r) => {
    randomBytes(m, 6, 0xD0A0, 0x80, r); randomBytes(m, 6, 0xD140, 0x80, r); } }),
  T("StepColorComponentTowardTarget", B03, 0x77D0, { wram: 6, gen: r => ({ hl: 0xD1F2 + r(3), de: 0xD1F5 + r(3) }), prep: (m, r) => {
    randomBytes(m, 6, 0xD1F2, 6, r, 32); if (r(3) === 0) wb(m, 6, 0xD1F5, m.wram[6][0x1F2]); } }),
  T("SnapPalettesToTarget", B03, 0x77E2, { wram: 6, prep: (m, r) => { randomBytes(m, 6, 0xD1E0, 16, r, 2); randomBytes(m, 6, 0xD0A0, 0x80, r); } }),
  T("AdvanceToPaletteEntry", B03, 0x7829, { gen: r => ({ bc: r(17) << 8 | r(256) }) }),
];
