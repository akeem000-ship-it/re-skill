// The map graphics of bank 0B (the overworld's screens, the result screens): MapGfxTable 0B:4048 has 18 bytes per
// graphics id, nine (idx, bank) references: the header (map bounds), the palettes, the tile map (WRAM3), the
// attribute map (WRAM2), three maps for WRAM6 and the tiles (VRAM1 $8800-$97FF). MapStartGfx loads one and starts
// the map's frame tasks; MapDrawFullScreen draws the view from the 64 x 64 buffers.
import { rb, rw } from "./rom.js";
import { divHLByDE } from "./math.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import * as D from "./render/display.js";
import { mapDrawFullScreen } from "./scorecard.js";
import { initWindowSystem } from "./standings.js";
import { restoreShadowFromMap, copyShadowRowsFramed } from "./shadow.js";
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

const B = 0x0B;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;

// 00:0234 DecompressDataFromBank / 00:021A CopyDataFromBank: hl = (h bank, l idx): the pointer at bank:$4000 + l
const refPtr = hl => rw(hl >> 8, 0x4000 + (hl & 0xFF));
export function decompressDataFromBank(w, hl, de) { return D.lzTo(w, hl >> 8, refPtr(hl), de); }
export function copyDataFromBank(w, hl, de, bc) {
  const bank = hl >> 8;
  D.inBank(w, bank, () => D.copyMemoryBC(w, refPtr(hl), de, bc));
}

const entry = id => (0x4048 + ((id * 18) & 0xFFFF)) & 0xFFFF;
export function mapGfxGetRef(w, a) {             // 0B:43E8 MapGfxGetRef: word a of MapGfxTable[wMapGfxLoaded]
  return rw(B, (entry(rd(w, 0xC32E)) + 2 * a) & 0xFFFF);
}

// 0B:440C MapLoadGfx: a = graphics id (the tiles by VRAM DMA: the LCD is off)
export function mapLoadGfx(w, a) {
  const e = entry(a), ref = k => rw(B, (e + 2 * k) & 0xFFFF);
  setW(w, 1);
  decompressDataFromBank(w, ref(8), 0xD000);
  if (w.vram) {
    w.lcd.vbk = 1;
    D.startVRAMDMAFromHL(w, 0xD000, 0x9000, 0x80);
    D.startVRAMDMAFromHL(w, 0xD800, 0x8800, 0x80);
  }
  setW(w, 6);
  decompressDataFromBank(w, ref(7), 0xD800);
  decompressDataFromBank(w, ref(5), 0xD400);
  decompressDataFromBank(w, ref(4), 0xD000);
  setW(w, 2);
  decompressDataFromBank(w, ref(3), 0xD000);
  setW(w, 3);
  decompressDataFromBank(w, ref(2), 0xD000);
  setW(w, 1);
  copyDataFromBank(w, ref(1), 0xD000, 0x40);
  if (w.vram) D.loadPalettesMasterOnly(w, 0xD010, 0x02, 0x06);
}

// 0B:44C4 MapLoadGfxScreen: a = id, b = MapDrawFullScreen's a: LCD off, the graphics, the bounds $C329-$C32C from the
// header (via $C600), the view, LCD on, two frames
export function* mapLoadGfxScreen(sh, a, b) {
  const w = sh.w;
  if (w.vram) D.disableLCDSafely(w);
  mapLoadGfx(w, a);
  copyDataFromBank(w, mapGfxGetRef(w, 0), 0xC600, 0x10);
  for (let k = 0; k < 4; k++) wr(w, 0xC329 + k, rd(w, 0xC602 + k));
  if (b === 0) mapCenterCamera(w);               // (0B:4306 MapDrawFullScreen with a = 0)
  mapDrawFullScreen(w);                          // 0B:4306
  if (w.vram) D.enableLCD(w);
  yield* sh.advance(2);
}

// 0B:46DF MapStartGfx: a = graphics id (bit 7: keep what is loaded); wMapGfxCount $C32D = the table's entries; the
// window system, MapGfxScrollTask and the tile animation
export function* mapStartGfx(sh, a) {
  const w = sh.w;
  wr(w, 0xC32E, a & 0x7F);
  w.high[0x18A] = w.high[0x18B] = 0;             // hSCY / hSCX
  wr(w, 0xC33D, 0xFF);
  let n = 0;
  for (let p = 0x4048; rw(B, p); p += 2) n++;
  wr(w, 0xC32D, divHLByDE(n, 9) & 0xFF);
  if (!(a & 0x80)) yield* mapLoadGfxScreen(sh, a & 0x7F, 0);
  w.high[0x1B9] = w.high[0x1B8] = 0;
  yield* initWindowSystem(sh);                   // 05:407A
  D.inBank(w, B, () => registerFrameTask(w, 0x01, B, 0x4784));   // MapGfxScrollTask
  mapGfxStartTileAnim(w, rd(w, 0xC32E));
}

