# Mario Tennis (GBC) — web port architecture

Scope: a **singles exhibition match** (Mushroom Kingdom cast, any of the 15 court maps, 2- or 6-game
set with tiebreak, four CPU difficulties). Plain ES modules, no build step:

```
cd projects/mario-tennis-gbc && python3 -m http.server 8000
open http://localhost:8000/web/index.html      # auto-loads rom/mario_tennis.gbc, else file picker
```

No game data is embedded: `rom.js` decompresses everything from the user's ROM in the browser
(SHA-1 is checked).

## Module graph

```
index.html
  └─ js/main.js        ROM loading, input, rendering, 60 fps loop; the match runs on js/engine/ (below)
       ├─ js/engine/      the exact match engine: a readable port of the ROM's match code (see "The exact match engine")
       ├─ js/rom.js     Rom (bank addressing, bank tables, LZ decompressor), BGR555, 2bpp tiles
       ├─ js/assets.js  courtImage, characterSprites, characterData, shotRow (+ roster/court lists)
       ├─ js/physics.js ball state, step(), launch(), predictBounce(), COURT constants
       ├─ js/shots.js   the game's aiming + trajectory-table selection (computeShot, atan2Rom, shotType)
       ├─ js/camera.js  exact ProjectPoint 00:2D8C + match camera 08:61DC (project, Camera)
       ├─ js/sound.js   the game's sequence driver (Sequencer) + a small APU model (Apu), pure JS
       ├─ js/audio.js   AudioWorklet glue: music/SFX ids in, stereo samples out (GameAudio)
       ├─ js/match.js   the earlier hand port (approximate; kept for its own tests, no longer used by the page)
       └─ js/menus.js   Menus: main → play → character → opponent → difficulty → court (ROM backgrounds, icons, badges, fonts)
tests/
  physics_vs_emulator.mjs  JS ball step vs PyBoy recording (needs states/phys_ref.json)
  soak.mjs                 CPU vs CPU headless match; rally length / outcome statistics
  scoring.mjs              deuce / set / tiebreak / serve-order rules vs the decoded ScoreUpdate
  shots_vs_emulator.mjs    shots.js vs the game's own shot selection (needs states/shots*.json from tools/emu_shot_trace.py)
  projection.mjs           camera.js vs the ball/scroll values stored by the game in the rally recording
  sound_vs_emulator.mjs    sound.js note stream vs tools/emu_seq_trace.py logs (states/seq_*.txt): 100% on songs $02/$03
  render_song.mjs          render a song with the ported driver to a WAV
  record_match.mjs         CPU vs CPU match -> PNG frames
  record_flow.mjs          boot -> intro -> title -> VS -> match -> PNG frames
```

## ROM → web mapping

| Web function | ROM routine / data | Verified how |
|--------------|--------------------|--------------|
| `Rom.lz` | `00:1797 Decompress` | DMG screen, 37 maps, 47 screens render correctly |
| `courtImage(id)` | `0A:585D LoadMap`, table `0A:59D9`, tiles → VRAM1 signed | court renders match emulator |
| `characterSprites` | `07:5A50` roster→sprite, `04:4F75` table, header +0 colour scheme `18:4300`, +4 frames | Luigi/Baby Mario colours from live OAM |
| frame layout | `00:2C2B/2CED` 8×16 OBJ column-major, 12 tiles | all 145 frames of char 0 coherent |
| `characterData` stats | `02:52CE` records, order from stat screen `1C:430E` | poke/hook in PyBoy |
| player movement | `08:73CA PlayerMove` (accel `745B/7441`, clamp `750C/74D7`, brake `74A1/7475`), `DF60-DF66` formulas | formulas: 6 characters in WRAM; accel/top speed: live measurement |
| `physics.step` | `08:576B BallStep` (+ `5949` fences, `5814` net, `55B4` drag, `5613` spin, `46B0` damp) | bit-identical to `tools/ball_sim.py`; 0.03 px vs emulator (serve), ≤0.52 px over 124 frames |
| `physics.launch` | `08:45A9 LaunchBall` | formula from code |
| `shotRow` | shot tables `07:4F11-5160` via `07:52A0` | serve spin = table row 0 |
| `COURT` | `08:40E5` constants, `08:4300` doubles width | real-tennis proportions; live serve/limits |
| `judge()` in/out & serve box | `08:463A InOutCheck`, `wC486` swap (`08:4CFF`, `0D:4BC8`) | constants from code |
| scoring / deuce / tiebreak | `08:5AD7 ScoreUpdate`, `08:5D71 WinCheck`, `DeuceCompress`, faults `08:5B7F`, tiebreak serve order from `08:49D9` | live point 0-15; rules from code; `tests/scoring.mjs` |
| `screenImage` + front end | `39:407E LoadScreen` table `39:40F5`: logos $15, intro $16-$1E, title $1F, VS $01 (boot order from `10:4F0D`) | screens match the Python renders; `tests/record_flow.mjs` |
| `Menus` | main `3B:55D1`, play `3B:5CF3`, character `38:7408`, court `3E:5D11`: stadium refs `3C:08-0E`, icons `3B:57E0/5EBD`, `3E:5DF1`, badges via `39:46B7`, portraits `18:5AF0`, UI font `01:4410`, texts bank `30` | PPU dumps of each real menu; roster order and court→map verified live |
| `gameFont` | font `05:7920`, widths `05:7F80` (`05:7322 DrawGlyph`) | glyph sheet rendered and checked |
| `proj()` | fitted to court-line pixels of the 32×32 court maps (projective, D = 16224) | ±1 px on the 4 lines |

