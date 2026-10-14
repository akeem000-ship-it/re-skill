# Whole-game port: status

What runs as readable JavaScript (web/js/port), checked against the ROM by the routine tests
(web/tests/port_routines.mjs) and the lockstep (web/tests/port_lockstep.mjs). See docs/port_guide.md.

| Part | Source (disassembly) | Port | Status |
|---|---|---|---|
| Pad, random seed | home/vectors, mul | home/joypad.js | verified |
| Math (mul/div/sine/trig) | home/mul, div, sine, trig | home/math.js | verified: 57 tests, 0 differences on exh1 and rec1 |
| Graphics and memory (copies, VRAM queues, palettes, decompress, sprites, fades, frame tasks) | home/memory, decompress, view, palettes, colorfade, fade | home/memory, palettes, decompress, view, colorfade, fade | verified: 129 tests, 0 differences on exh1, story1, rec1 |
| System (far calls, flags, game timer, interrupt handlers, AdvanceFrame, debug text, window frames) | home/vectors, vblank, flags, timer, debugtext, numberfont | home/system, flags, vblank, link, frame, debugtext, ui, bgblit | verified: 79 tests, 0 differences on exh1 and rec1 |
| Sound driver | audio/ | audio/ | verified: 898 tests (APU writes too), 0 differences on exh1, rec1, story1 |
| Saves | engine/save | save/ | verified: 75 tests on 4290 states, 0 differences on 5 recordings |
| Cutscenes (intro, title, credits, story windows) | engine/cutscenes | cutscenes/ | verified: 60 tests, 0 differences on 8 recordings |
| Story-mode engine | engine/story | story/ | verified: 194 tests, 0 differences on story1, rec2 and 6 more |
| Minigames and drills | engine/minigames | minigames/ | verified: 248 tests, 0 differences on 40 recordings |
| Text engine (windows, printer and control codes, dialogue, font, debug menus) | engine/text | text/ | verified: 223 tests, 0 differences on exh1, story1, debug1, rec1, rec2 |
| Match (engine hooks, HUD, link) | engine/match | match/ + web/js/engine | 453 hooks; 510 tests ok, 0 differences on exh1; rec1 waits on a harness fix |
| Menus: shared code and main menu (boot/InitAndRunGame, saved data, erase, N64 transfer and records, match format) | engine/menus/common, main_menu | menus/common, menus/main_menu | verified: 252 tests, 0 differences on 12 recordings |
| Menus: character select and data (new game, name entry, grid, match type, stats pages, EXP distribution, confirm) | engine/menus/char_select, char_data | menus/char_select, menus/char_data | verified: 213 tests on 787 states, 0 differences on 10 recordings (link screens untestable) |
| Menus: pause (match and story), briefing and drill scripts, rules, court select, scenes | engine/menus/pause, briefing, court_select, scenes | menus/pause, briefing, court_select, scenes | verified: 271 hooks, 164 tests, 0 differences on 29 recordings (link court select untestable) |
| Menus: EXP, results, ranking, dictionary, equipment, minigame select, debug, link | engine/menus/* | menus/ | in progress |
| Story scripts and scenes | story/ | — | not started |

Busy loops that measure CPU time (DisableLCDSafely, ShortDelay, WaitSerialTransfer) stay ROM code for now.
