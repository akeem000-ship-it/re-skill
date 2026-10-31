// Code no play reaches: unreferenced copies, dead branches and debug-only routines, ported so that the rewrite holds
// the whole traced code; each is checked against the ROM with random RAM and registers (web/tests/golf_fuzz_routines.mjs:
// the same RAM and registers in, the same registers, WRAM and HRAM out), not by a screen. REVERSE.md "Unreached code"
// lists them with how each is (not) reached.
import * as M from "./math.js";
import { rb } from "./rom.js";
import { rd, wr } from "./render/display.js";
import { dist24 } from "./cup.js";
import { loadText } from "./text.js";
import { registerFrameTask } from "./tasks.js";
import { queueVRAMCopy } from "./render/display.js";
import { mapScrollTask } from "./render/holeview.js";

// 40:5AA9 MulHLByDE_40 (unreferenced; the same code as 00:0CB5 MulHLByDE, its jumps relative): the high 16 bits of hl x de;
// the whole 32-bit product left in HRAM $FFA8-$FFAB (low byte first)
export function mulHLByDE40(w, hl, de) {
  const p = BigInt(hl) * BigInt(de);
  for (let k = 0; k < 4; k++) w.high[0x1A8 + k] = Number((p >> BigInt(8 * k)) & 0xFFn);
  return M.mulHLByDE(hl, de);
}
// 40:599C DivAHLByDE_40 (unreferenced; the same code as 00:0DDB DivAHLByDE): a:hl / de; HRAM $FFAC = a, and with de
// nonzero $FFAE / $FFAD = the first / second phase's quotient bytes; returns {a, h, l}
export function divAHLByDE40(w, a, hl, de) {
  w.high[0x1AC] = a;
  const [qa, q] = M.divAHLByDE(a, hl, de);
  if (de) { w.high[0x1AE] = qa; w.high[0x1AD] = q >> 8; }
  return { a: qa, h: q >> 8, l: q & 0xFF };
}

// more cases for the fuzz test: functions of rnd returning a case
export const FUZZ = [];

