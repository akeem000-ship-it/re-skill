// Bank 13: the hole's views on screen. The course view (hFFB0 / wOnGreen 0) and the green view (1) each have a
// 64 x 64 tile map (WRAM3 $D000) and attribute map (WRAM2 $D000) from the hole's assets (HoleAssetTable 13:4A16),
// tiles in VRAM bank 1 ($9000 / $8800, signed addressing) and palettes; DrawHoleViewAtCamera copies the 20 x 22 tiles
// around the camera into the BG map, and MapScrollTask (04:4072) blits rows and columns as the camera moves. The
// course view also animates some tiles (water: bank 50's HoleTileAnimTask).
import { rb } from "../rom.js";
import * as D from "./display.js";
import { rd, wr, inBank, setWramBank } from "./display.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { testGameFlag } from "./actors.js";

// 13:49EE HoleAsset: (ref, entry) of the current hole (wHoleId $D320) -> hl = (bank << 8 | idx)
export function holeAsset(w, ref) {
  const p = 0x4A16 + w.wram[6][0x320] * 16 + 2 * ref;
  return rb(0x13, p) | rb(0x13, p + 1) << 8;
}
const dispatch = (w, ref, entry, de) => D.farDispatchIndexed(w, holeAsset(w, ref), entry, de);

export function holeLoadMaps(w) {                // 13:4014 HoleLoadMaps (by hFFB0)
  const v = w.high[0x1B0];
  if (!v) {
    setWramBank(w, 2); dispatch(w, 1, 0, 0xD000);
    setWramBank(w, 3); dispatch(w, 1, 1, 0xD000);
    setWramBank(w, 6); dispatch(w, 1, 2, 0xD700);
    dispatch(w, 0, 3, 0xD800);
    setWramBank(w, 4); D.farCopyFastIndexed(w, holeAsset(w, 1), 3, 0xDC00, 0x20);
    setWramBank(w, 6);
    return;
  }
  if (v === 1) {
    setWramBank(w, 2); dispatch(w, 3, 1, 0xD000);
    setWramBank(w, 3); dispatch(w, 3, 2, 0xD000);
    setWramBank(w, 6); dispatch(w, 3, 3, 0xD700);
    dispatch(w, 2, 2, 0xD800);
    return;
  }
  if (v !== 3) setWramBank(w, 6);
}

export function holeLoadTiles(w) {               // 13:40CA HoleLoadTiles (by hFFB0)
  setWramBank(w, 1);
  w.lcd.vbk = 1;
  const v = w.high[0x1B0];
  if (!v) {
    dispatch(w, 0, 1, 0xD000);
    D.farCopyIndexed(w, holeAsset(w, 0), 0, 0xC600, 0x40);
  } else if (v === 1) {
    dispatch(w, 2, 0, 0xD000);
    D.lzTo(w, 0x13, 0x464B, 0xDC00);
    D.farCopyIndexed(w, holeAsset(w, 3), 0, 0xC600, 0x40);
  }
}

// 13:411D DrawHoleViewAtCamera: the BG map from the maps at the scroll ($C320 / $C322 as the caller set them), and
// SCX / SCY. (The scroll and the camera's state are camera.js drawHoleViewAtCamera; this is the drawing.)
export function drawHoleViewTiles(w) {
  const w0 = w.wram[0];
  setWramBank(w, 6);
  let tx = 0, ty = 0;
  if (!w.high[0x1B0]) { tx = w0[0x321]; ty = w0[0x323]; }   // the camera goal's tile, as the scroll took it
  const bg0 = 0x9800 + ((ty & 0x1F) << 5) + (tx & 0x1F);
  const map0 = 0xD000 + ((ty & 0xFF) << 6) + tx;
  for (const [bank, vbk] of [[2, 1], [3, 0]]) {
    setWramBank(w, bank);
    w.lcd.vbk = vbk;
    let hl = map0 & 0xFFFF, de = bg0;
    for (let b = 0x14; b; b--) {
      let h = hl, d = de;
      for (let c = 0x16; c; c--) {
        wr(w, d, rd(w, h));
        h = (h + 1) & 0xFFFF; d = (d + 1) & 0xFFFF;
        if (!(h & 0x3F)) { h = (h - 0x40) & 0xFFFF; d = (d - 0x20) & 0xFFFF; }   // (the BG column wraps too)
        else if (!(d & 0x1F)) d = (d - 0x20) & 0xFFFF;
      }
      const l = (hl & 0xFF) + 0x40;
      hl = l > 0xFF ? ((((hl >> 8) + 1) & 0x0F) | 0xD0) << 8 | (l & 0xFF) : (hl & 0xFF00) | l;
      const e = (de & 0xFF) + 0x20;
      de = e > 0xFF ? (((de >> 8) + 1) & ~0x04) << 8 | (e & 0xFF) : (de & 0xFF00) | e;
    }
  }
  setWramBank(w, 6);
  const sy = ((w0[0x323] << 8 | w0[0x322]) << 3) >> 8 & 0xFF, sx = ((w0[0x321] << 8 | w0[0x320]) << 3) >> 8 & 0xFF;
  w.high[0x18A] = sy; w.lcd.scy = sy;
  w.high[0x18B] = sx; w.lcd.scx = sx;
  w.high[0x1B9] = w.high[0x1B8] = 0;
}

