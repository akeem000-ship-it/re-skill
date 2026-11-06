// FIELD LIFE (3D overworld, render only; adapted from Mario Tennis's fieldlife.js): on the outdoor maps (field_objects.js sky) birds
// cross the sky in small flocks, flapping, with their shadows passing over the ground; butterflies flit low in the day and fireflies
// at night; indoors a few motes of dust drift in the light. It also turns on the GROUND and SHIMMER parts of the overworld's shader.
// Nothing of the game is read but the map's view (field3d.js).
export class FieldLife {
  key = "fieldlife";
  drawField(sc, field, dt, ann) {
    const t = sc.time, cx = sc.eye[0], cz = sc.eye[2] - 112, L = sc.light;
    if (ann.sky) {
      for (let f = 0; f < 2; f++) {                    // flocks: a V of birds flying across, round and round
        const ph = (t * 0.05 + f * 0.5) % 1, x0 = cx - 160 + ph * 320, z0 = cz - 40 + f * 70, y = 48 + f * 10;
        for (let b = 0; b < 5; b++) {
          const side = (b & 1 ? 1 : -1) * Math.ceil(b / 2), bx = x0 - Math.abs(side) * 6, bz = z0 + side * 5, flap = Math.sin(t * 9 + b) * 1.2;
          sc.point(bx, y + flap * 0.3, bz, 0.1, 0.1, 0.14, 1, 1.2);
          sc.point(bx - 1.2, y + flap, bz - 0.6, 0.15, 0.15, 0.2, 1, 0.9); sc.point(bx - 1.2, y + flap, bz + 0.6, 0.15, 0.15, 0.2, 1, 0.9);
          sc.point(bx + 18, 0.3, bz + 30, 0, 0, 0, 0.18, 1.6);   // the shadow on the ground (the sun high behind)
        }
      }
      const night = L.night > 0.5;
      for (let i = 0; i < 10; i++) {                   // butterflies by day, fireflies by night
        const a = i * 2.39, r = 30 + (i * 37) % 60, x = cx + Math.cos(a + t * 0.2) * r + Math.sin(t * 2.1 + i) * 4, z = cz + Math.sin(a + t * 0.15) * r * 0.6;
        const y = 3 + Math.abs(Math.sin(t * 3 + i)) * 3;
        if (night) sc.point(x, y, z, 0.8, 1, 0.4, 0.5 + 0.5 * Math.sin(t * 5 + i), 1.1);
        else { const c = [[1, 0.9, 0.3], [1, 1, 1], [1, 0.5, 0.7]][i % 3], flap = Math.abs(Math.sin(t * 14 + i)); sc.point(x - flap * 0.6, y, z, c[0], c[1], c[2], 1, 0.9); sc.point(x + flap * 0.6, y, z, c[0], c[1], c[2], 1, 0.9); }
      }
    } else {
      for (let i = 0; i < 24; i++) { const x = cx + ((i * 53) % 160) - 80 + Math.sin(t * 0.3 + i) * 6, z = cz + ((i * 29) % 120) - 60, y = 4 + ((t * 0.8 + i * 0.7) % 14); sc.point(x, y, z, 1, 0.97, 0.85, 0.35, 0.6); }
    }
    const L2 = sc.light, keep = [L2.fogNear, L2.fogFar]; L2.fogNear = 1e5; L2.fogFar = 2e5; sc.flushPoints(); L2.fogNear = keep[0]; L2.fogFar = keep[1];
  }
}
