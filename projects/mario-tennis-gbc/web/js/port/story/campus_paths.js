// THE CAMPUS's walkable paths (P.campusPaths: full.js sets it with the 3D view on and CROSSING Instant; a recording keeps it as events, so a
// replay runs the same): in the areas behind the café road (the dorm front, the senior courts, the practice courts) the path from the
// road's street (web/js/campus.js) is walkable beyond the area's map, the area's own exit to the road at its bottom is passed by, and the
// path's road end is the exit to the road (story_loop.js QUICK_CROSSINGS puts you on the road where you are; the road's streets hand you
// to the area the same way, at the path's road end: restaurant_13.js). The camera follows you out along the path (it stops at the map's
// edge otherwise: scene_tileanim.js, actor_ops.js). Nothing of this runs with P.campusPaths off.
import { areaPath, onPath } from "../../campus.js";

const cache = new Map();
export const CAMERA_REACH = 96;                        // tiles the camera may go past the map's size while the paths are on
// the current map's path (in its own px), when the paths are on and the map is one of the areas; else null
export function campusArea(P) {
  if (!P.campusPaths) return null;
  const m = P.bus.u8(0xC32E);                          // wCurMapID
  if (!cache.has(m)) cache.set(m, areaPath(m));
  return cache.get(m);
}
// the collision at a point (1/256 tile): false: walkable (on the path), true: blocked (beyond the map, off the path), null: the map's own
export function pathCollision(P, x, y) {
  const A = campusArea(P); if (!A) return null;
  const px = x / 32, py = y / 32;
  if (onPath(A, px, py, 8)) return false;              // (the kerbs too, and a little more: the walk probes ahead and to each side)
  if (px >= P.V.mapWidthTiles * 8 || py >= P.V.mapHeightTiles * 8) return true;
  return null;
}
// a step onto (xTile, yTile): "road" at the path's road end (the exit to the road asked for), "skip" for the area's own exit to the road
// (passed by), null otherwise
export function pathTrigger(P, xTile, yTile, kind, id, BEHAVIOR_EXIT) {
  const A = campusArea(P); if (!A) return null;
  if (yTile * 8 >= A.gate[1] - 2 && onPath(A, xTile * 8 + 4, yTile * 8 + 4, 4)) return "road";
  if (kind === BEHAVIOR_EXIT && id === A.exit) return "skip";
  return null;
}
// a crossing along a path (paths on; this map, the location and entry it leads to): story_loop.js PATH_CROSSINGS (its exit script, a
// walk-off, is passed by: scene_triggers.js runLocationExit)
export const PATH_CROSSINGS = [[19, 9, 1, 470, 300], [19, 16, 1, 96, 360], [19, 11, 1, 40, 720], [19, 12, 1, 40, 720],
  [27, 8, 1, -470, -300], [23, 8, 3, -96, -360], [24, 8, 5, -40, -720]];
export function pathCrossing(P, loc, entry) {
  if (!P.campusPaths || !P.quickCross) return null;
  const m = P.bus.u8(0xC32E);
  return PATH_CROSSINGS.find(([a, l, e]) => a === m && l === loc && e === entry) || null;
}
