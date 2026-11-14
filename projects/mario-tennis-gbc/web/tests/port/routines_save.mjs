// Routine tests for web/js/port/save, the battery save (bank 3; run by web/tests/port_routines.mjs, filter "Save").
// Every routine of the save engine but the debug editor (which never returns: see the end of this file) is called
// at its ROM address on the ROM and on the port, from recorded states with the save in SRAM made into one case or
// another by prep(): the save as recorded (out/engine/rec1.mtrec, out/engine/rec2.mtrec: a story file in slot 0,
// minigame records, the exhibition image), blank or $FF-filled SRAM, a good save copied in, then damaged: a data
// byte of a block changed (bad checksum), an entry cleared (no block), the master checksum or the signature
// broken, the bank-1 mirror good or not; the N64 records block present (with data or empty) and the save flags and
// records each unlockable depends on set above or below their limits; every story slot (0-2 and none); SRAM
// enabled or not, any bank mapped at the call. The harness compares SRAM, all of WRAM and the result registers.
// The default recordings work (rec1: a story file; exh1: a blank save at first); more states with
// --rec out/engine/rec1.mtrec,out/engine/exh1.mtrec,out/engine/rec2.mtrec,out/port/story1.mtrec,out/port/save1.mtrec
// (save1: power-on with rec1's save, file 1 loaded, saved, then erased, the N64 block cleared, everything erased).
import { readRecording, newCore } from "../engine/corpus.mjs";
import { loadState } from "../../js/gb/state.js";
import { hookKey } from "../../js/port/port.js";

const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

// ---- a good save image: the SRAM of a recorded mid-game state (out/engine/rec1.mtrec, else rec2) ----
let GOOD = null;
for (const p of ["out/engine/rec1.mtrec", "out/engine/rec2.mtrec"]) {
  try { const gb = await newCore({ recomp: false }); loadState(gb, readRecording(p).start); GOOD = gb.mem.sram.slice(); break; } catch (e) { /* next */ }
}

// ---- deterministic randomness per (state, entry) ----
function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
const pick = (r, list) => list[r(list.length)];

// ---- SRAM as the cartridge holds it (mem.sram: bank * $2000 + offset) ----
const SR = (bank, addr) => bank * 0x2000 + (addr - 0xA000);
const rd = (mem, bank, addr) => mem.sram[SR(bank, addr)];
const wr = (mem, bank, addr, v) => { mem.sram[SR(bank, addr)] = v & 0xFF; };
const ENTRY = id => 0xA060 + 16 * id;
// a block's place as the directory in SRAM has it
const place = (mem, id) => {
  const e = ENTRY(id);
  return { bank: rd(mem, 0, e + 1) & 3, addr: 0xA000 + (rd(mem, 0, e + 2) | rd(mem, 0, e + 3) << 8), len: rd(mem, 0, e + 4) | rd(mem, 0, e + 5) << 8 };
};
const blockSum = (mem, id) => { const p = place(mem, id); let s = 0; for (let i = 0; i < p.len; i++) s = (s + rd(mem, p.bank, p.addr + i)) & 0xFFFF; return s; };
const setEntrySum = (mem, id, sum) => { wr(mem, 0, ENTRY(id) + 6, sum); wr(mem, 0, ENTRY(id) + 7, sum >> 8); };
// write data into block id (inside the bank) and make its entry valid with the right checksum
function putBlock(mem, id, bytes) {
  const p = place(mem, id);
  bytes.forEach((v, i) => { if (i < p.len && p.addr + i < 0xC000) wr(mem, p.bank, p.addr + i, v); });
  wr(mem, 0, ENTRY(id), 1);
  setEntrySum(mem, id, blockSum(mem, id));
}
const fixMaster = mem => { let s = 0; for (let a = 0xA038; a < 0xA770; a++) s = (s + rd(mem, 0, a)) & 0xFFFF; wr(mem, 0, 0xA030, s); wr(mem, 0, 0xA031, s >> 8); };
const mirror = mem => { for (let a = 0xA000; a < 0xA800; a++) wr(mem, 1, a, rd(mem, 0, a)); };
const corruptBlock = (mem, id, r) => { const p = place(mem, id); if (p.len) { const a = p.addr + r(Math.min(p.len, 0x2000)); if (a < 0xC000) wr(mem, p.bank, a, rd(mem, p.bank, a) + 1 + r(255)); } };
const invalidate = (mem, id) => wr(mem, 0, ENTRY(id), 0);

