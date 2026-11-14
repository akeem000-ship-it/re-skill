# Dead Ends & Investigation Notes

Read before starting a session. Append when stuck after 10+ tool calls with no progress.

Lifecycle: **Active** -> **Resolved** (prefix with RESOLVED + date once understood) -> delete after 20+ sessions.

## RESOLVED 2026-10-11 — Character sprite frame layout (banks 40-5D)
- **Tried**: rendering the 240-byte frames from the `$400E` pointer list as fixed 3×5 / 5×3 grids,
  row-major and column-major (8×8 and 8×16 OBJ order).
- **Failed because**: the top half looks right in column-major 3×5 but the lower tiles don't line up;
  15 tiles per frame is odd for 8×16 OBJ mode, so placement is probably data-driven.
- **Better approach**: find the OAM builder. xref writers of the OAM buffers `$C000`/`$C500` (via
  `wC3A7`), or callers that set ROM bank $40-$5D, and decode the per-frame table at `$7CE0`
  (4 bytes/frame: `fc f1 00 0c` = y,x offsets?) plus the anim scripts at `$7F24`.
- **Resolution**: OAM writer 00:2C2B/2CED uses 8x16 objects column-major (tile t -> col t//4, row t%4); per-frame info [dy,dx,flag,ntiles] gives 12 tiles = 3 columns. tools/render_sprites.py.
- **Session**: 001

## RESOLVED 2026-10-11 — Court maps rendered as garbage
- **Tried**: rendering banks 64-69 4096-byte blocks as 32×128 with tiles at $8000.
- **Failed because**: the map is 64×64 tiles, the tiles go to **VRAM bank 1** with signed
  ($9000) indexing, and `CopyToVRAM` encodes VRAM bank 1 as destination `$A000-$BFFF`.
- **Better approach**: trace the loader (`0A:585D LoadMap`). Done: `tools/render_map.py`.
- **Session**: 001
