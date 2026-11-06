// Bank 17: the pause menu's Course Map (REVERSE.md "Bank 17"). CourseMapInit 17:4250 builds a map of the whole hole
// from the hole's course-map record (44:7E74 CopyHoleRecord: a 16 x 16 grid of nibbles, one per 4 x 4 block of hole
// tiles; $F = a block drawn in detail: its terrain read from the overhead maps, coloured through a 16-entry table and
// packed into a 2bpp tile; then the detail count and a $FF-ended list of overlay blocks drawn as sprites), a side
// panel with the HUD's hole info, distance, wind and the players, and the markers. CourseMapScreen 17:437D then runs
// CourseMapInput 17:4E14 (B: the shot mode or spin, Up / Down: the club, Left / Right: the aim) until A or Start.
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as L from "./launch.js";
import * as S from "./swing.js";
import * as g from "./math.js";
import * as Hk from "./render/hooks.js";
import { clearFrameTasks, registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { holeAsset, stopCourseAnimTasks } from "./render/holeview.js";
import { updateWindIndicator, hudDrawHoleInfo, hudDistance, hudDrawWind, hudDrawPlayer1, hudDrawPlayer2 } from "./render/hud.js";
import { drawFaceIcon } from "./scorecard.js";
import { printDecimalByte } from "./match.js";
import { placeTargetMarkerClamped } from "./freelook.js";
import { pinDist } from "./cup.js";
import { aimStep } from "./aim.js";
import { ball, rd16, wr16, playerField } from "./memory.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const B = 0x17;
const REC = 0xC640;                              // 17:4004 CourseMapRecordAddr

// ---- building the map ----
// 17:4487 CourseMapSetColorTable: 16 bytes from bank 17 to $C400
const setColorTable = (w, hl) => { for (let k = 0; k < 16; k++) wr(w, 0xC400 + k, rb(B, hl + k)); };

// 17:4512 CourseMapBuildTilemap: the 16 x 16 nibbles at hl to the tile map $DE00 (32 wide): nibble $F takes the next
// detail tile (numbered from 4), others are tiles 0-$E; the count of detail tiles + 4 goes to $C470 (sound $01 if it
// differs from the record's count + 4, or reaches $C0: a debug check)
function buildTilemap(sh, hl) {
  const w = sh.w;
  let b = 4, p = 0xDE00;
  for (let row = 0; row < 16; row++, p += 0x10) {
    for (let k = 0; k < 8; k++) {
      let c = rd(w, hl++);
      for (let n = 0; n < 2; n++) {              // 17:4582 CourseMapNextTile: the high nibble first
        c = ((c << 4) | (c >> 4)) & 0xFF;
        let a = c & 0x0F;
        if (a === 0x0F) { a = b; b = (b + 1) & 0xFF; }
        wr(w, p++, a);
      }
    }
  }
  const a = (rd(w, hl) + 4) & 0xFF;
  if (a !== b) sh.sound(0x01);
  if (a >= 0xC0) sh.sound(0x01);
  wr(w, 0xC470, b);
}

// 17:46D7 CourseMapTileTerrain: the hole tile at $D000 + de (attribute WRAM2, tile WRAM3): its terrain entry (WRAM6
// $D800 + tile x 8) gives 2 x 2 cells at bc, bc + 1, bc + 8, bc + 9: high nibbles, or low ones for an x flip ($20),
// in the order the flips ask
function tileTerrain(w, de, bc) {
  const hl = (0xD000 + de) & 0xFFFF;
  setW(w, 2); const attr = rd(w, hl);
  setW(w, 3); const tile = rd(w, hl);
  setW(w, 6);
  const t = (0xD800 + tile * 8) & 0xFFFF;
  const v = k => rd(w, (t + k) & 0xFFFF);
  const hi = a => (a >> 4) & 0x0F, lo = a => a & 0x0F;
  const put = (o, x) => wr(w, (bc + o) & 0xFFFF, x);
  switch (attr & 0x60) {
    case 0x00: put(0, hi(v(0))); put(1, hi(v(1))); put(8, hi(v(2))); put(9, hi(v(3))); break;
    case 0x20: put(1, lo(v(0))); put(0, lo(v(1))); put(9, lo(v(2))); put(8, lo(v(3))); break;
    case 0x40: put(8, hi(v(0))); put(9, hi(v(1))); put(0, hi(v(2))); put(1, hi(v(3))); break;
    default: put(9, lo(v(0))); put(8, lo(v(1))); put(1, lo(v(2))); put(0, lo(v(3))); break;
  }
}
// 17:46A3 CourseMapGatherBlockTerrain: the 16 tiles of the block at de (offsets 17:4683 in the 64-wide maps) into
// the 8 x 8 cells at bc (offsets 17:4693)
function gatherBlockTerrain(w, de, bc) {
  for (let l = 0; l < 16; l++) tileTerrain(w, (de + rb(B, 0x4683 + l)) & 0xFFFF, (bc + rb(B, 0x4693 + l)) & 0xFFFF);
}
// 17:45C8 CourseMapRenderBlockTile: block (d = row, e = column x 4) to one 2bpp tile at hl (WRAM1): its 64 cells
// gathered at $C600, coloured through $C400 (17:44B0 CourseMapRemapColors), packed (17:45E5; per row 17:45FE CourseMapPackRow, per
// cell 17:4620 CourseMapPackPixel: bit 0 of each colour in the low plane, bit 1 in the high one); returns hl past the tile
function renderBlockTile(w, de, hl) {
  gatherBlockTerrain(w, de, 0xC600);
  setW(w, 1);
  for (let k = 0; k < 64; k++) wr(w, 0xC600 + k, rd(w, 0xC400 + rd(w, 0xC600 + k)));
  let p = 0xC600;
  for (let r = 0; r < 8; r++) {
    let b = 0, c = 0;
    for (let k = 0; k < 8; k++) { const a = rd(w, p++); b = ((b << 1) | (a & 1)) & 0xFF; c = ((c << 1) | ((a >> 1) & 1)) & 0xFF; }
    wr(w, hl++, b); wr(w, hl++, c);
  }
  return hl & 0xFFFF;
}
// 17:4592 CourseMapRenderDetailTiles: every $F block of the grid at hl rendered, from tile 4 ($D040)
function renderDetailTiles(w, hl) {
  let p = 0xD040, b = 0;
  do {
    let c = rd(w, hl++);
    for (let n = 0; n < 2; n++) {                // 17:45A7 CourseMapRenderIfDetail
      c = ((c << 4) | (c >> 4)) & 0xFF;
      if ((c & 0x0F) === 0x0F) p = renderBlockTile(w, ((b >> 4) << 8) | (((b & 0x0F) << 2) & 0xFF), p);
      b = (b + 1) & 0xFF;
    }
  } while (b);
}
// 17:4628 CourseMapRenderOverlayTiles: each listed block (row << 4 | column, $FF ends) and the one below it as
// tiles at $D000 on; returns c = 2 x the byte after the list
function renderOverlayTiles(w, bc) {
  let p = 0xD000;
  for (;;) {
    const a = rd(w, bc++);
    if (a === 0xFF) break;
    const d = (a >> 4) & 0x0F, e = ((a & 0x0F) << 2) & 0xFF;
    p = renderBlockTile(w, d << 8 | e, p);
    p = renderBlockTile(w, ((d + 1) & 0xFF) << 8 | e, p);
  }
  return (rd(w, bc) << 1) & 0xFF;
}
// 17:4652 CourseMapQueueOverlaySprites: the same list as 8 x 16 sprites at (column x 8 + 4, row x 8 + 4), tiles 0, 2,
// 4 ..., attribute 3 (sound $02 when the sprite queue is full: a debug check)
function queueOverlaySprites(sh, hl) {
  const w = sh.w;
  for (let c = 0; ; c = (c + 2) & 0xFF) {
    const a = rd(w, hl++);
    if (a === 0xFF) return;
    const d = ((((a & 0x0F) << 3) & 0xFF) + 4) & 0xFF, e = (((((a >> 4) & 0x0F) << 3) & 0xFF) + 4) & 0xFF;
    if (w.high[0x19B] === 0xA0) sh.sound(0x02);
    D.queueSprite(w, e, d, c, 0x03);
  }
}

// 17:41F5 CourseMapReloadHoleMaps: unless the saved view ($C471) was the course's, the course view's maps again
function reloadHoleMaps(w) {
  if (!rd(w, 0xC471)) return;
  setW(w, 2); D.farDispatchIndexed(w, holeAsset(w, 1), 0, 0xD000);
  setW(w, 3); D.farDispatchIndexed(w, holeAsset(w, 1), 1, 0xD000);
  setW(w, 6); D.farDispatchIndexed(w, holeAsset(w, 0), 3, 0xD800);
}

// 17:47C0 CourseMapDrawSidePanel: the panel's maps (17:48C8 tiles to $DE10, 17:4908 attributes to $DC10: 4 x 16),
// the HUD's hole info, distance and wind drawn and copied (to VRAM1 $8E00 / $8F00 / $8D80), the wind arrow (17:4950
// by the angle; none: 17:4D50) at $8D00, the players' boxes (17:4D50) and faces (12:6CF0) with their stroke counts
function drawSidePanel(w) {
  for (const [src, dst] of [[0x48C8, 0xDE10], [0x4908, 0xDC10]])
    for (let r = 0; r < 16; r++) for (let k = 0; k < 4; k++) wr(w, dst + 32 * r + k, rb(B, src + 4 * r + k));
  setW(w, 6);
  D.inBank(w, 0x12, () => hudDrawHoleInfo(w));
  D.queueAndRunVRAMCopy(w, 0xD200, 0xAE00, 0x0C);
  D.inBank(w, 0x12, () => hudDistance(w));
  D.queueAndRunVRAMCopy(w, 0xD200, 0xAF00, 0x06);
  D.inBank(w, 0x12, () => hudDrawWind(w));
  D.queueVRAMCopy(w, 0xD200, 0xAD80, 0x06);
  const w0 = w.wram[0];
  let hl = 0x4D50;
  if (w0[0x815]) hl = (0x4950 + ((((w0[0x816] + 8) & 0xF0) << 2) & 0xFFFF)) & 0xFFFF;
  D.queueAndRunVRAMCopy(w, hl, 0xAD00, 0x04);
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0x4D50, 0x8C00, 0x06);
  if (w0[0x890] !== 0xFF) {
    drawFaceIcon(w, w0[0x890], w0[0x899], 0x04, 0xAC00);
    D.inBank(w, 0x12, () => hudDrawPlayer1(w));
    D.queueAndRunVRAMCopy(w, 0xD200, 0xAC40, 0x02);
  }
  w0[0x220] = 0xFF; w0[0x221] = 0xFF;
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0x4D50, 0x8C80, 0x06);
  if (w0[0x8D0] !== 0xFF) {
    drawFaceIcon(w, w0[0x8D0], w0[0x8D9], 0x05, 0xAC80);
    D.inBank(w, 0x12, () => hudDrawPlayer2(w));
    D.queueAndRunVRAMCopy(w, 0xD220, 0xACC0, 0x02);
  }
  w0[0x228] = 0xFF; w0[0x229] = 0xFF;
  setW(w, 1);
}

