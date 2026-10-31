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
| the ball | `$D400-$D408` (x, y 8.16; height 8.16), velocity `$D409/$D40B/$D40D`, in the air `$D415`, spin `$D411` |
| the view | wOnGreen `$D443` (0 course, 1 green, 2 cup, 4 behind the golfer); the course camera's scroll `$C320/$C322`; the green's corner `$D441/$D442` |
| the aim, the club, the swing | `$D418` (16-bit angle from +x toward +y), `$D329`, the shot mode `$D32A`, the meter count `$D44E` |
| the golfer | `$D332` (golfer id), `$D333` (left-handed), its big frames (list 11:6EEF, templates 11:6F0F), frame `$D467`, the OBJ palette RAM |
| the cup, par, strokes | `$D43D/$D43F`, `$D325`, the player record's `+$20` |
| the wind | wWindSpeed `$C815` (mph), wWindAngle `$C816` |
| the course | `$C836` (the sky's theme, the hour) |
| the screen state | the frame task table `$C1C0` (BallDisplayTask 11:4113, BehindViewTask 15:47AD, TitlePressStartTask 40:4D1D, the actors 04:4B69, MapGfxScrollTask 0B:4784, the result confetti 0B:5DE1), the fade `$FFA2/$FFA4/$FFBC` |
| the overworld | wMapGfx `$C32E` (MapGfxTable 0B:4048: tile map, attributes, collision `$D000` 32 x 32 cells of 16 px with `$0F` blocked), the live VRAM1 tiles and palettes, the actors' sprites (bank 04 slots) |

World units: 1 = a pixel of the course view = 32 position units (a tile is 8 px = 256 units, about 8 yards), so a unit is about a
yard; heights in the same units (the ball's height / 32). The trees stand 24 units tall (TreeCheck 08:51D2's height levels).

## The layers

| Layer | Module | What it does |
|-------|--------|--------------|
| 3D view | scene.js, hole3d.js, terrain3d.js, camera3d.js, hud3d.js, sprites3d.js, voxround.js | the hole's course map as the ground; its tree tiles cut out and stood up as rounded bodies; the golfer from his big frames as a rounded body (walks to the ball between shots); the pin with a flag in the wind; the ball at its true height with its shadow; the game's marks (target marker, preview spot, look cursor, the other ball) from their VRAM tiles; the HUD (window + non-world sprites) on top. Camera: Follow / Course / Behind / TV |
| Hills | terrain3d.js | cosmetic heights: a Poisson solve whose gradient follows the slope cells and the green's slope bytes, mounds in the woods, hollow bunkers, lowered water; the ball drawn at its height over this surface |
| Sky | skybox.js | the sky of the hour and a panorama per club (campus hills, tropics, desert, coast, castle) |
| Light | light3d.js | the hour (Auto by course, the clock, fixed), sun colour and direction, a shadow map, night floodlights and a pin lamp |
| Terrain | groundshader.js | surfaces by terrain type in the hole's own mean colours (stripes, blades in the wind, mowing check, ripples, moving water) |
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

Quality: Full (multisampled, a 4 px ground grid, a 1024 shadow map with 9 taps) or Lite (no multisampling, an 8 px grid, a 512
shadow map with one tap, 60% resolution, fewer particles and people). The canvas's resolution also comes down by itself while the
pictures come slower than about 40 a second and goes back up when there is room.

Measured in headless Chromium with SwiftShader (CPU rendering; a GPU is much faster): Lite about 19 pictures a second with the game
at 59 frames a second; Full about 9 pictures a second at a reduced resolution (the game at about 36 frames a second, as the page
runs at most four game frames per drawn frame).
