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
| Match (engine hooks, HUD, link) | engine/match | match/ + web/js/engine | verified: 453 hooks, 510 tests, 0 differences on exh1, rec1, and rec2 with every verified part (link play untestable) |
| Menus: shared code and main menu (boot/InitAndRunGame, saved data, erase, N64 transfer and records, match format) | engine/menus/common, main_menu | menus/common, menus/main_menu | verified: 252 tests, 0 differences on 12 recordings |
| Menus: character select and data (new game, name entry, grid, match type, stats pages, EXP distribution, confirm) | engine/menus/char_select, char_data | menus/char_select, menus/char_data | verified: 213 tests on 787 states, 0 differences on 10 recordings (link screens untestable) |
| Menus: pause (match and story), briefing and drill scripts, rules, court select, scenes | engine/menus/pause, briefing, court_select, scenes | menus/pause, briefing, court_select, scenes | verified: 271 hooks, 164 tests, 0 differences on 29 recordings (link court select untestable) |
| Menus: EXP awards and distribution, results, ranking board and bracket, rewards, game progress | engine/menus/exp, results, ranking | menus/exp, results, ranking | verified: 342 hooks, 271 tests on 1238 states, 0 differences on 20 recordings; rec2 shows 2 actor-position differences on the overworld long after these screens, right after timing events (ported screens take no CPU time, so later frames lag differently) |
| Menus: dictionary, equipment, minigame select, debug, link | engine/menus/equipment, dictionary, minigame_select, debug, link | menus/equipment, dictionary, minigame_select, debug, link | verified: 328 hooks, 249 tests (all registers and memory), 0 differences on 196 of 197 recordings (debug1: one HRAM byte after a timing event, the same without these hooks); link partner screens and dictionary modes 1-2 (crash in the ROM) untestable |
| Story scripts part 1 (academy_13 … junior_singles_11) | story/ (29 files) | story_scripts/ | verified: all 29 modules enabled; 407 hooks; 577 of 597 named story-script functions run clean in ~260 scripted recordings (4 unreachable: no caller, no table row or no behaviour cell); strict lockstep 0 differences except ss1_end7_1 / ss1_jrd_t3u, a lockstep-harness artefact (a mid-work VBlank gets the next boundary's pad) |
| Story scripts part 2 (lessonmenu_10 … wall_room_12) | story/ | story_scripts/ | verified and enabled (in program.js with part 1); 130 routine tests ok; strict lockstep 0 differences in part-2 code on 371 scripted ss2_* recordings + 115 ss1_*; 370 of 445 waiting scenes reached by a recording |
| Waits on the hardware (DisableLCDSafely, ShortDelay, WaitSerialTransfer) and the vectors' jumps | home/vectors, vblank | home/busy.js | verified: cycle for cycle the ROM's (P.instr), interrupts on: 3 x 2916 calls from states across the frame, machine, cycle count and frame boundaries alike (web/tests/port/busy_loops.mjs); 0 differences on exh1, story1, mg_01, mg_02 |
| Text banks' string fetch (13 banks x 3 entries) | twins/fetch_text | standalone/fetch_text.js | verified: 39 routines x 384 tests, 0 differences; now enabled; 0 differences on exh1 and story1 |
| Link cable (connecting, the ready signal, each frame's byte, blocks of nibbles with checksums, the menus' commands, the match session) | engine/match/link_connect, link_sync, link_handshake, nibble (07) | match/link/ | verified: two machines on an emulated cable, a whole session (connect, link menus, character select, a match) played with the ROM's link code and with the port: every AdvanceFrame alike on both (6313 and 6432 frames), the sound engine's timing apart (web/tests/port/link_pair.mjs --check); error paths (the link error screen, checksum retries, timeouts) not reached |
| Match input with repeats, the scripted-input reader, the projection thunk | engine/match/match, match_frames, project (08) | match/match_loop.js | verified: routine tests (1779 states); 0 differences on mg_01, mg_02 |
| No Game Boy CPU (native step 1): the machine without the SM83's instruction set, the calling convention kept (registers, stack, interrupts) | — | gb/registers.js, port.js noCpuStep (GamePort noCpu) | verified: all 29 recordings from power on (149,621 frames) in strict lockstep with --nocpu: 0 differences, no instruction run; the page's default |

## Coverage

Nothing of the ROM's code is left to port:

- **By the disassembly** (`node web/tests/port_static_coverage.mjs`): of its 4280 code routines, 3994 are hooked,
  11 are tails of covered code, 188 are reached only from covered code or data (jump-table cases a ported
  dispatcher runs, inner steps of routines ported whole: the sound driver's, the intro's states, the minigames'
  cases) and 87 are unused. 0 uncovered.
- **By playing** (`node web/tests/port_rom_trace.mjs` over the 886 recordings in out/port and out/engine): the port
  runs no ROM code of its own. What runs as ROM code is only what a saved state was in the middle of when its
  recording began (its call stack runs on until it returns), and the broken recordings (rec4, rec5,
  ss1_jrd_f_win: their states crash into garbage on the ROM too).

Link play script for web/tests/port/link_pair.mjs (from power on; side b presses Link two seconds after side a,
so a is the master):

    --a "wait@650,start@250,start@200,right@20,right@20,a@400,a@150,a@150,a@150,a@150,right@60,mash@3000"
    --b "wait@650,start@250,start@200,right@20,right@20,wait@120,a@400,wait@40,a@150,a@150,a@150,right@60,a@150,mash@3000"
    --frames 6500 --check
