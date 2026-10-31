// The display model and the home bank's display services, ported from the ROM. The model is what the Game Boy
// Color's display hardware holds, kept on the engine's memory (GolfMemory w): w.vram[0..1] (8 KB each), w.oam
// ($A0), w.bgPal / w.objPal (the palette RAM, 64 bytes each) and w.lcd (LCDC, SCX, SCY, WX, WY, VBK, the palette
// index registers). Ported game code writes it the way the ROM's code does: through the RAM buffers the home bank
// keeps (the shadow OAM $C000, the VRAM copy queue $C0A0, the live palettes $C100, the BG tile-write queue $C180,
// the BG row / column blit buffers $C300-$C3FF, the scroll shadows hSCX / hSCY), which VBlank (00:2EF9) moves to the
// hardware. render/raster.js draws the model.
//
// rd / wr are a CPU's view of the address space for the ported display code: ROM through hROMBank ($FF95), WRAM
// $D000 through hWRAMBank ($FF96; the game always writes it together with rSVBK), VRAM through VBK, OAM, HRAM and
// the LCD and palette registers.
import { rb, lzDecompress, offset } from "../rom.js";

export function initDisplay(w) {
  w.vram = [new Uint8Array(0x2000), new Uint8Array(0x2000)];
  w.oam = new Uint8Array(0xA0);
  w.bgPal = new Uint8Array(64);
  w.objPal = new Uint8Array(64);
  w.lcd = { lcdc: 0xE7, scx: 0, scy: 0, wx: 7, wy: 0x90, vbk: 0, bcps: 0, ocps: 0, ie: 0x0D, turnedOn: false };
  return w;
}

// the display state from the emulator core (tests: the native renderer starts from the game's screen)
export function displayFromCore(w, gb) {
  if (!w.vram) initDisplay(w);
  const m = gb.mem, p = gb.ppu;
  w.vram[0].set(m.vram[0]); w.vram[1].set(m.vram[1]);
  w.oam.set(m.oam); w.bgPal.set(p.bgPal); w.objPal.set(p.objPal);
  Object.assign(w.lcd, { lcdc: p.lcdc, scx: p.scx, scy: p.scy, wx: p.wx, wy: p.wy, vbk: m.vbk, bcps: p.bcps, ocps: p.ocps, ie: m.ie });
  return w;
}

export const svbk = w => (w.high[0x196] & 7) || 1;
export function setWramBank(w, n) { w.high[0x196] = n; }

export function rd(w, a) {
  a &= 0xFFFF;
  if (a < 0x4000) return rb(0, a);
  if (a < 0x8000) return rb(w.high[0x195], a);
  if (a < 0xA000) return w.vram[w.lcd.vbk][a - 0x8000];
  if (a < 0xC000) return 0xFF;
  if (a < 0xD000) return w.wram[0][a - 0xC000];
  if (a < 0xE000) return w.wram[svbk(w)][a - 0xD000];
  if (a < 0xFE00) return rd(w, a - 0x2000);
  if (a < 0xFEA0) return w.oam[a - 0xFE00];
  if (a < 0xFF00) return 0xFF;
  if (a < 0xFF80) return ioRead(w, a & 0x7F);
  return w.high[a - 0xFE00];
}

export function wr(w, a, v) {
  a &= 0xFFFF; v &= 0xFF;
  if (a < 0x8000) return;                        // MBC registers (the bank is kept in hROMBank)
  if (a < 0xA000) { w.vram[w.lcd.vbk][a - 0x8000] = v; return; }
  if (a < 0xC000) return;
  if (a < 0xD000) { w.wram[0][a - 0xC000] = v; return; }
  if (a < 0xE000) { w.wram[svbk(w)][a - 0xD000] = v; return; }
  if (a < 0xFE00) return wr(w, a - 0x2000, v);
  if (a < 0xFEA0) { w.oam[a - 0xFE00] = v; return; }
  if (a < 0xFF00) return;
  if (a < 0xFF80) return ioWrite(w, a & 0x7F, v);
  w.high[a - 0xFE00] = v;
}

