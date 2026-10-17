// "VOX: Blocky / Rounded": rounded solid bodies for the sprites in the VOX view (characters, the ball). A render-time mesh builder only: the
// game is never touched. The old "blocky" body is a column of cubes per pixel (voxel.js meshFromPixels); this one is a smooth closed
// surface instead:
//   * the front and the back are a height field over the pixel grid with SHARED corner heights, so neighbouring pixels meet without steps:
//     the thickness follows the distance from the silhouette (a quarter circle of radius R pixels, up to T), softened by a small blur, so
//     the body is thickest in the middle of the torso and the head and rolls off to a thin rim,
//   * the outline is closed by a thin wall, and the back is a darker, slightly cooler copy (never a flat card from behind),
//   * every pixel keeps its exact colour on the front; a soft per-vertex shade from the surface normal (1.0 where the surface faces the
//     viewer, a little darker or lighter where it turns away) gives it volume without the sun, and the LIGHT layer shades the smooth depth
//     it leaves in the depth buffer (no step faces, so no stripes in the sun shadows or the glow).
// A mesh is built once per unique sprite frame (voxel.js caches it by the tile bytes and palettes, plus the Detailed flag) and never
// rebuilt per frame.
const KEY = "mt-voxstyle";
const LIGHT_DIR = (() => { const l = [-0.35, 0.55, 0.75], n = Math.hypot(...l); return l.map(x => x / n); })();
const shadeOf = (nx, ny, nz) => { const d = nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2]; return Math.max(0.68, Math.min(1.14, 1 + 1.0 * (d - LIGHT_DIR[2]))); };

