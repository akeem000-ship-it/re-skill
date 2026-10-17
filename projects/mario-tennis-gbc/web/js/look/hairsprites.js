// Sprite versions of the volume and strand hairstyles (afro, puffs, cornrows, locs, braids) for the hero's walk,
// match and HUD frames. They start from the hero's short hair (label.js), then grow, stripe or hang hair around the
// head the frame already has; the same in-place, same-size rewrite as the other hairstyles (colour index and region
// per pixel; nothing is stored from the ROM). label.js passes its helpers in (api) to avoid an import cycle.
export const NEW_STYLES = ["afro", "puffs", "cornrows", "locs", "braids", "fade"];

export function hairStyleSprite(st, style, api) {
  const { REG, set, reoutline, facing, styleAlex, styleNina } = api, { NONE, OUT, SKIN, HAIR, HAT, TOP, HAIR2, HAIR3, KEEP, RACKET } = REG;
  const { w, h, reg, info } = st;
  if (!info) return;
  // the base: the hero's short hair, no hat, no tails
  if (st.hero === "alex") styleAlex(st, "short"); else styleNina(st, "bob");
  const walk = st.kind === "walk", f = facing(st), at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : reg[y * w + x];
  // the head: its columns and rows above the body split
  let x0 = w, x1 = -1, top = h, fy0 = h, fy1 = -1;
  for (let y = info.y0; y < Math.min(info.yh, h); y++) for (let x = 0; x < w; x++) {
    const r = reg[y * w + x]; if (r !== HAIR && r !== SKIN && r !== HAT) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, y);
    if (r === SKIN) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
  }
  if (x1 < 0) return;
  if (fy1 < 0) { fy0 = top + 3; fy1 = Math.min(info.yh - 1, top + 8); }
  const free = r => r === NONE || r === OUT;                    // pixels hair may take (never skin, clothes, racket)
  const into = (x, y, r, also = null) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const c = reg[y * w + x]; if (free(c) || (also && also.includes(c))) set(st, y * w + x, r); };
  const R = style === "afro" && walk ? 2 : walk ? 1 : 2, mid = fy0 + (walk ? 2 : 3);
  const hairAt = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] === HAIR) hairAt.push([x, y]);

  if (style === "afro") {
    const lim = f === null ? Math.min(info.yh - 1, fy1 + 1) : mid;
    const r2 = R * R + 1, hit = new Set();
    for (const [hx, hy] of hairAt) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r2) continue; const x = hx + dx, y = hy + dy;
      if (y > lim || y < 1 || x < 1 || x >= w - 1) continue; hit.add(y * w + x);
    }
    for (const i of hit) into(i % w, (i / w) | 0, HAIR);
    // curl texture: a lighter pixel every few, a darker one under it
    for (let y = top - R; y <= lim; y++) for (let x = x0 - R; x <= x1 + R; x++) {
      if (at(x, y) !== HAIR || walk) continue;
      const k = (x + 2 * y) % 5; if (k === 0) set(st, y * w + x, HAIR3); else if (k === 3 && at(x, y + 1) === HAIR) set(st, y * w + x, HAIR2);
    }
  }
  if (style === "fade") {                                        // a flat top and faded (darker) sides
    for (let y = top; y < Math.min(info.yh, h); y++) for (let x = x0; x <= x1; x++) {
      if (reg[y * w + x] !== HAIR) continue;
      if (y === top && (x === x0 || x === x1 || x === x0 + 1 || x === x1 - 1)) { set(st, y * w + x, NONE); continue; }          // squared corners
      if ((x <= x0 + 1 || x >= x1 - 1) && y >= top + 2 && y < fy0 + 2) set(st, y * w + x, HAIR2);
    }
  }
  if (style === "puffs") {
    const P = walk ? 2 : 3, cy = top + (walk ? 1 : 2), r2 = P * P - 0.4;
    const disk = (cx, cyy) => { for (let y = cyy - P; y <= cyy + P; y++) for (let x = cx - P; x <= cx + P; x++) if ((x - cx) ** 2 + (y - cyy) ** 2 <= r2) into(x, y, HAIR); };
    if (f === 0 || f === null) { disk(x0, cy); disk(x1, cy); }
    else { const bx = f < 0 ? x1 : x0; disk(bx, cy); disk(f < 0 ? x1 - 1 : x0 + 1, cy - 1); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (reg[y * w + x] === HAIR && !walk && (x + 2 * y) % 5 === 0 && y < cy + 1) set(st, y * w + x, HAIR3);
  }
  if (style === "cornrows") {
    for (let y = top; y < Math.min(info.yh, h); y++) for (let x = x0; x <= x1; x++) {
      if (reg[y * w + x] !== HAIR || y >= fy0 + 1) continue;
      const stripe = (f === 1 || f === -1) ? ((y - top) % 2 === 1 && x < (f > 0 ? x1 : x1) + 1) : ((x - x0) % 2 === 1);
      if (stripe) set(st, y * w + x, HAIR2);
    }
    // a lighter gloss row at the crown
    if (!walk) for (let x = x0 + 2; x < x1 - 1; x += 3) if (at(x, top) === HAIR) set(st, top * w + x, HAIR3);
  }
  if (style === "locs" || style === "braids") {
    const braids = style === "braids", L = walk ? (braids ? 5 : 4) : (braids ? 11 : 8), wd = walk || braids ? 1 : 2, lo = [TOP, HAIR];
    const strand = (x, y0, len, bead) => {
      for (let k = 0; k < len; k++) {
        const y = y0 + k, c = at(x, y); if (c < 0) break;
        if (!(free(c) || c === TOP || c === HAIR || c === HAIR2)) break;
        const alt = braids ? ((k & 1) ? HAIR2 : HAIR) : (k % 3 === 2 ? HAIR2 : HAIR);
        set(st, y * w + x, bead && k >= len - 1 ? HAT : alt);
      }
    };
    const y0 = fy0 + (walk ? 2 : 3);
    if (f === 0) {
      for (let k = 0; k < wd; k++) { strand(x0 - 1 + k + (wd > 1 ? 0 : 1) - 1, y0, L, braids); strand(x1 + 1 - k - (wd > 1 ? 0 : 1) + 1, y0, L - (k ? 2 : 0), braids); }
      if (!walk && braids) { strand(x0 - 3, y0 + 1, L - 2, true); strand(x1 + 3, y0 + 1, L - 2, true); }
    } else if (f === null) {
      for (let x = x0 + 1; x < x1; x++) if (((x - x0) % 3) !== 2 || !braids) strand(x, info.yh - 3, L - 1, braids && (x - x0) % 3 === 0);
    } else {
      const bx = f < 0 ? x1 : x0, dir = f < 0 ? 1 : -1;
      for (let k = 0; k < wd; k++) strand(bx + dir * (k + 1 - 1) + dir * 0, y0 - 1, L, braids);
      if (!walk) strand(bx + dir * 2, y0, L - 2, braids);
    }
  }
  reoutline(st);
}