// 17:4250 CourseMapInit
function* courseMapInit(sh) {
  const w = sh.w, w0 = w.wram[0], r6 = w.wram[6];
  clearFrameTasks(w);
  w0[0x3B6] = 0;
  registerFrameTask(w, 0x81, B, 0x43A7);         // CountLoadFramesTask_17 (in VBlank)
  D.inBank(w, 0x13, () => stopCourseAnimTasks(w));
  w.high[0x18B] = 0; w.high[0x18A] = 0;
  w0.fill(0, 0x320, 0x324);
  w0[0x324] = 0; w0[0x325] = 0;
  w.high[0x1B9] = 0; w.high[0x1B8] = 0;
  setW(w, 6);
  w0[0x471] = r6[0x443];
  r6[0x443] = 3;
  D.inBank(w, 0x10, () => placeTargetMarkerClamped(w));   // 10:5A3C
  reloadHoleMaps(w);
  setW(w, 1);
  D.inBank(w, 0x44, () => {                      // 44:7E74 CopyHoleRecord: $C0 bytes for the course and hole
    const t = rw(0x44, (0x4311 + ((w0[0x836] << 1) & 0xFF)) & 0xFFFF);
    D.copyMemoryFast(w, rw(0x44, (t + ((w0[0x837] << 1) & 0xFF)) & 0xFFFF), REC, 0x0C);
  });
  D.resetSprites(w);                             // 17:4795 CourseMapQueueFrameSprites
  D.queueSprite(w, 0x84, 0x04, 0x40, 0x08); D.queueSprite(w, 0x84, 0x0C, 0x42, 0x08);
  D.queueSprite(w, 0x84, 0x94, 0x44, 0x0E); D.queueSprite(w, 0x84, 0x9C, 0x46, 0x0E);
  D.setSpriteQueueBase(w);
  D.inBank(w, B, () => D.copyMemoryFast(w, 0x4050, 0xD000, 0x04));
  setColorTable(w, 0x4490);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 16; k++) wr(w, 0xDC00 + 32 * r + k, rb(B, 0x4502 + k));   // 17:44EA
  buildTilemap(sh, REC);
  renderDetailTiles(w, REC);
  D.disableLCDSafely(w);
  D.inBank(w, B, () => drawSidePanel(w));
  w.lcd.vbk = 1;
  D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
  if (w0[0x470] >= 0x80) D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x40);
  w.lcd.vbk = 1; D.startVRAMDMAFromHL(w, 0xDC00, 0x9800, 0x20);
  w.lcd.vbk = 0; D.startVRAMDMAFromHL(w, 0xDE00, 0x9800, 0x20);
  w.lcd.vbk = 0;
  D.inBank(w, B, () => { D.startVRAMDMAFromHL(w, 0x4170, 0x8700, 0x08); D.startVRAMDMAFromHL(w, 0x4090, 0x8780, 0x04); });
  setColorTable(w, 0x44A0);
  const c = renderOverlayTiles(w, REC + 0x81);
  w.lcd.vbk = 0;
  D.startVRAMDMAFromHL(w, 0xD000, 0x8000, c);
  D.enableLCD(w);
  D.inBank(w, B, () => {
    D.loadPalettesUnlessFaded(w, 0x4018, 0x02, 0x01);
    D.loadPalettesUnlessFaded(w, 0x4020, 0x0B, 0x01);
    D.loadPalettesUnlessFaded(w, 0x4028, 0x0C, 0x02);
  });
  Scr.beginFadeIn(w, 0x7F);
  yield* Scr.waitFade(sh);
  unregisterFrameTask(w, B, 0x43A7);
  printDecimalByte(w, w0[0x3B6], 0x020B);        // (the frames it took: to the debug text buffer)
  registerFrameTask(w, 0x01, B, 0x43AC);         // CourseMapTask
}