// rgba: w x h pixels (alpha >= 128 = solid); R, T in pixels of that image. Returns { pos, col } (triangles, local units: 1 = one pixel,
// origin bottom-centre like meshFromPixels: x from -w/2, y up from the bottom row, z towards the viewer)
export function roundedMeshData(rgba, w, h, R = 5, T = 4.5) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] >= 128;
  const W1 = w + 1, H1 = h + 1, nv = W1 * H1, used = new Uint8Array(nv), edge = new Uint8Array(nv);
  for (let vy = 0; vy < H1; vy++) for (let vx = 0; vx < W1; vx++) {
    const k = (solid(vx - 1, vy - 1) ? 1 : 0) + (solid(vx, vy - 1) ? 1 : 0) + (solid(vx - 1, vy) ? 1 : 0) + (solid(vx, vy) ? 1 : 0), i = vy * W1 + vx;
    used[i] = k > 0 ? 1 : 0; edge[i] = k > 0 && k < 4 ? 1 : 0;
  }
  // distance from the silhouette over the vertices (two-pass chamfer)
  const dist = new Float32Array(nv).fill(1e9);
  for (let i = 0; i < nv; i++) if (!used[i] || edge[i]) dist[i] = 0;
  const relax = (i, j, d) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
  for (let vy = 0; vy < H1; vy++) for (let vx = 0; vx < W1; vx++) { const i = vy * W1 + vx; if (vx > 0) relax(i, i - 1, 1); if (vy > 0) { relax(i, i - W1, 1); if (vx > 0) relax(i, i - W1 - 1, 1.41); if (vx < W1 - 1) relax(i, i - W1 + 1, 1.41); } }
  for (let vy = H1 - 1; vy >= 0; vy--) for (let vx = W1 - 1; vx >= 0; vx--) { const i = vy * W1 + vx; if (vx < W1 - 1) relax(i, i + 1, 1); if (vy < H1 - 1) { relax(i, i + W1, 1); if (vx < W1 - 1) relax(i, i + W1 + 1, 1.41); if (vx > 0) relax(i, i + W1 - 1, 1.41); } }
  const zmin = T * 0.1;
  let z = new Float32Array(nv);
  for (let i = 0; i < nv; i++) if (used[i]) { const u = Math.min(dist[i], R) / R; z[i] = zmin + (T - zmin) * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); }
  for (let pass = 0; pass < 2; pass++) {                         // soften the ridges the distance field leaves (the rim stays thin)
    const o = new Float32Array(z);
    for (let vy = 1; vy < H1 - 1; vy++) for (let vx = 1; vx < W1 - 1; vx++) {
      const i = vy * W1 + vx; if (!used[i] || edge[i]) continue;
      let s = z[i] * 4, n = 4; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const j = i + dy * W1 + dx; if (used[j]) { const wgt = dx && dy ? 1 : 2; s += z[j] * wgt; n += wgt; } }
      o[i] = s / n;
    }
    z = o;
  }
  // vertex normals (front) from the height gradient; y is up in the mesh, rows run down
  const zAt = (vx, vy, d) => { const j = Math.max(0, Math.min(H1 - 1, vy)) * W1 + Math.max(0, Math.min(W1 - 1, vx)); return used[j] ? z[j] : d; };
  const shade = new Float32Array(nv);
  for (let vy = 0; vy < H1; vy++) for (let vx = 0; vx < W1; vx++) {
    const i = vy * W1 + vx; if (!used[i]) continue; const c = z[i];
    const gx = (zAt(vx + 1, vy, c) - zAt(vx - 1, vy, c)) / 2, gy = -(zAt(vx, vy + 1, c) - zAt(vx, vy - 1, c)) / 2, l = Math.hypot(gx, gy, 1);
    shade[i] = shadeOf(-gx / l, -gy / l, 1 / l);
  }
  let npx = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) npx++;
  const pos = new Float32Array(npx * 12 * 9), col = new Float32Array(npx * 12 * 9), BACK = [0.40, 0.44, 0.55]; let n = 0;   // at most 4 + 8 triangles per pixel
  const tri = (a, b, c, rgb, ks) => { for (let q = 0; q < 3; q++) { const p = q === 0 ? a : q === 1 ? b : c, k = ks[q]; pos[n] = p[0]; pos[n + 1] = p[1]; pos[n + 2] = p[2]; col[n] = rgb[0] * k; col[n + 1] = rgb[1] * k; col[n + 2] = rgb[2] * k; n += 3; } };
  const vtx = (vx, vy, s) => [vx - w / 2, h - vy, s * z[vy * W1 + vx]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y)) continue;
    const o = (y * w + x) * 4, c = [rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255];
    const iA = y * W1 + x, iB = iA + 1, iC = iA + W1 + 1, iD = iA + W1;
    tri(vtx(x, y, 1), vtx(x + 1, y, 1), vtx(x + 1, y + 1, 1), c, [shade[iA], shade[iB], shade[iC]]);                 // front: the pixel's exact colour, shaded softly
    tri(vtx(x, y, 1), vtx(x + 1, y + 1, 1), vtx(x, y + 1, 1), c, [shade[iA], shade[iC], shade[iD]]);
    const bc = [c[0] * 0.62 + BACK[0] * 0.38, c[1] * 0.62 + BACK[1] * 0.38, c[2] * 0.62 + BACK[2] * 0.38];            // back: darker, slightly cooler
    tri(vtx(x + 1, y, -1), vtx(x, y, -1), vtx(x, y + 1, -1), bc, [shade[iB] * 0.72, shade[iA] * 0.72, shade[iD] * 0.72]);
    tri(vtx(x + 1, y, -1), vtx(x, y + 1, -1), vtx(x + 1, y + 1, -1), bc, [shade[iB] * 0.72, shade[iD] * 0.72, shade[iC] * 0.72]);
    // the outline wall where the neighbour is empty (top, bottom, left, right): front edge to back edge
    const wall = (p, q, k) => { const a = vtx(p[0], p[1], 1), b = vtx(q[0], q[1], 1), a2 = vtx(p[0], p[1], -1), b2 = vtx(q[0], q[1], -1); tri(a, b, b2, c, [k, k, k]); tri(a, b2, a2, c, [k, k, k]); };
    if (!solid(x, y - 1)) wall([x, y], [x + 1, y], 0.92);
    if (!solid(x, y + 1)) wall([x + 1, y + 1], [x, y + 1], 0.55);
    if (!solid(x - 1, y)) wall([x, y + 1], [x, y], 0.74);
    if (!solid(x + 1, y)) wall([x + 1, y], [x + 1, y + 1], 0.74);
  }
  return { pos: pos.slice(0, n), col: col.slice(0, n) };
}

export const VOX_STYLES = ["blocky", "rounded"];
// the HUD button: "VOX: Blocky / Rounded" (remembered; default Rounded). voxel.rounded is read by Voxel3D.objectMesh.
export function attachVoxStyle(voxel, hud) {
  let m = null; try { m = new URLSearchParams(location.search).get("voxstyle"); } catch (e) { /* no location */ }
  if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
  voxel.rounded = m !== "blocky";
  if (!hud) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "voxstylebtn"; b.title = "VOX view: characters as blocky cubes, or as rounded solid figures (smooth thickness, soft shading, darker back)";
  const show = () => { b.textContent = "VOX: " + (voxel.rounded ? "Rounded" : "Blocky"); b.classList.toggle("on", voxel.rounded); };
  voxel.setRounded = on => { voxel.rounded = !!on; try { localStorage.setItem(KEY, voxel.rounded ? "rounded" : "blocky"); } catch (e) { /* private mode */ } voxel.actorMem = null; voxel.lastBody = null; show(); };
  b.addEventListener("pointerdown", () => voxel.setRounded(!voxel.rounded));
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show();
  return b;
}
