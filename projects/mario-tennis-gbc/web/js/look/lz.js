// The game's LZ format (00:1797 Decompress, REVERSE.md "LZ compression"): groups of a control byte whose bits
// (LSB first) say literal (1) or back-reference (0: lo, hi; distance 0x800 - ((hi >> 5) << 8 | lo), length
// (hi & 0x1F) + 3, lo = hi = 0 ends the stream). The compressor is a greedy longest match over the 2 KiB window
// with one-step lookahead; on the game's own portraits it reproduces the original stream sizes exactly.

// decompress at file offset `o` of `buf` -> { data, size } (size = bytes read, up to and including the terminator)
export function lzDecompress(buf, o) {
  const start = o, out = [];
  for (;;) {
    const ctrl = buf[o++];
    for (let bit = 0; bit < 8; bit++) {
      if (ctrl >> bit & 1) { out.push(buf[o++]); continue; }
      const lo = buf[o++], hi = buf[o++];
      if (lo === 0 && hi === 0) return { data: Uint8Array.from(out), size: o - start };
      let src = out.length + (((hi >> 5) << 8 | lo) - 0x800);
      if (src < 0) throw new Error("LZ back-reference before the start");
      for (let n = (hi & 0x1F) + 3; n > 0; n--) out.push(out[src++]);
      if (out.length > 0x10000) throw new Error("LZ output too large");
    }
  }
}

export function lzCompress(data) {
  const n = data.length, items = [];
  const best = i => {
    let bl = 0, bd = 0;
    for (let j = Math.max(0, i - 2047); j < i; j++) {
      let l = 0;
      while (l < 34 && i + l < n && data[j + l] === data[i + l]) l++;
      if (l > bl) { bl = l; bd = i - j; }
    }
    return [bl, bd];
  };
  for (let i = 0; i < n;) {
    let [l, d] = best(i);
    if (l >= 3 && i + 1 < n && best(i + 1)[0] > l + 1) l = 0;    // a longer match one byte on: emit a literal
    if (l >= 3) { const v = 0x800 - d; items.push([v & 0xFF, ((v >> 8) << 5) | (l - 3)]); i += l; }
    else { items.push(data[i]); i++; }
  }
  items.push([0, 0]);                                            // terminator
  const out = [];
  for (let g = 0; g < items.length; g += 8) {
    const grp = items.slice(g, g + 8); let ctrl = 0;
    grp.forEach((it, b) => { if (typeof it === "number") ctrl |= 1 << b; });
    out.push(ctrl);
    for (const it of grp) { if (typeof it === "number") out.push(it); else out.push(it[0], it[1]); }
  }
  const bytes = Uint8Array.from(out), check = lzDecompress(bytes, 0).data;
  if (check.length !== n || check.some((v, i) => v !== data[i])) throw new Error("LZ round trip failed");
  return bytes;
}
