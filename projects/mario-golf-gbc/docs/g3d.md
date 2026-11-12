# The play page's 3D layers (web/js/g3d)

Render-only options over the native game on `web/play.html` (OPTIONS > 3D view, Effects and Story, see "The OPTIONS screen" below;
notes in `web/whatsnew3d.md`, OPTIONS > About). Off (the default) the page shows exactly the 2D picture it always did. On, a WebGL2 canvas lies over the
game's screen (wherever the page's layout puts `#screen`) and draws the hole in 3D with the game's HUD on top; on screens the 3D
view does not know (menus, the scorecard) the canvas is hidden or clear and the 2D picture shows. Adapted from Mario Tennis's
`web/js` modules (voxel.js, voxround.js, skybox.js, lighting.js, courtfloor.js, courtwear.js, ballfx.js, ambience.js, replay.js,
closecall.js, matchfx.js / bigmoments.js, stadium3d / crowdfans / courtside, titleshow.js, field3d.js, field_objects.js, ground.js,
shimmer.js, fieldlife.js); nothing from the ROM is stored in the source: every map, tile, sprite and colour is read from the user's
ROM or the game's memory at run time.

## The OPTIONS screen (web/js/hd/options.js)

Every setting of the play page is on one screen, in categories, as Mario Tennis's OPTIONS (its `menuwheel.js` OPTION_CATS):
the categories down the left (a narrow screen, such as the Fold's cover screen: a 4 x 2 grid of tabs on top), one category's
settings at a time on a white panel with a gold edge, each row the setting's name and its value on a pill (an On / Off switch for
the 3D layers), the row under the pad gold and its help at the bottom. It opens from the button bar's OPTIONS (touch screens: the
gear, or Back in the Android apps, Mario Golf's own and MTenn3D, whose user agent says `MarioTennisWrapper MarioGolfWrapper`),
from the OPTIONS button under the picture (a computer) or the O key; BACK, Escape, START or Back close it. The game runs on behind it
(as it did with the old panels); while it is open the keys and a controller drive the screen and the game gets none of them:
▲ ▼ (◀ ▶) a category, A opens it; ▲ ▼ a setting, A or ▶ the next value, ◀ the one before; B back to the categories, B again closes.
The last category shown is remembered (`mg-optcat`).

| Category | Settings (storage key / URL parameter) |
| --- | --- |
| PLAY | Start (the mode selector `#mode`; changing it starts again), Rec (REC, as on the button bar: play.js), Course and Hole of the Stroke start (`?course=` `?hole=`), Meter (`mg-meter`), Preview (`mg-preview`), Markers (`mg-marks`), Tap area (`mg-tap`, touch), Putting (mg3d.putting, `?g3dputt`) |
| PICTURE | View (`mg-view`), Text (`mg-font`), Menus (`mg-ui`), Deck (`mg-deck`, touch), Quality (mg3d.quality, `?g3dq`), Picture (save a picture) |
| 3D VIEW | 3D view, Camera (`?g3dcam`), Hour (`?g3dhour`), Light, Sky, Hills, Trees (`?g3dtrees`), Grass (`?g3dgrass`), Sand (`?g3dsand`), Green (`?g3dgreen`), Terrain, Wear; the 3D view's status line (all in "mg3d", `?g3d=`) |
| EFFECTS | Ball FX, Ambience, Replay, Close calls, Big moments, Gallery, Title fly-over ("mg3d") |
| STORY | 3D overworld, Overworld trees, Field life ("mg3d") |
| CONTROLS | Touch: Stick / D-pad (`mg-pad`, `?pad`; touch), Vibrate (`mg-vibrate`; touch), the keys and controllers |
| SOUND | Sound On / Off (the M key; not kept, as before) |
| ABOUT | the page's notes and What's new in 3D, folded |

The rows are the page's own controls, made as before by view.js, portrait.js, aimpower.js, page.js and g3d/layers.js (same ids, same
handlers, same keys and URL parameters): the screen moves them into its rows and restyles them, so settings saved by an older page
keep working, and the old rows under the picture (`#modes`, `#hdopts`, `#layers3d`, the notes) are gone from the page.
`web/tests/options_panel.mjs` opens it from the bar inside the app on the cover screen, changes one setting in each category and
checks it took effect, was stored under its key and is still there after a reload; then an older page's stored settings and the URL
parameters, and the keys on a computer. `--shots`: every category on the cover screen, the inner screen both ways and a computer,
in the app and standalone (out/options/).

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
| the overworld | wMapGfx `$C32E` (MapGfxTable 0B:4048: collision `$D000` 32 x 32 cells of 16 px with `$0F` blocked, the event grid), the live map buffers (WRAM3 / WRAM2 `$D000`: the 64 x 64 tile map and attributes, as the map scripts edit them), the live VRAM tiles, BG map and palettes, the actors' sprites (bank 04 slots) |

World units: 1 = a pixel of the course view = 32 position units (a tile is 8 px = 256 units, about 8 yards), so a unit is about a
yard; heights in the same units (the ball's height / 32). The trees stand 24 units tall (TreeCheck 08:51D2's height levels).

## The layers

