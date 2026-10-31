// Code no play reaches: unreferenced copies, dead branches and debug-only routines, ported so that the rewrite holds
// the whole traced code; each is checked against the ROM with random RAM and registers (web/tests/golf_fuzz_routines.mjs:
// the same RAM and registers in, the same registers, WRAM and HRAM out), not by a screen. REVERSE.md "Unreached code"
// lists them with how each is (not) reached.
import * as M from "./math.js";
import { rb } from "./rom.js";
import { rd, wr } from "./render/display.js";
import { dist24 } from "./cup.js";
import { loadText } from "./text.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { queueVRAMCopy } from "./render/display.js";
import { mapScrollTask } from "./render/holeview.js";
import { dist as distHL } from "./ball.js";
import { mulHLByDEFull, negDE } from "./home.js";
import { saveCommit } from "./save.js";

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

// ---- bank 0B's unreferenced map cell writers ----
// 0B:45E3 MapSetTerrainAt / 0B:4637 MapSetEventAt: the WRAM6 cell of tile (d, e) in the terrain grid $D000 (0B:45AB
// MapTerrainCellAddr) / the event grid $D400 (0B:45FF MapEventCellAddr) = a: 32 x 32 cells of 2 x 2 tiles, the
// column from an arithmetic shift (d of $80 and up: the cell past the row); the WRAM bank kept
export function mapSetCellAt(w, base, d, e, a) {
  const c = ((d & 0xFE) >> 1) | (d & 0x80);
  const hl = (base + (e & 0xFE) * 16 + c) & 0xFFFF;
  w.wram[6][hl - 0xD000] = a;
}

// 10:77CC ReflectScaleUnused (unreferenced): the length (10:7372) of ($D4A9 - vx, $D4AB - vy); then $D4A9 = -$D4A1 x
// vx / length and $D4AB = -$D4A3 x vy / length: the product's low 24 bits (00:0CB5's HRAM; $FFFFFF when its top byte
// is set) divided (00:0DDB), $3FFF when the quotient passes 16 bits
export function reflectScaleUnused(w) {
  const r16 = a => rd(w, a) | rd(w, a + 1) << 8;
  const len = distHL((r16(0xD4A9) - r16(0xD409)) & 0xFFFF, (r16(0xD4AB) - r16(0xD40B)) & 0xFFFF);
  for (const [out, k, v] of [[0xD4A9, 0xD4A1, 0xD409], [0xD4AB, 0xD4A3, 0xD40B]]) {
    mulHLByDEFull(w, r16(v), negDE(r16(k)));
    const h = w.high;
    let a, hl;
    if (h[0x1AB]) { a = 0xFF; hl = 0xFFFF; } else { a = h[0x1AA]; hl = h[0x1A8] | h[0x1A9] << 8; }
    h[0x1AC] = a;
    let [qa, q] = M.divAHLByDE(a, hl, len);
    if (len) { h[0x1AE] = qa; h[0x1AD] = q >> 8; }
    if (qa) q = 0x3FFF;
    wr(w, out, q & 0xFF); wr(w, out + 1, q >> 8);
  }
}

// 02:4550 ClearSaveFlag (unreferenced; the opposite of 02:4522): SRAM bank 0; the bit mask 02:44EA[e rotated left
// 3 times] cleared in $A038 + d; SaveCommit 02:41C1
export function clearSaveFlag(w, d, e) {
  w.high[0x197] = 0;
  const a = rb(0x02, (0x44EA + (((e << 3) | (e >> 5)) & 0xFF)) & 0xFFFF);
  w.sram[0x38 + d] &= ~a & 0xFF;
  saveCommit(w);
}
// 30:7E46 GetPlayerActorPos (unreferenced): the player's actor ($C290; hFFE0) in WRAM4: [x word +4, y word +6]
export function getPlayerActorPos(w) {
  const p = rd(w, 0xC290) | rd(w, 0xC291) << 8;
  w.high[0x1E0] = p & 0xFF; w.high[0x1E1] = p >> 8;
  w.high[0x196] = 4;
  const r16 = a => rd(w, a & 0xFFFF) | rd(w, (a + 1) & 0xFFFF) << 8;
  return [r16(((p & 0xFF00) | ((p + 4) & 0xFF))), r16(((p & 0xFF00) | ((p + 6) & 0xFF)))];
}
// 06:69E7 RosterWord10 (unreferenced): the byte +$10 of roster record c ($D216's list + 32 c), as hl (h 0); de = $10
export function rosterWord10(w, c) {
  const base = rd(w, 0xD216) | rd(w, 0xD217) << 8;
  return rd(w, (base + ((c << 5) & 0xFFFF) + 0x10) & 0xFFFF);
}
// 08:43B8 GetLongestDriveRecord (unreferenced): the word at $C96E, $1900 when 0
export function getLongestDriveRecord(w) {
  const hl = rd(w, 0xC96E) | rd(w, 0xC96F) << 8;
  return hl || 0x1900;
}

