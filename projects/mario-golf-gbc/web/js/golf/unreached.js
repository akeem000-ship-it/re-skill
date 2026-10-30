// Code no play reaches: unreferenced copies, dead branches and debug-only routines, ported so that the rewrite holds
// the whole traced code; each is checked against the ROM with random RAM and registers (web/tests/golf_fuzz_routines.mjs:
// the same RAM and registers in, the same registers, WRAM and HRAM out), not by a screen. REVERSE.md "Unreached code"
// lists them with how each is (not) reached.
import * as M from "./math.js";
import { rb } from "./rom.js";
import { rd, wr } from "./render/display.js";
import { dist24 } from "./cup.js";
import { loadText } from "./text.js";

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
// 02:544E AddPointsSigned (export $56; the debug points editor 41:77EA): wPoints $C83C += de, 0 when negative
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
// 0A:531F MapCount / 0A:5336 MapIdAt (the debug warp menu 05:6C25): MapTable 0A:5188's records (6 bytes, $FF ends)
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
