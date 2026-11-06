// WEAR (3D hole view, render only; adapted from Mario Tennis's courtwear.js): the hole keeps what the play does to it, for the rest
// of the hole (a new hole starts clean):
//   divots     an iron or a wedge (clubs 4-12, $D329) swung from the fairway, the semi-rough or the rough takes a turf: a bare brown
//              scar along the aim where the ball sat, the turf flying off
//   pitch marks a ball landing on the green leaves a small dark dent where it came down
//   sand       a ball landing in a bunker leaves a crater; a shot played out of one leaves the golfer's footprints and the club's splash
// Reads the shot's events (scene.js watch: launch, land) and the hole's colours; writes nothing of the game.
import { T } from "./hole3d.js";

export class Wear {
  key = "wear";
  holeBuilt(sc) { sc.decals.length = 0; }
  frame(sc, game, s) {
    if (!s) return;
    const H = sc.hole.H, tc = sc.hole.typeCol;
    for (const [k, d] of sc.events || []) {
      if (k === "launch") {
        const [x, , z] = d.at, y = H(x, z), a = d.aim, t = d.terr;
        if (d.club >= 4 && d.club <= 12 && (t === T.FAIRWAY || t === T.SEMI || t === T.ROUGH || t === T.TEE)) {
          const cx = x + Math.cos(a) * 0.8, cz = z + Math.sin(a) * 0.8;
          sc.decal(cx, y, cz, 1.1, a + Math.PI / 2, 2.2, [0.36, 0.26, 0.14, 0.92], false, -1);   // the scar: bare earth
          sc.decal(cx, y, cz, 1.4, a + Math.PI / 2, 2.0, [0.25, 0.18, 0.1, 0.35], false, 2);
          for (let i = 0; i < 3; i++) sc.spawn({ x: cx, y: y + 0.2, z: cz, vx: Math.cos(a) * (6 + i * 2), vy: 7 + i * 2, vz: Math.sin(a) * (6 + i * 2), t: 0, life: 2.5, g: 25, drag: 0.3,
            c: [tc[t * 3] * 0.9, tc[t * 3 + 1] * 0.9, tc[t * 3 + 2] * 0.9], size: 0.6, stick: 1.5, bounce: 0.25 });   // the turf
        }
        if (t === T.BUNKER || t === T.BUNKER2) {
          for (let i = 0; i < 6; i++) {                 // footprints round where the golfer stood
            const side = i & 1 ? 1 : -1, back = 1.2 + (i >> 1) * 1.3, px = x - Math.cos(a) * back + -Math.sin(a) * (1.2 + side * 0.35), pz = z - Math.sin(a) * back + Math.cos(a) * (1.2 + side * 0.35);
            sc.decal(px, H(px, pz), pz, 0.45, a + Math.PI / 2, 1.9, [tc[6] * 0.72, tc[7] * 0.7, tc[8] * 0.66, 0.6], false, 0);
          }
          sc.decal(x, y, z, 2.2, a, 1.4, [tc[6] * 0.8, tc[7] * 0.78, tc[8] * 0.74, 0.5], false, 2);
        }
      } else if (k === "land") {
        const [x, , z] = d.at, y = H(x, z);
        if (d.terr === T.GREEN) { sc.decal(x, y, z, 0.42, 0, 1, [tc[18] * 0.55, tc[19] * 0.55, tc[20] * 0.5, 0.85], false, 0); sc.decal(x, y, z, 0.6, 0, 1, [1, 1, 1, 0.25], false, 1); }
        else if (d.terr === T.BUNKER || d.terr === T.BUNKER2) { sc.decal(x, y, z, 0.9, 0, 1, [tc[6] * 0.7, tc[7] * 0.68, tc[8] * 0.62, 0.7], false, 0); sc.decal(x, y, z, 1.3, 0, 1, [tc[6] * 1.1, tc[7] * 1.1, tc[8] * 1.1, 0.5], false, 1); }
      }
    }
    if (sc.decals.length > 600) sc.decals.splice(0, sc.decals.length - 600);
  }
}