// The save made into a case: base ("as" recorded, "good" image, "blank", "ff"), then damage
function saveCase(mem, r, { base = pick(r, ["as", "as", "good", "good", "blank", "ff"]), damage = true } = {}) {
  if (base === "good" && GOOD) mem.sram.set(GOOD);
  else if (base === "blank") mem.sram.fill(0);
  else if (base === "ff") mem.sram.fill(0xFF);
  if (!damage || base === "blank" || base === "ff") return base;
  for (let k = r(3); k > 0; k--) {
    const id = pick(r, [0, 2, 4, 0x1B, 0x1D, 0x1F, 0x06, 0x21, 0x0B, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E]);
    if (r(2)) corruptBlock(mem, id, r); else if (r(3) === 0) invalidate(mem, id);
  }
  return base;
}
// a valid block of random data
const randomBlock = (mem, id, r) => { const p = place(mem, id); putBlock(mem, id, Array.from({ length: p.len }, () => r(256))); };
// a block (and its backup) as a case: as it is, new random data, a bad checksum (data byte or stored sum), absent
function blockCase(mem, id, r) {
  if (!place(mem, id).len || rd(mem, 0, ENTRY(id) + 1) > 3) return;
  const k = r(6);
  if (k === 1 || k === 2) randomBlock(mem, id, r);
  if (k === 2) corruptBlock(mem, id, r);
  if (k === 3) { wr(mem, 0, ENTRY(id), 1); setEntrySum(mem, id, blockSum(mem, id) + 1 + r(0xFFFE)); }
  if (k === 4) invalidate(mem, id);
}
// the N64 records block: present with data (bytes 0-1 not summing to 0), present but empty, corrupt, or absent
function n64Case(mem, r) {
  const k = r(5);
  if (k === 4) { invalidate(mem, 0x0B); return; }
  const p = place(mem, 0x0B);
  if (!p.len) return;
  const bytes = Array.from({ length: p.len }, () => (r(4) ? 0 : r(256)));
  if (k <= 1) { bytes[0] = 1 + r(255); bytes[1] = r(2) ? 0 : (256 - bytes[0]) & 0xFF; }   // with data (sometimes summing to 0)
  else { bytes[0] = 0; bytes[1] = 0; }
  for (let i = 2; i < 8; i++) bytes[i] = r(2);
  putBlock(mem, 0x0B, bytes);
  if (k === 3) corruptBlock(mem, 0x0B, r);
}
// the save flags (random, or the unlock conditions' rows set) and the master checksum fixed or not
function flagsCase(mem, r) {
  for (let i = 0; i < 8; i++) if (r(2)) wr(mem, 0, 0xA040 + i, r(256));
  if (r(4)) fixMaster(mem);
}
// minigame records around their defaults (wMinigameRecordValue in, block values)
function recordsCase(mem, r) {
  for (const id of [0x38, 0x39, 0x3A, 0x3B]) {
    const p = place(mem, id);
    if (!p.len || r(3) === 0) continue;
    const bytes = Array.from({ length: p.len }, (_, i) => rd(mem, p.bank, p.addr + i));
    for (let k = r(4); k > 0; k--) { const i = 2 * r(11); const v = pick(r, [0, 1, 0x12C, 0x270F, 0xFFFF, r(0x10000)]); bytes[i] = v & 0xFF; bytes[i + 1] = v >> 8; }
    putBlock(mem, id, bytes);
    if (r(5) === 0) corruptBlock(mem, id, r);
  }
}
// what the caller leaves at the call: SRAM on or off, any bank, story slot, interrupts off (as romCall)
function callerCase(mem, r, { slot = true } = {}) {
  mem.ramEnable = r(2) === 0; mem.ramBank = r(4); mem.hram[0x17] = r(4);
  if (slot) mem.wram[0][0x36C] = pick(r, [0, 0, 1, 2, 3, r(256)]);
  mem.ie = 0;
}
const W0 = (mem, addr, bytes) => bytes.forEach((v, i) => { mem.wram[0][addr - 0xC000 + i] = v & 0xFF; });
const WX = (mem, bank, addr, bytes) => bytes.forEach((v, i) => { mem.wram[bank][addr - 0xD000 + i] = v & 0xFF; });
// copy a block's SRAM data into WRAM at addr (bank: the WRAM bank for $D000+), so that a verify matches
function blockToWram(mem, id, addr, bank = 1) {
  const p = place(mem, id), bytes = [];
  for (let i = 0; i < p.len && p.addr + i < 0xC000; i++) bytes.push(rd(mem, p.bank, p.addr + i));
  if (addr < 0xD000) W0(mem, addr, bytes.slice(0, 0xD000 - addr)); else WX(mem, bank, addr, bytes.slice(0, 0xE000 - addr));
}