// ---- bank 05's unreferenced shadow helpers (the BG shadow: WRAM5 $D000 tiles / $D400 attributes) ----
const setWB = (w, n) => { w.high[0x196] = n; };
// 05:40E6 ClearBGShadow: WRAM5 $D000-$D7FF zeroed; the WRAM bank restored
export function clearBGShadow(w) {
  const old = w.high[0x196];
  setWB(w, 5);
  for (let a = 0xD000; a < 0xD800; a++) wr(w, a, 0);
  setWB(w, old);
}
// 05:4102 DebugHDMAShadowToVRAM: with A held, VRAM bank 0, WRAM5 (left mapped), a general HDMA of $25 blocks
// $D000 -> $9800 (the display copy: w.vram only)
export function debugHDMAShadowToVRAM(w, hdma) {
  if (!(w.high[0x190] & 1)) return;
  if (w.vram) w.lcd.vbk = 0;
  setWB(w, 5);
  if (w.vram && hdma) hdma(w, 0xD000, 0x1800, 0x24);
}
// 05:413E ReadShadowTile: WRAM5 mapped (left so); the tile at (d, e) is read and dropped (a restored from the stack:
// the routine returns its argument)
export function readShadowTile(w, a) { setWB(w, 5); return a; }
// 05:416F CopyVisibleShadowRows: b = WRAM bank (left mapped): 19 shadow rows from row [$C323] & 31 queued ($26
// blocks; past row 31 in two parts, the second from row 0): tiles $D000 -> $9800, then attributes $D400 -> VRAM1
export function copyVisibleShadowRows(w, b) {
  setWB(w, b);
  const r = w.wram[0][0x323] & 0x1F, bc = r << 5;
  for (const [src, dst] of [[0xD000, 0x9800], [0xD400, 0xB800]]) {
    const over = (r + 0x12 - 0x20) & 0xFF;
    if (r + 0x12 > 0x20) {
      queueVRAMCopy(w, src + bc, dst + bc, (0x26 - ((over << 1) & 0xFF)) & 0xFF);
      queueVRAMCopy(w, src, dst, (over << 1) & 0xFF);
    } else queueVRAMCopy(w, src + bc, dst + bc, 0x26);
  }
}
// 05:41EF CopyShadowTilesToVRAM / 05:4208 CopyShadowAttrsToVRAM: b = WRAM bank (left mapped): $40 blocks queued,
// $D000 -> $9800 / $D400 -> VRAM1 $9800
export function copyShadowTilesToVRAM(w, b) { setWB(w, b); queueVRAMCopy(w, 0xD000, 0x9800, 0x40); }
export function copyShadowAttrsToVRAM(w, b) { setWB(w, b); queueVRAMCopy(w, 0xD400, 0xB800, 0x40); }
// 05:4221 CopyShadowRowToVRAM: a = row (& 31), b = WRAM bank (left mapped): its tiles and attributes queued (2 blocks
// each)
export function copyShadowRowToVRAM(w, a, b) {
  setWB(w, b);
  const bc = (a & 0x1F) << 5;
  queueVRAMCopy(w, 0xD000 + bc, 0x9800 + bc, 2);
  queueVRAMCopy(w, 0xD400 + bc, 0xB800 + bc, 2);
}
// 05:44B7 CopyMapEdgeRows: 7 map rows into the shadow (05:450B) from row [$C323] (+1 when wMapScrollY $C322 bit 7 is
// set; + $0B when a's bit 0 is), each & $3F
export function copyMapEdgeRows(w, a, copyMapRowToShadow) {
  let r = (w.wram[0][0x323] + (w.wram[0][0x322] >> 7)) & 0xFF;
  if (a & 1) r = (r + 0x0B) & 0xFF;
  r &= 0x3F;
  for (let n = 7; n; n--) { copyMapRowToShadow(w, r); r = (r + 1) & 0x3F; }
}
// 05:4717 BuildPlainWindowRecord: the record at hl: flags a, x d, y e, width b, height c, then the tiles with the
// attribute [$D84D] (wWindowAttr): the frame 02 03.. 04 / 05 20.. 06 rows / 07 08.. 09 (an inner size of 0 runs 256
// times, as the loops count down)
export function buildPlainWindowRecord(w, hl, a, d, e, b, c) {
  const put = v => { wr(w, hl, v); hl = (hl + 1) & 0xFFFF; };
  put(a); put(d); put(e); put(b); put(c);
  const iw = (b - 2) & 0xFF, ih = (c - 2) & 0xFF, at = rd(w, 0xD84D);
  const row = (l, m, r) => { put(l); put(at); for (let n = iw || 256; n; n--) { put(m); put(at); } put(r); put(at); };
  row(0x02, 0x03, 0x04);
  for (let n = ih || 256; n; n--) row(0x05, 0x20, 0x06);
  row(0x07, 0x08, 0x09);
}
// 05:486F EraseWindowFromShadow: the record at hl (x, y, width, height after its flags): tile 0 over its area of the
// shadow (05:414F, the bank mapped as it is; 0 sizes run 256 times)
export function eraseWindowFromShadow(w, hl) {
  const d0 = rd(w, hl + 1), e0 = rd(w, hl + 2), b = rd(w, hl + 3), c = rd(w, hl + 4);
  let e = e0;
  for (let r = c || 256; r; r--, e = (e + 1) & 0xFF) {
    let d = d0;
    for (let k = b || 256; k; k--, d = (d + 1) & 0xFF) wr(w, 0xD000 + ((e & 0x1F) << 5) + (d & 0x1F), 0);
  }
}
FUZZ.push(() => ({ name: "ClearBGShadow", bank: 0x05, addr: 0x40E6, js: w => clearBGShadow(w) }));
FUZZ.push(rnd => ({ name: "DebugHDMAShadowToVRAM", bank: 0x05, addr: 0x4102, js: w => debugHDMAShadowToVRAM(w) }));
FUZZ.push(rnd => ({ name: "ReadShadowTile", bank: 0x05, addr: 0x413E, regs: () => ({ a: rnd(256), d: rnd(256), e: rnd(256) }), out: ["a", "d", "e"],
  js: (w, r) => ({ a: readShadowTile(w, r.a), d: r.d, e: r.e }) }));
