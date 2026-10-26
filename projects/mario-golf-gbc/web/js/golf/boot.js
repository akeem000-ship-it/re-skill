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
import * as A from "./actors.js";
import { mapStartGfx } from "./mapgfx.js";
import { initFontScreen } from "./pictures.js";
import { newGame, mapWarpToReturnPoint } from "./start.js";
import { initSerialLink, modeSelectMain } from "./modesel.js";
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
  w.high[0x1FE] = 1;                             // hIsCGB (Start 00:2DA0)
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
  wr(w, 0xC450, 0); wr(w, 0xC46A, 3);            // GameMainStart: map 0, entrance 3
}

// ---- the map engine, as far as map $00's enter script ----
// 0A:5303 MapFindRecord: MapTable 0A:5188 (6 bytes per map; the first when absent)
function mapFindRecord(a) {
  for (let hl = 0x5188; ; hl += 6) {
    const v = rb(0x0A, hl);
    if (v === 0xFF) return 0x5188;
    if (v === a) return hl;
  }
}
function mapIndexOf(a) {                         // 0A:5348 MapIndexOf
  let b = 0;
  for (let hl = 0x5188; ; hl += 6, b++) {
    const v = rb(0x0A, hl);
    if (v === a) return b;
    if (v === 0xFF) return 0;
  }
}
// 0A:4BBC MapLoadHeader: the record -> $C450-$C455, its header ((idx, bank) at +2: 00:063B ReadFarVectorEntry, 14
// bytes by 00:0654 FarCopyBytes) -> $C456, wMapBank $C464, the name's text id ($012C + index) -> $C4B4
function mapLoadHeader(w) {
  const rec = mapFindRecord(rd(w, 0xC450));
  for (let k = 0; k < 6; k++) wr(w, 0xC450 + k, rb(0x0A, rec + k));
  const ref = r16(w, 0xC452), bank = ref >> 8;
  const hl = rw(bank, 0x4000 + (ref & 0xFF));
  wr(w, 0xC464, bank);
  for (let k = 0; k < 0x0E; k++) wr(w, 0xC456 + k, rb(bank, hl + k));
  const id = (0x012C + mapIndexOf(rd(w, 0xC450))) & 0xFFFF;
  wr(w, 0xC4B4, id & 0xFF); wr(w, 0xC4B5, id >> 8);
}
// 0A:4C0D MapPlaceAtEntrance: wMapEntrance in the header's entrance list (6 bytes each; $FF ends: the first) ->
// $C400 (FarCopyBytes), facing $C465, x $C466, y $C468 ($FA: kept)
function mapPlaceAtEntrance(w) {
  const want = rd(w, 0xC46A);
  if (want === 0xFA) return;
  const bank = rd(w, 0xC464);
  let hl = r16(w, 0xC456);
  for (;; hl = (hl + 6) & 0xFFFF) {
    const a = rb(bank, hl);
    if (a === 0xFF) { hl = r16(w, 0xC456); break; }
    if (a === want) break;
  }
  for (let k = 0; k < 6; k++) wr(w, 0xC400 + k, rb(bank, hl + k));
  wr(w, 0xC465, rd(w, 0xC401));
  wr(w, 0xC466, rd(w, 0xC402)); wr(w, 0xC467, rd(w, 0xC403));
  wr(w, 0xC468, rd(w, 0xC404)); wr(w, 0xC469, rd(w, 0xC405));
}
// 0A:4F45 MapInitObjects: flag #21 off, the actors reset (04:410D), the player at the entrance (04:510A), the map's
// actors (04:5084 from the header's list), the partner by flags #144-#147 (04:51D0: none in a new game)
function mapInitObjects(w, a, hl) {
  clearFlag(w, 21);
  D.inBank(w, 0x04, () => {
    A.actorsInit(w);
    A.spawnPlayerActor(w, r16(w, 0xC466), r16(w, 0xC468), rd(w, 0xC465));
    A.spawnActorList(w, a, hl);
    setW(w, 4);                                  // 04:51D0 SpawnPartnerActor
    wr(w, 0xC298, 0xFF); wr(w, 0xC299, 0xFF); wr(w, 0xC294, 0); wr(w, 0xC295, 0);
    if ([144, 145, 146, 147].some(n => testFlag(w, n))) notPorted("the partner's actor (~04:5212)");
  });
}
// 0A:4342 ActorResetScript / 0A:431E ActorSetScript (bank 0A): slot a's script = de, bank b (hFFE0 = its address)
function actorSetScript0A(w, a, de, b) {
  if (a === 0xFF) return;
  const hl = A.actorSlotAddr(a);
  w.high[0x1E0] = hl & 0xFF; w.high[0x1E1] = hl >> 8;
  setW(w, 4);
  wr(w, hl, de & 0xFF); wr(w, hl + 1, de >> 8); wr(w, hl + 2, b);
}
const scriptActorSlot = w => {                   // the slot of the actor at wScriptActor $C292 (0 when none)
  const hl = r16(w, 0xC292);
  return ((((hl >> 8) & 0x0F) << 2) | (hl & 0xFF) >> 6) & 0xFF;
};
function scriptBegin(w) {                        // 0A:4092 ScriptBegin
  wr(w, 0xC363, 0xFF); wr(w, 0xC368, 0); wr(w, 0xC369, 0);
  const a = scriptActorSlot(w);
  if (a !== 0xFF) {                              // 0A:4342 ActorResetScript: script 0A:435D
    const hl = A.actorSlotAddr(a);
    setW(w, 4);
    wr(w, hl, 0x5D); wr(w, hl + 1, 0x43); wr(w, hl + 2, 0x0A);
  }
  if (w.high[0x19E]) notPorted("the debug script skip (~0A:4066)");
}
export function scriptEnd(w) {                   // 0A:40D6 ScriptEnd: the script actor idles (0A:4109)
  wr(w, 0xC368, 0); wr(w, 0xC369, 0);
  actorSetScript0A(w, scriptActorSlot(w), 0x4109, 0x0A);
  unregisterFrameTask(w, 0x0A, 0x4066);
  clearFlag(w, 22);
}