// ---- entries ----
const every = (n, off = 0) => { let i = 0; return () => (i++ % n) === off; };
// T(name, addr, { regs(r, s) -> {a,b,c,d,e,h,l,f,...}, prep(mem, r, s), out, every, wram })
const ENTRIES = [];
// block: the block the routine works on (b of its regs, or a fixed id) made valid, corrupt or absent after prep
function T(name, addr, { regs = () => ({}), prep = null, out = ALL, n = 6, wram, ignore, block = null } = {}) {
  const k = ++salt * 7919;
  const regsOf = s => {
    const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...regs(r, s) };
    return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
  };
  ENTRIES.push({
    name: `Save ${name}`, bank: 3, addr, out, wram, ignore, when: every(n, salt % n),
    regs: regsOf,
    // (hWramBank as the bank mapped: romCall sets it on the ROM's side, the harness not on the port's)
    prep(mem, s) {
      const r = rng(s, k + 1);
      mem.hram[0x16] = mem.svbk;
      callerCase(mem, r);
      if (prep) prep(mem, r, s);
      if (block !== null) blockCase(mem, typeof block === "number" ? block : regsOf(s).b, r);
    },
    js(P, regs) {
      if (!P.hooks.has(hookKey(3, addr))) throw new Error(`no port hooked at 03:${addr.toString(16)}`);
      P.ime = false;
      return P.callRom(3, addr, regs);
    },
  });
}
const BLOCKS = [0, 1, 2, 3, 4, 5, 6, 7, 0x0A, 0x0B, 0x0C, 0x1B, 0x1C, 0x1D, 0x21, 0x26, 0x36, 0x37, 0x38, 0x3B, 0x3D, 0x3E, 0x3F, 0x40, 0x4A, 0x62, 0x68, 0x70];
// A block's WRAM buffer must not reach the stack page $CF00-$CFFF (directly or through the echo of $C000-$DDFF at
// $E000): the ROM's stack differs from the port's there, and a read over it would overwrite the ROM's return
// address. Blocks longer than $6C0 ($3F: $DA0, $62: $1500, $68-$70: $1E00) use $D000 ($D000-$EDFF).
const BIG = new Set([0x3F, 0x62, 0x68, 0x70]);
const buffer = (r, id, list) => (BIG.has(id) ? 0xD000 : pick(r, list));
const anyBlock = r => ({ bc: pick(r, BLOCKS) << 8 | r(256) });
// Bases: routines that read the directory as it is (ReadSaveBlock, the clears) get no $FF-filled SRAM (its entries
// say valid, $FFFF bytes: they would sweep the whole address space, the stack too); the clears no blank SRAM either
// (length 0 is 64 KB). Those that rewrite the directory first (InitSaveHeader) get every base.
const anySaveWith = bases => (mem, r) => { saveCase(mem, r, { base: pick(r, bases) }); if (r(2)) n64Case(mem, r); if (r(2)) flagsCase(mem, r); if (r(2)) recordsCase(mem, r); };
const anySave = anySaveWith(["as", "as", "good", "good", "blank"]);
const anySaveFF = anySaveWith(["as", "good", "good", "blank", "ff"]);
const madeSave = anySaveWith(["as", "good"]);

