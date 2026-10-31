# Handoff: the decompile, for whoever picks it up next

This note is for an agent (or person) continuing **only the decompile**: turning the ROM's code into readable, exact
JavaScript and documenting what it does. The 3D view, the Android app and the cosmetic extras (`web/js/voxel.js`,
`stadium3d.js`, `matchfx.js`, `ballfx.js`, `weather.js`, `fieldlife.js`, `intro.js`, `android/`) are out of scope:
leave them alone.

## Read first, in this order

1. `CLAUDE.md`: the project's conventions. They apply to any agent, not only Claude (address notation, label format,
   tool usage, what may be committed).
2. `README.md`: setup (your own ROM dump in `rom/`, `python3 tools/gen_all.py`).
3. `docs/port_guide.md`: how the port works (hooks, `P.callRom`, generators for routines that wait) and the two tests
   every ported part must pass.
4. `docs/port_status.md`: what is ported and verified, area by area.
5. `REVERSE.md` (findings, 1300+ lines), `labels.csv` (names), `dead_ends.md` (what did not work).

## Hard rules

- **Never commit the ROM or anything derived from it**: `rom/`, `gfx/`, `out/`, `states/`, `web/gen/`,
  `docs/text_dump.txt`, `docs/scenes_dump.txt`, `third_party/mario-tennis-gbc-disasm/data|build`. They are
  gitignored; keep it that way.
- **Never commit `web/mods/`** (private character mods) or any of its names or art.
- Exactness over neatness: a ported routine must make the same RAM writes, in the same order where it matters, with
  the same results on every branch. The tests decide, not the disassembly's comments.
- The vendored disassembly (`third_party/mario-tennis-gbc-disasm/`, MIT) may be used and copied with credit; check
  what you take from it against the ROM with `tools/disasm.py` and the tests.

## Where things stand

- The ROM's code is mapped: banks, the main loop, the scene system, text, maps, sprites, sound, saves, the match
  engine, the CPU AI, story scripts, the link cable (`REVERSE.md`).
- The match engine is ported in full (`web/js/engine/`, verified in lockstep against the ROM).
- **The rest of the game is ported in full** in `web/js/port/` (home, audio, text, menus, story, cutscenes,
  minigames, save, match hooks, the link cable). Every row of `docs/port_status.md` is verified, and nothing of the
  ROM's code is left: every code routine of the disassembly is hooked or reached only from ported code
  (`web/tests/port_static_coverage.mjs`), and playing all 886 recordings on the port runs no ROM code
  (`web/tests/port_rom_trace.mjs`) beyond what a saved state was already running when its recording began.
- The waits on the hardware (rLY / serial polling, delay counts) run cycle for cycle as the ROM's (`P.instr`,
  `docs/port_guide.md`, Timing); link play is tested on two emulated machines joined by a cable
  (`web/tests/port/link_pair.mjs`).

## What is left

1. **Names for the story's event flags.** 704 flags are referenced (usage map in `REVERSE.md`, tool
   `tools/dump_flags.py`); the disassembly names 166 of them (every flag the code sets, clears or tests by name),
   the rest appear only as numbers in scene and actor condition data.
2. **Scenes no recording reaches.** 75 of the 445 waiting story scenes have no recording (their code is ported and
   passes the routine tests, but has not been played in lockstep). Recordings that reach them would close this.
3. **Link error paths.** The link test plays a whole session but never a broken one: the link error screen, a
   checksum retry and the timeouts are ported but not exercised. A cable that drops or corrupts bytes on request
   (web/js/gb/cable.js) would reach them.
4. **Known, accepted differences:** rec2 shows two actor-position differences on the overworld long after the EXP
   screens, caused by ported code taking no CPU time (lag frames fall differently); the exact animation frame of
   the ball's launch after racket contact is an open question (`REVERSE.md`).

5. **Saving the port mid-play.** A machine state can't hold the port's place in its own code (the JS generators),
   and nearly all of the game runs inside one chain of them from power-on (00:2578 Start onward), so a state can't
   be resumed by the port; resuming it as the ROM (CPU halted in AdvanceFrame) fails because the port's stack holds
   no ROM return addresses (tried: exh1 2 of 5, story1 0 of 5, mg_01 2 of 5 points resumed). Ways out: replay the
   session log from power-on (exact; about 1,500 frames a second headless in Node, so slow for long sessions),
   resumable safe points, or a ROM-faithful stack. Until then the page's quick save is CODE: ROM only.

## How to check work

```bash
python3 -m http.server 8765                        # from this folder, for the browser-based tests
node web/tests/port_routines.mjs [filter]          # routine tests: ROM vs port from recorded machine states
node web/tests/port_lockstep.mjs out/port/X.mtrec  # whole-game lockstep: must report 0 "with RAM/state differences"
```

The recordings in `out/` are gitignored (they hold game state), so a fresh checkout has none. Make power-on
recordings with a scripted pad: `web/tests/engine/make_rec.mjs` (see `docs/port_guide.md`, Testing step 3).

## Branch

Work has been on `claude/re-skill-reverse-engineer-p4564i`, PR #1 on akeem000-ship-it/re-skill. Commit in small,
tested steps with clear messages. Update `docs/port_status.md` and `REVERSE.md` as parts are finished.
