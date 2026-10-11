# Mario Tennis (Game Boy Color) — Reverse Engineering Notes

## Binary Identification

| Field | Value |
|-------|-------|
| File | `rom/mario_tennis.gbc` (not committed — supply your own dump) |
| SHA-1 | `414ba58340a27fc27b127bc01455b32764151ff0` |
| MD5 | `50af67f7321d84bd052f0e793ee0613c` |
| Format | Game Boy cartridge image, Nintendo logo header at $0104 |
| Title / Game code | `CGBTENNIS` / `BM8E` (header $0134-$0142) |
| CGB flag ($0143) | `$C0` — CGB **only** (DMG shows a "Game Boy Color only" screen) |
| Licensee | new `01` (Nintendo), old `$33` |
| Cartridge type ($0147) | `$1B` MBC5 + RAM + Battery |
| ROM size ($0148) | `$06` = 2 MB = 128 × 16 KB banks |
| RAM size ($0149) | `$03` = 32 KB = 4 × 8 KB SRAM banks |
| Destination / version | `$01` (non-Japan) / `$00` |
| Header checksum | `$A5`, global checksum `$64E3` |
| Platform / CPU | Game Boy Color, Sharp SM83 (LR35902) @ 4/8 MHz |
| Entry point | `$0100: nop; jp $0150` → `$0150: jp Init ($2578)` |
| Developer | Camelot (published by Nintendo, 2000) |
| Build string | `$0153`: ASCII `"10011171737"` (possibly build date/time 2000-11-17 17:37?) |

---

## Memory Map

| Address Range | Purpose |
|---------------|---------|
| `0000-3FFF` | ROM bank 0 (fixed): RST vectors, interrupt vectors, bank-switch trampolines, LZ decompressor, common libs |
| `4000-7FFF` | Switchable ROM bank 1-127 (MBC5 `$2000` low byte; game never writes `$3000`, max bank `$7F`) |
| `8000-9FFF` | VRAM (2 banks via `rVBK`) |
| `A000-BFFF` | SRAM (4 banks, `$4000` register, shadow `hSRAMBank` $FF97) — save data |
| `C000-CFFF` | WRAM bank 0 |
| `D000-DFFF` | WRAM bank 1-7 (`rSVBK`, shadow `hWRAMBank` $FF96). Stack top `$D000` (grows down into C) |
| `FE00-FE9F` | OAM (DMA from `$C000` via HRAM routine `$FF80`) |
| `FF80-FFFE` | HRAM: OAM DMA routine at `$FF80` (10 bytes), game vars from `$FF8D` |

Key HRAM shadows: `hROMBank $FF95`, `hWRAMBank $FF96`, `hSRAMBank $FF97`, `hIsCGB $FFFE`.

---

## Data-Range Map

| Start | End | Size | Classification | Notes |
|-------|-----|------|----------------|-------|
| 00:0000 | 00:0067 | 0x68 | code | RST + interrupt vectors (jp stubs, $FF fill) |
| 00:0100 | 00:014F | 0x50 | header | cartridge header |
| 00:0150 | 00:0152 | 3 | code | jp Init |
| 00:0153 | 00:015D | 11 | data | ASCII build string |
| 00:015E | 00:024D | | code | far-call / bank-table trampolines |
| 00:03AF | 00:0464 | | code | memclear/memcopy helpers |
| 00:06AC | 00:06C3 | | code+data | OAM DMA installer + routine |
| 00:1797 | 00:188A | 0xF4 | code | LZ decompressor |
| 00:249F | 00:2577 | | code | event-flag bit array helpers (rst $20/$28/$30) |
| 00:2578 | 00:2630 | | code | Init (hardware setup) → farcall MainLoop |
| 00:2631 | | | code | VBlank handler body (via $0040 → $2749?) — TBD |
| 01-77 | 4000 | | table | most banks start with a word table at $4000 (see Bank Tables) |
| 78-7E | | 7×16 KB | data | no $4000 table, dense non-zero — likely audio/sample data (TBD) |
| 7F | | 16 KB | padding | 92% $FF |
| 40-5D | | 30×16 KB | data | single-entry table → $4002; ~38% zeros. Uncompressed graphics? (TBD) |

---

## Key Findings

### Architecture — banking & calling conventions

Camelot's code uses a uniform **per-bank jump table at `$4000`**: every code bank begins
with a list of little-endian words pointing to its exported entry points (data banks use the
same layout to index assets). All cross-bank calls go through it:

| Mechanism | Encoding | Handler | Semantics |
|-----------|----------|---------|-----------|
| `rst $10` / `rst $18` | `rst; db idx, bank` | `01B6 FarCallInline` | call `[bank:$4000+idx]`, preserving A/HL; restores previous bank |
| `call $01F6` | `call; db idx, bank` | `01F6 FarCallInline2` | same, alternative form |
| `call $015E` | A=bank, HL=addr | `FarCallHL` | direct far call |
| `call $0184` | A=bank, HL=table, B=index | `FarJumpTable` | call table[B] in bank A (skip if null) |
| `call $021A` | H=bank, L=idx | `FarCallBankTableH` | call `[bank:$4000+L]` via MemCopy? (TBD) |
| `rst $00` | A=index; `dw` table inline after rst | `06C4 JumpTableInline` | `jp [table + 2A]` — state machine dispatch |
| `rst $08` | `rst; db id` | `2FB3 SoundCmdInline` | sound/command request (ids <$40, $40-$4F, ≥$50 handled differently) |
| `rst $20/$28/$30` | `rst; dw flag<<5` | `255E/256B/2551` | set / clear / test bit in **event-flag array `wEventFlags` $C9C0** |