// the header
T("InitSaveHeader", 0x404A, { prep: (mem, r) => saveCase(mem, r) });
T("WipeAllSaveRam", 0x47F9, { prep: (mem, r) => { saveCase(mem, r); mem.ramEnable = r(4) !== 0; } });
T("Unused_03_ClearSaveFlagsArea", 0x4825, { prep: anySaveFF });
T("SumSaveHeaderRegion", 0x4844, { prep: anySaveFF });
T("UpdateSaveHeaderChecksum", 0x4866, { prep: anySaveFF });
T("MirrorSaveHeaderToBank1", 0x48A1, { prep: anySaveFF });
T("VerifySaveHeaderChecksum", 0x4945, { prep: anySaveFF });
// the power-on check: good, damaged checksum / signature, mirror good or not, blank
T("ValidateSaveRam", 0x495D, {
  n: 3,
  prep(mem, r) {
    anySaveFF(mem, r);
    const k = r(6);
    if (k === 0) wr(mem, 0, 0xA030, rd(mem, 0, 0xA030) + 1);
    else if (k === 1) wr(mem, 0, 0xA020 + r(16), r(256));
    else if (k === 2) { mirror(mem); wr(mem, 0, 0xA030 + r(2), r(256)); }
    else if (k === 3) { fixMaster(mem); mirror(mem); }
    else if (k === 4) {                        // the signature at $A000 too (where the re-check looks): restorable
      for (let i = 0; i < 16; i++) wr(mem, 0, 0xA000 + i, mem.rom[3 * 0x4000 + (0x47E9 - 0x4000) + i]);
      fixMaster(mem); mirror(mem); wr(mem, 0, 0xA020 + r(16), r(256));
      if (r(3) === 0) wr(mem, 1, 0xA038 + r(0x700), r(256));   // (the mirror's checksum broken as well)
    }
  },
});
T("EraseAndInitSaveRam", 0x4A3C, { n: 12, prep: anySaveFF });
T("CompareSaveSignature ROM", 0x4A56, { regs: r => ({ hl: pick(r, [0xA020, 0xA000, 0xA021, 0xC600]), de: 0x47E9 }), prep(mem, r) { anySave(mem, r); if (r(2)) mem.ramEnable = true; } });
T("CompareSaveSignature any", 0x4A56, { regs: r => ({ hl: 0xC600 + r(16), de: 0xC610 + r(16) }), prep(mem, r) { W0(mem, 0xC600, Array.from({ length: 48 }, () => (r(3) ? 0x41 + r(2) : 0))); } });
T("CopySaveSignature", 0x4A69, { regs: r => ({ hl: 0x47E9 + r(3), de: pick(r, [0xA020, 0xC600, 0xA7F8]) }), prep(mem, r) { anySave(mem, r); if (r(2)) mem.ramEnable = true; } });
T("GetSaveBlockDirEntry", 0x4A79, { regs: r => ({ a: pick(r, [0, 1, 0x36, 0x70, 0xF9, 0xFA, 0xFF, r(256)]) }) });
// block writes: hl = a WRAM source; de = the tag
const writeRegs = r => { const id = pick(r, BLOCKS); return { bc: id << 8 | r(256), hl: buffer(r, id, [0xC800, 0xD000, 0xD500, 0xC000 + r(0x800)]), de: pick(r, [0, 0xC600, r(0x10000)]) }; };
T("WriteSaveBlock", 0x4A89, { n: 4, regs: writeRegs, wram: 7, prep: anySave });
T("WriteSaveBlock ff", 0x4A89, { n: 12, regs: writeRegs, prep(mem, r) { saveCase(mem, r, { base: "ff" }); } });

