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
  engine, the CPU AI, story scripts (`REVERSE.md`).
- The match engine is ported in full (`web/js/engine/`, verified in lockstep against the ROM).
- The rest of the game is ported module by module in `web/js/port/` (home, audio, text, menus, story, cutscenes,
  minigames, save, match hooks). Every row of `docs/port_status.md` is "verified" except the last one.
- Anything not yet ported still runs as the ROM's own code on the emulator's CPU, so the game always runs while
  the port grows.

## What is left (in order)

1. **Enable story scripts part 2** (`lessonmenu_10` … `wall_room_12`, in `web/js/port/story_scripts/`). They are
   ported and pass 130 routine tests and strict lockstep on 371 scripted recordings, but are not switched on in the
   program yet. 75 of the 445 waiting scenes have never been reached by a recording. Make recordings that reach
   them, fix what differs, then enable the modules and re-run the full lockstep.
2. **The busy loops that measure CPU time** (`DisableLCDSafely`, `ShortDelay`, `WaitSerialTransfer`) are still ROM
   code. Ported code takes no CPU time, so these need a design that keeps the ROM's observable results (see "Timing"
   in `docs/port_guide.md`).
3. **Whatever still runs as ROM code.** Trace which ROM addresses the CPU still executes while the port runs a set
   of recordings, list them by bank, and port them like the rest (one module per source file, hooks, both tests).
4. **Open questions** (see `REVERSE.md`): names for the story's event flags (704 flags have a usage map; their
   meanings are mostly unnamed); the exact animation frame of the ball's launch after racket contact.
5. **Known, accepted differences:** link-cable play cannot be tested; rec2 shows two actor-position differences on
   the overworld long after the EXP screens, caused by ported code taking no CPU time (lag frames fall differently).

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
