# The play page's 3D layers (web/js/g3d)

Render-only options over the native game on `web/play.html` (the panel "3D layers" under the mode selector; notes in
`web/whatsnew3d.md`). Off (the default) the page shows exactly the 2D picture it always did. On, a WebGL2 canvas lies over the
game's screen (wherever the page's layout puts `#screen`) and draws the hole in 3D with the game's HUD on top; on screens the 3D
view does not know (menus, the scorecard) the canvas is hidden or clear and the 2D picture shows. Adapted from Mario Tennis's
`web/js` modules (voxel.js, voxround.js, skybox.js, lighting.js, courtfloor.js, courtwear.js, ballfx.js, ambience.js, replay.js,
closecall.js, matchfx.js / bigmoments.js, stadium3d / crowdfans / courtside, titleshow.js, field3d.js, field_objects.js, ground.js,
shimmer.js, fieldlife.js); nothing from the ROM is stored in the source: every map, tile, sprite and colour is read from the user's
ROM or the game's memory at run time.

## Rule: read only

Every layer reads the game's memory (`GolfMemory`: WRAM, HRAM, the display model) and never writes it. Two hooks in the engine
tell the layers things without changing anything: `display.js setOamHook` (each shadow OAM slot written, with the hROMBank of the
code that queued it: the HUD's bank 12, the ball display's bank 11, the actors' bank 04, the behind view's bank 15) and the page's
`play.js` calls (`afterStep(game)` after each game frame, `present(game, rgba)` once per drawn frame).
`web/tests/g3d_layers_same.mjs` plays the same scripted game with every layer off and on (a Stroke round, power-on through the
title and the menus, and the story mode from a saved character) and compares a hash of the whole state (WRAM, HRAM, save RAM,
VRAM, OAM, palettes, LCD registers) after every frame; it fails on the first difference (checked: a layer made to flip one WRAM
byte fails it at frame 1).

## What the 3D view reads

