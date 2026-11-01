// SHOT PREVIEW (a page helper, render only): where a perfect full-power swing with the current club, aim, lie, shot mode and wind
// would take the ball. The game's own shot code (js/golf/shot.js: ShotLaunch 10:5F94, BallTask 10:4D45 every frame, the
// flight-camera loop and ShotMainLoop 10:6E99 with the cup and the views) is run on a COPY of the game's memory (as g3d/replay.js
// does for its replays): the swing meter set as a perfect full swing leaves it (wSwingCount $78, wSwingCursor 0, wSwingPower $3C,
// wSwingPerfect 1, wSwingFullPower 1, no d-pad: ImpactPadTable 10:55CE's first entry; the putter: one press at $3C), then what
// 10:4921 does between the swing and the launch (the landing-preview task off: $D485 = $2D; the tree tile, the retry flags, the
// ball objects), then the launch, frame by frame to the shot's outcome. The live game is never touched: the copy is a separate
// GolfMemory with no sound, no page and no cable.
// The result is recomputed only when what decides the shot changes (the ball's spot, the aim, the club, the shot mode, the putt
// range, the wind, the view, the player); a run takes a few milliseconds (docs/g3d.md "Shot preview").
// Exact for a perfect full swing (web/tests/shot_preview.mjs plays such swings and compares the ball's rest spot); any other swing
// (less power, an early or late impact, the d-pad's hook / slice / height) goes elsewhere, as it should.
import { cloneMemory } from "../g3d/replay.js";
import { Shot } from "../golf/shot.js";
import { Hole } from "../golf/ball.js";
import { setImpactFromPad } from "../golf/swing.js";
import { shotLength } from "../golf/cup.js";
import { playerField } from "../golf/memory.js";

const u16 = (r, a) => r[a] | r[a + 1] << 8;
export const PUTTER = 0x0D;

// what decides the shot: when this is the same, the last result stands
export function previewKey(w) {
  const r6 = w.wram[6], w0 = w.wram[0];
  return [r6[0x320], r6[0x400], u16(r6, 0x401), r6[0x403], u16(r6, 0x404), u16(r6, 0x418), r6[0x329], r6[0x32A], r6[0x32B], w0[0x815], w0[0x816],
    r6[0x443], w0[0x835], r6[0x4C6], r6[0x4C7], r6[0x4CC]].join(",");
}

// whose turn it is: the preview is for a human player's own swing (not the computer's: $D4BF / $D4D7, nor a link partner's)
export function humanTurn(w) {
  const r6 = w.wram[6], w0 = w.wram[0];
  return !r6[0x4BF] && !r6[0x4D7] && !w0[playerField(w, 0x13)];
}

// run the shot on a copy: { path: [[x, height, z, inAir]] per frame in world px (1 = 1/32 of the RAM's units: a yard), land: the
// first frame on the ground, carry / rest: yards (the game's ShotLength 10:6276, as the HUD shows a shot), outcome, putt, ms }
export function runPreview(w, { maxFrames = 1600, display = false } = {}) {
  const t0 = (typeof performance !== "undefined" ? performance : Date).now();
  const c = cloneMemory(w);
  if (!display) c.vram = null;                    // (no pictures in the copy: its display hooks are skipped, render/hooks.js)
  const c6 = c.wram[6], c0 = c.wram[0], s = c6.subarray(0x400, 0x500);
  const putt = c6[0x329] === PUTTER;
  // the swing meter as a perfect full swing leaves it (Shot.swing / swingEnd, 10:57E0)
  s[0x4F] = putt ? 0x3C : 0; s[0x50] = 0x3C; s[0x51] = putt ? 0 : 1; s[0x52] = putt ? 0 : 1;
  s[0x4E] = putt ? 0x3C : 0x78;
  if (putt) c6[0x32A] = c6[0x32B];               // (the putter's press: the putt range as the shot mode, 10:5833)
  else { s[0x4D] = 1; setImpactFromPad(c, 1); }  // (SwingPadTask 10:55AC at the impact frame: A held, no d-pad)
  // 10:4921-10:49A0 without its waits and pictures: the shot record, the preview off, the stroke's records, the launch
  s[0x85] &= 0xEF;
  c6.set([...c6.subarray(0x400, 0x406), c6[0x418], c6[0x419], c6[0x329], c6[0x32A], c6[0x450], c6[0x44F], c6[0x44D]], 0x5F8);   // 02:46B0
  s[0x85] = 0x2D;
  c6[0x35D] = c6[0x32A]; c6[0x35E] = c6[0x32B];
  s[0x47] = s[0x46];
  if (c0[0x0F4]) c0[0x0F4] = 2;
  c6[0x35F] = c6[0x360] = 0;
  c6[0x519] = s[0x05]; c6[0x516] = s[0x02];
  s[0x85] |= 4;
  const start = c6.slice(0x5F8, 0x5FE);
  c.high[0x190] = c.high[0x191] = c.high[0x194] = 0;   // (no buttons in the copy: B would end the roll, A retry)
  const sh = new Shot(c, new Hole(c6[0x320]));
  sh.input = () => 0;
  const g = sh.launch(), path = [];
  let land = -1, carry = 0, outcome = null, n = 0;
  for (; n < maxFrames; n++) {
    const r = g.next();
    const p = [(u16(c6, 0x401) + c6[0x400] / 256) / 32, ((u16(c6, 0x407) << 16 >> 16) + c6[0x406] / 256) / 32, (u16(c6, 0x404) + c6[0x403] / 256) / 32, c6[0x415]];
    path.push(p);
    if (land < 0 && n > 1 && !p[3]) { land = path.length - 1; carry = shotLength(s, start) >> 5; }
    if (r.done) { outcome = r.value; break; }
  }
  if (land < 0) { land = path.length - 1; carry = shotLength(s, start) >> 5; }
  const rest = shotLength(s, start) >> 5;
  const ms = (typeof performance !== "undefined" ? performance : Date).now() - t0;
  return { path, land, carry, rest, outcome, putt, hole: c6[0x320], end: path[path.length - 1], frames: n, ms, from: [(u16(w.wram[6], 0x401) + w.wram[6][0x400] / 256) / 32, (u16(w.wram[6], 0x404) + w.wram[6][0x403] / 256) / 32] };
}

// the cache: one result per key (the copy's run is skipped while nothing that decides the shot has changed)
export class ShotPreview {
  constructor() { this.key = ""; this.res = null; this.runs = 0; this.lastMs = 0; }
  get(w) {
    const key = previewKey(w);
    if (key === this.key) return this.res;
    this.key = key; this.res = null;
    try { this.res = runPreview(w); this.runs++; this.lastMs = this.res.ms; }
    catch (e) { console.warn("shot preview", e); }
    return this.res;
  }
}
