// HANDHELD: Android games handhelds with their own controls (copied from the Mario Tennis project, web/js/handheld.js, and adapted).
// The Retroid Pocket Classic (a 3.92" AMOLED of 1240 x 1080, nearly the Game Boy's 10:9; a d-pad, A B X Y, L1 R1 L2 R2, Start,
// Select) is known by its model in the WebView's user agent, any other handheld by the Android app finding a game controller that
// is built in (MainActivity pushDevice: window.__device), and ?device=rpclassic forces it (?device=none: never). On one:
//   controls   the touch pad stays hidden (gamepad.js: the controller counts as in use from the start; a touch on the screen shows
//              the pad for 5 s); L1 / R1 are Select / Start, R2 held runs the game fast (as Space), L2 switches the view (10:9 / Wide)
//   defaults   once per profile, before the page reads its settings (only those the player has not chosen): the HD text and menus on
//              (the screen is sharp enough to show them), the 10:9 view (the screen's own shape)
const PROFILES = [
  { id: "rpclassic", name: "Retroid Pocket Classic", match: /Retroid.*Classic|\bRP ?Classic\b/i,
    defaults: { "mg-font": "itim", "mg-ui": "hd", "mg-view": "normal", "mg3d": JSON.stringify({ quality: "lite" }) } },   // (the 3D view: Lite, for its GPU)
  // any other handheld: one the app has reported a built-in controller on before (mg-builtinpad, noted below)
  { id: "handheld", name: "a games handheld", match: null, defaults: { "mg-font": "itim", "mg-ui": "hd" } },
];
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const want = typeof location !== "undefined" ? new URLSearchParams(location.search).get("device") : null;
const noted = (() => { try { return localStorage.getItem("mg-builtinpad") === "1"; } catch (e) { return false; } })();
export const handheld = PROFILES.find(p => p.id === want) || (want === "none" ? null : PROFILES.find(p => p.match && p.match.test(ua)) || (noted ? PROFILES[1] : null)) || null;
// the profile's defaults: written once (a setting the player already has is kept), so later changes stick
if (handheld) try {
  const done = "mg-handheld-" + handheld.id;
  if (!localStorage.getItem(done)) {
    for (const [k, v] of Object.entries(handheld.defaults)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    localStorage.setItem(done, "1");
  }
} catch (e) { /* private mode */ }
// a controller built into the device (the app's window.__device, or a known handheld): the touch controls are not needed
export function builtInPad() {
  const d = typeof window !== "undefined" && window.__device;
  if (d && d.builtinPad && !noted && !builtInPad.saved) { builtInPad.saved = true; try { localStorage.setItem("mg-builtinpad", "1"); } catch (e) { /* private mode */ } }
  return !!handheld || !!(d && d.builtinPad);
}
