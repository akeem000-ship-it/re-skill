// The user's ROM as the golf engine's only data source: tables, holes and assets are read from it by bank and
// address at run time (nothing from the ROM is copied into this source). useRom(bytes) once, then rb / rw.
//
// LZ assets use the format of LZDecompress 00:1F2F (the same as Mario Tennis's): a control byte gives 8 flags,
// LSB first; 1 = a literal byte, 0 = a back-reference lo, hi (0, 0 ends the stream): distance
// ((hi >> 5) << 8 | lo) - $800 from the output end, length (hi & $1F) + 3.

let ROM = null;
const lzCache = new Map();

export function useRom(bytes) {
  if (ROM !== bytes) { ROM = bytes; lzCache.clear(); }
}

export function romBytes() { return ROM; }

export function offset(bank, addr) {                // CPU address in a ROM bank -> file offset
  return addr < 0x4000 ? addr : bank * 0x4000 + addr - 0x4000;
}

export const rb = (bank, addr) => ROM[offset(bank, addr & 0xFFFF)];
export const rw = (bank, addr) => rb(bank, addr) | rb(bank, addr + 1) << 8;
export const slice = (bank, addr, n) => ROM.subarray(offset(bank, addr), offset(bank, addr) + n);

export function lzDecompress(off) {                 // 00:1F2F LZDecompress (from a file offset); a fresh copy
  let out = new Uint8Array(0x1000), n = 0;
  const put = v => { if (n === out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; } out[n++] = v; };
  for (;;) {
    const ctrl = ROM[off++];
    for (let bit = 0; bit < 8; bit++) {
      if (ctrl >> bit & 1) { put(ROM[off++]); continue; }
      const lo = ROM[off], hi = ROM[off + 1]; off += 2;
      if (!lo && !hi) return out.slice(0, n);
      let src = n + (((hi >> 5) << 8 | lo) - 0x800);
      if (src < 0) throw new Error("LZ back-reference before the start");
      for (let k = (hi & 0x1F) + 3; k > 0; k--) put(out[src++]);
    }
  }
}

// FarDispatchIndexed 00:069A on an asset list: ref = [idx, bank] names the list at the word bank:$4000+idx;
// entry n of the list is an LZ stream in the same bank (raw: the first `raw` bytes uncompressed).
export function asset(ref, n, raw = 0) {
  const [idx, bank] = ref;
  const list = rw(bank, 0x4000 + idx);
  const addr = rw(bank, list + 2 * n);
  if (raw) return slice(bank, addr, raw);
  const key = bank * 0x10000 + addr;
  if (!lzCache.has(key)) lzCache.set(key, lzDecompress(offset(bank, addr)));
  return lzCache.get(key).slice();
}

// HoleAssetTable 13:4A16: one row of 8 refs (idx, bank) per hole id (wHoleId $D320); the table ends at a
// zero bank byte.
export function holeRow(hid) {
  const o = 0x4A16 + 16 * hid;
  return Array.from({ length: 8 }, (_, k) => [rb(0x13, o + 2 * k), rb(0x13, o + 2 * k + 1)]);
}
