// The save RAM (bank 02; REVERSE.md "Save"): the signature and checksum of the directory area $A020-$A1BF with its
// backup at $B620, the block directory ($A040 + 32 b: +0 used, +1 a bank byte never used, +2 the offset from $A000,
// +4 the size, +6 the sum, +8 a 24-byte header), the blocks (0-2 the three characters, 8-10 their backups, 3 the
// records, 4-7 the saved holes), the save flags at $A038, SaveGame, and the club table a save rebuilds.
// GolfMemory.sram is the cartridge's 8 KB: every block's "bank" (the low byte of its size, a quirk: SaveBlockLoad /
// SaveBlockStore write it to the MBC's RAM bank register) is $00 or $80, bank 0 of an 8 KB RAM either way.
// hSRAMBank $FF97 is kept as the code leaves it.
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import { clubDistance, elevation, driverShape } from "./launch.js";

const rd = D.rd, wr = D.wr;
const S = a => a - 0xA000;                       // an SRAM address in GolfMemory.sram
const SIG = 0x4162;                              // SaveSignature 02:4162 "CAMELOT GAMEBOY"
const bankReg = (w, v) => { w.high[0x197] = v; };   // hSRAMBank (and the MBC's RAM bank)

function strCopy(w, hl, de) {                    // 02:427A StrCopy (ROM -> SRAM, with its $00)
  for (;; hl++, de++) { const a = rb(0x02, hl); w.sram[S(de)] = a; if (!a) return; }
}
function strCompare(w, hl, de) {                 // 02:4267 StrCompare: 0 when equal
  for (;; hl++, de++) {
    const a = rb(0x02, de);
    if (a !== w.sram[S(hl)]) return 1;
    if (!a) return 0;
  }
}
// 02:4078 SaveWriteDefaults: the signature at $A020 and the block directory's offsets and sizes ($A041 + 32 n)
const DIR = [[0x00, 0x00, 0x02, 0x00, 0x02], [0x00, 0x00, 0x04, 0x00, 0x02], [0x00, 0x00, 0x06, 0x00, 0x02],
  [0x00, 0x00, 0x08, 0x00, 0x04], [0x00, 0x00, 0x0C, 0x80, 0x02], [0x00, 0x80, 0x0E, 0x80, 0x02],
  [0x00, 0x00, 0x11, 0x80, 0x02], [0x00, 0x80, 0x13, 0x80, 0x02], [0x00, 0x00, 0x18, 0x00, 0x02],
  [0x00, 0x00, 0x1A, 0x00, 0x02], [0x00, 0x00, 0x1C, 0x00, 0x02], [0x00, 0x00, 0x1E, 0x00, 0x02]];