function ioRead(w, r) {
  const l = w.lcd;
  switch (r) {
    case 0x40: return l.lcdc; case 0x42: return l.scy; case 0x43: return l.scx;
    case 0x4A: return l.wy; case 0x4B: return l.wx; case 0x4F: return l.vbk | 0xFE;
    case 0x70: return svbk(w) | 0xF8;
    default: return 0xFF;
  }
}

function ioWrite(w, r, v) {
  const l = w.lcd;
  switch (r) {
    case 0x40: setLcdc(w, v); return;
    case 0x42: l.scy = v; return; case 0x43: l.scx = v; return;
    case 0x4A: l.wy = v; return; case 0x4B: l.wx = v; return;
    case 0x4F: l.vbk = v & 1; return;
    case 0x68: l.bcps = v & 0xBF; return;
    case 0x69: w.bgPal[l.bcps & 0x3F] = v; if (l.bcps & 0x80) l.bcps = 0x80 | ((l.bcps + 1) & 0x3F); return;
    case 0x6A: l.ocps = v & 0xBF; return;
    case 0x6B: w.objPal[l.ocps & 0x3F] = v; if (l.ocps & 0x80) l.ocps = 0x80 | ((l.ocps + 1) & 0x3F); return;
    default: return;                             // SVBK follows hWRAMBank; sound, timer, serial: not display
  }
}

function setLcdc(w, v) {
  if (!(w.lcd.lcdc & 0x80) && (v & 0x80)) w.lcd.turnedOn = true;   // the hardware shows the next frame blank
  w.lcd.lcdc = v;
}

// ---- calls in other banks: hROMBank while it runs (FarCall 00:01B6 keeps it on the stack; rst $18 00:0018 and
// rst $10 00:0010 -> 00:01F6 FarCallVectorInline, which calls the export through 00:0213 CallVectorEntryE; 00:01E6
// CallVectorEntryA the same by a; the call itself is the function call here) ----
export function inBank(w, bank, fn) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return fn(); } finally { w.high[0x195] = old; }
}

// ---- LCD on / off ----
export function disableLCDSafely(w) {           // 00:0341 DisableLCDSafely (waits for line $91, then LCD off)
  if (w.lcd.lcdc & 0x80) w.lcd.lcdc &= 0x7F;
  clearVRAMCopyQueue(w);
  w.high[0x1B8] = w.high[0x1B9] = w.high[0x1BA] = 0;
}

export function enableLCD(w) {                   // 00:0371 EnableLCD (and one sound update: sound)
  setLcdc(w, w.lcd.lcdc | 0x80);
}

// ---- memory helpers ----
export function clearMemory16(w, hl, c) {        // 00:03A7 ClearMemory16: c x 16 bytes
  for (let n = (c || 256) * 16; n; n--) wr(w, hl++, 0);
  return hl;
}
export function clearMemoryBC16(w, hl, bc) {     // 00:03BC ClearMemoryBC16
  for (let n = (bc || 0x10000) * 16; n; n--) wr(w, hl++, 0);
}
export function copyMemoryBC(w, hl, de, bc) {    // 00:03D3 CopyMemoryBC
  for (let n = bc || 0x10000; n; n--) wr(w, de++, rd(w, hl++));
}
export function copyMemoryFast(w, hl, de, c) {   // 00:03EB CopyMemoryFast: c x 16 bytes
  for (let n = (c || 256) * 16; n; n--) wr(w, de++, rd(w, hl++));
}
export function clearBothVRAMBanks(w) {          // 00:024E ClearBothVRAMBanks
  w.vram[1].fill(0); w.vram[0].fill(0); w.lcd.vbk = 0;
}
export function clearBGMaps(w) {                 // 00:0267 (ClearBGMap 00:038B on the CGB)
  w.vram[1].fill(0, 0x1800, 0x2000); w.vram[0].fill(0, 0x1800, 0x2000); w.lcd.vbk = 0;
}
export function clearVRAMBank(w) { clearBothVRAMBanks(w); }   // 00:037B ClearVRAMBank (CGB)

