// Bank 0 LZ decompressor and its loaders, and GetTangent (which shares the ROM file).
// Port of decompress_00.asm (00:1565-00:1888) and the loaders DecompressDataFromBank / CopyDataFromBank
// (00:0234 / 00:021A, vectors_00.asm); names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm). web/js/rom.js has the same LZ format for reading assets off the ROM;
// this one runs on the machine (any source and destination, through the memory map).
// Covered by the routine tests (web/tests/port/routines_home_gfx.mjs) and the lockstep on out/engine/*.mtrec.
import { FZ, FH, FC, switchRomBank, setRegs, copyMemoryBC } from "./memory.js";

const SLOT_TABLE = 0x4000;                                  // every bank's export/asset table of words
const MATCH_WINDOW = 0x800;                                 // back-references reach 2 KB back
const MIN_MATCH = 3;

// DecompressData (00:1797): decompress the LZ stream at hl to de. Each control byte gives 8 flags, low bit
// first: 1 = a literal byte follows; 0 = a back-reference (lo, hi): copy (hi & $1F) + 3 bytes, forwards one by
// one (so it may overlap what it writes), from de - $800 + ((hi >> 5) << 8 | lo). A reference of 0, 0 ends the
// stream. Returns the number of bytes written (the ROM's hl; it keeps af, bc and de).
export function decompressData(P, src, dest) {
  const { bus } = P;
  let hl = src, de = dest;
  const next = () => { const v = bus.u8(hl); hl = (hl + 1) & 0xFFFF; return v; };
  for (;;) {
    const flags = next();
    for (let bit = 0; bit < 8; bit++) {
      if (flags >> bit & 1) { bus.w8(de, next()); de = (de + 1) & 0xFFFF; continue; }
      const lo = next(), hi = next();
      if (!lo && !hi) return (de - dest) & 0xFFFF;
      let from = (de - MATCH_WINDOW + ((hi >> 5) << 8 | lo)) & 0xFFFF;
      for (let n = (hi & 0x1F) + MIN_MATCH; n > 0; n--) {
        bus.w8(de, bus.u8(from));
        from = (from + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
      }
    }
  }
}

// DecompressDataFromBank (00:0234): decompress entry l (a byte offset) of bank h's $4000 table to de, with
// that bank mapped. Returns the length.
export function decompressDataFromBank(P, bank, slot, dest) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const n = decompressData(P, P.bus.u16(SLOT_TABLE | slot), dest);
  switchRomBank(P, old);
  return n;
}
// CopyDataFromBank (00:021A): copy bc bytes of entry l of bank h's table to de (uncompressed). Returns { hl, de }.
export function copyDataFromBank(P, bank, slot, dest, count) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const r = copyMemoryBC(P, P.bus.u16(SLOT_TABLE | slot), dest, count);
  switchRomBank(P, old);
  return { hl: r.hl, de: r.de };
}

// ---- GetTangent ----
const TangentTable = 0x1565;                                // 257 words: tan of 0..90 degrees in 256 steps
const TAN_MAX = 0x7FFF, TAN_MIN = 0x8001;
const tangentByte = (P, i) => P.rom.u8(0, TangentTable + i);
// GetTangent (00:1767): the tangent of the angle hl ($4000 = 90 degrees; bit 14 picks the quadrant, the top
// bit is dropped), as a signed 16-bit value that saturates at $7FFF / $8001. Returns the registers it leaves:
// hl, and a, bc and the flags of its last steps.
export function getTangent(P, hl, a, bc) {
  const x = (hl << 2) & 0xFFFF;
  if (!(hl & 0x4000)) {                                     // first quadrant: the table read backwards from 90 degrees
    const i = ((~x >> 8) & 0xFF) + 1, h = tangentByte(P, 2 * i + 1), l = tangentByte(P, 2 * i);
    const a2 = (h << 1) & 0xFF, f = (a2 === 0 ? FZ : 0) | (h & 0x08 ? FH : 0) | (h & 0x80 ? FC : 0);
    return { hl: h & 0x80 ? TAN_MAX : h << 8 | l, a: a2, bc: TangentTable + 3, f };
  }
  const i = x >> 8;                                         // second quadrant: minus the table
  if (!i) return { hl: 0, a, bc, f: FZ | 0x40 | FC };      // inc l / dec l: zero (the add hl, hl carry kept)
  const lo = tangentByte(P, 2 * i), hi = tangentByte(P, 2 * i + 1);
  const v = (-(hi << 8 | lo)) & 0xFFFF, h = v >> 8, a2 = (h << 1) & 0xFF;
  const f = (a2 === 0 ? FZ : 0) | (h & 0x08 ? FH : 0) | (h & 0x80 ? FC : 0);
  return { hl: h & 0x80 ? v : TAN_MIN, a: a2, bc: (TangentTable >> 8) << 8 | ((-lo) & 0xFF), f };
}

export const HOOKS = [
  [0, 0x021A, (P, c) => setRegs(c, { ...copyDataFromBank(P, c.h, c.l, c.de, c.bc), bc: 0 })],
  [0, 0x0234, (P, c) => { c.hl = decompressDataFromBank(P, c.h, c.l, c.de); }],
  [0, 0x1767, (P, c) => setRegs(c, getTangent(P, c.hl, c.a, c.bc))],
  [0, 0x1797, (P, c) => { c.hl = decompressData(P, c.hl, c.de); }],
];
