// What a character is doing, from the sprite frame the game shows: every character's match sprite sheet has the same 29 animation
// groups x 5 views (the player banks' frame tables), so a tile's place in ROM names the group, and the group names the mood of the
// face (build.js groupMood). Read from the ROM tables at run time; nothing is stored.
import { charGfx } from "./mods.js";
import { off, groupMood } from "./build.js";

export function buildMoodTable(rom) {
  const ranges = [];
  for (let c = 0; c < 32; c++) {
    try {
      const G = charGfx(rom, c);
      for (let s = 0; s < 145; s++) {
        const a = G.match[s]; if (!(a >= 0x4000 && a < 0x8000)) continue;
        const cols = rom[off(G.matchBank, G.matchInfo + 4 * s + 2)] ? 4 : 3, base = off(G.matchBank, a);
        ranges.push([base, base + cols * 64 + cols * 16, (s / 5) | 0]);
      }
    } catch (e) { /* a character without a match sheet */ }
  }
  ranges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const uniq = []; for (const r of ranges) { const l = uniq[uniq.length - 1]; if (!l || l[0] !== r[0]) uniq.push(r); }
  return {
    groupAt(o) {
      let lo = 0, hi = uniq.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1, r = uniq[m]; if (o < r[0]) hi = m - 1; else if (o >= r[1]) lo = m + 1; else return r[2]; }
      return -1;
    },
    moodAt(o) { const g = this.groupAt(o); return g < 0 ? "neutral" : groupMood(g); },
  };
}