// ---- ROM assets ----
export function lzTo(w, bank, src, de) {         // 00:1F2F LZDecompress of the stream at bank:src to de
  const out = lzDecompress(offset(bank, src));
  for (let i = 0; i < out.length; i++) wr(w, de + i, out[i]);
  return out.length;
}
const listEntry = (bank, idx, n) => {            // the word bank:[$4000 + idx], then entry n of that list
  const list = rb(bank, 0x4000 + idx) | rb(bank, 0x4001 + idx) << 8;
  const p = (list + 2 * n) & 0xFFFF;
  return rb(bank, p) | rb(bank, p + 1) << 8;
};
export function farDispatchIndexed(w, hl, a, de) {   // 00:069A FarDispatchIndexed: h bank, l idx, a entry -> LZ to de
  return lzTo(w, hl >> 8, listEntry(hl >> 8, hl & 0xFF, a), de);
}
export function farCopyIndexed(w, hl, a, de, c) {    // 00:06C2 FarCopyIndexed: c bytes raw
  let src = listEntry(hl >> 8, hl & 0xFF, a);
  inBank(w, hl >> 8, () => { for (let n = c || 256; n; n--) wr(w, de++, rd(w, src++)); });
}
export function farQueueIndexed(w, hl, a, de, c) {   // 00:06F1 FarCallIndexed1: QueueVRAMCopy of that entry
  const src = listEntry(hl >> 8, hl & 0xFF, a);
  return inBank(w, hl >> 8, () => queueVRAMCopy(w, src, de, c));
}
export function farDMAIndexed(w, hl, a, de, c) {     // 00:071D FarCallIndexed2: StartVRAMDMAFromHL of that entry
  const src = listEntry(hl >> 8, hl & 0xFF, a);
  inBank(w, hl >> 8, () => startVRAMDMAFromHL(w, src, de, c));
}
export function farCopyFastIndexed(w, hl, a, de, c) { // 00:0749 FarCallIndexed3: CopyMemoryFast of that entry
  const src = listEntry(hl >> 8, hl & 0xFF, a);
  inBank(w, hl >> 8, () => copyMemoryFast(w, src, de, c));
}

// ---- VRAM DMA (general purpose HDMA: the copy is at once) ----
export function hdma(w, src, dst, a) {           // HDMA1-5 written: src, dst, a = blocks - 1 (bit 7: in HBlanks)
  if (a & 0x80) throw new Error("HBlank DMA is not modelled");
  src &= 0xFFF0; dst = 0x8000 | (dst & 0x1FF0);
  for (let n = ((a & 0x7F) + 1) * 16; n; n--) {
    w.vram[w.lcd.vbk][dst - 0x8000] = rd(w, src);
    src = (src + 1) & 0xFFFF; dst = 0x8000 | ((dst + 1) & 0x1FFF);
  }
}
export function startVRAMDMATransfer(w, bc, de, a) { hdma(w, bc, de, a); }   // 00:2082 StartVRAMDMATransfer
export function startVRAMDMAFromHL(w, hl, de, c) { hdma(w, hl, de, (c - 1) & 0xFF); }   // 00:2096 StartVRAMDMAFromHL

// ---- the VRAM copy queue: 10 entries of 8 bytes at $C0A0 ----
export function clearVRAMCopyQueue(w) { w.wram[0].fill(0, 0x0A0, 0x0F0); }   // 00:0458 ClearVRAMCopyQueue

// 00:0468 QueueVRAMCopy: hl = source, de = VRAM address ($A000-$BFFF: VRAM bank 1), c = 16-byte blocks; false when full
export function queueVRAMCopy(w, hl, de, c) {
  const w0 = w.wram[0], h = w.high;
  h[0x199] = 0;
  const a = (c - 1) & 0xFF;
  let p = 0x0A0;
  for (let k = 0; k < 10; k++, p += 8) if (!w0[p]) break;
  if (p >= 0x0F0) { h[0x199] = 1; return false; }
  w0[p] = h[0x195]; w0[p + 1] = h[0x196];
  w0[p + 2] = hl & 0xFF; w0[p + 3] = hl >> 8;
  w0[p + 4] = de & 0x2000 ? 1 : 0;
  w0[p + 5] = de & 0xFF; w0[p + 6] = (de >> 8) & 0xDF;
  w0[p + 7] = a & 0x80 ? 1 : a;                  // (more than $80 blocks: two error sounds, one block)
  h[0x199] = 1;
  return true;
}
export function queueVRAMCopyBreak(w) { return queueVRAMCopy(w, 0xFFFF, 0xFFFF, 1); }   // 00:0460 QueueVRAMCopyBreak
export function queueAndRunVRAMCopy(w, hl, de, c) {   // 00:04DB QueueAndRunVRAMCopy (LCD off)
  queueVRAMCopy(w, hl, de, c);
  processVRAMCopyQueue(w);
}