// 17:43A7 CountLoadFramesTask_17
export function countLoadFramesTask17(w) { w.wram[0][0x3B6] = (w.wram[0][0x3B6] + 1) & 0xFF; }

// 17:43AC CourseMapTask: the wind indicator (12:50A0), OBJ palette 1's live colours as BG palette 6, $C130-$C131 =
// $FF, the current player's blinking panel tile (17:4DD0), the markers, the overlay sprites, and with shot mode 1 below
// the putter a sprite at ($2A, $84)
export function courseMapTask(sh) {
  const w = sh.w, w0 = w.wram[0];
  D.inBank(w, 0x12, () => updateWindIndicator(w));
  D.loadPalettesImmediate(w, 0xC148, 0x06, 0x01);
  w0[0x130] = 0xFF; w0[0x131] = 0xFF;
  const n = w.high[0x18C] & 0x0F, p1 = !w0[0x835];
  if (n < 6) D.queueBGTileWrite(w, p1 ? 0x98B3 : 0x98F3, 0xE7, 0x08);   // 17:4DD0 CourseMapBlinkPlayerTile
  else D.queueBGTileWrite(w, p1 ? 0x98B3 : 0x98F3, p1 ? 0xC5 : 0xCD, 0x08);
  drawMarkers(w);
  setW(w, 1);
  queueOverlaySprites(sh, REC + 0x81);
  setW(w, 6);
  const r6 = w.wram[6];
  if (r6[0x32A] === 1 && r6[0x329] < 0x0D) D.queueSprite(w, 0x84, 0x2A, 0x3C, 0x08);
}
// 17:43F3 CourseMapDrawMarkers: the target marker (template 17:41F0, tile $74 / $76 by wFrameCounter bit 3) at half
// scale, the balls (17:4440: templates 17:40D0 / 17:40D5, players without a golfer left out), the flag at the cup
function drawMarkers(w) {
  setW(w, 6);
  const r6 = w.wram[6], w0 = w.wram[0];
  const half = v => ((v << 1) >> 8) & 0xFF;
  D.queueSpriteTemplate(w, 0x41F0, half(rd16(r6, 0x428)), half(rd16(r6, 0x426)), w0[0x4B2] & 0x08 ? 0x74 : 0x76, 0x00);
  if (w0[0x890] !== 0xFF) D.queueSpriteTemplate(w, 0x40D0, half(rd16(w0, 0x8A6)), half(rd16(w0, 0x8A3)), 0x78, 0x04);
  if (w0[0x8D0] !== 0xFF) D.queueSpriteTemplate(w, 0x40D5, half(rd16(w0, 0x8E6)), half(rd16(w0, 0x8E3)), 0x7A, 0x04);
  D.queueSpriteTemplate(w, 0x41F0, half(rd16(r6, 0x43F)), half(rd16(r6, 0x43D)), 0x70, 0x05);
}