// 0B:4900 MapGfxStartTileAnim: MapGfxAnimTable 0B:42C0 (sub id, bank slot) -> MapTileAnimStart in bank 28-2F, 72,
// 73 or 74 (each bank has its own copy of the code: start / task, and its script table)
const ANIM_BANKS = [0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x72, 0x73];
const ANIM = {                                   // bank: [MapTileAnimStart, the script table]
  0x28: [0x7D0B, 0x405E], 0x29: [0x7927, 0x403A], 0x2A: [0x76BF, 0x4028], 0x2B: [0x73ED, 0x403A],
  0x2C: [0x7AD1, 0x405E], 0x2D: [0x739D, 0x4028], 0x2E: [0x79D5, 0x403A], 0x2F: [0x7D20, 0x403A],
  0x72: [0x76BD, 0x403A], 0x73: [0x76C7, 0x403A], 0x74: [0x79AE, 0x403A],
};
export function mapGfxStartTileAnim(w, a) {
  const p = 0x42C0 + ((a << 1) & 0x1FE);
  const sub = rb(B, p), slot = rb(B, p + 1);
  const bank = ANIM_BANKS[slot] ?? 0x74;
  D.inBank(w, bank, () => mapTileAnimStart(w, bank, sub));
}
// MapTileAnimStart (28:7D0B and the copies 29:7927 2A:76BF 2B:73ED 2C:7AD1 2D:739D 2E:79D5 2F:7D20 72:76BD 73:76C7 74:79AE,
// the same code: tools/compare_routines.py; each fuzzed against the ROM by web/tests/golf_fuzz_routines.mjs): $C32F = a; the four tracks' (frame offset, timer) $C330-$C337 = ($FF, 1) and
// their starts $C338-$C33B = $FF; the script (table[a]; $FE first: no animation) is split at its $FF bytes: track 0
// from offset 0 (timer 1), each next one from the byte after its first ($C338 + n and its offset = that + 1, its
// timer = the first byte + 1); the last track before $FE is left unused; then the bank's MapTileAnimTask
export function mapTileAnimStart(w, bank, a) {
  const [, table] = ANIM[bank];
  wr(w, 0xC32F, a);
  for (let k = 0; k < 4; k++) { wr(w, 0xC330 + 2 * k, 0xFF); wr(w, 0xC331 + 2 * k, 1); }
  for (let k = 0; k < 4; k++) wr(w, 0xC338 + k, 0xFF);
  let de = rw(bank, (table + ((a << 1) & 0x1FE)) & 0xFFFF);
  if (rb(bank, de) === 0xFE) return;
  let sv = 0xC332;                               // (a stack variable: the next track's offset byte)
  let b = 0xFF, c = 3;
  wr(w, 0xC330, 0);
  wr(w, 0xC338, 0);
  let hl = 0xC339;
  for (;;) {
    b = (b + 1) & 0xFF;
    const v = rb(bank, de); de = (de + 1) & 0xFFFF;
    if (v === 0xFE) break;
    if (v !== 0xFF) continue;
    b = (b + 1) & 0xFF;
    const o = (b + 1) & 0xFF;
    wr(w, hl, o);
    wr(w, sv, o); sv += 2;
    const t = (rb(bank, de) + 1) & 0xFF; de = (de + 1) & 0xFFFF;
    wr(w, 0xC330 + 2 * (4 - c) + 1, t);
    hl++;
    c--;
    if (!c) break;
  }
  hl--;
  wr(w, hl, 0xFF);
  wr(w, sv - 2, 0xFF);
  registerFrameTask(w, 0x01, bank, ANIM[bank][0] + 0xB6);   // MapTileAnimTask
}
// MapTileAnimTask (28:7DC1 and the copies 29:79DD 2C:7B87 2D:7453 2E:7A8B 2F:7DD6 73:777D 74:7A64; those of the banks
// without an animation, 2A:7775 2B:74A3 72:7773, never step: fuzzed with no tracks only, and the same instructions as 28:7DC1:
// tools/compare_routines.py): unless flag #24 is set (and #28 clear), WRAM6: each track's timer down from
// its start ($C338 + n, $FF ends the list: the loop reads on past track 3 while the timers run), a step at 0
export function mapTileAnimTask(w, bank) {
  if (!testFlag(w, 28) && testFlag(w, 24)) return;
  const old = w.high[0x196];
  setW(w, 6);
  let c = 0, hl = 0xC338;
  for (let guard = 0; ; guard++) {
    if (guard > 0x100) throw new Error("MapTileAnimTask: no $FF after the tracks (the game reads on)");
    if (rd(w, hl) === 0xFF) break;
    const t = (0xC330 + ((c << 1) & 0xFFFF) + 1) & 0xFFFF;
    const a = (rd(w, t) - 1) & 0xFF;
    wr(w, t, a);
    hl = (hl + 1) & 0xFFFF;
    const b = c; c = (c + 1) & 0xFF;
    if (a) continue;
    mapTileAnimStep(w, bank, b);
    if (c === 4) break;
  }
  setW(w, old);
}
// MapTileAnimStep (28:7E08 and the copies 29:7A24 2C:7BCE 2D:749A 2E:7AD2 2F:7E1D 73:77C4 74:7AAB; 2A:77BC 2B:74EA
// 72:77BA never run: the same instructions as 28:7E08, tools/compare_routines.py): track a's frame at its offset (src tile, count, dest tile, frames; $FF: back
// to the track's start): count tiles from WRAM6 $D800 + 16 src queued to VRAM1 $9000 + 16 dest; the offset moves 4
// (scratch $C33C), the timer = frames
export function mapTileAnimStep(w, bank, a) {
  const [, table] = ANIM[bank];
  wr(w, 0xC33C, rd(w, 0xC330 + 2 * a));
  let hl;
  for (let guard = 0; ; guard++) {
    if (guard > 2) throw new Error("MapTileAnimStep: the track's start is $FF (the game loops for ever)");
    hl = (rw(bank, (table + ((rd(w, 0xC32F) << 1) & 0x1FE)) & 0xFFFF) + rd(w, 0xC33C)) & 0xFFFF;
    if (rb(bank, hl) !== 0xFF) break;
    wr(w, 0xC33C, rd(w, 0xC338 + a));
  }
  const src = rb(bank, hl), n = rb(bank, hl + 1), dest = rb(bank, hl + 2), frames = rb(bank, hl + 3);
  D.queueVRAMCopy(w, (0xD800 + (src << 4)) & 0xFFFF, (0xB000 + (dest << 4)) & 0xFFFF, n);
  wr(w, 0xC33C, (rd(w, 0xC33C) + 4) & 0xFF);
  wr(w, 0xC330 + 2 * a, rd(w, 0xC33C));
  wr(w, 0xC331 + 2 * a, frames);
}
export const mapTileAnimTasks = w => {
  const o = {};
  for (const [bank, [start]] of Object.entries(ANIM)) {
    o[`${(+bank).toString(16).padStart(2, "0")}:${(start + 0xB6).toString(16)}`] = () => mapTileAnimTask(w, +bank);
  }
  return o;
};