export function saveWriteDefaults(w) {
  bankReg(w, 0);
  strCopy(w, SIG, 0xA020);
  DIR.forEach((e, n) => e.forEach((v, k) => { w.sram[0x41 + 32 * n + k] = v; }));
  w.sram[S(0xA032)] = 0x0C;
}
export function saveErase(w) { bankReg(w, 0); w.sram.fill(0, 0, 0x2000); }   // 02:4172 SaveErase (bank 0)
export function saveChecksum(w) {                // 02:419D SaveChecksum: $A032-$A1BF
  bankReg(w, 0);
  let s = 0;
  for (let k = 0; k < 0x18E; k++) s = (s + w.sram[0x32 + k]) & 0xFFFF;
  return s;
}
export function saveCommit(w) {                  // 02:41C1 SaveCommit: the sum at $A030, $A020-$A1BF -> $B620
  const s = saveChecksum(w);
  w.sram[0x30] = s & 0xFF; w.sram[0x31] = s >> 8;
  w.sram.copyWithin(S(0xB620), S(0xA020), S(0xA020) + 0x1A0);
}
const saveVerify = w => saveChecksum(w) !== (w.sram[0x30] | w.sram[0x31] << 8);   // 02:41E1 SaveVerify
// 02:424D SaveReset: SaveErase, SaveWriteDefaults, SaveCommit (RAM bank 0)
export function saveReset(w) { bankReg(w, 0); saveErase(w); saveWriteDefaults(w); saveCommit(w); }
// 02:41F6 SaveLoad: the signature and sum, else the backup's, else erased and reset
export function saveLoad(w) {
  bankReg(w, 0);
  if (!strCompare(w, 0xA020, SIG) && !saveVerify(w)) return 0;
  w.sram.copyWithin(S(0xA020), S(0xB620), S(0xB620) + 0x1A0);
  if (!strCompare(w, 0xA020, SIG) && !saveVerify(w)) return 1;
  saveErase(w); saveWriteDefaults(w); saveCommit(w);
  return 0xFF;
}
const entry = b => 0x40 + ((b << 5) & 0xFF);    // 02:428A SaveBlockEntry: $A040 + 32 b (8-bit)
const r16s = (w, o) => w.sram[o] | w.sram[o + 1] << 8;
const sumOf = (w, hl, n) => {                    // the 16-bit sum of n bytes at hl (n = 0: $10000)
  let s = 0;
  for (let k = 0; k < (n || 0x10000); k++) s = (s + rd(w, (hl + k) & 0xFFFF)) & 0xFFFF;
  return s;
};
// 02:4355 SaveBlockLoad: block b to hl; 0 ok, $FE unused, $FF a bad sum
export function saveBlockLoad(w, b, hl) {
  bankReg(w, 0);
  const e = entry(b);
  if (!w.sram[e]) return 0xFE;
  const off = r16s(w, e + 2), n = r16s(w, e + 4);
  bankReg(w, n & 0xFF);
  for (let k = 0; k < (n || 0x10000); k++) wr(w, (hl + k) & 0xFFFF, w.sram[(off + k) & 0x1FFF]);
  const s = sumOf(w, hl, n);
  bankReg(w, 0);
  return s === r16s(w, e + 6) ? 0 : 0xFF;
}
// 02:429B SaveBlockStore: hl's data into block b (SaveWriteDefaults first), its sum, the header de (0: zeros), commit
export function saveBlockStore(w, b, hl, de) {
  bankReg(w, 0);
  saveWriteDefaults(w);
  const e = entry(b);
  const off = r16s(w, e + 2), n = r16s(w, e + 4);
  bankReg(w, n & 0xFF);
  for (let k = 0; k < (n || 0x10000); k++) w.sram[(off + k) & 0x1FFF] = rd(w, (hl + k) & 0xFFFF);
  const s = sumOf(w, hl, n);
  bankReg(w, 0);
  w.sram[e] = 1;
  w.sram[e + 6] = s & 0xFF; w.sram[e + 7] = s >> 8;
  for (let k = 0; k < 0x18; k++) w.sram[e + 8 + k] = de ? rd(w, (de + k) & 0xFFFF) : 0;
  saveCommit(w);
  return 0;
}
// 02:431D SaveBlockClear: block b unused, its sum and header cleared; commit
export function saveBlockClear(w, b) {
  bankReg(w, 0);
  saveWriteDefaults(w);
  const e = entry(b);
  w.sram[e] = 0; w.sram[e + 6] = 0; w.sram[e + 7] = 0;
  w.sram.fill(0, e + 8, e + 0x20);
  saveCommit(w);
}
// 02:43CC SaveBlockVerify: block b against hl: 0 equal, $FE unused, $FD a byte differs, $FF a bad sum
export function saveBlockVerify(w, b, hl) {
  bankReg(w, 0);
  const e = entry(b);
  if (!w.sram[e]) return 0xFE;
  const off = r16s(w, e + 2), n = r16s(w, e + 4);
  bankReg(w, n & 0xFF);
  for (let k = 0; k < (n || 0x10000); k++) {
    if (w.sram[(off + k) & 0x1FFF] !== rd(w, (hl + k) & 0xFFFF)) { bankReg(w, 0); return 0xFD; }
  }
  const s = sumOf(w, hl, n);
  bankReg(w, 0);
  return s === r16s(w, e + 6) ? 0 : 0xFF;
}
// 02:4454 SaveBlockHeader: block b's 24-byte header to hl; $FE when unused
export function saveBlockHeader(w, b, hl) {
  bankReg(w, 0);
  const e = entry(b);
  if (!w.sram[e]) return 0xFE;
  for (let k = 0; k < 0x18; k++) wr(w, (hl + k) & 0xFFFF, w.sram[e + 8 + k]);
  return 0;
}
// 02:45D3 SaveCheckAllBlocks (WRAM bank 1): slots 0-2 (02:457F CheckSlotBlock), block 3 (02:45AA CheckBlockOrClear),
// blocks 4-7 (02:45B7 CheckBlockOrReset: a block not loading is stored fresh, $280 zeros)
export function saveCheckAllBlocks(w) {
  D.setWramBank(w, 1);
  for (let b = 0; b < 3; b++) {
    if (saveBlockLoad(w, b, 0xD000) !== 0xFF) continue;
    // a bad sum: the quirk "ld a, 8 / add a, b / ld b, 8" loads block 8 (slot 0's backup) for every slot
    if (!saveBlockLoad(w, 8, 0xD000)) {
      saveBlockHeader(w, 8, 0xD400);
      saveBlockStore(w, b, 0xD000, 0xD400);
    } else saveBlockClear(w, b);
  }
  if (saveBlockLoad(w, 3, 0xD000) === 0xFF) saveBlockClear(w, 3);
  for (let b = 4; b < 8; b++) {
    if (!saveBlockLoad(w, b, 0xD000)) continue;
    D.clearMemory16(w, 0xD000, 0x28);
    saveBlockStore(w, b, 0xD000, 0);
  }
}