const sb = rnd => [1, 2, 3, 4, 5, 6, 7][rnd(7)];
FUZZ.push(rnd => ({ name: "CopyVisibleShadowRows", bank: 0x05, addr: 0x416F, init: w => { if (rnd(2)) for (let k = 0; k < rnd(6); k++) w.wram[0][0x0A0 + 8 * rnd(10)] = 1; },
  regs: () => ({ a: rnd(256), b: sb(rnd), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"],
  js: (w, r) => { copyVisibleShadowRows(w, r.b); return r; } }));
FUZZ.push(rnd => ({ name: "CopyShadowTilesToVRAM", bank: 0x05, addr: 0x41EF, regs: () => ({ a: rnd(256), b: sb(rnd), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { copyShadowTilesToVRAM(w, r.b); return r; } }));
FUZZ.push(rnd => ({ name: "CopyShadowAttrsToVRAM", bank: 0x05, addr: 0x4208, regs: () => ({ a: rnd(256), b: sb(rnd), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { copyShadowAttrsToVRAM(w, r.b); return r; } }));
FUZZ.push(rnd => ({ name: "CopyShadowRowToVRAM", bank: 0x05, addr: 0x4221, init: w => { if (rnd(2)) for (let k = 0; k < rnd(10); k++) w.wram[0][0x0A0 + 8 * rnd(10)] = 1; },
  regs: () => ({ a: rnd(256), b: sb(rnd) }), js: (w, r) => copyShadowRowToVRAM(w, r.a, r.b) }));
FUZZ.push(rnd => ({ name: "BuildPlainWindowRecord", bank: 0x05, addr: 0x4717,
  regs: () => { const hl = 0xD900 + rnd(0x300), b = 2 + rnd(19); return { a: rnd(256), d: rnd(256), e: rnd(256), b, c: b === 2 ? 3 : 3 + rnd(16), h: hl >> 8, l: hl & 0xFF }; },   // (b 2: 256 per row, 3 rows; c 2, 256 rows, would run over the stack)
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { buildPlainWindowRecord(w, r.h << 8 | r.l, r.a, r.d, r.e, r.b, r.c); return r; } }));
FUZZ.push(rnd => ({ name: "EraseWindowFromShadow", bank: 0x05, addr: 0x486F, steps: 3000000,
  regs: w => { const hl = 0xC400 + rnd(0x300); const m = w.wram[0], wide = !rnd(8); m[hl - 0xC000 + 3] = wide ? 0 : 1 + rnd(31); m[hl - 0xC000 + 4] = wide ? 1 + rnd(8) : rnd(8) ? 1 + rnd(31) : 0;
    /* (0: 256; not both large: the run is long) */ return { a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: hl >> 8, l: hl & 0xFF }; },
  out: ["a", "b", "c", "d", "e"], js: (w, r) => { eraseWindowFromShadow(w, r.h << 8 | r.l); return r; } }));

// ---- bank 05's unreferenced window helpers ----
const slotP = b => (0xD800 + ((b << 2) & 0xFF)) & 0xFFFF;
// 05:5A75 GetWindowText: slot b (up to 5): hl = its text id (the priority bits off); else hl as it was
export function getWindowText(w, b, hl) {
  if (b > 5) return hl;
  const p = slotP(b) + 2;
  return (rd(w, p) & 0x1F) << 8 | rd(w, p + 1);
}
// 05:5B0F SetWindowPriorityAlt: slot b (up to 5), priority a (05:4C75 SetWindowPriority with the arguments swapped)
export function setWindowPriorityAlt(w, b, a) {
  if (b > 5) return;
  const p = slotP(b) + 2;
  wr(w, p, (rd(w, p) & 0x1F) | ((a << 5) & 0xFF));
}
FUZZ.push(rnd => ({ name: "GetWindowText", bank: 0x05, addr: 0x5A75, regs: () => ({ b: rnd(3) ? rnd(6) : rnd(256), h: rnd(256), l: rnd(256), a: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { const hl = getWindowText(w, r.b, r.h << 8 | r.l); return { ...r, h: hl >> 8, l: hl & 0xFF }; } }));
FUZZ.push(rnd => ({ name: "SetWindowPriorityAlt", bank: 0x05, addr: 0x5B0F, regs: () => ({ b: rnd(3) ? rnd(6) : rnd(256), a: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { setWindowPriorityAlt(w, r.b, r.a); return r; } }));

// ---- bank 3C's debug wind sweep: its two helpers (unreferenced but by the sweep) ----
// 3C:6B3F AngleFromUp: de = bc + $4000 (bc - $C000: the angle from straight up)
export const angleFromUp = bc => (bc + 0x4000) & 0xFFFF;
// 3C:6BFE DebugShotAngle: the angle (00:1A03 AngleFromVector16, x = the ball's y - the tee's $D43B, y = its x - $D439)
// of the ball's word positions $D401 / $D404 from the tee spot (with both parts nonzero AngleFromVector16 divides by
// 00:0DDB DivAHLByDE, which leaves its HRAM $FFAC-$FFAE as 40:599C's copy does)
export function debugShotAngle(w) {
  const r16 = a => rd(w, a) | rd(w, a + 1) << 8;
  const dx = (r16(0xD401) - r16(0xD439)) & 0xFFFF, dy = (r16(0xD404) - r16(0xD43B)) & 0xFFFF;
  if (dy && dx) { const ax = dy & 0x8000 ? (-dy) & 0xFFFF : dy, ay = dx & 0x8000 ? (-dx) & 0xFFFF : dx; divAHLByDE40(w, ax >> 8, (ax & 0xFF) << 8, ay); }
  return M.angleFromVector16(dy, dx);
}
FUZZ.push(rnd => ({ name: "AngleFromUp", bank: 0x3C, addr: 0x6B3F, regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { const de = angleFromUp(r.b << 8 | r.c); return { ...r, d: de >> 8, e: de & 0xFF }; } }));
FUZZ.push(rnd => ({ name: "DebugShotAngle", bank: 0x3C, addr: 0x6BFE, out: ["b", "c"], js: w => { const bc = debugShotAngle(w); return { b: bc >> 8, c: bc & 0xFF }; } }));

// ---- home bank: the vectors and helpers no screen runs ----
// 00:0000 RST00_JumpTable / 00:0690 JumpTableDispatch (rst $00; dw ...: no code of this ROM uses it): the word at the
// return address + 2a (a doubled in 8 bits) is jumped to (00:0699 JumpToHL); returns that target. de = 2a, hl = it
export function jumpTableDispatch(w, ret, a) {
  const p = (ret + ((a << 1) & 0xFF)) & 0xFFFF;
  return rd(w, p) | rd(w, (p + 1) & 0xFFFF) << 8;
}
// 00:0048 IntLCDStat -> 00:2F81 LCDStatHandler, 00:0060 IntJoypad: reti (the LCD STAT and joypad interrupts are never
// enabled: IE $0D); nothing to do here
export function lcdStatInterrupt() {}
export function joypadInterrupt() {}
// 00:02C7 SwitchCPUSpeedSingle (as in Mario Tennis 00:02C7; nothing calls it): in double speed (KEY1 bit 7) the
// switch is armed (KEY1 1), IE 0 meanwhile, P1 $30, STOP; when KEY1 bit 7 is clear, P1 0, IF 0, IE back; returns a =
// IE (its push af), or KEY1 when already in single speed. The native engine has no CPU speed: w.doubleSpeed stands
// for KEY1 bit 7; P1 / IF / IE as w.high[$100] / [$10F] / [$1FF]
export function switchCPUSpeedSingle(w) {
  if (!w.doubleSpeed) return 0x7E | (w.key1 & 1);
  w.doubleSpeed = false; w.key1 = 0;
  w.high[0x100] = 0; w.high[0x10F] = 0;
  return w.high[0x1FF];
}
FUZZ.push(rnd => ({ name: "JumpTableDispatch", bank: 0, addr: 0xC800,
  init: w => {                                   // rst $00 at $C800 with an 8-entry table after it, each target a ret
    const m = w.wram[0]; m[0x800] = 0xC7;
    for (let k = 0; k < 8; k++) { const t = 0xC900 + 3 * k; m[0x801 + 2 * k] = t & 0xFF; m[0x802 + 2 * k] = t >> 8; m[t - 0xC000] = 0xC9; }
  },
  regs: () => ({ a: rnd(8), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }), out: ["a", "b", "c", "d", "e", "h", "l"],
  js: (w, r) => { const t = jumpTableDispatch(w, 0xC801, r.a); return { ...r, a: t & 0xFF, h: t >> 8, l: t & 0xFF, d: 0, e: (r.a << 1) & 0xFF }; } }));
FUZZ.push(rnd => ({ name: "IntLCDStat", bank: 0, addr: 0x0048, regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { lcdStatInterrupt(); return r; } }));
FUZZ.push(rnd => ({ name: "IntJoypad", bank: 0, addr: 0x0060, regs: () => ({ a: rnd(256), b: rnd(256), c: rnd(256), d: rnd(256), e: rnd(256), h: rnd(256), l: rnd(256) }),
  out: ["a", "b", "c", "d", "e", "h", "l"], js: (w, r) => { joypadInterrupt(); return r; } }));
// (the card's accent fragments 0E:44AE / 0E:44C8: scorecard.js, fuzz-checked from a stub that pushes af and hl and
// jumps in, as ScorecardPutString's loop has them pushed)

// 40:5EFC DemoTaskDiagonalDown (an unreferenced demo task): WRAM6 (left mapped); wDemoScrollX $D247 and wDemoScrollY
// $D248 + 1 each, to hSCX / hSCY
export function demoTaskDiagonalDown(w) {
  setWB(w, 6);
  const r = w.wram[6];
  r[0x247] = (r[0x247] + 1) & 0xFF; w.high[0x18B] = r[0x247];
  r[0x248] = (r[0x248] + 1) & 0xFF; w.high[0x18A] = r[0x248];
}
// 11:410C BallDisplayStop (nothing calls it): the frame task 11:4113 BallDisplayTask off
export function ballDisplayStop(w) { unregisterFrameTask(w, 0x11, 0x4113); }
// 4F:618B WaitCaptionAnimEnd (nothing calls it): frames until the caption object's script ($CAA0) is done (0), then its
// task 4F:62A7 off
export function* waitCaptionAnimEnd(sh) {
  const w = sh.w;
  do yield* sh.advance(); while (w.wram[0][0xAA0] | w.wram[0][0xAA1]);
  unregisterFrameTask(w, 0x4F, 0x62A7);
}
FUZZ.push(rnd => ({ name: "DemoTaskDiagonalDown", bank: 0x40, addr: 0x5EFC, js: w => demoTaskDiagonalDown(w) }));
FUZZ.push(rnd => ({ name: "BallDisplayStop", bank: 0x11, addr: 0x410C,
  init: w => { if (rnd(2)) { const p = 0x1C0 + 4 * rnd(16); w.wram[0].set([1 + rnd(255), 0x13, 0x41, 0x11], p); } }, js: w => ballDisplayStop(w) }));
FUZZ.push(rnd => ({ name: "WaitCaptionAnimEnd", bank: 0x4F, addr: 0x618B, script: () => [0],
  init: w => { w.wram[0][0xAA0] = 0; w.wram[0][0xAA1] = 0; if (rnd(2)) { const p = 0x1C0 + 4 * rnd(16); w.wram[0].set([1 + rnd(255), 0xA7, 0x62, 0x4F], p); } },
  js: w => { const g = waitCaptionAnimEnd(w.sh); while (!g.next().done); } }));
