// Screen fades (bank 0), as far as they decide how many frames the game waits: hFadeState $FFA2 (1 out, 2 in,
// bit 7 white), hFadeSpeed $FFA3, the level $FFA4 (from $7C down by the speed each VBlank), hScreenFadedOut
// $FFBC. The palettes they compute are display.
const ST = 0x1A2, SPEED = 0x1A3, LEVEL = 0x1A4, OUT = 0x1BC;

function begin(h, state, c) {                    // 00:25BC
  h[SPEED] = c || 1;
  h[LEVEL] = 0x7C;
}
export function beginFadeOut(w, c) {             // 00:25A1 BeginFadeOut
  const h = w.high;
  if (h[OUT]) return;
  h[ST] = 1; h[OUT] = 1;
  begin(h, 1, c);
}
export function forceFadeOut(w, c) {             // 00:258A ForceFadeOut
  const h = w.high;
  h[ST] = 1; h[OUT] = 1;
  begin(h, 1, c);
}
export function beginWhiteFadeOut(w, c) {        // 00:2590 BeginWhiteFadeOut
  beginFadeOut(w, c);
  if (w.high[ST]) w.high[ST] |= 0x80;
}
export function forceFadeIn(w, c) {              // 00:258D ForceFadeIn
  const h = w.high;
  h[ST] = 2; h[OUT] = 0;
  begin(h, 2, c);
}
export function beginFadeIn(w, c) {              // 00:25AF BeginFadeIn
  if (!w.high[OUT]) return;
  forceFadeIn(w, c);
}
// the common tail 00:25F7-00:261E: the live palettes ($C100) from the master copy ($C200) at the fade level c
function update(w, a, c) {
  const h = w.high;
  if (h[ST] & 0x80) { if (!(c & 4)) applyWhiteFade(w, c); }
  else adjustColorsBrightness(w, c >> 2);
  if (!a) h[ST] = 0;
  h[LEVEL] = a;
  h[0x19D] = 3;                                  // hPalUpdate
}
export function fadeVBlank(w) {                  // 00:25DF UpdateFadeOut, 00:25C9 UpdateFadeIn (in VBlank)
  const h = w.high;
  if (w.fadeSkip) { w.fadeSkip = false; return; }   // (a test's lag model: web/tests/golf/screenstep.mjs)
  if (h[ST] & 1) {                               // out: the level runs from 0 up to $7C
    const b = Math.max(0, h[LEVEL] - h[SPEED]);
    update(w, b, (0x7C - b) & 0xFF);
  }
  if (h[ST] & 2) {                               // in: from $7C down to 0
    const a = Math.max(0, h[LEVEL] - h[SPEED]);
    update(w, a, a);
  }
}

// 00:255A AdjustColorsBrightness: the 64 colours of $C200 with d (0-$1F) added to each component, clamped to
// $1F (00:24EB SplitColorComponents, 00:2521 AddClampColorComponent, 00:2504 CombineColorComponents) -> $C100
function adjustColorsBrightness(w, d) {
  const w0 = w.wram[0];
  for (let k = 0; k < 0x40; k++) {
    const v = w0[0x200 + 2 * k] | w0[0x201 + 2 * k] << 8;
    const comp = x => { const s = (x + d) & 0xFF; return s & 0x80 ? 0 : s >= 0x1F ? 0x1F : s; };
    const r = comp(v & 0x1F), g = comp((v >> 5) & 0x1F), b = comp((v >> 10) & 0x1F);
    const o = r | g << 5 | b << 10;
    w0[0x100 + 2 * k] = o & 0xFF; w0[0x101 + 2 * k] = o >> 8;
  }
}

// 00:2632 ApplyWhiteFade: the 64 colours of $C200 brightened by the level (c & $78) towards white -> $C100
function applyWhiteFade(w, c) {
  const w0 = w.wram[0];
  const d0 = c & 0x78, e0 = (d0 >> 2) & 0xFF;
  let de = (((((d0 >> 2) << 4 | (d0 >> 2) >> 4) & 0xFF) >> 1 | ((((d0 >> 2) << 4 | (d0 >> 2) >> 4) & 1) << 7)) & 0xFF);
  de = ((de << 2) + (d0 << 8 | e0)) & 0xFFFF;
  const d = de >> 8, e = de & 0xFF;
  for (let k = 0; k < 0x40; k++) {
    const lo = w0[0x200 + 2 * k], hi = w0[0x201 + 2 * k];
    let cc = (lo & 0xDF) + e;
    const carry = cc > 0xFF ? 1 : 0;
    cc &= 0xFF;
    let b = ((hi & 0xFB) + d + carry) & 0xFF;
    if (b & 0x80) b |= 0x78;
    if (b & 0x04) { b = ((b & 0xFC) - 1) & 0xFF; cc |= 0xC0; }
    let a = cc;
    if (a & 0x20) a = ((a & 0xE0) - 1) & 0xFF;
    w0[0x100 + 2 * k] = a; w0[0x101 + 2 * k] = b;
  }
}
export function* waitFade(sh) {                   // 00:2625 WaitFade
  while (sh.w.high[ST]) yield* sh.advance();
}

// 00:2C6B UpdateGameTimer (VBlank): the countdown (wCountdownState $C0F4 = 1: seconds at $C0F6/$C0F7, sounds $9F
// each second and $A0 at zero), then the play clock wPlayClock $C0F0 (frames, seconds, minutes, hours to 99)
export function updateGameTimer(w, sound = () => {}) {
  const w0 = w.wram[0];
  if (w0[0x0F4] === 1) {                         // 00:2C98 TickSecondaryTimerCountdown
    w0[0x0F5] = (w0[0x0F5] + 1) & 0xFF;
    if (w0[0x0F5] === 0x3C) {
      w0[0x0F5] = 0;
      sound(0x9F);
      w0[0x0F6] = (w0[0x0F6] - 1) & 0xFF;
      if (w0[0x0F6] === 0xFF) { w0[0x0F6] = 0x3B; w0[0x0F7] = (w0[0x0F7] - 1) & 0xFF; }
    }
    if (!(w0[0x0F6] | w0[0x0F7])) {
      w0[0x0F4] = 0xFF; w0[0x0F5] = w0[0x0F6] = w0[0x0F7] = 0;
      sound(0xA0);
    }
  }
  let p = 0x0F0;                                 // 00:2C73 TickSecondaryTimer
  for (const lim of [0x3C, 0x3C, 0x3C]) {
    w0[p] = (w0[p] + 1) & 0xFF;
    if (w0[p] < lim) return;
    w0[p++] = 0;
  }
  w0[p] = (w0[p] + 1) & 0xFF;
  if (w0[p] < 0x64) return;
  w0[p]--; w0[p - 1] = 0x3B;
}

// 00:2C1F WaitJingleEnd: while a jingle plays (hActiveJingle $FFCD, kept by the sound driver: w.jingleActive) a frame
// at a time until a button is held; then the jingle's end (00:2C35: the BGM again unless the music is off). Without
// a sound driver there is no jingle to wait for.
export function* waitJingleEnd(sh) {
  const w = sh.w;
  const active = () => (w.jingleActive ? w.jingleActive() : 0);
  if (!active()) return;
  do yield* sh.advance(); while (!w.high[0x190] && active());
  if (w.onEndJingle) w.onEndJingle();
}
