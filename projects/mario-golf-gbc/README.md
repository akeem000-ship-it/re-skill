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
| `xref.py`, `search_bytes.py`, `find_bytes.py`, `decode_tables.py`, `relsearch.py`, `strings_dump.py` | generic, copied from Tennis |

The ROM and everything extracted from it are gitignored. Only tools and notes are versioned.