| Layer | Module | What it does |
|-------|--------|--------------|
| 3D view | scene.js, ball3d.js, hole3d.js, terrain3d.js, trees3d.js, camera3d.js, hud3d.js, sprites3d.js, voxround.js | the hole's course map as the ground; its tree tiles cut out and grown as trees (TREES, below); the golfer from his big frames as a rounded body (walks to the ball between shots); the pin with a flag in the wind (its flutter quicker in a harder wind) and the cup; the ball (BALL, below) at its true height with its shadow; the game's marks (target marker, preview spot, look cursor, the other ball) from their VRAM tiles; the HUD (window + non-world sprites) on top. Camera: Follow / Course / Behind / TV |
| Hills | terrain3d.js | cosmetic heights: a Poisson solve whose gradient follows the slope cells and the green's slope bytes, mounds in the woods, hollow bunkers, lowered water; the ball drawn at its height over this surface |
| Sky | skybox.js | the sky of the hour and a panorama per club (campus hills, tropics, desert, coast, castle) |
| Light | light3d.js | the hour (Auto by course, the clock, fixed), sun colour and direction, a shadow map, night floodlights and a pin lamp (LIGHT, below) |
| Terrain | groundshader.js, terrain3d.js | surfaces by terrain type in the hole's own mean colours (stripes, blades in the wind, mowing check, ripples, moving water); GRASS and SAND below |
| Wear | wear.js | divots, pitch marks, bunker craters and footprints, kept for the hole |
| Ball FX | ballfx.js | trail by shot type, spin seam, landing burst, splash, cup sparkle |
| Ambience | ambience.js | leaves in the game's wind, mist over water, blown sand, motes, fireflies |
| Replay | replay.js | big shots again; the shot is re-run with the engine's own `Shot` on a copy of the memory taken in the launch frame (`$D438` becomes `$11`, `$D4D3` cleared, the ball not yet moved); `web/tests/g3d_replay_rerun.mjs` checks every re-run path and outcome against the live game and that the live memory is untouched |
| Close calls | closecall.js | lip-outs and balls just short of the water: an inset picture of the spot |
| Big moments | moments.js | hole in one / albatross / eagle (fireworks, the camera circling the green), birdies (a small burst), a won tournament (fireworks over the result screen) |
| Gallery | gallery.js, people.js | at tournament rounds people along the ropes (the game's map characters 04:4F1C, recoloured), reacting; a caddie in every mode |
| Title fly-over | titleshow.js | holes of each club flown over behind PRESS START, the title's logo, Mario and texts in front (the sky's palettes let through) |
| 3D overworld | field3d.js, field_objects.js, ground.js, shimmer.js | the story maps: blocked cells as boxes, annotated blocks and plants (tools/field_objects_preview.py), the people as rounded bodies standing on their feet, the game's own picture of everything over the map (OVERWORLD, below) |
| Overworld trees | fieldtrees.js, field_objects.js (trees), trees3d.js | the trees painted in the story maps' tiles lifted off the ground as the hole view's Courtyard trees, lawn under them, their shadows on the ground (OVERWORLD TREES, below) |
| Field life | fieldlife.js | birds, butterflies, fireflies, motes; grass and dirt detail, water glint |

