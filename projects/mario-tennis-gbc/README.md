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
python3 tools/dis.py 0 2578 0x40          # Init
python3 tools/dis.py MainLoop 0x40        # labels work as addresses
python3 tools/xref.py 0 1797              # who calls the LZ decompressor
python3 tools/decompress.py 01:607c       # decompress one block
python3 tools/render_map.py 18            # render RPG map 18 (dorm rooms)
python3 tools/dump_text.py 26             # all messages of text bank $26
./re_loop.sh --max 5                      # autonomous follow-up sessions
```