// 0B:49D3 MapCenterCamera: the scroll on the player actor ($C290) less 9.F / 10.F tiles, within the map bounds
// (columns $C329 .. [$C32B] - $14, rows $C32A .. [$C32C] - $12); leaves WRAM4 mapped
export function mapCenterCamera(w) {
  setW(w, 4);
  const p = r16(w, 0xC290);
  const clamp = (v, lo, hi) => {
    if ((((v >> 8) - lo) & 0xFF) & 0x80) return lo << 8;
    if (!((((v >> 8) - hi) & 0xFF) & 0x80)) return hi << 8;
    return v;
  };
  const x = clamp((r16(w, p + 4) + 0xF610) & 0xFFFF, rd(w, 0xC329), (rd(w, 0xC32B) - 0x14) & 0xFF);
  const y = clamp((r16(w, p + 6) + 0xF510) & 0xFFFF, rd(w, 0xC32A), (rd(w, 0xC32C) - 0x12) & 0xFF);
  wr(w, 0xC320, x & 0xFF); wr(w, 0xC321, x >> 8);
  wr(w, 0xC322, y & 0xFF); wr(w, 0xC323, y >> 8);
}

// 0B:48EA MapBufAddr: h = tile x, l = tile y -> the 64 x 64 buffers' address
export const mapBufAddr = (h, l) => (0xD000 + ((((l & 0x80 ? (l << 8) | ~0xFFFF : l << 8) >> 2) & 0xFFFF) + h)) & 0xFFFF;