// ---- small helpers the rewrite does inline where they are called (checked as routines here) ----
// 02:4E39 GetCharRecord: bc = wPlayerName $C800 (the character's record)
export const getCharRecord = () => 0xC800;
// 02:5D11 TestBitN: bit a of the bytes at hl (a past 7: the next byte), by the mask table 02:5D27
export function testBitN(w, hl, a) {
  while (a >= 8) { a -= 8; hl = (hl + 1) & 0xFFFF; }
  return rb(0x02, 0x5D27 + a) & rd(w, hl);
}
// 02:544E AddPointsSigned (export $56; the debug points editor 41:77EA, debug.js): wPoints $C83C += de, 0 when negative
export function addPointsSigned(w, de) {
  let hl = (rd(w, 0xC83C) | rd(w, 0xC83D) << 8) + de & 0xFFFF;
  if (hl & 0x8000) hl = 0;
  wr(w, 0xC83C, hl & 0xFF); wr(w, 0xC83D, hl >> 8);
  return hl;
}
// 10:621E TargetCupDist (the debug readout 10:5549): |cup - wTargetMarker $D426 / $D428| (whole tiles: the fractions
// 0) by PinDist's tail 10:62DA
export function targetCupDist(w) {
  const r = a => rd(w, a) | rd(w, a + 1) << 8;
  let x = ((r(0xD43D) - r(0xD426)) & 0xFFFF) << 8, y = ((r(0xD43F) - r(0xD428)) & 0xFFFF) << 8;
  const hl = dist24(x, y);
  // (the HRAM MulHLByDE leaves: the product of its second square, x's, after dist24's normalisation)
  if (x & 0x800000) x = (-x) & 0xFFFFFF;
  if (y & 0x800000) y = (-y) & 0xFFFFFF;
  const m = (y >> 16) | (x >> 16);
  let a = ((m << 1) | 1) & 0xFF;
  if (!(m & 0x80)) for (;;) { const c = a >> 7; a = (a << 1) & 0xFF; if (c) break; x = (x << 1) & 0xFFFFFF; }
  const p = (x >> 8) * (x >> 8);
  for (let k = 0; k < 4; k++) w.high[0x1A8 + k] = (p >>> (8 * k)) & 0xFF;
  return hl;
}
// 48:497E SignOfDiff (DrawSignedScore's compare): bc - de: 2 negative, 0 zero, else 1
export function signOfDiff(bc, de) {
  const d = (bc - de) & 0xFFFF;
  return d & 0x8000 ? 2 : d ? 1 : 0;
}
// 0B:65DE HoleStrokesPlusPutts: player a's (0: $C8AC, else $C8EC) byte of hole c: its low nibble plus its high nibble
// (an arithmetic shift: a byte from $80 adds a negative nibble)
export function holeStrokesPlusPutts(w, a, c) {
  const v = rd(w, ((a ? 0xC8EC : 0xC8AC) + c) & 0xFFFF);
  return ((v & 0x0F) + (((v << 24) >> 28) & 0xFF)) & 0xFF;
}
// 0B:656F SumPlayerHoleCounts (unreferenced): d = the sum over holes 0-17 for player a
export function sumPlayerHoleCounts(w, a) {
  let d = 0;
  for (let c = 0; c < 0x12; c++) d = (d + holeStrokesPlusPutts(w, a, c)) & 0xFF;
  return d;
}
// 0B:6585 CountHolesWon (unreferenced): holes 18 down to 1 (byte index 18: one past the card) compared: [a = 1 when
// player 1 won more holes (e < d), d = player 1's holes won (fewer than player 2), e = player 2's]
export function countHolesWon(w) {
  let d = 0, e = 0;
  for (let c = 0x12; c; c--) {
    const b = holeStrokesPlusPutts(w, 0, c), a = holeStrokesPlusPutts(w, 1, c);
    if (a === b) continue;
    if (a < b) e = (e + 1) & 0xFF; else d = (d + 1) & 0xFF;
  }
  return [e < d ? 1 : 0, d, e];
}
// 3E:630C DivATen / 3E:631E ModATen (unreferenced): a / 10, a mod 10 (00:09AE DivHLByDE, 00:08B9 MulHLByA)
export const divATen = a => M.divHLByDE(a, 10) & 0xFF;
export const modATen = a => (((a - 10) & 0x80) ? a : (a - ((M.divHLByDE(a, 10) * 10) & 0xFF)) & 0xFF);
// 3E:6342 MatchScoreToWord: a score byte to a word, $91 and up negative
export const matchScoreToWord = a => (a >= 0x91 ? 0xFF00 | a : a);
// 10:4C4C SetForcedShotD (export $28): as SetForcedShot 10:4C36 (the club e, the aim bc) with $D4EB / $D4EC = d
// (WRAM6 left mapped)
export function setForcedShotD(w, bc, d, e) {
  w.high[0x196] = 6;
  const r6 = w.wram[6];
  r6[0x4E7] = 1; r6[0x4E8] = e; r6[0x4E9] = bc & 0xFF; r6[0x4EA] = bc >> 8; r6[0x4EB] = d; r6[0x4EC] = d;
}
// 0A:531F MapCount / 0A:5336 MapIdAt (the debug warp menu ~05:6C25): MapTable 0A:5188's records (6 bytes, $FF ends)
export function mapCount() { let b = 0xFF; for (let hl = 0x5188; ; hl += 6) { const a = rb(0x0A, hl); b = (b + 1) & 0xFF; if (a === 0xFF) return b; } }
export const mapIdAt = a => rb(0x0A, (0x5188 + a * 6) & 0xFFFF);
// 0A:5675 PalOffset: hl + b x 8 (8-bit steps with their carries; PalFadeSetup's palette address)
export function palOffset(hl, b) { for (; b; b = (b - 1) & 0xFF) hl = ((hl & 0xFF00) + ((hl & 0xFF) + 8)) & 0xFFFF; return hl; }
// 48:4D4C CopyTextToWram1D800 (unreferenced): text hl loaded (05:6179, WRAM5 mapped) and copied from $C600 to WRAM1
// $D800 with its $00 (WRAM1 left mapped)
export function copyTextToWram1D800(w, hl) {
  w.high[0x196] = 5;
  loadText(w, hl);
  for (let s = 0xC600, d = 0xD800; ; s++, d++) {
    w.high[0x196] = 5; const b = rd(w, s);
    w.high[0x196] = 1; wr(w, d, b);
    if (!b) break;
  }
}

