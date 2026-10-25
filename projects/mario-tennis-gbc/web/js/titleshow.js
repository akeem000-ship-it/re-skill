// TITLE SHOW: behind PRESS START (the menu wheel's title, menuwheel.js), the 3D view flies through every venue, one shot
// after another: each shot a venue (the VENUE TOUR's stops, venuetour.js), one of its cameras and an hour of the day, for
// SHOT seconds, the venue's name in a corner. The venue's court is drawn from the ROM (its tiles and colours), its stadium in
// its style, as the VENUE TOUR draws it; unlike the tour, the game is not held (the title waits for START as before) and
// nothing is unlocked. Only with the 3D view on: in 2D the title keeps its drawn court.
import { STOPS, venuePalette, tourCamera } from "./venuetour.js";
const SHOT = 6;
// the order of the shots: venues mixed so two of a kind never follow, cameras turning over, the hours from morning to night
const ORDER = [3, 0, 8, 5, 1, 7, 4, 9, 6, 2];
const CAMS = [1, 0, 2, 3, 1, 3, 0, 2, 1, 0];
const HOURS = [16, 10, 21, 13, 18, 20, 11, 15, 22, 17];
export class TitleShow {
  constructor(getVoxel) { this.getVoxel = getVoxel; this.v = null; this.k = -1; }
  get live() { return !!this.v; }
  get name() { return this.v && this.stop ? this.stop.name : ""; }
  // once a display frame: on while the title is up; returns whether the show is drawing
  update(on) {
    const v = on ? this.getVoxel() : null;
    if (!v || !v.stadium || !v.rom || (v.venueTour && !v.venueTour.attract)) { this.end(); return false; }   // (the VENUE TOUR's own)
    const now = performance.now() / 1000;
    if (this.v !== v) { this.end(); this.v = v; this.prevVenue = v.stadium.forceVenue; this.t0 = now; this.k = -1; }
    const k = Math.floor((now - this.t0) / SHOT);
    if (k !== this.k) this.shot(k, now);
    return true;
  }
  shot(k, now) {
    const v = this.v, i = k % ORDER.length, s = this.stop = STOPS[ORDER[i]], cam = CAMS[i], hour = HOURS[i], s0 = now;
    this.k = k;
    v.venueTour = { map: s.map, pal: venuePalette(v.rom, s.map), attract: true,
      camera: (aspect, m4, clip) => { if (v.light) v.light.weatherHour = hour + 0.01; return tourCamera(cam, performance.now() / 1000 - s0, aspect, m4, clip); } };
    v.stadium.forceVenue = s.venue; v.ground = null; v.groundHash = -1; v.courtId = s.map; v.stadium.reset();
  }
  // the title gone: the game's own view back (as the VENUE TOUR's close)
  end() {
    const v = this.v; if (!v) return; this.v = null; this.stop = null;
    if (v.venueTour && v.venueTour.attract) {
      v.venueTour = null; v.stadium.forceVenue = this.prevVenue; v.ground = null; v.courtId = -1; v.detectAt = 0; v.groundHash = -1;
      if (v.light) v.light.weatherHour = null;
      if (v.stadium.painted) v.stadium.pend = null; v.stadium.reset();
    }
  }
}