The current ROM bank is always mirrored in `hROMBank ($FF95)` before writing `$2000`.

`tools/dis.py` decodes all of the inline-argument forms and resolves farcall targets.

### Interrupts

| Vector | Target | Notes |
|--------|--------|-------|
| `$40` VBlank | `$2749` | TBD |
| `$48` STAT | `$27F5` | LYC=$50 set in Init |
| `$50` Timer | `$27D7` | TMA=$77, TAC=4 (4096 Hz) → ~16.4 kHz/(256-$77) ≈ 30 Hz? — likely sound driver tick |
| `$58` Serial | `$2861` | link cable (2-player) |

Init (`$2578`): detects CGB (A=$11 at boot → `hIsCGB`), SP=$D000, clears WRAM/HRAM, on DMG
farcalls `01:6030 InitDMG` (draws the "only on Game Boy Color" screen and halts), sets
`WX=7, WY=$90`, timer, STAT LYC=$50, serial, IE=$0D (VBlank+Timer+Serial), LCDC=$E7, then
`rst $18 00 01` → `01:4018 MainLoop`.

### LZ compression (`00:1797 Decompress`, tool: `tools/decompress.py`) — VERIFIED

HL=source, DE=destination; returns HL = decompressed size.

```
loop: ctrl = *src++                ; 8 flag bits, LSB first
      for each bit:
        1 -> *dst++ = *src++                         (literal)
        0 -> lo = *src++, hi = *src++
             if lo == 0 && hi == 0: done
             disp = ((hi >> 5) << 8 | lo) - 0x800     ; -2048..-1
             len  = (hi & 0x1F) + 3                   ; 3..34
             copy len bytes from dst+disp
```

Verified by rendering the DMG-only screen (tiles `01:607C` → 4096 B, map `01:6903` → 576 B = 32×18):
`gfx/screen_dmg_only.png` is a pixel-perfect "MARIO TENNIS — This game can be played only on Game Boy (R) Color." screen.

Wrappers: `0234 DecompressBankTable` (H=bank, L=idx → `[bank:$4000+L]`),
`06CF DecompressBankTable2` (two-level), `0692 DecompressFar` (A=bank, HL=src).

### Asset banks

`tools/scan_assets.py` finds **599** LZ blocks referenced from bank tables (clean termination
landing at the next entry). Distribution (ulen → count):

| Banks | Contents (hypothesis) |
|-------|-----------------------|
| 17, 19, 3A | 1024 B and 4096 B blocks — BG tile sets + 32×32 tilemaps (3A:00 = tennis-dictionary/menu tiles, verified visually) |
| 18 | 33× 64-byte blocks = **CGB palette sets** (8 palettes × 4 colors BGR555) |
| 39, 3C, 3D, 3F, 6C, 6D | mixed 64 / 240 / 256 / 320 / 1024 / 4096 — palettes, small tilemaps (20×12, 20×16), tiles |
| 5F-63 | 1024 + ~3-4 KB tiles |
| 64-69 | repeating 8-entry groups: `[stub, raw 64B palette, 4096 map, 4096 attr-map, 1024, 1024, stub, ~3 KB tiles]` — courts? Layout of the 4096 maps not yet understood (32×128 render is wrong) |

### Text system — VERIFIED (tool: `tools/dump_text.py` → `docs/text_dump.txt`)

Text is **plain ASCII**. 13 text banks: `1F 25 26 30 31 32 33 34 35 36 37 5E 6E`, **4,109 messages**.

| Offset | Content |
|--------|---------|
| `$4000` | `dw GetMsg` — DE=message index → copies to `wTextBuffer $C600` (max 159 chars) |
| `$4002` | `dw GetName` — DE=index → copies to `wNameBuffer $D880` (max 15 chars) |
| `$4004` | u16 offset table, relative to TEXT_BASE (the `ld hl,imm` in the stub) |

Control codes (counts across the ROM): `$00` end, `$01` newline, `$02` next page (695),
`$03` end of dialogue / wait (2036), `$04` item name, `$07` player name (246),
`$0E nn` named entity nn (school/character), `$06 $0B $1A $09 $11 $0C $14 $1D` TBD.

### Maps & courts — VERIFIED (tool: `tools/render_map.py` → `gfx/maps/map_NN.png`)

`0A:585D LoadMap(A=id)`, descriptor table `0A:59D9`, 37 entries × 16 bytes = 8 × (idx, bank)
references into bank tables:

| Word | Size | Destination | Content |
|------|------|-------------|---------|
| w0 | $88 raw | WRAM6:DC08 | header (RPG maps); bytes +4/+5 = width/height in tiles; DC0A-DC0D → wC329-wC32C |
| w1 | $40 raw | WRAM1:D000 → pals 2-7 | 8 CGB BG palettes (game loads 2-7; 0-1 reserved for UI) |
| w2 | LZ | WRAM3:D000 | tilemap, stride 32 (courts, 1024 B) or 64 (RPG, 4096 B) |
| w3 | LZ | WRAM2:D000 | CGB attribute map (same size). bit3=VRAM bank 1, bits0-2 palette, bit5/6 flip |
| w4 | LZ 1024 | WRAM6:D000 | TBD (collision?) |
| w5 | LZ 1024 | WRAM6:D400 | TBD |
| w6 | — | not loaded by LoadMap | |
| w7 | LZ | WRAM1:D000 → VRAM1 $9000 (2 KB) + $8800 | BG tiles, signed indexing |

* Maps 0-15 (banks `$5F-$63`): **tennis courts**, 32×32 (Peach's Castle, grass/clay/hard,
  Nintendo stadium, Yoshi's fruit court, a mosaic/transition background (#6), …).
* Maps 16-36 (banks `$63-$69`): **RPG-mode areas**, 64×64 (dorm rooms, academy campus,
  tournament venues, island overview, star background #16).

`0480 CopyToVRAM` convention: a destination in `$A000-$BFFF` means **VRAM bank 1** (bit 5 of D
cleared, VBK=1); if the LCD is on, copies go through a queued HDMA path.

### Data Structures

*(TBD)*

### State Machine

*(TBD — MainLoop 01:4018 clears WRAM banks 1-6, then farcalls into banks 3 and 2)*

---

## Intermediate Output Files

| File | Contents |
|------|----------|
| `gfx/screen_dmg_only.png` | DMG-only warning screen (decompressor verification) |
| `gfx/lz/BB_II.png` | every LZ block ≥256 B as a grey 2bpp tile sheet |
| `gfx/lz/BB_II_pal.png` | every 64-byte LZ block rendered as 8 CGB palettes |
| `gfx/lz/index.json` | asset inventory for `web/catalog.html` |
| `gfx/maps/map_NN.png` | all 37 courts / RPG maps (full 32×32 or 64×64 tile planes) |
| `docs/text_dump.txt` | all 4109 messages from the 13 text banks |

---

## Verification Checklist

- [ ] Ph3: 3+ functions traced and cross-checked against emulator trace
- [ ] Ph4: 5+ sprites/tiles extracted and visually compared to emulator
- [ ] Ph5: key data struct confirmed in emulator memory dump, all fields match
- [ ] Ph6: full game session played, no major logic gaps found
- [ ] Ph7: web port pixel-compared against emulator screenshots

---

## Reference Resources

- Pan Docs (https://gbdev.io/pandocs/) — hardware registers, MBC5, CGB palettes
- No public disassembly of this game is known.

---

## Next Tasks

### RE Investigation

- [x] Ph1: identify binary header and platform
- [x] Ph2: identify compression (LZ at 00:1797) and write tools/decompress.py
- [x] Ph3: build instruction_set.py, dis.py, xref.py, search_bytes.py with inline-RST decoding
- [ ] Ph3: disassemble VBlank handler ($0040 → $2749) and document per-frame work (OAM DMA, palette upload, scroll)
- [ ] Ph3: trace MainLoop (01:4018) to its top-level game-state dispatcher (look for `rst $00` jump tables)
- [ ] Ph3: decode rst $08 SoundCmdInline (00:2FB3) — map command ids to music/SFX
- [ ] Ph3: identify the sound driver bank (likely 78-7E data + a code bank) via Timer ISR $27D7
- [x] Ph4: text encoding (ASCII + control codes) and text-bank layout; dump all 4109 messages
- [x] Ph4: understand banks 5F-69 map layout via LoadMap 0A:585D — all 37 maps render
- [ ] Ph4: find the dialogue font tiles and the text printer (control-code handler for $02/$03/$07/$0E)
- [ ] Ph4: decode map w4/w5 1 KB layers (collision / event triggers?) and header bytes 0-3, 6-$87
- [ ] Ph4: why do courts (maps 0-15) have w0 == w4? check the court-loading path (a different loader?)
- [ ] Ph4: decode banks 40-5D (single-entry table at $4002) — sprite/animation data?
- [ ] Ph4: pair tile/map/palette blocks into full screens (title screen first) using the loading code
- [ ] Ph5: decode SRAM save layout (03:495D checks signature at A020 vs 03:47E9)
- [ ] Ph5: find character stat tables (Mario, Luigi, Peach, … : power/speed/control/spin)
- [ ] Ph5: map wEventFlags ($C9C0) flag numbers used by RPG mode
- [ ] Ph4: build web/catalog.html asset browser from gfx/lz/index.json

### Web Port Fixes

### Documentation

- [ ] docs/architecture_exe.md
- [ ] docs/architecture_web.md
