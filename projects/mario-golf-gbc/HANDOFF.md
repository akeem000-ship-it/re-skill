# Handoff: starting the Mario Golf (GBC) decompile

This is the starting brief for a new session (agent or person) that begins reverse engineering **Mario Golf for
Game Boy Color** and porting it to readable, exact JavaScript: the same treatment Mario Tennis got in
`../mario-tennis-gbc/`. Nothing about Mario Golf has been analysed yet. This file says what is known, what to reuse
from the Tennis project, the order to work in, and the rules.

## The goal

1. Map the ROM: banks, entry points, main loop, scenes, RAM, save format, assets, text, golf engine.
2. Run the game in the browser on this repo's own Game Boy Color core (`web/js/gb`, from the Tennis project).
3. Port the ROM's code module by module to readable JavaScript that makes the same RAM writes as the ROM,
   checked frame by frame against it (lockstep), with unported code still running as ROM code meanwhile.
4. Later, not now: the extras (HD text and menus, 3D view, Android app; one app holding both games).

## What is known (check it against your dump)

From Data Crystal (https://datacrystal.tcrf.net/wiki/Mario_Golf_(Game_Boy_Color), a stub page), not yet
checked here:

| | USA | Europe | Japan |
|---|---|---|---|
| Header title | `MARIO GOLF` | `MARIO_GOLF` | `M.GOLF GB` |
| Header checksum ($014D) | $7A | $30 | $EA |
| Global checksum ($014E) | $0FC7 | $4682 | $656D |

- Cartridge: MBC5 + RAM + battery, ROM 2 MiB (128 banks of 16 KB), SRAM 8 KiB, Game Boy Color, no SGB.
- Developer Camelot Software Planning, publisher Nintendo; JP release 10 Aug 1999, US 5 Oct 1999.
- No SHA-1 is published. Record your dump's SHA-1 the first time (README.md, CLAUDE.md, `web/js/rom.js`).
- **No public disassembly was found** (web search, 2026-10-24). Unlike Tennis, there is no vendored
  disassembly to borrow names from: every name is this project's own, and the "no third-party disassemblers"
  rule applies in full.

Mario Tennis GBC is also Camelot's, from a year later, and uses the same cartridge (MBC5, 2 MiB, 8 KiB SRAM).
Its engine conventions are a strong first guess for Golf (see "Hypotheses" below), but they are guesses until a
tool shows them in this ROM.

## Read first, in this order

1. `../../SKILL.md` and `../../phases.md`: the `/re` method this repo is built around (phases Ph1-Ph7, the stuck
   rule, the tool rules). If the skill is installed, `/re rom/mario_golf.gbc` bootstraps; if not, follow its
   bootstrap steps by hand using `../../reverse_template.md` and `../../dead_ends_template.md`.
2. `CLAUDE.md` in this folder: the conventions (filled in as you confirm them).
3. The Tennis project as the worked example:
   - `../mario-tennis-gbc/CLAUDE.md`: conventions that worked.
   - `../mario-tennis-gbc/REVERSE.md`, section "Architecture" first: what a Camelot GBC engine looks like.
   - `../mario-tennis-gbc/docs/port_guide.md`: how the partial port runs (hooks, `P.callRom`, generators) and
     the two tests every ported part must pass.
   - `../mario-tennis-gbc/HANDOFF.md` and `dead_ends.md`: where Tennis stands and what did not work.

## Hypotheses to test first (from Tennis; confirm or drop each)

Tennis conventions (`../mario-tennis-gbc/CLAUDE.md`):

- Every bank's `$4000` holds a word table of exports/assets.
- `rst $18 ; db idx, bank` is a far call. Test: count `DF` bytes followed by plausible `idx, bank` pairs where
  `idx` is even and inside the target bank's `$4000` table (`tools/bank_map.py` does this for Tennis).
- `rst $00` is followed by an inline jump table; `rst $08 ; db id` plays a sound.
- `rst $20/$28/$30 ; dw n<<5` set / clear / test event flag n.
- Assets are LZ-compressed with the decompressor Tennis has at 00:1797 (`../mario-tennis-gbc/tools/decompress.py`
  documents the format). Look for the same routine in bank 0, then decompress a few `$4000` table entries.
- Text is ASCII in text banks laid out as in `../mario-tennis-gbc/tools/dump_text.py`.

**Fastest first step:** compare bank 0 (the home bank) of the two ROMs. Write `tools/compare_home.py` that finds
runs of identical or near-identical code (same opcodes, allowing different absolute addresses) between Golf's
bank 0 and Tennis's bank 0. Every shared routine's Tennis label (`../mario-tennis-gbc/labels.csv`) is a candidate
name here: copy it with a comment `(as in Mario Tennis 00:XXXX)` once the code matches.

## What to reuse from Tennis (copy, then adapt)

Copy each piece when a phase needs it rather than everything at once. These are generic SM83 / Game Boy Color
tools; each Tennis-specific line in them has to go.

**Python tools** (`../mario-tennis-gbc/tools/`):

- Generic: `gbrom.py` (ROM loading, banks, labels.csv), `instruction_set.py`, `disasm.py`, `xref.py`,
  `search_bytes.py`, `find_bytes.py`, `decode_tables.py`, `relsearch.py`, `strings_dump.py`, `gfx.py`,
  `scan_jumptables.py`, `render_vram_tiles.py`, `render_screen.py`, `trace_code.py`, `recomp.py`, `gen_all.py`.
- The emulator wrapper `emu/session.py` (PyBoy 2.x, headless, CGB). It is a reference to check against, not a
  disassembler. Copy the `emu_*.py` helpers as needed.
- Only if the format matches: `decompress.py`, `scan_assets.py`, `extract_tiles.py`, `dump_text.py`,
  `bank_map.py`, `render_map.py`, `render_sprites.py`.
- Tennis only, do not copy: everything about matches, balls, shots, courts, character stats, scenes and the
  vendored disassembly (`analyze_*`, `dump_shot_tables.py`, `gen_port_fields.py`, ...).

**JavaScript** (`../mario-tennis-gbc/web/`):

- `js/gb/`: the Game Boy Color core (CPU, MBC5, PPU, APU, timer, DMA, snapshots), verified frame-for-frame
  against PyBoy. Use as is.
- `js/rom.js` (set `EXPECTED_SHA1`), `js/recorder.js`, `js/replay.js`, `js/audio.js`, `js/gamepad.js`,
  `js/stick.js`.
- `full.html` + `js/full.js` as the page shell. Strip the Tennis features (3D, menus, mods, match extras) down to:
  load ROM, run, save SRAM, record.
- The port framework: `js/port/port.js`, `bus.js`, `entry.js`, the `program.js` pattern. The RAM field list is
  this project's own: generate it from `labels.csv`, not from a symbol file.
- Tests: `tests/core_vs_pyboy.mjs`, `recomp_vs_interp.mjs`, `port_lockstep.mjs`, `port_routines.mjs`,
  `page_smoke.mjs`, `shoot.mjs`.

**Hard-coded Tennis spots to change when copying:**

- `tools/gbrom.py` `ROM_PATH`, and `tools/emu/session.py` `ROM`: use `rom/mario_golf.gbc`.
- `web/js/rom.js` `EXPECTED_SHA1`.
- `web/js/full.js`: the `fetch("../rom/mario_tennis.gbc")` line.
- The localStorage keys (`mt-...`). Give Golf its own prefix (`mg-...`) so the two games never share saves or
  settings in one browser or app.

Copies will drift from Tennis. That is fine for now. When both games go into one app, move the shared core
(`js/gb`, recorder, audio, controls) to a shared folder.

## Milestones (in order; each has a check)

1. **Setup.** Dump in `rom/mario_golf.gbc`, its SHA-1 recorded. Scaffold `REVERSE.md`, `labels.csv`,
   `dead_ends.md` and `tools/` from the templates. Commit only tools and notes.
2. **Identify (Ph1).** Header, interrupt and RST vectors, entry point, bank 0 overview, bank `$4000` tables.
   Run the bank 0 comparison with Tennis. Check: findings in `REVERSE.md`, first labels in `labels.csv`.
3. **Playable in the browser.** The game boots and plays on `web/js/gb` with SRAM saving. Check:
   `core_vs_pyboy.mjs` shows identical frames to PyBoy for at least a few thousand frames of real play.
   This gives the user something to try early.
4. **Tools and assets (Ph2-Ph4).** The disassembler knows the RST conventions; decompressor; text dump; tile
   sheets, course and hole maps rendered; `tools/gen_all.py` rebuilds every derived file from the dump.
5. **Architecture (Ph5).** Main loop, scene / state machine, bank roles, RAM map with names, save layout, course
   and hole data format, the golf engine's entry points (swing, power meter, ball flight, wind, lie and terrain,
   bounce and roll, putting, CPU golfers, scoring). Check: `docs/architecture_exe.md` exists and agrees with
   traces.
