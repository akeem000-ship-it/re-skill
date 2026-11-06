// ROM access + decoders. Everything is read from the user's own ROM at runtime;
// no game data is embedded in this repository. See REVERSE.md for every address used here.

export const EXPECTED_SHA1 = "414ba58340a27fc27b127bc01455b32764151ff0";

export class Rom {
  constructor(bytes) { this.b = bytes; }
  static async load(buffer) { return new Rom(new Uint8Array(buffer)); }

  off(bank, addr) { return addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000); }
  u8(bank, addr) { return this.b[this.off(bank, addr)]; }
  u16(bank, addr) { const o = this.off(bank, addr); return this.b[o] | this.b[o + 1] << 8; }
  s16(bank, addr) { const v = this.u16(bank, addr); return v >= 0x8000 ? v - 0x10000 : v; }
  slice(bank, addr, n) { const o = this.off(bank, addr); return this.b.subarray(o, o + n); }

  // bank export/asset table at $4000 (rst $18 / DecompressBankTable convention)
  tableEntry(bank, idx) { return this.u16(bank, 0x4000 + idx); }

  // 00:1797 Decompress -- LZ77: LSB-first flags, 1 = literal, 0 = (lo, hi) back-ref
  lz(bank, addr) {
    let o = this.off(bank, addr);
    const b = this.b, out = [];
    for (;;) {
      const ctrl = b[o++];
      for (let bit = 0; bit < 8; bit++) {
        if (ctrl >> bit & 1) { out.push(b[o++]); continue; }
        const lo = b[o++], hi = b[o++];
        if (lo === 0 && hi === 0) return Uint8Array.from(out);
        let src = out.length + (((hi >> 5) << 8 | lo) - 0x800);
        for (let n = (hi & 0x1f) + 3; n > 0; n--) out.push(out[src++]);
      }
    }
  }
  lzRef(idx, bank) { return this.lz(bank, this.tableEntry(bank, idx)); }
  rawRef(idx, bank, n) { return this.slice(bank, this.tableEntry(bank, idx), n); }
}

export async function sha1Hex(bytes) {
  if (!crypto.subtle) return null;  // insecure context
  const h = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// --- graphics helpers -----------------------------------------------------
export function bgr555(w) {
  const r = w & 31, g = w >> 5 & 31, b = w >> 10 & 31;
  return [r * 255 / 31 | 0, g * 255 / 31 | 0, b * 255 / 31 | 0];
}
export function palettes(bytes, n = 8) {
  const out = [];
  for (let p = 0; p < n; p++) {
    const pal = [];
    for (let c = 0; c < 4; c++) pal.push(bgr555(bytes[p * 8 + c * 2] | bytes[p * 8 + c * 2 + 1] << 8));
    out.push(pal);
  }
  return out;
}
export function tilePixel(data, off, x, y) {
  const lo = data[off + y * 2], hi = data[off + y * 2 + 1];
  return (lo >> (7 - x) & 1) | (hi >> (7 - x) & 1) << 1;
}
