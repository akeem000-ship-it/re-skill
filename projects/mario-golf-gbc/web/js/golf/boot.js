// Power-on to the front end: SoftReset 00:2DAA (the RAM and HRAM cleared, the OAM DMA routine copied to HRAM, VRAM
// cleared, the frame tasks and queues reset, the LCD on), GameMain 01:400E (WRAM banks 1-7 cleared, the font and
// default palettes, the save RAM checked or initialised (bank 02), a new game's character, a fade in), then the map
// engine (MapEngine 0A:498C) on map $00 at entrance 3: MapRun 0A:4A21 loads the map's header, places the player,
// spawns the map's actors, starts its graphics (0B:46DF) and runs its enter script, ModeSelectMain (32:5033 ->
// 32:5037: modesel.js), which returns when a golf round starts.
// The save RAM: save.js.
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as M from "./mapengine.js";
import { initFontScreen } from "./pictures.js";
import { newGame, mapWarpToReturnPoint } from "./start.js";
import { initSerialLink } from "./modesel.js";
import { saveLoad, saveCheckAllBlocks } from "./save.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// ---- 00:2DAA SoftReset ----
function softReset(w) {
  if (w.vram) D.disableLCDSafely(w);
  w.wram[0].fill(0, 0, 0xFF0);                   // ClearMemory16 $C000, $FF blocks
  w.high.fill(0, 0x180, 0x1F0);                  // $FF80-$FFEF
  w.high[0x1FE] = 1;                             // hIsCGB (Start 00:2DA0, from 00:0100 EntryPoint / 00:0150 EntryJump)
  if (w.vram) { w.lcd.scy = 0; w.lcd.scx = 0; w.lcd.vbk = 0; }
  setW(w, 0);
  for (let k = 0; k < 10; k++) w.high[0x180 + k] = rb(0, 0x067A + k);   // 00:066C CopyOAMDMARoutineToHRAM
  if (w.vram) D.clearVRAMBank(w);                // 00:037B
  w.high[0x19E] = 0;                             // hDebugMode (00:02A3 SwitchCPUSpeed: double speed)
  w.high[0x1A6] = 0x06;                          // hJoyRepeatRate
  D.resetSprites(w);
  clearFrameTasks(w);
  D.clearVRAMCopyQueue(w);
  // (7E:4072 SoundInit: the sound driver)
  if (w.vram) { w.lcd.wx = 0x07; w.lcd.wy = 0x90; w.lcd.lcdc = 0xE7; w.lcd.turnedOn = true; }
  w.high[0x19D] = 0; w.high[0x1A2] = w.high[0x1A3] = w.high[0x1A4] = 0;
}

// ---- 01:400E GameMain (to 01:41A6 GameMainStart) ----
import { debugBootMenu } from "./debugboot.js";
function* gameMain(sh) {
  const w = sh.w;
  initSerialLink(w);                             // 00:304D
  if (w.vram) D.disableLCDSafely(w);
  for (let b = 1; b < 8; b++) { setW(w, b); w.wram[b].fill(0); }
  if (w.vram) D.inBank(w, 0x01, () => {          // 01:41CE LoadFontTiles
    w.lcd.vbk = 0;
    D.startVRAMDMAFromHL(w, 0x42A0, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0x4AA0, 0x8800, 0x60);
  });
  D.inBank(w, 0x01, () => {                      // 01:41B3 LoadDefaultPalettes
    D.loadPalettesMasterOnly(w, 0x50A0, 0x00, 0x08);
    D.loadPalettesMasterOnly(w, 0x50E0, 0x08, 0x08);
  });
  D.restorePalettesFromMaster(w);
  if (w.vram) D.applyPendingPaletteUpdates(w);
  saveLoad(w);                                   // 02:41F6
  saveCheckAllBlocks(w);                         // 02:45D3
  newGame(w);                                    // 02:4E3D
  w.wram[0].fill(0, 0, 0xA0);
  D.clearMemory16(w, 0xCC00, 0x24);              // 00:2036 ClearDebugTextBuffer
  if (w.vram) D.enableLCD(w);
  Scr.forceFadeIn(w, 0x7F);
  yield* sh.advance();
  // (01:40A3 jumps over DebugBootMenu 01:40A6; a test's w.debugBoot falls through to it: debugboot.js)
  if (w.debugBoot && (yield* debugBootMenu(sh))) return;
  wr(w, 0xC450, 0); wr(w, 0xC46A, 3);            // GameMainStart: map 0, entrance 3
}

// ---- the map engine (mapengine.js) ----
export { scriptEnd } from "./script.js";
// 0A:49B3 (MapEngine's loop head): the frame tasks cleared, MapDebugCoordsTask registered
function mapEngineRestart(w) {
  clearFrameTasks(w);
  D.inBank(w, 0x0A, () => registerFrameTask(w, 0x01, 0x0A, 0x4950));   // MapDebugCoordsTask
}

// 10:4B94 GolfSessionEnd: fade out, the font screen (01:41E8), no countdown, WY $90, no sprites, wGameMode 9; then
// to map 0 at entrance $C2A6 (warp $FA; Save & Quit's 1: the link menu) when set, else MapWarpToReturnPoint 0A:4D8A
// (where GolfSessionInit saved the map: map 0, the saved position; the mode select)
export function* golfSessionEnd(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  if (w.vram) initFontScreen(w);
  wr(w, 0xC0F4, 0);
  if (w.vram) w.lcd.wy = 0x90;
  D.resetSprites(w);
  wr(w, 0xC834, 9);
  const e = rd(w, 0xC2A6);
  if (e) { wr(w, 0xC46A, e); wr(w, 0xC450, 0); wr(w, 0xC441, 0xFA); return; }
  mapWarpToReturnPoint(w);
}

// the game from power-on, map after map: playRound(holes) runs each round GolfRound is called for (ModeSelectMain
// calls it through sh.playGolfRound, then GolfSessionEnd; Training plays hole after hole that way)
export function* gameFromPowerOn(sh, playRound) {
  sh.playGolfRound = playRound;
  try {
    yield* powerOn(sh);
    for (;;) {
      yield* M.mapRunAfterScript(sh, sh.w.mapScriptBank, mapEngineRestart);
      yield* inBankGen(sh.w, 0x0A, M.mapRunToEnterScript(sh));
    }
  } finally { sh.playGolfRound = undefined; }
}

// from power-on to the start of a golf round: returns the GolfRound argument (without sh.playGolfRound; with it,
// from power-on to the end of map 0's enter script)
export function* powerOn(sh) {
  const w = sh.w;
  softReset(w);
  yield* inBankGen(w, 0x01, gameMain(sh));
  // 0A:498C MapEngine
  wr(w, 0xC4BF, 0);
  for (let k = 0; k < 6; k++) wr(w, 0xC290 + k, 0);
  wr(w, 0xC296, 0xFF); wr(w, 0xC297, 0xFF); wr(w, 0xC298, 0xFF);
  wr(w, 0xC2A7, 0xFF);
  if (w.vram) initFontScreen(w);                 // 01:41E8
  mapEngineRestart(w);
  return yield* inBankGen(w, 0x0A, M.mapRunToEnterScript(sh));
}

// 0A:4950 MapDebugCoordsTask: prints the player's position when flag #32 is set (a debug flag: not ported)
export function mapDebugCoordsTask(w) {
  if (testFlag(w, 32)) notPorted("the map's debug coordinates (~0A:4955)");
}
