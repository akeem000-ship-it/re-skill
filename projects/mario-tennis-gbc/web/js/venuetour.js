// VENUE TOUR (OPTIONS > Stadium, or the VENUE TOUR button): fly round any stadium you have played in, at any hour, from anywhere in
// the game (the menus included). The game is held while it is open (as for the walk-out intro: no frames run); the 3D view draws the
// chosen venue's court from the ROM (its own tiles and colours: assets.js courtIndexMap, the map's palette) with its stadium, sky and
// crowd, under a camera of its own. Venues: the class courts as park, club and academy stadium, the castle, pipe, island, jungle,
// hangar, Bowser and stadium courts; a venue is unlocked once you have played in it (stadium3d.js remembers it, mt-venues-seen), the park
// always. Controls: LEFT / RIGHT the venue, UP / DOWN the hour, A the camera (orbit, flyover, courtside, from the stands), B or START out;
// the buttons on its bar by touch. Nothing in the game is read or written but the ROM's pictures.
import { toast, hdStyle } from "./hdpanel.js";
export const STOPS = [
  { venue: "junior", map: 3, name: "THE PARK" }, { venue: "senior", map: 4, name: "THE CLUB" }, { venue: "varsity", map: 5, name: "THE ACADEMY STADIUM" },
  { venue: "castle", map: 1, name: "THE CASTLE COURT" }, { venue: "pipes", map: 10, name: "THE PIPE COURT" }, { venue: "tropics", map: 9, name: "THE ISLAND COURT" },
  { venue: "jungle", map: 15, name: "THE JUNGLE COURT" }, { venue: "hangar", map: 12, name: "THE HANGAR" }, { venue: "volcano", map: 11, name: "BOWSER'S COURT" },
  { venue: "city", map: 2, name: "THE STADIUM BOWL" },
];
const SEEN_KEY = "mt-venues-seen", CAMS = ["ORBIT", "FLYOVER", "COURTSIDE", "THE STANDS"];
export function markSeen(venue) { try { const s = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); if (!s.has(venue)) { s.add(venue); localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } } catch (e) { /* private mode */ } }
function seen() { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { return new Set(); } }

// a venue's court colours: the court map's own palette from the ROM (bank $0A's map table)
export function venuePalette(rom, map) {
  const base = 0x59D9 + map * 16, pi = rom.u8(0x0A, base + 2), pb = rom.u8(0x0A, base + 3);
  try { return Uint8Array.from(rom.rawRef(pi, pb, 64)); } catch (e) { return new Uint8Array(64).fill(0x7F); }
}
// the tour's cameras (CAMS), t seconds into the shot
export function tourCamera(cam, t, aspect, m4, clip) {
  let eye, at, fov = 0.8;
  if (cam === 0) { const a = t * 0.12 + 0.6; eye = [Math.sin(a) * 4300, 1700 + 250 * Math.sin(t * 0.2), Math.cos(a) * 4300]; at = [0, 150, 0]; }
  else if (cam === 1) { const u = (t % 16) / 16, a = u * 6.283; eye = [Math.sin(a) * (2600 + 900 * Math.sin(a * 2)), 700 + 900 * (0.5 + 0.5 * Math.cos(a * 2)), Math.cos(a) * 3000]; at = [Math.sin(a + 0.8) * 600, 250, Math.cos(a + 0.8) * 900]; fov = 0.9; }
  else if (cam === 2) { const z = 1700 * Math.sin(t * 0.18); eye = [-1150, 120, z]; at = [1400, 360, z * 0.6]; fov = 0.85; }
  else { const a = Math.sin(t * 0.15) * 0.9; eye = [-1560, 700, 900]; at = [600 * Math.cos(a), 120, -1600 * Math.sin(a) - 200]; fov = 0.95; }
  return { mvp: m4.mul(m4.perspective(fov, aspect, clip.near, clip.far), m4.lookAt(eye, at, [0, 1, 0])), tilt: 0 };
}

