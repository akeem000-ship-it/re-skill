// Overworld objects that stand up in the 3D overworld (field3d.js), per map graphics id (wMapGfx $C32E: MapGfxTable 0B:4048), in map
// pixels (the 64 x 64-tile map is 512 x 512 px). Adapted from Mario Tennis's field_objects.js: the game has no object data (buildings and
// trees are tiles painted into the map; its collision grid, WRAM6 $D000, only says where the player can walk), so these are hand
// annotations, checked with tools/field_objects_preview.py. Keep the object literal JSON-compatible: the preview tool parses it.
//  blocks: a building part as a solid box: rows y0..fold of the picture are its roof (the top face, stretched over the footprint
//          y0..y1), rows fold..y1 its front wall, standing on the ground line y1 (the wall as tall as those rows)
//  stamps: an example rectangle of trees / bushes / rocks (multiples of 8): every map tile with the number and attribute of one of its
//          tiles (plain one-colour tiles left out) is part of a plant; each 16 x 16 group stands up as a rounded voxel body;
//          plant: "tree" (taller) | "bush" | "rock"
//  cards:  single upright cut-outs (signs, posts, statues)
//  walls:  false: no boxes from the collision grid (the default stands every blocked 16 x 16 cell up as a low box)
//  wallH:  the height of those boxes (default 10)
//  sky:    true: an outdoor map (the sky's colour behind, the field life's birds)
export const FIELD_OBJECTS = {
 "20": {
  "sky": true,
  "walls": false,
  "stamps": [
   {"x": 128, "y": 224, "w": 64, "h": 32, "plant": "tree"},
   {"x": 240, "y": 192, "w": 16, "h": 32, "plant": "tree"},
   {"x": 224, "y": 256, "w": 96, "h": 48, "plant": "rock"}
  ]
 },
 "0": {
  "wallH": 14
 },
 "1": {
  "wallH": 14
 },
 "2": {
  "wallH": 14
 }
};
