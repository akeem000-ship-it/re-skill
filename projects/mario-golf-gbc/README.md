# Mario Golf (Game Boy Color) — reverse engineering

Project for the `/re` skill (see `../../SKILL.md`), following the Mario Tennis project in
`../mario-tennis-gbc/`. Plan: [HANDOFF.md](HANDOFF.md). Findings: [REVERSE.md](REVERSE.md).

## Setup

```bash
pip install pypng pyboy
mkdir -p rom && cp /path/to/your/Mario_Golf_USA.gbc rom/mario_golf.gbc
sha1sum rom/mario_golf.gbc          # USA: 7f2062e51b4fc87378c1d5e6b9578c9277b94e0b
python3 tools/header.py             # header fields and both checksums
```

Expected header (Data Crystal, USA; confirmed on the dump above): title `MARIO GOLF`, header checksum `$7A`,
global checksum `$0FC7`.

## Tools so far

| Tool | Purpose |
|------|---------|
| `header.py` | header fields, SHA-1, both checksums |
| `disasm.py` | SM83 disassembler with labels.csv and the inline RST arguments |
| `compare_home.py` | finds Mario Tennis home routines in Golf's bank 0 (needs `../mario-tennis-gbc/third_party/`) |
| `farcall_stats.py` | counts `rst $10` / `rst $18` far-call patterns against a baseline |
| `scan_jumptables.py`, `bank_map.py` | per-bank `$4000` tables, LZ entries, far-call graph |
| `decompress.py` | the LZ format (00:1F2F) |
| `dump_text.py`, `text_stats.py` | the text banks 18-1F |
| `dump_maps.py`, `render_map.py` | overworld map table, headers and graphics |
| `dump_songs.py`, `compare_banks.py` | music table; byte comparison of two banks |
| `extract_tiles.py`, `byte_hist.py`, `hexdump.py` | LZ tile sheets; value histograms; hex dumps |
| `gen_all.py` | rebuilds every derived file (`docs/text_dump.txt`, `gfx/`) |
| `emu/session.py`, `emu_boot.py`, `emu_verify.py` | PyBoy wrapper; boot with screenshots; decoders checked against the running game |
| `emu_script.py` | shared button scripts; writes `states/stroke_hole1.state` (hole 1 of a Stroke round) |
| `emu_watch.py`, `emu_peek.py`, `emu_state_peek.py` | memory changes frame by frame; memory dumps at a frame or from a state |
| `emu_callers.py`, `emu_lzlog.py` | who calls a routine (stack walk); every LZ load with source and destination |
| `render_hole.py`, `hole_stats.py`, `emu_hole_check.py` | golf holes and terrain maps; hole statistics; hole assets vs the game's memory |
| `dump_save.py` | SRAM save: signature, checksum, backup, block directory |
| `golfmath.py`, `test_math.py`, `emu_callfn.py`, `probe_fn.py` | bank-0 math in Python; checked against the ROM routines called inside PyBoy |
| `ball_sim.py`, `emu_ball_record.py`, `emu_regs_at.py` | exact ball simulator; per-step ball recordings; registers at an address |
| `sm83.py`, `test_sm83.py` | SM83 interpreter that runs ROM code with Python overrides; checked against the math ports |
| `swing_py.py`, `joypad.py` | the swing (address step, meter, impact pad, animation timing, landing preview) and the joypad in Python |
| `trace_code.py`, `coverage.py` | static code trace (copied from Tennis); share of the traced code inside named routines |
| `launch_py.py`, `test_launch.py`, `emu_launch_record.py` | ShotLaunch (swing result -> ball velocity) in Python; checked on recorded launches and random swings |
| `cup_sim.py`, `test_cup.py`, `shot_py.py`, `shot_run.py` | the cup and pin in Python (checked against the ROM on random states); BallTask and the shot's main thread in Python; a recorded shot run in Python only |
| `shot_sim.py`, `emu_shot_record.py`, `shot_suite.py` | whole-shot replay (the game's main loop in the interpreter vs a PyBoy recording); the shot suite (27 cases, four modes) |
| `emu_mkstate.py`, `emu_poke_state.py` | new states from a button script or from RAM pokes |
| `emu_between.py`, `emu_green_check.py`, `find_terrain.py` | ball-state writes outside BallTask; hole assets in WRAM; positions of a terrain type |
| `xref.py`, `search_bytes.py`, `find_bytes.py`, `decode_tables.py`, `relsearch.py`, `strings_dump.py` | generic, copied from Tennis |

The ROM and everything extracted from it are gitignored. Only tools and notes are versioned.
