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
