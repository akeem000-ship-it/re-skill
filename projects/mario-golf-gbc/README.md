# Mario Golf (Game Boy Color) — reverse engineering

Project for the `/re` skill (see `../../SKILL.md`), following the Mario Tennis project in
`../mario-tennis-gbc/`. Not started yet: see [HANDOFF.md](HANDOFF.md) for the plan.

## Setup

```bash
pip install pypng pyboy
mkdir -p rom && cp /path/to/your/Mario_Golf_USA.gbc rom/mario_golf.gbc
sha1sum rom/mario_golf.gbc          # record it in CLAUDE.md and here
```

Expected header (Data Crystal, USA): title `MARIO GOLF`, header checksum `$7A`, global checksum `$0FC7`.

The ROM and everything extracted from it are gitignored. Only tools and notes are versioned.