// 17:4E14 CourseMapInput
function* courseMapInput(sh) {
  const w = sh.w, r6 = w.wram[6], w0 = w.wram[0];
  setW(w, 6);
  const p = w.high[0x194];
  let changed = false;
  if (p & 2) {                                   // B
    if (r6[0x329] === 0x0D) r6[0x32B] = rb(B, 0x4E87 + r6[0x32B]);   // the putter's range
    else if ((pinDist(ball(w)) - 0x7A0) & 0x8000) r6[0x32A] = rb(B, 0x4E6F + r6[0x32A]);   // near the pin
    else if (r6[0x32A]) r6[0x32A] = 0;
    else if (!w0[playerField(w, 0x28)]) { sh.sound(0x54); changed = true; }
    else r6[0x32A] ^= 1;
    if (!changed) sh.sound(0x5B);
    changed = true;
  } else {
    const r = w.high[0x191];
    if (r & 0x40) {
      if (r6[0x4CD] === 6 || !r6[0x329]) { r6[0x486] = 0; return; }
      r6[0x329]--; sh.sound(0x5B); changed = true;
    } else if (r & 0x80) {
      if (r6[0x4CD] === 6 || r6[0x329] === 0x0D) { r6[0x486] = 0; return; }
      r6[0x329]++; sh.sound(0x5B); changed = true;
    } else {
      const h = w.high[0x190];
      if (h & 0x20) wr16(r6, 0x418, (rd16(r6, 0x418) - aimStep(w)) & 0xFFFF);
      else if (h & 0x10) wr16(r6, 0x418, (rd16(r6, 0x418) + aimStep(w)) & 0xFFFF);
      else { r6[0x486] = 0; return; }
    }
  }
  if (changed) {                                 // 17:4F12
    r6[0x321] = S.missTable(w);                  // 10:6907
    Hk.hud(w, "hudDrawShotPanel"); Hk.hud(w, "hudDrawClubIcon");
    yield* sh.advance();
    Hk.hud(w, "hudDrawPinDistance"); Hk.hud(w, "hudDrawLieIcon");
    L.clubParams(w);                             // 10:5EEF
    Hk.hud(w, "hudDistance");
    D.queueVRAMCopy(w, 0xD200, 0xAF00, 0x06);
  }
  r6[0x513] = 0; r6[0x480] = 0;                  // 17:4F38: the marker at the club's distance along the aim
  const [dx, dy] = g.mulSinCos(L.baseDistance(w), rd16(r6, 0x418));
  wr16(r6, 0x426, (rd16(r6, 0x401) + dx) & 0xFFFF);
  wr16(r6, 0x428, (rd16(r6, 0x404) + dy) & 0xFFFF);
}

// 17:437D CourseMapScreen: fade out, the map, then the input each frame (VRAM bank 1, WRAM1) until A or Start
export function* courseMapScreen(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x7F);
  yield* Scr.waitFade(sh);
  yield* courseMapInit(sh);
  for (;;) {
    if (w.high[0x194] & 0x09) break;
    yield* courseMapInput(sh);
    w.lcd.vbk = 1;
    setW(w, 1);
    yield* sh.advance();
  }
  unregisterFrameTask(w, B, 0x43AC);
}

// 17:4232 CourseMapShowTimed (export $02; nothing calls it): CourseMapInit (no fade out first), then up to 300 frames
// or a button (sound $5C); CourseMapTask stopped
export function* courseMapShowTimed(sh) {
  const w = sh.w;
  yield* courseMapInit(sh);
  for (let bc = 0x12C; bc; bc--) {
    yield* sh.advance();
    if (w.high[0x194]) { sh.sound(0x5C); break; }
  }
  unregisterFrameTask(w, B, 0x43AC);
}
