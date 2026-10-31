# Mario Golf (GBC) RE project — conventions

Start with HANDOFF.md (the plan) if this project is new to you.

- Binary: `rom/mario_golf.gbc` (USA, SHA-1 `7f2062e51b4fc87378c1d5e6b9578c9277b94e0b`). Not committed: copy your own
  dump there.
  Derived output (`gfx/`, text and scene dumps, `out/`, `states/`, `web/gen/`) is gitignored; rebuild it with
  `python3 tools/gen_all.py` (needs `pip install pypng`).
- Platform: Game Boy Color only (CGB flag `$C0`), SM83 CPU, MBC5 + RAM + battery, 128 x 16 KB banks, 8 KB SRAM
  (confirmed from the header: `python3 tools/header.py`).
- Address notation: `BB:AAAA` (bank hex, CPU address hex). Bank-0 addresses may omit the bank.
- labels.csv: `bank,addr,name,comment`, bank hex without prefix, addr hex without prefix. RAM/HRAM/IO labels use
  bank `*`. A name taken from a matching Mario Tennis routine says so in its comment: `(as in Mario Tennis 00:XXXX)`.
- Tool prefix: `python3 tools/`. All tools load `labels.csv` and `rom/mario_golf.gbc` from this folder.
- Never use third-party disassemblers. Write a .py in tools/ rather than inline `python3 -c`. Tools may be copied
  from `../mario-tennis-gbc/tools/` and adapted.
- ROM conventions (add one only after a tool has shown it in this ROM; see REVERSE.md "Architecture"):
  - `rst $18 ; db idx, bank` is the far call (FarCall 00:01B6, same code as Tennis); `rst $10 ; db idx, bank` is
    a second, rarer far call (00:01F6). Both jump to the word at `bank:$4000+idx`.
  - most banks start with a `$4000` word table of exports/assets (`tools/scan_jumptables.py`; bank 46's two
    words are not one);
  - `rst $00` is followed by an inline `dw` jump table indexed by A (00:0690);
  - `rst $08 ; db id` plays a sound (00:2BBB);
  - `rst $20/$28/$30 ; dw n<<5` set / clear / test flag n (same routines as Tennis);
  - assets are LZ-compressed in Tennis's format (LZDecompress 00:1F2F; `tools/decompress.py`).
  - text is ASCII in banks 18-1F; a text id is `bank = $18 + ((id >> 10) & 7)`, `index = id & $3FF`; control
    codes below `$20` (REVERSE.md "Text"; `tools/dump_text.py`).
