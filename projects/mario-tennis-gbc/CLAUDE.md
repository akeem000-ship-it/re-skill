# Mario Tennis (GBC) RE project — conventions

- Binary: `rom/mario_tennis.gbc` (SHA-1 `414ba58340a27fc27b127bc01455b32764151ff0`). Not committed —
  copy your own dump there. Derived output (`gfx/`, `docs/text_dump.txt`) is gitignored; rebuild
  with `python3 tools/gen_all.py`.
- Platform: Game Boy Color, SM83 CPU, MBC5, 128 × 16 KB banks.
- Address notation: `BB:AAAA` (bank hex, CPU address hex). Bank-0 addresses may omit the bank.
- labels.csv: `bank,addr,name,comment` — bank hex without prefix, addr hex without prefix.
  RAM/HRAM/IO labels use bank `*`.
- Tool prefix: `python3 tools/`. All tools load `labels.csv` and `rom/mario_tennis.gbc` from the project root.
- Key conventions of this ROM (see REVERSE.md "Architecture"):
  - every bank's `$4000` holds a word table of exports/assets;
  - `rst $18 ; db idx, bank` is a far call (dis.py resolves the target);
  - `rst $00` is followed by an inline jump table; `rst $08 ; db id` plays a sound;
  - `rst $20/$28/$30 ; dw n<<5` set/clear/test event flag n;
  - assets are LZ-compressed (`tools/decompress.py`); text is ASCII.
- Never use third-party disassemblers. Write a .py in tools/ rather than inline `python3 -c`.