6. **Trace and recompile.** `trace_code.py` produces the code map; `recomp.py` turns it into `web/gen/`. Check:
   `recomp_vs_interp.mjs` reports zero differences.
7. **Recording and lockstep harness.** Recordings (`.mtrec`-style: start state plus input per frame) and the port
   framework with hooks. Check: `port_lockstep.mjs` on a recording reports 0 RAM/state differences with no
   modules enabled, then with each module.
8. **Port waves.** Home bank first (system, joypad, graphics queue, LZ, text, sound driver), then menus, then
   the golf engine, then story / RPG. One JS module per ROM source area, ROM address in a comment on every
   routine. Check: both tests from `../mario-tennis-gbc/docs/port_guide.md` for every module.
9. **Docs.** `docs/architecture_exe.md`, `docs/architecture_web.md` and `docs/port_status.md`, kept current.

## Rules

- **Never commit the ROM or anything derived from it.** That covers `rom/`, `gfx/`, `out/`, `states/`,
  `web/gen/` and text or scene dumps. `.gitignore` here already covers them; keep it that way.
- No third-party disassemblers. Write tools as `.py` files in `tools/` (never inline `python3 -c`). Use
  `labels.csv` for every name.
- Exactness over neatness: a ported routine must give the same RAM writes and results as the ROM on every
  branch. The tests decide, not comments.
