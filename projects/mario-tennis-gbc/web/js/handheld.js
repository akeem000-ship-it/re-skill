// HANDHELD: Android games handhelds with their own controls. The Retroid Pocket Classic (a 3.92" AMOLED of 1240 x 1080 at 60 Hz,
// nearly the Game Boy's 10:9; a d-pad, A B X Y, L1 R1 L2 R2, Start, Select, Back and Home, no sticks; Snapdragon G1 Gen 2 with an
// Adreno A12) is known by its model in the WebView's user agent ("... Android 14; Retroid Pocket Classic Build/..."), any other
// handheld by the Android wrapper finding a game controller that is built in (MainActivity pushDevice: window.__device), and
// ?device=rpclassic forces it. On one:
//   controls   the touch stick and buttons stay hidden (gamepad.js: the controller counts as in use from the start; a touch on
//              the screen shows them for 5 s); L2 cycles the 3D court camera, R2 held runs the game at turbo speed
//              (full.js), L1 / R1 are Select / Start as before, Back shows the button bar
//   defaults   once per profile, before the page reads its settings (only those the player has not chosen): RES: Auto (the 3D
//              view's resolution comes down while the frame rate drops, back up when there is room), DETAIL: Lite (the stadiums'
//              every other seat, fewer trees), VIEW: Fill (the screen is nearly the game's own shape)
const PROFILES = [
  { id: "rpclassic", name: "Retroid Pocket Classic", match: /Retroid.*Classic|\bRP ?Classic\b/i,
    defaults: { "mt-res": "auto", "mt-stadium-q": "lite", "mt-aspect": "fill" } },
  // any other handheld: one the wrapper has reported a built-in controller on before (mt-builtinpad, noted below)
  { id: "handheld", name: "a games handheld", match: null, defaults: { "mt-res": "auto" } },
];
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const want = typeof location !== "undefined" ? new URLSearchParams(location.search).get("device") : null;
const noted = (() => { try { return localStorage.getItem("mt-builtinpad") === "1"; } catch (e) { return false; } })();
export const handheld = PROFILES.find(p => p.id === want) || (want === "none" ? null : PROFILES.find(p => p.match && p.match.test(ua)) || (noted ? PROFILES[1] : null)) || null;
// the profile's defaults: written once (a setting the player already has is kept), so later changes in the menus stick
if (handheld) try {
  const done = "mt-handheld-" + handheld.id;
  if (!localStorage.getItem(done)) {
    for (const [k, v] of Object.entries(handheld.defaults)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    localStorage.setItem(done, "1");
  }
} catch (e) { /* private mode */ }
// a controller built into the device (the wrapper's window.__device, or a known handheld): the touch controls are not needed
export function builtInPad() {
  const d = typeof window !== "undefined" && window.__device;
  if (d && d.builtinPad && !noted && !builtInPad.saved) { builtInPad.saved = true; try { localStorage.setItem("mt-builtinpad", "1"); } catch (e) { /* private mode */ } }
  return !!handheld || !!(d && d.builtinPad);
}