OVERWORLD (field3d.js; web/tests/story3d.mjs). The map is the game's live map buffers (WRAM3 tiles, WRAM2 attributes; rebuilt when
a map script edits them) painted with the live tiles and palettes (repainted when they change, a fade's end included, the plants
too). Over it, as the game draws it, goes everything the map does not explain: the window layer, the sprites that are not stood up,
and the BG cells on screen whose tile or attributes (bits 0-3, 5, 6) differ from the map's at the scroll (`$C320 / $C322` / 32):
bank 05 draws its message boxes, menus, name plates and portraits into the BG over the map (its WRAM5 shadow), not into the window
(hud3d.js raster's `bgCells`). The people: the actors' sprites (bank 04 slots), a run of consecutive slots whose sprites touch (side
by side, or one above the other; at most 16 x 32) is one figure, painted with its flips and OBJ palette and stood up as a rounded
body at the game's size, the front of its feet on the sprite's bottom line, leaning back 0.32 rad towards the camera (which looks
down at about 45 degrees; upright a person shows at 0.7 of its height). No low box hides a person (in the game a sprite is over
the BG; an actor may stand in a blocked cell, behind a counter): the depth is cleared before the people and only the tall scenery is
put back into it (depth only: the annotated plants of kind "tree" and the building blocks' roofs and front walls), and each person is
drawn scaled about the eye by 1 - 7 / its distance (the same picture, 7 units nearer), so a person at a tree's foot or a door is not
cut by it. Where the trees or a building are really in front, the person's hidden parts show as a dark blue see-through silhouette
(the person drawn first with the depth test reversed and the colour pulled toward blue in a fine two-tone checker), the rest as
before; a person is never lost. Left to the 2D picture (render() false):
a map that is only a picture (no blocked cell, no event, no annotation: the new character's room `$1E`, gfx `$1E`), a screen
whose BG cells are more than 55% not the map's (the name entry, the encyclopedia, the navigation menu, the EXP screen), and a
fade (`$FFA2/$FFA4/$FFBC`). The plain round the map lies 3 units under it and the near plane is 12 (a 16-bit depth buffer let the
plain through the floor at some scrolls: the "black floor"). story3d.mjs plays the new character and a continue in 3D and checks
on sampled frames that the game's picture over the map is in the 3D picture (90% of its pixels) and that the people's pixels (the
3D picture against one drawn without them, over the square of the view's scale) are at least 0.7 of the game's.

OVERWORLD TREES (fieldtrees.js; the STORY tab's Overworld trees, on by default; the Field, gfx `$14`). As Mario Tennis's overworld
stands its plants up (voxel.js, cut out of the map's picture), the trees the game paints into the map's tiles are lifted off the
ground. They are found by their tiles: field_objects.js `trees` lists, as a hand annotation (tile keys, `tile | (attr & $6F) << 8`;
`tools/map_tiles_sheet.py GFX OUT --pal 6 --where x0,y0,x1,y1` labels them on the map), the broadleaf trees' tiles (`$06-$0B`,
`$16-$1B` of VRAM bank 1, palette 6: 16 x 16 trees, overlapping in the woods) and the narrow plants' top and foot tiles (palms
`$01/$11`, cacti `$02/$12`, poplars `$03/$13` and `$00/$10`: 8 x 16 pictures). A plant's pixels are its tiles' pixels that are not
the lawn's colour (the commonest colour of the plain tiles of the plant palette, `trees.pal`; colours, not palette entries). A
narrow plant stands on each foot tile at its pixels' middle; a broadleaf over each trunk (8-connected brown pixels, joined across a
row of shade), taking the crown pixels round and above it, and where the tree in front hides the trunk one per 16 x 16 cell whose
crown pixels are 90 or more. The tufts stay painted. All of it is done once the palettes are the map's own (not in a fade: a black
fade would make every tile one colour), and again for the colours when the palettes change outside a fade. Every lifted pixel is
painted (field3d.js paint) with the lawn's palette entry, so the ground under the trees is lawn in the live palettes; the old
"tree" stamps are left out. The trees are trees3d.js shapes (egg crowns, cypress cones, palms, cacti) at 0.74 of the hole's size
(a crown ~16 px across, as the game's), in bigger boxes (x2, Lite x2 of Lite's), as indexed quads and without the far meshes, in colours from the
lifted pixels (the courtyard palette pulled halfway to the map's lightest and darkest tree greens; the cacti a deeper green), drawn with the scene's lit body
program (turned to the camera, the sway of a light wind), the ones in the view's frustum, nearest first. Their shadows on the ground
are baked into a 512 x 512 texture (a soft blot per tree cast away from the sun, a contact spot at the foot; redone when the sun
moves; by day, outdoors) that the overworld's ground shader darkens toward a cool shade (a shadow map's depth pass over ~100 trees
cost more than the trees). The people: the trees near a person go into the people's depth pass, so a person behind a tree is hidden
by it and shows the silhouette; the trees in front of the player (the person nearest the view's centre: within the crown's reach in
front, across its width) are dithered see-through (uSee up to 0.82, eased over ~0.2 s) and left out of that pass, as in the hole view.
With the trees (same option): the signposts (field_objects.js `cards`: the sign and arrow boards, by tile, as the stamps) stand up
and are cut out of the ground (their pixels that are not green painted with the lawn); the hills and boulders in field_objects.js
`mounds` rectangles (their orange, brown and purple pixels; the trees' and signs' left out) rise as low solids (field3d.js
buildMounds: a 2 px grid over the rectangles, each pixel raised 0.75 per px of its distance to the nearest other pixel, at most 13,
smoothed over 3 x 3, lit from the sun with a high floor, the map's picture on it; the old "rock" stamps left out then); the club
houses are solid blocks (`blocks`: the striped roof on top, the white front 8 px tall). The paint and the stamps read the picture
before the cut (field3d.js `raw`), the ground texture the cut one (`img`). GROUND (ground.js, with Field life): the lawn a short
carpet turf (strands a third of a px across in soft patches, swaying), mown in 8 px stripes in field_objects.js `mown` rectangles
(round the club houses, up to 4: uniform uMown); the dirt with fine grit, grey grains and the odd pale stone; the paths' light
kerb band a soft raised edge (its slopes from the picture's neighbours: lit facing north, shaded facing the camera). Lite (uGLite)
leaves out the kerb's four texture reads and the patch noise.
SwiftShader, the Field at 5 spots (out/scratch/fieldshots.mjs, ms a frame): Lite 52-63 before, 45-74 after; Full 137-180 before,
170-294 after. Before / after: out/overworld/field_overworld_sheet.png, field_trees_behind.png.

LIGHT (light3d.js, skybox.js). The light of each hour is its own table (light3d.js LIGHT, hand-tuned for a readable picture), not
taken from the sky's colours: the sun's light (the moon's at night) and the ambient (the sky's light in the shade). Day as before;
dawn (6.2) and the sunset (18.2-19.4) a warm low sun (up to 1.05 / 0.62 / 0.42) over a cool blue-violet ambient (0.44 / 0.45 /
0.64), so the lit sides glow and the shade stays blue and the greens green; night (20.5-5) moonlight (0.27 / 0.33 / 0.54) and a
cool ambient (0.26 / 0.30 / 0.45) with the floodlights on three masts (radius 200, a neutral white) and a small lamp at the pin. The
light's sun is never lower than 0.42 rad (~24 degrees; the sky still draws the sun on the horizon): a sun at a few degrees left the
ground in the dark (the ground's light is the ambient plus the sun times the slope's cosine) and every shadow endless, which made
Peach's Castle at dusk dim and muddy and its trees brown. The golfer, the pin and the game's marks are lit at least as a day's
(`heroK`: 1 / the light's brightness, at most 1.45). The haze at dusk and night is the horizon's colour pulled toward the sky above
it. The sky: dawn and sunset have a coloured band above the horizon (gold, rose, violet: skybox.js SKY `band`) and a warm glow
along it strongest toward the sun (`glow`). Auto: Peach's Castle 18.8 (the sunset, deepening over the round: hole 18 at ~19.8) instead
of 19.6. Before / after: out/polish/light_*.png (every course at its Auto hour and at 6.6, 12, 19 and 21.5: aiming, the address, a
putt).

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

No tree fills the picture (scene.js treesSeeThrough, both styles). Each picture, for each tree (its place, foot, top and crown
radius from its shape: trees3d.js kinds, or the Original picture's size): a tree the camera stands in or right against (within its
crown's radius + 1, below its top) is not drawn; one whose crown the lines from the camera to the ball and to the golfer (his feet
and his head; not in the putting view) pass through, short of them, is dithered see-through (up to 85 % of its pixels left out,
less toward the crown's edge); one near the camera and in its view that would cover more than about half the picture's height
is dithered too (up to 85 %); within 5 units of the camera up to 90 %. The share eases in and out (time constant ~0.08 s) so a
tree does not pop; the dither is a 4 x 4 Bayer screen door in the bodies' shader (`uSee`, discarding fragments), so it needs no
sorting and overlapping trees keep the same pixels (they do not add up to a wall). The sun's shadows stay (the depth pass is not
dithered). Seen on the chase camera's low flights past the woods, the landing view with a tree between the camera and the ball, and
the address of a second shot from the trees (out/polish/trees_*.png); `scene.treeFaded` counts the trees shown see-through.

GRASS (the panel's Grass: Carpet, the default, or Pixel, the look before; under the Terrain layer). **Carpet** is Mario Tennis's
shell carpet turf (its ground.js VS_SHELL / FS_SHELL) on every grass area of the hole: the ground mesh, cut in chunks of 16 x 16 px,
is drawn again as shells above the soil (instanced; shell i at (i / N)^2 over it, N = 10 Full, 4 Lite) only on the chunks near the
eye (60 units Full, 26 Lite, further when zoomed in) and in front of it, fewer further off; in each chunk the grid's quads are kept
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

Reading the grass (GREEN: Arrows; GREEN: Clean, the default, is under "Putting" below). The game's ball ignores the wind on the ground (Wind 10:52EE returns nothing at height 0), so on the green the
grass shows the **slope** instead, tile by tile exactly as the roll reads it (hole3d.js greenSlopes: GreenSlopeAt 10:64D1 on the
putting view's maps, the direction through SlopeDirTable 10:6516 with the tile's flips, the strength (v >> 4) & 3; one texel per
green tile of 2 x 2 course px, from the green's corner `$D441/$D442`): the strands lean downhill (the push's direction), more the
stronger the slope, with a slow wave along it; the base is combed into short blades along the slope in rows, each dark at its
uphill root and light at its downhill tip (so a still picture shows which way is down), a sheen turns with the view (lighter
looking down the grain) and a bright band travels slowly downhill, faster and stronger on steeper tiles; flat tiles stand upright
and still. (The game's greens often draw one even slope as tiles of strength 3, 2, 1 and flat in turn, as its chevrons do; the
grain shows them tile by tile as the ball feels them.) Only a light wind sway stays on top. Checked: web/tests/g3d_grain_slopes.mjs
compares the grain's data with the engine's own slope() (js/golf/ball.js) at every quarter pixel of all 107 greens (no mismatch);
and in played putts on the six courses the push the game gave the rolling ball across its way (recovered from its velocities each
frame) points along the grain's lean on every tile where it is larger than the friction's rounding (cos 0.99-1.00; on gentle tiles
at low speed the game's push truncates to nothing). Off the green the grass sways in the game's **wind**
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

The cost of GRASS: Carpet, SAND: Fine and the new ball, SwiftShader on a shared 4-core machine, the game held and one picture drawn
again and again (median; before = the commit before them, paired runs): Lite 42-61 ms before, 56-81 ms after (x1.3-1.7: the tee,
the fairway view and the putt on the Marion and Dune clubs); Full (640 x 576, multisampled) 135-214 ms before, 283-421 ms after
(x1.7-2.4; most of it the shells near the camera). Grass: Pixel with Sand: Pixel runs the old shader at the old cost; Sand: Fine
alone adds about a tenth (the sand near bunkers and the desert).

## Putting (camera3d.js, groundshader.js, scene.js; the lines in hd/aimpower.js)

Two options (OPTIONS > Play: Putting, OPTIONS > 3D view: Green; URL `?g3dputt=green|follow&g3dgreen=clean|arrows`, remembered in "mg3d").

- **Putting: Green camera** (default) | Follow. While a putt is aimed (the green view `$D443` = 1, the putter `$D329` = `$0D`, the
  meter not started `$D44E` = 0, the ball at rest, a human or computer turn; with Camera Follow or Behind) the camera (camera3d.js
  puttGoal) stands low behind the ball on the line to the cup (`$D43D/$D43F`): back 3.2 + 0.2 L, up 1.7 + 0.12 L (L the putt in
  yards) plus 0.22 per yard beyond 12 (a long putt seen from higher, so the cup is not squeezed into the horizon), and its pitch, yaw
  and field of view are fitted (12 steps) so the ball, the cup and its flag, and the green's edge beyond the cup (along the line,
  less of it on a long putt; the green's tiles from greenSlopes) fill the rows between the HUD's top text and its bottom strip
  (ndc y -0.62..0.66). While it shows (`scene.puttView`) the golfer is drawn only into the shadow map (his sun shadow stays; without
  LIGHT a soft spot), the caddie, the game's marks (target marker, look cursor) and the last shot's Ball FX trail are left out, and a
  ring round the ball and a tick along the aim `$D418` mark it; the white-lined cup with GREEN: Clean. When the swing starts (or the
  option, the club or the view changes) the camera blends back to the FOLLOW green camera in 0.8 s (eye, target and field of view
  eased with a smoothstep; it blends in from wherever the camera is at the next putt), so the stroke and the roll are seen as
  before; the big meter is placed as before. The blend runs on the clock (a slow renderer's capped picture step would stretch it).
  The helpers' overlay lies over the 3D canvas when it shows (on a phone's full-screen layout it covers the whole screen).
- **The break** (the putting view's marks, aimpower.js drawPuttView; with Preview On): the putts struck at 100, 77, 50 and 27 % of
  the meter, each run by the game's own shot code on a copy of the memory (shotpreview.js runPreview with the putter's press count:
  `$D44E` = `$D44F` = `$D450` = the count): the roll path as a smooth curve (the 100 % one solid, the others dashed), its stop
  as a small ring lying on the green, the tag "X ft  NN%" (or "in") beside the stop, placed by aimdraw.js Placer clear of the
  other tags, the stops, the lines and the HUD's corners, inside the rows between the HUD. Why 77 and
  27: SwingMeterLoop 10:57E0 reads A only on an even count (on an odd one it latches the press into `$D453` and acts on it at the
  next count), so a press can strike only at an even count; 75 % ($2D) and 25 % ($0F) cannot be struck, the nearest are $2E and
  $10 (shotpreview.js PUTT_POWERS). The percentage is the count / 60, as the big meter shows the power. The runs are made again only
  when what decides the shot changes and has held still 90 ms (about 10 ms for the four in the page). With Markers On, a light grid of
  the green's tiles (2 px) fading out 2.5 px from the ball-to-cup line, each sloped tile with a chevron along its push in yellow /
  orange / red by its strength 1 / 2 / 3 (GreenSlopeAt 10:64D1 via hole3d.js greenSlopes), and a white ring round the cup, never
  under ~7 px across (on a 60 ft putt the cup is a few pixels far up the picture). The usual aim line, "full putt" line and
  pin label are not drawn in this view (the 100 % line is the full putt).
  Exact: `web/tests/putt_lines.mjs` (Node) reaches putts on eight greens (Marion 1 and 3 (from the fringe), Palm 1 and 18, Dune 2
  and 5, Links 3 and 18) and strikes each at the four counts in turn (the round played again from its start for each): 32 of 32
  stopped exactly (to the fraction; a holed one "in") where the line computed in the aiming menu and at the address ends, with the
  same roll; `web/tests/putting_view.mjs` checks that the page's own four lines are the same numbers.
- **Feet**: every number of feet on the page comes from shotpreview.js feetText, the HUD's conversion (HudDrawPinDistance 12:4CB1):
  a length under `$6A` units as feet and tenths ((len x 3) >> 5, the rest x 10 >> 5), else (len x 3 + 8) >> 5; the pin's distance
  from PinDist 10:62AD, a putt's roll from ShotLength 10:6276. (The full putt's label used to round the straight distance x 3 and
  could say 30 ft where the game's own conversion gives 29.)
- **Green: Clean** (default, with GRASS: Carpet and TERRAIN) | Arrows (the look before: the green picture's chevrons, the grain's
  combed blades and travelling band). Clean draws the green in its base colour (scene.js greenBaseOf: the commonest colour of the
  green picture's pixels on the green's own tiles; first from the ROM's green palette, then from the live one once the game shows
  the green) without the chevrons: a fine mottle, a subtle two-way mowing pattern (1.5 px bands along and across the hole whose
  shade turns with the view), a darker collar (the fringe ring x 0.84), the cup with a white liner. Its grass moves only with the
  slope (groundshader.js slopeOf / swayWave): per green tile the push and strength as the ball reads them, the tile's own value in
  the middle 40 % of the tile and blended with its neighbours only across the outer part (no checker look, each tile's centre exact);
  waves running downhill along the push (sin(2.4 x along the push - t (0.9 + 2.6 s))), their size by the strength, flat tiles still,
  and a slight still lean (a strand bent toward the eye shows its lit side: lighter looking downhill). The shells bend the same way;
  the wind does not move the green's grass any more (off the green the grass keeps the wind). Every club's green is drawn so, also
  a green whose colour is not green.

Frames on a slow renderer. The 3D picture is now drawn only when the GPU has finished the last one (layers.js: a fence after each
picture, `clientWaitSync` with no wait before the next; until then the last picture stays), and the helpers' overlay is painted
again while the game is held only when something it shows changed. Before, on SwiftShader the page queued pictures (the idle redraw
every 120 ms, the overlay at every animation frame) faster than they were drawn; once a picture took longer than that (the course
view at the full resolution, more so with the green's new look in the concepts) the queue grew and Chrome all but stopped calling
requestAnimationFrame (3-20 calls in 8 s held at the approach on Dune 2, the pictures seconds late; the concepts' captures timed
out). Now 480 calls in 8 s, the 3D picture redrawn as fast as the renderer finishes it. `web/tests/putting_view.mjs` holds the
game at the full resolution in the course view and in the putting view with every option and fails below 15 calls a second.

Cost (`putting_view.mjs --shots`, the 3D picture redrawn with the game held, Full 640 x 576, SwiftShader on a shared machine, median
of 7; before = Putting: Follow with Green: Arrows): the course view at the approach the same within the noise (282-404 ms both);
the putt 494 -> 339 ms (Marion 1), 592 -> 423 (Palm 18), 337 -> 307 (Dune 2), 483 -> 520 (Links 18), 455 -> 512 (Marion 3, from the
fringe): the low camera sees less of the course, a long putt's view more of the green's grass shells. The four break lines cost
7-18 ms of script once per aim (four runs of the shot code), their drawing well under a millisecond. `g3d_layers_same.mjs --scenario
putt` plays a putt in the putting view with every layer and helper on (the game's state the same every frame).

## Aim and swing helpers (web/js/hd/aimpower.js, shotpreview.js)

Four page options (OPTIONS > Play), drawn on a 2D canvas over the screen (over the
3D view when it shows, over the 2D or HD picture otherwise). They read the game's memory and never write it; the tap area only
sets the same key the pad's A button sets. Settings in localStorage (`mg-meter`, `mg-preview`, `mg-marks`, `mg-tap`) or the URL
(`?meter=big|game&preview=on|off&marks=on|off&tap=on|off`).

- **Meter: Big** (default) | Game. From the first frame the swing loop (10:57E0) counts (wSwingCount `$D44E` moving) the meter
  grows out of the HUD's small meter into the middle of the picture in 10 game frames (~170 ms), and shrinks back 14 frames after
  the swing ends (the count stops: the impact, the putter's press, B or the timeout) in 10 more. It draws only what the game's
  meter variables say: the cursor wSwingCursor `$D44F` (full power `$3C` at the left, 0 at 60/78 of the bar, the timeout's -18 at
  the right end, as HudDrawMeterCursor 12:456E lays the small one out), a trail of the cursor's last ten counts (the cursor is a
  function of the count), wSwingPower `$D450` held with "NN% · YYY y" (power / 60, ScaleByPower 10:6865 of ClubBaseDistance 10:68B1:
  the club's yards before the lie, wind and impact; the putter: the percentage), a glowing MAX mark, the PERFECT line at 0 (one
  count wide) with a faint +-3 window, and NICE! when wSwingPerfect `$D451` is set after the impact. The speed and timing are the
  game's: nothing here touches the count. While it is big the game's small meter (the HUD row y 128-143, x 43-130) is covered
  with the HUD's own colour. Placement: in 2D (the view behind the golfer) the golfer stands at the bottom, so the bar sits at
  y 56-86; in 3D the golfer is projected with the 3D view's matrix and the bar takes the larger free space above his head or below
  his feet, narrower (15-85% of the width) to keep the HUD's corner text and face clear. In portrait the picture is the top of the
  screen and the bar stays inside it, away from the control deck.
- **Preview: On** (default) | Off: a helper showing where a **perfect full-power swing** would go with the current club, aim, lie,
  shot mode and wind. shotpreview.js copies the game's memory (g3d/replay.js `cloneMemory`, without the display: its hooks are
  skipped), sets the meter as such a swing leaves it (count `$78`, cursor 0, power `$3C`, perfect 1, full power 1, the impact pad
  table's first entry as SwingPadTask 10:55AC leaves it with only A held; the putter: one press at `$3C`, the putt range `$D32B`
  as the shot mode), does what 10:4921-10:49A0 does between the swing and the launch (the shot record `$D5F8`, the landing-preview
  task off: `$D485` = `$2D`, the retry flags `$D35F/$D360`, the tree tile `$D519/$D516`, the ball objects bit 2) and runs the
  engine's own `Shot.launch()` (ShotLaunch 10:5F94, the flight camera's loop and ShotMainLoop with BallTask every frame, the cup,
  the green's view change) to its outcome. Without the landing-preview task off the copy's PreviewFrame keeps rewriting the shot
  and the ball goes ~50 y long. Drawn (hd/aimdraw.js, the look shared with the deck's shot map): the flight as a tapered tube
  (its half-width from the 3D view's scale at each point, ~0.4-1 game px, narrowing a further 35 % towards the landing; a soft
  dark edge so it reads on sky, sand, grass and water, a tinted body, a white core, in 3D fainter over its first third so a
  flight rising straight at the camera does not read as a bar; a light travelling along it once every 90 game frames: its phase
  is the frame count, so a held game holds it), its shadow on the ground as a soft line, a faint curtain between the two with
  height ticks, the apex (the highest frame of the path) with a dashed drop to the ground; when the flight's picture is nearly a
  straight line (the camera behind the ball: the rise and the fall on top of each other) a small panel at the lower right draws
  the same path from the side (the distance along the ground, the height x2) with the apex, the landing and the roll; the landing
  as a reticle lying on the ground (rings and four ticks, perspective-correct through the same projection, never smaller than
  ~4 game px), the roll as a dotted line to a small rest ring, and one tag "284 y  carry 280" (ShotLength 10:6276 >> 5, as the
  HUD measures a shot: the rest, then the carry); a putt: the roll line and "N ft  full putt" (or "in"). The game shows no
  height of its own, so the apex has no number. Tags are at least 15 CSS px (the break's 14) so they read on a phone. It is run again
  only when what decides the shot changes (the hole, the ball's spot, the aim, the club, the shot mode, the putt range, the wind,
  the view, the player, the club's stats) and that has held still ~90 ms (the aim keys move it every frame; meanwhile the last
  one shows dimmed). Exact: web/tests/shot_preview.mjs (Node) plays perfect full swings on the four courses, from the tee, the
  fairway, the rough, bunkers, the fringe and the green, straight and well off the line, three golfers, winds 4-19 mph: 51 of 51
  came to rest exactly (to the fraction) where the preview said, both when it was computed in the aiming menu and at the address,
  outcome too; swings that are not perfect come out elsewhere. web/tests/aim_power.mjs checks the same on the page itself.
  Cost: 2 ms median per run (Node; up to ~25 ms for a long drive with a cold JIT), a few ms in the page.
- **Markers: On** (default) | Off: the aim line from the ball to the target marker `$D426/$D428` (10:56EF: ClubBaseDistance along
  the aim; dashed, fading with the distance), a small ring there with the club's yards (the shot panel's number: "270 y  club"),
  faint rings every 50 y round the ball (fading with the distance; numbers only at 100, 200, 300, on the side away from the
  flight's curve, where the ring shows), the pin's distance over the flag (PinDist 10:62AD >> 5; feet with the putter near the
  green, as the HUD's 12:4CB1: "376 y  pin", "35 ft  cup"). The ring goes on the
  target marker, not on the game's landing preview ghost (`$D374/$D377`): PreviewFrame 11:4E5E relaunches the ghost every 32 frames,
  so it only ever shows the first ~40 y of the flight. Every number is one tag style (a dark glass pill, a coloured accent: a ring
  for the landing, a flag for the pin, a dot for the target; the number bold, a small caption after it). aimdraw.js Placer puts
  each tag at the first of 25 spots round its point (nearest first) that overlaps no other tag, none of the HUD's corners (in 3D
  scaled as hud3d.js pins them), not the golfer (in 3D projected from his place, 2D round the ball's sprite or at the bottom of
  the view behind him), and the fewest points of the flight, roll and putt lines; a tag moved far gets a thin leader back to its
  point, and one whose point is off the picture sits at its edge with an arrow pointing there.
- **Tap area: On** (default on touch screens) | Off: at the address (the swing can be started) and through the swing the lower half
  of the screen is the A button: a touch there sets `keys.KeyZ` as the pad's A does (and lights it); the pad's own buttons, the
  stick zone, the menus and the gear keep their touches (the d-pad's hook / slice and height during the swing, B to cancel). The
  first three addresses show a dashed outline with the cut-outs and "TAP HERE = A". `play_page.mjs --tap` plays its swings with it.

Projections: 3D: the 3D view's matrix (`scene.mvp`, the ground height `hole.H`). 2D: the hole view's own: the course view at 1 px
per world px from the scroll `$C320/$C322` (heights at half, as CourseViewDrawBall 11:4385), the green view at 4x from its corner
`$D441/$D442` (GreenViewDrawBall 11:4994), the view behind the golfer through its camera `$D456/$D458` angle `$D45A` (11:4795's
projection, by the depth). The game puts its sprites' centres at these points. Behind the golfer the picture squeezes the course
into a band at the horizon, so there the marks are of a fixed size (the target, the landing, the rest), with no rings, aim line
or arc.

Cost (`aim_power.mjs --cost`, headless Chromium, SwiftShader, a shared 4-core machine): the helpers' drawing 0.04-0.1 ms of
script a picture in 2D / HD and 0.3 ms in 3D while aiming (the arc's dots, the rings), 0.06-0.1 ms with the meter; a preview's
run 2.6-5.5 ms in the page (only when the shot's inputs change); the 3D picture with and without the helpers drawn after it is the
same within the noise (Lite ~32-38 ms, Full ~150-225 ms a picture, dominated by SwiftShader's rendering). A putt that reaches the
pin can hop off it and come back (the preview shows it: "off the pin").

Checks: `web/tests/shot_preview.mjs` (the preview against real perfect swings), `web/tests/aim_power.mjs` (the same in the page,
the frame cost; `--shots` the pictures in out/aimpower), `play_page.mjs --tap`, and the game-unchanged tests with the helpers off
in one run and on in the other (`g3d_layers_same.mjs`, `play_hd.mjs --same`).
Pictures: `web/tests/arc_shots.mjs` (a tee shot, an approach, a curved shot in the wind, a bunker shot, putts on three courses;
desktop, the Fold8's inner and cover screens upright, a phone on its side; 3D and 2D+HD; `--root` serves an older tree for the
"before" pictures) into out/arcs/{before,after}, sheets in out/arcs/sheet_*.png (tools/sheet.py).

## The deck's shot map (web/js/hd/deckmap.js; portrait.js)

The portrait layout (touch screens held upright: the game on top, the controls on a deck below) shows, during golf (`game.mark` one
of the round's marks and a hole loaded), a live overhead map of the hole on the deck instead of the hole's art. Option **Deck**:
Shot map (default) | Art (`mg-deck`, `?deck=map|art`; OPTIONS > Picture on a touch screen). Menus and the story's maps keep
the art. Render only: it reads the game's memory and the ROM; it writes nothing.

- **The course**: g3d/hole3d.js HoleArt (built from the ROM at run time, nothing stored): the terrain type of each 2 x 2 px cell
  (TerrainAt 10:6536) mapped to nine classes (fairway, tee, first cut, rough, deep rough `$0C`, sand `$02/$0D`, water, green, out of
  bounds), each class's cells blurred (a 5-cell box, twice) and the class with the highest field taken per picture pixel (1024 x
  1024 for the 512 x 512 px map), so the tiles' steps become rounded shapes; procedural colours, mowing stripes, a fine grain, a
  darker outline where the class changes, water lighter at its banks; a round canopy with a shadow on each tree tile (bit 7 of the
  tile byte, TreeCheck 08:51D2). ~0.1-0.3 s once per hole (cached, the last three holes). Zoomed in (more than 3 device px a course px: a green,
  a short shot) the part of the course in view is painted again finer from the same blurred fields (paintRegion: 4, 8 or 16 picture
  px a course px, on a grid of 32 course px with a margin, at most ~3 M pixels; the last four kept while the view stays inside one),
  with a soft value-noise grain instead of the whole map's per-pixel grain, and laid over the whole map: the edges of the green, the
  bunkers and the fringe stay crisp instead of an enlarged soft picture (out/polish/deckmap_green*.png). `__deckMap.patchMs` is the
  last one's cost.
- **The view**: turned so the aim (`$D418`) points up the deck; framed on the ball, the preview's landing and rest (the pin when
  it is within the rest + 70 y; the aim's target when there is no preview), padded 22 y; putting: the ball, the cup and the four
  stops, at most ~22 CSS px a yard. It eases (time constant 0.2 s) in centre, log-scale and angle, and snaps when it is within a
  fraction of a pixel, so a held game draws nothing. During the flight it keeps the aim's frame and adds the ball.
- **Marks**: the ball (larger with its height in flight, a shadow offset by it), the cup and its flag, the aim line to the target
  `$D426/$D428` and its ring, rings every 50 y round the shot's start (numbered every 100), the wind badge (the HUD's speed
  `$C815 & $1F`; the arrow along `$C816` as the flight's wind push 10:52EE: the same angle convention as the aim, turned with the
  map), the shot preview from above (aimpower.js `shotNow`: the very result the marks over the picture draw, previewFor's cache):
  the flight as the tube (wider where it flies higher), the landing reticle, the roll dotted to the rest mark, the tag "rest y  carry
  N". With the putter: the green's slope per green tile from the green's corner `$D441/$D442` (HoleArt greenSlopes, GreenSlopeAt
  10:64D1: a chevron along the push, yellow / orange / red by strength; a dot where flat) once a tile is over 7 px, and the four
  break lines (aimpower.js `puttLines`) with stop rings and tags. In flight: the preview faded, the ball's track since the swing.
  Tags (aimdraw.js Placer) keep clear of the controls, the label, the gear and the wind badge.
- **The controls**: the map's middle (where the view centres its frame) is the free space: on a tall narrow deck (a phone, the
  Fold's cover screen ~412 x 960 CSS px) with the map on the d-pad / stick and A / B sit low (`#pad` aligned to the bottom, 66 px
  above it for Select / Start) and the middle is the space above them; on a wide deck (wider than 1.6 x its height: the Fold's inner
  screen held upright, ~906 x 1088 CSS px, the deck ~906 x 435) they stay at the sides, the label goes to the top left and Select /
  Start under A / B, and the middle is the whole height between them. Under each control the map is darkened (a radial shade).
- **Cost**: the map draws only when something it shows changed (its own animation frames compare a signature: the view, the ball,
  the preview, the putts, the aim, the wind, the size); `window.__deckMap.draws` counts them.
- **Exact**: `window.__deckMap.marks` keeps the world spots it drew (landing, rest, the putts' stops, the yards).
  `web/tests/deck_map.mjs` plays perfect full swings and full putts in the cover screen's layout: at the address the map's marks
  must be the preview's and the ball's real rest spot must be the map's rest mark to the last fraction (17 of 17 on Marion 1
  and 7, Palm 1, Dune 5 and 2, drives to wedges, a full putt); held, once settled the map must not draw again (`--cases 0,4`
  runs some of the cases). `--shots` takes the pictures in out/deckmap (aiming, the flight, putting, the menus; cover and inner screens).
