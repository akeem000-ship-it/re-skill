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
function update(h) {                             // the common tail 00:25F7-00:261E
  let a = h[LEVEL] - h[SPEED];
  if (a < 0) a = 0;
  if (!a) h[ST] = 0;
  h[LEVEL] = a;
  h[0x19D] = 3;                                  // hPalUpdate
}
export function fadeVBlank(w) {                  // 00:25DF UpdateFadeOut, 00:25C9 UpdateFadeIn (in VBlank)
  const h = w.high;
  if (h[ST] & 1) update(h);
  if (h[ST] & 2) update(h);
}
export function waitFade(sh) {                   // 00:2625 WaitFade
  while (sh.w.high[ST]) sh.advance();
}