export function loadCoursePalettes(w) {          // 13:446D LoadCoursePalettes
  const set = rb(0x13, 0x45AB + (w.wram[0][0x836] & 0x0F));
  const hl = 0x45BB + ((set * 0x18) & 0xFF);
  inBank(w, 0x13, () => {
    D.loadPalettesImmediate(w, hl, 0x05, 0x02);
    D.loadPalettesImmediate(w, (hl + 0x10) & 0xFFFF, 0x0A, 0x01);
  });
}

// 13:43D6-13:4469: LoadShotView's course / green view part, up to its AdvanceFrame (the caller); view = hFFB0.
// Before: HoleLoadTiles, HoleLoadMaps, wOnGreen = view, the event hook 2 (by the caller)
export function loadViewGraphics(w, view) {
  D.disableLCDSafely(w);
  w.lcd.vbk = 1;
  setWramBank(w, 1);
  D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
  D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
  D.loadPalettesImmediate(w, 0xC600, 0x02, 0x05);
  if (view === 1) loadCoursePalettes(w);
  D.applyPendingPaletteUpdates(w);
}
export function loadViewAfterDraw(w, view) {     // 13:4442-13:445F: the LCD on, then the slope map of the course view
  D.enableLCD(w);
  if (!view) {
    setWramBank(w, 1);
    dispatch(w, 0, 4, 0xD800);
  }
  setWramBank(w, 6);
}

// ---- the course view's tile animation (13:7076 StartCourseAnimTask -> 50:70F1 and its copies in banks $51-$54,
// the same code at other addresses: 51:7151 52:7181 53:7E09 54:7D21, their tasks 51:7213 52:7243 53:7ECB 54:7DE3) ----
const ANIM_TASKS = { 0x50: 0x71B3, 0x51: 0x7213, 0x52: 0x7243, 0x53: 0x7ECB, 0x54: 0x7DE3 };
export function startCourseAnimTask(w) {         // 13:7076 StartCourseAnimTask: by the bank of HoleAsset ref 4 ($54 for
  const k = ((holeAsset(w, 4) >> 8) - 0x50) & 0xFF; //   anything past $53)
  const bank = k < 4 ? 0x50 + k : 0x54;
  inBank(w, bank, () => holeTileAnimStart(w, bank));
}
export function stopCourseAnimTasks(w) {         // 13:70A2 StopCourseAnimTasks: 50:71A4 51:7204 52:7234 53:7EBC 54:7DD4
  for (const [b, a] of [[0x50, 0x71B3], [0x51, 0x7213], [0x52, 0x7243], [0x53, 0x7ECB], [0x54, 0x7DE3]]) unregisterFrameTask(w, b, a);
}

function animScript(w, entry) {                  // the list of HoleAsset ref 4 read in bank $50 (the bank is not used)
  const idx = holeAsset(w, 4) & 0xFF;
  const list = rd(w, 0x4000 + idx) | rd(w, 0x4001 + idx) << 8;
  const p = (list + 2 * entry) & 0xFFFF;
  return rd(w, p) | rd(w, p + 1) << 8;
}

function holeTileAnimStart(w, bank) {            // 50:70F1 HoleTileAnimStart (and its copies)
  const w0 = w.wram[0];
  for (let k = 0; k < 4; k++) { w0[0x330 + 2 * k] = 0xFF; w0[0x331 + 2 * k] = 1; }
  w0.fill(0xFF, 0x338, 0x33C);
  let de = animScript(w, 1);
  if (rd(w, de) === 0xFE) return;
  let ptr = 0xC332;
  let b = 0xFF, c = 3;
  w0[0x330] = 0;
  w0[0x338] = 0;
  let hl = 0xC339;
  outer: for (;;) {
    for (;;) {
      b = (b + 1) & 0xFF;
      const a = rd(w, de); de = (de + 1) & 0xFFFF;
      if (a === 0xFE) break outer;
      if (a === 0xFF) break;
    }
    b = (b + 1) & 0xFF;
    const a = (b + 1) & 0xFF;
    wr(w, hl, a);
    wr(w, ptr, a); ptr = (ptr + 2) & 0xFFFF;
    const t = (rd(w, de) + 1) & 0xFF; de = (de + 1) & 0xFFFF;
    w0[0x330 + 2 * (4 - c) + 1] = t;
    hl++;
    c--;
    if (!c) break;
  }
  if (c) {
    wr(w, hl - 1, 0xFF);
    wr(w, ptr - 2, 0xFF);
  }
  registerFrameTask(w, 0x01, bank, ANIM_TASKS[bank]);
}