export class VenueTour {
  constructor({ getVoxel, setView3d, getView3d, pad }) { this.getVoxel = getVoxel; this.setView3d = setView3d; this.getView3d = getView3d; this.pad = pad; this.on = false; this.i = 0; this.hour = 16; this.cam = 0; }
  stops() { const S = seen(); const all = new URLSearchParams(location.search).has("allvenues"); return STOPS.filter(s => all || s.venue === "junior" || S.has(s.venue)); }
  open() {
    if (this.on) return;
    if (!this.getView3d()) { this.setView3d(true); this.was2d = true; } else this.was2d = false;
    const v = this.getVoxel(); if (!v || !v.stadium || !v.rom) { toast("VENUE TOUR needs the 3D view"); if (this.was2d) this.setView3d(false); return; }
    this.v = v; this.on = true; globalThis.__venueTourOn = true; this.t0 = performance.now() / 1000; this.prevVenue = v.stadium.forceVenue;
    const list = this.stops(); this.i = Math.max(0, list.findIndex(s => s.venue === (v.stadium.built && v.stadium.built.venue))); this.apply();
    this.ui(); this.keyH = e => { const k = { ArrowLeft: 0x20, ArrowRight: 0x10, ArrowUp: 0x40, ArrowDown: 0x80, Escape: 2, KeyX: 2, Enter: 8, KeyZ: 1, Space: 1 }[e.code]; if (k) { e.preventDefault(); e.stopPropagation(); this.input(k); } };
    addEventListener("keydown", this.keyH, true); this.lastPad = null;
    const loop = () => { if (!this.on) return; this.padStep(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  close() {
    if (!this.on) return; const v = this.v; this.on = false; globalThis.__venueTourOn = false; removeEventListener("keydown", this.keyH, true);
    v.venueTour = null; v.stadium.forceVenue = this.prevVenue; v.ground = null; v.courtId = -1; v.detectAt = 0; v.groundHash = -1; if (v.light) v.light.weatherHour = null;
    if (v.stadium.painted) v.stadium.pend = null; v.stadium.reset();
    if (this.root) this.root.hidden = true;
    if (this.was2d) this.setView3d(false);
  }
  // the venue: its court from the ROM (map, palette), the stadium in its style
  apply() {
    const v = this.v, s = this.stops()[this.i]; if (!s) return;
    v.venueTour = { map: s.map, pal: venuePalette(v.rom, s.map), camera: (a, m4, clip) => this.camera(a, m4, clip) };
    v.stadium.forceVenue = s.venue; v.ground = null; v.groundHash = -1; v.courtId = s.map; v.stadium.reset(); this.t0 = performance.now() / 1000;
    this.render();
  }
  input(edge) {
    const n = this.stops().length;
    if (edge & 0x0A) { this.close(); return; }
    if (edge & 0x30) { this.i = (this.i + (edge & 0x10 ? 1 : n - 1)) % n; this.apply(); return; }
    if (edge & 0xC0) { this.hour = ((this.hour + (edge & 0x40 ? 1 : -1)) + 24) % 24; this.render(); }
    if (edge & 0x01) { this.cam = (this.cam + 1) % CAMS.length; this.t0 = performance.now() / 1000; this.render(); }
  }
  padStep() {
    if (!this.pad) return; const p = this.pad(), m = (p.a ? 1 : 0) | (p.b ? 2 : 0) | (p.start ? 8 : 0) | (p.right ? 0x10 : 0) | (p.left ? 0x20 : 0) | (p.up ? 0x40 : 0) | (p.down ? 0x80 : 0);
    if (this.lastPad === null) { this.lastPad = m; return; } const edge = m & ~this.lastPad; this.lastPad = m; if (edge) this.input(edge);
  }
  // the camera (voxel.js renderCourt asks first while the tour is open); the hour goes to the lighting as the weather's hour does
  camera(aspect, m4, clip) {
    const v = this.v; if (v.light) v.light.weatherHour = this.hour + 0.01;
    return tourCamera(this.cam, performance.now() / 1000 - this.t0, aspect, m4, clip);
  }
  // ---- the bar along the bottom: the venue, the hour, the camera, the buttons ----
  ui() {
    hdStyle();
    if (!this.root) {
      const r = this.root = document.createElement("div"); r.className = "hdchip"; r.id = "venuetour";
      Object.assign(r.style, { display: "flex", gap: "10px", alignItems: "center", pointerEvents: "auto", bottom: "4%", flexWrap: "wrap", justifyContent: "center" });
      r.addEventListener("pointerdown", e => { const b = e.target.closest("[data-k]"); if (b) { e.stopPropagation(); e.preventDefault(); this.input(+b.dataset.k); } });
      document.body.appendChild(r);
    }
    this.root.hidden = false; this.root.style.display = "flex"; this.render();
  }
  render() {
    if (!this.root) return; const s = this.stops()[this.i], hh = String(Math.floor(this.hour)).padStart(2, "0");
    const btn = (k, t) => `<b data-k="${k}" style="cursor:pointer;padding:0 6px">${t}</b>`;
    this.root.innerHTML = `${btn(0x20, "◀")}<span><b>VENUE TOUR</b> ${s ? s.name : ""}</span>${btn(0x10, "▶")} ${btn(0x80, "▼")}<span>${hh}:00</span>${btn(0x40, "▲")} ${btn(1, "CAM: " + CAMS[this.cam])} ${btn(2, "✕")}`;
  }
}
export function addVenueTourButton(hud, tour) {
  if (!hud) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "venuetourbtn"; b.title = "fly round any stadium you have played in, at any hour (the game waits while you look)"; b.textContent = "VENUE TOUR";
  b.addEventListener("pointerdown", () => tour.open()); hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); return b;
}