// blocks
T("Unused_03_InvalidateStorySlot", 0x4AFF, { regs: r => ({ bc: pick(r, [0, 1, 2, 3, 4, 0xFF]) << 8 | r(256) }), prep: anySave });
T("InvalidateSaveBlock", 0x4B1C, { regs: anyBlock, prep: anySaveFF });
T("Unused_03_ResetAllSaveBlocks", 0x4B54, { n: 10, prep: anySave });
const readRegs = r => { const id = pick(r, BLOCKS); return { bc: id << 8 | r(256), hl: buffer(r, id, [0xC800, 0xD000, 0xD480, 0xD500]) }; };
T("ReadSaveBlock", 0x4B9B, { n: 3, block: "b", regs: readRegs, wram: 7, prep: anySave });
T("ReadSaveBlock slots", 0x4B9B, { block: "b", regs: r => ({ bc: pick(r, [0, 2, 4, 0x1B, 0x1D, 0x1F]) << 8 | r(256), hl: 0xC800 }), prep: anySave });
// verify: the source the block's own data (match), or a byte changed (mismatch), or the block corrupt
T("VerifySaveBlock", 0x4C14, {
  n: 3, wram: 1,
  regs: r => ({ bc: pick(r, [0, 2, 4, 6, 0x0B, 0x1B, 0x21, 0x36, 0x38, 0x3E, 0x26, 0x0C]) << 8 | r(256), hl: pick(r, [0xC800, 0xD000]) }),
  prep(mem, r, s) {
    anySave(mem, r);
    // (the regs are drawn from the same state: recompute which block and buffer)
  },
});
T("ReadSaveBlockTag", 0x4C9E, { block: "b", regs: r => ({ bc: pick(r, BLOCKS) << 8 | r(256), hl: pick(r, [0xC600, 0xD400]) }), wram: 1, prep: anySave });
T("Unused_03_ReadSaveBlockTagWord", 0x4CD3, { regs: r => ({ bc: pick(r, BLOCKS) << 8 | r(256), hl: 0xC600 }), prep: anySave });
// story saves (with the N64 records block and the unlock conditions) and the story check
T("SaveStorySlot", 0x4D08, { n: 4, prep: anySaveFF });
T("SaveStorySlotWithTimer", 0x4D10, { n: 4, prep(mem, r) { anySave(mem, r); n64Case(mem, r); flagsCase(mem, r); recordsCase(mem, r); } });
T("CheckStorySlot", 0x4D64, { n: 3, block: 0, prep: anySave });
// save flags: well-formed ids and odd ones (e's low bits set: the mask from past the table)
const flagRegs = r => ({ de: r(2) ? (r(8) << 8 | r(8) << 5) : r(0x10000) });
T("TestSaveFlag", 0x4D86, { regs: flagRegs, prep: anySaveFF });
T("SetSaveFlag", 0x4DB6, { regs: flagRegs, prep: anySaveFF });
T("ClearSaveFlag", 0x4DE4, { regs: flagRegs, prep: anySaveFF });

// erasing
T("EraseStorySlotSaveData", 0x4E13, { n: 4, regs: r => ({ a: pick(r, [0, 0, 1, 0xFF]) }), prep: anySaveFF });
// (the clears read the directory without enabling SRAM: disabled, it reads $FF, a $FFFF-byte block)
T("ClearSaveBlock", 0x4E90, { regs: r => ({ ...anyBlock(r), hl: (r(2) ? 0 : 1 + r(255)) << 8 | r(256) }), prep(mem, r) { madeSave(mem, r); mem.ramEnable = true; } });
T("ClearSaveBlockData", 0x4E9D, { regs: anyBlock, prep(mem, r) { madeSave(mem, r); mem.ramEnable = true; } });
T("Unused_03_EraseSaveBlock", 0x4EF7, { regs: anyBlock, prep(mem, r) { madeSave(mem, r); mem.ramEnable = true; } });
T("ClearSaveBlockEntry", 0x4F57, { regs: anyBlock, prep(mem, r) { madeSave(mem, r); mem.ramEnable = r(4) !== 0; } });
T("ReinitSaveRamPreservingBlock6", 0x4F7D, {
  n: 8,
  prep(mem, r) { anySave(mem, r); if (place(mem, 6).len) { const k = r(3); if (k === 0) randomBlock(mem, 6, r); else if (k === 1) { randomBlock(mem, 6, r); corruptBlock(mem, 6, r); } else invalidate(mem, 6); } },
});
T("WriteExhibitionSaveBlock", 0x4FAE, { n: 4, prep: anySaveFF });
T("ReadExhibitionSaveBlock", 0x4FEA, { block: 0x36, prep: anySave });
T("ClearSaveBlock11", 0x4FFE, { prep: madeSave });