// 00:04B4 QueueBGTileWrite: de = BG map address, c = tile, b = attribute (16 entries at $C180)
export function queueBGTileWrite(w, de, c, b) {
  const w0 = w.wram[0];
  w.high[0x199] = 0;
  for (let p = 0x180; p < 0x1C0; p += 4) {
    if (w0[p]) continue;
    w0[p] = de >> 8; w0[p + 1] = de & 0xFF; w0[p + 2] = c; w0[p + 3] = b;
    break;
  }
  w.high[0x199] = 1;
}

export function processVRAMCopyQueue(w) {        // 00:04DE ProcessVRAMCopyQueue (VBlank, or with the LCD off)
  const w0 = w.wram[0], h = w.high;
  if (!h[0x199]) return;
  const keepRom = h[0x195], keepWram = h[0x196];
  let p = 0x0A0;
  for (let c = 10; c; c--, p += 8) {
    if (!w0[p]) break;
    h[0x195] = w0[p];
    w0[p] = 0;
    h[0x196] = w0[p + 1];
    const src = w0[p + 2] | w0[p + 3] << 8;
    if (src & 1) {                               // a break: the later entries move to the front for next time
      c--;
      if (!c) break;
      const n = c * 8;
      let q = p + 8;
      for (let k = 0; k < n; k++) w0[0x0A0 + k] = w0[q++];
      w0[0x0A0 + n] = 0;
      break;
    }
    w.lcd.vbk = w0[p + 4] & 1;
    hdma(w, src, w0[p + 5] | w0[p + 6] << 8, w0[p + 7]);
  }
  h[0x196] = keepWram; h[0x195] = keepRom;
  for (let q = 0x180; q < 0x1C0; q += 4) {       // the BG tile writes
    if (!w0[q]) break;
    const de = w0[q] << 8 | w0[q + 1];
    w0[q] = 0;
    w.vram[0][(de - 0x8000) & 0x1FFF] = w0[q + 2];
    w.vram[1][(de - 0x8000) & 0x1FFF] = w0[q + 3];
    w.lcd.vbk = 1;
  }
}

// ---- palettes: wPalLive $C100 (BG $C100, OBJ $C140), the master copy wBGPalMaster $C200, hPalUpdate $FF9D ----
function palUpdateBits(w, d, e) {
  if (!(d & 8)) w.high[0x19D] |= 1;
  if (((e + d) & 0xFF) >= 9) w.high[0x19D] |= 2;
}
// 00:056C LoadPalettesImmediate: hl = colours (read through rd), d = first palette (0-15), e = count
export function loadPalettesImmediate(w, hl, d, e) {
  const n = (e * 8) & 0xFF, o = (d * 8) & 0xFF;
  for (let k = 0; k < (n || 256); k++) {
    const v = rd(w, hl + k), a = (o + k) & 0xFF;
    w.wram[0][0x100 + a] = v; w.wram[0][0x200 + a] = v;
  }
  palUpdateBits(w, d, e);
}
export function loadPalettesMasterOnly(w, hl, d, e) {   // 00:0595 LoadPalettesMasterOnly
  const n = (e * 8) & 0xFF, o = (d * 8) & 0xFF;
  for (let k = 0; k < (n || 256); k++) w.wram[0][0x200 + ((o + k) & 0xFF)] = rd(w, hl + k);
}
export function loadPalettesUnlessFaded(w, hl, d, e) {  // 00:05A8 LoadPalettesUnlessFaded
  const n = (e * 8) & 0xFF, o = (d * 8) & 0xFF;
  for (let k = 0; k < (n || 256); k++) {
    const v = rd(w, hl + k), a = (o + k) & 0xFF;
    w.wram[0][0x200 + a] = v;
    if (!w.high[0x1BC]) w.wram[0][0x100 + a] = v;
  }
  if (!w.high[0x1BC]) palUpdateBits(w, d, e);
}
export function restorePalettesFromMaster(w) {   // 00:05DD RestorePalettesFromMaster
  w.wram[0].copyWithin(0x100, 0x200, 0x280);
  w.high[0x19D] = 3;
}
export function applyPendingPaletteUpdates(w) {  // 00:05F6 ApplyPendingPaletteUpdates (00:027F / 00:0287)
  const u = w.high[0x19D];
  if (u & 1) { w.bgPal.set(w.wram[0].subarray(0x100, 0x140)); w.lcd.bcps = 0x80; }
  if (u & 2) { w.objPal.set(w.wram[0].subarray(0x140, 0x180)); w.lcd.ocps = 0x80; }
  w.high[0x19D] = 0;
}

