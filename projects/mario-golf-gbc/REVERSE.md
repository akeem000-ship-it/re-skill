# Mario Golf (Game Boy Color) — Reverse Engineering Notes

## Binary Identification

From `python3 tools/header.py` (all values checked against the dump; they agree with Data Crystal's USA column).

| Field | Value |
|-------|-------|
| File | `rom/mario_golf.gbc` (dump name `Mario Golf (USA).gbc`) |
| SHA-1 | `7f2062e51b4fc87378c1d5e6b9578c9277b94e0b` |
| MD5 | `83f791645ce282093a9d59c121ffc49d` |
| Size | 2 097 152 bytes = 128 banks of 16 KiB |
| Title / maker code | `MARIO GOLF` + `$00`, manufacturer code `AWXE` ($013F) |
| CGB flag ($0143) | `$C0`: CGB only |
| Licensee | new `01`, old `$33` (Nintendo) |
| SGB flag | `$00` (none) |
| Cartridge ($0147) | `$1B` MBC5 + RAM + battery |
| ROM size ($0148) | `$06` = 2 MiB |
| RAM size ($0149) | `$02` = 8 KiB SRAM (Tennis: `$03`, 32 KiB) |
| Region / version | `$01` overseas, mask ROM version `$00` |
| Header checksum | `$7A` (computed `$7A`, OK) |
| Global checksum | `$0FC7` (computed `$0FC7`, OK) |
| CPU | Sharp SM83 (LR35902) |
| Entry point | `0100: nop ; jp $0150`, `0150: jp $2DA0` (Start) |
| Build stamp | `0153`: ASCII `9908020118` + `$00` (reads as 1999-08-02; Tennis has its stamp at the same address) |

---

## Memory Map

Standard Game Boy Color map. Project-specific uses so far:

| Address Range | Purpose |
|---------------|---------|
| 0000-3FFF | ROM bank 0 (home). Used up to `$3100`; the rest is `$FF`. |
| 4000-7FFF | switchable ROM bank (MBC5, shadow in `hROMBank` = `$FF95`) |
| 8000-9FFF | VRAM, 2 banks |
| A000-BFFF | 8 KiB battery SRAM (enabled through `MBC5_RAMG`; Start writes `$00` = disabled) |
| C000-CFFF | WRAM bank 0. SoftReset clears `C000-CFEF` (ClearMemory16, `c = $FF` x 16 bytes); the stack starts at `$D000` and grows down into it. |
| D000-DFFF | WRAM banks 1-7 (shadow in `hWRAMBank` = `$FF96`); GameMain clears all seven (ClearMemory16 with `c = 0` = 4 KiB each). |
| FF80-FFFE | HRAM. `$FF80-$FFEF` cleared by Start; the OAM DMA routine is copied there (CopyOAMDMARoutineToHRAM, 00:066C). |

---

## Decompile Coverage (tools/trace_code.py, tools/coverage.py)

Every routine the code tracer reaches has a name and a comment in labels.csv: **242,689 bytes of traced code,
100.0% in named routines** (about 3,200 routine entries; labels.csv has ~3,600 ROM labels). `coverage.py` counts a code
byte as named when the nearest entry at or below it has a name; `coverage.py --list BB` lists unnamed entries.

What the tracer follows (so the 100% is of this set):
- the vectors, the `$4000` export tables of code banks, far calls (`rst $10/$18`), `rst $00` inline tables,
  calls with inline arguments (PlaySoundCmd, the game-flag Cmd routines, WaitFramesCmd), every labelled routine;
- code pointers passed in registers: RegisterFrameTask, CallHLInBankA, SetGolfEventHook tables (events 0-4),
  jump tables (`ld hl, T ... ld a, [hl+] ; ld h, [hl] ; ld l, a ... jp hl`, DispatchByGameMode 08:470D,
  11:4D79), `ld hl/de/bc` immediates naming an untraced same-bank routine (e.g. door animations);
- the overworld map scripts (tools/map_scripts.py: enter / talk / object / trigger, and the lists scripts patch in
  with ScriptSetMapField 0A:4BFF), actor scripts (bytecode; op `$12` calls native code);
- unreferenced (dead) routines: untraced gaps right after traced code that decode as whole routines.

It stops at the `$FF` fill and does not seed data labels (names ending in `Table` / `Data`, plus a few older
data names). Code it cannot see would be reached only through pointers computed at run time in ways not listed
above; the scans used to look for such code (pointer tables into untraced code, code-like untraced runs) found
nothing left in the code banks. Data banks (graphics, holes, text, songs) are not code and are not counted.

### Rewrite progress (tools/decomp_progress.py)

The rewrite runs the game's behaviour in JavaScript without an emulated Game Boy (`web/js/golf/`), reading only
data from the ROM. `decomp_progress.py` counts the traced code bytes in routines that the rewrite (every
`web/js/**/*.js` except the emulator core `web/js/gb/`, and the Python ports) cites by
`BB:AAAA` (byte -> routine as in coverage.py); a routine named only to say it is not rewritten (display, sound,
a branch not ported) is written `~BB:AAAA` and does not count.

| Step | Rewritten code bytes | Share |
|------|----------------------|-------|
| Python ports only (tools/golfmath.py ... hole_py.py) | 15,506 | 6.39% |
| + JS engine web/js/golf: math, ball, cup, launch, swing, shot, hole, joypad | (JS port of the same) | |
| + round.js: the round start and the hole set-up from the ROM | 17,558 | 7.23% |
| + round.js: after a shot, the stroke limit, hole end, next hole, round end (mode 3) | 17,900 | 7.38% |
| + frame-exact set-up: camera, fades, the aiming menu and target marker (aim.js, view.js, camera.js, screen.js) | 21,904 | 9.03% |
| + the computer golfer's shot planner, all of bank 3C's planning (ai.js) | 29,973 (web/js/golf; `--dir golf`) | 12.35% |
| + the computer golfer in play: its turn of the aiming menu (10:5978) and its swing (SwingMeterCPU 10:5643) | 30,105 | 12.40% |
| + the native screen (render/: display model, rasterizer, the views, HUD, sprites, the view behind the golfer), the captions, pictures and scorecard between shots and holes, match play (match.js), a new game's set-up (start.js) | 51,952 | 21.41% |
| + the text printer and the glyph renderer (text.js, banks 03 / 05), the match standings screen (3E:403F), the match-play scorecard page (0E:762F), the result screen (0B:59DE) with the map actors (bank 04), map graphics (0B) and BG shadow (05) | (all sources) 70,512 | 29.05% |
| + the window and menu engine (windows.js, bank 05) and the golf pause menu (pause.js: 08:4666, bank 41) | 75,192 | 30.98% |
| + the front end: power-on (boot.js: SoftReset, GameMain, the save RAM's set-up, map 0's run with its actors and tile animation), the title and its demo (title.js, bank 40), LinkMenu (menu09.js), the character select (charsel.js, bank 06), the mode and course selects (select.js, banks 0D / 0F), ModeSelectMain (modesel.js) | 86,427 | 35.61% |
| + saved games (save.js: bank 02's save code, SaveGame, RecordShot, the mid-round saves; loading a slot in ModeSelectMain) | 87,023 | 35.86% |
| + the message box (msgbox.js, bank 05 / 0A), the pause menu's Give Up and Quit, the flow after a round (GolfSessionEnd, the map engine's next run), the EXP screen and AwardExpPoints (exp.js, bank 48) with the menu character sprite (charsprite.js, bank 42) | 93,495 | 38.52% |
| + the rest of the pause menu: Settings, Camera Mode (freelook.js), Course Map (coursemap.js, bank 17) | 96,695 | 39.84% |
| + the level-up screen (levelup.js, bank 41; CheckLevelUp, CharLevelUpDiff, CharRefreshStats of bank 02) | 101,871 | 41.98% |
| + Training (the course and hole select 0F:4AD6, the after-shot menus and RetryShotRestore, the training pause menu, the menu arrows of flags #49-#52) | 103,011 | 42.45% |
| + Tournament (tournament.js: the rivals of bank 3C, the standings of bank 0E, the course statistics of bank 08; the standings page 0E:5209; the placing screen 0B:5B00) | 107,090 | 44.13% |
| + continuing a saved round (the card ExpScreen a = 0, LoadSummaryPrompt 32:7D35, TwoChoicePrompt) | 108,218 | 44.59% |
| + Give Up after a stroke, the stroke limit's HUD redraw | 108,330 | 44.64% |
| + the sound driver's copies in banks 7C / 7D (tools/sound_copies.py: identical to 7E) and the last small routines of 7E / 7F | 114,431 | 47.15% |
| + the map engine and its script API (mapengine.js, script.js, maps/), a new character (StoryOpeningCreateCharacter 31:43B9, CharYesNoPrompt 41:6784, NameEntryScreen 06:51DC), the first day (32:71CF), walking and talking on the overworld (player.js, MapEventLoop 0A:4AAA) | 123,691 | 50.97% |
| + the map's start menu (MapStartMenu 41:6E6E: text speed, Save & Quit), the clubhouse's doors and counter (map $03), the Locker Room (map $06, bank 34), the Lounge's first visit (map $04, 32:6739), map $05's scripts, MapBufCopyRectRedraw 0B:4864 | 126,615 | 52.17% |
| + the Caddie Master's offices and the club rounds (maps $08-$0B, bank 33), the award ceremonies (31:7775), the Field (map $02, 34:4690) with the navigation (0A:7174, 0A:7878), the golf event hooks (10:4CC3), the Marion driving range and approach range with their practice and lessons (maps $0C / $0D, banks 31 / 30, maps/lessons.js), ShowMessageAt 05:5E70, the practice pause menus, the replayed strokes (02:4626) | 137,216 | 56.54% |
| + the putting greens' challenge, putt demo and practice (maps $0E / $11 / $14 / $17, 30:69B9-30:6EC8), the mini-game pause menu (41:6F9F), the Palm driving range's and approach range's lessons (maps $0F / $10, 31:5543, 30:4B62) | 141,468 | 58.29% |
| + the Dune driving range's and approach range's lessons (maps $12 / $13, 31:5E63, 30:52CB), the course view's tile animation of banks $51-$54 (13:7076) | 144,903 | 59.71% |
| + the Links driving range and approach range with their lessons and contests (maps $15 / $16, 31:67C8, 30:597C), the Field's marker sprite (34:4FCC) | 149,812 | 61.73% |
| + the letter at the tree (34:4847), its reading on map $25 (35:79D2) and the path's opening (34:5019), the Grand Champion's return to the Field (34:5218) | 150,992 | 62.22% |
| + the start menu's Char. Data (41:6506 with the name and EXP header 41:5598 and the clock task 41:587C) and Stars (0A:6F56, the event list) | 152,559 | 62.86% |
| + the Lounge's champions (32:6B81) and partners: joining (32:6DCF), following (04:484D), spawned on each map (04:51D0), the counter's partner lines (32:5B5A / 5BBE), sent away (0A:536E) | 153,898 | 63.41% |
| + partners in the offices (33:4ABB, the Match Game against the partner 33:4F4B, the question before leaving 33:4FEF) and on the Field (34:5530) | 154,202 | 63.54% |
| + the Match Game Event after a won match (map $30, 34:77EB with the club rooms 34:7CED) | 155,254 | 63.97% |
| + the Road to Peach's Castle (34:450C, map $1C) and Peach's Castle up to the tournament's question (map $1D, 33:5F42) | 159,490 | 65.72% |
| + Peach's Tournament: its opening (33:642C), the round and the award ceremony for the places (33:672A) | 159,673 | 65.79% |
| + the ending: EndingSequence 0A:56B1 with the sepia fade, the credits (bank 0B), the final screen (bank 79) and the ending's maps $31-$3E (bank 35); ShowPictureTimed 40:6666 | 168,762 | 69.54% |
| + the Trophy Room (map $07), Peach's Castle's 1-Up Mushroom and Toad's practice round; the scorecard's pars fixed for courses 3 and up | 169,385 | 69.80% |

(All sources together, with the sound driver of web/js/sound: 55,947 bytes, 23.05% when the native screen was
added; before it 34,056 bytes, 14.03%. The later rows count all sources.)

The JS engine (`rom.js` ROM and LZ access, `memory.js` the RAM layout, `math.js`, `ball.js`, `cup.js`,
`launch.js`, `swing.js`, `shot.js`, `hole.js`, `joypad.js`, `round.js`) is checked by two Node tests:
- `web/tests/golf_vs_recordings.mjs`: the 27 shot recordings and the 4 whole holes of tools/shot_suite.py and
  hole_suite.py match event for event, and so do the first three holes of the Stroke round (tools/round_suite.py),
  through each hole's end and the next hole's set-up (wind, pin, tee) to its address step;
- `web/tests/golf_hole_setup.mjs`: **frame by frame** from the RAM at GolfRound's entry to the first address step
  (10:56B0): the round start, the hole set-up (wind, HoleIdFromCourse, LoadHoleInfo, players at the tee), the
  intro fly-over (180 frames on the green, the camera's pan until CameraAtGoal), StrongWindIntro, ShotSetup, the
  aiming menu (club changes, aim turning with its acceleration, B shot modes and putter ranges, Select's look at
  the pin) and the load of the view behind the golfer, with the joypad the game read: every AdvanceFrame's RAM
  ($C800-$C8FF, WRAM6 $D300-$D5FF except camera/HUD/caption bytes) and the steps' frames match on 24 cases
  (tools/hole_setup_suite.py: holes of courses 0-10, random seeds, menus used, the computer golfer), the landing preview and target
  marker included; with `--minimal` the same from zeroed RAM plus only the inputs (records `$C800-$C8FF`, seed
  `$FFFC`, event overrides `$D4DE-$D4EF`).
- `web/tests/golf_ai_routines.mjs`: the computer golfer (`ai.js`, bank 3C: CpuPlanShotMain 3C:426A and the 40
  routines under it: putts, approach, tee club, target and landing-spot searches, hazards, trees, wind) is fuzzed
  against the ROM itself: each routine runs in the emulator core (`web/tests/golf/romcall.mjs`, a call from a
  register set to its `ret`) and in JS from the same random RAM (hole set-up states, random ball, wind, golfer,
  stroke, seed), and the returned registers, `$D300-$D5FF` and the seed must match (300 states each: all match).
  Quirks kept: CpuFindFairwaySpot 3C:4A51 calls VectorFromLengthAndAngle16 00:11BA without saving bc after a
  hazard, so the aim becomes the sine-table index it leaves, and d/e become the point's y (the search can then
  circle for ever: the game hangs; JS throws there); NextAimOffset indexes its table with an 8-bit `d x 2`;
  CpuFindClearAim stores its caller's leftover bc at `$D553`; CpuClubDistanceForLie uses the lie row of the
  current club, not the one asked; CpuHazardNear scans only the first row; route tables past hole `$63` read code.
  In play (`aim.js` cpuAim, `shot.js` cpuSwing): a golfer whose PlayerField `$13` is 1 (`$D4D7`) gets
  CpuPlanShotMain's club, mode, aim and swing targets (`$D4D8` power, `$D4D9` impact, `$D4DA` d-pad); the marker
  slides out over 3 frames, then 60 frames; the CPU swing runs the cursor the whole way up ($3C frames, the power
  taken where it passes the target; the putter stops there), then down to the impact target.
  The hole set-up cases cpu1-cpu4 (player 1 poked to the computer at GolfRound's entry) match frame by frame to the
  address step, and `golf_native_round.mjs cpu18` (tools/round_suite.py cpu18) has the computer play all 18 holes
  of the Stroke round: all 58 shots, address steps and hole-end records match the game.
- `web/tests/golf_native_round.mjs`: **all 18 holes of the Stroke practice round played natively** (game.js:
  GolfRound from its entry, no state taken from the game on the way): with the swings' buttons a bot played in the
  game (tools/round_suite.py r18: tools/emu_round_inputs.py), all 69 outcomes, the ball, club and aim at all 69
  address steps and the records at every hole's end match the game (the captions, pictures and the scorecard
  between shots and holes now run their frames too; see "The native screen").
  Frame details learnt: frame tasks are off while `$FF8F` is 0 (BuildBehindView's second frame); fades step once
  per VBlank (`$FFA2-$FFA4`, WaitFade 00:2625: 8 frames at speed `$10`); HudInit sets `$D328`/`$D44D`, HudDrawWind
  clears `$D326-$D328`.

#### The native screen (web/js/golf/render; web/tests/golf_render_vs_core.mjs)

The ported routines write a display model instead of the hardware: VRAM banks 0 and 1, OAM, the BG and OBJ
palette RAM and LCDC / SCX / SCY / WX / WY (`render/display.js`, with the bank-0 display helpers: the VRAM copy
queue `$C0A0`, the BG row / column blits `$C300-$C3FF`, the palette loaders and `hPalUpdate`, the sprite queue,
LZ to RAM, VRAM DMA, LCD off / on and VBlankHandler's display part). `render/raster.js` draws 160 x 144 from the
model by the CGB's rules (no dependency on the emulator core). The engine is a generator (`yield` at each
AdvanceFrame), so a page steps it one frame at a time.
Ported for the screen: the course and green views (bank 13 loaders, `DrawHoleViewTiles`, MapScrollTask 04:4072,
the water tile animation of bank 50), the HUD (bank 12), the ball display objects (bank 11), the golfer's map
sprite and animation (banks 04, 11, 26), the view behind the golfer (banks 15, 16 and the scenery banks 4A-4F),
the captions (3B:4339 ShowCaption, CaptionMotionTask, ShowCaptionAndWait) with the caption pictures of bank 4F
(StartCaptionAnim / CaptionAnimTask), OutcomeRules 3B:7260 with all its branches, the player's pictures (3B:7717
ShowPlayerPicture, bank 77 LoadStoryPicture / StoryPictureAnimTask / DrawStoryPictureFrame, 3B:773F
WaitPictureTimeout), the cup close-up (13:44A4 / 13:4528), the water splash (12:6A7F / 12:6A9C), StrongWindIntro's
gust sprite, the scorecard between holes (0E:43D6 ShowScorecard, the one-player page 0E:6C7A and its drawing,
MapDrawFullScreen 0B:4306), the picture after nine holes (48:5E42, 01:41E8) and the round's end fade (08:4F03).
The ported routines also give their sound commands (`rst $08`, tools/sound_sites.py lists them per routine).

`golf_render_vs_core.mjs` runs the native round beside the emulator core (`web/tests/golf/lockstep.mjs`: the
same buttons; the core runs each frame's code ahead to its next AdvanceFrame, so that the buttons a lag frame makes
the game's code read are given to the native frame too; a slip is a step the core reaches frames later) and at
every frame compares VRAM, OAM, the palette RAM, the LCD registers and the display RAM, and the two rasterized
screens; at every finished core frame it also checks the rasterizer against the core's own PPU. Lag frames (the
game's code running past a VBlank: the fades, the play clock and the queues advance without it) are counted
apart, and so are later differences in bytes that have differed since one (a lag VBlank can blit a BG row before
the LCD goes off).
The game's lag VBlanks are replayed on the native side: a VBlank that finds hVBlankDone set does only the
every-frame work (00:2F46-00:2F64: the palette update, the game timer, the fades, the VBlank tasks). AdvanceFrame's
`halt` always waits for one more interrupt, so the frame's own VBlank is the one its wait wakes at (with the LCD
off, the code's last one); the native frame's VBlank stands for it and the others are replayed right after the
game's code for the frame, a fade step only when the native fade is where the game's was at that VBlank (in the
long loads the game lags through, the view behind the golfer, the native round has its own frames). A step the
native round marks that the core passed k frames earlier (its code lagged past a fade's VBlank) holds the core k
frames. Results (all 18 holes, no slips, all sound commands the same):

| Round | Frames | Pixel-exact | Rasterizer vs PPU | Sound commands |
|-------|--------|-------------|-------------------|----------------|
| r18 (the bot's Stroke round) | 45,693 | 45,518 (the other 175 in lag frames) | 47,135 frames, 0 differ | 712 / 712 |
| cpu18 (the computer golfer) | 34,459 | 34,307 (the other 152 in lag frames) | 35,816 frames, 0 differ | 620 / 620 |
| match18 (match play, computer vs computer, through the standings, scorecards and the result screen) | 63,558 | 63,239 (the other 319 in lag frames) | 66,286 frames, 0 differ | 1,049 / 1,049 |

`web/tests/golf_screens_vs_core.mjs` checks single screens: the core is saved at a routine's entry
(`web/tests/golf/mkstate.mjs` in a lockstep round, `mkstate_core.mjs` by the core alone, `boottrace.mjs` from
power-on with a button script), the native routine runs from the same RAM and display (`web/tests/golf/screenstep.mjs`)
with scripted buttons, and every frame's display and, at the routine's return, all RAM are compared (a free entry
of the VRAM copy or tile-write queue is left out: which slot a copy takes follows the lag; the game's rDIV reads are
given to the native code). All cases match frame for frame:

| Case | Routine | Frames |
|------|---------|--------|
| standings_match18 | 3E:403F MatchStandingsScreen | 22 |
| scorecard_match18 | 0E:43D6 ShowScorecard (match play: Right / Left between the pages, A) | 152 |
| result_match18 | 0B:59DE RoundResultScreen (match play) | 137 |
| pause_r18_b / _move / _scorecard | 08:4666 PauseMenu (B; cursor moves and Start; Scorecard) | 69 / 129 / 152 |
| pause_scorecard_back | 10:4798 ShotSetup through the pause menu's Scorecard and back to the address step | 612 |
| picture_hole_in_one | 3B:7717 ShowPlayerPicture with picture 0 (and 4A:6205 LoadCyclingPicture) | 18 |
| boot_title / _skip | 40:4032 TitleScreen with its attract loop (the demo skipped, the title timing out) | 2,617 / 2,217 |
| boot_linkmenu / _b | 09:4A12 LinkMenu | 290 / 311 |
| boot_charselect / _moves | 06:6071 CharacterSelectScreen | 247 / 309 |
| boot_modeselect / _moves, boot_courseselect / _moves | 0D:4AA7 GameModeSelect, 0F:4AB7 CourseSelect | 257 / 317, 289 / 309 |
| boot_modeselectmain | 32:5037 ModeSelectMain, the title to the Stroke round's GolfRound call | 2,929 |
| boot_poweron | power-on (00:0100, an empty save RAM) to the Stroke round's GolfRound call | 2,929 |
| boot_newchar | power-on, the empty slot: a new character (map $1E 31:43B9, 41:6784, 06:51DC), the first day (map $05 32:71CF), to the mode select | 7,647 |
| boot_kid_story_walk | a saved character's story: the clubhouse (map $03), walking, a talk, running (MapEventLoop 0A:4AAA, 04:538C) | 3,940 |
| boot_kid_story_menu | the story's start menu: the text speed, Save & Quit (MapStartMenu 41:6E6E; the save RAM equal) | 4,040 |
| boot_kid_story_door3 | through a clubhouse door to the Locker Room (32:5CAF, map $06), a locker opened (34:41E8) | 4,040 |
| boot_kid_story_lounge | through door 4 to the Lounge (map $04), the first visit's tour (32:6739) | 7,199 |
| boot_kid_story_office | the top door to the Caddie Master's office (map $08, 33:4722), his call and round menu, the club tournament (one hole: flag #72 poked), back to the office: the result speech | 12,930 |
| boot_kid_story_ceremony | the same with the result poked to 1 after the round: warp 6 to the Marion Club's award ceremony (map $18 entrance 2, 31:7775 / 31:78E1), back to the office: the winner's speech | 14,490 |
| boot_kid74_ceremony | the mode select's one-hole Tournament with the return point poked as a win sets it (map $18 entrance 2, kind $32): the ceremony, then warp 2: the mode select | 8,907 |
| boot_kid_story_practice | the office's Practice Round (one hole), back to the office, the menu again | 13,434 |
| boot_kid_story_field | out of the clubhouse to the Field (map $02, 34:4690), to the Palm Club's office (map $09, its decoration 33:55A3), the call and the menu (not qualified) | 4,885 |
| boot_kid_story_nav | on the Field: A, the Navigation menu (0A:7174), a place picked: the guide's name window; Start, the start menu's Navigation (41:7413), B | 4,466 |
| boot_kid_story_range | the office's way to Hole 1: the Marion driving range (map $0C, 31:4BEC), "Practice here?" (31:51F4): the practice round with its hooks (31:5296), the pause menu's Quit Practice, back on the range | 6,057 |
| boot_kid_story_lesson | the range's first coach (31:4A8B): his replayed demo (golfer $4F, the hooks 31:4C98 with ShowMessageAt 05:5E70), the player's try (31:4ED5, the hooks 31:4D14, the judgement 31:4E5A), the result (31:4D9C), "Try again?" and another try | 8,568 |
| boot_kid_story_approach | the office's way to the approach range (map $0D, 30:429A): the first coach's running approach (30:4119: demo with the hooks 30:433E, the try 30:43AF with the club kept in wEventShotClub, the result 30:4448), a retry | 8,317 |
| boot_kid_story_palmrange | the Palm Club's office (#112 poked: qualified, the Caddie Master out of the corridor) to its driving range (map $0F, 31:5543): the first coach's intentional shot (31:540E: the demo with the coach's 210 drive, the try, the judgement 31:5800, the result 31:5711), a retry | 8,885 |
| boot_kid_story_palmrange_wind | the same, the second coach's shot into the wind (31:54A2, the hooks 31:5943-59FC, the result 31:5A27); 646 frames counted after lag frames: a lag VBlank in the demo's ball flight (frame 6091) streams the BG map's hidden row $9BE0 for another camera step on each side, and it stays different (off screen, the pixels the same) until the next hole's set-up at frame 6700 | 8,865 |
| boot_kid_story_palmapproach | the Palm Club's office (#112 poked) to its approach range (map $10, 30:4B62): the first coach's bunker shot (30:4A26: the demo's hooks 30:4C27 / 4C6F, the try's 30:4CA3 / 4CCB, the result 30:4CF9), a retry | 8,374 |
| boot_kid_story_palmapproach_sloped | the same, the second coach's running approach on a sloped green (30:4AAF, the hooks 30:4E67-4EF5, the result 30:4F23 without its ScriptEnd), a retry | 8,687 |
| boot_kid_story_dunerange | the Dune Club's office (map $0A, the Field's trigger 3; #113 poked) to its driving range (map $12, 31:5E63): the first coach's high shot (31:5D2A: the demo's hooks 31:5F27 / 5F52, the try's 31:5F78 / 5FB5, the judgement 31:607B, the result 31:5FE8; course 7 hole $0D animates its tiles from bank $51), a retry | 8,586 |
| boot_kid_story_dunerange_tree | the same, the second coach's low shot out of the trees (31:5DBF, the hooks 31:61B5-6263, the judgement 31:6321, the result 31:628E), a retry | 9,111 |
| boot_kid_story_duneapproach | the Dune approach range (map $13, 30:52CB): the first coach's backspin approach (30:51A7, the hooks 30:538F-541D, the result 30:545F), a retry | 8,764 |
| boot_kid_story_duneapproach_uphill | the same, the second coach's approach up the climb (30:5230, the hooks 30:55E1-566F, the result 30:56AE without its ScriptEnd), a retry | 8,852 |
| boot_kid_story_linksrange | the Links Club's office (map $0B, the Field's trigger 4; #114 poked) to its driving range (map $15, 31:67C8): the first coach's tree shot (31:65B8: course 0 hole $0A; the hooks 31:6909-6A02, the judgement 31:6B8B, the result 31:6A56), a retry | 9,285 |
| boot_kid_story_linksrange_buried | the same, the second coach's buried lie (31:666F; wP1OffTee written $21; the hooks 31:6CD6-6DB8, the judgement 31:6F45, the result 31:6DF8), a retry | 9,341 |
| boot_kid_story_linkscontest | the same with the Links won (#114 #115 #125 #139, the lesson passed #174 poked): the Field with the marker sprite (34:4FCC, the task 34:46DF), the tree shot's contest (31:7051 sets #224: the coach's demo for his distance, the player's shot, the result 31:6AE3), then the contest again | 9,074 |
| boot_kid_story_linksapproach | the Links approach range (map $16, 30:597C): the first coach's approach over a mound (30:5A94: the demo's music 7, the hooks 30:5BF2-5C80, a try without a forced shot, the result 30:5CC2), a retry | 8,897 |
| boot_kid_story_linksapproach_slope | the same, the second coach's approach across a slope (30:5B2B, the hooks 30:5E3C-5ECA, the result 30:5EF8 without its ScriptEnd), a retry | 8,449 |
| boot_kid_story_linksapproachcontest | the same with the Links won and the mound lesson passed (#172 poked): the contest (30:6414 sets #224; the offer 30:6159, game mode 5, ten approaches counted on the HUD by the hooks 30:6052 / 605C), the result (30:60DA) | 11,846 |
| boot_kid_story_letter | the Links won (#114 #115 #139 poked): on the Field, A at the tree (trigger $0F, its cell set by 34:4719): the sparkle (34:52C0), the letter falls (34:512E), map $25 reads it (35:79D2: #123, the save flag $1E0), the Field's entrance $0F: the path opens (34:5019: the flying sprite 34:51B9, the burst 34:5396, #125, 34:46E6, the marker's frames and task) | 6,953 |
| boot_kid_story_chardata | Start in the clubhouse: Char. Data (41:7943 -> 41:6506: the stats screen with the name, EXP and clock header), A back to the map; Start, Down, A: Stars (0A:6F56): Right twice through the pages (0A:6E47), Down to scroll, Left, B back | 4,860 |
| boot_kid_story_champ | the Lounge's tour, then the Marion Club Champ (32:63A8 -> 32:6B81): Yes twice, he joins (32:6DCF) and follows (04:484D); a walk, out to the clubhouse (04:51D0 spawns him with the player), the counter's partner line (32:5B5A) | 10,056 |
| boot_kid_story_champ_part | the same join, then A on the partner (0A:5365 -> 0A:536E): Yes, he leaves (the flags cleared, warp $FA), then his own talk again at his place | 8,918 |
| boot_kid_story_partnermatch | the champion joins; the Caddie Master's call with a partner (33:4ABB): Yes, the walk out, the Match Game against him (33:4F4B, one hole: #72 poked), back to the office (33:4666: result 2, the partner leaves), his next call (a tournament) | 19,269 |
| boot_kid_story_matchwon | the same Match Game won (the result poked to 1 after the round, #86 poked): warp 9 to the Match Game Event (map $30, 34:77EB: the club's room, the beaten champion's scene with the other three), back to the office (wStoryRoundKind $5A) | 23,309 |
| boot_kid_story_castle | the path open (#114 #115 #139 #123 #125 #149 poked): the Field's trigger 5 (34:450C) to the Road to Peach's Castle (map $1C), A on the launcher: the Bob-omb's launch (33:57CE) to Peach's Castle (map $1D): the first visit's welcome (33:60B2), "May we begin the tournament?" (33:66DC) No | 9,141 |
| boot_kid_story_peachround | the same, Yes: the tournament's opening (33:642C), Peach's Tournament (course 5, one hole: #72 poked; the result poked to 5), back at the castle (33:5F8F) | 15,349 |
| boot_kid_story_peachsecond | the same with the result poked to 2: the award ceremony (33:672A) for the second place, then the castle (33:69B2) | 16,549 |
| boot_kid_story_peachwin | the same with the result poked to 1: the winner's ceremony (#111, the save), the character's picture (40:6666), the ending (0A:56B1: maps $31-$3E in sepia under the credits, the copyright, the final screen for 3600 frames), map 0 by warp $FA | 40,569 |
| boot_kid_story_castletoad | the castle with the door open (#127 poked): the 1-Up Mushroom (33:6F47, the level-up screen), Toad's practice round (33:5D8D: course 5, one hole), back at entrance 2 | 12,587 |
| boot_kid_story_trophies | the clubhouse's door 5 to the Trophy Room (map $07, 35:41B2; #112 #136 #113 poked): A at the Marion and Palm trophies (35:4115 / 4126) | 4,721 |
| boot_kid_story_partnerleave | the same call answered No (33:4B91); out by the driving range's trigger: the partner's question (33:4FEF) No (a step back), again Yes (he leaves), the range | 11,626 |
| boot_kid_story_partnerfield | the champion joins, out to the Field, up onto Windy Valley's trigger: "Quitting this Match Game?" (34:5530) No | 10,452 |
| boot_kid_story_green | the office's way to the putting green (map $0E, 30:69B9), "Practice here?" declined, the pro's putting challenge (30:6739, game mode 5, the hooks 30:6C2F / 6C58), the result (30:6CF2, not cleared) | 12,839 |
| boot_kid_story_green_quit | the same, Start at the aim: the mini-game pause menu (41:6F9F), Quit Mini-Game | 7,647 |
| boot_kid_story_green_cleared | the same with ten made (poked): cleared, 25 EXP (30:6EC8), the level-up screen, SaveGame, the map again at $FA | 12,839 |

By situation (r18): at the address step 7,194 of 7,194 frames pixel-exact, on the green 4,279 of 4,279, the swing
and the roll 17,881 of 17,884, the ball in the air 13,823 of 13,827, holed out and between holes 54 of 54 (the
lockstep presses A on alternate frames there, so captions and the scorecard are short).

#### The play page (web/play.html, web/js/play.js; web/tests/play_page.mjs)

The page loads the user's ROM (fetched from rom/ or picked; SHA-1 checked) and runs the game natively from
power-on (`game.js` playFromPowerOn: `boot.js` SoftReset, GameMain and map 0's run; the opening picture, the demo,
the title; LinkMenu, the character select, the mode and course selects as far as a new game has them: one player,
a preset golfer or a saved character, Stroke or match play), then the round. The save RAM is kept in
localStorage as the emulated page keeps it (`mg-sram-` + the ROM's SHA-1, 12 digits; base64 of the 8 KB), read at
power-on and stored when the game writes it. It steps the generator once per 59.73 Hz frame, rasterizes the display
model to a canvas and plays the native sound driver (js/sound) through Web Audio; keyboard, gamepad and touch as on
the emulated page; Start is the game's (the pause menu while aiming: its Scorecard works), P pauses the page. The
selector can also start straight at a round as a new game would (`start.js`: the path ModeSelectMain 32:5037 takes
for a new game: NewGame 02:4E3D, CreateCharacter 02:4E82, CharComputeStats 02:4F07, SetupPlayerGolfer 02:4A28 for
preset golfer 8 (Mario), GolfSessionInit 10:4B28, SetCourseHole 10:423B, course 1, 18 holes; the random seed from
the browser), or a match against Luigi or Putts (the VS path 32:5240-32:52A2; match play needs a saved character
in the menus). A round from empty RAM through start.js plays exactly as the recorded one (`golf_native_round.mjs
r18:setup`). `play_page.mjs` goes through the menus (A skips the demo, Start on the title, Right to Mario) and plays
a few shots in headless Chromium with scripted keys (no page errors; screenshots in out/); `--stroke` / `--match`
start a round directly, `--pause` opens the pause menu's Scorecard on the first shot.

#### The front end (web/js/golf: boot.js, title.js, menu09.js, charsel.js, select.js, modesel.js)

Power-on: Start 00:2DA0 sets hIsCGB; SoftReset 00:2DAA clears WRAM0 ($C000-$CFEF) and HRAM $FF80-$FFEF, copies
the OAM DMA routine (00:067A) to $FF80, clears VRAM, resets the sprites, frame tasks and VRAM queue, starts the sound
driver and turns the LCD on (LCDC $E7); GameMain 01:400E clears WRAM banks 1-7, loads the font and default
palettes, checks the save RAM (SaveLoad 02:41F6: the signature "CAMELOT GAMEBOY" at $A020 and the sum of
$A032-$A1BF at $A030, else the backup at $B620, else erase + defaults + commit; SaveCheckAllBlocks 02:45D3: slots
0-2, block 3, blocks 4-7 stored fresh ($280 zeros) when they do not load), makes a new game's character, fades in,
and starts the map engine on map 0 at entrance 3. MapRun 0A:4A21 loads the header (MapTable 0A:5188), places the
player, spawns the map's actors, starts the map graphics (0B:46DF, with the tile animation of banks 28-2F / 72-74:
4 tracks of 4-byte frames, MapTileAnimTask) and runs the enter script: 32:5033 -> ModeSelectMain 32:5037.
ModeSelectMain: the title (TitleScreen 40:4032: the opening picture 40:61CB, 16 demo slides 40:5C72, the title
with its golfer sprite rows, logo palette cycling and the code Up Up Down Up Left Right Left Right B Select (twice)
that sets hUnlockAll $FFCF), LinkMenu 09:4A12 (bank 09's menu engine), the character select 06:6071 on the golfer
list 02:5A2D (3 save slots, Luigi, Mario, golfers 4-7 and $0A by save flags), then for a preset golfer NewGame
and the mode select 0D:4AA7 (Stroke / Training without a save file; Tournament, Match, Stroke, Training and Mario's
story with one), the course select 0F:4AB7 (BuildCourseList 0F:4B7A by mode, unlock flags and save flags), and
GolfRound. Match play takes an opponent from the list 02:5985 in a second character select.
Quirks kept: IntroCheckSkip 40:6238 never skips (the opening picture cannot be skipped); each demo frame prints
hVBlankCount, rDIV, the frame and Sqrt24 40:5775 of the three to the debug text buffer (Sqrt24 works on the
complements in two stages and is not the root of a:h:l; fuzzed bit-exact against the ROM); CharSelectMove 06:6839
loops for ever on Up / Down when both rows' slots are empty; CharSelectMarksRight 06:6AC0 with a count of 0 queues
256 sprites; CharSelectLoadPortrait 06:6D9A unbalances the stack for an empty previous slot (never reached);
GetCourseField 0F:4613 reads the last item for index 0 and FindModeIndex 0D:70A9 gives index 0 (the list's pad byte)
for wGameMode 0; BuildCourseList leaves the count byte at $D658 0; GetTextBoxWidth 05:615D (SizeMessageBox 05:5B3B)
rebuilds the message window's record, slot 0's when there is none (with a zero pointer: writes to the MBC's RAM
enable register); SaveBlockLoad / SaveBlockStore write a block's size low byte as the SRAM bank; SaveBlockStore
rewrites the directory defaults each time. The film-strip select code is the same in banks 0D and 0F at shifted
addresses. Not ported: the story beyond the first day (the map engine's event loop: walking, talking), link play,
the map's event loop after an enter script that asks no warp. A new character is made natively (see "The map engine
and the story"). Saved characters load
and save (see "Saved games").

#### Saved games (web/js/golf/save.js; web/tests/golf/coreplay.mjs)

save.js holds bank 02's save code: SaveLoad 02:41F6 (signature, sum, backup), SaveBlockLoad 02:4355, SaveBlockStore
02:429B, SaveBlockVerify 02:43CC, SaveBlockClear 02:431D, SaveBlockHeader 02:4454, SaveCheckAllBlocks 02:45D3 with
CheckSlotBlock 02:457F (quirk: `ld a, 8 / add a, b / ld b, 8` restores every damaged slot from block 8, slot 0's
backup), the save flags 02:44F2 / 02:4522, SaveGame 02:4489 (SaveGameTimer 00:2CC3, 14 bytes 02:6392 -> `$C94E`,
BuildClubTable 02:51F6, the header 02:63A0, the record `$C800-$C9FF` into slot b and b + 8, each verified).
In a round: RoundHookSaveAtHole 08:47B4 (modes 1-3) and RoundEndFadeAndExp call SaveGameMidRound 08:4EF4 (SaveGame
with `$C96D` = 2 meanwhile, so a save made in a round loads back to the mode select); RecordShot 02:4714 keeps five
`$80`-byte records per kind (birdie, eagle, albatross, hole in one: blocks 4-7, the newest first, the old ones loaded
to WRAM1 `$D080` and shifted down). MarkHoleCleared's bit order is `$80 >> n` (mask table 02:5CEA).
Where a save comes from: an empty slot in the character select warps (5) into the map engine: map `$1E`, then map 0
entrance 2's scripts (pick male / female, the character, the hand, the name; "Start by creating a new character"),
the story's first scene in the Director's Room (map 5), and back to the mode select, where ModeSelectMain stores the
new character (32:51D1). Loading (32:5114): SaveBlockLoad of the slot to `$C800` (a bad or empty one: warp 5),
RestoreGameTimer 00:2CDE, pending EXP (`$C95E` = `$64`: ScaleExpByLevel 32:54B5 and AwardExpPoints 48:4D70, not
ported), MapWarpToReturnPoint 0A:4D8A; a save made at the mode select or in a round (`$C96D` 2, or map 0) goes to the
mode select (with a save file: the story, Tournament, Match, Stroke, Training), one made in the story to the summary
prompt (32:7D35) and the map engine (not ported). The character select lists a stored slot's character
(ListSaveSlotGolfer 02:5ACA: wSaveSlot is set to 0 whatever the slot).
`web/tests/golf/coreplay.mjs --recipe kid --sram-out out/kid.sav` makes such a save on the emulator core (a new
character "Kid", saved at the mode select); `golf_screens_vs_core.mjs` loads it from power-on: `boot_poweron_kid_stroke`
and `_match` (to GolfRound's call through the save-file mode select), `boot_kid_round` (two holes of the round:
the mid-round saves): every frame and the save RAM at the end match the game. The play page keeps the save RAM in
localStorage under the emulated page's key and format; `play_page.mjs --save out/kid.sav` loads a core-made save
there, plays Stroke with it and checks the page stored the save the game wrote.
A save made by Save & Quit in a round (wReplayActive 1) loads to the card (32:5474 clears the maps; LoadSummaryPrompt
32:7D35: ExpScreen 48:4053 with a = 0: DrawYesNoBox 48:458C with "Yes" / "No" from one text, the second line through
PrintTextToBufferSkipLine 05:638A; DrawCardRoundInfo 48:4696: the mode, the course, "Hole n", "Score" with
DrawSignedScore 48:48F3, whose hundreds digit is always a '1' and whose tens show a 0 only for score bytes $64-$E3),
then "Continue previous game?" (48:4A81) and "Saved data will be erased, OK?" (48:4AC3) with TwoChoicePrompt 32:7D82:
Yes continues the round (ScriptEnd, GolfRound $FF, GolfSessionEnd), Yes on the second goes to the mode select, B on
the first back to the character select. `boot_kidsq_continue` and `boot_kidsq_prompts` load the save
`boot_kid_savequit` leaves (SRAM_OUT=out/kidsq.sav keeps the game's save RAM after a case) and take both ways, frame
for frame. Not ported: the match card's holes-up line (48:4724), the story's card (48:480D) and its map engine, the
pending EXP of a save (32:5139).

#### The message box, the pause menu's items, after a round (msgbox.js, pause.js, boot.js)

msgbox.js ports bank 05's message boxes: ShowMessage 05:5D49 / ShowMessageKeepOpen 05:5DE5 (the voice from
SpeakerVoiceTable 05:66C0 by the speaker's actor byte +$30, the typing delay from wTextSpeed, each page: the glyph
buffer cleared and uploaded, the text set on the window, the shadow redrawn and UpdateWindows printing it),
OpenMessageBoxNearSpeaker 05:5F62 (a 20 x 7 box at row 11 or 0 by the speaker's screen row; the text measured; the
window grown from 3 x 3 one step per UpdateWindows: the step count is the target width / 2, left by an `rr a` on
the width, with the carry of `[$D826] + 2` rotated in), SizeMessageBox 05:5B3B with all its measure helpers
(quirks: MeasureByteArg 05:5679 adds to a b it never updates, so it measures 0; MeasureNumberArg 05:56E2 keeps the
difference after the first power of ten a number is not below, and counts as one digit a number of 42768 or more),
RenderWindowText 05:5AA8 (UpdateWindows' message window), RefreshWindowText 05:6729, RemoveWindow 05:67BB,
RestoreMapUnderWindow 05:44E3, SetWindowPriority 05:4C75. text.js now dispatches every text control code through
the ROM's TextControlTable 05:592C: the new page $02 (TextCmdNewPage 05:538E: the arrow tile $01 at the box's
bottom middle, MoreArrowTask 05:53F9 blinking it, TextCmdWaitButton 05:5433: up to 30 frames for the buttons to be
let go, then the random seed advanced every frame until one is pressed; the rest pending in wTextResumePtr), $03,
the pauses $05 / $06 / $0C, $0A, $0D, the tiles $10-$13 and the dakuten codes. Bank 0A's script calls on it:
ScriptSetText 0A:4124, ScriptShowText 0A:4164, ScriptShowTextKeepOpen 0A:4199, ScriptCloseText 0A:41CE, ScriptAskYesNo
0A:41D8 (the last page found again by ScriptTextResumeLastPage 0A:4281, OpenYesNoWindow 0A:4227: the menu of text $1A
at y 1 or 10 by the speaker's row, priority 6), ScriptWaitFrames 0A:410D.
The golf pause menu's Give Up (41:746B / 41:759B: "You can't give up on the 1st stroke." (41:7935) or "Give up?" with
No first; Yes: ShotSetup returns 3 x par as the outcome, and StrokeLimit picks the ball up) and Quit / Save & Quit
(41:74AE / 41:75DE: without a save slot "OK to quit this round?"; with one "Save current progress?" (SaveGame,
`$C814` + 1, `$C2A6` = 1), No asks to quit) work: Quit (10:4877) sets wGameMode 0, one hole left and both players
holed out, so the round ends after the hole with no round-end hook (mode 0 has none). After a round from the menus:
GolfSessionEnd 10:4B94 (fade, font screen, wGameMode 9; to map 0 entrance `$C2A6`, else MapWarpToReturnPoint: the
mode select), ScriptEnd, MapRun's warp request, MapTakeWarp 0A:5146 and the next MapRun: the menus again (boot.js
gameFromPowerOn; the play page now goes from round to round). Cases in golf_screens_vs_core.mjs: `boot_quit`
(Quit, Yes: back to the mode select, 3,810 frames), `boot_quit_no`, `boot_giveup_first` (the message box), and with
the saved character `boot_kid_savequit` (Save & Quit: SaveGame, then the link menu; the save RAM compared): all frame
for frame. Settings (MenuSettings 41:78C6: the option words drawn as glyphs (LoadTextToWram7 41:7BBD, 03:50CD), the
menu kept open on its two Left / Right rows ($C3FA = $C3FB = $83; the handlers 41:7779 / 41:77B3 toggle wOptionFlags
$C818 bits 0 / 1 and come back to 41:701E), the on / off icons of DrawMenuIcons 41:708A, the blinking arrows of
MenuCursorTask with flag #48 (05:500A; PutMenuTile 41:7BB4), ApplyMusicOption 00:2B98; quirk: match play's Settings
reopens the stroke-play menu 41:743F) and Camera Mode (FreeLookCursor 12:6D3D: the look cursor, the course / green
view switch 12:6EB8, PlaceTargetMarkerClamped 10:5A3C; quirk: on leaving, $D4D4 and wCameraMode get the pressed
buttons; A does nothing outside debug mode) also run frame for frame (`boot_settings`, `boot_camera`), and so does
the Course Map (`boot_coursemap`; coursemap.js, all of bank 17's screen: the record's nibble grid, the detail tiles
packed from the overhead maps' terrain through the colour tables 17:4490 / 17:44A0, the overlay sprites, the side
panel from the HUD's routines, the markers, CourseMapInput's club / shot mode / aim; quirk: its task's
UpdateWindIndicator 12:50A0 reads wHudBusy and the wind animation counters $D326-$D328 in WRAM1, the bank the screen's
loop leaves mapped, not WRAM6). Give Up after a stroke (`boot_giveup`: B on "Give up on this hole?", then Yes) returns
$81 from the aiming menu (10:5DAA: 02:4924 LinkSendShotResult does nothing without a link partner, $D4D4 = 0); the
strokes become 3 x par and StrokeLimit picks the ball up, redrawing the player's HUD panel first (10:4786
HudRedrawCurPlayer, which the native round had left out: a frame of one tile wrong). A round saved by Save & Quit
(`$C96D` = 1) loads through the card and its prompts to GolfRound `$FF` (Saved games, above).

#### The EXP screen (exp.js, bank 48; charsprite.js, bank 42)

After a round with a saved character, RoundEndFadeAndExp 08:4F03 calls AwardExpPoints 48:4D70 with wPoints:
ExpScreen 48:4053 (a = 1) draws its full screen into the WRAM1 maps (LoadExpScreenGfx 48:4362, the name and level
48:4639, the message box 48:460E, the messages 48:4C7D: "Calculating EXP Pts." with the bonus line 48:4DFF, "Pts to
next level:", and "Level up!" prepared in WRAM7 for later, its sound $63 played at once), the character's animated
sprite (bank 42: InitCharSprite 42:400B, CharSpriteTask 42:4074; an animation's pointer is the word at [$D544] +
2 x anim, one dereference fewer than the tile and metasprite lists; a frame's first byte picks both its tiles and
its metasprite, the second is its time), then counts the points one per 4 frames (A or B: every frame, with 6 / 14
more steps while 1,000 / 10,000 remain; ExpCountStep 48:4C02), the counters drawn as digit sprites by ExpDrawCounters
48:4B05 (00:2326 FormatDecimalNumberUnsigned), the bonus ($CAAD / $CAAE) shown and added, then up to 240 frames or a
button, and AddExp 02:5465 (Add24Capped: at most 99,999). A level reached ($D63B) goes on to LevelUpScreen
41:402A (below). The test: `coreplay.mjs --recipe kid74` makes the save with game flag #74 (match play is
then one hole, hole 18), and `golf_screens_vs_core.mjs boot_kid74_match_exp` plays from power-on: the save loaded,
match play against Luigi, the hole, the standings, the result screen, the EXP screen, GolfSessionEnd and the mode
select again: 8,300 frames, all frame for frame, RAM and save RAM equal at the end.

#### The level-up screen (levelup.js, bank 41)

AwardExpPoints goes on, when the count reached a level ($D63B), to LevelUpScreen 41:402A and then ExpScreen once
more (message 4, nothing to count, wBallX $D400 = 1: the next level's points shown). LevelUpScreen returns at once
unless CheckLevelUp 02:546B (Compare24 of the EXP with the threshold 02:54CD[type] + 3 x level) says a level is due;
CountPendingLevelUps 41:48F4 counts how many (CharLevelUp 0 while one is due), keeps the level and skill points at
$D436-$D43B and puts them back (41:4970): one skill point per level, $D43C. The screen is built in the WRAM2
(attributes) and WRAM3 (tiles) buffers at $D000, 32 bytes a row, with the LCD off (41:446D: LZ tiles, the frames
and gauge boxes, tile runs; PrintTextToBuffer for "Improve which skill?", Level, Drive, Height, Shot, Meet Area and
Control, "Moving up a level!", "Is this OK?", Yes, No: texts $10DF-$10EA), and copied by parts as the phase
$D632 changes (UpdateLevelUpPanels 41:51E4: 0 the top "Moving up a level!" rows from $D240, 1 the prompt rows
$D000, 2 the Yes / No box $D2C0 with the label rows copied into it, 3 / 4 the first 8 rows again with $D280 /
$D240). The numbers are sprites: the level (41:4D2F), the drive in yards (41:4CD1, each digit's y from its own
byte $D434 / $D433 / $D432, which the idle highlight sets to $FC by turns: the digits hop), the points left
bouncing (41:4D79), the four skills' points (41:53B8: the selected one blinks with its value + 1); the gauges
(41:4F71, -4..+4 tiles out from the centre, with the change the pick would bring: CharLevelUpDiff 02:503C, which
levels up a copy of the record on the stack and writes the differences of +$1A and +$1C-+$1F). The input waits
for the timer $D4A0 (40 frames) and the banner ("1 UP", 12 tiles sliding in from the right, 41:5694, delays from
41:6463); A picks a skill (phase 1, the cursor 41:42FA and the row's palette cycling 41:50D2 through 41:6486), A again
gives the point (CharLevelUp, the pick history $D4D2 / $D4D1), B goes back or undoes the last point (41:550C); with
no points left the Yes / No box (41:4328): No (or B) starts over (41:54CA), Yes plays the cheer (animation 1, up to
256 frames or A) and leaves. Quirks kept: the loop's first test of $D4A4 and the banner task's read the mapped WRAM
bank (2 or 3 after a panel copy: tile bytes, not the flag); the yard digits' sprites of a blank are drawn too
(tile $12); hFFB2 / hFFB3 keep the stack copy's address ($CF56 on the way from a round's end). Not ported: the
header with the name and EXP (41:5598, a != 0) and its clock task (41:587C), used by other callers.
`golf_screens_vs_core.mjs boot_kid74b_levelup` plays a match from out/kid74b.sav (the kid74 save after one match:
the EXP is past level 2) through the EXP screen, the level-up (one point) and back to the mode select;
`boot_kid74b_levelup_keys` sets the EXP to 100 at the mode select (three points) and drives the screen with the
cursor, B, picks, undo, No, B on the box and the cheer's time-out: 9,680 frames, all frame for frame, RAM and save
RAM equal at the end. (screenstep.mjs now also counts as lag a fade a step apart after a lag frame, until the fade
levels agree: here the game's full VBlank came during the screen's set-up, before ForceFadeIn, and its first
AdvanceFrame needed none.)

#### Training (game mode 4: modesel.js, select.js, round.js, pause.js)

ModeSelectMain's Training (32:52CD) plays one hole at a time: CourseHoleSelect 0F:4AD6 (the course select from the
course last played, then HoleSelectInput 0F:77B3: "Select a hole.", the hole's number as three sprite tiles drawn
from LZ glyphs (0F:78C5 / 0F:78FE, BCD table 0F:78EA, $A a blank), Left / Up down and Right / Down up with wrapping,
A takes it, B goes back to the course select with hole 1; after a hole $D209 bit 7 skips the course select),
GolfSessionInit, SetCourseHole, GolfRound with one hole, GolfSessionEnd, and again unless wRoundResult $C96C is set.
The hole starts without the fly-over (08:64B1: camera mode 1, GolfSceneStart). After each shot AfterShotMode4Training
08:4A39 leaves the cup / picture view (GolfViewExit 10:4C6E) and asks Continue / Mulligan / Hole Out (41:6F55; holed:
Continue / Mulligan / Start Over / Back to Main Menu, 41:6F7A): Mulligan puts the ball and the player back
(RetryShotRestore 08:4AA3: BallToShotStart 02:4691, the strokes and lie flags from $D359-$D35C / $D447, wForcedShot
$D4E7 with the club and aim), Start Over plays the hole again (hole number - 1, holes left + 1), Hole Out and Back to
Main Menu end the round (wRoundResult 0: the hole select; 1: the mode select). The pause menu is TrainingPauseMenu
41:6EE0 (Camera Mode, Course Map, Hole Out, Wind Direction, Wind Speed, Settings, Back to Menu; flag #51): Wind
Direction turns wWindAngle $C816 by $10, Wind Speed changes wWindSpeed $C815 within 0-19, both with Left / Right in
the open menu (MenuWindDirectionAdjust 41:72A1, 41:72D8), whose arrows MenuCursorTask 05:4F20 now draws for all
of flags #48-#52 (the arrow column and rows by flag). Hole Out and Back to Menu return $80, which (as Quit) makes
the round's mode 0 and ends it after the hole. With this the native game drives ModeSelectMain's rounds itself
(boot.js gameFromPowerOn passes the round as sh.playGolfRound; ModeSelectMain runs GolfRound and GolfSessionEnd).
`golf_screens_vs_core.mjs boot_training` (6,287 frames) and `boot_holed_training` (18,919 frames, 28 shots: the
holed menu, Mulligan after holing, Start Over, Settings and Hole Out from the pause menu, Back to Menu) play from
power-on, all frame for frame. (screenstep.mjs replays a lag VBlank's fade step only when the native fade is not
already further in the same fade, as lockstep.mjs does: in the view behind the golfer's load the native fade could
end a frame early.) Not ported: the story (mode 9), the mini-games and practice modes.

#### Tournament (game mode 1: tournament.js, scorecard.js, result.js)

With a saved character the mode select offers Tournament (32:51FF): the course select, then GolfRound (18 holes; with
flag #74 hole 18 only, #73 three) against a field of 27 made-up rivals. SimulateRivalScores 3C:6686 draws each
rival's round total from its skill byte (RivalTable 3C:65E4), the course's offset (3C:67DD) and two RivalRandomBelow 5
(an LCG of its own at $D596, x 13 + low byte x $200 + $3039, seeded from wRoundSeed $C9FE, so the totals are the same
every time the standings are built in a round), keeps rivals 0-25 behind rival 26 (the course's champion), folds
totals under the offset, ranks them (3C:6921, a selection sort with an index array) and moves everyone a stroke back
behind a tie for 1st / 2nd / 3rd; each rival's score after the holes played is total x holes / 18 plus a per-hole
drift row (3C:6650). BuildStandings 0E:78B4 turns that and the player's SumScoreToPar into 28 four-byte entries
(score, holes, id: 0 the player, course + 3 the champion, $80 + the course golfer list 0E:4633 index, skipping the
player's own name; on the stack), an insertion sort into WRAM6 $D800 (an entry that makes way is carried on), ranks
and tie marks; GetPlayerRank 0E:7887 gives wPlayerRank $C875. The bank 08 hooks keep course statistics in the save
(the record at $C980 + 25 x (course - 1), a working copy at $C96E): fairways and drives after tee shots (08:441A,
with the longest drive's caption $1D for $18FF and up), putts, greens in regulation, par or better and sand saves at
each hole's end (08:44D8; counts stop at $FF and the totals become running averages), rounds and the best score at
the end (08:459E). Between holes the scorecard's first page is the standings (0E:5209: each name drawn as glyphs
into its row's own six tiles, BlitGlyphRows 0E:46CD; the player's row marked; an arrow when the rank moved), the
second the strokes card with the course record's hole marks (0E:6D69). The round ends with the placing screen
(RoundResultScreen a = 1, 0B:5B00 / DrawRankResult 0B:61CF: the place's digit tiles, ribbon, plate, course name,
score, portrait, confetti for the top three), the course record's place bit and the EXP bonus for a first top-three
place (08:4D18), the return map for the ceremonies (08:4C6E), the course flags, 10 points and the EXP.
`golf_screens_vs_core.mjs boot_kid74_tournament` plays the one-hole tournament from power-on with the kid74 save,
with the pause menu's Scorecard (both pages) on the second shot: 7,819 frames, all frame for frame, RAM and save RAM
equal at the end. The award ceremonies a top-three place leads to (maps $18-$1B) are ported (below:
`boot_kid74_ceremony`).

#### The map engine and the story (mapengine.js, script.js, maps/, nameentry.js; tools/script_js.py, actor_scripts.py)

`mapengine.js` is MapEngine 0A:498C's loop: MapRun 0A:4A21 (MapLoadHeader 0A:4BBC, MapPlaceAtEntrance 0A:4C0D, the
music, MapInitObjects 0A:4F45, the map graphics 0B:46DF) to the enter script (MapRunEnterScript 0A:4F71 ->
MapRunScript 0A:4EFF: ScriptBegin, the player's +$33 / +$10, the script, ScriptEnd), then the warp request
(MapTakeWarp 0A:5146 with MapListFindIfFlag 0A:4EC5, MapCheckFacing 0A:4E70, TestFlagCondition 0A:4E2F). The map
scripts are ported per bank (`maps/bank31.js`, `maps/bank32.js`, ...) and found by their ROM address
(`maps/index.js` MAP_SCRIPTS, with the frame tasks they register). `script.js` is the script API of bank 0A
(ScriptBegin / End, ScriptWaitFrames, ActorSetSpeed / Script / ResetScript, WaitActorScriptEnd / MoveDone,
ActorMoveTo / MoveBy / MoveDir, ActorLockSpriteFacing, ActorFaceActor, ActorsFaceEachOther, ActorPlayAnim,
WaitActorAnimDone (04:4E36), ActorJump, WaitActorLanded (04:4575), ActorSetState, ScriptActorSetSpeed / GoTo /
GoToActor, WaitScriptActorIdle, ScriptShakeScreen and ScreenShakeTask); the text calls are msgbox.js.
`tools/script_js.py BB:AAAA` drafts a script's JavaScript from its code (the API calls with the registers' constant
values, flags, sounds, fades; anything else as a TODO line), which is then checked and completed by hand.
`tools/actor_scripts.py` lists the actor scripts (spawn lists and ActorSetScript calls) and the opcodes they use:
$00-$04, $07, $09, $0B-$0E, $10, $13 (55 scripts); $05, $06, $08, $0A, $11, $12 are not used by them.

**A new character** (ported; `golf_screens_vs_core.mjs boot_newchar`: power-on, slot 0 "Create a new character
here.", every pick, the name entry and the first day, to the mode select: 7,647 frames, all pixel-exact or in the
harness's lag allowance (11 frames after lag frames), the RAM and the save RAM equal at the end): ModeSelectMain
32:5121 asks for warp 5 (map $00's warp list: map $1E entrance 1). Map $1E's enter script 31:4052 ->
StoryOpeningCreateCharacter 31:43B9: NewGame, the opening's tiles (31:4262), the golfer and the hand pointer
(actors 3 and 2) walking, the three questions (boy / girl -> flag #0, the character from the pair 31:42E7 -> flag
#1, the hand -> flag #2; OpeningPickLeftRight 31:42EF: B on the second or third goes back a question, with a head
shake; OpeningSpriteTask 31:43B2 draws the pointer and the marks), CreateCharacter 02:4E82 (OpeningCharTable
31:4791), a random $C83E (0-5), the confirm screen CharYesNoPrompt 41:6784 (the level-up screen's code with its own
tile map 41:68AD and texts 41:6C30; the screen it covers saved and restored, 41:6D4E / 6DC7; No: the questions
again), the name (NameEntryScreen 06:51DC: two pages of keys from the tile maps 06:4EA0, the cursor over the
layout 06:505B; Start jumps to END; END with no letters takes the character's default name and stays; B with no
letters goes back to the confirm screen; the five random bytes $C80B-$C80F at the end), the closing texts, flag
#97, warp 1 (map $05 entrance 2). Map $05's enter script 32:71CF at entrance 2: the director pro, the Caddie
Master and the coach introduce themselves (texts $487-$48F), warp 2: map $00 entrance 2, the mode select (a save
file now: SaveGame stores the slot).
Fixed on the way: TestSpawnFlag 04:4FBE spawns an actor while a plain flag is clear (bit 15: while set); the JS had
it the other way round (no map before had a flagged actor). New in bank 04: ActorOpWander 04:47A2 with
TileInHomeArea 04:552F, PointAddPolar 04:534E, TerrainBlockedAt 04:551E (0B:45C9 MapTerrainAt), PointNearPlayer
04:554D. Quirks kept: WaitActorScriptEnd 0A:435E waits ScriptWaitFrames with a = the actor address's low byte,
then the script byte it read (slot 0, 4, 8 ... would hit ScriptWaitFrames' a = 0 bug); TerrainBlockedAt answers
only for terrain $0F; ScriptShakeScreen with a = 0 when no shake runs stores 0 in wShakeLevel.

**Walking the overworld** (`golf_screens_vs_core.mjs boot_kid_story_walk`: a saved character's story, warp 4 to the
clubhouse (map $03, enter script 32:5E07), then walking up, right, talking to a member (a text script), walking
left, down, running with B: 3,940 frames from power-on, all pixel-exact or in the lag allowance): after an enter
script that asks no warp MapRun fades in, shows the map's name banner (MapShowNameBanner 0A:4DDB) and runs
MapEventLoop 0A:4AAA: the player's script 04:527A (op $12 -> PlayerWalkControl 04:538C, `player.js`: the d-pad
facing 04:5500, the probes 04:52FA ahead and $20 to each side against blocked terrain and actors (04:5510, 04:551E,
FindActorNear 04:55C4 over BuildNearbyActorList 04:5658), speed by terrain and flag #17 (B), CheckEventAtPoint
04:5360 for trigger and warp cells, the idle snap to the $20 grid) until an event is pending; then the trigger stepped
on (MapStepTrigger 0A:50CB), a warp, the bump counter (flag #23, action 2), the A button: MapFindTalk 0A:49C6
(MapTalkTargetAhead 0A:4CC5, BuildActiveActorList 04:56FD) -> MapTalkTo 0A:4F96, MapFindObject 0A:49E9
(MapObjectAhead 0A:4C9B) -> MapUseObject 0A:5066, MapTriggerUnderPlayer 0A:4D1F -> MapCheckTrigger 0A:5109; a text
script (below $2000) is ShowMessage 05:5D49 after WaitScriptActorIdle. The actor scripts' natives are a registry
(`actors.js` NATIVES, "bb:aaaa"). Not ported yet: the navigation menu (map 2), the partner's talk (0A:5365).

**The start menu** (`boot_kid_story_menu`: Start in the clubhouse, the text speed changed, Save & Quit; the save RAM
equal at the end): MapStartMenu 41:6E6E (SetupMapStartMenu 41:7A65; the text speed's icons 41:71D6 / 7141 in
DrawMenuIcons' bits 4 / 5), MenuTextSpeedAdjust 41:7969, MenuSaveAndQuit 41:79A7 (MapSaveReturnPoint, SaveGame, warp
to the mode select). Not ported: Char Data (41:73E4 / 7419: the character screen 41:6506), Stars (41:73EA / 741F),
Navigation (41:7413).
**The clubhouse and the rooms off it** (`boot_kid_story_door3`: through door 3 to the Locker Room, a locker opened;
`boot_kid_story_lounge`: through door 4 to the Lounge, its first visit's tour): map $03 (bank 32): the enter script
32:5E07 (entrances 3-7 come out of a door: 32:5D94 opens it, walks the player out and closes it; a door moves in four
frames of 3 frames each, copied from the map buffer's rows $3C / $3E), the door triggers 32:5CAF-5D2F (the door opens, the player
walks in, the warp), the exits 32:5C09 / 5C25, the counter 32:56EA / 5704 (with a partner: 32:5B5A by the clubs won, 32:5BBE by the course), the
bookshelf 32:5BEA; the doors' tiles change through MapBufCopyRectRedraw 0B:4864 (a rectangle of the map buffer copied
and the visible part redrawn). Map $05: the enter script 32:7461 (its cover-up scene ~32:7533 not ported), the
bookshelves 32:7156 / 716C, the wind tip 32:71B4, the 1-Up Mushroom 32:7966 (FadeToLevelUpScreen 32:7EE7), and the
no-op script 32:7E67. Map $06, the Locker Room (bank 34, `maps/bank34.js`): the talk list by progress 34:42B6, the
grumpy golfer 34:407F (a random gripe; bumped into three times, the screen shakes), the lockers 34:41E8 (objects 1-10:
open, a random find of 16, closed), the trigger 34:429B. Map $04, the Lounge: the enter script 32:69B5 and the
first visit's tour 32:6739 (the arrow over each champion, a frame task 32:6735 -> 32:6AB6; LoadCursorSprite 01:4289);
the champions' talks (`boot_kid_story_champ`: the talks 32:63A8 / 63BA / 63CC / 63DE with their text bases and
slots, Map04TalkClubChamp 32:6B81 with its whole branch tree, ChampSay 32:6AFF / ChampAsk 32:6B17 and the club flag
helpers) and a partner joining (32:6DCF: sound $94, ActorStartFollow 04:4525, the follow op $0A 04:484D; quirk kept:
its closeness test is (dy + the low byte of dx^2 + dy^2) & $FF < 8), spawned again with the player on every map
(SpawnPartnerActor 04:51D0: the record 04:517C + $15 k, id 4 + k, the player's facing and position). Talking to the
partner (`boot_kid_story_champ_part`; MapTalkTo's partner record 0A:5365 -> 0A:536E): "Shall we stop here?" ($0C46 +
k), Yes: $0C4A + k, #144-#147 and #118 cleared, the script reset, warp $FA. In an office with a partner
(`boot_kid_story_partnermatch`) the Caddie Master's talk is 33:4ABB: "A Match Game?" (base + $13); No (33:4B91):
#248 #227 #225 cleared and the same text shown again (nothing new set); Yes: both walk out (the scripts 33:5105 /
33:5123; the player's door point is ($1A00, $0D00) here, not 33:50BB's $0D80) and the Match Game against the
partner (StartPartnerMatchGame 33:4F4B: wStoryRoundKind $1E, game mode 2, the champion as player 2 from
SetupPartnerOpponent 33:4F6B), back through 33:4666 (a result other than 0 ends the partnership). Leaving an office
with a partner (`boot_kid_story_partnerleave`): CheckPartnerBeforeLeaving 33:4FE5 / 4FEF ("Practicing?" $0C42 + k,
SetPartnerText 33:506F; No: a step back, 1; Yes: $0C4A + k, the partner walks up 6 tiles, fade out (8),
ClearPartnerFlag 33:50A6, put away at ($3F00, $3F00)). On the Field (`boot_kid_story_partnerfield`) the place
triggers 6-$0D ask first (Map02ConfirmQuitMatchGame 34:5530, Map02SetChallengerText 34:54C3, Map02DropChallenger
34:54FA; No: 1, and the trigger asks again while the player stays on it). A won Match Game with #86 set and #188
clear (`boot_kid_story_matchwon`) warps 9 from the office (33:464C, wStoryRoundKind $5A) to the Match Game Event,
map $30 (34:77EB Map30EnterMatchResult): #188, the club's room drawn by the entrance (34:7CED -> 7C99 / 7CB5 /
7CD1: MapBufCopyRectRedraw of a $14 x $14 block and six palettes), fade in, the champions (actors 2-5) and the
player at speed 8, the beaten champion's scene (texts from $15C6, $15D9 after #139; with #127 also #189, $15EC and
a look down and left; ScriptShowText without ScriptSetText runs on through the texts), the champions file out,
warp = the entrance back to the office, 90 frames; a result other than 1 warps straight back; entrances $0C and up
(a test's way in) set #80 #82 #84 #86, clear #188 and warp entrance - $0A as a won match. Not ported: "Taking on
Mario?" ~34:544D.
**The Caddie Master's office** (maps $08-$0B, one header 33:400A, the club = wMapId - 8; `maps/bank33.js`;
`boot_kid_story_office`): the enter script 33:4722 (the temporary flags, Marion's talk list 33:4389, #227
qualified / #226 the club won; maps $09-$0B's golfers and decorations ~33:4757 not ported), the call when the
player walks up (trigger 1, 33:4BD3: the Caddie Master's text base 33:4C94, $0C1B on Marion's map), his talk
33:48EF (the result speech after a round; with a partner 33:4ABB) and the round menu 33:5166
(ScriptRunMenu 0A:42BF with the options $0892: Club Tournament / Practice Round / Quit; not qualified: base + 7;
the practice round asks base + 8 or + 9), the start scene 33:5257 (the waiting group, the send-off 33:5522, the
starter; seen once per club: flags #176 / #184 + club), the walk out 33:50BB, StartClubTournamentRound 33:4F05 /
StartClubPracticeRound 33:4F28 (wStoryRoundKind $C967 $0A / $14, game mode 1 / 3, the club's course and the return
point entrance 6: 33:4F96; GolfRound for 18 holes, 1 with flag #72: 33:66CB), and the way back (entrance 6, 33:4666:
a tournament's result 1-3 asks warp 5 + result, the ceremonies; else the result flags #240-#243 33:45FE, the
walk in 33:4864 and the speech 33:4D97 / 4D25); the golfers 33:4317-434D (SetClubGolferText 33:4CAC: quirk, the
test of #243 at 33:4CF3 is not used, + 2 either way), the level advisor 33:435F, the signs, the exits 33:44F1 /
451B / 4545 (the partner's question 33:4FEF), the step back 33:45C7.
Fixed on the way: ActorFaceActor 0A:4662 wrote the angle through hFFE0 as it was before the angle's computation
pointed it at actor a (the last actor the actors' update ran: here the Caddie Master turned instead of the player).
**The Field** (map $02, `maps/bank34.js`; `boot_kid_story_field`): the enter script 34:4690 (flags #99 / #212 /
#125 / #118 / #119, the navigation guide NavGuideStart 0A:7878 (`nav.js`: the hand's tiles LoadCursorSprite 01:4289,
the frame task NavGuideTask 0A:78CE; with a destination, set by the not-ported Navigation menu 0A:7174, the arrow and
the name ~0A:78D6 / ~0A:79C7 are not ported), the map's changes by progress: the tree's trigger 34:4719, the closed
paths 34:4769 (a block for each of #86 #84 #82 #80 still clear), #114's area 34:4733, #125's open path 34:46E6, each
with MapCopyEventRect 0B:4699 / MapCopyTerrainRect 0B:4653 (`mapgfx.js`) and MapBufCopyRectRedraw 0B:4864); the
triggers into the Marion clubhouse and the Palm, Dune and Links offices 34:4474-44F5 (the walk in 34:452A), the side
places 34:4618-4681 (warps 6-$0D: a challenger following, 34:5530 asks first). The letter at the tree (34:4847),
entrances $0E / $0F (34:5218 / 34:5019) and the marker sprite (34:4FCC) are described with the letter below; the
Road to Peach's Castle's trigger 5 (34:450C) with Peach's Castle below.
**The Road to Peach's Castle and Peach's Castle** (maps $1C / $1D, bank 33; `boot_kid_story_castle`): the Field's
trigger 5 (34:450C: Map02ConfirmMarioChallenge 34:544D asks a following champion first, "Taking on Mario?" $0C4F +
k; the player's walk script 34:55A6, Map02FlashPaletteWarp 34:532E, fade out). Map $1C: the enter script 33:588F
(#125), the launcher (talk 6 33:5737 / 5729, trigger 1 33:57A6): Map1CBobombLaunch 33:57CE with the launcher's
frames (33:5899 opening, 33:5912 shooting: 4 x 4 / 4 x 6 blocks of the map buffer redrawn by 0B:4864), warp 1;
trigger 2 33:5876. Map $1D: the enter script 33:5F42 (33:5F5B the test entrances $0A-$0C, 33:5F8F the result flags:
quirk kept, an entrance other than 6 with no result still sets #242; 33:63F9 the open door with #127), the first
visit 33:60B2 (the arrival 33:6040, the welcome by Toad, Peach, Bowser, Yoshi with its effect sprites 33:6E5D /
6E75 / 6EAA and actor scripts 33:6F39 / 6F40, Luigi and Mario), later visits from the road 33:5FCE, "May we begin
the tournament?" 33:66DC (No: the next text, or $1476 after a round), the talks (Peach 33:5C4D / 5C01, Mario
33:5CB0, Luigi 33:5CC4, the baby 33:5CF0, DK 33:5CFC, Yoshi 33:5D0E / 5D1C, Bowser 33:5D2A, the residents 33:5D51 /
5D65 / 5D79), the door 33:5EE5, the way back down 33:5BD1 / 5F25. Yes to the question (`boot_kid_story_peachround`):
the opening 33:642C (the door opened with #127 after Toad's effect sprites 33:6E45 and the rising effect 33:6B62 /
6BB3, whose $C3E2 offsets are added as unsigned bytes with their carry, a quirk kept; the actors' palettes 04:4D2B;
the residents' cheering scripts 33:6EFA / 6F15 / 6F21), then Peach's Tournament from 33:668D (wStoryRoundKind $0A,
game mode 1, course 5 hole 1, return point map $1D entrance 6; the wind byte SetCourseHole gets is a, 0 from
SetupPlayerGolfer's ClearMemory16; the club rounds' 33:4F96 leaves it 6, now passed as such). Back at entrance 6
placed 1-3 (`boot_kid_story_peachsecond`) the award ceremony 33:672A (the stage and trophy blocks, the actors
33:6A00, $1479 / $147A with the place, $147B; a first win sets #111, the return point map 0 / $FA and saves), then
33:69B2 (the actors 33:6ABD); a win (`boot_kid_story_peachwin`) goes on to 33:696B: the character's picture
(ShowPictureTimed 40:6666, `title.js`), the ending, #111, the return point and the save, map 0 entrance 3 by warp $FA.
With the door open (`boot_kid_story_castletoad`): the 1-Up Mushroom 33:6F47 (object 4: unless level 99, #158, the
EXP to the next level, the level-up screen through 33:7CB7, a copy of 32:7EE7) and Toad's practice round 33:5D8D (talk
6: course 5 in game mode 3 with wStoryRoundKind $1E, a quirk kept, back at entrance 2). That case found a bug in the
scorecard's pars (13:7044 GetHoleParAndYards, `scorecard.js`): its loop jumps back to the second `dec d` (13:7051),
so after the first pass it counts the course down by one, not two; the port counted by two and drew another
course's pars for courses 3 and up (Peach's course got course 4's). After the one-hole round the cases keep a difference in
the hidden BG row $9BE0 ($9BE3 / $9BEE), first seen during a lag frame of the round and so classed with the lag
frames (as the Palm wind case's); nothing visible differs. `KEYS=frame` prints what differs at a frame,
`GAME_SHOTS=frames` writes the game's screen as `SCREEN_SHOTS` the native one (out/gs_N.png).
**The Trophy Room** (map $07, `maps/bank35.js`; `boot_kid_story_trophies`): the clubhouse's door 5 (warp 7); the enter
script 35:41AE / 41B2 places the trophies (actors $02-$10) by the placed flags #112-#116 and won flags #136-#139 / #117,
a place trophy's second or third by TestCourseHoleBit 02:5C77 (the club's bit $16; quirk kept: a won club still runs
the place test, hiding one of the two already hidden); the trophies (objects 1-5, 35:4115-4159) describe themselves
(35:4345: the victory text $083F with the club, Peach's $0840; else $0841 / $0843 by flag #0, the place by 35:4396 and
35:43AE; quirk kept: a won club trophy also pushes the place arguments); trigger 1 35:4193 ($0172).
**The ending** (`ending.js`, `maps/bank35.js`; `boot_kid_story_peachwin`, 40,569 frames, the ending itself frame-exact
throughout): EndingSequence 0A:56B1 (export $64): fade out, music $15, no player / script / partner actor,
InitFontScreen; for each part of 0A:5682 (maps $31 $3D $32 $33 $34 $3E $35, the character's part from 0A:56A1 by
wCharId: $35/2 $3B/1 $36/2 $33/2, then $36 $37 $33/3 $38 $39 $3A $3C) the map is run by MapRun 0A:4A21 with #24 clear
(`mapengine.js` mapRunEnd: the rest of MapRun without MapEngine's MapTakeWarp), its actors frozen (0A:57A3), BG and OBJ
palettes 2-7 faded to sepia over 30 steps (PalFadeInitSepia 0A:5422: red = sum / 2 capped at $1F, green = sum / 4,
blue = sum / 8; PalFadeSetup 0A:54CF, PalFadeRun 0A:5561 with PalStepComponent 0A:561C, PalFadeFinish 0A:562E) and its
page of the credits shown (CreditsRun 0B:5395: the window raised by CreditsWindowTask 0B:5640 while the scene scrolls
by 0B:56C9's steps (quirk kept: the task leaves WRAM6 mapped when it ends); the page 0B:56EF / 0B:5795 from 0B:572C's
records (texts $1900 + n, 20 characters each by CopyTextLine 0B:5884); the scrolling 0B:57E4 / 5822). Then
CopyrightScreen 0B:58B0, EndingFinalScreen 0A:6747 (LZ tiles and maps to both VRAM banks) with its task 0A:6806 ->
79:68B1 (six sprite parts 79:68F6 6AA5 6C59 6E0D 6FC1 7175, nine LZ frames each, one step every 4 frames up to $36),
until a button is held or 3600 frames. The ending's maps (bank 35): 31 the Director's Room 35:4415; 32 the Lounge
35:479A / 466A (its hand 35:4666 -> 47BF); 33 the office 35:48E6 (scenes 35:492C / 4AE5 / 4B7D, the rooms 35:4D9F
/ 4DBB / 4DD7); 34 the ceremony 35:4F35 / 4F51 / 5011 / 5117; 35 Tiny-Tots 35:54B2 (the caretaker 35:5352, Sherry);
36 Raven Woods 35:56BD (Joe 35:55F5, the crow 35:56FF with the hat 35:56F8 / 5939, whose on-screen tests are computed
and not used, and 35:5921); 37 the Alternate Game 35:5A0B ("Which rules?" with its menu call removed: $180B always);
38 the Match Game Event 35:5BAA / 5BB3 / 5DCC; 39 the letter 35:5E12 with copies of bank 34's letter routines
(35:65D4-69DB; the flying sprite and the sparkle without their sounds, the path without its flag test); 3A the
launcher 35:6A48 / 6B28 / 6B97; 3B Azalea 35:6CD2; 3C the castle 35:6E7E / 6E91 / 7045 (the effect 35:7122 / 713A /
716F); 3D the clubhouse 35:73F7; 3E the Field 35:7525. Only the Kid's part has run in a test (map $3B, the Azalea
part, has not).
**The navigation** (`nav.js`; `boot_kid_story_nav`): NavigationMenu 0A:7174 (A on the Field with nothing ahead,
or the start menu's Navigation 41:7413): the places whose flags (0A:6FA9, ListEntryFlag 0A:6CAF) are set
(NavBuildEntries 0A:73D3), the frame (LZ 0A:6FE5 / 0A:7085), the title and seven names (0A:7387, PrintTextToBuffer),
the cursor, Up / Down scrolling (0A:73FC: redrawn and queued over two frames), the marks of the places visited
(flags 0A:6FC7, DrawListMark 0A:6C58), the scroll arrows (0A:7344), the animated tiles (InitRecordsTileAnim 0C:43AD,
AnimateRecordsTiles 0C:436A); A picks wNavDestination $C2A7 (Quit: $FF), B leaves; the map is reloaded where the
player stood (warp $FA). On the Field the guide (NavGuideStart 0A:7878) draws the place's name in a window at WY $78
(0A:79BF; quirk: the centring it computes from GetTextBoxWidth is overwritten before use) and its frame task
(0A:78CE) the arrow (16 directions by AngleFromVector16 from the saved position, tiles 0A:7470) and the bobbing
marker over the place (0A:7967, NavDestPosTable 0A:789A). The other clubs' offices (maps $09-$0B: 33:4757-4839,
the decorations 33:55A3 / 55BF / 55DB, the waiting group's walk up 33:52C1, the champion's menu 33:54CA) use the
same scripts.
**Golf event hooks, the driving range and its lessons** (`golfhooks.js`, `maps/bank31.js`): a map script that starts
a round of its own sets a hook table (SetGolfEventHook 10:4BC7: bank $C870, table $C871) and the round's set-up
overrides (SetForcedTee 10:4C04, SetForcedWind 10:4C26, SetForcedWindDir 10:4BE5, SetForcedShot 10:4C36, SetP1OffTee
10:4C1A); CallGolfEventHook 10:4CC3 calls entry a of the table at the round's events: 0 a shot's set-up (10:484C),
1 after a shot (10:4611), 2 a view loaded (13:43F6), 3 a hole's start (10:45CD), 4 the course view's start (10:4237);
the handlers are ported with the map scripts (`HOOKS` by ROM address). After a shot wGolfEventFlag $D4DD (10:4CAD
SetGolfEventFlag, cleared by GolfViewExit 10:4C6E) makes GolfShotLoop repeat the shot (RetryShotRestore 08:4AA3) or,
with bit 7, end the round (10:464A). Map $0C, the Marion Club's driving range: the enter script 31:4BEC (entrances
4 / 5 after a coach's demo, 6 / 7 a lesson's result; a first success: 20 EXP with AwardExpWithBonus 31:7DA4,
SaveGame and warp 8 / 9), the tip 31:4A1D, the sign 31:4BC9, the two coaches' lessons 31:4A8B / 31:4B11: the demo
(game mode 6, golfer $4F / $4E whose bit 6 replays the strokes copied from 31:4C88 / 4F66, LoadStrokeRecord 02:4626
in the aiming step 10:5973), the try (31:4ED5 / 5163) with a forced shot, the judgements 31:4E5A / 510D (the lie,
the shot's power and impact; the distance to the pin, 31:7D53) and the results 31:4D9C / 507A; the practice of the
four ranges 31:51F4 / 521B (the same shot again until Quit Practice). Map $0D, the Marion approach range
(`maps/bank30.js`): the enter script 30:429A (no fade of its own; entrances 2 / 3 after a demo, 4 / 5 a result; a
first success #160 / #161, 20 EXP, warp 6 / 7), the tips 30:40EE / 422B, the running approach 30:4119 and the chip
shot 30:41A2 (game mode $0C, player 1 off the tee, the judgement BallWithinPinDist 30:7E2E within $60; the running
approach's try keeps the first stroke's club in wEventShotClub $C969: the putter gets its own line $0CAC; quirk: the
chip demo's after-shot hook 30:4607 sets #99 when the coach holes out), the practice 30:47E6 / 480D (holes 8 / $0B /
$0E / $11 by map). The ranges' lessons are one engine with each lesson's constants (`maps/lessons.js`: the talk, the
demo and the try's set-up, the after-demo question, the result's frame, the hooks' set-up texts, after-shots, the
practice); the copies differ in small ways the descriptors and options keep (the after-demo fade speed, SetP1OffTee,
the coach's walk-back script and facing, a hook's WRAM push and its wait: ScriptWaitFrames $3C or WaitFramesCmd $28).
Ported with it: ShowMessageAt 05:5E70
(OpenMessageBoxAt 05:605F: the box centred on a screen tile; the voice of a but no speaker $D851), the practice
pause menus (PracticeWindMenu 41:6F08 with Wind Direction / Wind Speed, PracticeMenu 41:6F30; 08:46E2 / 08:46EF), the
round end of modes 6-9 and $0C-$0F (no hook, 08:4BD9), WaitJingleEnd 00:2C1F (screen.js: hActiveJingle comes from the
sound driver, `w.jingleActive`; without one there is no wait). The screens harness now runs a native-side sound
driver (web/js/sound, started from the core's sound RAM and APU registers) at each native VBlank and each replayed
lag VBlank, so that the native code's waits on the music see the game's state (no tolerance: the frames compared are
unchanged).
**The putting greens** (maps $0E / $11 / $14 / $17, one header 30:642A; `maps/bank30.js`): PuttingGreenEnter 30:69B9
(the per-map actors and warp / talk lists; entrance $FA: the challenge's result 30:6CF2), the pros' talks 30:6666
(Marion's, quirk: it asks the question 30:6739 straight away on $10CE / $10DB where the other greens' pros 30:668B /
66B3 / 66DA make the offer 30:6701 with the text 30:6DF6 first), the challenge 30:6739 (wStoryRoundKind $0A, game
mode 5, ten putts over five holes, the forced wind direction 0 and wind $C000, the hooks 30:6C0F: the rules 30:6C2F
once, after each putt 30:6C58: within $34 of the pin one more made ($10D6) else $10D7; an odd putt the same spot again,
an even one the next hole with SetP1StartStrokes 10:4C62; the tenth or a quit ends it), the result 30:6CF2 (7 made or
more: cleared #194 + the green, AwardPuttingChallengeExp 30:6EC8: 20 / 25 / 45 / 50 EXP, a quarter more for all ten
(not flag #99 as the ranges' AwardExpWithBonus), the level-up screen, SaveGame, the map again at entrance $FA; else
tried #190 + the green), the putt demo 30:6A8C, "Practice here?" 30:6AEC with the practice 30:6B13 (wStoryRoundKind
$14, mode 7, course 7 holes 9 / $0C / $0F / $12 with music 8-$0B, the tee pulled toward the player 30:6D40 with the
bases 30:6D89; after-shot 30:6BFC). The mini-game pause menu MiniGamePauseMenu 41:6F9F (modes 5 / $0A / $0B,
08:46DE: Quit Mini-Game 41:775F, Settings 41:7767). Not ported here: Azalea (object $0F, ~30:6942, unless the player
is Azalea) and HiddenFriendsBonus ~30:7EAD, the Dune green's golfers and the Alternate Game (~30:681A, ~30:6F42). The
test `boot_kid_story_green_cleared` sets the putts made ($C3E1) to 10 on both sides after the tenth putt (scripted A
presses make two).
**The Palm driving range** (map $0F, `maps/bank31.js`, the lesson engine of `maps/lessons.js` with two more
options): Map0FEnter 31:5543 (unlike 31:4BEC no fade of its own; entrances 4 / 5 after a demo, 6 / 7 a result, a first
success #166 / #167 25 EXP and warp 8 / 9), the tip 31:53A6 (two chained questions), the intentional hook / slice
31:540E and the shot into the wind 31:54A2: the demos give the coach's golfer record a 210 drive ($C89A-$C89B = $00D2;
the intentional shot also $C89D = 3), the tries' music is $0A; the hooks 31:5630 (quirk: text $1053 is never shown:
$1051, $1052, the wait, $1054) / 566D / 56A1 / 56DE and 31:5943 / 598B / 59BF / 59FC; the judgements 31:5800 (2 off
the fairway, 3 no curve: the stroke record's +$0C bits 4-5, 5 the ball's y $2480 or more, 4 wBallFlags bit 4 (the
tree), else 0; quirk: its x test 31:582D is never reached) and 31:5ABA (the same as 31:510D); the results 31:5711 (0 and
4 pass) and 31:5A27. Quirk: the first coach's result walks him back with the second coach's script 31:7D2D (his No
answer uses his own 31:7D24). The office's Caddie Master blocks the way to the ranges until the club is qualified
(33:47EF), so the tests poke #112.
**The Palm approach range** (map $10, `maps/bank30.js`): Map10Enter 30:4B62 (as 30:429A; a first success #164 / #165,
25 EXP, warp 6 / 7), the tips 30:49D0 / 49FB (speaker 6 for talk 5), the bunker shot 30:4A26 and the running approach
on a sloped green 30:4AAF (game mode $0C, player 1 off the tee, course 7 hole $0B, music $0A; the judgements
BallWithinPinDist $60). The copies differ again in small ways the descriptors keep: the tries' set-up hooks 30:4CA3 /
4ECD keep no WRAM bank and wait nowhere (the bunker's reuses the Marion texts $0CA6-$0CA8), the sloped green's demo
hooks 30:4E67 / 4EA1 keep no WRAM bank (4EA1 leaves 6 mapped), the bunker shot's result 30:4CF9 says its failure
text without the 30 frames first and walks the coach back facing up ($00; his No answer $C0). Quirk: the sloped
green's result 30:4F23 walks coach 2 back with coach 1's script 30:7DFF facing $40 and never calls ScriptEnd.
Unreferenced: 30:4B38 (fade out, InitFontScreen, rWY $90, ResetSprites, warp 1).
**The Dune driving range** (map $12, `maps/bank31.js`): Map12Enter 31:5E63 (as 31:5543; a first success #170 /
#171, 45 EXP, warp 8 / 9), the tip 31:5CC2 (chained, as 31:53A6: `chainedTip` in maps/lessons.js), the high shot
31:5D2A and the low shot out of the trees 31:5DBF (course 7 hole $0D; the demos give the coach a 220 drive, $C89A-$C89B
= $00DC, the high shot also $C89C = 4; the tries' music 9). Quirks: the high shot's try sets the forced shot twice
(club 4 at 31:615E, then club $0A at 31:616C after the wind; the second wins); its demo's after-shot 31:5F52 only sets
the round's end ($82: no GolfViewExit, no frame) and its set-up 31:5F27 shows two texts without a wait; its try's
after-shot 31:5FB5 sets flag #99 before the judgement 31:607B, which reads it (0 holed out; 2 off the green or when the
stroke record's +$0C has bit 7 clear; else 0 within $A0 of the pin, 1); the high-shot coach's result walks him back
with the second coach's script 31:7D2D (as on map $0F); the tree shot's demo set-up skips text $1085; the tree shot's
set-ups make player 1 play off the tee after SetForcedTee (31:5E2F / 31:6411; the lesson engine's offTee
"afterTee"). The tree judgement 31:6321: 1 off the fairway; above y $2100 2 when x is $2100 or more, else 2 when x is
$1980 or more; otherwise 0.
**The Dune approach range** (map $13, `maps/bank30.js`): Map13Enter 30:52CB (a first success #168 / #169, 45 EXP, warp
6 / 7), the chained tip 30:515D (speaker 6, no wait before the questions), the backspin approach 30:51A7 and the
approach up a steep climb 30:5230 (game mode $0C, player 1 off the tee, course 7 hole $0E, music 9, BallWithinPinDist
$60). The backspin try's after-shot 30:541D keeps the stroke record's +$0C ($D68C, its spin) in wEventShotClub $C969
and the result 30:545F picks its failure text by its bit 7 (no wait first); the climb's after-shot 30:566F keeps the
club ($D688) and its result 30:56AE says $0CF3 for a holed putt with the putter. Quirks: the backspin coach walks back
with the contest coach's script 30:7E11; the climb's result walks coach 2 back with coach 1's script 30:7DFF and never
calls ScriptEnd (as on map $10). The demo and try hooks of both keep no WRAM bank; the tries' set-ups wait nowhere.
The course view's tile animation (13:7076 StartCourseAnimTask) now starts the copy in the bank of the hole's asset
ref 4 ($50-$54; the five copies are the same code at other addresses, render/holeview.js); course 7's hole $0D is
animated from bank $51 (before, only bank $50's courses were).
**The Links driving range** (map $15, `maps/bank31.js`; its own code, apart from the lesson engine): Map15Enter 31:67C8
(Map15UnlockContests 31:7051: once the Links is won, #139, the contests #224 / #225 for the passed lessons #174 / #175;
the talk lists 31:678D after the win, 31:6764 after the tournament, #115), the tip 31:656F, the tree shot 31:65B8 and
the buried lie 31:666F with their asks 31:6BF7 / 31:6F9A, after-demos (entrances 4 / 5), results 31:6A56 / 31:6DF8 and,
once unlocked, the contests: the same demo gives the coach's distance to the pin (PinDist 10:62AD to wEventResult
$C968, a word), the player's try hers ($C96A), the results 31:6AE3 / 31:6E9D (the nearer wins: #98; 50 EXP and warps
$0A / $0B; then entrances $0A / $0B, 31:6B5A / 31:6F14). The tree shot is played on course 0 hole $0A with the wind
$6000 in the contest (else $C000); the buried lie on course 7 hole $10 with $0004 / $C000. Quirks: the buried lie
writes wP1OffTee $D4E3 = $21 directly; the demo set-up 31:6909 skips text $1093; the lessons' results leave the coach
on his talking script (no walk back, only facing up when not passed); the first success of the tree shot's lesson and
of the buried lie's contest skip the 30 frames the others wait; the buried-lie contest's No text is $1028 once the
Links is won. Judgements: 31:6B8B (0 holed or within $A0 on the green, 1 on the green, 2 off it), 31:6F45 (on the
green 0 within $A0 else 3; in a bunker 2; else 1).
**The Links approach range** (map $16, `maps/bank30.js`): Map16Enter 30:597C (Map16UnlockContests 30:6414 sets the same
#224 / #225 for its own lessons #172 / #173: a quirk, the two ranges share the contest flags), the chained tip 30:58D5
(quirk: the second answer's texts the other way round: `chainedTip` swap), the lessons 30:5A94 / 30:5B2B (the demo's
music 7; quirk: neither try sets a forced shot) and, once unlocked, the contests 30:6159 / 30:634A: game mode 5, one
hole of ten approaches from the same spot (the hooks 30:6052 / 30:6243 put the tries in player 1's strokes and redraw
the HUD, 12:4B8A; 30:605C / 30:624D count those within $60 of the pin, $0C85 / $0C86 with both numbers), 7 made wins
(#98; all ten sets #99 for the quarter more EXP), the results 30:60DA / 30:62CB (quirk: the slope's clears #101, not
#102), 50 EXP. The mini-game pause menu (41:6F9F) is theirs too. The tests poke the Links won and #125 (the path
open) because the tree's letter event (~34:4847) and the path's opening (~34:5019) are not ported; with #125 the Field
now draws the marker sprite (Map02LoadMarkerSpriteGfx 34:4FCC, the frame task 34:46DF / 34:50A2).
**The letter and the path** (`maps/bank34.js`, `maps/bank35.js`): once the Links is won (#139) the Field's tree gets
an event cell (34:4719, trigger $0F, taken with A). Its script 34:483B (not with the path open, #125) runs the letter
34:4847: the player walks up (speed $40), BG palette 2 sparkles five times (34:52C0, sound $95), the letter's tiles
(34:4FB4), a slower step, animation 7, the letter falls (34:512E: the sprite 34:4F61 every 12 frames down a diagonal),
fade out (2) and warp $0F: map $25 (35:79D2, entrance 2) shows "A letter is falling from the sky" and Peach's
invitation ($1442 / $1443, speaker $8A) between fades, sets #123 and the save flag $1E0 (02:4522) and warps back to
the Field's entrance $0F: Map02PathOpenCutscene 34:5019 (the flying sprite 34:51B9 with sounds $96 / $97, the burst
34:5396, #125, the path's terrain / events / tiles 34:46E6, an event cell 0B:4699, sounds $98 / $A4, the marker's
frames 34:4FE4 and task 34:46DF). With #123 already set the tree goes straight to that scene. Entrance $0E
(34:5218, back as Grand Champion) sets #139, clears #125 and runs the tree's script after a second. Map $25's entrance
1 (the "Marion Club Director's Office" caption for 110 frames, warp 1) is ported with it. The sprites' positions
are in 1/32 tiles less the map's scroll (34:50E9 ...); the marker's in 8.8 tiles.
**The award ceremonies** (maps $18-$1B = Marion, Palm, Dune, Links; one header 31:76B1; `maps/bank31.js`):
CeremonyEnter 31:7775 (BeginFadeOut $7F; Palm / Dune / Links their palettes 31:7C00 / 7C40 / 7C80 and warp lists;
seen flags #107-#109 skip to warp 2 and are set at entrance 2; Dune's flag #212 31:7CB0; entrance 2 the champion
31:78E1, 3 / 4 the second / third place 31:7B1C with the podium's tiles 31:7B86 / 7B96 (0B:4864); both end in
CeremonyCongratsAndLeave 31:7A00; result 1-3 in wRoundResult; warp 2 (map 0, the mode select) for a mode-select
tournament (wStoryRoundKind $32, set by 08:4C6E), else warp 1 (the office's entrance 6). Not ported: the ending
(flag #110: ~31:782F, ShowPictureTimed 40:6666, StaffCredits 41:7E07) and the Links Champion's (~31:7827). The tests
poke the result (no scripted round places in the top three): `boot_kid_story_ceremony` sets wRoundResult $C96C to
1 on both sides after the round; `boot_kid74_ceremony` sets the return point ($C960 = $18, $C961 = 2, $C967 = $32)
when the round's place is first known.
Fixed on the way: MeasureCourseName 05:579E (text code $0B in SizeMessageBox) loads the course name into $D880
(LoadTextShort) and measures it there; the JS had copied it to wTextArgBuffer $C780 as MeasureCharName does.
The cases walk with `routeCase` (golf_screens_vs_core.mjs): a breadth-first path over the terrain cells, each next
cell's centre aimed at after centring on the other axis, around an actor in the way, A when stuck (a bump's text).
The harness's lag model gained one rule here (screenstep.mjs; no tolerance): when the frame's full VBlank came early,
inside the game's code (its AdvanceFrame then waking at a VBlank that found the work done), and no fade ran at that
VBlank but one runs after the frame, the native frame's VBlank stands for that early one and makes no fade step
(`w.fadeSkip`, honoured once by fadeVBlank); the game's fade steps were the later VBlanks, which are replayed as
before. Without it Save & Quit's fade-out after SaveGame's long lag was one step ahead on the native side.
A second rule came with the event list (no tolerance either): a lag VBlank that finds the game in a fade while the
native side has none yet is owed to the native fade of the same state if the native code begins it in that frame
(`w.lagFadeOwed`, taken by screen.js's BeginFadeOut / ForceFadeOut / ForceFadeIn): ListChangePage 0A:6E47 begins
its fade-out and then rebuilds the page (LZ and glyphs) through several VBlanks, so its WaitFade took 2 frames in
the game against 7 natively.
A case may set `maxFrames` (passed to runScreen, default 20,000 frames): `boot_kid_story_matchwon` runs 23,309
frames (the Lounge, a one-hole Match Game and the event scene). It caps the run's length only; nothing compared
changes.
**Char. Data and Stars** (the start menu's first two items, `levelup.js`, `nav.js`): CharDataScreen 41:6506 builds
the level-up screen read only (41:4366 / 43C0 / 446D, the values 41:49ED a = 1, the gauges, the character sprite,
the level) with the name and EXP header DrawNameAndExpHeader 41:5598 (CopyNameToTilemap 41:5765 with the voicing
marks a row up, FormatExp24 41:57A9: 65536 added digit by digit per unit of the high byte, quirk: the top digit adds
5 and the high byte instead of the carry and stops at 9; SetNameAttrs 41:5867; the badge's tiles; the clock task
41:587C: the play clock while $D4D0 = 0, quirk: with a blank first hour digit it writes 0 to WRAM6 $D04F-$D052), the
badge DrawCharBadge 41:65D1 (GetCharFlags12 printed to the debug text and the badge tiles for 1 / 2) and BG palette 6
(41:665E); A or B leaves (MenuCharData 41:7943: the map again at the saved position). The event list EventListScreen
0A:6F56: five pages (Marion, Palm, Dune, Links, the Field: titles $19E1-$19E5) of the lessons and contests unlocked
(flags 0A:680A; page 3's entries from 5 also need #139), with a blinking mark on those cleared (0A:6852's flags),
the page arrows 0A:6C7A, Left / Right changing the page (passing empty ones, 0A:6E47), Up / Down scrolling by 2 up to
(2 entries + 4 - $12) x 8 (0A:6D15); B leaves.

#### Match play and the contests (web/js/golf/match.js)

Bank 08's match-play rules: each hole to the player who holes out in fewer strokes (MatchHoleOutcome 08:4199, a
given putt by `$D48E` bit 7), the honour, the match decided when the lead passes the holes left (MatchStatus
08:4091), a playoff when level after the last hole, the dormie music and captions, the near-pin / longest-drive
contests of two-player rounds (InitHoleContest, UpdateHoleContest, AddContestWinsToPlayers) and the flags after a
match; quirks kept: PrintHexByte prints four hex digits (its skip of the first two is lost), the contest and
match routines print to the debug text buffer `$CC00`. `golf_native_round.mjs match18` (tools/round_suite.py
match18: the computer as Mario against the computer as Luigi, player 2's record from tools/player_record.py)
matches all 102 outcomes and the records at the 16 hole ends (the match is decided on hole 16). The screens are
ported too: the match standings between holes (MatchStandingsScreen 3E:403F, standings.js: tallies, the holes-won
marks, "n Up" / dormie, the banners, the portraits, MatchStandingsTask), the scorecard's match-play page (0E:762F,
scorecard.js) and the result screen (RoundResultScreen 0B:59DE, result.js: map graphics from bank 0B, the map's
actors (bank 04's script engine), confetti, the palette cycle); the match18 render test above runs all of it.
Not ported: the two-player stroke result (0B:6143) and the tournament placing (0B:5B00).

#### The hole set-up (GolfRound 10:4451, per hole 10:44B4; tools/sm83_calltree.py lists what it calls)

Wind: `wWindDir` = `rand >> 8 & 3`, speed = (rand x 20) >> 16 mph, angle = the top nibble of the next random high
byte (AdvanceRandomSeed 00:0A61: seed x 5 + `$3573`); none on course 0 (`hl = $4000`). HoleIdFromCourse 10:4246
reads CourseHoleIdTable 10:4265 (course 0: the 10 practice holes; 1-5 the five clubs; 6-10 more lists). LoadHoleInfo
13:55F6 reads 32 bytes per hole id at HoleInfoTable 13:5884: par, (3 bytes not read here), yards, map bounds
`$C329-$C32C`, green corner `$D441`, tee `$D439`, then four pin positions picked by `wWindDir`; tree widths by
course from 13:5684 (32 bytes). `$D321` is set to the byte at 10:6907 (the first code byte of MissTable), until
ShotSetup recomputes it. The intro fly-over (08:6432) loads the green view, then the course view, and pans the
camera (display); DrawSortedBallObjects (11:4D79) leaves the cup's y at `$D468` in the course and green views.

---

## Data-Range Map

| Start | End | Size | Classification | Notes |
|-------|-----|------|----------------|-------|
| 00:0000 | 00:0067 | $68 | vectors | RST and interrupt vectors, see Architecture |
| 00:0100 | 00:014F | $50 | header | |
| 00:0150 | 00:30FF | ~12 KiB | code | home bank, ~110 routines named from Tennis |
| 00:3101 | 00:3FFF | ~3.8 KiB | fill `$FF` | the sound engine is not in bank 0 (Tennis has it at 00:2F1A-3DFF) |
| 01-7F | | | code and data | per-bank roles: Bank map and "Banks by role"; code coverage: Decompile Coverage |

---

## Key Findings

### Architecture

#### Vectors (tools/disasm.py 0 0000)

| Vector | Target | Meaning (shown by reading the target) |
|--------|--------|------------------------------------|
| `rst $00` | 00:0690 JumpTableDispatch | `add a ; pop hl ; ... jp hl`: A-indexed `dw` jump table inline after the `rst` |
| `rst $08` | 00:2BBB PlaySoundCmd | reads 1 inline byte (sound id) and returns past it: songs < $36, jingles $36-$3A, effects >= $40 (see Sound) |
| `rst $10` | 00:01F6 FarCallVectorInline | reads inline `db idx, bank`, switches bank, jumps to word `[bank:$4000+idx]`, restores the bank, returns past the 2 bytes |
| `rst $18` | 00:01B6 FarCall | same inline `db idx, bank` far call; keeps a/hl (code identical to Tennis 00:01B6) |
| `rst $20` | 00:2D86 SetGameFlagCmd | inline `dw` flag argument (via FetchInlineWordOperand 00:2D65) |
| `rst $28` | 00:2D93 ClearGameFlagCmd | inline `dw` |
| `rst $30` | 00:2D79 TestGameFlagCmd | inline `dw` |
| `rst $38` | — | no handler (`$FF` fill; executing `$FF` would loop) |
| VBlank | 00:2EF9 | see "VBlank" below |
| LCD STAT | 00:2F81 | `reti` only |
| Timer | 00:2F6F | farcalls 7E:40EB (sound update) while the LCD is off |
| Serial | 00:2F93 | link-cable byte protocol, see "Serial link" below |
| Joypad | 00:0060 | `reti` |

So the Tennis conventions hold, with one difference: Golf's vector table has `rst $10` as a second far call
(Tennis's `$0010` holds data; its `call $01F6` form is replaced here by `rst $10`). Golf uses `rst $10` in
Start and the interrupt handlers; `tools/farcall_stats.py` finds only 87 byte-pattern hits for it, at the level
of chance (the `rst $20` baseline gets 222), so it is rare. `rst $18` has 8067 pattern hits, ~36x the
baseline: it is the normal far call.

#### Start-up (00:2DA0 Start, 00:2DAA SoftReset)

1. `A == $11` from the boot ROM -> `hIsCGB` (`$FFFE`) = 1.
2. SoftReset: `sp = $D000`, DisableLCDSafely, clear `C000-CFEF`, clear HRAM `$FF80-$FFEF`, zero IF/IE/SCY/SCX/STAT.
3. If not CGB: farcall 01:5278 (`rst $10 ; db $02, $01`), presumably the "CGB only" screen.
4. VBK/SVBK/RP = 0, SRAM disabled, OAM DMA routine to HRAM, ClearVRAMBank, SwitchCPUSpeed (double speed),
   `hFFA6 = 6`, 00:2683, ClearFrameTasks, 00:0458, farcall 7E:4072 (sound init).
5. WX = 7, WY = $90, TMA = $77, TAC = `$04` (timer on), STAT = `$08` (HBlank int source), LYC = $50, serial
   set up, IE = `$0D` (VBlank + Timer + Serial), LCDC = `$E7`, `ei`.
6. farcall 01:400E GameMain (`rst $10 ; db $00, $01`), which never returns (a `stop` follows).

GameMain (01:400E) starts by calling 00:304D, DisableLCDSafely, then clears WRAM banks 1-7 through `hWRAMBank`.

#### Frame sync (00:2E3B AdvanceFrame)

Same structure as Tennis's AdvanceFrame (00:2631; the first 12 instructions match): saves registers; if
`hLinkActive` (`$FFC8`) is set and `hLinkIdleCount & $E0` (32+ idle serial bytes: the link cable is gone) jumps
to LinkLostReset 00:2F8D, which farcalls 08:555F and restarts at SoftReset; a debug slow-motion/frame-step block driven by `hFF9E`/`hFF9A` and the joypad bytes at
`$FF90/91/94`; then `halt` until `hVBlankDone` (`$FF8D`), runs 00:2688 and RunFrameTasks (00:247D), clears
the flag and increments `wFrameCounter` (`$C4B2`). WaitFrames (00:2EF0) calls it C times; WaitFramesCmd
(00:2ED5) takes C as an inline byte after the `call`.

#### VBlank (00:2EF9 VBlankHandler)

1. ApplyPendingPaletteUpdates.
2. Only if the main loop has consumed the last frame (`hVBlankDone` = 0): scroll from the shadows `hSCX`/`hSCY`
   with BG map `$9800`, or, when `hWindowScroll` (`$FF98`) is set, SCX 0 / SCY `$40` with BG map `$9C00`; OAM DMA
   (`call $FF80`); ProcessBGBlitQueue, and if it had nothing to do ProcessVRAMCopyQueue (queue of 10 HDMA copies at
   `$C0A0`); UpdateDebugOverlay when `hDebugMode`; set `hVBlankDone`, increment `hVBlankCount`.
3. Every VBlank: ReadJoypad; held = `$0F` (A+B+Select+Start) jumps to SoftReset; SerialVBlankTick; farcall
   7E:40EB SoundUpdate; ResumeBGMAfterJingle; UpdateGameTimer; UpdateFadeOut; UpdateFadeIn; RunFrameTasks with
   A = `$80`.

So the joypad, sound and fades run at 60 Hz even when the main loop runs slow; VRAM work is done only for
frames the main loop finished. The main loop's AdvanceFrame also calls RunFrameTasks (A = 0) and
ClearUnusedSprites.

#### Serial link (00:2F93 SerialHandler, 00:304D InitSerialLink)

InitSerialLink sends `$70` on the external clock. A side that receives `$70` becomes the internal-clock side
(`hLinkRole` = 1, rSC = `$83`); one that receives `$71` becomes the external-clock side (`hLinkRole` = 2). Then
every received byte goes to `hSerialRecv`; `hLinkIdleCount` counts consecutive `$00`/`$FF` bytes (32 of them
in a row trigger LinkLostReset through AdvanceFrame). Data travels as nibbles: the sender (00:30AD
SerialNextSendNibble) takes byte `hFFC7 >> 1` of the send buffer `$CB00`, high nibble first, and sends
`$50 | nibble`; the receiver (00:30C9 SerialStoreNibble) packs `$5x` bytes into the receive buffer `$CB40`
(index `hFFC6 >> 1`, up to 64 bytes); a received `$4x` resets the receive index (`hFFC6` = 0), i.e. starts a
block. What is sent depends on `hSerialSendMode`: the idle byte (`$10`), the block (count in `hFFC5`) or `$40`.
SerialVBlankTick (00:3038) restarts the transfer each frame on the internal-clock side. InitSerialLink is called
from GameMain 01:400E, 02:63B8, 03:402E, 07:7CDA, 08:5565 (the link-lost path), 09:48BA and three times in bank
32: those are the link-mode entry points to trace.

#### Home bank vs Mario Tennis (tools/compare_home.py)

The Tennis ROM is not needed for this: the tool reads Tennis's bank 0 from the vendored disassembly
(`../mario-tennis-gbc/third_party/mario-tennis-gbc-disasm`, the files its `main.asm` puts in ROM0), reduces both
sides to instruction shapes (registers and conditions kept, numbers and symbols replaced) and finds, for each
Tennis routine of 6+ instructions, the Golf offset that agrees for longest.

Result: of 238 Tennis home routines, **114 match in full** and 14 more match for at least half their length.
`--labels` turned the full matches into 108 labels (marked `(as in Mario Tennis 00:XXXX)`); two Golf addresses
were claimed by twin Tennis routines that differ only in their callees:

- 00:0B3C: MulHLBySin or MulHLBySinSigned. Resolved to MulHLBySin, since its callee 00:0B4C matches
  MulHLBySinHalf in full.
- 00:11CB: MulSin or DivBySin. Resolved to MulSin: its callee 00:11DB (MulSinUnsigned, different code from
  Tennis) looks the angle up in SineTable (00:1201) and calls MulHLByDE.

The 14 partial matches were read one by one; the ones that are the same routine with changes got the Tennis
name with "partial match" in the comment (ReadJoypad, ProcessVRAMCopyQueue, AngleFromVectorCoarse,
ResumeBGM, SyncBGMEnableFlag, WaitJingleEnd, TickSecondaryTimer, InitSerialLink, plus SoftReset and
AdvanceFrame). The others were chance overlaps with already-named code (FarCallVector at 00:0235 is inside
DecompressDataFromBank, MulHLByDE32 at 00:0CB6 is MulHLByDE shifted by one byte, ...) or too short to tell
(EnableLCD, QueueVRAMCopyFromBank, IncrementLinkFrameCounter, RunSoundEngine).

Layout of Golf's bank 0, in Tennis's order with shifted addresses:

| Golf range | Contents (Tennis names) | Shift vs Tennis |
|------------|-------------------------|-----------------|
| 015E-0340 | bank-switch call helpers, FarCall, CopyDataFromBank, DecompressDataFromBank, VRAM clear, OBJ palettes, SwitchCPUSpeed | 0 (same addresses) |
| 0341-0690 | LCD on/off, memory clear/copy, VRAM copy queues (changed), palettes, Far* readers, OAM DMA | -5 to -0x40 |
| 0690-0880 | JumpTableDispatch (different code), indexed far helpers, 32->64 map copies | -0x30 to -0x68 |
| 08B9-1C00 | multiply/divide, random seed, sine/trig, AngleFromVector16 | about -0x6D to +0x5ED (Golf has extra code in this area; DivAHLByDE* do not match) |
| 1F2F-2035 | LZDecompress: different code, same format as Tennis 00:1797 | |
| 203E-2400 | debug overlay/text printing, decimal/hex formatting | +0x7AB |
| 23B6-24EA | frame task list | +0x87E |
| 24EB-2660 | colour components, fades | +0x881 |
| 27B4-2B00 | sprite world positioning, BG blit queue, 64-wide map blits | about +0x850 to +0x7D0 |
| 2B31-2C60 | sound command layer (PlaySoundCmd and BGM helpers); farcalls into bank 7E | |
| 2C6B-2D10 | game timer | +0x88E |
| 2D65-2DA0 | FetchInlineWordOperand, flag commands | +0x828 |
| 2DA0-2F92 | Start, SoftReset, AdvanceFrame, WaitFrames, interrupt handlers | |
| 2F93-3100 | serial link | |

Not in Golf's bank 0 (no match at all): Tennis's sound engine (00:2F1A-3DFF: PlaySound, UpdateSoundChannels,
RunSoundChannelScript, ...), the game-flag routines by byte/number (00:249F-2523), SortFrameTasks, the text
window drawing and 3D view projection helpers (00:2A2E-2F0C), the QueueSprite* family. The sound engine is
farcalled in bank 7E (7E:4016 from PlaySoundCmd, 7E:4072 from Start, 7E:40EB from TimerHandler).

#### LZ compression (00:1F2F LZDecompress; tools/decompress.py)

Read from the code: the same format as Tennis. A control byte gives 8 flags, LSB first: 1 = literal byte,
0 = back-reference `lo, hi`. `lo = hi = 0` ends the stream. Displacement `((hi >> 5) << 8 | lo) - $800`
(the code builds `h = (hi >> 5) | $F8`), length `(hi & $1F) + 3`. The routine is unrolled (control `$FF` copies
8 literals at once; `c` holds the inverted remaining flags plus a sentinel bit). It returns hl = bytes written.
DecompressDataFromBank (00:0234) calls it with hl = `[bank:$4000 + l]`.

Checked on data: `tools/decompress.py` on the bank 28 table gives 28:452F -> 4096 bytes, 28:478D -> 4096,
28:4924 / 28:499B -> 1024, 28:4A13 -> 2048 (whole tile blocks, each stream ending on its end marker). Other
entries in the same table (28:4068, 28:4A99: 3-byte streams to 0 bytes; and some that fail) are not LZ
streams, so each table mixes compressed and raw entries.

#### Bank map (first pass; tools/scan_jumptables.py, tools/bank_map.py)

`bank_map.py` columns: `$4000` table entries, entries that LZ-decompress cleanly, `rst $18` call sites into the
bank. Assets are LZ: banks 28-2F, 40, 4B-4E, 72-74 have 12-37 clean LZ entries each.

| Banks | Evidence | Likely role |
|-------|----------|-------------|
| 01 | 7-entry table; GameMain 01:400E | boot / top level |
| 02, 05, 0A, 0B, 10 | most far-call targets (0A: ~5150 call sites, 10: ~880, 05: ~560, 02: ~370, 0B: ~220) | engine libraries |
| 28-2F, 72-74 | 22-52 entries, ~60% LZ | **overworld map graphics** (confirmed: MapGfxTable, see Graphics) |
| 40, 4B-4E | LZ entries of many sizes | UI tiles, faces, sprites (40:66F6 = menu tiles and face icons; 4D: sprite frames) |
| 30-35 | 900-1400 `rst $18` call sites each, mostly into 0A | script-like code (story / RPG mode?) |
| 7C-7E | the same sound driver code in each, songs after it | **sound driver + music** (confirmed, see Sound) |
| 7F | 2 exports | **sound effects** (confirmed) |
| 18-1F | 2 exports each, at the end of the bank, called from LoadText 05:6179 | **text banks** (confirmed, see Text) |
| 0D, 3D, 44 | 1-2 exports far from `$4000`, but real: far-called from code (0D:4AA7 from 32/3D/58; 3D:431A from 3C; 44:42FB from 05/08/32) | code |
| 46 | 2 words, no far call uses them (`scan_jumptables.py` kind `header`) | data, no export table |
| 27, 47 | no table; 27 is all `$FF` | empty / data |

These roles are guesses from counts only (except the text banks); they are listed so they can be checked.
A first pass called banks 18-1F, 44 and 46 heuristic false positives; the far-call evidence above corrected
that, and `scan_jumptables.kind()` now uses it.

#### Text (tools/dump_text.py, tools/text_stats.py; read from 05:6179, 18:7D14 and the printer 05:5235)

- **Text id** (16 bit): bank `$18 + ((id >> 10) & 7)`, index `id & $3FF`. LoadText (05:6179, export `$24` of
  bank 05) decodes it and farcalls that bank's export 0, which copies `$180` bytes of the string to wTextBuffer
  (`$C600`). LoadTextShort (05:61D4) farcalls export 1, which copies `$20` bytes to `$D880` (names, labels).
- **Text bank layout**: each bank's loader holds its own constants `ld hl, TABLE ... ld hl, DATA`. The word
  table at TABLE (`$4004` in every bank seen) holds string offsets relative to DATA (bank 18: `$4404`, 19:
  `$41B4`, ...); the table runs up to DATA. 2963 strings: 18: 512, 19: 216, 1A: 252, 1B: 285, 1C: 264, 1D: 497,
  1E: 768, 1F: 169.
- **Encoding**: ASCII `$20-$7E`; strings end with `$00`. Font: 03:50F0, one 2bpp 8x8 tile per glyph, glyph =
  char - `$20` (102 slots, `$20-$85`; `$7B` and up are blank), drawn by 03:4B45 into WRAM bank 7; per-glyph widths
  at 03:5750 (variable width).
- **Control codes**: the printer 05:5235 ends on `$00`, reads `$0E`'s argument byte into `$C361`, sends every
  byte below `$20` to the handler table at 05:592C (dispatcher 05:58E2), and maps `$DE`/`$DF` to handlers `$1E`/`$1F`.
- **Native** (web/js/golf/text.js, windows.js): the glyph renderer of bank 03 (DrawGlyph, the pen, the glyph
  buffer and its uploads), PrintTextToBuffer 05:62AA with codes `$04 $07 $08 $09 $0B $0E $0F`, the window printer
  PrintText 05:5235 with `$00/$01`, the argument lists and TextCharDelay are ported; `web/tests/golf_text_routines.mjs`
  fuzzes 34 of them against the ROM from random RAM, VRAM and registers (300 states each, all equal). PrintText's
  wrap of the shadow address at a row's end restores the old value (`push de ... pop de`): it does nothing.

| Code | Handler | Meaning (from the handler; text examples in `docs/text_dump.txt`) |
|------|---------|-----------------------------|
| `$01` (and `$00`, `$14-$1D` in the table) | 05:52EF | new line |
| `$02` | 05:538E | new text box (next page) |
| `$03` | 05:5433 | wait for A/B (joypad `& $F3`) unless flag #22 is set, then close (farcall 03:4F7D) |
| `$04` | 05:546A | insert the next string argument (list at `$DFAE`, counter `$D847`) |
| `$05` | 05:534C | pause 30 frames |
| `$06` | 05:5369 | pause up to 15 frames, skipped by a button |
| `$07` | 05:55C0 | insert the string at `$C800` (the player's name: "`{07}` checked the chest...") |
| `$08` | 05:564C | insert the next byte argument (list at `$DFEE`) |
| `$09` | 05:56AB | insert the next number argument (WRAM bank 5; "You earned `{09}` EXP Pts!") |
| `$0A` | 05:5307 | cursor down one row |
| `$0B` | 05:5786 | club / course name: text `$3C + [$D85D]` (Marion, Palm, Dune, Links, Peach, Pitch & Putt) |
| `$0C` | 05:5465 | pause 60 frames (calls WaitFramesCmd with the inline byte `$3C`) |
| `$0D` | 05:531B | uses the pointer at `$D864` and `$C362` (not yet understood) |
| `$0E xx` | 05:57DF | character name: text `$43 + xx` (`$43` Kid, `$44` Sherry, `$45` Azalea, `$46` Joe, ...) |
| `$0F` | 05:5828 | placing: text `$1CA3 + ([$DFCE] & 3)` ("000", "1st", "2nd", "3rd") |
| `$10-$13` | 05:5900-5921 | write tile `$0A-$0D` directly (special glyphs) |
| `$DE`, `$DF` | 05:5580, 05:55A0 | modify the previous glyph (Japanese dakuten / handakuten, left over from the Japanese version) |

#### Sound (banks 7C/7D/7E and 7F; tools/dump_songs.py)

- **Commands** (`rst $08 ; db id`, PlaySoundCmd 00:2BBB): id `< $36` = song id: stored in wCurrentBGM (`$C33E`)
  and passed to SoundCmdDispatch (7E:4016), which accepts it if below SongCountData (`$2B` = 43 songs) and writes
  wMusicRequest. Ids `$36-$3A` are jingles: song `JingleSongTable[id - $36]` (00, 17, 18, 19, 1A), with
  `hActiveJingle` set so the BGM comes back afterwards (WaitJingleEnd, ResumeBGMAfterJingle). Ids `>= $40`
  are effects: `id - $40` goes to SoundRequestSFX (7E:4022), which keeps the higher-priority request
  (SFXPriorityTable 7E:5235).
- **Driver**: the code at `$4000-$52D8` is byte-identical in banks 7C, 7D and 7E
  (`python3 tools/compare_banks.py 7c 7e`); each bank holds different songs after it. SongStart (7E:4186)
  picks the song's bank from SongBankTable (7E:52A5) and writes it straight to the MBC (with its own shadow
  `hFFBF`, not hROMBank); because the code is the same in every copy, execution continues in the new bank.
  SoundUpdate (7E:40EB, every VBlank) first runs the effects engine (farcall 7F:406C), then switches to
  wSoundBank and updates the four channels (7E:42B9, 4308, 4359, 43AE); SoundCheckMusicEnd (7E:49CC) marks
  the music finished when the four channel flags at `$C4CD` are clear.
- **Song table**: word `$52D7 + 2n` in the song's bank. A song header is 9 bytes: a channel mask (bit 0 =
  channel 1) and 4 channel pointers. Songs 01-09 are in 7E, 0A-16 in 7D, 17-2A in 7C; song 00 (mask 0) is
  silence (SyncBGMEnableFlag plays it to mute the music).
- **Music script** (MusicRunScript 7E:43EF, one script per channel at wChScriptPtr `$C4D5`; per-channel arrays
  of 4 bytes from `$C4CD` to `$C535`, labelled in labels.csv). A byte `< $D0` is a note: the low nibble + 1
  times wChLengthUnit is the duration in frames, the high nibble the pitch (0 = rest; on the noise channel an
  instrument from NoiseInstrumentTable 7E:4F41). The frequency is MusicFreqTable 7E:4C4B indexed from the
  octave base (MusicOctaveTable 7E:4C43) + 2 x pitch + 2 x transpose, plus the signed detune. A note sounds
  for wChGate/8 of its duration, then the release envelope. Commands (MusicCommandTable 7E:4407):

  | Byte | Effect | Byte | Effect |
  |------|--------|------|--------|
  | D0 nn | length unit | E4 nn | detune (signed) |
  | D1-D6 | octave 0-5 (wave channel +1) | E5 nn | duty (`nn & $C0`) |
  | D7 / D8 | octave up / down | E6 nn | envelope (NRx2) |
  | D9 | tie (next note not retriggered) | E7 nn | wave pattern (WavePatternTable 7E:4CDD) |
  | DA, DB, EF-FF | channel end | E8 nn | gate in eighths |
  | DC nn | panning bits (NR51 shadow wPanning) | E9 nn | wave volume after the gate |
  | DD / DE | set loop point / jump to it (song loop) | EA nn | vibrato type (VibratoTable 7E:50C9) |
  | DF nn / E0 | repeat block nn times | EB nn | vibrato delay |
  | E1 ww | jump | EC nn / ED nn | transpose set / add |
  | E2 ww / E3 | call / return (12-byte stack per channel) | EE nn | release envelope |

  The channels a sound effect is using (wSFXChannelMask `$C4CC`) are left alone by the music. Exports `$08-$14`
  (mute mask, music / effect playing tests, pause toggle, master volume, save-and-stop / restore of the whole
  driver state to `$C59A`) are never far-called in this ROM.
- **Effects**: bank 7F (2 exports: SFXStart 7F:400A, SFXUpdate 7F:406C). Two effect tables: ids `< $65` at
  7F:495C (count) / 7F:495D (pointers), ids `>= $65` at 7F:615F / 7F:6160.

#### Sound driver (native) (web/js/sound/driver.js, web/js/sound/apu.js, web/sound.html)

The whole sound driver is rewritten in JavaScript and runs without the CPU core. `SoundDriver` keeps the driver's
RAM at the game's addresses (`$C4C0-$C629`, `$C33E` wCurrentBGM, `$CAAB` wSFXBallHeight, hFFBF / hFFCD / hFFCE) and
reads songs, effects, tables and waves from the ROM by address while it runs, with the ROM bank mapped as the game
maps it: 7E on entry, the song's bank after SongStart, 7F inside the effect code. Each call returns the
sound-register writes (FF10-FF3F) the game's code makes, in order:

| JS | ROM |
|----|-----|
| `init()` | SoundInit 7E:4072 |
| `playSound(id)` | PlaySoundCmd 00:2BBB / PlaySoundManaged 00:2C19, then SoundCmdDispatch 7E:4016 or SoundRequestSFX 7E:4022 |
| `playSong(n)`, `stop()` | SoundCmdDispatch 7E:4016 (song 0 = silence) |
| `frame()` | the VBlank's sound work: SoundUpdate 7E:40EB, then ResumeBGMAfterJingle 00:2C4A |
| `update()` | SoundUpdate alone (TimerHandler 00:2F6F with the LCD off; EnableLCD 00:0371) |
| `resumeBGM()`, `stopBGMIfPlaying()`, `syncBGMEnableFlag(opt)`, `applyMusicOption(opt)`, `endJingle()` | 00:2B54, 00:2B6C, 00:2B7A, 00:2B98, the tail 00:2C35 of WaitJingleEnd |
| `setBallHeight(h)` | the copy BallTask (10:4D6E) writes to `$CAAB` for effect command `$Ex` |

Ported routines (one JS method each, the address in a comment): SoundHandleRequests 4119,
SoundSilenceMusicChannels 4145, SongStart 4186, MusicUpdateCh1-4 42B9/4308/4359/43AE, MusicRunScript 43EF with
every command of MusicCommandTable (456F-46D8), MusicPlayNote 4467, MusicAddDetune 4982, MusicCh1-4NoteOn /
NoteOff (46F8-4870), LoadWavePattern 4831, MusicCh4NoiseStep 487F, SoundUpdatePanning 48A0, MusicVibratoFreq 48D0,
MusicApplyVibrato 492E, SoundSilenceAll 499B, SoundCheckMusicEnd 49CC, the unused exports (SoundSetMuteMask,
SoundTogglePause, SoundSetMasterVolume, SoundSaveState 49F7 / SoundRestoreState 4B1C and the two wrappers); bank 7F:
SFXStart 400A, SFXUpdate 406C, SFXRunScript 40A4 with the commands of SFXCommandTable (40DE-429B), SFXApplySlide 419D,
SFXApplyNoiseSlide 41DD, SFXClearState 42BE, SFXSilenceActive 42E2, SFXSilenceAllBroken 42CB (unreferenced: its writes are
reads, so it only clears wSFXChannelMask), the unused exports SoundIsMusicPlaying 4047 / SoundIsSFXPlaying 4051 and the
helpers MusicGetStackPtr 46E0, MusicSetStackPtr 46E9, MusicNextCommand 46F4, SoundCopyBytes 4C33. **Banks 7C and 7D**:
`tools/sound_copies.py` decodes every traced routine of 7E and its copy in 7C and 7D (a 16-bit operand inside
`$4000-$7FFF` may differ only by a bank-relative shift): all 66 routines are identical, at the same addresses (3,013
bytes each), and no copy has a traced entry 7E lacks; driver.js cites them, since the music code runs from the copy in
the song's bank. (Not ported: the `$9x-$Dx` effect commands, which hang the ROM: the JS throws.)

The driver reads hardware registers back in three places: MusicApplyVibrato keeps NR11/NR21's duty bits, and the
effect code's frequency writes (SFXCmdNote, SFXApplySlide, SFXCmdBallPitch) rewrite NRx1 of the effect's channel with
its read-back `& $C0`. For the wave and noise channels that NRx1 (NR31, NR41) reads `$FF`, so `$C0` is written.
`RegFile` models those reads with the chip's read-back masks.

Quirks the port keeps (they change the writes):
- SongStart's channel 2 block writes the initial envelope `$C0` and release `$46` to channel 1's bytes (`$C527`,
  `$C52A`): channel 2's envelope and release are never reset by a new song. Channels 3 and 4 get no envelope reset.
- wChEnvelope, wChRelease and wChDetune are 3-byte arrays: on channel 4, music command `$E6` writes wChRelease[0],
  `$EE` writes wChDetune[0] and `$E4` writes the low byte of wNoisePtr.
- A negative detune subtracts its complement (MusicAddDetune 7E:4991): `$FF` (-1) leaves the frequency unchanged.
- A rest on the wave channel clears channel 1's note state `$C4D1` (MusicCh3NoteOn 7E:4828).
- A note followed by `$D9` (tie) sounds its whole length whatever the gate; durations and gates are 8-bit
  products (`(n + 1) x unit`, `duration x gate / 8`, gate 0 = 256).
- MusicVibratoFreq masks the result to 11 bits (`& 7` on the high byte); the plain note-on path does not.
- SoundRequestSFX: the lower SFXPriorityTable value wins and an equal one replaces; effect 0 always replaces
  (priority 0). The priority stays until every effect channel has ended (SFXClearState).
- SFXUpdate applies SFXApplySlide (16-bit, on NR41/NR43/NR44) to the noise channel between its script steps, while
  the wait command uses SFXApplyNoiseSlide (8-bit on `$C580`, retrigger when NR43 bit 3 flips).
- SoundSilenceAll (only reached while paused, which the game never does) writes the swapped effect mask to
  NR22/NR24/NR42/NR44 when channel 1 is held by an effect.

**Checks.** `web/tests/sound_ref.mjs` runs the ROM's own entry points on the CPU core (web/js/gb) and records the
writes; `node web/tests/sound_vs_core.mjs` compares them with the JS driver: all 43 songs for 3600 frames (18000, five minutes, with `--frames 18000`), all 108
effects (`$00-$6B`, command `$40-$AB`) alone until they end and over a song for 600 frames, the 5 jingles over a song,
and 40 random sequences of songs, jingles, effects and invalid ids over 2400 frames: 304 of 304 identical, write for
write (and 300 of 300 random sequences with `--random 300`). `node web/tests/sound_in_game.mjs [frames] [seed]` runs the game from power-on with scripted buttons and
replays every sound call it makes (SoundInit, every PlaySoundCmd / PlaySoundManaged, the bank-0 music helpers, the
VBlank, timer and EnableLCD updates) on the JS driver: 3 x 60000 frames, about 186,000 calls, all identical, and no
sound-register write outside the sound code.

**Synth.** `web/js/sound/apu.js` (SynthAPU) is the chip only: the core's channel model (pulse with sweep, wave,
noise, frame sequencer, DACs, NR50/NR51) with frame-paced rendering (70224 dots per driver frame, 59.73 Hz), a box
filter per output sample and a DC-blocking high-pass. `SoundPlayer` pairs it with the driver;
`node web/tests/sound_wav.mjs song 3` writes out/song_03.wav. `web/sound.html` loads the ROM and plays any song,
jingle or effect through driver.js and SynthAPU with Web Audio, with channel mutes and level meters.

#### Graphics (tools/render_map.py, tools/extract_tiles.py)

- **Overworld map graphics**: MapStartGfx (0B:46DF, a = wMapGfx from the MapTable record) -> MapLoadGfxScreen
  (0B:44C4) -> MapLoadGfx (0B:440C). MapGfxTable (0B:4048) has 35 descriptors (`$00-$22`, exactly the gfx ids
  the map table uses), 18 bytes each: 9 `(idx, bank)` refs into `$4000` tables:

  | Ref | Data | Destination |
  |-----|------|-------------|
  | w0 | header, 16 bytes raw | `$C600`; bytes 2-5 -> `$C329-$C32C` |
  | w1 | palettes, `$40` bytes raw | WRAM1 `D000`; BG palettes 2-7 from `+$10` |
  | w2 | tilemap, LZ, 4096 bytes | WRAM3 `D000`: 64 x 64 tile numbers, signed `$9000` addressing |
  | w3 | attribute map, LZ, 4096 bytes | WRAM2 `D000` (bits 0-2 palette, 3 VRAM bank, 5/6 flip) |
  | w4, w5 | LZ, 1024 bytes each | WRAM6 `D000`, `D400` terrain grid and event grid, 32 x 32 cells of 2 x 2 tiles (see "Banks by role", bank 0B) |
  | w6 | — | not loaded |
  | w7 | LZ | WRAM6 `D800` |
  | w8 | tiles, LZ | WRAM1 `D000`, then VRAM bank 1: first `$800` bytes to `$9000`, next `$800` to `$8800` |

  The same layout as Mario Tennis's RPG maps (Tennis 0A:59D9 has 8 refs); Tennis's RPG engine evidently
  comes from this one. `render_map.py` draws all 35 correctly (checked by eye: gfx 02 is a clubhouse
  interior, gfx 14 the Palm Club area map, gfx 1E the star background used by maps 00, 01 and 24).
- **Font**: 03:50F0 is plain 2bpp 8x8 tiles in ASCII order from `$20` (rendered: `gfx/raw_03_50f0.png`).
- **Other LZ banks**: 40, 4B-4E, 58 hold LZ entries of many sizes (`extract_tiles.py`): 40:66F6 is menu UI
  tiles (digits, pre-drawn mode labels, character face icons); 4D holds sprite frames. Not traced to loaders yet.

#### Golf round (bank 10; first pass with the emulator)

Found by playing in PyBoy (Start, A, Right x4 to Mario, A, A, A: "Play Modes" -> "Stroke: Try a practice round!"
-> hole 1, par 4, 374 y) and recording the callers of AdvanceFrame (`tools/emu_callers.py`):

- **10:4451 GolfRound** (a = round id, kept in wRoundId `$C833` / `$C839`; `$12` in that Stroke round). Per hole:
  wind from AdvanceRandomSeed (direction `wWindDir` = `rand & 3`, strength from MulHLByAFrac(rand, 20)); in link
  play (`$C893` = 3) the two Game Boys swap 5 bytes per hole (`$C836-$C838`, `$C815`, `$C816`) through the
  serial buffers. Then hole setup (farcalls 08:47B4, 08:6432, 12:6F8D, 08:47FD) and the shot loop
  (10:45E7). During aiming the frame wait is reached through 10:486B -> 10:5D19; bank 08 (08:45D3 -> 08:649F)
  also waits frames during the round.
- **10:4415** (bank 10 export 0) runs the bank-02 setup and then GolfRound(`$12`) forever; only the unreachable
  debug boot menu calls it, so it is a developer's direct-to-golf entry.
- The round runs with wMapId still 00: golf is entered from map 00's menus, not through a map warp.
- **Hole data**: see "Holes" below.

**Round structure (10:4451).** Per hole (10:44B4): wind, hole setup, then the shot loop (10:45D9-4632):
PickNextPlayer (10:4674) chooses who plays next among the players not yet holed out (player record field
`+$2A`); a shot is ShotSetup (10:4798) -> swing -> ShotLaunch (10:49B7); the loop ends when both players' holed
flags are set; then wHoleNumber (`$C837`) goes up (wrapping 19 -> 1) and wHolesLeft (`$C839`) down. Players are
`$40`-byte records at `$C880` and `$C8C0` (PlayerField 10:4B14 indexes the current one, wCurPlayer `$C835`);
field `+$20` is the stroke count on the hole (went to 1 after the first shot in the emulator).

**Swing meter** (10:57E0 for the player, 10:5643 for the computer; WRAM6). Confirmed in the emulator
(`tools/emu_watch.py`, button presses from `states/stroke_hole1.state`):

| Variable | Meaning |
|----------|---------|
| `D44E` wSwingCount | +1 per frame once the meter starts |
| `D44F` wSwingCursor | = count up to `$3C` (full), then `$78 - count` back down; the swing times out at count `$8A` (cursor -18) |
| `D450` wSwingPower | cursor at the first press (`$80` = not set; `$3C` = full power -> `D452` = 1, sound `$5E`) |
| `D451` wSwingPerfect | 1 when the second (impact) press comes with the cursor exactly at 0 (sound `$5E`) |
| `D4D8` / `D4D9` | the computer's target power and impact point (SwingMeterCPU stops the cursor at them) |

Test: presses at frames 60 / 100 / 158 / 218 after the state gave power `$3A`, a perfect impact, and a
235-yard drive ("235y" on screen, 137 y left on the 374 y hole).

**Ball** (WRAM6 `D400-D415`; BallTask 10:4D45 is registered as frame task 1 for the shot):

| Address | Field |
|---------|-------|
| `D400-D402` / `D403-D405` | x / y: 8-bit fraction + 16-bit integer; the 235 y drive moved y by `$1D59` and x by `$25`, so about 32 units per yard |
| `D406-D407` | height (8.8); `D4C1` gets a copy each frame |
| `D409` / `D40B` / `D40D` | velocity vx / vy / vz (8.8 signed) |
| `D40F` | curve (sideways force) |
| `D411` | spin / lift |
| `D413` / `D414` | speed and direction of (vx, vy), recomputed each frame (10:4CDE) |
| `D415` | 1 in the air, 0 on the ground |

Flight step (BallFlightStep 10:4EE0, while `D415` = 1): curve force `D40F x speed x $1C` added across the direction
(angle + `$40`); vz += `D411` (spin) x airspeed term x `$1C`, then vz -= `$20` (gravity; the net change seen in the
emulator was `-$19`/`-$1A` per frame); spin decays by about 1/128; wind (10:52EE) and a drag step (10:5268) act
on vx, vy, vz; position and height are integrated (10:52DA). Landing (10:4D09): height 0 and |vz| < `$20` ends
the flight (sound `$40`). Roll step (BallRollStep 10:4D86, `D415` = 0): the curve force (x `$40`), forward
speed decay x `$FC`/256, wind, and a friction factor from the terrain table at 10:67E4 (terrain type 3 plays
sound `$51` and drops the ball: water). BallTerrainCheck (10:527C) reads the terrain under the ball every frame
(TerrainAt 10:6536) and remembers the last safe spot in `D51D` (not for types 3 and 7). On the green
(`D443`) positions are taken relative to `D441`/`D442` and scaled x4.

**Ball simulator** (`tools/ball_sim.py`, with the bank-0 math in `tools/golfmath.py`): a Python port of BallTask
that reproduces the game's ball state (`D400-D415`) **exactly, step for step**. Recordings come from
`tools/emu_ball_record.py`, which snapshots WRAM6 `D400-D4FF` at every BallTask entry. Result on five shots on
hole 1 (wind 7 mph): perfect drive 437 steps, topped shot 216, late-impact shot 387, 3-wood 486, aimed-left
shot 257: **all 1783 steps identical**, through flight, bounces and roll. Details the port pinned down:

- BallSpeedAndDir (10:4CDE): direction = high byte of AngleFromVector16(**vy, vx**) (angle from +x toward +y),
  speed = IsqrtHL(vx²/65536 + vy²/65536) with MulHLByDEBothSigned.
- Air step (10:4EE0): curve push `curve x speed x $1C` along direction + `$40`; lift
  `spin x (speed x 256 + wind x cos(dir - wind dir + $80)) x $1C` added to vz with gravity `-$20`; spin decay
  `spin -= spin / 128` rounded away from zero; vx, vy move toward the wind vector by 1/256 of the difference
  and vz loses 1/256 (each rounded toward zero, 10:5268); position and 24-bit height integrated.
- Wind (10:52EE): only in the air; size WindSpeedTable[`$C815` mph] (10:5315), direction `$C816`.
- Bounce (10:4FF2): terrain factors `D448` / `D449` = TerrainPropTable bytes 0 and 2; height, vz, spin, curve
  x `D448` (height and vz negated); slope push (size -32 along the slope; plus vz x `$DD`/256 along it, vz
  halved); curve x `$40` and spin x `$40` pushes; vx, vy x `D449`. Water and bunkers: see "Putting, the cup,
  water and bunkers" below.
- Landing (10:4D09): integer height 0 and |vz| < `$20` -> rolling.
- Roll (10:4D86): curve push (x `$40`) and spin push along the direction, both decaying x `$FC`/256 each
  frame; slope push; then vx, vy x the terrain's friction byte (TerrainPropTable byte 1).
- **Slopes**: off the green, a 4 x 4-cell nibble map per tile (course asset ref 0 entry 4, WRAM1 `$D800`; bit 3
  = sloped, bits 0-2 = direction through SlopeDirTable 10:6516 with the tile's flips), push `$20`
  (SlopeCellAt 10:674E). On the green, a per-tile byte (hole asset ref 1 entry 2, WRAM6 `$D700`; strength in
  bits 4-5, push 0/2/4/6, scaled by the ball speed in 10:4E98), used while `D443` is 1-3.
- The math routines used are all checked against the ROM on random inputs (`tools/test_math.py`, via
  `tools/emu_callfn.py`, which calls a ROM routine inside PyBoy): multiplies, MulSin/MulSinCos (16- and 8-bit
  angles), AngleFromVector16, IsqrtHL (00:0F04; the Tennis name "AngleFromVector" was wrong) and DivAHLByDE
  (00:0DDB), whose three-phase division drops remainder bits for large divisors — the port reproduces that.

**Shot launch** (ShotLaunch 10:5F94, bank 10 export `$4A`; verified on the 235-yard drive with `emu_watch.py`):

1. ShotClubParams (10:5EEF) for wClub (`D329`; 0 = 1W ... `$0D` = putter): spin start (ClubParamTable 10:61A6),
   elevation from 02:518B, a curve start value from CurveStartTable (10:5F74, `+3 .. -3` x 256).
2. Speed `D416`: ShotSpeed (10:6CDB) for the player, or the computer's targets copied into the meter
   variables. Distance first: ClubBaseDistance (10:68B1) = ClubDistance (02:511A) x `$20`, where ClubDistance
   is the golfer's driver distance (wDriverDistance `D4C6`: `$010E` = 270 for Mario, the "270Y" on the HUD)
   times ClubDistanceTable[club] (02:5171: 1, .932, .864, .796, .75, .704, .659, .614, .568, .523, .477, .409,
   .318; checked in the emulator: Down on the tee switches to "3W 252Y" = 270 x .932); then the lie factor (LieFactor 10:65EF: per club and terrain, table 10:660E), the power
   (ScaleByPower 10:6865: linear, p/60 below full power), and 08:60BC. `$20` per yard matches the ~32 position
   units per yard measured on the drive.
3. Impact: `D44C` (impact height) scales the speed (x `$F9`/256 or + 7/256) and the spin; `D44B` (impact side)
   adds `-32 x D44B` to the curve; 10:6C54 / 10:6C9F add miss-hit offsets to the direction and the curve;
   elevation `D41A` gets 10:6B1F / 10:6C18 added (capped at `$3F00`).
4. MulSinCos (00:11BA) splits the speed by the elevation into horizontal speed and vz, then by the direction
   `D418` into vx, vy; the ball is put in the air (`D415` = 1; the putter rolls: `D415` = 0, sound `$48`).

On the test drive: speed `$298E`, elevation `$0A39` (14.4 deg), direction `$C194` (272 deg, up the screen) gave
vz `$0A4B` and (vx, vy) = (`$018B`, `-$2841`), equal to speed x sin / cos to within rounding.

**Putting, the cup, water and bunkers** (read from the code; every branch below is reproduced by the whole-shot
replay further down):

- **Views** (`D443` wOnGreen): 0 is the course view; 1 the green view (putting view; BallInGreenArea 10:5617:
  the ball within 5 x 4 map units of the green corner `D441`/`D442`); 2 the cup close-up; 4 occurs in normal
  shots. In views 1-3 the ball step reads the **green maps** (hole asset ref 1: terrain, slope bytes at WRAM6
  `$D700`) with positions relative to the green corner and x4; otherwise the course maps. A view change runs
  ShotViewLeave (3B:431F) and LoadShotView (13:432B), which take several frames with AdvanceFrame calls inside.
- **ShotMainLoop** (10:6E99) runs once per frame after the launch (the flight-camera loop 10:49D8 runs first) and
  returns to 10:4A25 with the shot's **outcome** in `a`:
  - outside the hole's bounds (`$C329-$C32C`) -> ShotOutOfBounds (10:6E90): sound `$40`, 30-frame wait, `a` = 7;
  - view 1: NearCup (10:7122; within `$20` of the cup `D43D`/`D43F`) and PinCheck (10:72E7) -> a low ball enters
    the cup close-up (CupViewEnter 13:44A4, `D443` = 2); view 2 goes back (CupViewLeave 13:4528) when the ball
    is high again or no longer near; otherwise BallInGreenArea picks view 0 / 1;
  - view 2: CupFlyIn (10:7263; a falling ball whose next height is below 0 over the cup) or, on the ground
    within 6 of the cup (IsqrtHL of the squared distance), CupRollIn (10:716B, `D4B1`) -> ShotHoled (10:7052): `D444` = 1,
    CupDrop (10:79AF; `a` = 2 when the ball pops back out and the loop goes on), sound `$5A`, HoleOutPlace
    (10:7888, the ball set on the cup), `a` = **`$80`**;
  - PinCheck: a ball at height `$C0-$E7` next to the pin hits it (sound `$59`, `D48E` bit 2, velocity zeroed);
  - CupPull (10:7CAB): near the cup the ball is pulled toward it (ported: `ball_sim.cup_pull`);
  - at rest (`D4D3` reaches `$28`, or B) -> ShotAtRest (10:7029): height and vz cleared, BallLieTerrain
    (10:648B) gives the terrain type, the lie quality PlayerField `$3F` / `D446` comes from a 16-byte table indexed
    by the position's fraction nibbles (fairway and type `$0E`: 10:70DB; rough: 10:7112); `a` = the terrain type
    (0 fairway, 1 rough, 2 bunker, 3 water, 6 green, 9 semirough).
- **Water** (BallBounce 10:5021, type 3): sound `$51` and the splash (WaterSplashAt 12:6A9C at the ball,
  WaterSplashGfx 12:6A7F); a ball with speed >= 5 and a landing angle (AngleFromVector16(speed x 256, -vz))
  of `$28` or more **skips**: `D48E` bit 0 and a normal bounce with the water's factors; otherwise BallStop
  (10:521C: velocity and height 0, the spot in `D4CF-D4D2`, `D4D3` = `$C8`, `D331` = 1) and the shot ends in
  the water. Rolling into water (BallRollStep 10:4E3F) splashes and stops the same way.
- **Bunkers** (types 2 and `$0D`, 10:5068): every landing sets PlayerField `$15` bit 0; a landing angle below
  `$14` **plugs**: lie `D446` / PlayerField `$3F` = 1 (2 below `$0E`), sound `$4B`, BallStop. Otherwise the ball
  bounces with the sand's factors.

**Whole-shot replay** (`tools/sm83.py`, `tools/shot_sim.py`, `tools/shot_suite.py`). `sm83.py` is an SM83
interpreter (MBC5 banking, WRAM/VRAM banks, rLY/rSTAT faked for the LCD-off waits) checked against the math ports
(`tools/test_sm83.py`). `emu_shot_record.py` records a shot in PyBoy: a full RAM snapshot at the first pass of
the main thread's loop (ShotMainLoop 10:6EAA or the flight-camera loop 10:49DD), then every AdvanceFrame entry
(F), BallTask entry (T) and loop pass (L / P) with WRAM6 `D300-D5FF` and `C800-C8FF` (round and player data).
`shot_sim.py` restores the snapshot and runs **the game's own main thread** in the interpreter from that point;
each AdvanceFrame it calls runs that frame's recorded BallTask calls (keeping hROMBank, hWRAMBank and rSVBK as
RunFrameTasks 00:247D does) and returns. At every event both RAM ranges are compared with the game, except bytes
owned by other frame tasks: the camera and display bytes `D42E-D437`, `D465-D467`, bank 11's sprite state
`D45C-D45F`, `D46B-D47F`, and the wind indicator's counters `D326-D327`. Modes: `--rom` runs only ROM code; by
default the Python ports replace BallFlightStep with BallBounce, BallLandCheck, BallRollStep, CupPull and the
cup routines (cup_sim.py); `--task` replaces BallTask as a whole (shot_py.ball_task). **`shot_run.py` runs the
whole shot in Python** (shot_py.Shot: BallTask and the main thread, the machine used only as memory) and compares
the same events. The suite (27 cases from saved states, button scripts and RAM pokes) matches **every event in
all four modes**, with the game's outcome:

| Cases | Outcome |
|-------|---------|
| tee shots, approaches, a sand shot out of a bunker, flight and roll from mid-shot states | `$00` fairway, `$01` rough, `$09` semirough, `$06` green |
| a putt from 3.6 ft that misses; three that **hole out** (the hole finished in 5); a chip falling into the cup view | `$06`, `$80` x 4 |
| a ball rolling into a bunker; a sand shot landing in sand; a flat bunker landing | `$02` |
| two vertical bunker landings (poked: no horizontal speed) -> **plugged** (lie 2) | `$02` |
| a shot over water that **skips twice** and then rolls in; a vertical water landing (poked) | `$03` |
| a ball sent into a tree trunk (bounces back at half speed) and through its canopy (slowed) (poked) | `$01` |
| a ball sent over the hole's left edge (poked) -> **out of bounds** | `$07` |

The cases the old frame-by-frame comparison could not reach were the view switches: the game spends several
frames inside LoadShotView, so the replay must know which AdvanceFrame each ball step belongs to (the F events).

**The cup in detail** (tools/cup_sim.py; each routine checked against the ROM on random states by
tools/test_cup.py, and in the suite). Offsets are 8.8 from the cup (`D43D`/`D43F`):

- CupOffsets (10:73CA): `D499`/`D49B` = ball - cup, `D4A5` = Dist16 (sqrt in steps of 16). Dist16 below `$200`
  on the ground in the cup view (and `D4D5` clear) drops the ball at once (CupRollIn 10:716B); otherwise
  PathNearest (10:74A1, via PathOffset 10:741D) finds where the path passes the cup, and the ball drops when
  3 x speed is below twice that miss distance scaled by the angle (`D4B1`).
- CupDrop (10:79AF) unregisters BallTask and runs its own loop, one AdvanceFrame per pass: the ball moves by
  vx / vy; RimClamp (10:78AD) keeps it within 6 x 256 of the centre (`D4B8` bit 0 at the wall, bit 1 near the
  centre); CupSink (10:7860) adds gravity `-$38` per frame until the height reaches `-$14` (in: `a` = 1). At the
  wall, CupDeflect (10:760E: Reflect 10:771E about the contact point from PinContact 10:750B, and CupWall
  10:7A63 when lower than 4) turns the velocity; if the height comes back above 0 the ball pops out (`a` = 2:
  back in the air, BallTask on again, the main loop goes on; seen in three of the suite's putts).
- PinCheck (10:72E7): with the height below `$E8` and PinDist (10:62AD, a 24-bit distance through Isqrt24
  00:1D6A) at most 2, a ball at `$C0-$E7` hits the flagstick and drops (velocity 0, sound `$59`); lower it
  bounces off (PinBounce 10:765F: half the reflected velocity, sound `$58`). Once per shot (`D4B9`).

**Trees** (TreeCheck 08:51D2, part of BallTask, not in the green views 1 / 2). A tile is a tree when bit 7 of its
`$D700` byte is set. The height (`D407-D408` x 8 / 256, below `$18`) picks a half width from `D4F3` (hole 1:
`$11` for levels 0-3, then `$40`-`$50`); the ball's spot in the tile (4 + 4 bits) gives the distance and angle
to the trunk (tables 08:5426 and 08:5326); the tree is hit when the sideways distance of the trunk from the
ball's direction is below the width. Bit 0 of the width means solid: the direction is mirrored about the trunk
and the speed halved; otherwise (leaves) vx, vy x `$E6`/256 and vz x `$F0`/256. `D48E` bit 4 is set and the tile
is remembered (`D516`/`D519`) so it hits once.

**ShotLaunch in detail** (tools/launch_py.py; tools/test_launch.py checks recorded launches and 300 random swings
against the ROM). In order: the position is saved to `D51D`; ShotClubParams (10:5EEF) loads spin and base speed
(ClubParamTable 10:61A6), the elevation (ClubElevation 02:518B: per club + per trajectory class `D4C8`), the
direction offset of the shot shape (ShotShape 10:6B03: the golfer's `D4CA`, nudged for the driver by equipment
bits `D4CC`, mirrored by `D333` bit 0; ShapeDirection 08:607C) and the curve start (CurveStartTable). Then the
speed: the computer copies its targets into the meter; the player's is ShotSpeed (10:6CDB):
ClubBaseDistance (driver distance `D4C6` x ClubDistanceTable, x `$20`, +10% in shot mode 1) x the lie factor
(LieFactor 10:65EF by LieClass 10:6672: terrain `D4CD` and lie quality `D446`; a factor sum of `$A0` or more
with a perfect full swing sets the cue bit `D48E` bit 3) x the miss factor (MissSpeed 10:6BC7 by MissIndex
10:6B1F: the impact cursor through a per-golfer table `D321`) x the power curve, then / 32 and ShapeSpeed
(08:60BC); that distance indexes one of nine **distance -> launch speed tables** in banks 38-3A chosen by the
trajectory class (10:6D6A; odd indices average two entries; shot mode 2 uses a byte table). The putter instead
reads a speed straight from 10:6DCD by range `D32B` and power. The club's base speed is scaled by that
(ScaleSpeed 10:6134), and by the impact height `D44C` (x `$F9`/256 above, + 7/256 below). Except for the putter,
the miss index adds an elevation change (MissElevation 10:6C18, capped at `$3F00`), a direction change
(MissDirection 10:6C54, x 1.5 from lie terrain `$0C`) and a curve change (MissCurve 10:6C9F), each through the
golfer's control `D4CB` (Control 10:6BEF); the spin is scaled by the impact height and the power, and the impact
side `D44B` adds `-32 x side` to the curve. Last, MulSinCos splits the speed by the elevation and the direction
into vx, vy, vz. After it (10:49A3): the stop spot is cleared, the lie reset, in shot mode 1 an imperfect swing
uses up a power shot (PowerShotUse 10:433B), `D438` = `$11`, and BallTask starts (ShotFly 10:49B7; on the green
views the flight camera is skipped).

**The swing** (tools/swing_py.py and shot_py.Shot.address / swing / after_swing; the whole golf shot from the
moment the golfer addresses the ball). ShotSetup (10:4798) is the whole shot: lie and club set-up, the aiming
menu (AimMenu 10:5BA6), then AddressBall (10:56B0): Up / Down change club (view 4), Left / Right nudge the aim
`D418` by `$80` per frame (at most 8 steps either way), A starts the swing, B returns to the menu. The meter
(SwingMeterLoop 10:57E0, main thread) counts `D44E` up each frame; the cursor `D44F` follows it to `$3C` and
back; presses are read every second frame (odd frames latched in `D453`). The first A sets the power (the
putter swings at once, with its range `D32B` as the shot mode), the second the impact (perfect at cursor 0);
without power the swing is cancelled at count `$78` (or B): 20 frames and back to the address; without impact
it ends at count `$8A`. Meanwhile frame task 10:55AC turns the d-pad held into the impact side and height
(`D44B` / `D44C`, table 10:55CE): those are the hook / slice and top / low controls. After the swing
(10:4921): the shot record (ShotRecord 02:46B0), in view 4 the wait until the swing animation reaches the
club's contact mark (`D464`, script 11:6ECD by golfer and club), otherwise a fixed `$30` / `$24` / `$32`
frames; the retry copy (`D359-D36A`), one stroke more (CountStroke 10:477C), and ShotLaunch.

Two frame tasks matter for the RAM before the launch: the golfer's animation (11:6E3E; LoadShotView stops it)
and, while aiming and addressing (`D485` bit 4), the **landing preview** (11:4E5E): every 32 frames a ghost
ball is launched from a perfect full swing with the current aim (PreviewRestart 10:543C, which reuses
ShotClubParams and ShotSpeed and so rewrites `D40F-D41D`), then flown each frame with BallFlightStep's
rules (PreviewStep 10:5355: it borrows the real ball's speed, direction, curve and spin, and the real ball's
height for the wind, so on the tee it flies without wind) until a tree stops it (08:5109). None of what it
writes survives into the launch: ShotLaunch rebuilds those values.

The joypad (ReadJoypad 00:02EB, in VBlank; tools/joypad.py): held, newly pressed, and auto-repeat (on the
first frame of a change, then every `$FFA6` frames after 18). `emu_shot_record.py --from-address` records from
AddressBall with the joypad of every frame; `shot_run.py` replays it in Python either from those bytes or from
the button script through joypad.py, and both match every event of every suite case. `shot_run.py REC --free
--press 100:a 160:a 220:a 150:left:80` plays any swing from the address: e.g. from hole 1's tee a well-timed
drive goes about 250 yards, an early or late impact hooks or slices, holding right through the swing pushes
it into a bunker, a club down per press shortens it.

**A hole** (tools/hole_py.py; hole_run.py checks recorded holes, play_hole.py plays one in Python). After the
shot (PostShot 10:4A82): a putt is counted when the shot started on the green; OutcomeRules (3B:7260) applies
the result: the hole's bonus `D4F1` (+10 for a water skip; +4 reaching the green off the pin, +2 reaching it with three
or more strokes to spare against par, or two and within `$21` of the pin), points `C83C` when holed (the bonus, +10 off the pin, +6 / +8
holed from off the green, +4 for a putt from `$280`, +6 birdie, +10 eagle, +16 albatross, +20 hole in one,
each x the course factor / 2, in modes 1-3, 5, `$0A`, `$0B`), **water**: a penalty stroke and the ball back to
the last safe spot `D51D`, **out of bounds**: a penalty stroke and the old spot kept (stroke and distance);
the new spot goes to the player's record (PlayerField `$22`). The loop (10:45E7): a stroke limit of 3 x par
in some modes, the scorecard when holed (Scorecard 10:4101), the next player (PickNextPlayer 10:4674: the
farther from the pin; it loads the ball and the golfer's stats). ShotSetup (10:4798): lie and lie quality,
the club the game picks (PickClub 10:6341: the most lofted club that reaches the pin, from those the lie
allows), the aim (AimMenu 10:5BA6 -> SmartAim 10:6406: at the cup, or a direction whose landing is fairway or
green), the putter's range by distance (`D32B`: 0, 1 from `$140`, 2 from `$42B`), the view behind the golfer
and its camera (11:476E: at the ball, angle `$C000` - aim). The flight camera also ends when the ball leaves
its picture (BallView4 11:4795 sets `D331`), which decides how many frames a long shot spends in it.

Four recorded holes (tools/hole_suite.py: bot play chosen by the Python engine; hole 1 in par, hole 2 in six,
hole 2 with two balls in the water, hole 1 with one out of bounds) match the game in every shot frame by frame,
at every address step, and in the round and player records at the end. Only the display state that depends on
how long the menus took (the golfer's idle animation, the landing preview, the target marker) is taken from the
recording at an address step; all of it is rebuilt before it is read. `play_hole.py` plays a whole hole in Python
in about two seconds, and on hole 1 its shots are the ones the game played.

**From swing to outcome in Python.** With `emu_shot_record.py --from-launch` the recording starts at ShotLaunch's
entry (event S); `shot_run.py` then runs the launch, the flight, the main loop and the cup in Python. All the
suite's swing cases are recorded that way, and every event of every case matches. `shot_run.py REC --free
W6:D450=20 ...` plays a recorded swing out with a changed power, club or impact, without the game.

**The rest of BallTask** (10:4D45, all in shot_py.ball_task): after the step, BallTerrainCheck (10:527C) saves
the position to `D51D` unless on water or out of bounds; TreeCheck; B sets `D360`; RestWatch (10:7077) counts
frames at the same integer spot in `D4D3` (the main loop ends the shot at `$28`); the height goes to `CAAB` and
`D4C1`.

**The main thread's frames** (what decides how many ball steps a shot gets): the flight-camera loop (10:49D8)
runs until the first touch-down (`D331`), the green area, or `$5A` frames; then LoadShotView (one AdvanceFrame,
13:4462), WaitFramesCmd 1, the cue 3B:4339 (`D48E` bit 3 without bit 4), WaitFramesCmd 1, and ShotMainLoop.
In the loop a change between views 0 and 1 costs ShotViewLeave (one AdvanceFrame, 3B:432F) and LoadShotView
(one); the cup close-up (1 <-> 2) costs none; out of bounds waits 30 frames; HoleOutPlace 30. A fade
(WaitFade 00:2625) only runs when the screen was faded out, which does not happen mid-shot.

#### Holes (bank 13 loaders; tools/render_hole.py, tools/emu_hole_check.py, tools/hole_stats.py)

- **HoleAssetTable (13:4A16)**: one 16-byte row (8 refs `(idx, bank)`) per hole id; the current id is wHoleId
  (WRAM6 `$D320`; `$0A` in the Stroke round's hole 1). Each ref names a list in a bank's `$4000` table, and
  FarDispatchIndexed (00:069A) LZ-decompresses entry n of that list. HoleAsset (13:49EE) maps (ref, entry) for
  the current hole.
- **Ids `$0A-$63` are the 5 courses x 18 holes**: the course tile set (ref 0) changes every 18 rows: `$0A-$1B`
  50:00, `$1C-$2D` 50:02, `$2E-$3F` 51:00, `$40-$51` 51:02, `$52-$63` 52:00 — the five clubs Marion, Palm, Dune,
  Links and Peach's Castle (renders: `$2E` is a desert hole, `$52` is shaped like Peach). Ids `$00-$09` and
  `$64` up reuse a few assets (practice and special rows, not traced).
- **Overhead view** (HoleLoadMaps 13:4014, HoleLoadTiles 13:40CA, when `hFFB0` = 0):

  | Asset | Destination |
  |-------|-------------|
  | ref 0 (course) entry 0: palettes | `$40` bytes copied; the first `$28` are BG palettes 2-6 (checked against wBGPalMaster `$C200`) |
  | ref 0 entry 1: tiles (LZ) | WRAM1 -> VRAM bank 1, `$9000` then `$8800` (signed addressing, LCDC `$E7`) |
  | ref 0 entry 3: terrain table (LZ, 2048 bytes) | WRAM6 `$D800`: 8 bytes per tile = 4 x 4 cells of 4-bit terrain types |
  | ref 0 entry 4 (LZ, 2048 bytes) | WRAM1 `$D800`: slope nibbles, 4 x 4 cells per tile (read by SlopeCellAt 10:674E) |
  | ref 1 (hole) entry 0: attributes (LZ, 4096) | WRAM2 `$D000` |
  | ref 1 entry 1: tilemap (LZ, 4096) | WRAM3 `$D000`, 64 x 64 |
  | ref 1 entry 2 (LZ, 256) | WRAM6 `$D700`: green slope byte per tile (GreenSlopeAt 10:64D1) |
  | ref 1 entry 3 | WRAM4 `$DC00` via 00:0749 (not identified) |
  | refs 2-4 | the behind-the-golfer view (`hFFB0` = 1 paths; banks 55, 56, 12, 13) |

  `emu_hole_check.py` on hole 1: tilemap, attributes and terrain table equal the decoded assets byte for byte;
  VRAM1 `$8800` equals the second half of the tiles, `$9000` all but tiles `$00-$10` (overwritten by the HUD).
- **Terrain** (TerrainAt 10:6536): ball x/y integer parts -> tile (64 x 64, one tile = 256 position units, about
  8 yards) and cell (64 units); the tile's attribute flips are applied to the cell. Types seen on hole 1:
  `0` fairway (also the tee box), `1` rough, `2` bunker, `6` green, `7` out of bounds (the tree area),
  `9` semi-rough (the ring round fairway and green; the game showed "SemiRough" where the test drive stopped);
  `3` is water (BallRollStep plays sound `$51`; friction byte `+$01`). TerrainPropTable (10:6825) holds 4 bytes
  per type; byte 1 is the roll friction (fairway `$F8`, rough `$E0`, bunker `$F0`, green `$FC`, OB `$80`).

#### Save (bank 02; tools/dump_save.py)

| SRAM | Content |
|------|---------|
| `$A020-$A02F` | "CAMELOT GAMEBOY" + `$00` (02:4162) |
| `$A030` | 16-bit sum of `$A032-$A1BF` (SaveChecksum 02:419D) |
| `$A040 + 32 n` | block directory, 12 entries: `[used, SRAM bank, offset from $A000 (word), length (word), sum (word), ...]` |
| `$A200-$BFFF` | the blocks (fresh save: blocks 0-2 `$200` bytes at `$A200/$A400/$A600`; 3 `$400` at `$A800`; 4-7 `$280` at `$AC00/$AE80/$B100/$B380`, marked used; 8-11 `$200` at `$B800-$BE00`) |
| `$B620-$B7BF` | backup of `$A020-$A1BF` (in the gap between block 7, which ends at `$B600`, and block 8 at `$B800`) |

SaveLoad (02:41F6, bank 02 export 1, called by GameMain) checks signature and checksum; if they fail it
restores the backup and checks again; if that fails too it erases SRAM (02:4172), writes the defaults (02:4078)
and commits (02:41C1: checksum + backup). SaveBlockLoad (02:4355) copies a block to WRAM and checks its sum
(`$FE` = empty, `$FF` = bad). `dump_save.py` on the emulator's fresh save: signature and checksum valid, backup
equal, the directory as above. What each block holds (characters, records, tournament progress) is not
traced; three `$200` blocks would fit the three create-a-character slots on the character select.

#### Banks by role (labelling pass; names in labels.csv)

##### Bank 0B: map graphics, map buffers, result screens, records queries, ending credits

A mixed library, not just map graphics.

- **Map graphics** (exports $00-$1E): MapStartGfx / MapLoadGfxScreen / MapLoadGfx (already known), plus
  MapDrawFullScreen 0B:4306 (22 x 20 tiles from the 64x64 WRAM2 attribute / WRAM3 tile maps into $9800, both
  VRAM banks; a = 0 centres the camera first with MapCenterCamera 0B:49D3). The camera is wMapScrollX/Y
  ($C320/$C322, high byte = tile), clamped to the 4 header bytes $C329-$C32C (min x, min y, width, height).
  MapGfxStartTileAnim 0B:4900 / MapGfxStopTileAnim 0B:497D call export 0 / 2 of the gfx banks 28-2F, 72-74
  through MapGfxAnimTable 0B:42C0 (tile animations, frame task in that bank, state $C32F-$C33C).
  DebugMapGfxViewer 0B:4579 (from the debug menu 05:6B7B) shows any gfx id picked with 05:5197.
- **The two WRAM6 grids** (MapGfxTable refs w4 / w5, 32x32 cells of 2x2 tiles, address
  `$D000/$D400 + (y/2)*32 + x/2` with x, y in tiles): `$D000` is terrain (bank 04 walking speed drops on value
  $0B, 04:541A), `$D400` is the event grid read by the map engine: low nibble 1 = trigger, 8 = object, $C = talk
  across a counter; high nibble = id (0A:4C9B, 0A:4D1F). Get/set/rect-copy helpers 0B:45AB-46DE (rect copies
  are used by map scripts 33-35).
- **Map buffer edits**: MapBufCopyRect 0B:6DC7 / MapBufCopyRectRedraw 0B:4864 copy a tile rectangle
  (src (b c), dst (d e), size (h l)) inside the 64x64 maps; the second redraws the screen (05:4492, 05:42AD) and
  is far-called by the map scripts (30-32) to change rooms (doors etc.).
- **Round result screen** RoundResultScreen 0B:59DE (export $18; callers bank 08 and script 32) loads map gfx
  $0A (gfx/map_0a.png is the result-screen sheet: WIN/LOSE plates, digits, trophies, "Congratulations"),
  then DrawRankResult 0B:61CF (a = 1: rank digits, course name by $C836, score $C8BE) or DrawVsResult 0B:5F54
  (1P/2P plates, portraits, hole counts from wMatchHoles $C96E via MatchHolesUp 0B:65AE). All drawing is
  MapBufCopyRect from the sheet, numbers by DrawResultNumber 0B:65FE / DrawResultSign 0B:6646. Waits A/B/Start.
- **Records queries** (exports $28-$42, callers mostly bank 0C): LoadRecordsBlock 0B:4FB7 loads save block 3
  into WRAM6 $DC00 ($32-byte records; RecordsSelect sets $D224); bit-field queries return in b/c or $D226
  (RecordsHoleBit 0B:5303 reads an 18-bit per-hole field at record +$2F). Game meaning of the fields not traced.
- **Menu glue**: ModeSelectMenuLoop 0B:4D9D (from map script 32:54EC) drives MainMenu 07:4006 and two
  submenus (07:51A6, 07:63EC) into bank 0C screens, the character select 06:6071 and EventListScreen 0A:6F56.
  A failed load or empty roster shows a picture message (ShowSaveMessageAndWait 0B:4F66).
- **Ending credits**: CreditsRun 0B:5395 (part a = $C2AC, from 0A:573B) prints the staff text ($1900+ in bank 1E)
  into the window and scrolls it (0B:56EF-5883); CopyrightScreen 0B:58B0 shows Camelot / Monegi / Nintendo.
- Data tables: 0B:42C0 anim table; 0B:572C credit pages; 0B:5209 / 51F7 / 521B records index tables.
- Odd: xref.py lists far calls to 0B:4637 (MapSetEventAt) from 7D:78D0/79E8/7A75, inside the sound bank;
  probably data bytes that look like `rst $18`, not real calls.

##### Bank 0A: the map engine (extends REVERSE.md "Top level")

- **Actors**: WRAM4 `$D000 + slot*$40`, up to $18 slots (ActorSlotAddr 0A:42E0). Known fields: +0/+1/+2 handler
  address and bank (ActorSetScript 0A:431E: an actor script, bytecode run by 04:4234; default 0A:435D), +4/+6 x/y words (ActorSetPos 0A:43C6), +$10
  facing (bits 6-7 direction; ActorSetFacing 0A:4644), +$12 bit 0 busy, +$29 angle. wPlayerActor $C290 and
  wScriptActor $C292 hold slot pointers. ActorPointAhead 0A:4C6A gives a point at a distance ahead of an actor.
- **Map header fields resolved**: +4 object spawn list (MapInitObjects 0A:4F45 -> 04:5084), +6 talk list
  (MapTalkTo 0A:4F96), +8 object list (MapUseObject 0A:5066), **+10 trigger list** (MapStepTrigger 0A:50CB
  for wMapEvent+0, MapCheckTrigger 0A:5109 for the A button), **+12 enter script** (MapRunEnterScript 0A:4F71).
  All lists are 8-byte records `[id, facing mask, flag word (bit 15 = inverted), script, ...]`, searched by
  MapListFind / MapListFindIfFlag (0A:4EA0 / 4EC5) and copied to wMapRecord $C400.
- **Scripts**: MapRunScript 0A:4EFF: a "script" below $2000 is a text id shown with 05:5D49; otherwise code in
  the header bank called between ScriptBegin / ScriptEnd (0A:4092 / 40D6). ScriptWaitFrames 0A:410D is the
  wait used ~785 times by script banks 30-35.
- MapShowNameBanner 0A:4DDB shows text $12C + map index for 80 frames at map start (bank 18 names such as
  "Marion Clubhouse", "Norio Sample", "Mini-Character Test": a development banner?).
- Return point: MapSaveReturnPoint / MapWarpToReturnPoint (0A:4D5B / 4D8A, wReturnMap $C960).
- **NavigationMenu 0A:7174** (map 2's A button and 41:7413): the "Navigation" list (text $1A05-$1A13: clubs,
  Peach's Castle, Golf Clinic, Club Maker's Hut, Windy Valley, ... Quit) of places whose flag is set (table
  0A:6FA9); writes wNavDestination $C2A7, read by 0A:78CE-7A20. RAM $C473-$C480.
- **EventListScreen 0A:6F56** (export $58): pages Marion / Palm / Dune / Links / Field ($19E1+page) listing the
  lessons and contests (Shot Lesson, Approach Contest, ...) that are unlocked (flags 0A:680A), with a mark for
  cleared ones (flags 0A:6852). RAM $C470-$C472.
- Bug (latent): ScriptWaitFrames 0A:410D jumps to its `ret` with af and bc still pushed when a = 0 and flag #22
  is clear; any caller passing 0 frames would return to a garbage address.

##### Bank 06: name entry and character select

- NameEntryScreen 06:51DC (export 2): letter grid 17 x 6 (layout 06:505B, two pages $C4B3), cursor $C3F6/$C3F7,
  name up to 7 letters in wPlayerName $C800; Select jumps to END; on END $C80B-$C80F get random bytes; empty name
  takes a default from 05:40C2.
- CharacterSelectScreen 06:6071 (export $0C; 06:6D3E is a variant without the big portrait): the roster built by
  02:5B5B at $D658 (10 records of 32 bytes: +0 character, +2 name, +$0D, +$0E word, +$10, +$11) shown as a 5x2
  grid; an empty slot ($0B) reads "Create a new character here." (text $10F6). Cursor $D214, remembered in $CABE.
  Portraits are LZ per character (tables 06:637E, 06:6E35).
- 06:4EA8 (export 0) is a bare `ret`. 06:6914 prints the remembered cursor with PrintHexByte (debug leftover).

##### Bank 07: graphical menu engine

- MenuScreenInit 07:741E + MenuSelect 07:7C00: menus whose items are pre-drawn LZ pictures (descriptor at hl:
  item gfx words, +$28 = extra tiles), highlighted by blinking; Up/Down wrap, A = item, B = $FF. With the link
  flag ($D205) item 1 performs a serial handshake (send $10, wait $20) and returns $11.
- Three menus: MainMenu 07:4006 (3 items when the records block loads, else 2), MenuFiveItems 07:51A6,
  MenuFourItems 07:63EC; cursors remembered at $CABB-$CABD. The item pictures were not rendered, so item
  meanings are unknown.

##### Bank 09: second copy of the menu engine

- 09:400A-498F is the same code as 07:741E-7DAF (only addresses differ) (MenuScreenInit / MenuSelect / item drawing) with its own
  graphics; MenuScreenInitAlt 09:7AD5 is a variant. Menus: LinkMenu 09:4A12 (export 0, link handshake on),
  09:5AC5 (2 items), 09:6A74 (3 items) and 09:6A9B (redraw of that menu; called from 00:125B and script 32);
  cursors $CAB8-$CABA. All are far-called from map script bank 32.

Read from the code. Texts are from `tools/dump_text.py`. The labels are in `labels_a2.csv` (162 lines: 131 routines, 17 data tables and 14 RAM labels).

##### Character record at $C800 (what these banks read)

| Offset | Use (evidence) |
|---|---|
| +$00 | name (wPlayerName; 41:6D25, 41:5765) |
| +$10 | character 0-3 (wCharId; 42:400B indexes 42:41F2 with it) |
| +$12 | level, max $63 (wCharLevel; 02:546B level-up test, 02:4FFA, 41:550C) |
| +$1A (word), +$1C-$1F | values shown on the level-up and stats screens (41:49ED -> $D63E, $D640-$D646) |
| +$20 +$21 +$22 +$24 | points given to the 4 skills (02:4FFA: d = 0-3 increments one of them and the level) |
| +$26 (3 bytes) | EXP, 24 bit (41:57A9 prints it in decimal) |
| +$2D bit 7 | set while a bank 41 screen or menu is open |
| +$34 / +$36 / +$37 | mode (9 = on the overworld, map name instead) / course / hole for the card (41:7C7D, 48:4696, 48:480D) |
| $C819 bits 1-2 | badge value shown on the stats screen (02:5395, 41:65D1) |

##### Bank 41: level-up and stats screens, pause/start menus, credits

Export table at `$4000` (21 words):

| idx | Routine | Callers |
|---|---|---|
| $00 | 41:402A LevelUpScreen | map scripts 30-35, 48:4DA2 (after EXP), 57 |
| $02 | 41:6FF4 RunMenu | internal |
| $04 | 41:707C ClearMenuState | 05:40B9 |
| $06-$1A | menus (table below) | 08, 0A, 2D, 70 |
| $1C / $1E | 41:7DB3 / 41:7DF4 open/close the character summary | no caller found / 32:7D77 |
| $20 | 41:77EA DebugPointsEditor | 08:46FF |
| $22 | 41:6506 CharDataScreen | 0B:4F18, 41:7945 |
| $24 | 41:6784 CharYesNoPrompt | 31:4673, 32:7A75, 32:7B70 |
| $26 | 41:7E07 StaffCredits | 01:4115, 31:7835 |
| $28 | 41:7BB4 PutMenuTile | 05:4F82-4FC2 (8 calls) |

- **Level-up screen** (41:402A): returns at once (`ret nz`) unless 02:546B says the EXP at +$26 reaches the next level. 41:48F4 finds how many levels are due: it calls 02:546B and 02:4FFA in a loop, counts them in `$D435`, then restores the record. The player gives that many points to the four skills (texts $10DF-$10EA: "Improve which skill?", Drive, Height, Shot, "Meet Area and" Control, "Is this OK?", Yes/No).
  - The phase is in `$D632`: 0 = message, 1 = choosing a skill (Left/Right move `$D630`; A adds a point with 02:4FFA and records it in the history `$D4D2`, count `$D4D1`), 2 = Yes/No (`$D40A`), 3 = done.
  - B undoes the last point (41:550C).
  - Eight frame tasks run while the screen is up: cursor blink 41:42FA / 41:4328, gauges, palette cycling 41:50D2 (table 41:6486), and the character sprite 42:4074 through 41:5088.
  - Each skill is shown as a gauge from -4 to +4 (41:4F71). The preview delta comes from 02:503C.
- **Stats screen** (41:6506, the "Char. Data" menu item) reuses the same drawing with phase 0. **CharYesNoPrompt** (41:6784) asks "Is this OK?", "Copy <name>?" or "Erase <name>?" over it. It saves and restores the whole screen (palettes, WRAM2/3 buffers, VRAM1 $9000, VRAM $8400) with 41:6D4E / 41:6DC7, and returns a = 1 for Yes.
- **Menus**: every menu export sets bit 7 of +$2D, calls a set-up routine (text id of the options, handler word table, window size) and then RunMenu (41:6FF4). RunMenu opens the window with 05:4BB0 (wMenuWindow `$C3F8`), reads the choice with 05:4CD7 and jumps through the handler table. Handlers leave their result in wMenuResult `$C3FD`.

| Export | Text | Options |
|---|---|---|
| $06 41:6E49 | $147F | Camera Mode, Course Map, Scorecard, Settings, Give Up, Quit |
| $08 41:6E6E | $1480 / $1481 | Char. Data, Stars, Message, Save & Quit (Navigation first on map 2): the map start menu, wMapEvent +4 |
| $0A 41:6E96 | $1482 / $1483 | golf pause menu with Save & Quit |
| $0C 41:6EBB | $1482 | same text, handlers 41:756F |
| $0E 41:6EE0 | $1484 | Camera Mode, Course Map, Hole Out, Wind Direction, Wind Speed, Settings, Back to Menu |
| $10 / $12 | $1485 / $1486 | Quit Practice (+ Wind Direction / Wind Speed), Settings |
| $14 / $16 | $1488 / $1489 | Continue, Mulligan, Hole Out / Start Over, Back to Main Menu |
| $18 41:6F9F | $148A | Quit Mini-Game, Settings |
| $1A 41:6FC4 | $1480 | the map menu from bank 70 |

- **Credits** (41:7E07): plays song 3 and scrolls `hSCY` one pixel per two frames. Each 16 pixels it prints the next string from text $181C onward ("MARIO GOLF STAFF" ...) and stops at a string that starts with '#'. A, B or Start then leaves through 01:41B3.
- **Debug leftover**: 41:77EA is a points editor, reached from 08:46F3 after a golf pause menu when `hDebugMode` is set and Select is held. It shows wPoints `$C83C`; A adds 100, Right adds 10 and Left subtracts 10 (02:544E); B gives the points as EXP (48:4D70).
- **RAM**: the screen variables are WRAM6 scratch (`$D400-$D4D2`, `$D5A4`, `$D630-$D657`). They overlap the golf ball variables (wBallX ... wCameraX), so the names that labels.csv gives to those addresses do not apply inside this bank.
- **Corrections to the hints**:
  - 41:4780 writes `$D345` with WRAM bank **2** selected (41:450B), so it is a byte of the level-up attribute-map buffer and not the 3B caption state.
  - 41:4A99, 41:4B80 and 41:557D write `$D455` with WRAM6 selected, but here it holds a copy of skill points (+$22) that the screen shows, not the HUD flag of 12:4B19.
  - These are address overlaps, not real accesses to those variables.

##### Bank 48: EXP award screen and character card

Exports: $00 48:4053 ExpScreen, $02/$04 48:4A81/4AC3 (graphic prompts, 32:7D3C/7D4D), $06 48:4A27 (Yes/No input, no caller found), $08 48:4D70 AwardExpPoints, $0A 48:5E42 ShowPictureScreen, $0C `$6C00` (no caller; neither code nor LZ, left unlabelled).

- **ExpScreen**(a, de, h): a = 0 shows only the character card (name and level 48:4639; mode, course, hole and score 48:4696, or the map name 48:480D when +$34 = 9).
  - Otherwise de EXP are counted into the character (48:4C02; award `$D630`, counted `$D632`, points to the next level `$D63C`/`$D642`, done `$D638`).
  - h picks the message (48:4C7D): 0 "Calculating EXP Pts.", 1 "Bring EXP Pts from N64 Mario Golf." (the N64 transfer text), 2 "Pts to next level:", 3 "Level up!" (sound $63), 4 "Your level increased.", 5 "It's the highest level!".
  - The count runs one step per 4 frames. After A or B (latched in `$D639`) it runs every frame, with extra steps while 1000+ or 10000+ EXP remain.
  - A bonus line (48:4DFF) is drawn from `$CAAD`: 1-3 Gold / Silver / Bronze Trophy, or "for beating" an opponent ($14-$19 -> text $47-$4C Putts, Grace, Tiny, Gene Yuss, Mario, Luigi; others Wario). `$CAAE` is the amount added.
  - It commits with 02:5465.
- **AwardExpPoints** (48:4D70) is called by 08:4F29 after a round with wPoints, by map script 32:5146 and by the debug editor. It runs ExpScreen and, when a level is reached (`$D63B`), LevelUpScreen 41:402A and then ExpScreen with message 4.
- **ShowPictureScreen** (48:5E42) runs from 08:4F75 when wHolesLeft = $0A. It shows an LZ full-screen picture for up to $0E10 frames (one minute) or until a key is pressed. What the picture is has not been looked at.
- Drawing goes into the WRAM1 buffers (`$D000` attributes, `$D400` tiles, 32 wide; 48:48CF). Tile strings handle dakuten codes $9E/$9F/$DE/$DF (48:4867), a leftover of the Japanese text.
- **Leftovers**: 48:47D7 is the same code as 48:4791. 48:4A27 and export $0C have no callers.

##### Bank 42: menu character sprite (animated golfer with shadow)

Exports: $00 42:400A and $02 42:4008 are `ret` stubs (called from 62/66 and 01:4118). $04 42:400B InitCharSprite and $06 42:4074 CharSpriteTask are used by 41, 48 and 66.

- 42:41F2 holds four records, one per character (`$C810` = 0-3). Each gives an OBJ palette (loaded as OBJ palette 6) and pointers to frame tiles, metasprites and animations; the pointers are copied to `$D540-$D547`.
- The animation state is `$D548` animation, `$D549` frame, `$D54A` frame timer, `$D54B` next animation (bit 7 = none), `$D54C/$D54D` position, `$D54E/$D54F` offset (the jump height), `$D550` delay and `$D551` tile upload pending.
- Each frame of an animation is 4 bytes: tile set, metasprite, dx and dy. Tiles are LZ-decompressed to VRAM1 `$8000`. Frame $FF ends the animation.
- The shadow sprite size depends on the height (42:41B1, table 42:4254; tiles 42:4200-4238).
- These WRAM6 addresses are also used heavily by bank 3C (`$D548`/`$D551`), so they are not labelled as RAM.

##### Bank 44: debug palette editor and hole records

Exports: $00 44:7E74 CopyHoleRecord (17:4298, 66:4982) and $02 44:42FB DebugPaletteEditor (05:6B83 in the debug menu 05:6B2E, and 08:4708 after a pause menu when `hDebugMode` is set and Up is held).

- **DebugPaletteEditor** loads hex digit tiles 44:4020 to `$8600` and draws a 16 x 4 grid of the colours in `$C100` (wPalLive: BG palettes 0-7, then OBJ).
  - The cursor is `$C3F6` (colour) and `$C3F7` (palette). A opens an R G B window (44:4156): Left/Right pick a component, Up/Down change it with AdjustColorRed/Green/Blue, and the palettes are uploaded at once (`$FF9D` = 3). B leaves.
  - This is development code that the retail game can still reach through the debug mode.
- **CopyHoleRecord** copies $C0 bytes for course `$C836` and hole `$C837` (table 44:4311: a pointer per course to a list of record pointers) to de; bank 17 passes `$C640`.
  - The records are about $88 bytes apart, so the copy reads past the end of each one.
  - A record holds a grid of 4-bit values (10-byte rows; nibbles 0/1/3/F), then a list of tile numbers ending with $FF. It is probably a picture of the hole or green for the bank-17 view. Not confirmed.
- The rest of the bank (44:43E8-7E73) is data, not traced.

All addresses come from `tools/disasm.py` and `tools/xref.py`. Names are in `labels_a6.csv` (275 lines: 228 routines/tables, 47 RAM).

##### Bank 02: save data, the player's character, golfer setup, link shots, points/EXP, debug screens

- **Save blocks** (next to SaveLoad 02:41F6): SaveBlockStore 02:429B (export 4: block b <- WRAM hl + 24-byte header de; sum + used flag; SaveCommit), SaveBlockClear 02:431D, SaveBlockVerify 02:43CC (0 / `$FE` empty / `$FD` differs / `$FF` bad sum), SaveBlockHeader 02:4454. SaveCheckAllBlocks 02:45D3 (export `$6A`, one of GameMain's three setup calls) checks blocks 0-2 (on a bad sum it restores from backup block b+8, 02:457F), block 3 (02:45AA) and blocks 4-7 (a bad block becomes `$280` zero bytes, 02:45B7).
- **SaveGame 02:4489** (export `$34`, about 50 calls from the story banks 30-35, plus 08 and 41): only when slot `$C2A5` < 3. It calls SaveGameTimer and BuildClubTable, then stores the character record `$C800` in block slot and again in slot+8 (header template 02:63A0), verifying each copy.
- **SRAM flag bits** at `$A038`: TestSaveFlag 02:44F2, SetSaveFlag 02:4522 (bank 08 calls it 7 times), ClearSaveFlag 02:4550 (unreferenced).
- **Character record `$C800`** (name first): type `$C810`, level `$C812` (max 99), flags `$C819`, driver distance `$C81A`, 24-bit EXP `$C826`, stat points at +`$20`/`$21`/`$22`/`$24`. Routines: NewGame 02:4E3D (export `$14`: clears `$C800-$C9FF`, CreateCharacter, map 0 entrance 2); CreateCharacter 02:4E82; CharLevelUp 02:4FFA/4FFD (raises one stat and the level); CharComputeStats 02:4F07 (per-type tables at 02:4D3D); CharLevelUpDiff 02:503C (the stat changes for the level-up screen); AddExp 02:5465, CheckLevelUp 02:546B and ExpToNextLevel 02:5498 (thresholds at 02:54CD by type); BuildClubTable 02:51F6 (13 clubs x 7 bytes -> `$C900`).
- **Golfer setup**: SetupPlayerGolfer 02:4A28 (export `$1E`, 141 call sites). It fills player record c from golfer b: `$80` = own character, `$81` = `$C600`, `$82` = link partner `$CB40` (sets +`$13` = 3), any other value = preset golfer from 02:4B1D. Player field +`$13` is the controller type (0 = human; AddPoints and 02:5BEC test it). Golfer lists for the select screens go to WRAM6 `$D000`, 32 bytes per entry (02:5985, 02:5A2D, 02:5B5B). Presets are gated by game flags or by save flags.
- **Shot records**: LoadShotRecord 02:463E and WriteShotRecord 02:46E3 move 13 bytes (ball, aim, club, mode, power or targets). Per-stroke copies sit at `$D680`; LoadStrokeRecord 02:4626 and BallToShotStart 02:4691 read them back.
- **Link play**: LinkSendShot 02:48B8, LinkSendShotResult 02:4924 and LinkReceiveShot 02:483A send a shot record through `$CB00`/`$CB40`. Control bytes: `$20`/`$21` = idle/aiming, `$2F` = end of block, `$2E` = abort, `$1x` = a button press. While aiming, a partner's button press plays a sound from 02:4802 (02:4812, 02:47ED).
- **Points**: ClearPoints 02:540A, AddPointsRaw 02:5415 (export `$54`; the body of AddPoints without the mode check), AddPointsSigned 02:544E (has a floor of 0). Per-course hole bitmaps at `$C996`, 25 bytes per course (02:5C50, 02:5C77, 02:5CA5).
- **Debug leftovers**:
  - DebugCharacterEditor 02:6176 is reached only from the unreachable debug boot menu (01:4128). D-pad = level up a stat, A/B = change type, Select = slot, Start = save.
  - DebugSaveViewer 02:5D2F (export `$68`, called from 35:776B) hangs with "NO FILE" or "CHECK SUM ERROR", otherwise shows 10 pages of block 3.
  - An EXP test loop at 02:611D (A = +10, B = +100, then automatic level-ups) has no caller.

##### Bank 12: golf HUD and on-course sprites

- HudInit 12:442C (export 0, from 10:4214) draws every HUD part and registers the HUD task 12:449F. The task is gated by `$D358`; `wHudPanelsHidden` `$D455`; `wHudBlink` `$D454` blinks the current player's panel.
- HUD parts (all render to WRAM then queue to VRAM1): lie icon 12:45F4 (by HudLieIndex 12:4239), club icon 12:465C, shot panel 12:46A6 (shot type by wShotMode, club name, club base distance), hole/yards/par 12:4A0A (`$C837`, `$D323`, `$D325`), wind 12:4A81 (`$C815` speed, `$C816` angle), player faces and strokes 12:4B8A / 12:4C18 (player records +`$10` / +`$19` / +`$20`), pin distance 12:4CB1.
- UpdateWindIndicator 12:50A0 animates the objects at `$CAB0`.
- Target-marker blink and edge arrows: 12:502C (uses `$D36B` from 40:640E).
- StrongWindIntro 12:6F8D runs at hole start when wind is `$0C` or more.
- FreeLookCursor 12:6D3D (export `$42`, from 41:7879) moves cursor `$D422`/`$D424` with acceleration `$D486` and switches to the green view when the cursor enters the green. **Debug:** with hDebugMode set, A teleports the ball to the cursor; with hDebugMode >= 2, 12:6F16 prints the cell's terrain and slope in hex.
- Countdown control for UpdateGameTimer (`$C0F4`: 1 = run, 2 = pause, `$FF` = expired): CountdownStart 12:4F52 and CountdownPause 12:4F73, both called from bank 34. Resume 12:4F67 and stop 12:4F7F are unreferenced.
- Cell lookups at map positions: TerrainAtPos 12:40FD, GreenSlopeDirAt 12:4098 (the slope direction is remapped by the tile flips through 12:40DD).
- Unreferenced: HudDrawClubLieNumbers 12:4622, and a lone `ret` at 12:4DE8.

##### Bank 04: map actors (people sprites) and map scrolling

- There are 24 actors of `$40` bytes in WRAM4 `$D000`. Fields: +0 script/bank, +4/+6 x/y, +`$16`/`$17`/`$1E` state, +`$18` leader, +`$20`/`$22` character tables, +`$24`/`$26` animation, +`$2B` bank, +`$2C` slot, +`$2D` palette, +`$30` character, +`$31` animation, +`$38` VRAM tiles.
- Init and spawning: ActorsInit 04:410D; ActorAlloc 04:4139 (**bug/leftover:** computes a random 8-15 value, then overwrites it with `$0800`); ActorSpawn 04:4FFB (12-byte spawn records gated by a game flag, 04:4FBE); SpawnActorList 04:5084; SpawnPlayerActor 04:510A; SpawnPartnerActor 04:51D0 (partner chosen by flags #144-147, follows the player via ActorStartFollow 04:4525).
- Character and animation: ActorSetCharacter 04:4D42 (headers at 04:4F1C), ActorSetAnim 04:4E51.
- Proximity and lists: FindActorNear 04:55C4 (talk target), BuildActiveActorList 04:56FD -> `$CAC0`.
- MapScrollTask 04:4072 (export `$3C`, also run as a frame task) blits BG rows and columns as the view tile changes; SCX/SCY include the shake offset `$C368`/`$C369`.
- Golf uses actor 0 as the golfer's map sprite: 04:57BA, 04:57A1, 04:5808.

##### Bank 15: the behind-the-golfer picture (objects and flag)

- BuildBehindView 15:46AB (export 0, from 13:43AE) runs these steps:
  1. BehindViewSetup 15:4570: viewpoint `$280` units behind the ball along wLaunchDir.
  2. Ground (bank 16).
  3. ProjectViewObjects 15:47BD: objects from the WRAM4 `$DC00` list inside the view cone, at most `$55` of them; sound `$23` when the list is full.
  4. Screen columns and rows (15:498F, tables 15:48E7 / 15:490F).
  5. Column and depth sort (15:49F7, 15:4AC7).
  6. Flag sprite (15:4DC1, hidden when occluded).
  7. Scenery by course: jump table 15:463F by `$C836` -> export 0 of banks 4B/4C/4D/4E/4F/4A; course 7 chooses by hole.
  8. Copy to VRAM.
- **Debug leftover:** ProjectFlag 15:4B18 prints the flag's distance and angle with PrintDecimalWord on every build.
- TerrainAtCell 15:4F9A works like TerrainAt but in quarter-tile units.

##### Bank 16: behind-view ground renderer

- RenderBehindViewGround 16:4058 (export 2; also called from bank 7D) draws 20 rows (`$C47E`) into WRAM tiles `$CF80-$D9FF`.
- Per row: SampleViewRow 16:7B01 takes 64 terrain samples along a perspective row (row offsets at 16:7AD9, origin `$C3A4`/`$C3A6`; an unrolled sampler at 16:7A65 that uses stack tricks under `di`). Then: class translation through `$C400` (table 16:4010, loaded by export 0); SmoothGroundRow 16:5967; DominantGroundClass 16:432A for 8 column groups; pattern words written by DrawGroundColumn 16:435F (tables 16:3D67 / 16:3F67 / 16:4567, or 16:4767 on course 3).

##### Bank 11: golf camera, ball/golfer sprites

- Camera: CameraComputeGoal 11:413C (mode `$D438`: scroll / ball / marker / look cursor / cup, clamped to wMapBounds), CameraStep 11:422F (step size by distance, writes the scroll position `$C320`/`$C322`), CameraAtGoal 11:41F7, WaitCameraAtGoal 11:4224.
- InitBallCamera 11:476E is the view-4 camera.
- PreviewMarkerView4 11:48AB projects the preview ghost spot.
- LoadPictureTiles 11:4EAB is an LZ list at 11:4F02 decompressed into VRAM1 (called from 0B and 32).
- LoadGolferSpriteTiles 11:6E1E and LoadGolferFrameTiles 11:6E08 load from the per-golfer list 11:6EEF; wGolferId is `$D332`.
- **Leftover:** CpuPlanShot 11:4046 (SmartAim + club + power) has no caller.

##### Bank 40: full-screen pictures, target-marker placement, LZ UI tiles

- LoadFullScreenPicture 40:5BF9 takes a (idx, bank) list: palettes, tiles, attributes, map.
- ShowPictureTimed 40:6666 (export 1, pictures in banks 7B and 49) and ShowPictureUntilButton 40:66B5 (export 2, waits up to 60 s or a button). Callers: the debug boot menu (01:4131-4155, unreachable) and story banks 31, 33, 65, 77.
- PlaceTargetMarker 40:640E (export 3, from 10:5A2B / 10:5D10) places the marker at ball + club base distance along the aim (AimOffset 40:62BC). The offset is scaled down so the marker stays inside the map, or inside the green view's 5x4 tiles; edge bits go to `$D36B`.
- The LZ UI tiles at 40:66F6 were already known.

##### Bank 4F: one course's behind-view scenery, and captions

- ComposeObjectPicture 4F:5645 (export 0, through 15:463F) blits the sorted object list `$DA00` into the WRAM tile sheet. Type-1 shapes come from 4F:6049 / 4F:57FB (colours 0 and 3 opaque, BlitRowOpaque03 4F:615C); type 2/3 shapes from 4F:5712 and 4F:611C (colour 0 transparent, 4F:6169). An extra shape is drawn when the ball's terrain `$C3B7` = `$0C`. Then LZ 4F:5410 and palettes 4F:5615.
- **Captions** (bank 3B): StartCaptionAnim 4F:619C (sound `$4A`, sprite object `$CAA0`, scripts 4F:632B / 4F:6569; the OBJ palette comes from 4F:63A9 and is varied by `$C836` and hole number via 4F:627B / 4F:6294), WaitCaptionAnimEnd 4F:618B, StopCaptionAnim 4F:6184.

##### Bank 77: story pictures

- LoadStoryPicture 77:6E3E (export 6, from 32:4AB5 and 3B:7737): c = picture (< `$0B`), b = variant (via 77:6F86).
  - Tiles: LZ list 77:7346 into WRAM1, then six `$200`-byte HDMA copies to `$9200-$97FF` and `$8800-$8DFF`.
  - Map: 77:7376 / 77:752E.
  - Animation: script 77:76E6 (`$D347`), tasks 77:7033 and 77:6F8E.
  - Then farcall 4A:6205, which acts only for variant 0.

##### RAM introduced (see CSV)

- Camera: `$D42E`, `$D432`, `$D438`.
- Behind view: `$C3A0-$C3B9`, `$C47C-$C487`, `$C836` (course?).
- HUD: `$D322-$D328`, `$D454`, `$D455`, `$D36C`, `$D422`, `$D486`.
- Wind: `$C815`, `$C816`.
- Countdown: `$C0F4`.
- Character record: `$C810-$C826`, `$C900`, `$C996`.
- Save: `$C2A5`, `$A038`.
- Game mode: `$C834`.
- Actors: `$C296`, `$CAC0`, `$C324`, `$C368`.
- Story pictures: `$D347-$D34C`.
- Effect objects: `$CA80`.
- Caption object: `$CAA0`.

##### Bank 05: window manager, menus, message boxes, text printer, debug menu

Role: the whole UI layer that the overworld/RPG, golf and cutscene code calls (61 exports at `$4000`; ~560 far
calls). It owns WRAM5 `$D000-$DFFF` and draws windows over the overworld map into a WRAM5 BG shadow that is
queued to VRAM through 00:0468.

**BG shadow** (WRAM5): `D000-D3FF` tile map 32x32, `D400-D7FF` attributes (same addresses as WRAM6 wBallX etc.,
so no RAM label). ShadowTileAddr 05:414F; copies to VRAM: QueueShadowRows 05:4262 (tiles to `$9800`, attrs to
`$B800` = VRAM1 `$9800`; 00:0468 treats `$A000+` as VRAM bank 1), CopyShadowRowsFramed 05:42AD (7 rows per frame),
CopyShadowToVRAMFramed 05:64D1. The map under windows comes back from the 64x64 overworld map (WRAM3 tiles,
WRAM2 attrs, see Graphics): CopyMapRowToShadow 05:450B (column `$C321`, row from `$C323`), RestoreShadowFromMap
05:4492 (20 rows, 5 per frame; the standard "redraw" call, always followed by UpdateWindows).

**Windows.** 6 slots at `$D800` (4 bytes: record pointer, priority<<5 | text-id high, text-id low). The pointer's
high nibble doubles as a command: `$D` = live, `$C` = close request (CloseWindow 05:4C5C). Records live in 7
buffers of `$11D` bytes at `$D900` (bitmask `$D823`): flags, x, y, w, h, then (tile, attr) pairs. Frame tiles are
`$02-$09`; text windows (BuildTextWindowRecord 05:4773) number their interior tiles from `$80` on every other row,
so each window has its own run of glyph tiles. API: OpenWindow 05:4AF2 (export 04; d,e = screen tile pos
relative to the scroll, b,c = size; returns the slot), OpenWindowWithAttr 05:4AD2, OpenMessageWindow 05:4B20,
OpenMenuWindow 05:4BB0, SetWindowText 05:5A51, SetWindowTile/GetWindowTile 05:4408/444F, SetWindowPriority
05:4C75, CloseWindow 05:4C5C, RemoveWindow 05:67BB. UpdateWindows 05:4949 (export 14) walks priorities 1-8:
erases windows marked for closing (FreeWindowSlot 05:48CE) and draws the rest (DrawWindowToShadow 05:4831,
CopyWindowRowsFramed 05:4384), printing each slot's text id. Callers do `RestoreShadowFromMap ; UpdateWindows`
after every change.

**Menus.** OpenMenuWindow sizes a window from a text whose options are separated by `$01` and pushes it on a
6-deep menu stack (`$D832`, depth `$D83E`). RunMenu 05:4CD7 (export 4E) moves the cursor (frame task
MenuCursorTask 05:4F20 blinks tile `$0D`), sounds `$5B` move / `$5C` select / `$5D` cancel, returns the row, `$FF`
for B (or Start when `$C3FC` bit 7), `$FE`/`$FD` for Left/Right in paged menus (RunPagedMenu 05:5197).
RunYesNoMenu 05:45F6 uses text `$001A` "Yes/No".

**Message boxes.** ShowMessage 05:5D49 (export 46): hl = text id, a = speaker actor; OpenMessageBoxNearSpeaker
05:5F62 puts a 20x7 box at the bottom or top depending on the speaker's y (actor records `$D000 + n*$40` in WRAM4,
GetActorPtr 05:6472) and grows it to the measured text size in 8 steps; pages loop on wTextPagePending `$D850`.
Variants: ShowMessageKeepOpen 05:5DE5, ShowMessageAt 05:5E70 (centred on d,e; bank 30 cutscenes), ShowMessageInPlace
05:67C5. Text size: MeasureTextBox 05:5C3B / SizeMessageBox 05:5B3B walk the string with per-code measure helpers
(05:55CB, 5634, 5679, 56E2, 579E, 57FD, 5857) and FontWidths. Typing: TextCharDelay 05:5CC2 plays a voice blip
(sound `$69 + voice*4 + (char & 3)`; voice from SpeakerVoiceTable 05:66C0 by the actor's `+$30` byte) and waits
`$D829` frames, set from the text speed option `$C82D` by SetTextDelayFromOption 05:5D1F (0 / 2 / 4 frames).

**Text arguments.** PushTextStringArg 05:54CF (export 54, list `$DFAE`), PushTextNumberArg 05:551F (export 56,
`$DFCE`), PushTextByteArg 05:5552 (export 58, `$DFEE`), 16 each, consumed by codes `$04`/`$09`/`$08`; SetTextCourseIndex
05:57C3 (export 5A) sets the `$0B` argument `$D85D`. All control-code handlers are now labelled (TextCmd*, 05:52EF-5921).
NormalizeTextId 05:622F adds an index offset to a text id and carries into the next text bank using TextBankSizeTable
05:629A (512 216 252 285 264 497 768 169 = the per-bank string counts in "Text").

**Text to arbitrary tile maps.** PrintTextToBuffer 05:62AA (export 22) renders a text into glyph tiles and writes
their numbers into any tile buffer (stride c); PrintTextToShadow 05:648E, the window-buffer helpers 05:652F-65F1,
DrawStringToWindow 05:65FF (characters as tile numbers straight into a window record).

**Debug menu** (05:6B2E, export 60; only the debug boot path reaches it): text `$0084` "Scene / Map / Palette /
Flag". Scene = DebugWarpMenu 05:6C25 (pick a MapTable record by index with its name, text `$012C + n`, and an
entrance 0-15; A sets wMapId / wMapEntrance and `$C441 = $FA`); Map = farcall 0B:4579; Palette = farcall 44:42FB;
Flag = DebugFlagEditor 05:6A57 (4 pages of 64 game flags `$C840`; A toggles, Start next page, tiles `$65`/`$40`).

**Native** (windows.js, pause.js): the slots and records (AllocWindowSlot, BuildTextWindowRecord, DrawWindowToShadow,
FreeWindowSlot), UpdateWindows, CopyWindowRowsFramed, MeasureTextBox, OpenMenuWindow, RunMenu 05:4CD7 and
MenuCursorTask, and the golf pause menu (08:4666, GolfPauseMenuSave 41:6E96 / Save2 41:6EBB, RunMenu 41:6FF4,
QueueFontTiles 01:422C): B / Start close it, Scorecard shows 0E:43D6 and returns `$FF`, which makes ShotSetup load
the hole's info and start the scene again (10:489D) before aiming on. Camera Mode, Course Map, Settings, Give Up
and Save & Quit are not ported. Quirks: FreeWindowSlot frees the buffer whose number is the slot's (a slot whose
number is not a used buffer stays); CloseWindow indexes 16-bit (CloseMessageWindow without a message window marks
$DBFD); RunMenu tests the paged flag of slot 0's record (a is 0 there), not the menu's.

**Leftovers / oddities.**
- No callers (dead code): ClearBGShadow 05:40E6, DebugHDMAShadowToVRAM 05:4102 (HDMA while A is held),
  ReadShadowTile 05:413E, CopyShadowRowToVRAM 05:4221, CopyMapEdgeRows 05:44B7, BuildPlainWindowRecord 05:4717,
  EraseWindowFromShadow 05:486F, PrintHex/Dec*Inline 05:59D1-59FC, GetWindowText 05:5A75, SetWindowPriorityAlt
  05:5B0F, ContinueMessageAt 05:5F02 (takes the voice actor from e - 9), ResizeMessageBox 05:60C3,
  PrintNumberInWindowBufferNow 05:65CC, DrawNumberToWindow 05:6658.
- CloseMessageBoxAnimated 05:60FF jumps over its own shrink animation (05:6108-614C unreachable).
- SizeMessageBox calls PrintHexByte (00:22A5) with the box width at `de = $0A0C` (05:5BF3): a debug print left in.
- CopyWindowRowsFramed 05:43F4 is `jr $` (hang) if a wrapped window part is 8+ rows.
- OpenMessageBoxCentered 05:682D is a byte copy of OpenMessageBoxAt 05:605F.
- `$DE`/`$DF` (dakuten) handling everywhere: Japanese-version residue.

**RAM** (all WRAM5 unless noted): window slots `D800-D817`; `D820` last opened, `D821` current, `D822` count,
`D823` buffer mask, `D824` message window, `D825-D828` its x y w h, `D829` char delay, `D82A/D82B` pen line start,
`D82F-D831` menu window / cursor / rows, `D832-D83E` menu stack, `D841-D845` cursor blink and addresses, `D846`
menu page, `D847-D84C` argument indices / counts, `D84D` window tile attribute, `D84E` resume pointer, `D850` page
pending, `D851` speaker, `D854` box width, `D85D` course index, `D860` window buffer index, `D862` voice, `D863`
prompt window, `D864` PrintTextToBuffer pointer, `D866-D868` measure indices, `D869` read pointer, `D880` short
text, `D900` buffers, `DFAE/DFCE/DFEE` argument lists. WRAM0: `C360-C362`, menu options `C3F9/C3FA/C3FC`,
`C780` string scratch, `C7E0` map row buffer, `C82D` text speed, debug `C470-C474` and `C484-C489`.

##### Bank 03: proportional-font glyph renderer

Role: draws text pixel by pixel. Glyphs from Font 03:50F0 (2bpp, 16 bytes) are OR-ed into a glyph buffer of
`$80` tiles in WRAM7 `$D000` at a bit-precise pen (`$C36A`, bits 0-2 = pixel, /128 = tile) by DrawGlyph 03:4B45 /
BlitGlyphByte 03:4B9D, advancing by FontWidths 03:5750 (GetCharWidth 03:4B89). The tiles are uploaded to
`$8800-$8CFF` (tile ids `$80+`, VRAM1 when the window attribute has bit 3): all at once (UploadGlyphBuffer 03:4C60,
UploadGlyphTiles 03:4F6C: per-frame when the LCD is on, direct when off), per character for typed messages
(UploadCurrentCharTiles 03:4DF0, only when `$C82D` is not instant), or as a range (UploadGlyphRange 03:5087).
Pen/block state: `$C36A` pen, `$C36C` line length, `$C36D` next line tile, `$C36E` next free tile, `$C36F` block
start, `$C370/$C371` upload count / start, `$C372` VRAM bank. Bank 05 drives it: InitTextPen 03:4D41 at the start
of PrintText, DrawNextChar 03:4D93 per character, FinishTextBlock 03:4F7D at the end; DrawCharFromHL 03:4E6A /
WriteGlyphTileNumbers 03:4F21 / CommitGlyphBlock 03:4F58 for PrintTextToBuffer. ResetGlyphBuffer 03:4EB8 (16 far
callers in many banks) and DrawStringToGlyphs 03:50CD (export 26) are the entries used outside bank 05.

Notable: ResetGlyphBufferDup 03:4EDC is the same code as 03:4EB8; RenderStringToGlyphs 03:4CF1 (export 08) has
no callers; 03:4028-40AA is an unreferenced full-screen picture routine (LZ tiles 03:40AB, map 03:4950, attrs
03:4A9E, palettes 03:4B05, song `$06`, waits for a button; it first resets the serial link) not in the export
table: probably an old link/error screen.

##### Bank 3C: computer golfer AI, rival-score simulation, debug wind sweep

Exports (`$4000` table): `$00` 3C:426A CpuPlanShotMain (far-called from 10:5978 only), `$02` 3C:6686
SimulateRivalScores (from 0E:78DC only), `$04` 3C:6A23 DebugWindCarryTest (no caller).

**Shot planner.** 10:5978 farcalls 3C:426A and stores what it returns: a -> wClub, d -> wShotMode/$D32B,
bc -> wLaunchDir, l -> wSwingTargetImpact, h -> wSwingTargetPower, e -> $D4DA (copied to the swing pad byte $D44D
by SwingMeterCPU 10:567E). CpuPlanShotMain first computes the per-hole stroke bias (CpuHoleStrokeBias 3C:50D3 ->
`$D549`), then branches on the lie and distance: green lie ($D4CD = 6 or $0A) -> CpuPlanPutt 3C:5DCD; PinDist
(10:62AD) >= `$780` -> CpuPlanLongShot 3C:5751; otherwise CpuPlanApproach 3C:59DC. Power and impact are rounded
down to even values on return.

- "Schedule": par ($D325) + bias ($D549) - 2 is the stroke on which the golfer means to reach the green;
  compared with strokes so far + 1 (PlayerField $20). Ahead of schedule the AI adds deliberate errors: a random
  target offset (approach / putt), random power (CpuPowerJitter 3C:6213) and impact (CpuImpactError 3C:62CA).
  Behind schedule it aims exactly.
- Long shot (3C:5751): club = CpuPickTeeClub (3C:525C: driver / woods by par, strokes, golfer bits) and
  CpuGoForGreenClub (3C:5307), or the driver at +10% when CpuDecidePowerShot (3C:6530) says to use a power shot;
  target = CpuChooseTarget (3C:4693): the cup when in reach, else a waypoint of the hole's route (3D:431A) or a
  searched landing spot (CpuFindLandingSpot 3C:48D5 / CpuFindFairwaySpot 3C:4A51); power from distance
  (CpuPowerForDistance 3C:5021); spin pad (CpuChooseSpin 3C:63F8); wind (CpuWindAimCorrection 3C:555D,
  CpuWindAdjustClubPower 3C:56CA); then the landing preview is run (CpuPreviewHitsTree 3C:4F97: PreviewRestart /
  PreviewStep / PreviewTreeCheck from banks 10 and 08) and on a tree or hazard it searches 48 aim offsets
  (CpuFindClearAim 3C:4C54) and longer clubs. After a shot outcome 7 (PlayerField $14) it plays club $0B to a
  fairway spot (3C:59C4).
- Approach (3C:59DC): club from CpuChooseApproachClub (3C:5CE4): bunker -> $0C, clear fairway path to the green
  (CpuScanPathToCup 3C:5C22) -> putter or a club by distance (3C:5D60), else $0B; shot mode 0-3 and power from
  the distance in 3C:5AB0-5B78.
- Putt (3C:5DCD): putter, power from distance, then CpuReadPutt (3C:5F1C) walks the line reading green slopes.
- Many bank 10 routines are duplicated here byte for byte: CpuBallLieTerrain 3C:4006 (= 10:648B), CpuGreenSlopeAt
  3C:404C (= 10:64D1), CpuTerrainAt 3C:40B1 (= 10:6536), CpuLieFactor 3C:416A (= 10:65EF), CpuLieClass 3C:41ED
  (= 10:6672), CpuPlayerField 3C:4256 (= 10:4B14), with their tables (3C:4091, 3C:4189, 3C:4246).
- Golfer AI records: GolferAiRecord 3C:4360 maps the golfer id (PlayerField $10, < $10) through 3C:4324 to an
  8-byte record at 3C:42A4: byte 0 four 2-bit traits (3C:4381/438A/4397/43A8), byte 1 power-shot chance bits 0-1
  and wind limit bits 2-4, byte 2 signed stroke bias, bytes 3-7 a per-course bonus indexed by wCourse $C836 1-5.
- Per-hole routes in bank 3D (below); hole-specific exceptions: wHoleId $41 (3C:4A0F) and $17/$3A/$46 (3C:4A2F);
  CpuPlanLongShot also special-cases wHoleId $17 (3C:5842).

**Rival scores** (export `$02`, called from 0E:78DC with hl = a WRAM6 buffer at $D800): seeds an LCG (RivalRandom
3C:6598, state `$D596`) from `$C9FE` (random word stored at round start by 10:4B8C), gives each of 27 rivals
(table 3C:65E4: skill / profile row) a score through the current hole: base = skill + course offset
(3C:67DD by wCourse) + random spread, scaled by holes/18 plus a per-hole profile (3C:6650), then sorts them
(RankRivals 3C:6821, SortScoresWithIndex 3C:6921) and keeps rivals 0-25 behind rival 26 (3C:69D7); on hole 18
rival $1A is clamped against the player's total (PlayerField $3E). This is the tournament leaderboard filler.

**Debug leftover**: export `$04` DebugWindCarryTest (3C:6A23) has no caller. It prints the build stamp at 00:0153,
enables SRAM bank 1, and DebugWindCarrySweep (3C:6A55) sets hDebugMode = 3, then for every club 0-$0C, 16 wind
angles and wind speeds 1-9 fires a perfect full-power shot straight up the screen (DebugTestShot 3C:6BCA:
ShotLaunch + BallTask until RestWatch) and logs the angle and distance minus the club's base distance to SRAM
through the pointer at $BFF0 (DebugLogShot 3C:6B59); then prints "COMPLETE" (3C:6A4C) and hangs. It looks like the
tool used to build the wind tables 3C:535D / 3C:545D.

**Bugs**
- 3C:601B in CpuReadPutt: `ld a, [$000C]` reads ROM (`$FF`), so `and 1` is always nonzero and the per-step
  sideways accumulation at 3C:6022-6043 never runs; the toggle at `$D55E` (3C:608D) was probably meant.
- 3C:59FB and 3C:5DFD: `ld a, $10 ; call CpuPlayerField ; cp $07` lacks the `ld a, [hl]` (compare 3C:5751),
  so the "golfer 7" test compares the address low byte and never matches.
- 3C:50DD-50E3: `$D526` = PlayerField $3E (when wGameMode != 2) is overwritten by 0 at 3C:50E6 (dead store).

**RAM (WRAM6)**: `$D525-$D536` scratch, `$D545/$D547` target, `$D549` stroke bias, `$D54A-$D551` shot plan
(club, aim, pad, mode, impact, power), `$D552-$D55E` putt-reading / ranking work, `$D554`/`$D572` rival
score and index arrays, `$D592` first green point on the line, `$D596` rival LCG, `$D598-$D59C` aim / $D41C / club
saved around the preview, `$D608` tee club.

##### Bank 3E: between-holes standings screens (match play and two-player)

Exports: `$00` 3E:403F MatchStandingsScreen and `$02` 3E:6361 TwoPlayerScoreScreen, both reached through the
screen picker 0E:43D6 (table 0E:4422 by wGameMode $C834; 6361 also from map script 35:775F); `$04` 3E:675C is a
2-instruction trampoline to 0E:43D6 (called from 08:4B6C, 41:789C, 41:78BD).

- Screen build: LoadStandingsGfx 3E:4102 (LZ tiles 3E:4E90 / 3E:5D50, palettes, tile maps to WRAM1 `$D000`
  attributes / `$D400` tiles, 32 wide; StandingsMapAddr 3E:61B7), tile writers 3E:61E3/6209/622A/6250, tile
  strings (x, y, tiles, 0) at 3E:4006-403E drawn by DrawTileStringAt 3E:6293. Faces: LoadPlayer1Portrait /
  LoadPlayer2Portrait (3E:45B0 / 3E:4605, character $C890 / $C8D0, tiles 3E:4990 + id x 64). Player names
  DrawPlayerName 3E:60CA.
- Match play: MatchTallyHoles 3E:4164 counts wMatchHoles ($C96E, 1 = P1 won, 2 = P2 won) for the holes played
  into $D555/$D556 (holes won), $D559/$D55A (2 points per win, 1 per other hole) and flags ($D525-$D52A) at
  3E:425B; playoff variant 3E:4377 uses `$C96C` when $C83A is set. Draws status (3E:4450), hole marks (3E:4505),
  hole number (3E:43F7), banner (3E:489E, `$D61D`).
- Two-player: score vs par of each player (PlayerField $3E: $C8BE / $C8FE) by DrawScoreVsPar 3E:6525, winner /
  loser faces LoadResultFaces 3E:665B.
- **Bug**: WaitKeyNoTimeout 3E:6098 loads bc = 300 but never decrements it, so the screen waits for A/B/Right
  forever (returns 0 for A/B, 1 for Right).
- 3E:6637 (Compare16) and 3E:6342 (score sign-extend, `$91` and up negative) are copies of 3C:4404 / 3C:6A04
  (also at 48:497E / 48:4A08).

##### Bank 36: LZ graphics (no code)

The four `$4000` entries are data, not code: 36:4008 and 36:5D0D each list 5 LZ streams of 1024-1792 bytes
(tile blocks; 36:4020 renders as large character artwork), 36:547B and 36:71D6 hold 16-byte rows of 4 pointers to
160-byte LZ streams (20 x 8 maps?). All decompress cleanly with LZDecompress's format and end at the next pointer.
Bank 37 has the same layout (4008, 5411, 5D06, 7151). No loader was found (no far call or `ld a, $36` bank
switch refers to them); the end of the bank is `$FF`.

##### Bank 3D: hole routes for the computer golfers

Export `$00` HoleRouteWaypoint 3D:431A (called 3x from CpuChooseTarget 3C:4693): c = waypoint index, b = golfer
id; golfers 4-11 have their own route (b - 3), others use route 0; table 3D:4252 by wHoleId -> 9 route pointers ->
4-byte waypoints (x, y in units of 32). Index >= 3 returns `$FFE0` (none; a stored `$FFFF` waypoint shifts to the same value). The rest of the
bank holds more copies of bank 10 code (twins of GreenSlopeAt at 3D:4048, LieClass at 3D:41E9) not reached by
coverage.

Method: export tables, callers (`xref.py`), code reading, and screenshots taken by jumping into each export
from `states/stroke_hole1.state` (PyBoy, scratch script; the HUD of the round shows through the edges).

##### Bank 0C: records screens (clubhouse records and profile stats)

Ten exports. Bank 0B's records menu (0B:4E5D, choice from 07:51A6) calls 0 -> `$0C`, 1 -> `$0A`, 2 -> `$04`,
3 -> `$02`, 4 -> `$00`; the profile menu (0B:4ECA, choice from 07:63EC) calls `$0C` with `$D23B` = 1 and `$06`.
Bank 35 (35:7777-778F) also calls `$00`, `$0C`, `$02`. Every screen has the same shape: init (LCD off, frame
graphics from banks 4B/4C/4D, palettes 0C:419B + 0C:5C00), register frame tasks, fade in, input loop until
B returns `$FF`, unregister, fade out.

| Export | Routine | Screen (screenshot title) | Data |
|--------|---------|---------------------------|------|
| `$00` | 0C:4014 StarsScreen | "Stars": 6 stars per course, total, "Remaining" = 36 - total | save block 3 `$DC00+$15F` (0B:5009) |
| `$02` | 0C:5AEC RankingScreen | per course: rank 1-3, time h:m:s, score | record entries (0B:522D) |
| `$04` | 0C:5FC5 WinnersScreen | "Winners": 18 x 14 grid, who beat whom; scrolls 2 ways | `$DC00+$166` (0B:5133) |
| `$06` | 0C:65B2 VsResultScreen | "Vs. Result": profile character vs 7 rivals | flags #80-#93, #117 |
| `$08` | 0C:67F8 ShotRecordsScreen | Birdie / Eagle / Albatross / Hole-in-One, 5 faces each | save blocks 4-7 (0B:5260) |
| `$0A` | 0C:6EE0 BestScoreScreen | "Characters' Best Score" per course, sorted | 0B:51B9 |
| `$0C` | 0C:4A15 StatsScreen | "Tournament Total" / per-course stats pages | `$DC00` records or `$C980` profile |
| `$0E` | 0C:43AD InitRecordsTileAnim | animated tiles at `$8FC0/$8FE0` | called from 0A:6F38, 0A:72D5 |
| `$10` | 0C:7380 | points into data (`f5 00 ff`), no callers | dead export |
| `$12` | 0C:5772 CopyTextIdToBuffer | LoadText + copy 20 chars to de | no callers |

Details:
- **Stats** (4A15): `$D23B` = 0 shows the save records: `$32`-byte records at `$DC00 + 50 n` (0B:4FE5), 6 courses
  + total (record 6). Fields read by DrawRecordStatsPage 0C:4D08: `+0` rounds (word), `+2` best score (54 =
  even, shown as +/-), `+3` average, `+4` best drive, `+6` average drive, `+8` fairway %, `+9` putts (x10, drawn
  with a decimal point), `+A/+B/+C` par saves / par ons / sand saves %, `+D` bits 2-0 = three medal icons, `+2F`
  18-bit birdie badge mask (0B:5303). `$D23B` = 1 (profile menu) computes the same lines from the profile's
  per-course records at `$C980 + 25 n` (GetProfileCourseRecord 0C:5ACC): averages are word / byte ratios selected
  by `$D23C/$D23D`; the total page sums over courses with rounds (0C:5820-5A31). Hole mask at `+$16` (bits 0-17
  badges, 21-23 medals; also read by 02:5C77).
- **Winners** (5FC5): 6240 hides the headers of locked characters: columns 4-9 and `$0C` with no result at all,
  `$0A` under 50 birdie badges, `$0D` under 108 (all 6 x 18), `$0B` under 30 stars, rows `$0E-$11` with no result.
  These look like the unlock conditions of the hidden characters.
- **Shot records** (67F8): cursor over a 5 x 4 grid (`$D214`, kept in `$CA7F`); A returns `$FE` and the caller
  (0B:4E02) then farcalls 10:435E, which presumably replays the recorded shot (02:4714 RecordShot writes these
  records). The cursor palette cycles (6B55, table 0C:6BF6).
- **Best score** (6EE0): `$D227` list of characters 0-17 with a score on the course, sorted (70FC), faces at
  0C:726F slots.
- WRAM6 work RAM of the bank: `$D214` page / cursor, `$D215` sub-page / scroll, `$D218-$D222` cursor palette and
  colour phases, `$D223` stars course, `$D224` record pointer, `$D226` page count (0B:506E / 0B:50B6), `$D227` list
  (20 bytes), `$D23B-$D23D` stats source and field offsets, `$D23E/$D240` animated tile targets, `$D244` carry byte
  of the 24-bit sums. Tilemaps are built in WRAM1 (`$D000/$D400`, attributes at `+$400` or in WRAM2/3) and queued to
  VRAM with 00:0468; destinations `$A000-$BFFF` in that queue mean VRAM bank 1 (`$B800` = attribute map `$9800`).
- Leftovers: LoadCourseBanner 0C:49C1 (and its unreferenced copy 0C:6E80) prints the course index with
  PrintHexByte at `$0D02` (debug overlay). Unreferenced: 0C:55B7, 0C:5725, 0C:57E7, 0C:6E80; 0C:6783 is an empty
  stub that is called; three copies of a fill loop (576D, 6794, 6E7B).

##### Bank 0F: course select and hole select

Exports: `$00` 0F:4AB7 CourseSelect, `$02` 0F:4AD6 CourseHoleSelect, `$04` 0F:4B7A BuildCourseList. Real
callers are in bank 32 (32:5202/5262/52A6/535B call `$00`; 32:52D2 calls `$02` with hl = `$0101`); the refs from
11:5235 and 7D:6F76 are byte patterns inside data.

- Screen (screenshot): "Course" title, a film strip of course pictures that scrolls sideways, a name box
  ("1. Marion Club", "2. Palm Club"), arrows; then for `$02` a "1H"-style hole number chosen with the d-pad.
- BuildCourseList 0F:4B7A writes count + ids 1-6 to `$D658`, depending on `$C834` (mode), `$C33F`, `hFFCF` and the
  course unlock flags #112, #113, #114, #139, #159 (or 02:44F2 checks in mode `$C2A5 & $0F = $0F`).
- CourseSelectInit 0F:400B takes hl = id list, bc = descriptor table (0F:4C78), e = start, d = count; keeps them in
  `$D207/$D200`, `hFFB0/hFFB2`. The descriptor table starts with two hook words (0F:4CD4 draw name box with texts
  `$21+id` and `$28+id`, 0F:4D33 clear it), then 12-byte course entries read by GetCourseField 0F:4613.
- Scrolling: the strip is a 32-wide map at `$C600/$C700` shifted one column per step (426B/4285), new picture
  columns are uploaded to a rotating tile slot `hFFB4` (`$10-$A8`, step 8) from `hFFB6`; 12 steps per course.
- Hole select 0F:77B3: hole 1-18 wraps both ways, digits from 0F:78EA (BCD) and 0F:7934 graphics; B sets `$D209` = 1
  and returns `$FF` so CourseHoleSelect goes back to the course choice.

##### Bank 0E: scorecard and tournament standings

Most of the bank is not traced (601 code bytes found so far); the exports:
- `$00` 0E:43D6 ShowScorecard (callers 08:4B5D, 08:4BA0, 31:4938, 3E:675C, 3E:676F, 41:788F): picks a pair of page
  routines from 0E:4422 by `$C834` (1, 2, else `$C8D0` = `$FF` or not) and calls one; a page returning 1 switches
  to the other (Right / Left). Screenshot: the "SCORECARD" with HOLE / PAR / face / PUTT / OVER columns.
- `$06` 0E:78B4 BuildStandings (08:4775, 08:4B43, 08:4C06): leaderboard of 28 golfers in WRAM6 `$D800`, 4-byte
  entries `[score, tiebreak, id, rank]` ending with `$96`. The player is entry id 0, score = SumScoreToPar
  0E:6EDB over `$C4BE` holes of `$C8AC`; the others come from 3C:6686 and get name indices from the per-course
  list 0E:4633 skipping the player's character (`$C810`). Sorted by score then tiebreak (79BD), ranked (7A1C),
  ties flagged with bit 7 of the rank (7A36).
- `$02` 0E:7871 FindPlayerInStandings and `$04` 0E:7887 GetPlayerRank read that list (callers bank 08 and 0E:5466).
  The refs from 7D/7E to `$02` look like data patterns.
- SumScoreToPar 0E:6EDB: strokes (low nibbles at de) minus the per-hole value from 13:7044 (h = `$C836`, l = hole),
  presumably the par.

##### RAM

New labels (others were labelled meanwhile by other passes: `$D200`, `$D214`, `$D224`, `$D226`, `$DC00`, `$C836`):
`$D207` wSelectIdList, `$D209` wHoleSelectFlags, `$D215` wRecordsSubPage, `$D218` wCursorPalette, `$D223`
wStarsCourse, `$D227` wRecordsList, `$D23B-$D23E` stats source / field offsets / anim targets, `$D658`
wCourseIdList, `$C980` wProfileCourseStats, `$C4BE` wHolesDone, `$CA7F` wLastShotRecord, `hFFB0-hFFB6` course
select state. Note `$D214`/`$D200` are reused per screen (records page in bank 0C, select descriptors in 0F).

##### 7F: sound effects engine
Exports SFXStart (7F:400A) and SFXUpdate (7F:406C); farcalled by the driver copies in 7C/7D/7E (SoundHandleRequests,
SoundUpdate) and by 0F:517D, 37:6D69, 5C:5C44, 2E:43C0.
- **Effect header** (SFXTableA 7F:495D for ids < $65, SFXTableB 7F:6160 for ids >= $65, index id - $65): a channel
  mask (-> wSFXChannelMask), then one script pointer per set bit (channel 1..4) -> wSFXChScriptPtr `$C58E`;
  wSFXChSlide = 0, wSFXChWait = 1. SFXStart first silences the channels of a running effect (SFXSilenceActive 7F:42E2).
  The "count" bytes before the tables (7F:495C = `$6E`, 7F:615F = `$6C`) are larger than the valid ranges; the
  tails of both tables hold words that are not script pointers.
- **SFXUpdate**: per channel in the mask: wSFXChWait - 1; at 0 runs the script (SFXRunScript 7F:40A4), else applies
  the slide (SFXApplySlide 7F:419D / noise SFXApplyNoiseSlide 7F:41DD). Mask 0 -> SFXClearState (7F:42BE).
- **Script** (SFXCommandTable 7F:40BB, command = high nibble, low nibble = argument):

  | Cmd | Effect | Cmd | Effect |
  |-----|--------|-----|--------|
  | 0h ll | frequency `$hll`, note on, end of frame | 6x nn | slide once, wait nn frames |
  | 1x nn | NRx2 = nn, retrigger next note | 7w | load wave pattern w (7F:4B6B) |
  | 2d | NRx1 = d << 4 (duty) | 8x nn | NR51 bits (wSFXPanning `$C4C5`) |
  | 3x nn | loop start, count nn | 9x-Dx | **broken**: handler 7F:40DB jumps back to SFXRunScript with hl still pushed and hl = 7F:40DB, so it loops forever on its own `$C3` byte |
  | 4x | loop end | Ex | frequency from SFXHeightFreqTable 7F:431C by wSFXBallHeight / 4 (ball whistle?) |
  | 5x nn | slide step nn (signed) | Fx | end: channel freed and silenced |

- RAM (WRAM0): `$C56E` trigger, `$C572` slide, `$C576` wait, `$C57A` freq words (`$C580` = NR43 of noise),
  `$C582` loop count, `$C586` loop pointer, `$C58E` script pointer (4 channels each), `$C596` active, `$C597`
  scratch mask. `$CAAB` = copy of the ball height (`$D407-$D408`) written every BallTask frame (10:4D6E) only for
  command `$Ex`: the in-flight sound follows the ball's height.
- Leftover: 7F:42CB (unreferenced) tries to silence all channels but uses `ldh a, [n]` (`$F0`) where `ldh [n], a`
  (`$E0`) was meant; only its `wSFXChannelMask = 0` works.

##### 38, 39, 3A: distance -> launch speed tables (golf)
Each bank holds three copies of the same 71-byte routine, each followed by its own tables. ShotSpeed (10:6CDB)
reaches them through SpeedTableJump 10:6D6A by `(wTrajectoryClass $D4C8 + 8) & 15`:

| Class | Routine | Class | Routine |
|-------|---------|-------|---------|
| -8..-4 | 39:6A48 | +1 | 38:550B |
| -3 | 39:5525 | +2 | 3A:4006 |
| -2 | 39:4006 | +3 | 3A:54EB |
| -1 | 38:6A02 | +4..+7 | 3A:69BC |
| 0 | 38:4006 | | |

Routine: c = club; club >= 13 (putter) returns `$40`. Otherwise word table[club] (13 pointers) -> word list indexed
by de / 2 (de = distance from ShotSpeed / 08:60BC); odd de averages the two neighbours. In shot mode 2 (wShotMode)
a byte table[club] indexed by de & ~1 instead. Values grow with the index (club 0, class 0: 4, 14, 33, 39, 45...).
`$D4C8` comes from PlayerField `$1C` (SelectPlayer1/2), so it is a per-golfer trajectory (high / low ball).
Unused exports in the `$4000` tables of 38/39 (idx 08+) are data words, not calls.

##### 28-2F, 72-74: overworld map gfx banks, tile animation
Appended after the gfx data of each bank (code identical except addresses; `cmp.py` in this folder):
MapTileAnimStart (export 0), MapTileAnimStop (export 1), MapTileAnimTask, MapTileAnimStep. Called from 0B:4900
(start; a = wMapGfx, table 0B:42C0 gives (index in bank, bank number 0-10)) and 0B:497D (stop).
- Animation scripts: word table at the end of the bank's `$4000` export table (28 and 2C: `$405E`; 2A and 2D:
  `$4028`; the others `$403A`) indexed by the in-bank gfx index. A script holds up to 4 tracks separated by `$FF`, ended by `$FE`
  (`$FE` first = no animation). A track is a list of 4-byte frames: source tile, tile count, destination tile,
  duration in frames.
- Start: `$C32F` = index; `$C330` 4 x (frame offset, timer); `$C338` 4 track start offsets (`$FF` = unused);
  registers the task. Task (paused while flag #24 is set and #28 clear): each track's timer counts down, then the
  step queues a VRAM copy (00:0468) of count tiles from WRAM6 `$D800 + 16 src` (MapGfxTable ref w7 is therefore the
  animation frame tiles) to `$9000 + 16 dest` (`$B000` in the HDMA queue), `$C33C` = scratch offset.
- **Bug?**: the stop dispatcher 0B:497D handles indices 0-6 and sends everything else to 2F:7DC7, so maps whose
  gfx are in banks 72-74 unregister bank 2F's task (UnregisterFrameTask matches address and bank) and their own
  task keeps running until a ClearFrameTasks. Their stop routines (72:7764, 73:776E, 74:7A55) are never called.

##### 50-54: golf hole gfx banks, tile animation
Same animation engine as the map banks (HoleTileAnimStart/Stop/Task/Step; copies identical except addresses).
Started from 13:7076 (HoleAsset ref 4 entry 0's bank - `$50` picks the bank), stopped from 13:70A2, which calls
all five stops. Scripts come from HoleAsset(`$0401`) (a word list indexed by a), frames are copied straight from
ROM (HoleAsset `$0400` data in the same bank) instead of WRAM6. Same RAM `$C330-$C33C`.

##### 18-1F: text banks
Unnamed copies of the bank 18 loader pair: TextBankBB_Load (export 0), TextBankBB_LoadShort (export 1),
TextBankBB_Copy. Offset table `$4004` in all; string data 19: `$41B4`, 1A: `$41FC`, 1B: `$423E`, 1C: `$4214`,
1D: `$43E6`, 1E: `$4604`, 1F: `$4156` (18: `$4404`).

##### 4A: palette-cycling picture
LoadCyclingPicture (4A:6205, export 2) is called by LoadStoryPicture (77:6F7E). Only picture 0 exists
(CyclingPictureTable 4A:62F1 -> record 4A:62F7: LZ tiles 4A:62FD to WRAM1 `$D800` -> `$9000` (64 tiles), LZ map
4A:65E5 to `$D400` -> `$9800`, attributes all `$0A` (palette 2, VRAM bank 1), palette data 4A:667E). It sets
wOnGreen = `$FF` and registers PictureCycleTask (4A:62A3): palette 2 rebuilt each frame in `$D350` with colour 2
cycling through 16 entries and colour 3 through 8 (by hVBlankCount / 2). PictureCycleStop (4A:629C, export 4) is
called after golf views (10:440A, 10:4614, GolfViewExit 10:4C8F, 08:42B9).

##### 10: golf engine, remaining entries
Most new names are the **golf event API** used by the story / RPG script banks 30-34 (and 3C):
- GolfSessionInit (10:4B28, export `$1C`, 68 calls): clears WRAM6 `$D000-$D6FF`, all overrides, golfers
  (`$80` own character for player 0, `$FF` none for player 1), ClearShotRecords, saves the map return point,
  seeds `$C9FE`. GolfSessionEnd (10:4B94, export `$30`) fades out and returns to the map when `$C2A6` is set.
- SetCourseHole (10:423B, export `$10`, 80 calls): a = wWindDir, h = wCourse, l = wHoleNumber -> HoleIdFromCourse
  (10:4246; CourseHoleIdTable 10:4265: word per course -> hole ids).
- Overrides for the next hole (WRAM6, cleared by GolfSessionInit): SetForcedTee `$D4DE` (tee spot, read by hole
  setup 13:5653), SetForcedWind `$D4E4`, SetForcedWindDir `$D4ED`, SetForcedShot / SetForcedShotD `$D4E7` (club,
  aim; AimMenu 10:5BBF then skips SmartAim; the retry copy 08:4AC2 also uses it), SetP1OffTee `$D4E3`,
  SetP1StartStrokes `$D4EF`, SetGolfEventFlag `$D4DD`.
- Event hook: SetGolfEventHook (export `$1A`) stores a bank and jump table (`$C870-$C872`); CallGolfEventHook
  (10:4CC3) calls entry a: 0 at shot setup (10:484C), 1 after each shot (10:4611), 3 at hole start (10:45CD),
  4 at scene start (GolfSceneStart 10:4226), also from 08:646E and 13:43F6.
- GolfViewInit (10:420E) / GolfSceneStart (10:4226) / GolfViewExit (10:4C6E): set up the HUD, scroll, ball and
  golfer tasks; leave the cup or picture views.
- ReplaySavedHole (10:435E, export `$3C`, from 0B:4E09): loads save block b+4, record c (128 bytes) to `$C600`:
  course, hole, wind (`$C620-$C624`), shot count `$C625`, stroke records `$C640` -> `$D680`; with `$C96D` = 1 runs
  ShotSetup that many times. Looks like the replay of a saved hole (records screen?).
- Player selection: SelectPlayer1/2 (10:46D9 / 10:46EE) load the ball from PlayerField `$22`, the other player's
  ball into wOtherBall `$D41E` (default 10:4771, off the map, before he tees off), and the golfer stats (`$D4C6-$D4CC`,
  `$D4D7`) from PlayerField `$13` and `$19-$1F`. PickNextPlayer adds `$3200` to the pin distance of a player still
  on the tee (PlayerField `$29` = 0) and `$0C80` while PlayerField `$2B` is 0 (set once by 3B:7447; meaning not
  certain), then the farther player plays.
  **Quirk**: SelectPlayer1/2 fill vx/vy/vz (`$D409-$D40E`) with the last byte copied (not 0); harmless because
  ShotLaunch rewrites them.
- Smaller helpers: SetWind 10:40F8, ResetPlayersForHole 10:405C, PlaceBallsAtTee 10:40AC (wTeeSpot `$D439`),
  SaveSafeSpot 10:52C2, PreviewResetBall 10:5518, SetImpactFromPad 10:55B7 (ImpactPadTable 10:55CE), ShotViewUpdate
  10:5632, PlaceTargetMarkerClamped 10:5A3C (export `$5A`), HudRedrawPart 10:5B81, AimStepAccel 10:5EB9 (aim turns
  faster the longer the d-pad is held, wLookSpeed), TargetCupDist 10:621E, SmartAimNextOffset 10:63AA,
  ClubBaseDistanceForClub 10:68B4, ScaleBySlowSpeed 10:4E98, MaxMissSound 10:5534, HudRedrawCurPlayer 10:4786.
- Debug: DebugPrintTarget (10:5549) prints the target marker and its distance to the cup in hex when
  hDebugMode >= 2.
- 10:67CB is not a routine: it is the operand of `and $18` inside SlopeCellAt (the "call nc, $67CB" at 10:4A10
  is data decoded as code). Left unnamed.

Labels: `a8/labels.csv` (161 lines: routines, tables, RAM). All from static reading; one emulator peek
(`states/stroke_hole1.state`) for the round variables.

##### Bank 00 (home): the remaining helpers

Mostly small library routines next to the Tennis-matched ones. Tennis tags `(as in Mario Tennis 00:XXXX)` were
given only where the Tennis source (vendored disasm) has the same instructions and the same relative offsets:
LoadBGPaletteData 027F, SignExtendLToHL 08A5, ClearDebugTextBuffer 2036 (`$CC00`, `$24` x 16 = Tennis's 576-byte
wDebugTextBuffer), StartVRAMDMAFromHL 2096, SetSpriteQueueBase 269F (Tennis hSpriteQueueIndex/Base are also
`$FF9B/$FF9C`). Same-logic-but-different-bytes routines name the Tennis routine without the tag
(QueueSprite16/Template/Grid/QueueSprite: Golf uses a fixed OAM page `$C0` instead of wSpriteBufferPage;
TestGameFlag/SetGameFlag/ClearGameFlag: different push order; PlaySoundManaged: same code, other jump distance).

- **VRAM copy queue** (wVRAMCopyQueue `$C0A0`, 10 x 8 bytes): QueueVRAMCopy 0468 (hl src, de dst, c = 16-byte
  blocks) stores `ROM bank, WRAM bank, src, VBK, dst, len-1`. A destination `$A000-$BFFF` means VRAM bank 1 (bit 5
  of d is moved to the VBK byte), seen in LinkLostScreen 08:555F (`$B000`, `$A800`, `$B800`). Returns a = 0 when
  the queue is full (the copy is dropped). If `c - 1` has bit 7 (c = 0 or > `$80`) it plays sounds `$00` and `$1F`
  and clamps the length: a leftover error alarm (00:04A4).
  QueueVRAMCopyBreak 0460 queues src `$FFFF`: ProcessVRAMCopyQueue treats an odd source as "stop here" (00:0503
  -> 0550) and moves the remaining entries to the front for the next VBlank, so callers spread big uploads over
  frames (e.g. 08:5059, 77:7251, 3B:436B). QueueAndRunVRAMCopy 04DB runs the queue at once (LCD off).
- **Palettes**: LoadPalettesImmediate 056C (both copies + hPalUpdate bits; = Tennis 00:05B5 logic),
  LoadPalettesUnlessFaded 05A8 (live copy only when `hScreenFadedOut` `$FFBC` = 0). ForceFadeOut/ForceFadeIn
  258A/258D enter BeginFadeOut/In past the "already faded" test. Fade state `$FFA2` (1 out, 2 in, bit 7 white),
  speed `$FFA3`.
- **OAM DMA switch**: DisableOAMDMA 0684 / EnableOAMDMA 068A patch the first byte of the ROM copy of
  OAMDMARoutine (`$067A`) to `ret` / `ld a`; note this patches *ROM* address `$067A` (a write to the MBC
  register range: it has no effect on the routine itself, which runs from HRAM `$FF80`); 14 + 8 callers in banks
  41 and 77. In MBC5 space a write to `$0000-$1FFF` is RAMG, so the effect is only to disable SRAM; a leftover
  from a version that ran the routine from RAM? Not checked at runtime.
- **Math**: VectorFromLengthAndAngle 0AF2 (8-bit angle), VectorFromLengthAndAngle16 11BA (16-bit angle),
  MulHLByCos 0B3A, MulCos16 11C7, NegHL 0C60, SubDEFromHL 08AC, JumpToHL 0699 (`call $0699` = call hl).
- **Sprites/glyphs**: QueueSprite 2798, QueueSprite16 26A4, QueueSpriteTemplate 26EA (4-byte entries ended by
  `$80`), QueueSpriteGrid 2756; hSpriteQueueIndex `$FF9B`. RenderGlyphToTiles 2962 / RenderTextToTiles 2933 /
  RenderCharToTiles 2917 draw the 1bpp number font (NumberFontGlyphPtrs 28DA, chars `$30-$3F`) into a 2bpp tile
  buffer (temps `$C280-$C283`); RenderNumberToTiles 28FA uses them.
- **Frame tasks**: SortFrameTasks 24BD bubble-sorts the 16 entries at `$C1C0` by priority after each register.
- **Game flags**: wGameFlags `$C840`, bit masks FlagMaskTable 2D08.
- **Serial** (completes REVERSE "Serial link"): SerialLoadSendByte 2FF8 (mode 2 sends `$40`, then mode 1 sends
  nibbles until hSerialSendCount `$FFC5` = 0, then idle byte := `$FFC9`), SerialHandleRecvByte 3021,
  SerialSendBlock 3081 (a = bytes; returns `$FF` without a link), SerialWaitSendDone 30EB,
  SerialSendLinkRequest 306E (`$71` on the internal clock), SetLinkActive 30F8 / ClearLinkActive 30FD.
- **Tracer artefacts**: `coverage.py` gives 00:30FD 3219 bytes: the traced range `00:3374-4002` is `$FF` fill
  reached from `36:71EA jp nc, $3374` (data decoded as code in bank 36), so ClearLinkActive "covers" it. 00:0038
  (`RST38_Fill`) and 00:0057 (called from 36:5491, also data) are fill bytes; 0057 left unnamed.

##### Bank 01: font and default palettes (plus GameMain)

Exports `$04-$0C`: QueueFontTiles 422C (font re-upload over 6 frames, LCD on), ReloadFontTiles 421A,
LoadDefaultPalettes 41B3, InitFontScreen 41E8 (font + cursor + palettes with the LCD off; used after picture
screens, e.g. 08:4F7E), LoadCursorSprite 4289 (4 tiles 01:5120 to de, OBJ palette b). Data: FontTiles 01:42A0
(`$E0` tiles), DefaultBGPalettes 01:50A0, DefaultOBJPalettes 01:50E0, CursorSpriteTiles 01:5120 (a 16x16
pointer-like shape). The 272 bytes of 01:4289 in coverage are font data traced as code.

##### Bank 08: golf round rules by game mode

Bank 08 holds the per-mode hooks that GolfRound (bank 10) calls at fixed points. DispatchByGameMode 470D jumps
through a 16-word table indexed by wGameMode `$C834` (`$C834` = 3 in the Stroke practice round, from the save
state). From the handlers: **mode 1** keeps per-course statistics (wProfileCourseStats `$C980`, 25 bytes per
course) and ends with a rank result; **mode 2** is match play (wMatchHoles, MatchStatus, VS result); **mode 3**
is stroke play (honour, near-pin / drive contests with two players, VS result by score); **mode 4** has a
retry/quit menu after each shot (10:4A39 branch: retry the shot, replay the hole, quit).

| Export | Routine | Called from | Per mode |
|---|---|---|---|
| 00 | RoundHookRoundStart 4722 | GolfRound 10:4472 | 1 stats load; 2 clear match; 3 tee order + contest totals |
| 0C | RoundHookSaveAtHole 47B4 | hole setup 10:45C8 | 1-3 SaveGameMidRound (SaveGame with `$C96D` = 2) |
| 24 | HoleIntroFlyover 6432 | 10:45D0 | 1-3 green view 180 frames, then camera pan (button skips) |
| 02 | RoundHookHoleStart 47FD | 10:45D6 | 2 playoff/dormie captions + music; 3 honour + contest init |
| 04 | RoundHookPlayerUp 4880 | before each shot 10:484F | putt-for captions; match status captions |
| 06 | RoundHookAfterShot 4901 | 10:460C | 1 tee-shot stats; 2 hole result -> wMatchHoles; 3 contest; 4 menu |
| 26 | RetryShotRestore 4AA3 | 10:4624 | restores P1's ball/strokes from `$D359-$D369` |
| 08 | RoundHookHoleEnd 4B02 | 10:4635 | 1 hole stats; 2 playoff when level after the last hole |
| 0A | RoundHookRoundEnd 4BBC | 10:466D | result screens, EXP bonuses, game flags, return map |
| 0E | PauseMenu 4666 | Start while aiming 10:5D9D | menu by mode (banks 41/44) |
| 10/12 | PlayRoundMusic 5062 / PlayGreenMusic 50E6 | | song by course / opponent / decisive hole |
| 18 | LinkLostScreen 555F | LinkLostReset 00:2F8D | |
| 20 | AimStepForDistance 60E6 | aiming 10:5E6A | AimStepTable 08:6110 |

- **Match play**: MatchLeadP1 403C counts wMatchHoles before the current hole; MatchStatus 4091 compares the lead
  with wHolesLeft (`$FF` decided, 1/2 dormie for P1/P2, 3, 0). MatchHoleOutcome 4199 / MatchHoleResult 4161 give
  0 undecided / 1 / 2 / 3 halved. After the last hole a level match sets wMatchPlayoff `$C83A` and wHolesLeft = 2
  (08:4B7E), and caption `$1E` shows at each extra hole.
- **Hole contests** (mode 3, two players): on par 3 the near pin (PinDist when the tee shot is on the green, best
  starts at `$1900`), on par 5 the longest drive (ShotLength on lie 0/6/`$A`/`$E`). `$D48F` best, `$D491` leader,
  `$D494-$D497` wins this hole, added to the players' +`$17`/+`$18` at hole end. Captions `$2A`/`$29` (intro),
  `$22`/`$20` (winner) via ShowCaptionAndWait 3B:76F8.
- **Course stats** (mode 1): work copy `$C96E-$C97D` (shared with wMatchHoles) holds longest drive (word),
  drive count/sum, fairways, putts, par-or-better, greens in regulation, and a sixth stat gated by P1 +`$15`
  bit 0 (sand save?). Counters stop at `$FF` (`$80` for drives) and then the sums decay as running averages
  (`sum += x - sum/256`). SaveCourseStats 459E writes them back with rounds played (ClampTo9999), best score
  (+`$36` offset of P1 +`$3E`) and a score count/sum.
- **Results/EXP**: RoundEndFadeAndExp 4F03 awards wPoints as EXP unless the profile slot is `$xF`;
  SetRankExpBonus 4D18 (table 08:4D3D by course and rank) and AwardFirstWinBonus 4E97 set wExpBonusKind/`$CAAE`
  once per game flag.
- **Debug leftovers**: MatchLeadP1/MatchStatus/MatchStatusDebug and AddContestWinsToPlayers print hex/decimal
  values into the debug text buffer (PrintHexByte at rows 9 / PrintDecimalByte at row 8); PauseMenu calls
  41:77EA (Select held) / 44:42FB (Up held) when hDebugMode is set (08:46F3).
- RAM: wHonour `$C83B`, wDecisiveHole `$C832` (song `$2A`), wRoundResult `$C96C`, wTeeShot `$D445` (?).
  `$C96D` (labelled wReplayActive by another pass) is also set to 1 by GolfRound (10:446B) and cleared at round end
  (10:4650); PlayRoundMusic plays nothing while it is 0, and SaveGameMidRound sets it to 2: it is a "golf session
  active" byte rather than replay-only.

##### Bank 13: hole data and views

- LoadHoleInfo 55F6 (export 8) reads HoleInfoTable 13:5884 (32 bytes per hole id): +0 par (wHolePar), +4 yards
  (wHoleYards; hole 1 = `$0176` = 374 as shown in game), +6 4 bytes to `$C329`, +`$A` to `$D441`, +`$C` to `$D439`,
  then one of 4 pin positions chosen by `$C838` (labelled wWindDir; the pin choice suggests it is a more general
  per-hole random value) -> wCupX. Par counts over all 102 rows: 22 x 3, 50 x 4, 21 x 5 (+ special rows 7/9).
  Tree widths per course (13:5684) -> wTreeWidth.
- GetHoleParAndYards 7044 (export `$0C`) reads the same table by hole and course code.
- Views: DrawHoleViewAtCamera 411D copies a 22 x 20 window of the 64 x 64 attribute (WRAM2) and tile (WRAM3) maps
  into the 32 x 32 BG map at the camera goal; ReloadHoleViewMaps 42A8 (export `$10`) reloads course or green maps
  first; SnapCameraToGoal 4276 (export 2) redraws when the flyover is skipped. (In 411D, `ld de, $FFC0/$FFE0` are
  -64/-32 wrap constants, not hSerialRecv as disasm.py annotates.)
- LoadCoursePalettes 446D (export `$12`): 13:45AB[wCourse] picks a `$30`-byte set at 13:45BB: BG palettes 2-6 and
  OBJ palette 2.
- StartCourseAnimTask 7076 / StopCourseAnimTasks 70A2 (export `$0E`): far calls into the course banks 50-54
  (start: the bank named by hole asset ref 4; it registers a frame task, e.g. 50:71B3, slots `$C330`).

##### Bank 3B: captions, pictures and outcome rules

Besides ShowCaption/OutcomeRules (already named): WaitCaptionOrButton 4310, ShowCaptionAndWait 76F8 (export 8,
used by bank 08 for all round captions), ShowPlayerPicture 7717 (LoadStoryPicture with timeout `$D34D` = `$F0`)
and WaitPictureTimeout 773F, StrokeLimitPickUp 76D8 (called by StrokeLimit 10:4167: green view, song `$1F`,
picture 5, caption `$19`), OutcomeMode7 76A8 / OutcomeModeC 76C0 (OutcomeRules branches for game modes 7 and
`$0C`), ShowBannerSprite 776D / HideBannerSprite 7766 / BannerSpriteTask 7858 (a blinking 48 x 16 sprite banner,
12 tiles at 3B:7790; the text was not read reliably).

Role: overworld map engine (MapEngine 0A:498C, map load/events/talk/objects) plus the **script API** that the
map scripts in banks 30-35 call with `rst $18 ; db idx, $0A`. Also: event list / navigation screens, the
navigation guide arrow, palette (sepia) fades and the ending sequence.

##### Script API (export idx = byte after rst $18; uses in all banks)
| idx | addr | name | args / effect |
|---|---|---|---|
| 00 | 4092 | ScriptBegin | (existing) |
| 02 | 40D6 | ScriptEnd | (existing) |
| 04 | 410D | ScriptWaitFrames | a = frames (782 uses) |
| 06 | 4120 | ScriptRespawnActors | a = bank, hl = spawn list -> MapInitObjects |
| 08 | 4164 | ScriptShowText | a = speaker slot ($80 = none); shows text wScriptTextId, then cursor += 1 (557 uses) |
| 0A | 4199 | ScriptShowTextKeepOpen | same, box left open (before a Yes/No) |
| 0C | 41CE | ScriptCloseText | closes the message box, redraws the map |
| 0E | 4124 | ScriptSetText | hl = text id -> wScriptTextId $D852 (511 uses) |
| 10 | 4140 | ScriptSkipText | cursor += 1 without showing |
| 12 | 41D8 | ScriptAskYesNo | Yes/No (text $1A) under the last page -> a = 0 Yes / 1 No / $FF |
| 14 | 42E0 | ActorSlotAddr | (existing) |
| 16 | 42FC | ActorSetSpeed | a = slot, bc -> +$0E |
| 18 | 431E | ActorSetScript | +0..+2 = actor script pointer (bytecode run by 04:4234, opcodes 04:420C) |
| 1A | 4342 | ActorResetScript | |
| 1C | 435E | WaitActorScriptEnd | a = slot; until script byte = 0 |
| 1E | 4393 | WaitActorMoveDone | a = slot; while +$12 bit 0 |
| 20 | 43C6 | ActorSetPos | (existing) |
| 22 | 4416 | ActorMoveTo | a = slot, bc = x, de = y |
| 24 | 4466 | ActorMoveToNear | unused, buggy |
| 26 | 4503 | ActorMoveBy | unused: bc / de deltas |
| 28 | 4587 | ActorMoveDir | a = slot, b = angle, de = distance |
| 2A | 460E | ActorLockSpriteFacing | a = slot, b = 1 lock / 0 unlock (+$33; +$32 drawn facing) |
| 2C | 4644 | ActorSetFacing | (existing) |
| 2E | 4662 | ActorFaceActor | a turns toward b |
| 30 | 46D4 | ActorsFaceEachOther | a and b face each other |
| 32 | 475B | ActorPlayAnim | b = slot, a = anim |
| 34 | 4768 | WaitActorAnimDone | a = slot (<= 240 frames) |
| 36 | 47A6 | ScriptActorSetSpeed | bc -> wScriptActor +$0E |
| 38 | 47C8 | ScriptActorGoTo | a = 0 walk / else fade-warp; bc = x, de = y |
| 3A | 482A | ScriptActorGoToActor | a = target slot, b = 0 walk / else fade-warp |
| 3C | 48AC | WaitScriptActorIdle | (existing) |
| 3E | 48DF | ScriptShakeScreen | a = 0 off / 1-3 strength |
| 40 | 4774 | ActorJump | a = slot, de = vertical speed (neg = up) |
| 42 | 4788 | WaitActorLanded | a = slot (<= 120 frames) |
| 44 | 42BF | ScriptRunMenu | hl = options text, d e = x y -> a = row |
| 46 | 4794 | ActorSetState | a = slot, b -> +$16 |
| 4C | 4BFF | ScriptSetMapField | hl -> word at $C450 + de (patch header lists) |
| 5C | 7878 | NavGuideStart | navigation arrow + destination marker task |
| 5E/60/62 | 5422/54CF/5561 | PalFadeInitSepia / PalFadeSetup / PalFadeRun | sepia fade: init; bc = palette mask, d = steps; run |
| 64 | 56B1 | EndingSequence | ending credits driver (33:6978) |

Typical text pattern: `ld hl,id; ScriptSetText; ld a,spk; ScriptShowTextKeepOpen; ScriptAskYesNo; ScriptCloseText;`
then Yes -> ScriptShowText (id+1), No -> ScriptSkipText + ScriptShowText (id+2).

##### Actor fields learnt (WRAM4 $D000 + slot*$40)
+$08 height (neg = up) / +$1C vertical speed (gravity $10, 04:4299); +$0A/+$0C move target; +$0E speed;
+$10 heading; +$11 turn rate?; +$12 bit 0 moving to target; +$16 state; +$1A bit 0 script frozen / bit 1 movement frozen;
+$31 animation; +$32 drawn facing; +$33 drawn facing locked; +$34 set by FreezeAllActors.

##### RAM
$D852 wScriptTextId (WRAM5); $C363 wShakeLevel; WRAM6 fade buffers $D4A0 target / $D540 current / $D5E0 select /
$D5F0 steps / $D5F9 delay.

##### Notable
- Flag #22 = debug script fast-forward (ScriptDebugSkipTask 0A:4066, Start in hDebugMode): texts are skipped
  (0A:417F), actor moves become ActorSetPos (0A:446D), anim/landing waits skipped.
- ScreenShakeTask 0A:4927: the negate branch is dead (`and c` clears carry), so shake offsets are always >= 0.
- ActorMoveToNear 0A:4466 (export $24) has no callers and computes its delta from the wrong registers.
- 0A:4109 is actor-script data (`0B 0C FE FF`), not code.
- Ending (0A:56B1): parts from EndingPartTable 0A:5682 (map 0 -> character map 0A:56A1 by wCharId); each part
  runs the map with flag #24, freezes actors, fades palettes to sepia (b c = $3F3F, d = $1E), then CreditsRun 0B:5395.

##### Bank 32: mode select, Marion Clubhouse / Lounge / Director's Room, test maps

Map names below are the banner texts (`$12C` + map id, bank 18).

| Header | Maps | Place |
|---|---|---|
| 32:4FE9 | 00 | Mode Select (title, link and mode menus) |
| 32:553B | 03 | Marion Clubhouse (hall with 5 doors) |
| 32:6315 | 04 | Lounge (the four Club Champs) |
| 32:6EB5 | 05 | Director's Room |
| 32:4016 | 1F | "VS Results" test map |
| 32:4778 | 20 | "Course Parameters" test map |
| 32:4C1B | 21 | "Norio Status!" test map |
| 32:4EB4 | 22 | "Norio Sample" (a copy of the clubhouse NPC list; empty enter script) |

- **Mode Select (map 00)**: ModeSelectMain 32:5037 is the front end. It shows the title (40:4032), then LinkMenu 09:4A12:
  0 = load a character (CharacterSelectScreen; SaveBlockLoad; pending EXP `$C95C` scaled by level 32:54B5 and
  given with AwardExpPoints 48:4D70; MapWarpToReturnPoint; summary prompt 32:7D35), 1 / `$11` = link host / guest
  (exchange the `$C880` records with SerialSendBlock; handshakes `$20`-`$22`; `$C33F` = 1 / 2), 2 = 0B:4D9D,
  else ModeSelectOptionsMenu 32:79D8 (3F:4002 or DataManageMenu 32:7A0A: copy / erase a character, erase all).
  Then the game mode menu 0D:4AA7: 9 = story (clears the partner flags #144-147, saves, warp 4), 1 = stroke
  (CourseSelect, 18 holes, or hole 18 / 3 holes by debug? flags #74 / #73), 2 = VS with a CPU golfer, 3, 4 = single
  hole practice (CourseHoleSelect loop).
- **Clubhouse (map 03)**: the counters (talk 02 / 03 use partner texts `$1D1+` when a champ follows you),
  five doors (triggers 03-07 play 4-frame door animations 32:5EF5-6219 and take warps 3-7; entering through a door
  runs the closing animation, 32:5D94), and the exit. Trigger 01 (after Links is won) asks "Going outside?" and sets
  #149. The enter script swaps the talk list by progress (ScriptSetMapField +$0C, lists 32:5853-5B09 by course flags
  #112-115 / #139) and, after beating Mario (#117 without #120), warps to the Director's Room scene.
- **Lounge (map 04)**: trigger 01 (flag #96 once) is the champ introduction: an arrow sprite task (32:6AB6, table
  32:6AA2, index `$C4B3`) points at each champ while texts `$1F1-$1F4` (or the "former champ" texts `$1F9-$1FC`
  when the club-won flag #136-139 is set) are shown. Talking to a champ (slots 7-10, Map04TalkClubChamp 32:6B81)
  runs a Yes/No chain; agreeing makes the champ your **partner**: flags #144+n (partner) and #128+n are set, #118
  cleared, and the champ follows the player (ActorStartFollow; `$C298` slot, `$C294` actor, `$C299` = n + 4). The
  Links champ talk also sets #131. Per-club flag helpers take `$C4BC - 7` as the club index (32:6B2F / 6B43 / 6B57).
- **Director's Room (map 05)**: entrance 2 is the first-day welcome (director, pro and Caddie Master introduce
  themselves, texts `$487-$48F`, then warp 2). After beating Mario (#117) the staff scene 32:7533 (texts
  `$4BF-$4D0`, they decide to keep the win quiet) plays once and sets #120. Object 04 is a 1-UP Mushroom
  (flag #156: EXP to the next level, LevelUpScreen). Bookshelves give random book titles.
- **Story flags used here**: #112-#115 / #139 course progress (Palm / Dune / Links unlocked, Links won), #136-#139
  club tournament won (Marion / Palm / Dune / Links), #144-#147 partner from that club, #117 beat Mario,
  #120 cover-up scene seen, #96 lounge intro seen, #149 talked at the exit.
- **Test maps (debug leftovers)**: map 1F shows a two-player result with portraits, falling confetti actors and a
  rainbow palette cycle (32:4199-4777; sums the 18 hole scores at `$C8AC` / `$C8EC`); map 20 shows RoundResultScreen
  with fixed results (entrances 4-7) and a "Hole in One / Eagle / ... / Bogey" picture menu (table 32:4951);
  map 21 is a 3x3 golfer grid with stat bars that starts an 18-hole test round and prints the choice with
  PrintHexByte / PrintHexWord (32:4E0C). Maps 1F and 20 also have a talk that opens DebugPaletteEditor 44:42FB.
- RAM: `$C441` = warp request (wMapEvent+1, `$FA` reloads at the saved position); `$C33F` link role; `$C95C` pending
  EXP (valid when `$C95E` = `$64`); `$C4BA` text base / `$C4BC` script argument (shared with bank 33);
  `$C3F4` / `$C3F5` (debug palette editor labels) are reused as rainbow step / scene variant by the VS test.
- Notable: Map04 talk 07 (Marion champ) uses text base `$1FD` but the other champs `$416` / `$42F` / `$448`.
  ModeSelectCheckLinksUnlocked 32:5304 drops its caller's return address (pop hl) to abort the course select.

##### Bank 33: Caddie Master's offices, Mario World, Windy Valley, Club Maker's Hut

| Header | Maps | Place |
|---|---|---|
| 33:400A | 08-0B | Caddie Master's Office of Marion / Palm / Dune / Links (one header, per-map code by wMapId) |
| 33:56BE | 1C | Road to Peach's Castle |
| 33:5AC6 | 1D | Peach's Castle |
| 33:6FB9 | 26 | Windy Valley Special Hole |
| 33:781E | 2E 2F | Club Maker's Hut / Windy Valley Hutt |

- **Caddie Master's offices (maps 08-0B)**: the gate to every club round. Enter 33:4722 clears the temp flags
  #224/#225 (and #118 #190-193 #101 #102), loads the club's spawns / lists / decoration (33:55A3-55DB) and sets
  #227 = qualified for this club tournament (course flag #112 / #113 / #114) and #226 = club already won
  (#136-139). The Caddie Master menu (33:5166, text `$892`): **Club Tournament** (StartClubTournamentRound 33:4F05:
  wGameMode 1, wStoryRoundKind `$C967` = `$0A`), **Practice Round** (wGameMode 3, `$14`) or a **Match Game** against
  your partner (wGameMode 2, `$1E`, partner golfer 4-7). The course is 1-4 by map, return point = this map entrance 6.
  Before the first round per club a group tees off (33:5257; flags #176+n / #184+n). Back at entrance 6 the round
  result sets #240 and #241 won / #242 placed / #243 not placed (33:45FE), which pick the speeches (`$880-$891`,
  `$C33-$C3A`) and NPC texts (33:4CAC). Leaving with a partner asks whether the partner comes along (33:4FE5);
  declining dismisses the partner (clears #144+n). Signs point to Hole 1 / Driving Range / Approach / Putting.
- **Hidden friends**: on map 0B object 0F a friend hides (flag #140, not when you play character 0); 33:7CF1 gives
  **300 EXP** once all friends other than your own character are found (#140-#143).
- **Road to Peach's Castle (map 1C)**: sets #125 (Mario World reached); the Bob-omb launcher (33:57CE, tile
  animations 33:5899 / 5912) shoots the player to the castle (warp 1).
- **Peach's Castle (map 1D)**: first visit (33:60B2, unless #126 / #116) is the welcome scene with Peach, Toad, Bowser,
  Mario, Luigi, Yoshi (texts `$144A-$1456`), then "May we begin the tournament?" (33:66DC). Starting it opens the
  castle door (#127, tiles 33:63F9) and plays **Peach's Tournament** on course 5 hole 1 (wGameMode 1, return entrance
  6). Back at entrance 6 (33:5F8F sets #106 and the result flags) the award ceremony 33:672A presents the trophy;
  the **first win** sets #111 and #121, saves, shows ShowPictureTimed and runs **EndingSequence 0A:56B1**. Toad
  (talk 06) offers a practice round on course 5 once #127 is set. Object 04 is a 1-UP Mushroom (#158).
- **Windy Valley Special Hole (map 26)**: a guardian challenges you to hit targets (triggers 01-03 pick the tee,
  33:72BE / 730C, wGameMode 5 or 6, shot limit `$C82C` = `$28` or 7, event hook 33:736F, random wind 33:751B on
  course 0 hole 7 or course 8 hole 11). First success: 40 EXP (x1.25 with #99), #198 (and #200 #212 #213 when
  #114); second target: 180 EXP and #201. Afterwards the guru offers once to switch your shot between **fade and
  draw** (33:779F flips GetCharHand / SetCharHand; #214). Trigger 04 is a door locked until #198.
- **Club Maker's Hut (maps 2E / 2F)**: sets #124 on map 2E; the club maker (33:7990) gives a special **Distance or
  Control club** (SetCharFlags12 1 / 2; #215 #216 #225, #217 = Control) and later takes it back or returns it
  (33:7A73), saving each time. Talk 03 is the Windy Valley guardian again (after #212 it sets #213 and sends you to
  the second target). Object 01 is a 1-UP Mushroom (#157).
- RAM: `$C967` wStoryRoundKind (`$0A` tournament / `$14` practice / `$1E` match / `$64` result speech pending);
  `$C3E0` target result / club choice (scratch); `$C298` / `$C294` / `$C299` partner; flags #224 / #225 are map-local
  temp flags (cleared on entry).
- Notable: 33:66CB plays a single hole instead of 18 when flag #72 is set (debug?); entrances `$0A-$0C` of map 1D
  fake a 1st-3rd place result (33:5F5B), likely for the debug warp menu. 33:4DBE duplicates 32:62F7 (HasPartner).

##### Banks 30 and 31: map scripts (practice ranges, putting greens, Alternate Game, opening, clinic, award ceremonies)

Map names are text `$12C + map index` (bank 18). Flags are game flags (`rst $20/$28/$30`).

**Shared lesson system (both banks, 8 ranges x 2 coaches = 16 lessons).** Each approach / driving range has two
coaches (talk 03 / talk 04) and the same script set per coach (example Marion approach range, map 0D):
- talk script (30:4119): if the "lesson in progress" flag (#101 coach 1 / #102 coach 2) is set, offer a retry
  (30:44D0); else Yes/No for a **coach demo**: GolfSessionInit, mode `$0C`, golfer preset `$4F`/`$4E` with a
  16-byte stroke record copied to `$C600` (e.g. 30:432E: tee `$1D60 $1F80`, club 6; bit 6 of the preset copies it
  to `$D680`), fixed course 7 hole, forced tee / wind / wind direction, an event hook table (30:433E) and
  MapSaveReturnPoint to the same map with entrance 2 (coach 1) or 3 (coach 2).
- enter script (30:429A) dispatches by wMapEntrance: 2/3 = after the demo (30:44DA "want to try?" -> 30:4506);
  4/5 = after the player's attempt (result script 30:4448); `$FA` = back from free practice (clears #100).
- the attempt (30:4506) sets #101/#102 and replays the hole with the player's golfer and SetForcedShot.
- the attempt's hook (e.g. 30:4409) writes **wEventResult `$C968`** = BallWithinPinDist 30:7E2E (0 = within
  `$60` of the pin), **wEventShotClub `$C969`** (stroke record +8; `$0D` putter gets its own line) and flag #99
  from `$C8AA`. Success sets #98 and clears #101/#102; the enter script then, the first time only, sets the
  lesson flag, awards EXP (AwardExpWithBonus 30:7E7F: +25% when #99), saves and requests warp 6/7 (8/9 in 31).
- EXP per club: Marion 20, Palm 25, Dune 45, Links 50 (same values for the putting challenge).
- Trigger 0F on every range = "Practice here?" (30:47E6 / 31:51F4): sets #100 (practice; 41:6F08 menu) and plays
  a free round teed at the player's map position (30:480D / 31:521B).

| Map | Place | Coach 1 lesson (flag) | Coach 2 lesson (flag) |
|---|---|---|---|
| 0D | Marion approach range (30:400E) | running approach #160 | chip approach #161 |
| 10 | Palm approach range (30:48F8) | bunker shot #164 | running approach on sloped greens #165 |
| 13 | Dune approach range (30:5065) | approach over a hazard (backspin) #168 | pin above a steep climb #169 |
| 16 | Links approach range (30:57FD) | over a mound to a downhill pin #172 | across a steep slope #173 |
| 0C | Marion driving range (31:4946) | driver tee shot #162 | iron shots #163 |
| 0F | Palm driving range (31:52D2) | intentional hook/slice #166 | wind shots #167 |
| 12 | Dune driving range (31:5BCE) | high shot to a two-tiered green #170 | recovery from the trees #171 |
| 15 | Links driving range (31:645F) | shot from the trees #174 | buried bunker lie #175 |

**Links contests (after winning the Links tournament).** Tournament flags (set by 08:4CAE): #112-115 = course 1-4
tournament played, #136-139 = won. On Links maps 16 and 15 the talk list is patched with ScriptSetMapField
(`de = $0C`) after #115 and again after #139. Map16UnlockContests 30:6414 / Map15UnlockContests 31:7051 set
#224 / #225 when #139 and the coach's lesson flag are set; the coaches then challenge the player instead
(approach: mode 5, win at `$C968 >= 7`, 10 = bonus #99, first win #220/#221; driving range: closest to the pin,
player distance `$C96A` vs coach `$C968`, first win #222/#223; 50 EXP each).
- Quirk (?): both maps set the same #224/#225 from their own lesson flags (#172/#173 vs #174/#175) and never clear
  them (bank 33 does), so clearing one range's lesson also turns on the other range's contest.

**Putting greens (maps 0E 11 14 17 = Marion Palm Dune Links practice greens; header 30:642A, enter 30:69B9).**
- One header for four maps; PuttingGreenEnter respawns per-map actors and patches the warp list (`de = 8`) and
  talk list (`de = $0C`) per map (Links again by #115/#139).
- Green pro (talk 08 on 0E, talk 06 elsewhere: 30:6666 / 668B / 66B3 / 66DA): putting challenge (offer 30:6701,
  text by tournament flags 30:6DF6, hole PuttingSetChallengeHole 30:6B90); wStoryRoundKind `$C967` = `$0A`;
  result 30:6CF2: wPuttChallengeScore `$C3E1 >= 7` clears it (flag #194 + green index, PuttingGreenIndex
  30:6E49), else marks it tried (#190 + index); EXP 20/25/45/50, +25% for 10 (30:6EC8).
- Free putting practice (trigger 0F, 30:6B13): `$C967 = $14`, mode 7, tee pulled toward the player (30:6D40).
- Hidden friend Azalea (object 0F, 30:6942): sets #142 unless you play Azalea; HiddenFriendsBonus_30 30:7EAD
  gives 300 EXP once the other three of #140-143 are set (same as 33:7CF1).
- Dune green (map 14) golfers 8 / 9 / `$0A` (30:681A / 683E / 6862): before the Dune tournament (#114) they ask for
  a partner; afterwards the **Alternate Game** invitation (30:6F42; replay 30:70B0): Match Game or Stroke rules
  (#155 = Stroke -> mode 3, else 2), warp to map 2A. Declining a replay sets #249, after which they only say
  "...maybe next time" (30:71AF; #249 is never cleared).

**Alternate Game (maps 2A / 2B: "Alternate Game", "Alternate Game Event").** 2B enter 30:747D: entrance 1 intro
cutscene (30:74FE) -> warp `$0F` -> 2A enter 30:7212 (rules text first time #151, who starts: #152) ->
AltShotStartRound 30:72F0: player + partner `$0B` vs presets `$0C`/`$0D` (teams `$C878-$C87C`), course 3 hole 1,
round id `$12`, wAltShotTurns `$C873` toggled by AltShotNextGolfer 30:72A8; returns to 2B entrance 6 ->
result by wRoundResult (30:76F9): win 30:790F (first win #154 + 200 EXP), loss / tie texts. Talk 05 on 2B plays a
small sprite animation (tiles 30:7B90 -> `$8500`, 30:7C61-7CE3).

**Story Opening (map 1E, 31:43B9).** NewGame, then four two-choice questions with portraits: boy/girl (#0),
character (#1) -> OpeningCharTable 31:4791 -> CreateCharacter 02:4E82, handedness (#2 -> `$C811`), random
`$C83E` (0-5); confirmation 41:6784; NameEntryScreen; "Marion Club Director's Office" caption; sets **#97**
(opening done) and warp 1. The opening reuses `$C470-$C472` (EventListScreen RAM) as choice marks / cursor x / y.

**Select Screen (map 23, 31:47D7).** Development leftover: the enter script calls AngleFromVector16 with constant
vectors and prints three results as hex (PrintHexWord at row 9 columns `$0C-$0E`), then a mode menu (text `$0085`:
Tournament / Match Game / Practice / Clubhouse / VS / Start Over, handlers 31:4867) that starts fixed test
rounds (course 1), EventListScreen, or ShowScorecard with hard-coded values.

**Golf Clinic (map 2D, 31:7127-7444).** Coaches 5 / 6 (and trigger 01) judge one tee shot (31:7252: course 0
hole 6, mode 6). The hook 31:75E1 sets #99 and classifies the first stroke (31:760C: power byte +`$0A` `$3C`
perfect / `>= $34` / weak, impact offset +`$0B`, bits 4-7 of +`$0C`) into `$C968` = 0-8; on return each coach
comments through a jump table (31:72F6 / 31:746A, texts `$15BC-`).

**Award Ceremonies (maps 18-1B = Marion Palm Dune Links, 31:7775).** Entrance 2 = champion (31:78E1), 3/4 =
second / third place trophy (31:7B1C, place = entrance - 1), else none (`$C96C = 5`). The first champion
ceremony on 18/19/1A sets #107/#108/#109 and later visits skip straight to warp 2. Links champion: character
picture (40:6666), StaffCredits 41:7E07, sets **#110** (game cleared), returns to map 0 entrance 2 and saves.
Map 1A also sets #212 when #198 and #114 are set (31:7CB0).
- Possible bug (static reading): CeremonyEnter tests #110 for every ceremony map before looking at the entrance
  (31:77FD -> 31:782F). After the ending, any entrance 2-4 visit to a ceremony map whose seen flag is still clear
  (#107-109 are only set by a win; map 1B has none) replays the ending picture and credits; the later #110 test at 31:786B is then redundant.

**Shared helpers** (copies in both banks): MapScriptNop_30/31 (object 01 scripts), FadeToLevelUpScreen_30/31,
AwardExpWithBonus 30:7E7F / 31:7DA4, CurPlayerFieldAddr_30 30:7E1A, BallWithinPinDist 30:7E2E,
GetPlayerActorPos 30:7E46. Actor scripts (bytecode, data): 30:7D7B, 30:7D99 (= 31:7CBE), 30:7DFF, 30:7E08,
30:7E11, 31:7D19, 31:7D24, 31:7D2D.

**RAM (new labels):** `$C82C` wRoundMusic, `$C968` wEventResult, `$C969` wEventShotClub, `$C96A`
wEventPlayerDist, `$C873` wAltShotTurns, `$C3E0` wScriptLoop, `$C3E1` wPuttChallengeScore, `$C3E2/$C3E4`
wPuttGreenBaseX/Y. Used: wStoryRoundKind `$C967`, wMapWarpRequest `$C441`.

Not labelled: the golf event hook handlers (code reached only through the hook tables, e.g. 30:435E, 30:4409,
31:75E1) and the unlisted code they call; the hook tables themselves are labelled `...HookTable`.

Labels: `a10/labels.csv` (344 code/data + 41 RAM). With them and the extra tracer roots below, every traced
entry of these 12 banks is named (scratch trace: total 236514 traced bytes, 80.1% named vs 71.3% before).

##### Tracer roots (feed to `trace_code.py --roots`)

Live code the tracer misses (indirect jumps):

- **0E** (ScorecardPageTable 0E:4422, dispatched by `call $0699` in ShowScorecard 0E:43D6):
  `0E:5209,0E:6C7A,0E:762F,0E:7199,0E:4432,0E:4436`. These six pages pull in all the remaining live code of
  the bank (0E goes from ~600 traced bytes to 3762).
- **0D** (mode-select descriptor hooks, `jp hl` in 0D:4953 / 0D:496B): `0D:6FF7,0D:7070`.
- **04** actor script opcode handlers (table 04:420C, `jp hl` at 04:4287):
  `04:45C1,04:45C3,04:45D8,04:45E9,04:4679,04:4612,04:46A2,04:46FB,04:4756,04:47A2,04:484D,04:48FC,04:49A2,04:49B1,04:49EC,04:4A57,04:4A5B,04:4A71,04:4A7C,04:476C`;
  the handlers' return point `04:4288` (pushed with `ld hl,$4288 ; push hl`); native code called from the
  player's actor script 04:527A (op $12 at 04:527A+$0E): `04:538C` (PlayerWalkControl, the player's walking).
- **40** demo slide frame tasks and setup routines (DemoSlideTable 40:5D9F, read by DemoSlide 40:5C72):
  `40:5E1F,40:5E2C,40:5E2D,40:5E3D,40:5E50,40:5E5F,40:5E66,40:5E76,40:5E8A,40:5E9F,40:5EC0,40:5ED4,40:5EEE,40:5F11,40:6143,40:616B,40:6194,40:61A9`.
- **41** menu handlers (word tables passed to RunMenu 41:6FF4, `jp hl` at 41:7077):
  `41:7323,41:7329,41:732F,41:7335,41:7349,41:739A,41:73E4,41:73EA,41:73F0,41:7402,41:7413,41:7419,41:741F,41:7425,41:7437,41:744B,41:7451,41:7457,41:745D,41:746B,41:74AE,41:757B,41:7581,41:7587,41:758D,41:759B,41:75DE,41:7662,41:7668,41:766E,41:767A,41:768C,41:769E,41:76AC,41:76BF,41:76C7,41:76CF,41:76DF,41:76E7,41:76EF,41:76F7,41:7707,41:770F,41:7721,41:7733,41:7745,41:774D,41:775F,41:7767,41:7779,41:77B3`
  (the last two from the Settings table 41:7775).

Unreferenced code (dead; labelled, roots only if the tracer should count it):
`0E:44AE,0E:44C8,0E:44E2,0E:45CD,0E:7356,0E:6E50,0D:499A,04:40E9,04:4588,04:4EE0,04:4EF5,40:5EFC,40:61AA,0B:4776,0B:4739,0B:4788,0B:4826,0B:4501,0B:656F,0B:6585,0B:65DE,12:416B,12:4956,06:69E7,3E:618D,3E:626D,3E:6280,3E:630C,3E:631E,3E:65E3,48:4D4C,41:42D9,3F:41DC`.

Comma-separated lists: `a10/roots_live.txt` (live) and `a10/roots_dead.txt` (unreferenced).

Tracer notes:
- The 11 menu handler word tables `41:7317 GolfPauseMenuHandlerTable` ... `41:775B MiniGamePauseMenuHandlerTable` were
  renamed from `...MenuHandlers` so the tracer reads them as data.
- Bank 04 is not in CODE_BANKS (its exports are not seeded); its exports $48 (04:4EE0) and $5E (04:4588) have
  no caller and are therefore untraced.
- Banks 40 and 77: exports past 40:$06 and all of 77's are data (LZ assets), correctly untraced.
- Actor scripts (bytecode for 04:4234) can call native code (op $12 addr, in the script's bank); script data
  should be scanned for `12 lo hi` to find more such roots (only 04:527A parsed here).

##### Bank 0E: scorecard and standings screens

ShowScorecard (0E:43D6, export 0) picks two pages from ScorecardPageTable 0E:4422 by mode: c = 0 (wGameMode 1,
tournament): standings list 0E:5209 + stroke card 0E:6C7A; c = 1 (mode 2, match): 3E:403F + match card 0E:762F;
c = 2 ($C8D0 = $FF, one player): 0E:6C7A twice; c = 3 (two players): 3E:6361 + two-player card 0E:7199. A page
returns 0 for A/B/Start or 1 for Select (flip page); each page has a setup routine (LCD off, LZ tiles 0E:5480 /
0E:5E51, per-page LZ maps, palettes 0E:68E1, ScorecardLoadCommonGfx 0E:42F0, draw, MapDrawFullScreen 0B:4306) and
a frame task (Up/Down scroll via ScorecardScrollTask 0E:443A + sprites). Text is drawn into the WRAM3 tile map
(attributes WRAM2) by ScorecardPutTile/PutString/PutText/PutNumber (0E:447C-0E:4532); digits are 2-tile pairs
from 0E:454A.
- Standings (0E:5448): BuildStandings, copy of WRAM6 $D800 to $C600, DrawStandingsList 0E:53A6 (names rendered
  into tiles with BlitGlyphRows 0E:46CD); cursor on the player row $C482, blinking arrow when rank $C483 changed.
- Per-hole data: wP1HoleScores $C8AC / wP2HoleScores $C8EC (18 bytes: low nibble strokes, high nibble putts,
  cf. 10:4101). Par from 13:7044. Front/back nine split $C480/$C481 (ScorecardResetView 0E:4373).
- Match play card (0E:7850): per hole win/loss/halve marks (tiles $7E $7F $7D) with holes-up count in $C484 and
  text $120 "Up" / $122 "Down" / $121 "Even" (0E:7804).
- GetGolferName 0E:45E8: id 0/$FF player name, bit 7 = per-course list 0E:4633, else text $53 + id.
- Leftovers: 0E:44AE / 0E:44C8 / 0E:44E2 / 0E:45CD / 0E:7356 / 0E:6E50 are unreferenced helpers.
- Data: 0E:4008-0E:42EF tiles / templates, 0E:4706-0E:5208, 0E:5473-0E:6C79, 0E:6F00-0E:7198, 0E:73E2-0E:762E
  are LZ graphics and maps (pointers in the setup routines); 0E:7A59-7FFF is `$FF`.

##### Bank 0D: game mode select (film strip)

A copy of the course select film strip of bank 0F (0F:400B ...) used for the main mode menu. GameModeSelect
0D:4AA7 (export 0; callers 32:51D4 32:534E 3D:5CEB 58:5E7C 71:7517) gets the mode list from GetModeList 0D:707A:
Tournament 1 / Match Game 2 / Stroke 3 / Training 4 / Marion Clubhouse 9; only Stroke / Training when
wSaveSlot & $0F = $0F (no save); Match Game / Stroke with the versus descriptions ($7A + id: "Compete for holes
won!" / "...total score!") when wVersusMode $C33F is set. The start item is the current wGameMode (FindModeIndex
0D:70A9). Names: text $66 + id, descriptions $70 + id (DrawModeNameBox 0D:6FF7). Returns the mode id or $FF.
Routine-by-routine twin of 0F (ModeSelectNext/Prev = CourseSelectNext/Prev etc.); 0D:499A is an unused copy of
DrawCourseEmblem. Uses hSelectIndex/hSelectCount/hFilmTileSlot/wSelectIdList like 0F.

##### Bank 3F: golf dictionary

GolfDictionary 3F:4002 (export 0; map scripts 32:79F3 with a = 6, 33:4E29 with a = $C4BC - $0C) is the clubhouse
golf dictionary. Mode 0-4 shows one category (mask 1 terms / 2 rules / 4 equipment / 8 techniques / $10
facilities: texts $1A1E-$1A22 "Ask about golf ..."), 5 all categories with the category hint as answer, 6 the
whole dictionary from an A-Z index page (text $1A23 "View the entire dictionary here."). DictEntryTable 3F:5DFC
holds one category byte per entry, `$00` between first letters, `$40` at the end; entry names are text
$1A2B + n ("address", "against", ...), explanations $1AE7 + n. Pages: A-Z index (DictIndexInput 3F:5F73: 26
letters, 9 per row) and a 6-row list (DictListInput 3F:6017: A shows the explanation in a message window while the
host's face animates (DictFrameTask 3F:58DD), Left/Right jump between letter groups). RAM: WRAM6 $D609-$D61A
(wDict*). Leftover: 3F:41DC unreferenced scroll fragment.

##### Bank 04: map actors

Adds to REVERSE.md "Bank 04": ActorsUpdateTask 04:4234 runs each actor's bytecode script (+0..+2) through 20
opcodes (04:420C): $00 end, $01 n wait, $02 wait for walk end, $03 set pos, $04 walk to, $05 walk near point,
$06 walk by, $07 walk polar, $08 walk turn, $09 wander (random direction, home box +$18/+$19, obstacles), $0A
follow leader, $0B chase leader, $0C relative jump, $0D/$0E set/add field (sizes 04:4A31), $0F nop, $10 set anim,
$11 skip byte, $12 call native code, $13 set home. Handlers return a = 0 to yield. Then walking toward +$0A/+$0C
(PointNearPlayer 04:554D blocks walking into the player) and camera follow (+$16 = 1). ActorsDrawTask 04:4B69
draws/animates actors (frame lists: ActorAnimStep 04:4ACD; tile upload farcall 26:4012). The player's script
04:527A calls PlayerWalkControl 04:538C every frame: A/Start/B (run, flag #17), d-pad facing (04:5500), probes
(04:52FA, 04:5510), bumps ($C28C/$C443), events (CheckEventAtPoint 04:5360: type 1 trigger -> $C440, type 3 warp
-> $C441), grid snap when idle. RAM: $C284-$C288, $C29A/$C29C, $C28A-$C28E, $C2AB, $C442-$C444.
Unused: 04:40E9, exports $48 / $5E (04:4EE0, 04:4588), 04:4EF5.

##### Bank 40: title screen, attract demo, intro picture

TitleScreen 40:4032 (export 0): with a = 0 first the attract loop: IntroPicture 40:61CB (picture 40:4908, sound
$5E) then 16 DemoSlides (40:5C72, table 40:5D9F: duration / frame task / setup / picture; pans, window slide,
animated frames 40:5F11) with music $29; then the title (music $24, tasks 40:4D53 clouds / palette cycle /
animated tiles / SCY wobble and 40:4D1D press-start sprite) for $4B0 frames or until Start/A (or link byte $10).
**Cheat code** (TitleCheatInput 40:4CB6, sequence 40:4CF5): Up Up Down Up Left Right Left Right B A, twice,
sets hUnlockAll `hFFCF` = 1 (sound $63): all golfers and courses selectable (02:5A07 0F:4B7A ...).
Notable: IntroCheckSkip 40:6238 returns z in every case, so the intro picture cannot be skipped (DemoCheckSkip
40:6217 does skip); DemoSlide prints hVBlankCount, rDIV, the frame counter and Sqrt24 (40:5775) of them with
PrintHexByte every frame (debug leftover; Sqrt24 has no other caller). Unused demo tasks 40:5EFC, 40:61AA; dead
branch 40:5F7A. Other exports of bank 40 ($08-$30) are graphics data.

##### Bank 12: golf HUD (additions)

HudTask 12:449F (HUD frame task): player panels with the current player blinking, countdown sprites
(DrawCountdown 12:4F24 for the mini-game timer $C0F4-$C0F7), wind indicator, effect objects (12:6B04 / 12:6B11:
the water splash object at $CA80 with frame lists), swing meter cursors (12:456E). ShotLengthTask 12:4F07 draws the
running shot length (yards; feet with tenths for the putter, 12:4DE9). Dead: 12:416B, 12:4956 and the unreachable
branches 12:4BDC / 12:4C6A in HudDrawPlayer1/2.

##### Bank 06: name entry and character select (additions)

Frame tasks: NameEntryTask 06:51CC (cursor, blank-cell marks, animated tiles 06:41A0); character select
CharSelectCursorTask 06:65D9, CharSelectPaletteTask 06:6617 (cycling cursor colour), CharSelectBobSprite 06:66F6,
CharSelectDrawTrendMarks 06:6A4E (up to 4 marks left or right by roster byte +$11, sign = direction),
CharSelectPortraitAnimTask 06:6E4D (mini portrait blink frames per character, 06:6EFE). Dead: 06:69E7.

##### Bank 3E: match standings / two-player result (additions)

MatchStandingsTask 3E:465A (blinks the mark of the last hole's winner; reuses $D592 as a counter),
TwoPlayerScoreTask 3E:645C, BGMap9800Addr 3E:61CD. Dead helpers: 3E:618D (used only by dead 3E:6280), 3E:626D,
3E:6280, 3E:630C, 3E:631E, 3E:65E3.

##### Bank 48: EXP screen (additions)

ExpDrawCounters 48:4B05 (frame task: counted EXP $D632, points to next level $D642 / $D63C; skipped at level
$63), digit sprite helpers 48:4BD4 / 48:4C54, YesNoCursorTask 48:42F7, ExpCharSpriteTask 48:4336,
PictureAnimTiles 48:5EE9 (ShowPictureScreen). Dead: 48:4D4C.

##### Bank 41: level-up screen and pause / start menus (additions)

Level-up frame tasks: 41:4CD1, 41:4D2F, PointsBounceTask 41:4D79, SparkleTask 41:4DFC, 41:50B3, skill value
sprites 41:53B8, LevelUpBannerRevealTask 41:5694, DrawClockTask 41:587C (two 2-digit numbers $C831/$C830 or
$C0F3/$C0F2 with a colon blinking each second); LevelUpRestart 41:54CA (No on the confirm box).
Menus: every RunMenu handler is now named (41:7323-41:7767; texts $147F-$148A): Camera Mode (12:6D3D free look),
Course Map (farcall 17:437D), Scorecard (0E:43D6 or 3E:675C in Match Game), Settings (41:78C6: Music /
3-D Screen toggles of wOptionFlags $C818 bits 0/1), Give Up (refused on the 1st stroke, text $1491), Quit /
Save & Quit (SaveGame, $C814 + 1, $C2A6 = 1), Training wind direction / speed (41:72A1 / 41:72D8: wWindAngle
-/+ $10, wWindSpeed 0-$13), Mulligan menus (wMenuResult 0 / 2 / 3 / 4 / 5), start menu Char. Data / Stars /
Message speed (41:7969) / Save & Quit (41:79A7 warps to map 0 entrance 1, or entrance 2 for "return to Main Menu").
wMenuResult codes: $80 quit / $81 give up / $82 quit practice or mini-game / $FF stay. Dead: 41:42D9.

##### Bank 0B: map graphics, credits, results (additions)

MapGfxScrollTask 0B:4784 (the map frame task = MapScrollTask). CreditsWindowTask 0B:5640 (per-scene scroll from
0B:56C9, window rises). Result screens: ConfettiTask 0B:5DE1 (actors 2-7 swaying down, ConfettiActorStep
0B:5D2C; reuses $C3E0 / $C3F5), ResultBobActor 0B:652F, ResultPaletteCycleTask 0B:648F (reuses $C3F4),
ResultSpriteTask 0B:6694. **Debug leftover:** an unreferenced map graphics browser 0B:4776 (endless loop:
MapGfxBrowserInit 0B:4739 counts MapGfxTable entries, d-pad scrolls the map 0B:4788 / 0B:4826 with vectors
0B:47E6, B opens a paged menu of gfx screens 0B:4501), separate from DebugMapGfxViewer 0B:4579. Dead score helpers
0B:656F / 0B:6585 / 0B:65DE.

##### Bank 77: story pictures (additions)

StoryPictureAnimTask 77:7033 runs the frame script at $D347 (frame / duration; $FE n jump; $FF end) and draws
frames with DrawStoryPictureFrame 77:70D0 (LZ frame from 77:735E merged into the WRAM2/3 maps and queued to
$9880); StoryPictureTimerTask 77:70B6 counts wPictureTimer $D34D; StoryPicturePaletteTask 77:6F8E cycles BG
palette 6 colour 0 (table 77:6FD5) via SetPaletteColor 77:6FAE (writes wPalLive and wBGPalMaster).

##### RAM labelled

$C284-$C288 $C28A $C28C $C28E $C29A $C29C $C2AB $C33F (wVersusMode) $C442-$C444 $C482 $C483 $C818
(wOptionFlags) $C8AC $C8EC $D247-$D254 (title/demo, WRAM6) $D346 $D349 (story picture) $D609-$D61A
(dictionary, WRAM6) $FFCF (hUnlockAll). Many screens reuse golf WRAM6 / $C3xx-$C4xx addresses as scratch
(e.g. $D592 wCpuGreenEntry in 3E, $C3F4/$C3F5 palette-editor vars in 0B/77, $C470-$C474 in 04:5658), so existing
names there are misleading in those banks.

##### Bank 34: map scripts of the Field and the side places

Headers (table 34:4000): map 06 Locker Room (400E), 02 Field (4324), $27 Tiny-Tots Golf Grounds (5661),
$28 Mini-Mini Lake Course (5DA8), $29 Raven Woods (689C), $2C Golf Guru's Pitch and Putt (73C0), $30 Match Game
Event (7738). Map names are the debug banner texts $12C + map id.

- **Locker Room (06)**: ten locker objects (34:4218-4245) open the door tiles and show one of 16 random texts
  $082F-$083E (Map06OpenLocker 34:41E8); a golfer gets annoyed if talked to repeatedly (flags #224/#225, screen
  shake, 34:407F); the enter script swaps the talk list by tournament progress (flags #112-#115, #139; 34:42B6).
- **Field (02)**: door triggers 01-$0D are the warps to the clubs and places (warp ids: 1 Clubhouse, 2-4 Palm / Dune /
  Links offices, 5 Road to Peach's Castle, 6 Windy Valley, 7 Tiny-Tots, 8 Mini Lake, 9 Raven Woods, $0B Pitch and
  Putt, $0C Golf Clinic, $0D Club Maker's Hut; trigger $0A asks for warp $0A that the Field list lacks).
  While a club champ follows you for a Match Game (flags #144-#147, club in wScriptArg $C4BC) each trigger asks
  "Are you quitting this Match Game?" (34:5530); the Peach's Castle trigger asks "Taking on Mario?" (34:544D).
  - **Peach's letter**: with flag #139 (Links Club won; Grand Champion) the trigger $0F at the tree blocking the
    path (object $0F "A large tree blocks the path") plays a sparkle (palette cycling 34:52C0), a falling-letter
    sprite (34:512E) and warps to map $25 "Terop" entrance 2, which shows "A letter is falling from the sky." /
    Peach's invitation and sets flag #123 + save flag $1E0 (35:79D2). Back at Field entrance $0F (34:5019) sprites
    fly in and burst, then flag #125 is set and 34:46E6 rewrites terrain / event / tile rects: the path to Peach's
    Castle is open; a marker sprite stays at map ($1300 $1080) (frame task 34:46DF). Entrance $0E (34:5218) sets
    #139 directly (debug / test entry?).
  - Map edits on entry also depend on flags #80-#86 (34:4769, stops at the first set flag), #114 -> #124 (34:4733),
    #198 + #114 -> #212 (34:5598). Flag #99 (the EXP bonus flag) is cleared on every Field entry.
- **Tiny-Tots (27)**: the caretaker's favor ("Can you do me a favor?"): a demo round (mode 6), then a timed round
  (mode $0B, countdown 12:4F52, hook 34:5C61) putting the balls into the circle; result by balls in $C3E1 (8+ good,
  10 = "You could manage this place!"); first success: flag #202, EXP 50 (+25% for 10) and save (34:5A99).
- **Mini-Mini Lake (28)**: trigger $0F plays the Mini-Mini Lake course (course $0A). The "unplayable" story: a
  golfer (golfer $4F) dunks his shot from the rough; you take the same shot (34:64B1); "NICE ON!" makes him try again
  and succeed; results set flags #218 / #210 and give 140 EXP (34:6586). Flags #211, #224 track the steps.
- **Raven Woods (29)**: a crow steals a golfer's hat and sits on the pin (flags #204-#207); "Play from here?" (A held
  on the trigger, 34:7144) starts a round from the player's spot with random wind (34:716B, wStoryRoundKind $14);
  hitting the pin scares the crow: hat back, 200 EXP (+25% with flag #99), flag #207, save (34:6D46 / 6E5F).
- **Pitch and Putt (2C)**: the Golf Guru's 9-hole challenge "get on in 1 and sink with 1 putt on each hole"
  (course 9; after beating it course 6). Results read wP1HoleScores $C8AC (per hole: low nibble strokes, high
  nibble strokes to the green) and $C8BE; misses set #241 (not on in one) / #240 (not one putt); a perfect round
  gives 300 EXP, flags #208 #159 and save flag $200 (34:765D tail). #252 = "equaled Mario" speech seen.
- **Match Game Event (30)**: after a Match Game against a club champ (entrance = club): lost -> back to the club;
  won -> flag #188, the club's room is drawn (34:7CED) and the beaten champ's scene runs (texts $15C6+ or $15D9+
  when #139); flag #127 -> #189. Entrances >= $0C set #80-#86 and count as a win (test entry).
- **Hidden rivals**: the other three playable characters hide on maps (object $0F): Sherry in Tiny-Tots (flag #141,
  34:56F7), Joe in Raven Woods (#143, 34:692C); Kid / Azalea (#140 / #142) are elsewhere. When the three others
  are found AwardFoundAllRivalsExp (34:7E12) gives 300 EXP and reloads the map in place (warp $FA).
- RAM: wP1HoleScores $C8AC is new; $C3E0-$C3E3 are reused as scratch by these scripts (already labelled
  by bank 2B's use); wStoryRoundKind $C967 is $0A / $14 for the rounds started here.
- Data: actor scripts (bytecode for 04:4234) at 34:55A6, 6D2D and the crow block 34:70FC-7133; sprite tiles 34:4890,
  4950, 6F40, 7290; palettes 34:4F9C, 4FAC, 5250-5268, 7009.

##### Bank 35: Trophy Room, ending maps and the test rooms

Headers (35:4000): 07 Trophy Room, $31-$3E the ending ("End ..." banners), 01 Development room, $24
Mini-Character Test, $25 Terop (captions).

- **Trophy Room (07)**: 15 trophy actors (spawn table 35:4032) placed by flags #112-#116 (placed in the Marion /
  Palm / Dune / Links / Peach's Castle tournament) and #136-#139 / #117 (won it) (35:41B2). Objects 01-05 describe
  the trophy: win -> $083F/$0840, else place 2 or 3 from TestCourseHoleBit(club $16) with $0841/$0843 (35:4345).
  So #136-#139 = club tournament won and #139 (Links) is the Grand Champion step that unlocks Peach's letter.
- **Ending maps ($31-$3E)**: wordless replays driven by EndingSequence 0A:56B1: Director's Room first-day scene
  (31), Lounge with a pointer sprite (32), caddie office (33), award ceremony (34: "A new champion has appeared"),
  Tiny-Tots (35, Sherry variant), Raven Woods (36, crow / Joe), the Dune alternate-game pair (37), Match Game Event
  (38), Field letter event (39: a copy of 34:4FB4-5400 at 35:65D4-69DB), Clouds (3A), Azalea (3B), Peach's Castle
  (3C; its warp leads to itself), walks through the clubhouse (3D) and the Field (3E).
- **Development room (01)**: each talk target warps to a test destination or runs a screen: TwoPlayerScoreScreen,
  DebugSaveViewer, Stars / Stats / Ranking screens, a sepia fade test, the Mini-Character Test (35:7735-77BC).
- **Mini-Character Test (24)**: talk 02 / 03 cycle the player's sprite (wTestSprite $C3F0 of wTestSpriteCount
  $C3F1 from 04:4F0A; applied by 04:4D3D), talk 04 / 05 play anims 3 / 4, the d-pad plays anim 1.
- **Terop (25)**: entrance 1 shows the caption "Marion Club Director's Office" (story opening) and warps to map 05;
  entrances 2 / 3 show Peach's falling letter and set flag #123 (35:79D2).
- Notable:
  - The ending maps' object list pointer points at a `ret` byte ($C9) instead of a $FF list end, so map_scripts.py
    (and the tracer that takes its roots) reads junk records there. 40 junk roots in bank 35 (e.g. 35:4004, 4040,
    41EA, 4700-4709, 48F9, 6000, 7957) are data, list bytes or middles of instructions; they are labelled with
    `...Data` names. 35:48F9 and 35:7B21 are actor-script bytecode, 35:6000 sits in sprite tiles 35:5F70.
  - Map 37 (35:5A0B): "Which rules? Match Game or Stroke?" loads the menu text and position but the ScriptRunMenu
    call was removed; it always answers "OK! Stroke rules!".
  - Leftovers: Map01EnterNop 35:7847 has an unreachable farcall 79:68B1 after its `ret`; map 33 and map 34 scenes test
    wMapId 8 / $18-$1B (values of the real office and ceremony maps), never true there; four talk scripts at
    35:4604-4622 (texts $0466-$0475, via 35:45D2) are not referenced by any list.

Labels: `a11/labels.csv`, 207 lines: 193 code and data labels and 14 RAM labels. I checked them against a scratch copy of the
project with the labels merged in: `coverage.py --list` then shows no unnamed entries in banks 30 31 33 34 35 79 17 26 4A 3B
44 4F 15 09 07 08 0A 00. Only 0C:6438 is left, and it is a false entry (see the end of these notes).

##### Golf event hooks (banks 30 31 33 34)

How it works: SetGolfEventHook (10:4BC7) stores a bank and a table of 16 words. CallGolfEventHook (10:4CC3) calls entry
`a` of that table when the word is not zero. There are five event numbers, each called from a fixed place:
0 = before each shot (10:484C); 1 = after each shot (10:4611, right after RoundHookAfterShot);
**2 = the hole maps of a view were just loaded (13:43F6, after HoleLoadMaps in LoadShotView)** (new);
3 = hole start (10:45CD); 4 = scene start (10:4237 GolfSceneStart, 08:646E).
A handler ends the shot loop with SetGolfEventFlag (`$D4DD`, read by 10:461A):
- bit 7 set (`$80` or `$82`): the round ends (jump to 10:464A).
- any other non-zero value (always `1` here): RetryShotRestore 08:4AA3, which replays the same shot.
In lesson and practice rounds, wGameMode = 0 at event 1 means the player quit (10:4877 clears it). The handlers then
set the return entrance `$C961` (6/7 in bank 30, 8/9 in bank 31), which sends you back to the coach's "retry" entrance.

Hook tables found in this pass (the earlier pass had labelled only part of them):

| Table | Started by | Entries |
|---|---|---|
| 30:6C0F PuttingChallengeHookTable | green pros, 30:6799 | 0 6C2F / 1 6C58 |
| 33:736F Map26TargetShotHookTable | Map26AskTargetShot | 0 738F / 1 7390 |
| 34:58E6 Map27DemoRoundHookTable | Map27Enter 34:58C7 | 0 5906 / 1 5907 |
| 34:5C61 Map27CleanupHookTable | Map27StartBallCleanup | 0 5C81 / 1 5C82 / **2 5D40** / 3 Map27SetupTimer |
| 34:5F93 / 6299 / 6507 | Map28 golfer shot / golfer retry / player shot | 0 ret / 1 handler |
| 34:71CC Map29PinShotHookTable | Map29StartPinShot | 0 71EC / 1 71ED / **4 Map29PinShotSceneStart 65C3** |
| 34:75C8 Map2CRoundHookTable | Map2CStartRound | 0 75E8 / 1 75E9 |
| 30:7361 AltShotStartRoundHookTable | AltShotStartRound | 0 73B5 / 1 73C7 / **3 AltShotHoleStartGolfers 7381** |

Lesson handler pattern (16 lessons x demo / attempt). For each lesson I named the handlers
`MapXX<Lesson>{Demo|Try}{ShotSetup|AfterShot}`:
- **Demo ShotSetup**: the coach explains the shot (3-4 texts via ShowMessageAt 05:5E70, speaker 3 or 4).
- **Demo AfterShot**: `$82`, so the round ends after one shot.
- **Try ShotSetup**: "choose an approach / a club / shoot".
- **Try AfterShot**: sets wEventResult `$C968` and flag #99 = wP1HoledOut `$C8AA`, then `$82`.
  - Bank 30 (approach ranges): wEventResult is BallWithinPinDist `$60` (0 = success).
  - Bank 31 (driving ranges): wEventResult comes from a per-lesson judge routine, `Map..JudgeShot`:
    - 0 = success.
    - The other codes come from the ball's lie (BallLieTerrain: 0 fairway, 2 bunker, 6 green), PinDist `$A0`, the stroke
      record at `$D680`, and the ball's final position.
  - Stroke record fields used: +8 club, +9 (power shot?), +`$0A` power (`$3C` = perfect), +`$0B` impact offset,
    +`$0C` bits 4-5 = curve input, +`$0C` bit 7 = backspin.
  - Map13 backspin and Map16 mound (30:541D / 5C80) store stroke record +`$0C` (not the club) in wEventShotClub.
    Their result scripts test its bit 7 (backspin texts `$0CE2` / `$0D00`).
- Links contests:
  - Approach (30:6052 / 605C, 6243 / 624D): wEventShotClub `$C969` is reused as the try counter. Event 0 copies it into
    wP1Strokes `$C8A0` for the HUD. Each try is replayed with flag 1; after 10 tries the round ends, and #98 is set
    for 7 or more.
  - Driving range (31:697D / 6A02, 6D33 / 6DB8): PinDist words go to `$C968` (coach) and `$C96A` (player).
  - Every Map15 handler calls Map15UnlockContests first.
- Free practice (30:48DD, 31:52B7, 30:6BFC): the shot repeats (flag 1) until you quit.
- Putting challenge (30:6C58): `$C3E0` counts putts and wPuttChallengeScore counts putts made (within `$34`). GolfRound
  is started with 5 holes:
  - Odd putts are retried from the same spot.
  - Even putts set wP1HoledOut and SetP1StartStrokes = putts, which moves on to the next hole.
  - After 10 putts the round ends.
  The rules text `$10D5` is shown once, guarded by temp flag #224.
- Clinic (31:75E1): #99 is set whenever the player did not quit, so it means "shot taken" here, not "holed".

Bank 34 hook handlers:
- Tiny-Tots ball cleanup (34:5C82):
  - Every shot sets flag #224 + wHoleNumber.
  - A ball within `$3C` of the pin is "in".
  - If the ball lands in water or out of bounds (wShotEndLie `$D4DC` 3 / 7), or the countdown `$C0F6` reaches 0, the
    caretaker scolds you and takes that ball himself.
  - Event 2 (34:5D40) reapplies the removed ball piles to the hole maps through ApplyFlaggedHoleMapEdits 34:55B6.
    That routine takes lists of {flag, src, dst, w h} records and copies rects in the WRAM3 / WRAM2 64x64 maps.
- Mini-Mini Lake (34:6528): `$C3E0` = on the green or holed; `$C3E1` = the ball skipped on water (wBallFlags bit 0).
  Map28ShotResult 34:6568 then picks: failed / "NICE ON!" / on the green.
- Raven Woods (34:65C3, event 4): unless #206, loads crow tiles and starts Map29CrowOnPinTask 34:66A0, which draws the
  crow on the cup in the green view. The pin-shot hook 34:71ED counts a pin hit (wBallFlags bit 1 or 2).
- Golf Guru (34:75E9): only resets wStoryRoundKind when you quit.

Also named in bank 34 (code that was reached by jumps and not labelled):
- Map28AfterGolferShot 34:5FBE (entrance 5)
- Map28GolferSucceeds 34:62C0 (entrance `$0D`)
- Map28HoleOutAndLeave 34:6362 (entrance `$0F`; sets #210, saves)
- Map28WalkOff 34:6412 (entrance `$0E`)
- Map28ShotResult 34:6568 (entrance 6)

35:4666 is the frame task wrapper of Map32PointerSpriteTask (Lounge tour).

Copies: BallWithinPinDist exists in banks 30 (7E2E), 31 (7D53), 33 (7C72) and 34 (7D93). The bank 31/33/34 copies are
labelled with a `_bank` suffix.

Notable:
- Quirks in the lesson hooks:
  - 30:4607 (Marion chip demo) sets #99 when the coach holes the ball; no other demo hook does.
  - 31:6A02 runs the #99 update twice on the lesson path; it is harmless.
  - 31:5F52 is the only demo hook without GolfViewExit.
- Dead code: 31:582D-583C in Map0FIntentionalShotJudgeShot is an x test (`$1C80`) that nothing jumps to.
- Never read: PuttingChallengeSetTextCourse 30:6E41 stores `a` to `$C3EA`, and nothing reads it.
- Text grouping: PuttingChallengeSetOfferText 30:6DF6 groups the putting challenge offer texts by the furthest course
  reached (#112-115) and whether its club was won (#136-139).
- Reused labels:
  - wScriptLoop `$C3E0` and wPuttChallengeScore `$C3E1` are general scratch counters in several minigames: the Map26
    target, Map27 ball count, Map28 / Map29 results and the putting challenge.
  - wEventShotClub `$C969` is reused as the contest try counter.

##### Bank 17: course map screen (pause menu "Course Map")

Exports:
- `$00` CourseMapScreen 17:437D (called by MenuShowCourseMap 41:7882).
- `$02` CourseMapShowTimed 17:4232: 300 frames or a button. No caller found.
- The `$04` word (`$4021`) is not an export. It is the operand of the code at 17:4004 (CourseMapRecordAddr:
  `ld hl,$C640 ; ret`), which sits inside the `$4000` table.

How CourseMapInit (17:4250) builds the screen:
1. It saves the view in `$C471`, sets view 3 and reloads the overhead hole maps (CourseMapReloadHoleMaps 17:41F5).
2. It copies the hole's course-map record to `$C640` (CopyHoleRecord 44:7E74). The record holds:
   - a 16x16 nibble grid (each cell = a 4x4-tile block);
   - the count of detailed blocks;
   - a `$FF`-ended list of overlay blocks.
3. CourseMapBuildTilemap 17:4512 turns the grid into the `$DE00` map. Nibble `$F` takes the next "detailed" tile; any
   other value is a fixed tile.
4. For each detailed block (CourseMapRenderBlockTile 17:45C8), it reads the 4x4 hole tiles (attribute WRAM2, tile WRAM3,
   terrain WRAM6 `$D800`, with x/y flips) to get 2x2 terrain cells per tile. It maps them to colours through a 16-byte
   table (17:4490 for the background, 17:44A0 for the sprites; copied to `$C400`). Then it packs them into a 2bpp tile
   (17:45E5).
5. Overlay blocks (17:4628) are rendered as 8x16 sprite tiles and drawn every frame (17:4652).

Other parts of the screen:
- Side panel (17:47C0): hole info, distance, wind and wind arrow, player face icons.
- Frame task (17:43AC): wind indicator, blinking current-player tile (17:4DD0), target marker, balls and flag (17:43F3).
- Input (CourseMapInput 17:4E14): B = shot mode / spin, Up/Down = club, Left/Right = aim (wLaunchDir). The course map is
  therefore also an aiming view.

Notable (debug leftovers):
- 17:4512 plays sound `$01` when the detailed-tile count differs from the record or reaches `$C0`.
- 17:4652 plays sound `$02` when the sprite queue is full.
- CourseMapInit counts load frames in wLoadFrameCount `$C3B6` (task 17:43A7) and prints the count with PrintDecimalByte
  at 17:436F. Bank 15 has the same counter (15:47B8) and discards the value (15:4787). Both look like profiling code.

##### Bank 79: ending final screen sprites

Exports:
- `$08` EndingFinalSpritesInit 79:688C, called from EndingFinalScreen 0A:67FF.
- `$0A` EndingFinalSpritesTask 79:68B1, called every frame from 0A:6806.

The task keeps a step counter in WRAM6 `$D400` (the wBallX address reused). The step goes up every 4th frame, from 0 to
`$36`. Six parts (79:68F6 ... 79:7175) each animate one sprite group through 9 steps (steps 0-8, 9-`$11`, ... `$2D`-`$35`):
- each step decompresses that frame's tiles to VRAM `$8000` / `$8040` / `$8080` / `$80C0` / `$80E0` / `$8100`;
- and draws its template at x `$FE` / `$0E` / `$1E` / `$2E` / `$36` / `$3E`, y `$80`.

The task also prints the step with PrintDecimalByte at (3, `$0F`), which looks like a debug leftover.
Map01EnterNop 35:7848 holds an unreachable far call to the task (already noted).

##### Bank 26 (and 20-25): actor sprite graphics

26:4012 ActorCopyFrameTiles (export 0; called from 04:4CB3 / 4D03 / 579C):
- It switches the ROM bank to wActorBank and keeps running at the same address, so the same 33 bytes sit at `$4012` in
  banks 20-26.
- It reads word [hl + 2c] + b and queues 4 tile blocks to VRAM de.

##### Stragglers

- **4A:6C1F** LoadLinkWaitPicture (export 6; 32:5318 / 5371 / 53DE, the link host / guest handshake loops): an animated
  full-screen picture. The task 4A:6CA2 cycles 12 frames of 4 tiles from 4A:7650 through `$C0F8`.
- **3B:4433** CaptionMotionTask (task of ShowCaption):
  - It runs a script of 4-byte steps from `$D335`: step routine `$D340`, keep flag `$D342`, frames `$D343`.
  - It moves the caption by velocity (`$D33C` / `$D33E`) and draws CaptionTemplateTable 3B:44DA[`$D344`].
  - When wCaptionActive runs out, it stops and shows the HUD again. The new RAM labels are listed in the CSV.
- **44:4292** PalEditorSpriteTask: cursor and label sprites of DebugPaletteEditor.
- **4F:62A7 / 62B4** CaptionAnimTask / CaptionObjStep: the frame / delay script of wCaptionObj `$CAA0`. Each frame is
  12 tiles plus template 4F:6312.
- **15:47AD** BehindViewTask → DrawFlagSprite 15:4DEC; 15:47B8 is the load-frame counter task.
- **07:7DB0 / 09:4990** MenuBobSpriteTask (and the bank 09 copy): a decoration sprite bobbing by hVBlankCount.
- **08:4244** SetContestLeader.
- **08:437C / 4391 / 439E / 43AB**: the near-pin / drive contest leader's sprite (P1 tile `$5C`, P2 `$6C`), shown while
  the contest captions `$20` / `$22` are up.
- **0A:72AD** NavCopyListAttrRows (WRAM1 `$D480` → VRAM1 `$9880`).
- **00:2B98** ApplyMusicOption: the Settings music toggle. Music off sends sound command 0; music on replays
  wCurrentBGM.

##### False entries (not labelled)

- **0C:6438** (73 bytes). The "callers" 0C:43F6 and 0C:46E6 decode `cc 38 64` as `call z,$6438`, but they are inside
  RecordsAnimTileFramesData 0C:43E0 (tile graphics). 0C:6438 is the middle of CopyWinnersGridCells 0C:6410.
- **0D:6746** (the far call into bank 17 named in the task) is misaligned data: `d7 10 17` inside graphics at
  0D:6740+. Its rst `$10` would read word 17:4010 = `$0160`, so it does not reach any bank 17 routine.
- **17:4021** (export word `$04`) points into code (the operand of 17:4004), not to a routine.

##### RAM added

`$C8A0` wP1Strokes, `$C8AA` wP1HoledOut, `$D4DC` wShotEndLie (stored at 10:4AA1), `$C3B6` wLoadFrameCount, `$C3EA`
wPuttOfferCourse (never read), `$D335`-`$D344` caption motion fields (wCaptionScript / X / Y / VX / VY / StepFunc /
StepKeep / StepFrames / Sprite).

##### Tracer issues (entries that are not code; not labelled)

- **10:6DCD** is data: 4 words (10:6DD5 / 6E13 / 6E51 / 6E51) picked by `$D32B & 3` in PowerScaleLookup 10:6DAE,
  which then reads word `[wSwingPower & $FE]` of that table and returns (ends in `ret`, no `jp hl`). The entry most
  likely comes from the `ld hl, imm` heuristic (looks_like_routine) on `ld hl, $6dcd` at 10:6DB4: the bytes
  `d5 6d 13 6e ...` start with an opener (`push de`). Fix: mark 10:6DCD (and 6DD5-6E8F) as data.
- **02:6109** is data: the 17 x 20 spaces string printed by ClearDebugLines 02:60F0 (`ld hl, $6109` at 02:60F8).
  `$20` (jr nz) is in OPENERS, so looks_like_routine accepted it. Fix: mark 02:6109 as data (e.g. label it
  `DebugBlankLinesData`).
- All other listed entries are real code. Some have no reference at all (dead code, see below): 08:4F82, 10:77CC,
  31:4A4E / 53F6 / 5D12 / 65A0, 05:6108 (skipped by a `jr`).

##### Bank 08: per-mode round hooks (DispatchByGameMode tables)

Every RoundHook* export calls DispatchByGameMode 08:470D with a 16-word table by wGameMode `$C834`. Modes: 1
Tournament, 2 Match Game, 3 Stroke, 4 Training, 5 / `$0A` / `$0B` mini-games, 6 / `$0C` practice and lessons, 7
putting practice.

| Hook (table) | 1 | 2 | 3 | 4 | other |
|---|---|---|---|---|---|
| RoundStart (473F) | 475F | 478C | 47A6 | - | - |
| SaveAtHole (47D1) | 47F1 | 47F5 | 47F9 | - | - |
| HoleStart (481A) | 483A (ret) | 4847 | 483B | - | - |
| PlayerUp (489D) | 48FD | 48BD | 48FD | 48EB | 6/7/C 48F4, A 48FD |
| AfterShot (491E) | 493E | 494B | 4942 | 4A39 | - |
| HoleEnd (4B1F) | 4B3F | 4B64 | 4B93 | - | - |
| RoundEnd (4BD9) | 4BF9 | 4D7D | 4EBF | 4EF2 (ret) | 5/A/B 4EF3 (ret) |
| PauseMenu (4695) | 46B5 | 46C6 | 46B5 | 46D7 | 5/A/B 46DE, 6/C 46E2, 7 46EF |

- Tournament (mode 1) round end 4BF9: rank -> wRoundResult; the first top-3 finish per course (course-hole bit
  `$14 + rank`) gives SetRankExpBonus (RankExpBonusTable 08:4D3D: course 1 40/20/10 ... course 5 400/200/100);
  TournamentReturnMapTable 08:4C6E sends courses 1-4 to the ceremony maps `$18-$1B` (entrance 2/3/4 = place) and
  course 5 to map `$1D` entrance 6, wStoryRoundKind `$32`; flags #112-#116 (played) and #136-#139 / #117 (won).
- Match (mode 2) round end 4D7D: beating opponent 4-`$0A` the first time: AwardFirstWinBonus (game flags
  `$0A00-$0B80`, bonus kinds `$14-$1A`, EXP 40 70 140 200 400 50 400) and save flags `$80-$140`; opponent 7 also
  sets the return map `$30` entrance 5 unless #188. Losing to 4-7 sets #132-#135.
- Training (mode 4) after-shot 4A39: continue menu result 2 retry (RetryShotRestore) / 3 replay the hole (hole -1,
  holes left +1) / 4 / 5 end the round (wRoundResult 1 / 0). 08:4A4D `cp 2 ; jr nz, +0` is a no-op leftover.
- PauseMenuDebugEditors 46F3: with hDebugMode, Select held opens DebugPointsEditor 41:77EA and Up held
  DebugPaletteEditor 44:42FB after the pause menu (modes 1-4).
- Dead code: CopyMapRowsToScreenUnused 08:4F82 (no caller): sets wHoled `$FF` and copies 8 map rows from the WRAM2
  / WRAM3 buffers at `$D100` to `$9880`.
- RAM: wP2Character `$C8D0` (`$FF` = one player), wP1ScoreVsPar `$C8BE` / wP2ScoreVsPar `$C8FE`, wPlayerRank
  `$C875`, wStandingsPhase `$C4BD`, wReturnEntrance `$C961`. `$C8A8` (P1 +`$28`) is set to `$0F` before each shot
  in modes 4 6 7 `$0C` (meaning unknown).

##### Bank 11: ball display objects (course / green / cup views)

BallDisplayTask 11:4113 jumps through BallDisplayViewTable 11:412C by wOnGreen: 0 BallDisplayCourseView 4361, 1
BallDisplayGreenView 4970, 2 BallDisplayCupView 4CBB, 3 InitBallCamera, 4-6 BallView4, 7 nothing. Course and green
views run CameraStep, PreviewFrame and the look cursor, then DrawSortedBallObjects 11:4D79: up to 6 objects enabled
by wBallObjectFlags `$D485` bits 0-5 (1 pin, 2 target marker, 3 ball, 4 aim arrow, 5 preview spot, 6 other ball)
are listed with their y at `$D468` and drawn from the largest y down (so nearer objects get the lower OAM slots)
through the handler table in `$D47E` (CourseViewObjectHandlerTable 4375 / GreenViewObjectHandlerTable 4984). The
course view uses scroll-relative coordinates / 8 (ball hidden every other frame under tree tiles when it is lower
than the canopy); the green view is relative to wGreenCornerX/Y. The cup view (4CBB) draws the ball, its shadow and
the pin (CupViewDrawPin 4D61) around a fixed cup, ordered by y. LookCursorBob 4C69 bobs the 16x16 cursor with
LookCursorBobTable 4C7B. ShowCaptionAndWait clears bits 1 and 4 of `$D485` (marker and preview) during captions.

##### Bank 02 (debug save viewer pages)

DebugSaveViewerPage 02:5DCE uses DebugSaveViewerPageTable 5DDF: pages 0-5 DebugSavePageRecord (record b of `$32`
bytes at `$D000`), 6 the same with "ALL", 7 bytes at `$D15E`, 8 word pairs at `$D166`, 9 `$D400-$D408`. Field
printers 608E-60CF (a = offset into bc). Scores are shown minus `$36`, "  -" when 0.

##### Bank 31 (golf clinic coach comments; leftovers)

- Golf Clinic (map 2D): ClinicClassifyShot gives class 0-8 (0 a clean full shot; 1 wavering impact; 2 below full
  power; 3 both; 4 neither; 5 hook; 6 slice; 7 topspin; 8 backspin). Coach 1 has one comment per class
  (texts `$15BC-$15C4`); coach 2 rejects classes 1-4 (`$15C0`) and 5-8 (`$15C5`). For class 0 both build a sentence
  from five pushed strings: coach 1 (`$15BA`) distance grade (ClinicGradeDistance 756A on ClubDistance) / shape
  (DriverShape) / height / meet area / waver; coach 2 (`$15BB`) carry / control / wind / timing / aim. The three
  last parts come from the character stats `$C81C`, `$C81E`, `$C81F` (value -4..4 -> text index 4 - v).
- Leftovers: 31:4A4E (talk script for the shot-terms tip `$0D1B` with a Yes/No prompt) and 31:53F6 / 5D12 / 65A0
  (plus the copies after them at 4A7F / 5402 / 5D1E / 65AC) show the placeholder text `$0D16` "Lesson character."
  None is referenced by a map list.

##### Bank 3B (OutcomeRules by terrain)

OutcomeRules 3B:7260 jumps through OutcomeByTerrainTable 72A3 by the landing terrain: 0/`$E` fairway 7541, 1/`$F`
rough 756B, 2 bunker 7529, 3 water 7426 (CountStroke, DropAtSafeSpot), 5 7590, 6 green 7447, 7 out of bounds 7411
(CountStroke, a = `$FF`), 9 semi-rough 757F, `$A` 7555, `$C` 75A1, `$D` 75B2, 4/8/`$B` no caption. Each shows a
caption animation (StartCaptionAnim 4F:619C, often wLie-based) and a caption. OutcomeGreen gives the first-on-green
bonuses (+4 with wBallFlags bit 1, +2 with three strokes to spare against par, +2 with two to spare and within $21 of the pin). Mode 6 (OutcomeMode6 75CE) uses its own
table 75E2 (green -> OutcomeMode6Green 7639, no bonuses, no points); modes 5 and `$0B` (OutcomeMode5B 75CC) do
nothing. The meanings of terrains 5 `$A` `$C` `$D` are not known (captions are sprites).

##### Banks 4A-4E (behind-view scenery, copies of bank 4F)

Each holds export 0 ComposeObjectPicture and its helpers, byte-for-byte the code of 4F:5645-6183 with its own data
(LZ base sheet, palettes, shape records). DrawBehindViewScenery 15:462D picks the bank with SceneryByCourseTable
15:463F: 4B Marion (courses 0 1 8 `$A-$F`), 4C Palm (2), 4D Dune (3), 4E Links (4), 4F course 5, 4A Pitch and Putt
(6 and 9); course 7 by hole (SceneryCourse7HoleTable 15:465F: holes 1-2 4E, 3-6 4F, 7-9 4B, 10-12 4C, 13-15 4D,
16-18 4E).

##### Bank 15 / 10 / 05 small entries

- 15:467F-4697: one farcall per scenery bank (SceneryMarion ... SceneryPitchAndPutt, SceneryCourse7ByHole).
- 10:6D8A-6DAA: SpeedTableJump targets: farcall the distance -> launch speed routine of trajectory class -4..+4
  (banks 39 / 38 / 3A). PowerScaleLookup 10:6DAE (see the tracer note). ReflectScaleUnused 10:77CC has no caller
  (an alternative of Reflect 10:771E: scales the contact normal `$D4A1/$D4A3` by the velocity over the length of
  reflected - velocity).
- 05:6B76-6B88: the four DebugMenu items (Scene / Map / Palette / Flag). 05:6108 CloseMessageBoxShrinkLoop is the
  shrink animation of CloseMessageBoxAnimated, skipped by its `jr` at 05:6106 (also contains odd register
  arithmetic at 05:6130, never run).

All 76 entries from `coverage.py --list` are named (plus 4 extra code labels, 1 data table, 3 RAM labels: 80 lines).
No entry turned out to be data decoded as code. One entry is code that cannot be a routine start (40:5941, below).

##### Bank 32 (map scripts: maps 1F 20 21 22 00 03 04 05)
New entries come from the runtime-patched talk lists (ScriptSetMapField +$0C), as the tracer now follows them.
- **Map 03 Marion Clubhouse**: lists 32:5853 / 5928 / 59C7 / 5A4C / 5B09 by tournament progress
  #112 / #113 / #114 / #115 placed (Marion Palm Dune Links) and #139 (Links won). Each list has member (talk 02)
  and visitor (talk 03) counter scripts: with a partner (flags #144-147) texts $1D1+n / $1DB+n, else a comment
  on the latest club result (placed vs won flag #136-#139). A fan (talk 0A, 32:5817-5844) cheers by club
  (texts placed / won / match game with partner via 32:57F5). Quizzes: dogleg (32:57BD) and "did you really
  beat the Grand Champ?" (32:5AD1). The five doors: each has an "open frame" and a 4-frame close routine
  (32:5F4E-628A) passed in hl / de to Map03WalkOutOfDoor 32:5D94 (entrances 3-7).
- Possible slip: 32:59A0 and 32:5A18 are talk 02 scripts but pass speaker 3 to ScriptShowText (the visitor
  counter actor), while every other talk 02 uses 2.
- **Map 04 Lounge**: lists 32:649E-65C2 (same flags). Talk 02 (32:6425-6443) asks "Got a second?" (32:63F3).
  After #139 the champs speak through 32:6667-66C4: Marion uses flag #80; the others ChampFlagPairCheck 32:6E9F
  (flag #78+2n set and #80+2n clear; these are the rival pair flags #80-#93 of VsResultScreen 0C:665A, so
  probably "already played / not beaten" in Match Games ?). The Links champ's "I've failed" speech is once
  (sets #148).
- **Map 05 Director's Room**: Caddie Master (talk 04) comments on Palm / Dune / Links placings
  (32:6FB8 6FC7 6FD6), skipping to the "as champ" line when a club was won (32:6F98, which also sets the
  course name for text code $0B).
- Debug leftover: 32:4ABD (unreferenced, never returns) is a window test: "Tournament" title, menu $11F
  (Hole in One / Eagle / Birdie / Par / Bogey), names Ken / Kid pushed as text args, text $16B redrawn in
  window 1 forever. Looks like an early version of Map20EnterResultTests.

##### Bank 33 (map scripts: Caddie Master offices 08-0B, 1C, 1D, 26, 2E/2F)
- **Map 08 (Marion) gets its own talk list 33:4389** (Map08EnterCaddieMasterOffice: maps 09-0B patch the warps
  list, map 08 and anything else patches the talk list at 33:483B, after a useless `cp $08`). It holds six golf
  tutors (talk 0C-11, 33:42AB-4305): each sets wScriptTextBase ($857 $85E $865 $86C $873 $87A) and
  wScriptArg = talk id, then Map08TutorAskDictionary 33:4DFF asks Yes/No and on Yes opens GolfDictionary 3F:4002
  with mode arg-$0C (terms / rules / equipment / techniques / facilities / all), then reloads the map in place
  (warp $FA with wPlayerPosSave copied to the entrance position $C465-$C469). Talk 0B (33:435F) tells the points
  to the next level (or "level's high enough" at 99).
- 33:5166 is the Caddie Master's round menu (text $892: Club Tournament / Practice Round / Quit); tournament
  needs #227 (qualified), practice sets #224 and #119.
- Dead code: 33:4929-4ABA is an older Caddie Master dialog reachable by nothing (the live path at 33:4916
  jumps to 5166 / 4D97 / 4D25); its tail 4ABB is live (partner match). 33:4BA7 places actors 2-5 and falls into
  Map08TriggerCallOver (no ret, no callers). 33:4C59 is a byte copy of Map08WalkOutAnim. 33:4E49 is an unused
  "Keep checking?" ($87D) step for the dictionary. 33:7CC3 is a third copy of AwardExpWithBonus (30:7E7F).

##### Bank 34 (map scripts: maps 06 02 27 28 29 2C 30)
- 34:5BC7 (unreferenced): SetForcedTee at one of 10 spots by $C3E0 (balls already cleared) for the Tiny-Tots
  ball cleanup (map 27). The cleanup's shot-setup hook Map27CleanupShotSetup 34:5C81 is a bare ret, so this
  was probably meant to be called there (the tee then comes from elsewhere ?).
- 34:7DE4: a fourth unreferenced copy of AwardExpWithBonus (uses 34:7DD8 for the level-up screen).

##### Bank 00
- 00:211D (unreferenced, next to FormatHexWord / FormatDecimalNumber): signed 16-bit to right-aligned decimal
  string of width a (spaces, '-', NUL). Helpers 00:21CF (digit by repeated subtraction), NegateHL 00:21E0,
  NegateBC 00:21E8 are only used by it.

##### Bank 0B
- 0B:4534 (unreferenced debug): small menu text $0123 (gb_04 gb_05 gb_03 gb_06) choosing a map gfx screen;
  sibling of MapGfxBrowserPick 0B:4501 / DebugMapGfxViewer 0B:4579.

##### Bank 3C (computer golfer AI)
- Dead planner helpers: 3C:4B1A walks the shot line in $80 steps looking for a steep green slope
  (3C:4DE2: slope strength >= 2 near the middle of a tile; wider band on courses 3 and 4); 3C:505B adds 10% power;
  3C:5082 compensates carry on rough / bunker / lie $0C (distance / 10 / 9 / 8) and re-picks club and power.
  Work bytes $D525-$D52E (wCpuScratch area).

##### Bank 3E
- 3E:660D: unreferenced third score label (tiles $CD-$CF / $DD-$DF), like DrawScoreLabelB 3E:65E3.

##### Bank 40
- 40:5775-5BF8 is a block of copied math code: Sqrt24 (used by DemoSlide debug print), then the unreferenced
  copies DivAHLByDE_40 (40:599C = 00:0DDB) and MulHLByDE_40 (40:5AA9 = 00:0CB5).
- **Tracer note**: 40:5941 starts right after Sqrt24's last instruction (`ld hl,0 ; jr` at 40:593C) and is
  byte-identical to the tail of CpuDistFromBall 3C:4483: it pops af / bc / de that were never pushed (its
  prologue is missing). It is real code but not a callable routine; the dead-code pass should not count it as
  a routine entry (or should mark it as a fragment). Labelled VectorLengthTail with that remark.

##### RAM
- $C465 wEntranceFacing, $C466 wEntranceX, $C468 wEntranceY: entrance record bytes 1 / 2-3 / 4-5 copied by
  0A:4C47; scripts that reload the map in place (warp $FA) store wPlayerPosSave there (33:4E36, 30:6F32 ...).

### Data Structures

*(none yet)*

### State Machine

#### Top level: the map engine (bank 0A; tools/dump_maps.py)

GameMain (01:400E) initialises WRAM, palettes and the font tiles (01:41CE LoadFontTiles), runs three bank-02
setup calls (02:41F6, 02:45D3, 02:4E3D), clears the shadow OAM, then `jp 01:41A6`, skipping a debug boot menu at
01:40A6-41A2 that nothing reaches (it prints BuildStampData and starts tests on Up + a button). 01:41A6 sets
`wMapId` = 0 and `wMapEntrance` = 3 and farcalls **MapEngine (0A:498C)**, which never returns:

```
MapEngine:  forever:
    ClearFrameTasks; RegisterFrameTask(1, MapDebugCoordsTask 0A:4950)
    MapRun (0A:4A21):
        fade out (c = $0C); wMapLoadPhase = $10
        clear wMapEvent; MapLoadHeader (0A:4BBC); MapPlaceAtEntrance (0A:4C0D)
        play wMapMusic unless $FF (00:2C19); phase $20: header +4 -> 0A:4F45; farcall 04:4D2B
        phase $30: player position -> $C320/$C322; farcall 0B:46DF with wMapGfx; phase $40: 0A:4F71
        fade in; MapEventLoop (0A:4AAA): each frame (AdvanceFrame via 0A:4BAC) look at wMapEvent:
            +0: 0A:50CB     +1: warp id -> $C46B, leave MapRun
            +4: sound $62, menu farcall 41:6E6E
            +3: a timer at $C28C-$C28E (>= 30) raises flag #23 and an action
            +2 (the A button): talk list (0A:49C6 -> 0A:4F96), object list (0A:49E9 -> 0A:5066),
                0A:4D1F -> 0A:5109; otherwise the debug menu 05:6B2E when hDebugMode,
                or 0A:7174 on map 2 (sound $5C)
    MapTakeWarp (0A:5146): warp record (8 bytes) -> wMapId = +6, wMapEntrance = +7
```

**MapTable (0A:5188)**: 6-byte records `[map id, gfx id, header idx, header bank, music, ?]`, ending with `$FF`.
63 maps (`$00-$3E`); the header is the word at `bank:$4000 + idx`. Header banks are 30-35, which explains their
many far calls into 0A. Some maps share a header (08-0B; 0E/11/14/17; 18-1B; 2E/2F), presumably the same room
in different states.

**Map header** (14 bytes, copied to `$C456`; every pointer is in the header's bank, `wMapBank`):

| Offset | Field | Used by |
|--------|-------|---------|
| +0 | entrances: 6-byte records `[entry id, ?, x (word), y (word)]`, end `$FF` | MapPlaceAtEntrance |
| +2 | warps: 8-byte records, bytes 6/7 = destination map / entrance | MapTakeWarp |
| +4 | data right after the header; passed to 0A:4F45 at map start | MapRun |
| +6 | talk targets | 0A:49C6 |
| +8 | objects | 0A:49E9 |
| +10, +12 | not yet known | |

The pointers in each header point just past it and increase in this order, which supports the layout. The map
engine is the RPG ("story") side; how golf rounds and the menus are entered from it is the next thing to trace.

---

## Intermediate Output Files

| File | Contents |
|------|----------|
| `python3 tools/dump_maps.py [--entrances]` (stdout) | map table and headers |
| `gfx/map_XX.png` (gitignored) | the 35 overworld map graphics, 512 x 512 |
| `gfx/hole_XX.png`, `gfx/hole_XX_terrain.png` (gitignored) | the 90 holes and their terrain types |
| `gfx/lz_BB_AAAA.png`, `gfx/raw_03_50f0.png` (gitignored) | LZ entries as tile sheets; the font |
| `python3 tools/gen_all.py` | rebuilds all of the above |
| `out/boot_FFFFF.png` (gitignored) | emulator screenshots from `emu_boot.py` |
| `out/suite_<case>.json`, `states/suite_<case>.state` (gitignored) | shot recordings and poked states from `shot_suite.py` |
| `docs/text_dump.txt` (gitignored) | every string: `id bank:index text`, control codes as `{XX}` (`python3 tools/dump_text.py`) |

---

## Verification Checklist

- [x] Ph3: 3+ functions traced and cross-checked against emulator trace (`tools/emu_verify.py`: LZDecompress,
      LoadText, MapLoadHeader, MapLoadGfx; see "Verification" below)
- [x] Ph4: tiles extracted and compared to the emulator: two whole map tile sets in VRAM bank 1 match byte for
      byte; gfx 1E matches the character-creation screen by eye
- [x] Ph5: key data structs confirmed against emulator memory: MapTable record, hole maps (tilemap, attributes,
      terrain), and the ball state D400-D415 field by field (ball_sim.py reproduces it exactly)
- [ ] Ph6: full game session played, no major logic gaps found
- [ ] Ph7: web port pixel-compared against emulator screenshots

---

### Verification (PyBoy 2.8, `tools/emu_verify.py`, `tools/emu_boot.py`)

`emu_boot.py` boots the game headless (no battery RAM) and saves screenshots to `out/`: the intro (narration
text, then large character art) plays in map 00 at entrance 3; Start then A reach the character select
(map 00) and the character creation room (map `$1E`, gfx `$1E`, the star background).

`emu_verify.py` runs the same boot with hooks on the real routines and compares with the Python decoders.
Result over 4800 frames:

| Check | Hook | Result |
|-------|------|--------|
| LZ | 00:1F2F entry / 00:1F8D end: bytes written vs `decompress.py` | 1849 of 1849 match |
| Text | 05:6179 / 05:61CF: wTextBuffer vs `dump_text.py` | 8 of 8 match |
| Map record | 0A:4BFA: `$C450-$C455` vs MapTable (`dump_maps.py`) | 2 of 2 match |
| Map graphics | 0B:4500: WRAM3 tilemap, WRAM2 attributes, VRAM1 `$9000`/`$8800` tiles vs `render_map.py` | 6 of 6 regions match |

---

## Reference Resources

- Data Crystal: https://datacrystal.tcrf.net/wiki/Mario_Golf_(Game_Boy_Color) (header values; stub page)
- `../mario-tennis-gbc/` (same developer and cartridge; its vendored disassembly is used only by
  `tools/compare_home.py` to find shared routines and names)

---

## Next Tasks

### RE Investigation

- [x] Ph1: identify binary header and platform (header.py; SHA-1 recorded)
- [x] Ph1: RST and interrupt vectors, entry point, Start / SoftReset / AdvanceFrame
- [x] Ph1: bank 0 comparison with Mario Tennis (compare_home.py, 108 labels)
- [x] Ph1: confirm LZ format (LZDecompress 00:1F2F = Tennis format)
- [x] Teach `disasm.py` the `$4000` table: it lists the entries as `dw` when disassembling a bank from `$4000`
- [x] Short `$4000` tables: classified by far-call evidence (`scan_jumptables.kind()`); only bank 46 is a header,
      banks 18-1F turned out to be the text banks
- [x] Resolve 00:11CB: MulSin
- [x] Read the 14 partial matches and name them from the code
- [x] Name the unmatched bank-0 code: 0458, 2683/2688, 304D, 3038, 2C4A, the VBlank handler, the serial protocol
- [ ] 00:2B31 (copies a column into WRAM bank 3, sets `hFFB9`): no `call` to it; find how it is reached
- [ ] Link modes: trace the InitSerialLink callers in banks 02, 03, 07, 09 and 32
- [x] GameMain 01:400E: followed to MapEngine 0A:498C (map table, header, warps, event loop)
- [x] Map 00 (the boot map, entrance 3): the intro, then the character select (emulator, emu_boot.py)
- [ ] Map 00: how its init data (32:4FF7, header +4) drives the intro and the character select (0A:4F45)
- [x] Find the golf round: GolfRound 10:4451 (emulator, emu_callers.py), entered from map 00's menus
- [x] Golf engine, first pass: round and shot loop, swing meter, ball state and the flight / roll steps
- [x] Golf engine: shot launch (ShotLaunch 10:5F94): club distance table, power curve, speed / elevation / direction
- [x] Golf engine: ball step ported exactly (ball_sim.py: flight, wind, drag, bounce, roll, slopes; 5 shots, 1783 steps)
- [x] Ball step: the green (putting) branches, water drop and skip, bunker plug; the cup and holing out
      (ShotMainLoop 10:6E99; whole-shot replay in the interpreter, shot_suite.py: 24 cases, every event matches)
- [x] Cup routines in Python (cup_sim.py, test_cup.py), trees (TreeCheck 08:51D2), the rest of BallTask, and
      ShotMainLoop with the flight-camera loop (shot_py.py): whole shots run in Python (shot_run.py, 27 cases)
- [ ] ShotMainLoop's retry branch (10:6FC9, A with `D35F` set) and 13:4276: not reached yet
- [x] ShotLaunch in Python (launch_py.py, test_launch.py), chained into shot_run.py: swings from the launch to
      the outcome match the game in every case
- [x] The swing in Python from the address step: club and aim changes, the meter, the impact pad, the swing
      animation's timing, the landing preview, the stroke count (swing_py.py, joypad.py; 27 suite cases)
- [x] A whole hole in Python (hole_py.py): penalties, drops, points, scorecard, the game's club and aim choice;
      four recorded holes match (hole_suite.py); play_hole.py plays a hole with the Python engine choosing swings
- [ ] The aiming menu's other answers (club list, shot modes, power shots, map view), two players, the stroke
      limit, a retry (B), the computer's swing (10:5643) and choices; then the round (next hole, wind) in Python
- [ ] Golf engine: aiming loop (10:486B), club select, CPU golfers' targets, scoring (strokes, PlayerField `+$20`)
- [x] Hole data: HoleAssetTable 13:4A16, overhead assets, terrain table; all 90 holes render (render_hole.py)
- [ ] Holes: the per-hole data still unidentified (ref 1 entries 2-3: tee/pin positions? par/length?), terrain
      types 4, 5, 8, A-F, the behind-the-golfer view assets (refs 2-4), hole ids `$00-$09` and `$64` up
- [ ] How the play-mode menu (map 00) calls GolfRound, and the RPG side's golf (story tournaments from maps)
- [ ] Map header fields +10/+12; warp record bytes 0-5; entrance byte 1; MapTable byte 5
- [x] Save: signature, checksum, backup, block directory (02:41F6 SaveLoad and friends; dump_save.py)
- [ ] Save: what each of the 12 blocks holds (play a story file, save, diff with dump_save.py); GameMain's other
      bank-02 calls 02:45D3 and 02:4E3D
- [x] Sound: driver copies in 7C/7D/7E, song bank/pointer tables, command id ranges, effects bank 7F
- [ ] Sound: channel script format (7E:42B9 per channel) and the effect format (7F); exports 7E:4043-4064, 49DF, 49EB
- [x] Text: text banks 18-1F, id format, control codes, font 03:50F0 (dump_text.py)
- [x] Text: font rendered; plain 2bpp tiles
- [ ] Text: control code `$0D` (05:531B) and where the argument lists `$DFAE`/`$DFEE` are filled
- [x] Decompress and render LZ entries (extract_tiles.py); overworld maps fully rendered (render_map.py)
- [ ] Map descriptor w7 (WRAM6 D800): find its readers (w4 = terrain grid, w5 = event grid: bank 0B notes)
- [ ] Loaders for the LZ entries in banks 40, 4B-4E, 58 (UI, faces, sprites) and the golf course graphics
- [x] Milestone 3: the game runs in the browser on `web/js/gb` with SRAM saving (docs/architecture_web.md); identical
      to PyBoy frame for frame from power-on and for 24 000 frames of play (`core_vs_pyboy.mjs`, `snap_vs_pyboy.mjs`)

### Web Port Fixes

### Documentation

- [x] `docs/architecture_exe.md` (binary layout, bank roles, execution flow, data flow)
- [x] `docs/architecture_web.md` (the page, the core, the PyBoy checks)
