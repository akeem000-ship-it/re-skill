// THE CAMPUS's walkable paths (3D view, CROSSING Instant: port P.campusPaths). The areas you reach through the café road's streets lie
// behind the road in the 3D view (field_objects campus.at: each map's top left in the road's map px), each with a path from its street:
// the dorm front (map 27) up the west street, the senior courts (23) behind the café, the practice courts (24) up the east street and
// round behind the senior courts. A path belongs to its area: walking up a street hands you to the area at once, standing at the path's
// road end (outside the area's map), and you walk the path into it; walking back down the path to its road end hands you to the road.
// Shared by the port (port/story/campus_paths.js: where you can walk, the crossings) and the 3D view (voxel.js: the paths drawn).
//   map: the area; exit: its exit to the road (the exit cells at its bottom are passed by while the paths are on); gate: the road's
//   street (x) and the row you arrive on, below the street's trigger cells (y); pts: the path from the road (map px of the road).
export const PATH_W = 26;                                  // a path's width (px), its kerbs either side
export const CAMPUS_PATHS = [
  { map: 27, exit: 3, gate: [56, 98], pts: [[56, 98], [56, -12], [-294, -12], [-294, -46]] },
  { map: 23, exit: 1, gate: [296, 98], pts: [[296, 98], [296, -12], [248, -12], [248, -42]] },
  { map: 24, exit: 1, gate: [440, 98], pts: [[440, 98], [440, -412], [112, -412], [112, -466]] },
  { map: null, pts: [[-150, 112], [-330, 112], [-330, -12], [-294, -12]] },     // (the café terrace's path: scenery)
];
// where each area lies (its top left, road map px): the same as field_objects campus.at
export const CAMPUS_AT = { 19: [0, 0], 20: [118, 40], 30: [408, -336], 23: [-96, -360], 27: [-470, -300], 24: [-40, -720] };
// the path of an area, in that area's own map px
export function areaPath(map) {
  const p = CAMPUS_PATHS.find(q => q.map === map), at = CAMPUS_AT[map]; if (!p || !at) return null;
  const sh = ([x, y]) => [x - at[0], y - at[1]];
  return { ...p, pts: p.pts.map(sh), gate: sh(p.gate) };
}
// is (x, y) (px) on the path (within half its width of a segment)?
export function onPath(path, x, y, pad = 0) {
  const r = PATH_W / 2 + pad;
  for (let i = 1; i < path.pts.length; i++) {
    const [ax, ay] = path.pts[i - 1], [bx, by] = path.pts[i];
    if (x >= Math.min(ax, bx) - r && x <= Math.max(ax, bx) + r && y >= Math.min(ay, by) - r && y <= Math.max(ay, by) + r) return true;
  }
  return false;
}