export function holeTileAnimTask(w) {            // 50:71B3 HoleTileAnimTask (51:7213 52:7243 53:7ECB 54:7DE3)
  if (!testGameFlag(w, 28) && testGameFlag(w, 24)) return;
  const keep = w.high[0x196];
  setWramBank(w, 6);
  const w0 = w.wram[0];
  let c = 0, hl = 0x338;
  while (w0[hl] !== 0xFF) {
    const t = (w0[0x331 + 2 * c] - 1) & 0xFF;
    w0[0x331 + 2 * c] = t;
    hl++;
    const b = c++;
    if (c === 4) break;
    if (t) continue;
    holeTileAnimStep(w, b);
    if (c === 4) break;
  }
  w.high[0x196] = keep;
}

function holeTileAnimStep(w, track) {            // 50:7201 HoleTileAnimStep
  const w0 = w.wram[0];
  w0[0x33C] = w0[0x330 + 2 * track];
  let p;
  for (;;) {
    p = (animScript(w, 1) + w0[0x33C]) & 0xFFFF;
    if (rd(w, p) !== 0xFF) break;
    w0[0x33C] = w0[0x338 + track];               // back to the track's start
  }
  const src = rd(w, p), count = rd(w, p + 1), dst = rd(w, p + 2), frames = rd(w, p + 3);
  const tiles = (animScript(w, 0) + (src << 4)) & 0xFFFF;
  D.queueVRAMCopy(w, tiles, 0xB000 + (dst << 4), count);
  w0[0x33C] = (w0[0x33C] + 4) & 0xFF;
  w0[0x330 + 2 * track] = w0[0x33C];
  w0[0x331 + 2 * track] = frames;
}

// 04:4072 MapScrollTask: a new BG row / column when the view's tile ($C321 / $C323) moved since the last frame
// ($C324 / $C325), and the scroll shadows with the shake offsets $C368 / $C369
export function mapScrollTask(w) {
  const w0 = w.wram[0];
  setWramBank(w, 4);
  let dy = (w0[0x323] - w0[0x325]) & 0xFF;
  if (dy) D.blitBGRowFrom64(w, 0xFB, dy & 0x80 ? 0x00 : 0x13);
  const dx = (w0[0x321] - w0[0x324]) & 0xFF;
  if (dx) D.blitBGColumnFrom64(w, dx & 0x80 ? 0x00 : 0x15, 0xFA);
  w0[0x325] = w0[0x323];
  const sy = ((w0[0x323] << 3) | (w0[0x322] >> 5)) & 0xFF;   // (adc a, 0: the carry is clear here)
  const ty = sy + w0[0x369];
  w.high[0x18A] = ty & 0xFF;
  w0[0x324] = w0[0x321];
  const sx = ((((w0[0x321] + (ty > 0xFF ? 1 : 0)) & 0xFF) << 3) | (w0[0x320] >> 5)) & 0xFF;   // (the carry of the
  w.high[0x18B] = (sx + w0[0x368]) & 0xFF;       // shaken y carries into x)
}

// ---- the cup close-up on the green view (wOnGreen 2): 10 x 8 tiles (CupViewTable 13:494E: 80 attributes then 80
// tiles) over BG rows 4-11, columns 5-14; the rest of the 20-column rows from the view's maps (WRAM2 / WRAM3 $D100,
// stride $40), built in $C600 (attributes) / $C700 (tiles) and queued to $9880 ----
function cupViewRows(w, src) {
  const w0 = w.wram[0];
  let de = 0x600;
  for (const bank of [2, 3]) {
    const map = w.wram[bank];
    let hl = 0x100;
    for (let row = 0; row < 8; row++) {
      if (src === null) for (let k = 0; k < 20; k++) w0[de++] = map[hl++];
      else {
        for (let k = 0; k < 5; k++) w0[de++] = map[hl++];
        hl += 0x0A;
        for (let k = 0; k < 10; k++) w0[de++] = rb(0x13, src++);
        for (let k = 0; k < 5; k++) w0[de++] = map[hl++];
      }
      hl += 0x2C;
      de += 0x0C;
    }
  }
  if (src !== null) { w.high[0x1B0] = src & 0xFF; w.high[0x1B1] = src >> 8; }
  inBank(w, 0x13, () => {                        // 13:458E
    D.queueVRAMCopy(w, 0xC600, 0xB880, 0x10);
    D.queueVRAMCopy(w, 0xC700, 0x9880, 0x10);
  });
  setWramBank(w, 6);
}
export function cupViewEnter(w) { cupViewRows(w, 0x494E); }   // 13:44A4 CupViewEnter
export function cupViewLeave(w) { cupViewRows(w, null); }     // 13:4528 CupViewLeave
