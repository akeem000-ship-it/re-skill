// "FIELD LIFE: on / off": a little life over the overworld's outdoor maps in the 3D view, drawn with the scenery (so the lighting and the
// time of day apply):
//   birds          now and then a small flock crosses the sky over the map, wings beating (by day)
//   cloud shadows  soft dark patches drifting slowly across the ground with the wind (by day)
//   fountains      glints twinkling on the water by day; at night the water is lit from below (a cool glow at the basin)
import { INDOOR_MAPS } from "./lighting.js";
const KEY = "mt-fieldlife";

export class FieldLife {
  constructor(voxel) {
    this.v = voxel; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.flock = null; this.nextFlock = 8; this.tex = null;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } }
  // voxel.js renderField, after the scenery: mvp of the view, T seconds, centre of the view (map px)
  draw(mvp, m4, T, cx, cz) {
    const v = this.v, f = v.field, id = v.mapId(); if (!this.on || INDOOR_MAPS.has(id) || f.mapId !== id) return;
    const gl = v.gl, night = v.nightLevel(), day = 1 - Math.min(1, night * 1.4);
    if (!this.tex) { this.tex = v.solidTexture([255, 255, 255, 255]); this.bird = v.texture(8, 4, birdPixels()); }
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    // cloud shadows: a few big soft blobs on the ground drifting with the wind, wrapping round the view (not on side-view maps: no sky above)
    if (day > 0.05 && !f.noGlass) {
      gl.depthMask(false);
      for (let k = 0; k < 4; k++) {
        const span = 900, x = cx - span / 2 + ((k * 263 + T * 9) % span + span) % span, z = cz - span / 2 + ((k * 401 + T * 4) % span + span) % span;
        v.draw(v.shadowTex, m4.trs(x, 0.4, z, 260 + 60 * (k % 2), 170 + 40 * (k % 3), -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.16 * day], 0);
      }
      gl.depthMask(true);
    }
    // birds: a flock of 5-7 crossing the view high up, wings flapping (a two-frame V), about every 25-50 s
    if (day > 0.3) {
      if (!this.flock && T > this.nextFlock) {
        const dir = Math.random() < 0.5 ? 1 : -1, n = 5 + Math.floor(Math.random() * 3);
        this.flock = { t0: T, dir, z: cz - 120 + Math.random() * 100, birds: Array.from({ length: n }, (_, i) => ({ dx: -i * 14 - Math.random() * 8, dz: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 9 + Math.random() * 4, ph: Math.random() * 6.28 })) };
      }
      const F = this.flock;
      if (F) {
        const s = (T - F.t0) * 70;
        if (s > 700) { this.flock = null; this.nextFlock = T + 25 + Math.random() * 25; }
        else for (const b of F.birds) {
          const x = cx + F.dir * (s - 350 + b.dx), flap = Math.sin(T * 14 + b.ph) > 0;
          v.draw(this.bird, m4.trs(x, 150 + Math.sin(T * 1.3 + b.ph) * 4, F.z + b.dz, F.dir * 9, flap ? 5 : 3, -1.0), mvp, [0, flap ? 0 : 0.5, 1, 0.5], [0.15, 0.14, 0.18, day], 0.3);
        }
      }
    }
    // fountains: glints on the water by day, a cool glow from below at night
    const fx = f.fx;
    for (const fo of (fx && fx.fountains) || []) {
      const [ox, oy, oz] = fo.origin;
      if (night > 0.2) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
        v.draw(v.shadowTex, m4.trs(ox, oy + 1.5, oz, 70, 46, -Math.PI / 2), mvp, [0, 0, 1, 1], [0.35, 0.75, 1.0, 0.45 * night], 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        for (let k = 0; k < 10; k++) {
          const a = k * 2.4 + 0.3, r = 8 + (k * 7) % 18, tw = Math.pow(Math.max(0, Math.sin(T * (3 + k % 4) + k * 1.7)), 12);
          if (tw < 0.05) continue;
          v.draw(this.tex, m4.trs(ox + Math.cos(a) * r, oy + 1 + (k % 3), oz + Math.sin(a) * r * 0.7, 2.5 * tw + 0.5, 2.5 * tw + 0.5, -0.3, 0.785), mvp, [0, 0, 1, 1], [1, 1, 1, 0.9 * tw * day], 0);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    }
  }
}
// a bird, 8 x 2 in two frames (wings up, wings level), white: tinted dark when drawn
function birdPixels() {
  const rows = ["1000000100000000", "0110011000000000", "0000000000000000", "1111111100000000"], d = new Uint8Array(8 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) if (rows[y][x] === "1") d.set([255, 255, 255, 255], (y * 8 + x) * 4);
  return d;
}

export function addFieldLifeButton(hud, life) {
  if (!hud || !life) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "fieldlifebtn"; b.title = "Overworld (3D): birds crossing the sky, cloud shadows drifting over the ground, sparkling fountains lit at night";
  const show = () => { b.textContent = "FIELD LIFE: " + (life.on ? "on" : "off"); b.classList.toggle("on", life.on); };
  b.addEventListener("pointerdown", () => { life.setOn(!life.on); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); return b;
}
export function attachFieldLife(voxel, hud) { const l = voxel.life = new FieldLife(voxel); addFieldLifeButton(hud, l); return l; }