// ---- sprites: wShadowOAM $C000, hSpriteQueueIndex $FF9B, hOAMUsed $FF9C ----
export function resetSprites(w) {                // 00:2683 ResetSprites
  w.high[0x19B] = w.high[0x19C] = 0;
  clearUnusedSprites(w);
}
export function clearUnusedSprites(w) {          // 00:2688 ClearUnusedSprites
  const a = w.high[0x19C];
  w.high[0x19B] = a;
  if (a >= 0xA0) return;
  w.wram[0].fill(0, a & 0xFC, 0xA0);
}
export function setSpriteQueueBase(w) { w.high[0x19C] = w.high[0x19B]; }   // 00:269F SetSpriteQueueBase

function oamPut(w, l, y, x, t, a) { const o = w.wram[0]; o[l] = y & 0xFF; o[l + 1] = x & 0xFF; o[l + 2] = t & 0xFF; o[l + 3] = a & 0xFF; }

export function queueSprite16(w, e, d, c, b) {   // 00:26A4 QueueSprite16: two 8x16 sprites side by side (X flip swaps)
  let l = w.high[0x19B];
  if (l === 0xA0) return;
  const flip = b & 0x20;
  oamPut(w, l, e, flip ? d + 8 : d, c, b); l += 4;
  c += 2;
  if (l !== 0xA0) { oamPut(w, l, e, flip ? d : d + 8, c, b); l += 4; }
  w.high[0x19B] = l;
}

// 00:26EA QueueSpriteTemplate: hl = list of (dy, dx, tile, attr), $80 ends; at (e, d), tile + c, attr | b
export function queueSpriteTemplate(w, hl, e, d, c, b, read = a => rd(w, a)) {
  let l = w.high[0x19B];
  const flip = b & 0x20;
  for (;;) {
    if (l === 0xA0) break;
    const dy = read(hl);
    if (dy === 0x80) break;
    const dx = read(hl + 1);
    oamPut(w, l, dy + e, flip ? ((~dx + 9) & 0xFF) + d : dx + d, read(hl + 2) + c, read(hl + 3) | b);
    l += 4; hl += 4;
  }
  w.high[0x19B] = l;
}

// 00:2756 QueueSpriteGrid: h columns x l rows of 8x16 sprites from (e + $10, d + 8), tile c + 2 per sprite
export function queueSpriteGrid(w, hl, de, bc) {
  let e = ((de & 0xFF) + 0x10) & 0xFF, d = ((de >> 8) + 8 + (((de & 0xFF) + 0x10) >> 8)) & 0xFF;
  let c = bc & 0xFF;
  const b = bc >> 8;
  for (let rows = hl & 0xFF || 256; rows; rows--) {
    let dd = d;
    for (let cols = hl >> 8 || 256; cols; cols--) {
      const l = w.high[0x19B];
      if (l === 0xA0) return;
      oamPut(w, l, e, dd, c, b);
      w.high[0x19B] = l + 4;
      c = (c + 2) & 0xFF;
      dd = (dd + 8) & 0xFF;
    }
    e = (e + 0x10) & 0xFF;
  }
}

