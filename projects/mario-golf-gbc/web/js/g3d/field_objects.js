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
//  mounds: OVERWORLD TREES: rectangles whose hills and rocks (their orange, brown and purple pixels) rise as low solids (field3d.js
//          buildMounds; the "rock" stamps are left out then)
//  mown:   rectangles of lawn mown in stripes (ground.js; at most 4: round the club houses)
//  walls:  false: no boxes from the collision grid (the default stands every blocked 16 x 16 cell up as a low box)
//  wallH:  the height of those boxes (default 10)
//  sky:    true: an outdoor map (the sky's colour behind, the field life's birds)
//  trees:  OVERWORLD TREES (fieldtrees.js): the trees' tiles, by key (tile number | (attribute & $6F) << 8: tools/map_tiles_sheet.py
//          --where shows them on the map): {"pal": the BG palettes they are in (the lawn is their plain tiles' commonest colour),
//          "broad": the broadleaf trees' tiles (16 x 16 trees, overlapping in the woods), "narrow": [{"kind": "palm" | "cactus" |
//          "cypress", "top", "foot": the tiles of an 8 x 16 plant, "size": its width / 8 (default 1.25)}]}
export const FIELD_OBJECTS = {
 "20": {
  "sky": true,
  "walls": false,
  "blocks": [
   {"x0": 32, "y0": 176, "x1": 48, "y1": 192, "fold": 184},
   {"x0": 224, "y0": 144, "x1": 240, "y1": 160, "fold": 152},
   {"x0": 32, "y0": 336, "x1": 48, "y1": 352, "fold": 344},
   {"x0": 256, "y0": 336, "x1": 272, "y1": 352, "fold": 344}
  ],
  "trees": {"pal": [6], "broad": [3590, 3591, 3592, 3593, 3594, 3595, 3606, 3607, 3608, 3609, 3610, 3611], "narrow": [
   {"kind": "palm", "top": 3585, "foot": 3601, "size": 1.6},
   {"kind": "cactus", "top": 3586, "foot": 3602},
   {"kind": "cypress", "top": 3587, "foot": 3603},
   {"kind": "cypress", "top": 3584, "foot": 3600}
  ]},
  "stamps": [
   {"x": 128, "y": 224, "w": 64, "h": 32, "plant": "tree"},
   {"x": 240, "y": 192, "w": 16, "h": 32, "plant": "tree"},
   {"x": 224, "y": 256, "w": 96, "h": 48, "plant": "rock"}
  ],
  "cards": [
   {"x": 64, "y": 208, "w": 16, "h": 16},
   {"x": 128, "y": 192, "w": 16, "h": 16},
   {"x": 16, "y": 208, "w": 16, "h": 16},
   {"x": 208, "y": 176, "w": 16, "h": 16},
   {"x": 208, "y": 288, "w": 16, "h": 16},
   {"x": 272, "y": 368, "w": 16, "h": 16}
  ],
  "mounds": [
   {"x": 0, "y": 128, "w": 16, "h": 104},
   {"x": 0, "y": 328, "w": 16, "h": 72},
   {"x": 0, "y": 384, "w": 320, "h": 16},
   {"x": 176, "y": 256, "w": 144, "h": 144},
   {"x": 160, "y": 272, "w": 16, "h": 128}
  ],
  "mown": [
   {"x": 8, "y": 152, "w": 64, "h": 56},
   {"x": 200, "y": 120, "w": 64, "h": 56},
   {"x": 8, "y": 312, "w": 64, "h": 56},
   {"x": 232, "y": 312, "w": 64, "h": 56}
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
