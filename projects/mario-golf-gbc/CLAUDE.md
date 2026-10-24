# Mario Golf (GBC) RE project — conventions

Start with HANDOFF.md (the plan) if this project is new to you.

- Binary: `rom/mario_golf.gbc` (SHA-1: record it here on first dump). Not committed: copy your own dump there.
  Derived output (`gfx/`, text and scene dumps, `out/`, `states/`, `web/gen/`) is gitignored; rebuild it with
  `python3 tools/gen_all.py` once that exists.
- Platform: Game Boy Color, SM83 CPU, MBC5 + RAM + battery, 128 x 16 KB banks, 8 KB SRAM (Data Crystal; confirm
  from the header).
- Address notation: `BB:AAAA` (bank hex, CPU address hex). Bank-0 addresses may omit the bank.
- labels.csv: `bank,addr,name,comment`, bank hex without prefix, addr hex without prefix. RAM/HRAM/IO labels use
  bank `*`. A name taken from a matching Mario Tennis routine says so in its comment: `(as in Mario Tennis 00:XXXX)`.
- Tool prefix: `python3 tools/`. All tools load `labels.csv` and `rom/mario_golf.gbc` from this folder.
- Never use third-party disassemblers. Write a .py in tools/ rather than inline `python3 -c`. Tools may be copied
  from `../mario-tennis-gbc/tools/` and adapted.
- ROM conventions: none confirmed yet. Add each one here only after a tool has shown it in this ROM (candidates
  from Mario Tennis are listed in HANDOFF.md, "Hypotheses").