export function queueSprite(w, e, d, c, b) {     // 00:2798 QueueSprite: one sprite at (e + $0C, d + 4)
  const l = w.high[0x19B];
  if (l === 0xA0) return;
  oamPut(w, l, e + 0x0C, d + 4, c, b);
  w.high[0x19B] = l + 4;
}

function worldToScreen(w, hl, de, rows) {        // 00:27B4 / 00:27FA: map position (8.8 tiles) -> screen, or null
  const w0 = w.wram[0];
  let x = (hl - (w0[0x320] | w0[0x321] << 8)) & 0xFFFF;
  if ((((x >> 8) + 1) & 0xFF) >= 0x16) return null;
  x = (x << 3) & 0xFFFF;
  const y = (de - (w0[0x322] | w0[0x323] << 8)) & 0xFFFF;
  if ((y >> 8) >= rows) return null;
  return [((y << 3) & 0xFFFF) >> 8, x >> 8];
}
export function positionSpriteWorld(w, hl, de, c, b) {    // 00:27B4 PositionSpriteWorld: QueueSprite16 there
  const p = worldToScreen(w, hl, de, 0x14);
  if (p) queueSprite16(w, p[0], p[1], c, b);
}
export function positionSpriteWorld2(w, hl, de, c, b) {   // 00:27FA PositionSpriteWorld2: QueueSprite there
  const p = worldToScreen(w, hl, de, 0x13);
  if (p) queueSprite(w, p[0], p[1], c, b);
}

// ---- BG row / column blits from the 64 x 64 maps (WRAM2 attributes, WRAM3 tiles) ----
function mapBufferAddr64(w, b, c) {              // 00:2A6C GetMapBufferAddr64
  const w0 = w.wram[0];
  return 0xD000 + (((w0[0x323] + c) & 0x3F) << 6) + ((w0[0x321] + b) & 0x3F);
}
export function blitBGRowFrom64(w, b, c) {       // 00:2A8A BlitBGRowFrom64: row c, from column b, into $C300 / $C340
  const w0 = w.wram[0];
  const dst = 0x9800 + (((w0[0x323] + c) & 0x1F) << 5);
  w0[0x326] = dst & 0xFF; w0[0x327] = dst >> 8;
  let e = (w0[0x321] + b) & 0x1F;
  const src = mapBufferAddr64(w, b, c);
  for (const [bank, base] of [[2, 0x300], [3, 0x340]]) {
    setWramBank(w, bank);
    let hl = src, ee = e;
    for (let n = 0x20; n; n--) {
      w0[base + ee] = rd(w, hl++);
      if (!(hl & 0x3F)) hl -= 0x40;
      ee = (ee + 1) & 0x1F;
    }
  }
  w.high[0x1B8] = 1;
}
export function blitBGColumnFrom64(w, b, c) {    // 00:2AF7 BlitBGColumnFrom64: column b, from row c, into $C380 / $C3C0
  const w0 = w.wram[0];
  w0[0x328] = (w0[0x321] + b) & 0x1F;
  const e = (w0[0x323] + c) & 0x1F;
  const src = mapBufferAddr64(w, b, c);
  for (const [bank, base] of [[2, 0x380], [3, 0x3C0]]) {
    setWramBank(w, bank);
    let hl = src, ee = e;
    for (let n = 0x20; n; n--) {
      w0[base + ee] = rd(w, hl);
      hl = (((hl + 0x40) & 0xFFFF) & ~0x2000) | 0x1000;
      ee = (ee + 1) & 0x1F;
    }
  }
  w.high[0x1B9] = 1;
}
export function processBGBlitQueue(w) {         // 00:29EB ProcessBGBlitQueue (VBlank): 1 when it blitted
  const h = w.high, w0 = w.wram[0];
  h[0x1BA] = 0;
  if (h[0x1B8]) {
    const de = w0[0x326] | w0[0x327] << 8;
    w.lcd.vbk = 1; hdma(w, 0xC300, de, 1);
    w.lcd.vbk = 0; hdma(w, 0xC340, de, 1);
  }
  if (h[0x1B9]) {
    h[0x1BA] = 1;
    const col = w0[0x328];
    for (let k = 0; k < 0x20; k++) {
      w.vram[1][0x1800 + col + 0x20 * k] = w0[0x380 + k];
      w.vram[0][0x1800 + col + 0x20 * k] = w0[0x3C0 + k];
    }
    w.lcd.vbk = 0;
  }
  h[0x1B8] = h[0x1B9] = 0;
  return h[0x1BA];
}

