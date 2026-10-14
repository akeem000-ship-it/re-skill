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
| Text engine | engine/text | text/ | in progress |
| Match (engine hooks, HUD, link) | engine/match | match/ + web/js/engine | in progress |
| Menus | engine/menus | menus/ | in progress (common, main menu, character select/data, pause/briefing/court/scenes) |
| Story scripts and scenes | story/ | — | not started |

Busy loops that measure CPU time (DisableLCDSafely, ShortDelay, WaitSerialTransfer) stay ROM code for now.