// minigame records (wMinigameRecordValue in WRAM 7 $DE00)
const recordPrep = (mem, r) => { anySave(mem, r); recordsCase(mem, r); WX(mem, 7, 0xDE00, [r(256), r(256)]); };
T("ReadMinigameRecord", 0x5015, { n: 3, regs: r => ({ a: pick(r, [0, 1, 2, 5, 10, 11, 0x80, r(256)]) }), prep: recordPrep });
T("UpdateMinigameRecord", 0x5072, { n: 3, regs: r => ({ a: pick(r, [0, 1, 2, 5, 10, 0x80, r(256)]) }), prep: recordPrep });
// (the slot is not checked: $38 + slot is read into $D480; slots 0-6 reach the small record and grid blocks)
T("InitCurrentSlotMinigameRecords", 0x5141, { prep(mem, r) { recordPrep(mem, r); mem.wram[0][0x36C] = r(7); } });
T("InitAllMinigameRecordBlocks", 0x519A, { prep: recordPrep });

// the star grid, through WRAM 3 $D900 as bank $3B does
T("ReadMarioCastVictoryGrid", 0x5229, { wram: 3, regs: () => ({ hl: 0xD900 }), prep(mem, r) { anySave(mem, r); if (r(2) && place(mem, 0x3E).len) { randomBlock(mem, 0x3E, r); if (r(2)) corruptBlock(mem, 0x3E, r); } } });
T("WriteMarioCastVictoryGrid", 0x5240, { wram: 3, regs: () => ({ hl: 0xD900 }), prep: anySave });

// the debug editor's helpers
T("Unused_03_MoveSaveEditorCursor", 0x524F, {
  regs: r => ({ bc: pick(r, [0xF0F8, 0xFFFF, 0x0101, 0x1008, r(0x10000)]) }), wram: 7,
  prep(mem, r) { mem.hram[0x10] = r(2) ? 1 : r(256) & 0xFE; mem.hram[0x30] = r(256); mem.hram[0x31] = r(4); },
});
T("Unused_03_GetCurrentSlotBlockId", 0x529D);
T("Unused_03_ReadCurrentSlotBlock", 0x52B3, { block: 0, prep: anySave });
T("Unused_03_WriteCurrentSlotBlock", 0x52C3, { prep: anySave });
T("Unused_03_InvalidateCurrentSlotBlock", 0x52D3, { prep: anySave });

// power-on repair: primary corrupt, backup good or bad
const repairPrep = (mem, r) => {
  anySave(mem, r);
  for (const id of [0, 2, 4, 0x36]) {
    if (!place(mem, id).len || r(2)) continue;
    if (r(2)) { randomBlock(mem, id, r); const bk = id === 0x36 ? 0x37 : id + 0x1B; if (place(mem, bk).len) randomBlock(mem, bk, r); }
    corruptBlock(mem, id, r);
    if (r(2)) corruptBlock(mem, id === 0x36 ? 0x37 : id + 0x1B, r);
  }
};
T("RestoreStoryBlockFromBackup", 0x550D, { regs: r => ({ bc: pick(r, [0, 2, 4]) << 8 | r(256) }), wram: 1, prep: repairPrep });
T("RepairAllSaveSlots", 0x5669, { n: 3, prep: repairPrep });
T("RestoreBlock36FromBackup", 0x5682, { wram: 1, prep: repairPrep });
// the unreachable helpers on $D000
const sparePrep = (mem, r) => {
  anySave(mem, r);
  for (const id of [6, 7, 8, 9, 0x0A]) {
    if (!place(mem, id).len || r(2)) continue;
    randomBlock(mem, id, r); if (place(mem, id + 0x1B).len && r(2)) randomBlock(mem, id + 0x1B, r);
    if (r(2)) corruptBlock(mem, id, r);
    if (r(2)) corruptBlock(mem, id + 0x1B, r);
  }
};
T("Unused_03_InvalidateBlockIfUnwritten", 0x553B, { regs: r => ({ bc: pick(r, [6, 7, 8, 9, 0x0A, 0]) << 8 | r(256) }), wram: 1, prep: sparePrep });
// Unused_03_RestoreBlockOrClear: the path with a bad backup returns to the address bc (a stray push): c is chosen so
// that bc points at a `ret` in bank 0 ($C9), which returns to the caller
T("Unused_03_RestoreBlockOrClear", 0x5548, {
  wram: 1, prep: sparePrep, n: 3,
  regs: (r, s) => { const b = pick(r, [6, 7, 8, 9, 0x0A]); return { bc: b << 8 | RET_IN_PAGE[b] }; },
});
for (const [id, addr] of [[6, 0x557B], [7, 0x55A5], [8, 0x55CF], [9, 0x55F9], [0x0A, 0x5623]])
  T(`Unused_03_RestoreBlock${id.toString(16).padStart(2, "0")}FromBackup`, addr, { wram: 1, prep: sparePrep });