// 0A:4A21 MapRun, as far as the enter script (0A:4F71 MapRunEnterScript -> 0A:4EFF MapRunScript: code at the
// header's +12 in the map's bank, after ScriptBegin); returns the GolfRound argument
function* mapRunToEnterScript(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x0C);
  wr(w, 0xC4BF, 0x10);
  for (let k = 0; k < 4; k++) wr(w, 0xC85C + k, 0);   // 0A:4B8C ClearC85C
  for (let k = 0; k < 5; k++) wr(w, 0xC440 + k, 0);   // 0A:4B99 MapClearEvents
  mapLoadHeader(w);
  mapPlaceAtEntrance(w);
  yield* sh.advance();
  sh.sound(rd(w, 0xC454));                       // 00:2C19 PlaySoundManaged (a = $10, not $FF)
  wr(w, 0xC4BF, 0x20);
  mapInitObjects(w, rd(w, 0xC464), r16(w, 0xC45A));
  A.loadActorPalettes(w);                        // 04:4D2B
  setFlag(w, 20);
  yield* Scr.waitFade(sh);
  clearFlag(w, 20);
  wr(w, 0xC4BF, 0x30);
  wr(w, 0xC320, rd(w, 0xC466)); wr(w, 0xC321, rd(w, 0xC467));
  wr(w, 0xC322, rd(w, 0xC468)); wr(w, 0xC323, rd(w, 0xC469));
  yield* inBankGen(w, 0x0B, mapStartGfx(sh, rd(w, 0xC451)));
  wr(w, 0xC4BF, 0x40);
  if (w.vram) w.lcd.wy = 0x90;
  const hl = r16(w, 0xC462), bank = rd(w, 0xC464);
  if (!(hl & 0xE000)) notPorted("a map's enter message (~0A:4F0C)");
  w.mapScriptBank = w.high[0x196];              // (MapRunEnterScript 0A:4F75 pushes it; restored after the script)
  scriptBegin(w);                                // 0A:4092
  setW(w, 4);
  const p = r16(w, 0xC290);
  wr(w, p + 0x33, 0); wr(w, p + 0x10, rd(w, 0xC28A));
  if (bank !== 0x32 || hl !== 0x5033) notPorted(`the enter script ~${bank.toString(16)}:${hl.toString(16)}`);
  // 32:5033 Map00EnterModeSelect: ModeSelectMain returns here when it calls GolfRound (the caller runs the round
  // and mapRunAfterRound below)
  return yield* inBankGen(w, 0x32, modeSelectMain(sh));
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
// 0A:5146 MapTakeWarp: warp [$C46B] ($FA: the map and entrance already set) from the map header's warp list
function mapTakeWarp(w) {
  if (rd(w, 0xC46B) !== 0xFA) notPorted(`the map's warp ${rd(w, 0xC46B).toString(16)} (~0A:5151 MapListFindIfFlag)`);
}

// after a round started from map 0's enter script: GolfSessionEnd (32:523C, 32:52C6), the script's end (MapRunScript
// 0A:4F38 ScriptEnd, WRAM bank back as at MapRunEnterScript), MapRun 0A:4A90 taking the warp request (a request is
// always there after a round: none would go on to the map's event loop, not ported), then MapEngine 0A:49C1: the
// warp, the frame tasks cleared and MapDebugCoordsTask again, ready for the next MapRun
export function* mapRunAfterRound(sh, wbank) {
  const w = sh.w;
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
  D.inBank(w, 0x0A, () => scriptEnd(w));
  setW(w, wbank);
  const a = rd(w, 0xC441);
  if (!a) notPorted("the map's event loop after its enter script (~0A:4A9F)");
  wr(w, 0xC441, 0); wr(w, 0xC46B, a);
  mapTakeWarp(w);
  clearFrameTasks(w);
  D.inBank(w, 0x0A, () => registerFrameTask(w, 0x01, 0x0A, 0x4950));   // MapDebugCoordsTask
}

// the game from power-on, round after round: playRound(holes) runs each round GolfRound is called for
export function* gameFromPowerOn(sh, playRound) {
  let holes = yield* powerOn(sh);
  for (;;) {
    const wb = sh.w.mapScriptBank;
    yield* playRound(holes);
    yield* mapRunAfterRound(sh, wb);
    holes = yield* inBankGen(sh.w, 0x0A, mapRunToEnterScript(sh));
  }
}

// from power-on to the start of a golf round: returns the GolfRound argument
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
  clearFrameTasks(w);
  D.inBank(w, 0x0A, () => registerFrameTask(w, 0x01, 0x0A, 0x4950));   // MapDebugCoordsTask
  return yield* inBankGen(w, 0x0A, mapRunToEnterScript(sh));
}

// 0A:4950 MapDebugCoordsTask: prints the player's position when flag #32 is set (a debug flag: not ported)
export function mapDebugCoordsTask(w) {
  if (testFlag(w, 32)) notPorted("the map's debug coordinates (~0A:4955)");
}