| What | From |
|------|------|
| the hole being played | wHoleId `$D320`; its maps from HoleAssetTable 13:4A16 (js/golf/ball.js `Hole`): tile map, attributes, tiles, palettes (ref 0 entries 0/1), terrain per 4 x 4 cell (TerrainAt 10:6536), slope cells (SlopeCellAt 10:674E), the tile byte (`$D700`: green slope, bit 7 tree) |
| the green's picture | the putting view's maps (refs 2/3), painted with the live palettes once the game shows view 1 |
| the ball | `$D400-$D408` (x, y 8.16; height 8.16), velocity `$D409/$D40B/$D40D`, in the air `$D415`, curve `$D40F`, spin `$D411` |
| the view | wOnGreen `$D443` (0 course, 1 green, 2 cup, 4 behind the golfer); the course camera's scroll `$C320/$C322`; the green's corner `$D441/$D442` |
| the aim, the club, the swing | `$D418` (16-bit angle from +x toward +y), `$D329`, the shot mode `$D32A`, the meter count `$D44E` |
| the golfer | `$D332` (golfer id), `$D333` (left-handed), its big frames (list 11:6EEF, templates 11:6F0F), frame `$D467`, the OBJ palette RAM |
| the cup, par, strokes | `$D43D/$D43F`, `$D325`, the player record's `+$20` |
| the wind | wWindSpeed `$C815` (mph), wWindAngle `$C816` |
| the green's slope | the putting view's maps (refs 2/3): GreenSlopeAt 10:64D1 per green tile, as the ball's roll reads it (hole3d.js greenSlopes) |
| the course | `$C836` (the sky's theme, the hour) |
| the screen state | the frame task table `$C1C0` (BallDisplayTask 11:4113, BehindViewTask 15:47AD, TitlePressStartTask 40:4D1D, the actors 04:4B69, MapGfxScrollTask 0B:4784, the result confetti 0B:5DE1), the fade `$FFA2/$FFA4/$FFBC` |
| the overworld | wMapGfx `$C32E` (MapGfxTable 0B:4048: tile map, attributes, collision `$D000` 32 x 32 cells of 16 px with `$0F` blocked), the live VRAM1 tiles and palettes, the actors' sprites (bank 04 slots) |

World units: 1 = a pixel of the course view = 32 position units (a tile is 8 px = 256 units, about 8 yards), so a unit is about a
yard; heights in the same units (the ball's height / 32). The trees stand 24 units tall (TreeCheck 08:51D2's height levels).

## The layers

| Layer | Module | What it does |
|-------|--------|--------------|
| 3D view | scene.js, ball3d.js, hole3d.js, terrain3d.js, trees3d.js, camera3d.js, hud3d.js, sprites3d.js, voxround.js | the hole's course map as the ground; its tree tiles cut out and grown as trees (TREES, below); the golfer from his big frames as a rounded body (walks to the ball between shots); the pin with a flag in the wind (its flutter quicker in a harder wind) and the cup; the ball (BALL, below) at its true height with its shadow; the game's marks (target marker, preview spot, look cursor, the other ball) from their VRAM tiles; the HUD (window + non-world sprites) on top. Camera: Follow / Course / Behind / TV |
| Hills | terrain3d.js | cosmetic heights: a Poisson solve whose gradient follows the slope cells and the green's slope bytes, mounds in the woods, hollow bunkers, lowered water; the ball drawn at its height over this surface |
| Sky | skybox.js | the sky of the hour and a panorama per club (campus hills, tropics, desert, coast, castle) |
| Light | light3d.js | the hour (Auto by course, the clock, fixed), sun colour and direction, a shadow map, night floodlights and a pin lamp |
| Terrain | groundshader.js, terrain3d.js | surfaces by terrain type in the hole's own mean colours (stripes, blades in the wind, mowing check, ripples, moving water); GRASS and SAND below |
| Wear | wear.js | divots, pitch marks, bunker craters and footprints, kept for the hole |
| Ball FX | ballfx.js | trail by shot type, spin seam, landing burst, splash, cup sparkle |
| Ambience | ambience.js | leaves in the game's wind, mist over water, blown sand, motes, fireflies |
| Replay | replay.js | big shots again; the shot is re-run with the engine's own `Shot` on a copy of the memory taken in the launch frame (`$D438` becomes `$11`, `$D4D3` cleared, the ball not yet moved); `web/tests/g3d_replay_rerun.mjs` checks every re-run path and outcome against the live game and that the live memory is untouched |
| Close calls | closecall.js | lip-outs and balls just short of the water: an inset picture of the spot |
| Big moments | moments.js | hole in one / albatross / eagle (fireworks, the camera circling the green), birdies (a small burst), a won tournament (fireworks over the result screen) |
| Gallery | gallery.js, people.js | at tournament rounds people along the ropes (the game's map characters 04:4F1C, recoloured), reacting; a caddie in every mode |
| Title fly-over | titleshow.js | holes of each club flown over behind PRESS START, the title's logo, Mario and texts in front (the sky's palettes let through) |
| 3D overworld | field3d.js, field_objects.js, ground.js, shimmer.js | the story maps: blocked cells as boxes, annotated blocks and plants (tools/field_objects_preview.py), the people as rounded bodies |
| Field life | fieldlife.js | birds, butterflies, fireflies, motes; grass and dirt detail, water glint |

TREES (the panel's Trees: Courtyard, the default, or Original): the hole's tree tiles (bit 7 of the tile byte) are cut out of the
ground picture (terrain3d.js extractTrees) and stand where they are. **Courtyard** (trees3d.js) grows one tree per tree tile in the
design of Mario Tennis's courtyard and restaurant plaza (its stadium3d.js `egg()`): an egg-shaped crown of small leaf boxes rising to
a point, its waist low, pale yellow-green with white glints up the lit side, deep green below the waist and round the back, a dark
rim, on a trunk with an orange-soil base. The shape fits the course and the tile's picture: egg crowns for broadleaf trees, cypress
cones (deeper, cooler green) for narrow tiles and one tree in eight, low mounds for small tiles (bushes), palms on the Palm club (a
ringed trunk bending to one side, eight drooping fronds; Lite six) and cacti on the Dune club (ribbed rounded columns with one or
two arms and white spines). The colours are the hole's own tree pictures' (lightest, middle and darkest greens, a brown for the
trunks) and its bunkers' mean sand for the soil, each pulled toward the courtyard's; the size from the tile picture's extent, with
a little variety. Only the faces between a leaf box and an empty cell are drawn; three variants per kind and size are built per hole
and shared (built at run time, nothing from the ROM stored). The tree's front (its lit side) turns to the camera, as the courtyard's
face the Tennis camera; the bodies sway in the game's wind (`uSway` in the body and depth shaders: wind x / z `$C815/$C816`, a
per-tree phase, more for palms, none for cacti), and cast sun shadows through the shadow map. As a tree always faces the camera,
its picture mesh leaves out the faces the camera cannot see (the back, the sides turned away from its axis: about half), while the
shadow map draws them all (in boxes 2.4x Full's). Lite uses boxes 1.8x larger (about a third of the faces, so a Lite tree draws about
as many triangles as an old one); the trees far from the camera (70 units in Full, 45 in Lite, further when the view is zoomed in)
are drawn in bigger boxes (Full: Lite's; Lite: 2.8x Full's). **Original** keeps the old bodies: the tile pictures stood up and rounded by voxround.js, turned to the camera.

GRASS (the panel's Grass: Carpet, the default, or Pixel, the look before; under the Terrain layer). **Carpet** is Mario Tennis's
shell carpet turf (its ground.js VS_SHELL / FS_SHELL) on every grass area of the hole: the ground mesh, cut in chunks of 32 x 32 px,
is drawn again as shells above the soil (instanced; shell i at (i / N)^2 over it, N = 10 Full, 5 Lite) only on the chunks near the
eye (60 units Full, 32 Lite, further when zoomed in) and in front of it, fewer further off; in each chunk the grid's quads are kept
in groups by their tallest grass (their terrain types where the lawn is green: green, fairway / tee, semi-rough, rough / woods) and
each group is drawn only up to its grass (a green quad two or three shells, a fairway four, the rough all; sand, water and brown
ground none); a shell keeps the strands that reach it, thinning to their tips, and far away (a strand under a pixel) the strands
fade into the base colour. The ground's program is built per choice (#defines), so Pixel / Pixel runs the old shader unchanged,
and the shells have their own; the ground is drawn without blending. The colour is the
lawn's own without the game's dither (terrain3d.js cleanMap: the mean of each pixel's 5 x 5 neighbours of its terrain type).
Fairway and tee: a short even carpet mown in stripes along the hole (tee to cup; the strands lean with or against the mowing, so a
stripe's shade turns with the view); the fringe (fairway / semi-rough within 3 px of the green) a short collar; semi-rough a little
longer; rough and woods a long uneven carpet in patches with olive and straw strands and tall tufts; the green very short and fine
over the game's own green picture (the putting view's, with its slope chevrons, which stay visible through it; 36 strands a unit, so
the ball sits on fine grass in a close-up). The golfer parts
the grass round his feet. On the Carpet the ball sits on the short grass and down in the rough.

Reading the grass. The game's ball ignores the wind on the ground (Wind 10:52EE returns nothing at height 0), so on the green the
grass shows the **slope** instead, tile by tile exactly as the roll reads it (hole3d.js greenSlopes: GreenSlopeAt 10:64D1 on the
putting view's maps, the direction through SlopeDirTable 10:6516 with the tile's flips, the strength (v >> 4) & 3; one texel per
green tile of 2 x 2 course px, from the green's corner `$D441/$D442`): the strands lean downhill (the push's direction), more the
stronger the slope, with a slow wave along it; the base is combed into short blades along the slope in rows, each dark at its
uphill root and light at its downhill tip (so a still picture shows which way is down), a sheen turns with the view (lighter
looking down the grain) and a bright band travels slowly downhill, faster and stronger on steeper tiles; flat tiles stand upright
and still. (The game's greens often draw one even slope as tiles of strength 3, 2, 1 and flat in turn, as its chevrons do; the
grain shows them tile by tile as the ball feels them.) Only a light wind sway stays on top. Checked: out/scratch/looks/slopecheck.mjs compares the grain's data with the
engine's own slope() (js/golf/ball.js) at every quarter pixel of all 107 greens (no mismatch), and breakcheck.mjs compares the sideways
change of the ball's velocity in real putts with the grain's lean under it. Off the green the grass sways in the game's **wind**
(`$C815` mph, `$C816` direction, as the HUD shows them): the strands bend along the wind, more (and faster) the more mph, a gust
of shade runs across the grass in the wind's direction, the flag flutters quicker and the trees sway further.

SAND (the panel's Sand: Fine, the default, or Pixel, the look before). **Fine**: the bunkers (terrain type 2) in pale fine sand with
soft wind ripples, raked lines across the hole and now and then a line of footprints; their outline rounded (terrain3d.js
sandMasks: the bunker cells blurred, the edge at half) with a crisp jagged grass lip in the greenest grass colour of the hole, a
shaded inner edge, and with HILLS a rounded hollow and a slightly raised lip. The game plays two terrain types as bunkers: 2 and
`$0D` (10:5068 lands both as sand, their TerrainPropTable 10:6825 rows are the same, the lie code 10:60F7 / 10:667A treats both
alike). Only the Dune Club uses `$0D`: it is the brown sandy waste painted round its fairways, not the pale bunkers (type 2). So
Fine draws type 2 as bunkers and `$0D` as the desert's sand with the club's brown out-of-bounds and rough: pale wind-rippled sand
level with the ground (no hollow, no lip), low soft dunes (HILLS) and a pale panorama of dunes and far mesas in a white haze (SKY).
Pixel keeps the hollows under both types.

BALL (ball3d.js): a golf ball at a golf ball's size next to the golfer (who is drawn 4.2 tall: a ball 0.052 across, a cup 0.26), but
never less than about 0.35% of the picture's height across its radius so it can be followed far off, with a thin dark outline
while it is small on screen (a slightly wider sphere drawn first without depth). Full: ~330 dimples from a cube map made at run
time (the normal tilts into each dent, a little darker inside, faded out while the ball is a few pixels), wrapped light, a specular
highlight from the sun, the shadow map, a brighter rim; Lite: no dimple map and fewer triangles. A printed line and mark turn with
the ball: rolling, from the distance it covered about the axis across its way; in the air, on the game's spin `$D411` (positive:
backspin) about the axis across its flight and on its curve `$D40F` about the vertical. A soft contact shadow under it at rest and
rolling, the dark spot growing and fading as it rises (and the sun's shadow); a dark cup with a pale rim at the pin, the ball
dropping into it. Ball FX's seam ring follows the ball's drawn size.

Quality: Full (multisampled, a 4 px ground grid, a 1024 shadow map with 9 taps) or Lite (no multisampling, an 8 px grid, a 512
shadow map with one tap, 60% resolution, fewer particles and people). The canvas's resolution also comes down by itself while the
pictures come slower than about 40 a second and goes back up when there is room.

Measured in headless Chromium with SwiftShader (CPU rendering; a GPU is much faster): Lite about 19 pictures a second with the game
at 59 frames a second; Full about 9 pictures a second at a reduced resolution (the game at about 36 frames a second, as the page
runs at most four game frames per drawn frame).
