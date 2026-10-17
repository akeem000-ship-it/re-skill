# Mario Tennis (Game Boy Color) — reverse engineering

Project bootstrapped with the `/re` skill (see `../../SKILL.md`). Notes live in
[REVERSE.md](REVERSE.md), labels in [labels.csv](labels.csv), architecture in
[docs/architecture_exe.md](docs/architecture_exe.md).

## Setup

```bash
pip install pypng
mkdir -p rom && cp /path/to/your/Mario_Tennis_USA.gbc rom/mario_tennis.gbc
# expected SHA-1 414ba58340a27fc27b127bc01455b32764151ff0
python3 tools/gen_all.py          # renders maps, tile sheets, text dump into gfx/ and docs/
python3 -m http.server 8000       # then open http://localhost:8000/web/catalog.html
```

The ROM and everything extracted from it are gitignored. Only tools and notes are versioned.

## Credits

- **[gerbiljames/mario-tennis-gbc-disasm](https://github.com/gerbiljames/mario-tennis-gbc-disasm)** by
  James White (MIT): a byte-perfect RGBDS disassembly of the same ROM with named routines, a RAM map
  and write-ups of the match engine, story mode, screens and save format. Vendored at
  `third_party/mario-tennis-gbc-disasm/` (commit 8e20e33, its MIT license alongside). The match engine
  port (`web/js/engine/`) follows its routine names and RAM layout; this project's own analysis
  (`tools/disasm.py`, the emulator traces, `labels.csv`) is cross-checked and corrected against it, and
  where a name or fact here comes from it the label comment or note says so.
- **Fonts** for the full-game page's HD text option (`web/js/hdtext.js`): [Itim](https://github.com/cadsondemak/itim)
  (Cadson Demak) and [Kode Mono](https://github.com/isaozler/kode-mono) (The Kode Mono Project Authors), both under
  the SIL Open Font License 1.1 (`web/fonts/OFL.txt`), and Luckiest Guy (Astigmatic) for the HD title, under the
  Apache License 2.0 (`web/fonts/LICENSE-Apache-2.0.txt`).

## Quick tour

```bash
python3 tools/disasm.py 0 2578 0x40          # Init
python3 tools/disasm.py MainLoop 0x40        # labels work as addresses
python3 tools/xref.py 0 1797              # who calls the LZ decompressor
python3 tools/decompress.py 01:607c       # decompress one block
python3 tools/render_map.py 18            # render RPG map 18 (dorm rooms)
python3 tools/dump_text.py 26             # all messages of text bank $26
./re_loop.sh --max 5                      # autonomous follow-up sessions
```

## Emulator harness (PyBoy) and how to rebuild the states

`pip install pyboy numpy` (numpy comes with PyBoy). All drivers live in `tools/` and import
`tools/emu/session.py`. States and recordings go to `states/` (gitignored, regenerate as below).

```bash
# 1. boot to the title, press START twice -> main menu (states/after_boot.state, main_menu.state)
python3 tools/emu_boot.py --frames 2400 --every 200 --keys 1000:start,1400:start,1700:a,2000:a --fresh --save states/after_boot.state
python3 tools/emu_boot.py --frames 1650 --every 1650 --keys 1000:start,1400:start --fresh --save states/main_menu.state

# 2. exhibition: Luigi vs Baby Mario on the hard court, serve ready (states/m1.state, m2.state)
python3 tools/emu_trace_loads.py --state states/after_boot.state --keys 30:a,120:a,200:a,280:a,360:a,440:a,520:a,600:a,700:start --frames 1200 --save states/m1.state
python3 tools/emu_trace_loads.py --state states/m1.state --keys 20:right,60:a,160:a,260:a,360:a,460:a,560:a,660:a,760:a --frames 1800 --save states/m2.state

# 3. recordings used by the analysis tools and the JS physics test
python3 tools/emu_record.py states/m2.state serve "10:a,60:a:4,90:right:30,150:a" 240      # states/rec_serve.npy
python3 tools/emu_bot.py states/m2.state rally1 2400                                     # bot rally, WRAM4/5 included
python3 tools/gen_phys_ref.py && node web/tests/physics_vs_emulator.mjs                  # expect <= 0.52 px

# 4. Mario Tour save: Create Character (states/t1..t4), see REVERSE.md "Character records & stats"
python3 tools/emu_step.py states/main_menu.state states/t1.state "down,a@120"     # pick a character
python3 tools/emu_step.py states/t1.state states/t2.state "a@120"                 # stat screen (OK?)
```

```bash
# 5. shot selection: trace the game's aiming/trajectory pipeline during bot rallies, check the decoded
#    rules against the ROM tables, then replay the same inputs through the web port's shots.js
python3 tools/emu_shot_trace.py states/rec_rally1_end.state 8000 --alt --out states/shots.json
python3 tools/analyze_shots.py states/shots.json && node web/tests/shots_vs_emulator.mjs states/shots.json
```

```bash
# 6. sound: decode a song, log the live note stream, check the web port's driver against it, render a WAV
python3 tools/dump_sound_seq.py 02 --max 40
python3 tools/emu_seq_trace.py states/title.state 1200 | grep '^f' > states/seq_title.txt
node web/tests/sound_vs_emulator.mjs states/seq_title.txt 02 && node web/tests/render_song.mjs 02 16 out/title.wav
```

```bash
# 7. the full game on the project's own GBC core: lockstep check against PyBoy, audio render, headless page shots
python3 tools/emu_frame_hashes.py 900 out/pyboy_hashes.txt --png 60 && node web/tests/core_vs_pyboy.mjs out/pyboy_hashes.txt
node web/tests/core_audio.mjs out/core_title.wav --seconds 12 --start 400 && node web/tests/full_frame.mjs out/full
# 8. static translation of the game to JavaScript (web/gen/game.js, not committed) and its lockstep proof
node web/tests/record_coverage.mjs states/coverage.json --frames 7000 --auto   # coverage seeds from the core itself
python3 tools/recomp.py --coverage states/coverage.json && node web/tests/recomp_vs_interp.mjs --frames 1500 --keys 332:start,632:start
# 9. 3D views (all headless page tests use `python3 -m http.server 8765` from the project root): a match reached by
#    key script, and an RPG area from a PyBoy snapshot (states/ is not committed: make one with emu_boot.py --save after
#    walking into the Academy, or any state whose wCurMapID $C32E is 17-36)
node web/tests/view3d_frame.mjs out/view3d && python3 tools/emu_dump_snapshot.py states/menu1.state out/snap_menu1.json && node web/tests/view3d_field.mjs out/snap_menu1.json out/view3d_field.png
python3 tools/emu_dump_snapshot.py states/menu_court.state out/snap_court.json && node web/tests/view3d_snap.mjs out/snap_court.json out/court_green --keys ArrowDown@10,KeyZ@40 --frames 430   # any court from the court menu
node web/tests/play_match.mjs out/match --max 45000 --video 300:3000:2    # a bot plays a whole match; 2D + 3D shots per point, frames for a video
node web/tests/snap_walk.mjs out/snap_menu1.json out/walk --keys KeyZ@60-64,KeyZ@104-108 --shots 30,700   # overworld 3D + dialogue overlay
node web/tests/stick_walk.mjs out/snap_menu1.json out/stick.png                  # virtual analog stick -> d-pad keys
node web/tests/replay.mjs recording.mtrec --shots 600 --states 3600         # replay a REC session from the app, verified frame hashes
node web/tests/replay_view.mjs recording.mtrec out/rv --every 4 --vox         # play it in the 3D view, flag misplaced sprites (+ shots)
node web/tests/court_map_diff.mjs out/replay/s001800.json.gz                    # which court map the VRAM tilemap matches
node web/tests/engine_math.mjs 4000                                              # match engine: math helpers vs the ROM
node web/tests/engine_routines.mjs rec.mtrec [filter] --every 9                  # match engine: every routine vs the ROM on recorded states
node web/tests/engine_lockstep.mjs rec.mtrec                                     # match engine runs a whole recorded match beside the game
node web/tests/engine_setup.mjs rec.mtrec                                        # match setup vs the game at match start
node web/tests/engine/make_rec.mjs out/engine/exh1.mtrec                         # scripted exhibition match recording
node web/tests/engine_page.mjs out/engine_page                                   # the web port (index.html) playing on the engine
```

Other drivers: `emu_charmatch.py K` (start a match with the K-th character and dump WRAM),
`emu_dump.py`, `emu_find_seq.py`, `emu_poke_redraw.py`, `emu_fullmatch.py` (bot plays a whole
set with routine hooks), `emu_sound_ids.py` / `emu_sound_timeline.py` / `emu_music_ids.py` (which sound
ids the game requests, by call site or as a timeline against hits and bounces), `render_glyph_sets.py`
(the score-font glyph sets), `compare_frames.py` (court render vs live frame). Web checks:
`web/tests/glyph_frame.mjs OUT.png` screenshots the port's point-score strip (needs the http server). Key scripts use absolute frame offsets; a press lasts 6 frames.

### Recording a video of the original game

```
# power-on -> intro -> title -> Exhibition -> Luigi vs Baby Mario -> first serve (3700 frames, ~62 s)
python3 tools/emu_video.py out/vid 3700 --fresh --keys 1000:start,1400:start,1700:a,2000:a,2100:a,2250:right,2350:a,2500:a,2620:a,2740:a,2900:a,2928:a
ffmpeg -f concat -i out/vid/frames.ffconcat -i out/vid/audio.wav -vf "scale=640:576:flags=neighbor,fps=60" \
       -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest clip.mp4
```
`--fresh` deletes `rom/mario_tennis.gbc.ram` (PyBoy's battery save) so the run starts from a blank save.