// ---- bank 12's map readers (CellInfoAt is the debug readout's, 12:6F16; the others unreferenced) ----
const wb = (w, bank, a) => w.wram[bank][a - 0xD000];
// 12:4098 GreenSlopeDirAt: h = column, d = row (tiles): the slope byte of the tile (WRAM6 $D700 + the WRAM3 map's tile)
// and its direction (low 3 bits, + 8 x the tile's flips: WRAM2 bits 5-6) remapped through 12:40DD; the WRAM bank kept.
// Returns the registers it leaves: a = c = the slope byte, b = the direction, de = $D000, hl the table entry
export function greenSlopeDirAt(w, h, d) {
  const p = (0xD000 + (d << 6) + h) & 0xFFFF;
  const b = (((wb(w, 2, p) >> 2) | (wb(w, 2, p) << 6)) & 0x18);
  const c = wb(w, 6, 0xD700 + wb(w, 3, p));
  const hl = 0x40DD + (c & 7) + b;
  return { a: c, b: rb(0x12, hl), c, d: 0xD0, e: 0, h: hl >> 8, l: hl & 0xFF };
}
// 12:40FD TerrainAtPos: h.l = x, d.e = y: the terrain nibble of the cell (the fractions' top two bits, mirrored by the
// tile's flips) in WRAM6 $D800 + 8 x the tile; the WRAM bank kept. Returns a = b = the nibble, c the cell column, de = $D800,
// hl its byte's address
export function terrainAtPos(w, h, l, d, e) {
  const p = (0xD000 + (d << 6) + h) & 0xFFFF;
  let c = l >> 6, ee = e >> 6;
  const attr = wb(w, 2, p);
  if (attr & 0x20) c = 3 - c;
  if (attr & 0x40) ee = 3 - ee;
  let hl = (wb(w, 3, p) * 8 + ee * 2 + 0xD800) & 0xFFFF;
  if (c & 2) hl++;
  let a = wb(w, 6, hl);
  if (!(c & 1)) a = (a >> 4) | ((a << 4) & 0xF0);
  a &= 0x0F;
  return { a, b: a, c, d: 0xD8, e: 0, h: hl >> 8, l: hl & 0xFF };
}
// 12:405E CellInfoAt: h.l = x, d.e = y (in a green view, relative to the green's corner $D441 / $D442, x 4): the green
// slope (12:4098) and the terrain (12:40FD) of the cell: a = the terrain, b = the slope's direction, c = its byte
export function cellInfoAt(w, h, l, d, e) {
  const v = rd(w, 0xD443);
  if (v && v !== 4) {
    d = (d - rd(w, 0xD442)) & 0xFF; h = (h - rd(w, 0xD441)) & 0xFF;
    const hl = ((h << 8 | l) << 2) & 0xFFFF, de = ((d << 8 | e) << 2) & 0xFFFF;
    h = hl >> 8; l = hl & 0xFF; d = de >> 8; e = de & 0xFF;
  }
  const s = greenSlopeDirAt(w, h, d);
  const t = terrainAtPos(w, h, l, d, e);
  return { ...t, b: s.b, c: s.c };
}
// 12:416B TerrainAtTileUnused (unreferenced): d = column, e = row (tiles): the terrain nibble of that 2 x 2-cell quarter of
// the tile (column bit 1, row bit 0 flipped by the tile's attributes; the row's half from the carry of the column's
// `rrca`s: a quirk); leaves WRAM6 mapped. Returns {a, b = $D0, c, d = $D8, e, h, l}
export function terrainAtTileUnused(w, d, e) {
  const s = ((e & 0xFC) >> 4 | (e & 0xFC) << 4) & 0xFF;
  const p = ((((s & 0x0F) << 8) | (s & 0xF0)) + 0xD000 + (d >> 2)) & 0xFFFF;
  const attr = wb(w, 2, p);
  let c = attr & 0x20 ? (~d) & 0xFF : d;
  const carry = (c >> 1) & 1;                    // (rrca twice: the carry is the second bit)
  let a = attr & 0x40 ? (~e) & 0xFF : e;
  const ee = ((a << 1) | carry) & 7;
  const hl = (wb(w, 3, p) * 8 + (0xD800 | ee)) & 0xFFFF;
  a = wb(w, 6, hl);
  if (!(c & 1)) a = (a >> 4) | ((a << 4) & 0xF0);
  w.high[0x196] = 6;
  return { a: a & 0x0F, b: 0xD0, c, d: 0xD8, e: ee, h: hl >> 8, l: hl & 0xFF };
}
// 12:42A2 SlopeAtBallUnused (unreferenced): the slope under the ball ($D401 x, $D404 y): in a green view the slope's
// strength (bits 4-5 of 12:4098's byte) gives hl from the words 12:42FF on the green (terrain 6) or $20 off it, a = $FF,
// b its direction (none: all 0); in the other views the cell's nibble of the $D800 map read in WRAM1 (a quirk: not WRAM6):
// bit 3 set: b = its direction (bits 0-2 and the tile's flips through 12:40DD), hl = $20, a = $FF; else a = b = c = hl
// = 0. Returns the registers {a, b, c, d, e, h, l}
export function slopeAtBallUnused(w) {
  let e = rd(w, 0xD404), d = rd(w, 0xD405), l = rd(w, 0xD401), h = rd(w, 0xD402);
  const v = rd(w, 0xD443);
  if (v && v !== 4) {
    d = (d - rd(w, 0xD442)) & 0xFF; h = (h - rd(w, 0xD441)) & 0xFF;
    const hl = ((h << 8 | l) << 2) & 0xFFFF, de = ((d << 8 | e) << 2) & 0xFFFF;
    h = hl >> 8; l = hl & 0xFF; d = de >> 8; e = de & 0xFF;
    const s = greenSlopeDirAt(w, h, d);
    const k = (s.a >> 4) & 3;
    if (!k) return { a: 0, b: 0, c: 0, d, e, h: 0, l: 0 };
    const t = terrainAtPos(w, h, l, d, e);
    const hl2 = t.a === 6 ? rb(0x12, 0x42FF + 2 * k) | rb(0x12, 0x4300 + 2 * k) << 8 : 0x0020;
    return { a: 0xFF, b: s.b, c: 0, d: t.d, e: t.e, h: hl2 >> 8, l: hl2 & 0xFF };
  }
  const p = (0xD000 + (d << 6) + h) & 0xFFFF;
  let c = l >> 6, ee = e >> 6;
  const b = wb(w, 2, p);
  if (b & 0x20) c = 3 - c;
  if (b & 0x40) ee = 3 - ee;
  let q = (wb(w, 3, p) * 8 + ee * 2 + 0xD800) & 0xFFFF;
  if (c & 2) q++;
  let a = wb(w, 1, q);
  if (!(c & 1)) a = (a >> 4) | ((a << 4) & 0xF0);
  if (!(a & 8)) return { a: 0, b: 0, c: 0, d: 0xD8, e: 0, h: 0, l: 0 };
  const dir = rb(0x12, 0x40DD + ((((b >> 2) | (b << 6)) & 0x18) + (a & 7)));
  return { a: 0xFF, b: dir, c: 0, d: 0xD8, e: 0, h: 0, l: 0x20 };
}