// the save flags: SRAM $A038[d], the bit by the mask table 02:44EA at e rotated left 3 times
const flagMask = e => rb(0x02, 0x44EA + (((e << 3) | (e >> 5)) & 0xFF));
export function testSaveFlag(w, d, e) {          // 02:44F2 TestSaveFlag
  bankReg(w, 0);
  return w.sram[0x38 + d] & flagMask(e);
}
export function setSaveFlag(w, d, e) {           // 02:4522 SetSaveFlag
  bankReg(w, 0);
  w.sram[0x38 + d] |= flagMask(e);
  saveCommit(w);
}

// 00:2CC3 SaveGameTimer / 00:2CDE RestoreGameTimer: wPlayClock $C0F0 (4 bytes) <-> $C82E
export function saveGameTimer(w) { w.wram[0].copyWithin(0x82E, 0x0F0, 0x0F4); }
export function restoreGameTimer(w) { w.wram[0].copyWithin(0x0F0, 0x82E, 0x832); }

// 02:51F6 BuildClubTable: 13 clubs x 7 bytes at wClubTable $C900: the distance (ClubDistance 02:511A of the driver
// distance $C81A with wCharFlags), the elevation (ClubElevation 02:518B by $C81C), $C81E, and the shape row byte
// (DriverShape 02:534B of $C81D with the flags; the row table 02:5253 by (shape + 8) & $F, the club's byte)
export function buildClubTable(w) {
  const r = w.wram[0];
  let de = 0x900;
  for (let b = 0; b < 13; b++) {
    const dist = clubDistance(b, r[0x81A] | r[0x81B] << 8, r[0x819]);
    r[de++] = dist & 0xFF; r[de++] = dist >> 8;
    const el = elevation(b, r[0x81C]);
    r[de++] = el & 0xFF; r[de++] = el >> 8;
    r[de++] = r[0x81E];
    const a = driverShape(r[0x81D], b, r[0x819]);
    const row = rw(0x02, (0x5253 + (((a + 8) & 0x0F) << 1)) & 0xFFFF);
    r[de++] = rb(0x02, (row + b) & 0xFFFF);
  }
}

// 02:4489 SaveGame: for a save slot (wSaveSlot $C2A5 < 3): the play clock, 14 bytes 02:6392 -> $C94E, the club table,
// the header 02:63A0 -> wTextBuffer $C600, the character record $C800 into block slot and its backup slot + 8, each
// verified (the result is not used)
export function saveGame(w) {
  const r = w.wram[0];
  if (r[0x2A5] >= 3) return;
  saveGameTimer(w);
  for (let k = 0; k < 0x0E; k++) r[0x94E + k] = rb(0x02, 0x6392 + k);
  buildClubTable(w);
  for (let k = 0; k < 0x18; k++) r[0x600 + k] = rb(0x02, 0x63A0 + k);
  const s = r[0x2A5] & 3;
  saveBlockStore(w, s, 0xC800, 0xC600);
  saveBlockVerify(w, s, 0xC800);
  saveBlockStore(w, s + 8, 0xC800, 0xC600);
  saveBlockVerify(w, s + 8, 0xC800);
}