- Write findings into `REVERSE.md` as you go, not in a batch at the end. Use the stuck rule from `SKILL.md`
  (10 tool calls without progress: log it in `dead_ends.md`, split the task).
- Keep model names out of commits and files.

## Lessons from Tennis worth knowing on day one

- Teach the disassembler the inline-argument RSTs before anything else, or linear disassembly desyncs and far
  calls stay invisible.
- Enumerate each bank's `$4000` table: it lists every entry point and asset in one pass.
- Trace the loader before guessing a layout. Tennis's maps were 64x64 tiles in VRAM bank 1 with signed tile
  indices, and its sprites were 8x16 objects in column-major order; both were found from the loading code, not
  by staring at bytes.
- WRAM tilemap buffers can use a 20-column stride rather than 32.
- Get the game running on the JS core early, with a recorder. Every later check (lockstep, screenshots,
  regressions) replays recordings.
- Recordings made with one menu style or setting can diverge under another. Store the settings in each
  recording and replay with them.
- Ported code takes no CPU time, so busy-wait loops that measure time (LCD-off waits, delays, serial waits) stay
  ROM code until there is a design that keeps their observable results.

## Kickoff prompt for the new session

> Read `projects/mario-golf-gbc/HANDOFF.md` and follow it. My Mario Golf (USA) dump is attached: put it at
> `projects/mario-golf-gbc/rom/mario_golf.gbc` (never commit it), record its SHA-1, then start with milestones 1
> and 2. Commit tools and notes as you go and push to this session's branch.