// ---- bank 04's unreferenced actor helpers ----
// 04:40E9 ActorsClearKeepTasks: the 24 actor records cleared (WRAM4 $D000, $600 bytes), ActorsDrawTask 04:4B69 registered
// (flags 5), $C289 = $DA00 = 0; leaves WRAM4 mapped
export function actorsClearKeepTasks(w) {
  w.high[0x196] = 4;
  w.wram[4].fill(0, 0, 0x600);
  registerFrameTask(w, 0x05, 0x04, 0x4B69);
  wr(w, 0xC289, 0); wr(w, 0xDA00, 0);
}
// 04:4588 ActorIsWalking: hl = the actor (0: a = 0): 1 while its target (+$0A-+$0D) differs from its position (+4-+7)
// (WRAM4 left mapped)
export function actorIsWalking(w, hl) {
  if (!(hl >> 8)) return 0;
  w.high[0x196] = 4;
  for (let k = 0; k < 4; k++) if (rd(w, (hl + 0x0A + k) & 0xFFFF) !== rd(w, (hl + 4 + k) & 0xFFFF)) return 1;
  return 0;
}
// 04:4EE0 ActorSetAnimSpeed / 04:4EF5 ActorSetMoveAnimSpeed: hl = the actor (0: nothing): +$35 / +$36 = a (WRAM4)
export function actorSetAnimSpeedField(w, hl, n, a) {
  if (!(hl >> 8)) return;
  w.high[0x196] = 4;
  wr(w, (hl + n) & 0xFFFF, a);
}
// 04:4F0A CountCharacterHeaders: the character header table 04:4F1C's words before its 0 word
export function countCharacterHeaders() {
  let c = 0;
  for (let p = 0x4F1C; rb(0x04, p) | rb(0x04, p + 1); p += 2) c = (c + 1) & 0xFF;
  return c;
}

// ---- small unreferenced routines of banks 12, 3F, 42 ----
// 12:4956 QueueD000To8E00: WRAM6 $D000 queued to VRAM $8E00 ($20 blocks; WRAM6 left mapped)
export function queueD000To8E00(w) { w.high[0x196] = 6; queueVRAMCopy(w, 0xD000, 0x8E00, 0x20); }
// 12:4F67 CountdownResume / 12:4F7F CountdownStop: wCountdownState $C0F4 = 1 / 0 (WRAM6 left mapped)
export function countdownSet(w, a) { w.high[0x196] = 6; wr(w, 0xC0F4, a); }
// 12:4DE8 ReturnStub, 42:4008 CharAnimStub1 (and the `ret` after it), 42:400A CharAnimStub0: `ret`
export function returnStub() {}
// 3F:41DC DictScrollStepUnused (a fragment): hl += de; below row b ($C321 high byte compared) the view's x $C320 = hl
// and a = 0, else a = 1; MapScrollTask 04:4072 either way (it leaves hl its own)
export function dictScrollStepUnused(w, hl, de, b) {
  hl = (hl + de) & 0xFFFF;
  let a = 1;
  if ((hl >> 8) < b) { wr(w, 0xC320, hl & 0xFF); wr(w, 0xC321, hl >> 8); a = 0; }
  mapScrollTask(w);
  return { a, h: hl >> 8, l: hl & 0xFF };
}