## The exact match engine (`web/js/engine/`)

The match is a readable JavaScript port of the ROM's match engine (bank $08, the shot solver in $07, the
ball-path banks $20-$24/$29-$2C), checked to behave **identically** to the game. Routine names, RAM layout and
the overview follow the gerbiljames/mario-tennis-gbc-disasm disassembly (MIT, vendored in
`third_party/mario-tennis-gbc-disasm/`, see README "Credits").

* **The game's own data layout.** The engine runs on a copy of the RAM the ROM's match code uses
  (`memory.js`: WRAM0, the four character banks 4-7, HRAM) with named, typed fields (`S.ballX`,
  `S.chars[k].posX`, ...). Every fixed-point detail (24-bit velocities against 32-bit positions, fraction
  bytes, 8-bit wrap) is the game's, and a state can be copied from or compared with the running game.
* **Modules.** `math.js` (bank-0 multiply/divide/trig/projection helpers, including the ROM's inexact wide
  divide), `ball.js` (physics, net, fences, bounce and point outcomes), `shot.js` (ExecuteShot, the 15 shot
  types, placement, trajectory tables, serve and smash paths), `chars.js` (the character update: input, state
  machine, swing building, contact, movement, jump, facing, animation scripts), `ai.js` (the CPU player:
  serve, rally, doubles net player and baseliner), `flow.js` (scoring, court positions, camera, and the
  point/game/set loop), `setup.js` (character records, CPU difficulty, match scene, court intro),
  `session.js` (`EngineMatch`, the page's interface).
* **Blocking code as a coroutine.** The ROM's match loop blocks on frames; here every routine that waits is
  a generator and `StepMatchFrame` yields once at its VBlank wait. The page resumes it once per 1/60 s
  with the pad byte, so the engine's frames line up with the game's.
* **Checked three ways** (needs the ROM; the core is the reference):
  * `web/tests/engine_math.mjs`: every math helper against the ROM routine on random inputs.
  * `web/tests/engine_routines.mjs REC.mtrec [filter]`: every ported routine (461 checks, with forced
    variants for branches recorded play does not reach) run on the core's interpreter and as JS on the same
    RAM, for thousands of states from a recording; all of WRAM/HRAM compared (stack, sound driver and
    drawing-only RAM excepted).
  * `web/tests/engine_lockstep.mjs REC.mtrec`: from the ROM's RunMatchPlayLoop entry the engine runs on its
    own, fed only the recorded pad, beside the game; the gameplay RAM is compared every frame. A whole
    recorded story-mode ranking match (35,000 frames) and a scripted exhibition match run identically.
  * `web/tests/engine_setup.mjs REC.mtrec`: the character records and match scene built from the menu's
    choices against the game's at match start (identical).
* **Not ported:** link-cable play, the pause menu's own screens (the page pauses with START), the rule-break
  message windows (shown as text), minigame/drill hooks, drawing (the page draws from the engine's state:
  positions through the game's projection and camera, sprite frame = animation frame × 5 + facing row and
  X flip as the game computes them, the court scroll).

## Timing

Fixed 60 Hz timestep (`main.js` loop): logic runs once per 1/60 s regardless of the display refresh rate
(120 Hz screens get one update every other paint; a slow device catches up by at most 4 updates per paint).
A match frame costs ~0.1 ms in headless Chromium, so even phones have headroom; the page shows the measured
updates per second under the ROM status.

## State machine (`Match.state`)

```
serve --(A/B, or CPU after 50 frames)--> toss --(A/B while Z < -150)--> rally
toss  --(ball falls back)--> serve
rally --(judge: fault | out | net | 2nd bounce | fence)--> dead --(70 frames)--> serve
dead  --(fault on first serve)--> serve (same server, secondServe = true)
game won --> server switches; set won (N games, lead 2, or tiebreak at N-N to 7) --> over
```
* **Projection / camera**: `camera.js` is the game's own math (tilt 23.76°, focal 16384, 1/32-px screen units, camera that follows the serve then freezes, scroll aligned to 32 units); bit-exact on the rally recording.
* **Sound**: `sound.js` runs the game's own sequence driver on the ROM's song data (every command decoded, note stream identical to the game — `web/tests/sound_vs_emulator.mjs`); the hardware is touched exactly where the driver touches it (note-on, `SeqWriteVolume`, vibrato, pan, end), and a small 4-channel APU model runs the hardware envelope, the pulse-1 sweep and the wave volume codes in between. Not modelled: portamento (`$AA`). Music: intro `$01`, title `$02` (then `$01`, as the game does), menus `$03`, match `$44` (the fanfare `$31`) and then `$06`; SFX: swing `$59`, rally contact `$51`, serve contact `$57`, bounce `$5B`, point over `$66`, menu `$5E/$5F/$60` (ids from the game code, index entry = id − `$51`). Audio starts on the first key press.
* **Full game (`web/full.html`, `web/js/gb/`)**: a Game Boy Color core written for this project (SM83 interpreter, MBC5, CGB PPU, register-level APU, timer, DMA/HDMA, double speed) runs the ROM itself, so story mode, the tour, the mini-games and the saves are all available 1:1. It is verified against PyBoy frame by frame from power-on (`tools/emu_frame_hashes.py` + `web/tests/core_vs_pyboy.mjs`: identical frames apart from PyBoy's boot-ROM logo; with a key script 1187 of 1500 frames match at a fixed offset). It runs at roughly 750 frames per second in Node. `tools/recomp.py` is the **static SM83-to-JavaScript translator**: it discovers code by recursive descent from the interrupt vectors, every bank's export table, every far-call site, jump tables and recorded coverage (`web/tests/record_coverage.mjs`, produced by the core itself; PyBoy traces are optional), and emits one JS function per basic block over the core's CPU/memory objects using the interpreter's own ALU helpers, with an interrupt/frame-boundary check and a hardware sync per instruction. `web/js/gb/exec.js` runs a block whenever the PC is a known block start of the current bank (also the OAM-DMA routine the game copies into HRAM, guarded by its bytes) and interprets otherwise, so untraced code is still correct. `web/tests/recomp_vs_interp.mjs` compares registers, RAM and frames every frame between the two: identical over 1500 frames with inputs. The generated file (`web/gen/game.js`, ~20 MB, ignored by git) is loaded by `full.html` when present. The match-engine port below stays as the readable, documented reimplementation.
* **3D view (`web/js/voxel.js`, the "3D" button on `full.html`: off → cards → voxels)**: a WebGL2 diorama drawn from the running core's state, filling the whole screen. On a court (`wCurMapID` 0-15, including the training court, map 6, where the Tennis Machine and the other drills are played; confirmed against the court tilemaps in VRAM: the best match wins, since courts 4 and 5 share all but their far backdrop rows) the court's own tilemap (from the ROM, so captions the game writes into the map never reach the floor) is un-projected through the game's `ProjectPoint` onto a flat ground plane, built once per court as palette indices and recoloured on palette changes. The net band, the umpire chair, the far stands/fence and the near fence (fenced courts) are cut out of the floor and stood upright (`CUTS`); beside and behind the court stand the bleachers of the story-mode stadium (RPG map 32): its walkway band becomes a vertical base wall with the railing and the seat rows rise from it (`STANDS`). The game's own drop shadow under each player (tiles $58/$5A/$5C, drawn every other frame so it looks see-through on the LCD) is left out; the view draws a soft shadow on the ground instead. Sprites are classified in a fixed order: the ball (tiles $40-$4F near the ball's projection, plus its trail and shadow) first, so a ball passing in front of a player is never drawn at that player's depth; then players, seeded by the sprites standing on their projected feet (or cut by the bottom edge) and grown only through touching sprites; then the lob landing marker (tiles $7C/$7E, only while `wLandingMarkerActive $C4DA` is set, around the point the game draws it, `wC480/82`); then the ball effects (bounce dust $60/$62, hit spark $68-$6E, special flash: their timers `wC4A8-C4AA` count down from the start, so the ball's world position that many frames back in a per-frame history, `tick()`, is where they stand); the rest is HUD. A player whose feet are off the Game Boy screen (the camera there only shows part of the court) is drawn with the last whole body seen at their real position. HUD sprites are drawn at 60% of the full-screen scale, anchored per group of touching sprites to the nearest edge or the centre, below the touch button bar and above the stick and A/B buttons. The court floor is the ROM's own court picture (tiles, map, attributes) coloured with the live palettes, so text boxes written into the map never change it. Players stand at their real positions from the player banks (`wPlayerX/Y/Z`, WRAM4/5, partners in WRAM6/7): each OAM sprite is assigned to the player whose projected feet it stands on, so every animation frame keeps its exact 2D layout while the body moves in depth; the ball and its trail are placed at `wC400/04/08` with a shadow, the landing marker lies flat on the court, other in-picture sprites stand at their un-projected feet, border sprites (score strip, faces) are HUD anchored to the viewport edges, and tiles that differ from the court map (captions, score digits) plus the window layer are overlaid in screen space. Sprites are leaning textured cards or, in voxel mode, one inflated body per object: each pixel column's depth grows with its distance from the silhouette (`meshFromPixels`, chamfer distance transform, step faces between columns), placed by the same anchor and position as the cards and rebuilt (cached) for every distinct animation frame. Texture and mesh caches are keyed on the tile bytes and the palette. The camera is locked to a preset (`PRESETS`, the CAM button: Low (default), TV, Overhead, Diorama, Original) whose distance is fitted so the court fills the viewport; "Original" is the game's own pinhole (tilt 23.76°, 16384 units, 1 px = 8 units) with the scroll applied as an image shift. `?freecam` restores drag-to-orbit / pinch / wheel. The view renders at the display's refresh rate and interpolates player, ball and scroll positions between the last two game frames (`render(frame, alpha)`), so a 120 Hz screen shows 120 distinct frames while the game stays at 60 Hz. In the RPG areas (`wCurMapID` 17-36, confirmed by comparing the VRAM tilemap with the WRAM3 map at the field scroll) the full 64×64 map (WRAM3 tilemap + WRAM2 attributes) is the floor, every solid metatile of the collision grid (WRAM6) is extruded as a box in one batched mesh, actors are billboards (inflated bodies in voxel mode) placed by the map-space camera (`wC320-C323`), and dialogue boxes are shown at the top middle of the view: the game writes them into the BG tile map over the scenery (not the window layer), so the visible BG tiles that differ from the WRAM3 map at the field scroll, plus any scanlines the PPU drew from the window (`ppu.winX`, raster splits included), are cut out of the 2D frame and stacked below the touch HUD. The game has no object data for buildings and trees (they are painted tiles; the collision grid only outlines the walkable area, and the BG priority bit is set only on the few tiles the player walks behind); automatic ground/object splits by tile repetition (`tools/seg_map_objects.py`) or by colour (`tools/seg_map_colors.py`) fail because grass, canopies, walls and court surfaces share palettes and dithering. Objects therefore come from hand annotations per map (`FIELD_OBJECTS`): building blocks become boxes (roof rows on top, facade rows as the front wall, darker side walls), stamps mark one tree/bush whose every tile-identical copy stands up as a keyed cut-out (an inflated voxel body in voxel mode), and cards stand up fences and posts; the floor under cut-outs is patched with the ground strip below them. All top-down RPG maps are annotated (`web/js/field_objects.js`, checked with `tools/field_objects_preview.py`); annotations beyond the map size (`wMapWidth/Height`) are ignored, and the collision-grid boxes are dropped under annotated objects. Map 19 (the road between the courts) is a side-view picture but a walkable map: it is a field whose sky band, cafe front, trees and signs stand up as cut-outs; map 21 (the island, an aerial picture) is shown as parallax layers instead. The field view is detected by sampling the screen through both scrolls (the field scroll `wC320-23` runs a pixel or two ahead of SCX while walking) with a tile of slack, and is kept until several checks in a row fail, so walking, map-to-map fades and LCD-off frames never drop to the flat view. Actors are matched to the game's actor slots (WRAM4 `$D000`, 24 × `$40`: position at +$0C/+$0E in 1/256 tile, height +$10, object +$21): the game only puts actors on its 160×144 screen into OAM, so each actor's look is remembered from when it was last wholly on screen and drawn at its real position while it is off the Game Boy screen or cut by its edge; no shadow is drawn under them. Every other scene (title, menus, name entry, dictionary, mini-game menus) is a static layered view: the PPU records a background-only frame and, per pixel, the tile-map cell it showed (`ppu.bgFrame`, `ppu.pixCell`, so mid-frame scroll effects such as the scrolling menu banners stay intact); cells whose palette is rare along the screen border, or that carry the BG-priority bit, are panels (boxes, icons, logos, text; components under 64 px are dropped), the window layer is its own layer, and backdrop, panels, window and sprites stand at increasing depth with soft drop shadows. The camera does not move; each layer is scaled so its pixels stay where the game draws them, and the view is fitted below the touch button bar. Touch movement uses a floating analog stick by default (`web/js/stick.js`, STICK/D-PAD button): the thumb's direction is quantised into the game's eight d-pad directions with a radial dead zone, and physical sticks (Gamepad API, Android bridge) use the same sector rule. The VIEW button picks the screen shape: Fill, 4:3 or 10:9; in 2D at 4:3 a court is composed 192 px wide from VRAM (`web/js/wide.js`: BG, window and OAM with the frame's scroll) so both sides show the real map at 1:1 pixels, while other scenes are pillarboxed; the 3D view is simply letterboxed to the shape. The 3D canvas renders at device pixels (capped at 2x). Headless checks: `web/tests/view3d_probe.mjs` (scenes by frame number, every preset and style), `view3d_field.mjs` (RPG snapshot) and `play_match.mjs` (a bot plays a whole match from power-on, 2D + 3D shots per point).
* **Core save states** (`web/js/gb/state.js`): every field of the CPU, memory, PPU, APU, timer and joypad, so a restored machine continues bit-identically (same frame hash and cycle count). `web/tests/tour.mjs` plays long button scripts headlessly in Node from a checkpoint to the next (with `--sram` it powers on with another state's battery save), `state_view.mjs` renders checkpoints in the page in 2D/3D, `talk_probe.mjs` searches an RPG map for NPCs to talk to, `save_flush.mjs` checks that a pending save is written when the page is hidden. The page writes the cartridge save 0.5 s after the game's last write, and immediately when it is hidden or the Android app pauses.
* **Session recordings** (`web/js/recorder.js`, the REC button): the start state plus one byte of buttons per frame and a frame hash every 60 frames (about 200 KB per hour before gzip). On Android the file goes to Downloads/MTenn3D with the share sheet; hiding the app stops and saves. `web/tests/replay.mjs FILE.mtrec` replays it on the core in Node, checks every hash, and can write screenshots (`--shots`) and core states (`--states`) for `state_view.mjs`; `rec_roundtrip.mjs` tests the whole path.
* **Snapshots**: `tools/emu_dump_snapshot.py` dumps a PyBoy state as JSON and `web/js/gb/snapshot.js` resumes it in the core (registers, banks, all RAM, I/O, palettes from the game's shadow buffers), so any emulator state becomes a test fixture for the page (`web/tests/snapshot_frame.mjs`, `view3d_field.mjs`).
* **Match format**: 2- or 6-game sets, 1/3/5 sets (`Match` counts sets with `SetCheck`/`MatchCheck` rules: N games with a 2-game lead or the tiebreak, match at (sets+1)/2). The HUD shows `sets.games` per side in a multi-set match.