// ---- VBlank's display work (00:2EF9 VBlankHandler: palettes, then for a frame the main loop finished the scroll,
// the OAM DMA and the BG blits or the VRAM copy queue); hVBlankDone $FF8D, hVBlankCount $FF8C ----
export function vblankDisplay(w) {
  const h = w.high, l = w.lcd;
  const vbk = l.vbk;
  applyPendingPaletteUpdates(w);
  if (!h[0x18D]) {
    if (!h[0x198]) { l.scx = h[0x18B]; l.scy = h[0x18A]; l.lcdc &= 0xF7; }
    else { l.scx = 0; l.scy = 0x40; l.lcdc |= 0x08; }   // hWindowScroll: the $9C00 map
    w.oam.set(w.wram[0].subarray(0, 0xA0));      // OAM DMA from $C000 (00:067A)
    if (!processBGBlitQueue(w)) processVRAMCopyQueue(w);
    if (h[0x19E]) updateDebugOverlay(w);
    h[0x18D] = 1;
    h[0x18C] = (h[0x18C] + 1) & 0xFF;
  }
  l.vbk = vbk;
}

// 00:203E UpdateDebugOverlay (VBlank, with hDebugMode): the CPU meter's four characters $C0FA-$C0FD to the $9C00 map at
// $9D08; hWindowScroll $FF98 = 1 in mode 3, 0 in mode 1, else 1 on even hVBlankCounts (the debug window shown every
// other frame); with $FF8E set (then cleared) the debug text $CC00 ($240 bytes, HDMA 00:2082) to $9D00. VRAM bank 0
export function updateDebugOverlay(w) {
  const h = w.high;
  if (w.vram) {
    w.lcd.vbk = 0;
    for (let k = 0; k < 4; k++) w.vram[0][0x1D08 + k] = w.wram[0][0x0FA + k];
  }
  const m = h[0x19E];
  h[0x198] = m === 3 ? 1 : m === 1 ? 0 : (h[0x18C] & 1) ? 0 : 1;
  if (!h[0x18E]) return;
  h[0x18E] = 0;
  if (w.vram) for (let k = 0; k < 0x240; k++) w.vram[0][0x1D00 + k] = w.wram[0][0xC00 + k];
}
// 00:2E3B AdvanceFrame's debug block (with hDebugMode): the CPU meter: rLY as the frame's code ends (an input: the
// time the code took, read from the hardware), the highest of the last 15 frames kept in $FFA0 (its timer $FFA1),
// FormatHexWord 00:20E0 of (that, rLY) to $C0FA as four hex characters; Select + Start held starts the frame step
// ($FF9A: not ported)
export function debugFrameMeter(w, ly) {
  const h = w.high;
  let hi;
  if (h[0x1A0] < ly) hi = null;
  else { h[0x1A1] = (h[0x1A1] - 1) & 0xFF; hi = h[0x1A1] ? h[0x1A0] : null; }
  if (hi === null) { hi = ly; h[0x1A0] = ly; h[0x1A1] = 0x0F; }
  const hex = v => (v < 10 ? 0x30 + v : 0x37 + v);
  const w0 = w.wram[0];
  w0[0x0FA] = hex(hi >> 4); w0[0x0FB] = hex(hi & 0x0F); w0[0x0FC] = hex(ly >> 4); w0[0x0FD] = hex(ly & 0x0F);
  if ((h[0x190] & 0x0C) === 0x0C || h[0x19A]) throw new Error("the debug frame step (~00:2E84) is not ported");
}