// 0B:6DC7 MapBufCopyRect: the rectangle (b, c) -> (d, e), h wide and l tall, in both 64 x 64 buffers (WRAM2
// attributes, WRAM3 tiles); no redraw
export function mapBufCopyRect(w, b, c, d, e, h, l) {
  const old = w.high[0x196];
  const dst0 = mapBufAddr(d, e), src0 = mapBufAddr(b, c);
  for (const bank of [2, 3]) {
    setW(w, bank);
    let dst = dst0, src = src0;
    let rows = l;
    do {
      D.copyMemoryBC(w, src, dst, h);            // 00:03D3 (bc = h)
      dst = (dst + 0x40) & 0xFFFF; src = (src + 0x40) & 0xFFFF;
      rows = (rows - 1) & 0xFF;
    } while (rows);
  }
  setW(w, 5);
  setW(w, old);
}

// 0B:4653 MapCopyTerrainRect / 0B:4699 MapCopyEventRect: the rectangle of the WRAM6 terrain grid $D000 (event grid
// $D400) at tile (b, c) copied to tile (d, e) (0B:45AB MapTerrainCellAddr / 0B:45FF MapEventCellAddr: cell (x / 2,
// y / 2), 32 a row), h / 2 cells wide, l / 2 rows (sra: halves); the WRAM bank kept
function mapCopyGridRect(w, base, b, c, d, e, h, l) {
  const cell = (x, y) => base + ((y >> 1) << 5) + (x >> 1);
  let src = cell(b, c), dst = cell(d, e);
  const wd = h >> 1, rows = l >> 1, g = w.wram[6];
  for (let k = 0; k < (rows || 0x100); k++) {
    for (let i = 0; i < (wd || 0x100); i++) g[(dst + i - 0xD000) & 0xFFF] = g[(src + i - 0xD000) & 0xFFF];   // 00:03D3 CopyMemoryBC
    src += 0x20; dst += 0x20;
  }
}
export const mapCopyTerrainRect = (w, b, c, d, e, h, l) => mapCopyGridRect(w, 0xD000, b, c, d, e, h, l);
export const mapCopyEventRect = (w, b, c, d, e, h, l) => mapCopyGridRect(w, 0xD400, b, c, d, e, h, l);

// 0B:4864 MapBufCopyRectRedraw: as 0B:6DC7 MapBufCopyRect (the rectangle (b, c) -> (d, e), h wide, l tall, in WRAM2
// and WRAM3), then the shadow from the map (05:4492), a frame, and the rows from e redrawn (05:42AD, l rows): the
// map scripts' doors and other tile changes
export function* mapBufCopyRectRedraw(sh, b, c, d, e, h, l) {
  const w = sh.w, old = w.high[0x196];
  const dst0 = mapBufAddr(d, e), src0 = mapBufAddr(b, c);
  for (const bank of [2, 3]) {
    setW(w, bank);
    let dst = dst0, src = src0, rows = l;
    do {
      D.copyMemoryBC(w, src, dst, h);            // 00:03D3
      dst = (dst + 0x40) & 0xFFFF; src = (src + 0x40) & 0xFFFF;
      rows = (rows - 1) & 0xFF;
    } while (rows);
  }
  setW(w, 5);
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* sh.advance();
  yield* inBankGen(w, 0x05, copyShadowRowsFramed(sh, e, l));
  setW(w, old);
}
// MapTileAnimStop (28:7DB2 and its copies 29:79CE 2A:7766 2B:7494 2C:7B78 2D:7444 2E:7A7C 2F:7DC7 72:7764 73:776E
// 74:7A55): the bank's MapTileAnimTask unregistered (0B:497D, its only caller, never sends a bank-72-74 graphics id)
export function mapTileAnimStop(w, bank) { unregisterFrameTask(w, bank, ANIM[bank][0] + 0xB6); }
// 0B:497D MapGfxStopTileAnim: a = graphics id: MapGfxAnimTable 0B:42C0's bank slot 0-6 stops the animation of bank
// $28-$2E, any other the one of bank $2F (a quirk: banks $72-$74's ids stop bank $2F's task; only the debug viewer
// 0B:4579 sends them)
export function mapGfxStopTileAnim(w, a) {
  const slot = rb(B, 0x42C0 + ((a << 1) & 0x1FE) + 1);
  const bank = slot <= 6 ? 0x28 + slot : 0x2F;
  D.inBank(w, bank, () => mapTileAnimStop(w, bank));
}