T("Unused_03_ClearBlockIfSet", 0x564D, { regs: r => ({ bc: pick(r, [6, 7, 8, 9, 0x0A, 0, 0x0B]) << 8 | r(256) }), wram: 1, prep: sparePrep });

// N64 records and unlockables
const n64Prep = (mem, r) => { anySave(mem, r); n64Case(mem, r); flagsCase(mem, r); recordsCase(mem, r); };
T("ApplyN64RecordsUnlockFlags", 0x56A8, { n: 3, prep: n64Prep });
T("UpdateUnlockablesSaveBlock", 0x56FB, { n: 2, prep: n64Prep });
T("SetAllUnlockablesInSaveBlock", 0x5787, { n: 3, prep: n64Prep });
T("CheckUnlockCondition", 0x57E2, { n: 2, regs: r => ({ a: pick(r, [0, 1, 2, 3, 4, 6, 8, 9, 10, r(11)]) }), prep: n64Prep });
// blocks 6-10: write with backup, read
for (const [id, w, rdAt] of [[6, 0x5844, 0x586F], [7, 0x587B, 0x58A6], [8, 0x58B2, 0x58DD], [9, 0x58E9, 0x5914], [0x0A, 0x5920, 0x594B]]) {
  T(`WriteBlock${id}WithBackup`, w, { regs: r => ({ hl: pick(r, [0xC800, 0xD000]) }), wram: 1, prep: sparePrep });
  T(`ReadBlock${id}`, rdAt, { regs: r => ({ hl: pick(r, [0xC800, 0xD000]) }), wram: 1, prep: sparePrep });
}

// a `ret` ($C9) in each page $06xx-$0Axx of bank 0, for Unused_03_RestoreBlockOrClear's stray return
const RET_IN_PAGE = {};
{
  const gb = await newCore({ recomp: false });
  for (const b of [6, 7, 8, 9, 0x0A]) { let c = 0; while (c < 256 && gb.mem.rom[b << 8 | c] !== 0xC9) c++; RET_IN_PAGE[b] = c & 0xFF; }
}

// VerifySaveBlock's matching case: the buffer holds the block's data (the regs' block and hl, drawn again here)
{
  const V = ENTRIES.find(e => e.name === "Save VerifySaveBlock"), basePrep = V.prep, baseRegs = V.regs;
  V.prep = (mem, s) => {
    basePrep(mem, s);
    const g = baseRegs(s), id = g.b, hl = g.h << 8 | g.l, r = rng(s, 99);
    if (r(5) === 0 && place(mem, id).len && rd(mem, 0, ENTRY(id))) setEntrySum(mem, id, blockSum(mem, id) + 1);
    if (r(3)) blockToWram(mem, id, hl, 1);
    if (r(4) === 0) { const p = place(mem, id); if (p.len) { const i = r(Math.min(p.len, hl < 0xD000 ? 0x800 : 0x1000)); if (hl < 0xD000) mem.wram[0][hl - 0xC000 + i] ^= 1 + r(255); else mem.wram[1][hl - 0xD000 + i] ^= 1 + r(255); } }
  };
}

export const ROUTINES = ENTRIES;

// The debug editor (Unused_03_SaveSlotDebugEditor, 03:5310) never returns and nothing reaches it. It is checked by
// the lockstep from a recording whose start state has the CPU put at its entry (bank 3 mapped), with a key script
// that moves the cursor, edits, changes slots, saves and deletes (out/port/save_editor.mtrec):
//   HOOKS=save/index node web/tests/port_lockstep.mjs out/port/save_editor.mtrec
// The editor turns the debug overlay on, whose peak-LY readout (VRAM $9D08-$9D0B, CPU time) differs by timing; the
// lockstep ignores its RAM source (wDebugPeakLYText) but not this copy, so those cells show as differences.
