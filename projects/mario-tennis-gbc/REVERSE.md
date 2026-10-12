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
| 00:2631 | | | code | `WaitFrame`; VBlank body at `$2749` (via `$0040`) |
| 00:0B01 | 00:0B9C | | code+data | sin/cos multiply helpers + quarter-wave sine table `0B5C` |
| 00:2F1A | 00:3Dxx | | code+data | sound driver (`SoundUpdate`, `SoundStart 3297`, sequence interpreter `3566`, indexes `3151/31B5`) |
| 01-7F | | | | see the bank map below |

### Bank map (tool: `tools/bank_map.py` — exports, LZ blocks, traced code, far-call graph)

Confidence: **V** verified by code reading/emulator, **I** inferred from callers/data shape, **?** guess.

| Banks | Role | Conf. |
|-------|------|-------|
| 00 | RSTs/ISRs, far calls, LZ, tasks, joypad, VBlank, math (sine `0B5C`, multiply), sound driver `3129-3Dxx` | V |
| 01 | MainLoop/init, palettes, unreachable debug menu `01:40EC` | V |
| 02 | character records `02:52CE`, CPU shot profiles `02:5E23`, character/sprite setup | V |
| 03 | SRAM: signature/checksum/backup, block directory and save slots, persistent flags | V |
| 04 | RPG actor engine: bytecode interpreter `04:447D`, spawning, collision, camera, sprite table `04:4F75` | V |
| 05 | dialogue windows, VWF text printer and font, dialogue dispatch, field helpers | V |
| 06 | score / statistics panels: draws point and game digits into a window (`06:49F4`) | I |
| 07 | match setup/init `07:5DF9`, shot tables `07:4F11-5160`, roster → sprite `07:5A50` | V |
| 08 | match engine: ball physics, players, CPU AI, scoring, serve rotation | V |
| 09 | match HUD / scoreboard (`09:610C/611B`) | I |
| 0A | field engine: FieldScene, LoadMap, location table, events | V |
| 0B | **mini-games / training drills**: `0B:4705 RunMiniGame(A)` — ids 0-$11 via table `0B:47B4`, higher ids in bank 0D; called from scene code (banks 10/12/14/15), "Mini-Game n" text #353 | V |
| 0C | sound-format data: starts with music channel tables `[slot $40-$A0, flags, ptr]`, but the sound index only reaches banks 78-7F — unused / leftover sound bank | I |
| 0D | mini-games ≥ $12 (`0D:407F`) and serve/bounce helpers (`0D:4BC8`) | I |

**Mini-games / drills** (`0B:4705 RunMiniGame(A)`): 36 ids. Ids `$00-$11` → descriptor table
`0B:47B4` run by `0B:4002`; ids `$12-$23` → `0D:4090` run by `0D:4006`; `$24` is a special case.
Descriptor — **VERIFIED from `MiniGameRun 0B:4002` / `0D:4006`** (both read the same layout):

| Offset | → | Meaning |
|--------|---|---------|
| +0 | `wC3B1` | opponent roster id, loaded into player slot 2 (`02:4066`); `$FF` = none (e.g. id `$1C` = `$17` Luigi — "rally with Luigi") |
| +1 | `wC8F4` | court / map id |
| +2 | `wC8F3` | player count (2 singles, 4 with partners) |
| +3 | `wC8A6`, `wC8F6` | game mode |
| +4 | `wC8F7` | the mini-game id itself |
| +5 | `wC8F8` | music id (played by `08:47C6`) |
| +7 | slot 0 | player character (`$80` = the Mario Tour player; Mario-world games use roster ids such as `$1A`) |
| +8 | `08:671A` | pointer to the per-game rule/handler table (bank = current) |
| +A | `08:6728` | second handler pointer |
| +C | `call 06CE` | optional setup routine (0 = none) |
| +E.. | | the game's own callback words |

The level of the one-id-per-game mini-games (`$1D+`) is not in the descriptor; it comes from the caller.
**Ids → games, VERIFIED live** (`tools/emu_call.py` injects `A = id` at the `rst $18 → 0B:4705` site
`10:47FC` from a field state; screenshots of all 36 ids): ids `$00-$1C` follow the title texts
`26 #(43 + id)` — `$00-$02` Service Match 1-3, `$03-$05` Service Practice 1-3 (target areas, poles),
`$06-$08` Net Game Match, `$09-$0B` Net Game Practice, `$0C-$0E` Stroke Match ("didn't land past my
service line"), `$0F-$11` Stroke Practice (★ counter), `$12-$15` The Machine 1-4 (robot), `$16-$19` The
Wall 1-4 (arrow panels), `$1A` Machine Master, `$1B` Wall Master, `$1C` Boo Blast (Boo); then one id per
game with the level as a parameter: `$1D` Shooting Star (star), `$1E` Perfect Shot (?), `$1F` Target
Shot (?), `$20` Fruit Fantasy (melon/apple/banana), `$21` Banana Bunch, `$22`/`$23` Wario/Waluigi court
games (Two-on-One / Medallion Match — medallions visible in `$23`); `$24` (special case) is probably
Treasure Box. (The earlier guess "b0 = $37 + id = title" was wrong.) Titles: `26 #37-#97`, rules
`26 #98-#165`.

| 0E-15 | Mario Tour scene descriptors + scene code (actor scripts, event handlers) | V |
| 16 | post-match screens: "YOU WIN!" results (screens $13/$14) and match statistics ($23); `16:4477` debug doubles loop | V |
| 17, 19, 3A, 3C, 3D, 3F, 6C, 6D | LZ graphics: tiles, tilemaps, palettes for screens and menus (17 and 6D also hold code: screens $24/$44, ending $28) | V |
| 18 | OBJ palettes `18:4300`, palette fade keyframes (64-byte LZ blocks) | V |
| 1A | main menu (`1A:67D4`), tour menus/EXP display | I |
| 1B | tournament brackets (screens $29/$2A) and mini-game ranking ($2B) | V |
| 3B | exhibition / N64 tournament / tournament setup (screens $0C-$0F), Ringshot points ($12), Varsity team charts ($25/$26) | V |
| 3E | link play: warning, "LINKING...", link interrupted, racket select (screens $10, $11, $21, $22) | V |
| 1C | create-character / stat screens (`1C:430E`) | V |
| 1D | status screens (`1D:4016` from the main menu) | I |
| 1E | exhibition flow (`1E:400E`, main-menu Exhibition) | V |
| 1F, 25, 26, 30-37, 5E, 6E | **text banks** (GetMsg/GetName exports) | V |
| 20-23 | shot trajectory tables (export `$7E7D`) | I |
| 24, 28, 29-2C | shot/trajectory selection code and tables (called from 07/08) | ? |
| 27 | event versions of the scene descriptors (areas `1E-29`) | V |
| 2D-2F | math tables: sine (2D), projection (2E/2F, `00:2D8C`) | I |
| 38 | CPU difficulty `38:5FFB`, roster types `38:58FB`, name printing, VS / level screen ($01) and other menus ($00/$05/$06) | V |
| 39 | `LoadScreen 39:407E` + screen descriptors | V |
| 40-5D | character sprites (one per bank) | V |
| 5F-69 | maps: courts (5F-63), RPG areas (63-69) | V |
| 6A, 6F-72, 74-77 | NPC / mini-game sprites (header `+2 = 04 02`, several sprites per bank) | I |
| 6B | Nintendo/Camelot logos ($15), intro panels ($16-$1E), title ($1F): `6B:402A` | V |
| 73 | sprite-like data, different header | ? |
| 78-7F | sound data: music and SFX sequences (index `00:3151/31B5`); 7F mostly `$FF` | V |

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

`tools/disasm.py` decodes all of the inline-argument forms and resolves farcall targets.

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
| 18 | 64-byte LZ blocks = **palette keyframes** for fades/flashes: after a match they are decompressed in pairs every 6 frames, one to WRAM1 `$D000` (BG palettes) and one to `$D100` (OBJ palettes), stepping through `18:6B30…`/`18:6E4B…` (traced with `tools/emu_lz_trace.py`); the near-black entries are fade steps |
| 39, 3C, 3D, 3F, 6C, 6D | mixed 64 / 240 / 256 / 320 / 1024 / 4096 — palettes, small tilemaps (20×12, 20×16), tiles |
| 5F-63 | 1024 + ~3-4 KB tiles |
| 5F-69 | courts + RPG maps — fully decoded, see "Maps & courts" |
| 40-5D | character sprites — see "Sprites" |

### Text system — VERIFIED (tool: `tools/dump_text.py` → `docs/text_dump.txt`)

Text is **plain ASCII**. 13 text banks: `1F 25 26 30 31 32 33 34 35 36 37 5E 6E`, **4,109 messages**.

| Offset | Content |
|--------|---------|
| `$4000` | `dw GetMsg` — DE=message index → copies to `wTextBuffer $C600` (max 159 chars) |
| `$4002` | `dw GetName` — DE=index → copies to `wNameBuffer $D880` (max 15 chars) |
| `$4004` | u16 offset table, relative to TEXT_BASE (the `ld hl,imm` in the stub) |

Control codes (counts across the ROM): `$00` end, `$01` newline, `$02` next page (695),
`$03` end of dialogue / wait (2036). Substitutions (decoded from `MeasureText 05:5654`, which sizes the
window from the same stream):

| Code | Inserts | Source |
|------|---------|--------|
| `$04` | number | next word of the argument list `wD8B0` (counter `wD866`) — `05:51FE` |
| `$07` | player name (246 uses) | string at `wC900` — `05:5267` |
| `$08` | name by id | next byte of `wD8F0` (counter `wD868`) → name lookup `05:5CA8` → `wNameBuffer` — `05:5298` |
| `$09` | 5-digit number | next word of `wD8D0` (counter `wD867`) — `05:5305` |
| `$0B` | second name (partner/rival) | string at `wC940` — `05:527F` |
| `$0E nn` | named entity nn | name #(nn + $1B) via `05:409A` → `wC6C0` — `05:53E8` |

`$06` (67 uses) is a **pause** in the typewriter output — it follows "..." before a reveal ("What?!?{06} You won?",
"precious reputation...{06} and shove it!"); inferred from usage, the measurer ignores it. `$0C $10 $11 $12 $14 $1A $1D`
never occur on their own: they are the argument byte of `$0E` (entity names).

**Font and printer** (tool: `tools/render_font.py` → `gfx/font.png`, verified visually): 91 glyphs
`$20-$7A`, 8×8 **2bpp** tiles at `05:7920` (16 bytes each; colour 2 background, 3 ink, 1 shading),
proportional widths at `05:7F80` (3-8 px; `CharWidth 05:7366`). `DrawGlyph 05:7322` shifts each glyph
row by x & 7 and ORs it into a text-box tile buffer in **WRAM7 `$D300-$D7FF`** (`05:737A`); the
page printer `05:74DE` walks the string until `$02`/`$03`, moves down a line on `$01`, and the buffer is
uploaded to VRAM 16 tiles at a time (`05:7480`). Window placement/size: `05:5654` (`wD854` width in
tiles, `wD86F` line count, box table `wD800 + 4·wD824`).

### Maps & courts — VERIFIED (tool: `tools/render_map.py` → `gfx/maps/map_NN.png`)

`0A:585D LoadMap(A=id)`, descriptor table `0A:59D9`, 37 entries × 16 bytes = 8 × (idx, bank)
references into bank tables:

| Word | Size | Destination | Content |
|------|------|-------------|---------|
| w0 | $88 raw | WRAM6:DC08 | header (RPG maps): +2/+3 scroll minimum X/Y, +4/+5 width/height in tiles → `wC329-wC32C`; the camera (`04:440A`) clamps the scroll to [min, size − 20 × 18]. Bytes +6.. look like 8-byte records then BGR555 colours, but **nothing reads them**: no code references `$DC0E-$DC8F`, and overwriting them with `$00` or `$FF` during a field scene left 600 frames of screen output bit-identical (PyBoy, screen hashes every 50 frames). The fixed `$88`-byte copy just drags along whatever data follows the 6-byte header. Courts have no header: their w0 points at the w4 block. |
| w1 | $40 raw | WRAM1:D000 → pals 2-7 | 8 CGB BG palettes (game loads 2-7; 0-1 reserved for UI) |
| w2 | LZ | WRAM3:D000 | tilemap, stride 32 (courts, 1024 B) or 64 (RPG, 4096 B) |
| w3 | LZ | WRAM2:D000 | CGB attribute map (same size). bit3=VRAM bank 1, bits0-2 palette, bit5/6 flip |
| w4 | LZ 1024 | WRAM6:D000 | collision grid, one byte per 16×16 metatile: `$0` walkable, `$F` solid (RPG maps) |
| w5 | LZ 1024 | WRAM6:D400 | event-trigger ids per metatile (0 = none); door/warp/talk zones |
| w6 | — | not loaded by LoadMap | |
| w7 | LZ | WRAM1:D000 → VRAM1 $9000 (2 KB) + $8800 | BG tiles, signed indexing |

* Maps 0-15 (banks `$5F-$63`): **tennis courts**, 32×32 (Peach's Castle, grass/clay/hard,
  Nintendo stadium, Yoshi's fruit court, a mosaic/transition background (#6), …).
* Maps 16-36 (banks `$63-$69`): **RPG-mode areas**, 64×64 (dorm rooms, academy campus,
  tournament venues, island overview, star background #16).

`0480 CopyToVRAM` convention: a destination in `$A000-$BFFF` means **VRAM bank 1** (bit 5 of D
cleared, VBK=1); if the LCD is on, copies go through a queued HDMA path.

### RPG engine: actors and script bytecode — VERIFIED handlers (tools: `dump_script.py`, `emu_script_trace.py`)

Mario Tour field mode (`0A:4FF5` field loop, `0A:585D LoadMap`) moves **actors** with a small
per-actor bytecode. Actor table: **24 slots × $40 bytes in WRAM4 `$D000-$D5FF`** (slot 0 = the
player; NPCs from `$D100` on in the dorm state). The interpreter keeps the current slot pointer in
`hFFEA/hFFEB` and the bank of the running script in `wDAF7` (all operand reads go through
`00:0628 ReadFarByte` / `00:063D ReadFarWord`). Opcode table **`04:447D`**, 22 words.

Each handler returns `A=1` (run the next opcode this frame) or `A=0` (yield until next frame).

| Op | Bytes | Name | Semantics (handler) |
|----|-------|------|---------------------|
| 00/05/0F | 1 | yield | `04:460A` |
| 01 | 2 | wait n | `+3 = n-1`, yield (`460C`) |
| 02 | 1 | wait_arrive | retry each frame while `+5` bit7 (moving) is set (`45F8`) |
| 03 | 5 | warp X,Y | copy to `+C/+E` (position), clear moving (`4556`) |
| 04 | 5 | move_to X,Y | copy to `+8/+A` (target), set moving (`457B`) |
| 06 | 5 | move_rel dx,dy | target = position + (dx,dy), set moving (`45A0`) |
| 07 | 4 | move_dir h,dist | target = position + polar(h, dist) via `00:0AC5` (`44DF`) |
| 08 | 4 | move_turn h,dist | same with heading `h + facing(+14)` (`44EB`) |
| 09 | 3 | wander radius | only if `+30` bit7: up to 4 random headings (`0A3A` rand & $FC), step $100, must stay within `radius` of home `+16/+17` (`535C`) and pass three collision probes (heading, ±$20) (`534B`) (`4886`) |
| 0A | 1 | trail_leader | if distance² to leader (`+16` ptr) ≥ 8: copy leader speed, target = leader − polar(facing, $200) if not colliding (`46B0`) |
| 0B | 1 | approach_leader | target = leader position; speed $10/$18/$20/$40/$80 for distance² (tile units) <1/<4/<9/<16/else (`4623`) |
| 0C | 3 | jump_rel s16 | `pc = (address of operand) + s16` (`44D0`) |
| 0D | 4 | set_field off,w | write w to actor `+off`, width 1/2 from table `04:47FD` (`477F`) |
| 0E | 4 | add_field off,w | same, add (`47BA`) |
| 10 | 2 | set_anim n | `04:4BBB` (actor animation) |
| 11 | 2 | play_sound id | `00:3024 PlaySound` |
| 12 | 3 | call_native addr | FarCallHL into the script bank with BC = actor; repeats next frame while it returns A≠0 and B≠0 (`44A9`) |
| 13 | 1 | set_home | `+16/+17` = current tile (Y hi, X hi), speed 8, `+5` bit2 (wander mode), yield (`484E`) |
| 14 | 1 | wait_settle | stopped → wait 40 and advance; blocked (`+5` bit6) → wait 10 and advance; else retry (`4949`) |
| 15 | 4 | bit_op m,off,b | set (m=1) or clear bit b (mask table `04:4A1F`) of actor `+off` (`49DE`) |

Actor fields: `+3` wait counter, `+5` flags (bit7 moving, bit6 blocked, bit2 wandering), `+6` speed
(word), `+8/+A` target X/Y, `+C/+E` X/Y (16-bit, high byte = metatile column/row), `+14` facing
heading (256 = full turn), `+16` leader pointer or home tile, `+26` sprite, `+30` bit7
wander enable, `+36/+37` OAM attributes.

Examples (`dump_script.py`): the player is `04:41D1: yield; call_native $516B; jump -4` (joypad
control is native code); followers run `11:7BA9: set_anim 0; trail_leader; wait 1; loop`; a patrolling
NPC at `11:7CAD` alternates `move_rel ±1024; wait_arrive; set facing $40; set_anim 5; wait 75`.
`dump_scenes.py --scripts` disassembles every script referenced by the 42 areas' spawn lists: 48 scripts,
46 decode cleanly to their loop with this opcode table (2 end in a `yield` followed by non-script bytes),
which confirms the operand sizes. Most NPCs use `10:7BD1`/`11:7BA9` (stand / follow) or `set_home; wander`.

**Dialogue**: talking/trigger events go through `05:5C18`, a dispatcher whose table `05:5C3B` maps
event ids to farcalls of the 13 text banks' `GetMsg` export (`$4000`), so the text banks themselves
are the dialogue scripts (control codes `$02` page, `$03` wait/end, `$07` player name, `$0E nn` name).
Map layer w5 supplies the event id under the player; w4 is the collision grid used by `04:534B`.
Camera: `04:440A` clamps the scroll to the map size from the map header (+4/+5).

Sprite animation scripts (bank 08 `7791` player): `(frame, duration)` pairs; `$FF` = loop (restart
from the pointer in `wDF2A`), `$FE` = call `08:69EA`, `$FB n` = xor OAM attribute `wDF37` with n.

### Field scenes (locations) — VERIFIED formats (tool: `tools/dump_scenes.py` → `docs/scenes_dump.txt`)

The top level is `FieldScene 0A:4F40`, called forever by `GameTop`; `MainLoop` starts it with area
`wC280` = 0 and entry `wC295` = $0A. Exits and scripts change area/entry and the scene returns. The boot
trace shows the title and menus running from inside the first scene (area 00), i.e. from scene handler code.

* **Location table `0A:564F`**: 42 × 6 bytes `[area, map, idx, bank, music ($FF none), 0]`, loaded by
  `0A:5114` into `wC280-C285`. `bank:[$4000+idx]` points to a **scene descriptor** of 7 words copied to
  `wC286-C293`; the descriptor banks are `0E-15` (normal areas) and `27` (event versions of the same
  maps: no talk events, no music).
* Descriptor words: `+0` entry points, `+2` exits, `+4` actor spawns, `+6` talk events, `+8` a fourth
  event list (`0A:5574`), `+A` step-on triggers (`0A:55A5`), `+C` scene-init handler (`0A:5495`).
* **Entry record** (8 B, `$FF` ends; picked by id = `wC295`, else the first): `[id, facing, X(2), Y(2),
  init hook(2)]` → `wC29A`, `wC296/98`, `wC29C` (hook called at `0A:4FC1`).
* **Event record** (8 B, `$FF` ends; looked up by `0A:53E4` with D = id): `[id, facing mask, cond(2),
  handler(2), p6, p7]`. The facing mask (`$FF` = any) must match the player's quadrant (`wDAEA` top
  2 bits → mask table `0A:53B9`). `cond` 0 = always, flag n = only while event flag n is clear,
  `$8000|n` = only while n is set (`04:4C49`). Handler (`0A:541D`): 0 none, `< $4000` = message id
  (dialogue via `05:581F`), else code in the scene bank (`0A:40D0`). Exits: `p6/p7` = destination
  area and entry (`FieldOnExit 0A:560B`). Talk (`0A:54B5`, id = actor slot id): `p6` bit0 turn to
  the player, bit1 restore facing, bit3 talk animation, bit4 freeze actor.
* **Actor record** (14 B, ends when byte 9 = `$FF`; `04:4CF7` → `04:4C60`): `[cond(2), script(2),
  X(2), Y(2), facing, 0, sprite, anim, attr, 0]` — script runs in the scene bank with the bytecode
  of "RPG engine"; X/Y are 16-bit (high byte = metatile).

Exit, talk and step ids come from the map's w5 event layer (exits) or the actor slot (talk).

| Area | Map | Music | Descriptor | Entries | Actors | Talk | Step | Exits to areas |
|------|-----|-------|------------|---------|--------|------|------|----------------|
| 00 | 10 | - | `10:4e6c` | 1 | 0 | 0 | 0 | 04, 06, 0a, 14, 1d |
| 01 | 10 | - | `10:4ccb` | 1 | 0 | 16 | 1 | 01 |
| 02 | 10 | - | `0f:4006` | 1 | 12 | 12 | 1 | - |
| 03 | 10 | - | `10:4010` | 1 | 9 | 9 | 0 | - |
| 04 | 10 | $0b | `10:468d` | 1 | 16 | 16 | 1 | 00, 07, 0b, 0c, 0f, 10 |
| 05 | 11 | $1a | `10:74a9` | 7 | 4 | 4 | 0 | 05, 06, 07, 14 |
| 06 | 11 | $1a | `10:61b1` | 2 | 4 | 1 | 2 | 05, 07, 14 |
| 07 | 14 | $1b | `13:5c78` | 7 | 6 | 7 | 0 | 00, 05, 07, 08, 11 |
| 08 | 13 | $1b | `13:4006` | 8 | 0 | 1 | 5 | 07, 09, 0b, 0c, 0d, 0f, 10 |
| 09 | 1b | $1b | `12:4006` | 3 | 4 | 0 | 1 | 08, 0a |
| 0a | 12 | $00 | `13:4e20` | 6 | 3 | 2 | 1 | 00, 09 |
| 0b | 18 | $1b | `11:6822` | 2 | 16 | 10 | 0 | 08, 0b |
| 0c | 18 | $1b | `11:54c0` | 2 | 13 | 10 | 0 | 08, 0c |
| 0d | 19 | $1d | `10:5a80` | 2 | 17 | 15 | 0 | 08, 0e |
| 0e | 19 | $1d | `10:57f6` | 1 | 7 | 7 | 0 | 0d |
| 0f | 1e | $1b | `15:4796` | 7 | 21 | 20 | 1 | 08 |
| 10 | 17 | $1b | `12:52f7` | 2 | 12 | 15 | 1 | 08, 10 |
| 11 | 22 | $1d | `0e:4006` | 7 | 12 | 11 | 2 | 07, 12, 13 |
| 12 | 22 | $1d | `14:4008` | 3 | 3 | 3 | 5 | 11 |
| 13 | 22 | $1d | `12:467c` | 3 | 5 | 5 | 5 | 11 |
| 14 | 1a | $1b | `11:4401` | 4 | 18 | 4 | 1 | 05, 1b |
| 15 | 1c | $1b | `15:4004` | 5 | 11 | 7 | 1 | 16, 17, 19, 1b |
| 16 | 1d | $1b | `14:4fac` | 2 | 9 | 4 | 1 | 15, 19 |
| 17 | 1f | $1b | `14:4a39` | 2 | 17 | 9 | 1 | 15, 19 |
| 18 | 20 | $1d | `11:4008` | 3 | 4 | 4 | 1 | 19 |
| 19 | 23 | $1d | `0f:5f94` | 8 | 14 | 13 | 2 | 15, 16, 17, 18 |
| 1a | 24 | $1b | `0f:41db` | 3 | 20 | 10 | 2 | - |
| 1b | 15 | $1b | `14:5221` | 6 | 4 | 1 | 0 | 08 |
| 1c | 16 | $08 | `0e:75f6` | 1 | 14 | 0 | 0 | 08 |
| 1d | 21 | $12 | `0e:5248` | 5 | 18 | 16 | 0 | 1b |
| 1e | 1a | $2c | `27:7213` | 3 | 10 | 0 | 0 | 05, 1b, 1e |
| 1f | 13 | - | `27:6edf` | 1 | 0 | 0 | 0 | 07, 09, 0b, 0c, 0d, 0f, 10 |
| 20 | 1b | - | `27:6c18` | 3 | 4 | 0 | 0 | - |
| 21 | 18 | - | `27:6622` | 1 | 16 | 0 | 0 | 08, 0b |
| 22 | 19 | - | `27:6447` | 2 | 17 | 0 | 0 | 0e, 22 |
| 23 | 22 | - | `27:617f` | 2 | 5 | 0 | 0 | 11 |
| 24 | 17 | - | `27:5e15` | 1 | 6 | 0 | 0 | 24 |
| 25 | 14 | - | `27:55f0` | 1 | 0 | 0 | 0 | 25 |
| 26 | 1e | - | `27:5211` | 2 | 3 | 0 | 0 | 08 |
| 27 | 11 | - | `27:4bbc` | 2 | 8 | 0 | 0 | 14 |
| 28 | 23 | - | `27:460c` | 1 | 14 | 0 | 0 | 18 |
| 29 | 24 | - | `27:4018` | 1 | 12 | 0 | 0 | 08 |

Areas 00-04 use the star-background map `$10` (front-end / debug rooms: area 00 is the boot area,
init `10:4EB9`, exits to 04/06/0A/14/1D). The title, intro and menus are drawn inside these scenes by
code in banks `6B` (intro: `6B:402A`, `6B:75AF`), `1A` (`1A:67D4` menu), `3B`, `3E`, `16` and `38`
(all call `LoadScreen 39:407E`; `tools/emu_scene_trace.py` logs scenes, maps and screens live).
**Boot and main menu** (area 00 init `10:4EB9` → `10:4F0D`): when the entry id is `$0A` (power-on):
logos `6B:51AE/51E7`, intro `6B:402A`, title `6B:75AF` (repeats the intro while it returns `$FF`/1),
then `InitGameVars`, then the main menu `3B:55D1` returns a selection dispatched through `10:4FC6`:
0-2 → Mario Tour file 1-3 (`wSaveSlot`, `LoadGame`), 3 → `10:50FE` **Exhibition** (`1E:400E`),
4 → `10:5216` **Mini-Games** (`3B:61F0`, `1B:6B9C`), 5 → `10:52A0` **Linked Play** (`InitGameVars`,
`38:7408` character select), 6 → `10:52D1` **Status** (`1D:4016`), 7 → `10:54B0` **Dictionary**
(`3F:407A`), 8 → `10:54D6` **Saved Data** (`1A:7945`); `$FF` → back to the title. Verified in PyBoy by
pressing A on each cell of the 3×3 menu (row 0: Exhibition, Mini-Games, Linked Play — the last does
nothing without a link partner; row 1: files 1-3; row 2: Status, Dictionary, Saved Data).

MainLoop also contains an unreachable **debug menu** (`01:40EC`): Start → game, A → match test
`07:5DF9`, B → exhibition `3B:44A9`, Up → doubles test `16:4477`, Select → `01:6A5B`.

### Event flags (tool: `tools/dump_flags.py [--flag N]`)

`wEventFlags $C9C0` is a 256-byte bit array (flags 0-2047, flag n = byte n>>3, bit n&7) **inside the
`$C800` save image**, so story progress is saved with the slot. Access: `rst $20/$28/$30 ; dw n<<5`
(set/clear/test), `Set/Clear/TestFlagIdx $2509/$2523/$24EF` (DE = n), and the condition words of
scene records/actor spawns (`04:4C49`). 704 distinct flags are referenced (linear scan of the code
banks; a few hits in bank 01 data may be spurious).

* Flags 2040-2047 (byte 255) are transient system flags, set and cleared all over the front end.
* Flag 47 is tested 213 times; `04:4F1A` spawns the party followers (list `04:4EC8`) only while it
  is set — "followers shown in the field".
* Flags 83 and 87 are set once (`13:797B/797E`) and tested ~45 times each: story milestones.
* Flag 110 gates field music/palette setup in `FieldScene` (`0A:4F5D`, `0A:4FA7`).

### Sprites (banks 40-5D, 6F-71) — VERIFIED layout (tool: `tools/render_sprites.py`)

`04:4B68 LoadCharacterSprites(D=char id)` → `CharSpriteTable 04:4F75` (46 × `idx, bank`) →
16-byte header at `[bank:$4000+idx]` copied to `wSprHeader $DAD0`:

| Offset | Bank 40 | Meaning |
|--------|---------|---------|
| +0 | `06` | → wDF37/wDF3A (varies 3-7 per character; OBJ palette? TBD) |
| +2 | `03 00` | TBD (`04 02` in banks 6F-71) |
| +4 | `$400E` | frame tile-data pointer list → `wSprFramePtrs $DF24` |
| +6 | `$7F24` | animation table → `wSprAnimPtrs $DF28` (word per animation id; see below) |
| +A | `$7CE0` | per-frame info, 4 B: `dy, dx, flag, ntiles` → `wSprFrameInfo $DF38` |

`00:2E6B UploadSpriteFrame` copies `ntiles × 16` bytes of the current frame to VRAM (when `flag`
≠ 0, a second chunk at frame+$100 follows). Frames are drawn as **8×16 OBJs, column-major**
(`00:2C2B` 24×32 / `00:2CED` 32×32): tile *t* → column *t÷4*, row *t mod 4*. Typical frame:
`fc f1 00 0c` = 12 tiles = 24×32 px, offset (-4, -15). Frames are stored 240 B apart.

**Animations — VERIFIED** (tool: `tools/dump_anims.py BANK`). `SetAnimation 08:69EA (D = id)` loads
`[table + 2·id]` into `wDF2A` (start) / `wDF2C` (pointer); `AnimTick 08:7791` reads 2-byte entries:
`[frame, duration]` (frame < `$F0`, sets `wDF33`/`wDF2F`), `[$FF, n]` restart at start + n,
`[$FE, id]` switch to animation id, `[$FB, m]` OAM attribute `wDF37` ^= m (horizontal flip),
any other `$Fx` holds the frame. Bank 40 has 19 animations over 29 frame groups.
**Frame number = group × 5 + view** (`08:7621`): the view comes from the 8-way facing octant
`wDF32 = ((heading + $10) >> 5) & 7` through `08:7643 [2,3,4,3,2,1,0,1]` (0 = back … 4 = front; the
mirrored octants reuse a view), so the 145 frames are 29 groups × 5 views.
Animation ids used in a match (recorded with `tools/analyze_anims.py` on a `--banks` recording; P1 and P2
agree): 1 ready, 2 run, 16 serve stance → 17 ball bounce → 15 toss → 7 serve hit, 13/14 forehand/backhand
wind-up (`wDF15` = 5/6) → 9/10 swing (`wDF15` = 9/10; forehand when the ball is on the player's right),
11 high-ball swing, 4 point won, 3 point lost. 5-8 are short swings, 12 a held pose, 18 another
one-shot pose.

* Ids 0-29 → banks 40-5D, 145 frames each: back/front/side walks, forehand/backhand, lob,
  dive, smash, idle and victory poses (char 0 verified frame by frame).
* Char 26 (bank 5A) begins with ~40 frames of a large robot before the normal player frames.
* Ids 30-45 → banks 6F-71: different header (`+2 = 04 02`), 10-15 frames: NPC / mini-game sprites.
* **Which id is which character is unknown**: the order is not the text roster order.
  Needs sprite palettes or the character-select code.

Also in bank 0: `00:1332 MulSinCos` (angle in BC, +$40 = cos) reads a sine table in
**bank 2D**; `00:2D8C ProjectPoint` reads tables in **banks 2E/2F**. So banks 2D-2F are
**math tables**, not audio.

### Ball physics — VERIFIED (tools: `emu_record.py`, `analyze_ball.py`, `ball_sim.py`)

Found by recording WRAM every frame of a live point in PyBoy (serve, return, bounce, back-fence
rebound) and correlating fields. The re-implementation `tools/ball_sim.py --self` reproduces
the game with no inputs from the recording after the start frame: **0.03 px over a 33-frame
spinning serve** and **≤ 0.52 px (X/Y/Z) over 124 frames** of a return with two bounces and a fence hit.
The JS port (`web/js/physics.js`) is bit-identical to `ball_sim.py` (`web/tests/physics_vs_emulator.mjs`).

State (WRAM0):

| Address | Field | Format |
|---------|-------|--------|
| `C400` / `C404` / `C408` | X (lateral) / Y (depth, + = near side, net at 0) / Z (height, negative = up) | signed 16.16 |
| `C410-C41B` | previous position | copy |
| `C41E` | curve (sidespin) rate | 16-bit |
| `C420` / `C423` / `C426` | vX / vY / vZ (vZ positive = falling) | signed 8.16, 3 bytes |
| `C42A` / `C42C` | horizontal speed, 3D speed | 8.8 |
| `C4AC` / `C4AD` | bounce damping XY / Z | /256 (`$CD` = 0.80) |
| `C4B3` | event: 1 = ground bounce, 2 = fence | |

`BallStep 08:576B`, per frame:
1. save the previous position; **pos += vel** (`08:5A87`)
2. fences (`08:5949`): Y ≥ `$06E0`, Y < `-$0700` or |X| ≥ `$03A0` → negate that velocity
   (one's complement), re-step that axis, damp twice (×0.64)
3. net check (`08:5814`, sign change of Y), speed update (`wC42C` = |v|)
4. **drag** (`08:55B4`): k = (speed >> 4) + 1; each component v −= ⌊v·k/512⌋
5. **spin** (`08:5613`), VERIFIED to 0.03 px on a spinning serve:
   - sidespin `wC41E`: vX −= side·vY₈.₈ ≫ 12, vY += side·vX₈.₈ ≫ 12 (horizontal curve)
   - topspin `wC41C`: vZ += top·|vxy| ≫ 12 (dip, |vxy| from the pre-step velocity) and a horizontal
     push of −(top·vZ ≫ 13) along the heading `wC40E` (= atan2(vY, vX), `$40` steps) via
     `MulSinCos 00:1332` (sine table bank 2D: sin·32768, 1024 entries per 90°, 16-bit angles)
   - both spins decay: spin −= 3·(spin ≫ 8) per frame
   (products are shifted by magnitude, then the sign is reapplied)
6. airborne → **gravity vZ += `$4A00`** (0.289 px/frame²); on ground contact
   (`08:4677`): Z = −Z, vZ = ~vZ, then **damp** (`08:46B0`) X/Y by `wC4AC`, Z by `wC4AD`;
   if the rebound is slower than 2.31 px/frame the ball stops bouncing (Z = vZ = 0)

Observed serve: toss to Z ≈ −349 (gravity only); Luigi's serve leaves at ≈57 px/frame
(vX −15.9, vY −54.7); its first bounce on the far side costs 20% of the speed.

### Court, net, in/out and scoring — VERIFIED constants

World units: 1248 = half court length (39 ft), so 1 ft = 32 units. All constants match real tennis:

| Constant | Value | Where |
|----------|-------|-------|
| baseline | Y = ±1248 | serve position; `wC486` = −1248 in rallies |
| service line | Y = ±672 (21 ft) | `wC486` = −672 while a serve is in flight (`08:4CFF`), reset at first bounce (`0D:4BC8`) |
| singles sideline | X = ±432 (13.5 ft) | `wC484` = `$FE50` |
| doubles sideline | X = ±576 (18 ft) | `wC484` = `$FDC0` (`08:4300`, `wC8F2` = doubles) |
| net height | 96 | `wC488` (`08:40F7`) |
| back fences | Y = +1760 / −1792 | `08:5949` |
| side fences | X = ±928 | `08:5949` |

* **Net** (`08:5814`): when Y changes sign, if Z + 96 ≥ 0 (ball below the tape) → sound `$5A`,
  Y mirrored back, vX quartered (net hit); Z within −90..−88 gets net-cord handling.
* **In/out** (`08:463A`): `wC4B1` bit 0 = |X| ≥ sideline, bit 1 = |Y| ≥ length limit.
* **Score**: `wC8E0/1` sets, `wC8E2/3` games, `wC8E4/5` points (P1/P2, raw counts 0,1,2,3 = 0/15/30/40).
  Faults: `08:5B7F` (`wC8EE` second-serve flag, `wC4D8` 1 = fault, 2 = double fault).
  Match config: `wC8F0` = sets in the match (1/3/5), `wC8F1` = set length (2 → 2-game set,
  else 6-game set), `wC8F2` doubles. Verified live: Baby Mario's return ace set `wC8E5` = 1 (HUD 0-15).

**ScoreUpdate `08:5AD7`** (once per finished point), decoded from code:

1. `FaultHandler`, then `PointWinner 08:5D9A` → `wC8EB` (+1 P1 / −1 P2 / 0 no point): results 1
   (fault) and 3 give no point; result 9 takes the winner from `wC4AF` bit0; otherwise `wC4D9`
   (±1 relative to player `wC4B8`) is negated for player 2.
2. `MatchStats 08:5C2B`: per-player counters `wC8C0-C6` (stride 8 by `wC4B8`, capped at 99) for
   aces/faults (results 1, 2) and winners by shot type `wC4A0` 9/10/11; `wC491` = announcer id.
3. `AwardPoint 08:5C14` (points[winner]++, clear second serve, `wC8ED` points-played++).
4. Normal game: `DeuceCompress(4)` (4-4 → 3-3), `GameCheck 08:5D37` = `WinCheck(B=3, C=4)`.
   Tiebreak (`wC8E7` = 1): `DeuceCompress(7)` (7-7 → 6-6), `TiebreakCheck 08:5D54` = `WinCheck(B=6, C=7)`.
   Result → `wC8EA`; on a win `AwardGame 08:5BF4` (games++, points and `wC8ED`/`wC8E6` = 0,
   `wC8EC` games-played++).
5. `SetCheck 08:5CE9` → `wC8E9`: 6-game set = `WinCheck(B=6, C=6)`; 2-game set = `WinCheck(B=2, C=2)`;
   a games count equal to 7 (resp. 3) counts as one more, so a tiebreak win (7-6, 3-2) is a 2-game
   lead. On a win `AwardSet 08:5BDB` (sets++, games = 0, tiebreak flag cleared).
6. `MatchCheck 08:5CC3` → `wC8E8`: sets ≥ (`wC8F0`+1)/2 with a lead.

`WinCheck 08:5D71 (D=p1, E=p2, B, C)`: lead ≥ 2 and leader ≥ C → `$01` (P1) / `$FF` (P2); a tie at
exactly B → `$80` (sets the deuce flag `wC8E6` for points, the tiebreak flag `wC8E7` for games); else 0.
`ScorePointDiff 08:5B2E` runs the same chain on a copy of `wC8E0-EF` with the leader winning the
next point and stores the would-be results in `wC4D7/D6/D5` → "game point / set point / match point".

**Server and court positions** (`08:47CD`, `08:4808`, `08:48C9`): per match mode `wC4CF` a table of
24 rows × 8 bytes (singles `08:49D9`, others `4A99`, `4B59`); bytes 0-3 = position code written to
`wDF0A` of each player struct (WRAM banks 4-7, `09` = absent), bytes 4-7 = 0 server / 1 receiver.
Normal games use row `wC8EC & 3` (server alternates every game) and swap the serve half every point
by `wC8ED` parity. In a tiebreak the row is `wC8ED` (starting at `[0, 18, 12, 6][wC8EC & 3]`, wrapping
at 24): the server pattern is 0,1,1,0,0,1,1,… (one point, then two each) and the position codes swap
(0↔3, 1↔2) every 6 points — the real tiebreak change of ends.
**Position codes — VERIFIED** (rally recording): bit1 = end (0 near, 1 far); the serve half is bit0 XOR
bit1: `0` near/deuce (X = +288 for the server), `1` near/ad (X = −288), `3` far/deuce (X = −320 for the
receiver), `2` far/ad (X = +320). In normal games the rows never swap ends (P1 stays on the near end); the
code flips bit0 every point (`wC8ED` parity). Only the tiebreak rows swap ends.

### Aiming and launch — VERIFIED (tools: `emu_shot_trace.py`, `analyze_shots.py`)

Shots never solve ballistics at run time: every shot type owns a **trajectory table** of pre-solved
records indexed by landing distance (one record per 64 units), and the code picks a record by a speed
threshold. Verified on 178 traced rally shots (table address, record index, launch heading all exact;
the real bounce lands within ~20 units of the predicted point) and 25 serves.

**Pipeline** (player swing code in bank 08 → `07:53B0` snapshot → dispatch `07:5445` by `wDF14`):

1. `08:706B/7080` **shot type** `wDF14` from the buttons `wDF16` (1 A, 2 B, 3 A+B) and the variant
   `wDF17` (0 single press, 1/2 = double press / A-then-B / B-then-A; the CPU's `DF58` low nibble):
   ground table `08:70B4` = `[0,0,2,4, 0,1,11,4, 0,10,3,4]`, volley zone (`wDF50` bit4) `08:709B` =
   `[8,8,8,4, 8,6,11,4, 8,10,7,4]` (index = 4·variant + button). Serves are 12/13/14 (top/slice/flat).
2. `07:53B0`: `wC4A0` = type, `wC4A2` = charge = min(`wDF4B`, 63) (`wDF4B` counts frames from the button
   press to the contact, `08:6C1C/6C2F/6C7A`; 63 = "full", `08:53F9` plays SFX `$55`), `wC4A7` mirror,
   `wC454/56` = ball velocity copy.
3. `07:557E`: per-type row of `07:559E` (5 bytes: hit SFX, `wC4A1`, param for `08:5189`, **aim depth**
   BC): top 0/slice 2 `$280`, 1/3 (power) `$3C0`, 4 `$3C0`, volleys 5 `$3C0` 6 `$480` 7 `$380` 8 `$3C0`,
   9 `$440`, 10/11 `$200`, serves `$2A0`. Adjusted: `07:54DE` BC −= 4·charge (types 0,2,5-8,10),
   `07:54ED` BC += 12·charge and `07:54FE` += playerVy/16 (type 10), `07:5876/5899` shift the contact
   height `wC40A` (0/2: low balls lifted half-way to −96; 10/11: ≥128 → +32, else −160).
4. `07:571E`: `wC432` = ±BC (sign by `wDF0A` bit1), `wC436` = targetY − ballY; `07:5740` + `07:5646`:
   **target X** `wC430` (rally: `07:55E9`, word table `07:562E` by `wDF0A` bit0 and aim dir `wDF4A`
   (−1/0/+1 from the pad, `08:7151`): deuce `[−416, −224, −36]`, ad `[36, 224, 416]`, minus playerX/16;
   `wC7B9` ≠ 0 → symmetric `[−224, 0, 224]`; serves: `07:56B7` + jump table by `wDF4A` −2..2 with a
   random error `08:43F6`·`wDF6A`·16), `wC434` = dX, **heading** `wC43A` = atan2(dY, dX) (`00:1416`,
   65536 = full turn), then `wC48A` = (|ballY| + `$140`)/|cos| = **min landing distance** (`00:13CE`
   = HL · 16384/sin(θ+90°) from the half-cosecant table `2D:5000`; `2D:4000` is sin·32768), `wC48E` =
   `wC48A` >> 6 (record index), `wC48C/8F` the same for `$480` (max distance), shortened to the
   sideline (`wC484` + 32) when the aim line leaves the court; `wC450/52` = predicted landing point.
5. `07:5161` **speed threshold** S (handler per type, `SetShotSpinSpeed 07:52A0` row = spin stat D,
   speed stat E from the bank-07 shot tables, see below): S = speed[E] + v + c + m, clamped ≥ `$100`
   (`wC458`), where v (`wC45A`) = −|ballVy|/4 (`52F1`), −3|ballVy|/16 (`5301`) or −|ballVy|/8 (`531D`);
   c (`wC45E`) = (charge−32)·128 (`5345`, ×64 when negative) or ·64/·32 (`535C`), only for types 0-4, 9;
   m (`wC45C`) = ±playerVy/2 towards the net (`537F`) and −`$C00` while moving (`wDF0F` bit1, `53A2`).
   Spin: `wC41C` topspin, `wC41E` sidespin (mirrored).
6. Bank handler (farcall from the dispatch): selects the table, then one of the library variants
   below. The **library** is identical in banks 20-23 and 29-2B (`$4000`), bank 24 (+`$0C`) and bank
   2C (+`$04`): `4002`/`4012` HL = table + 6·(d>>6) / 4·(d>>6); `401F`/`403E` **search**: from record
   `wC48E` walk forward while record.speed < S and index < `wC48F`; `405D` launch 6-byte record
   `[speed, elevation, heading offset]` (offset mirrored by `wC4A7`) → `LaunchBall 08:45A9`; `4084` the
   4-byte `[speed, elevation]` form; `4098` serve form (see 8); `41F5` landing point = ball +
   index·64·(cos, sin) → `wC450/52`; `4102` (6-byte, search, **fallback** `41F1` → `24:57FD` when the
   first record is already ≥ S, i.e. the player is too weak for the shortest trajectory), `4135` (6-byte,
   search, no fallback), `415D` (6-byte, exact: index = min(distance to target, `wC48C`) >> 6), `4196`
   (4-byte, search, fallback), `41C9` (4-byte, search, no fallback).
7. **Table layouts** (records sorted by speed; index i lands at 64·i units from the ball):
   | type(s) | bank:entry | table | index by | record | variant |
   |---|---|---|---|---|---|
   | 2, 3 slice (/power) | `20:7E7D`, `21:7E7D` | `427D` | height band `7E98` (0/`$F00`/`$1E00`/`$2D00` for ballZ <96, <144, <192, ≥192) + Slice·`$180` (`7ED8`) | 6 | `4102` |
   | 0, 1 topspin (/power) | `22:7E7D`, `23:7E7D` | `427D` | same, Top stat | 6 | `4102` |
   | 5 low volley / CPU default | `24:7707` | `6707` | height `7719` (`$100` per 16 units from 48) | 4 | `41A2` |
   | 4 (A+B, ball low) | `24:6644` | `5844` | height `6656` | 4 | `41A2` |
   | 9 (A+B, ball high: smash) | `24:6696` | own arc: heading = atan2 to `wC48C`, speed table `66F2` by `wDF6C` | — | direct |
   | 10 lob (B then A) | `24:4589` | `4289` + `459C`[`wDF92`] | — | 6 | `4169` exact |
   | 11 drop (A then B) | `24:51A0` | `45A0` + `51B9`[angle `00:138F`] + `51F9`[`wDF93`] | — | 6 | `4169` exact |
   | 6 volley | `2C:7281` | `4281` | height `7293` | 4 | `41CD` |
   | 7, 8 volleys | `2C:72D3`, `2C:7325` | `4E81`, `6081` | height `72E5`/`7337` (`$180` steps) | 6 | `4139` |
   | 12/13/14 serves | `29/2A/2B:5E9D` | `427D` | spin stat (Top / Slice / 0)·`$2D0` (`5EBF`) + Serve·`$48` (`5ED3`) + toss height (`5EE7`, 6 per 16 units above 192) | 6 | `4098` direct |
   Bank 2B's three index tables sit 2 bytes earlier (`5EBD/5ED1/5EE5`).
8. **Serve launch** `4098`: record `[base speed, elevation, heading offset]`; speed = base +
   4·((2·|dX|·(base>>8)) >> 8) (`00:0BD4` = HL·A/256), `wC476` = base; then the receiver's intercept
   `08:7C86` at depth ∓`$2C0` → `wC450/52`. Verified on 25 serves (speed and heading exact).
9. **Fallback** `24:57FD` (weak hit): category = (firstSpeed − S) >> 9: <4 → depth `$280`, table
   `51FD` + `583C`[cat]; =4 → table 3, depth `$140`; >4 → table 0, depth `$E0` (just over the net);
   re-aims through `07:571E` and launches the exact-distance record (`24:4169`). Spin cleared.

So: the harder the hit (stats, early press = more charge, incoming speed, standing still), the higher
S and the deeper the ball lands, between `$140` and `$480` past the net along the aim line; a weak hit
drops short through the fallback tables. Record speeds are in 8.8 px/frame, elevations in 65536 = turn
(negative = up), heading offsets likewise.

### Player struct and stat → gameplay mapping — VERIFIED (6 characters)

Each player has a struct in its own WRAM bank (P1 = bank 4, P2 = bank 5) at `$DF00`:
X `DF00` / Y `DF03` / Z `DF06` as signed 16.8 (server stands at Y = 1248; while serving the
player walks at 10 units/frame and X is clamped to 38..378, between the centre mark and the
sideline). At match start, the 11 stats are turned into parameters (checked against WRAM dumps of
Luigi, Baby Mario, DK, Allie, Joy and Brian; every formula holds exactly):

| Field | Formula | Meaning (inferred) |
|-------|---------|--------------------|
| `DF60` / `DF62` | 10 + Speed/2 (8.8) | run speed, px/frame |
| `DF64` | 48 + 12·Dash | dash |
| `DF66` | 64 + 32·Stop | braking |
| `DF68` | 6 + Reaction | reaction |
| `DF69` | 117 + ⌊15.25·Angle⌋ | max shot angle |
| `DF6A` | 12 − Placement | aim error |
| `DF6B` / `DF6C` / `DF6D` | Stroke / Serve / Volley | shot-table **speed** rows |
| `DF6E` / `DF6F` | Top / Slice | shot-table **spin** rows |
| `DF78` | roster id | |

So in the shot tables, spin rows come from Top/Slice and speed rows from Serve/Stroke/Volley.
Luigi (Top 0) served with topspin-serve row 0 (8960 / −1024), as recorded.

### Movement and rally measurements (PyBoy bot, `tools/emu_bot.py`)

`tools/emu_bot.py` plays P1 by reading ball/player positions each frame (tracks ball X, swings when
close, times the serve on the toss's way down) and records WRAM0 + WRAM4/5. In a 2400-frame Luigi vs
Baby Mario recording (27 hits):

* **Acceleration** = Dash parameter / 64 px/frame² (Luigi and Baby Mario: 120 → 1.875 per frame, linear ramp).
* **Top speed** = run-speed parameter + 0.5 (Luigi 12.0 → 12.5, Baby Mario 12.5 → 13.0; 13.27 diagonal).
* **Braking** ≈ 0.87 px/frame² for Stop 3 measured during a swing; the code says (64 + 32·Stop)/256 per axis
  (0.625 for Stop 3), see "Player movement".
* **Serves**: 71-73 px/frame, elevation −2.4°, topspin-serve table row = Top stat (8960/±1024).
  An earlier serve, hit later in the toss, left at 57, so speed depends on hit timing.
* **Groundstrokes**: 30-37 px/frame, elevation 11-19°, varying per shot (trajectory tables pick
  speed/elevation for the target). Initial spins (one frame of decay removed): Luigi topspin
  3072 / ±448; Baby Mario topspin 4608 / ±640, flat 0 / 0, slice −912 / 1536 (−912 = slice
  table row 2 = his Slice stat).

### Player movement — VERIFIED from code (`08:73CA PlayerMove`)

Velocity `wDF40` (X) / `wDF42` (Y), signed, 1/256 px per frame; heading `wDF0D` (256 = full turn,
copied from the joypad heading `wDF0C` when the player is idle). `wDF50` bit6/bit7 = X/Y input
active this frame (cleared while `wDF0F` bit0 or bit1 is set — swinging/serving — and when
`wDF56` ≠ 0 movement is frozen). Per axis:

* input: `v += 4 · round(Dash · c / 128)` (`745B` X with c = cos via `00:0B01`, `7441` Y with c = sin
  via `00:0B03`), then clamp `|v| ≤ 2 · ((Run · c) >> 8) + 128` (`750C` X with `wDF60`, `74D7` Y with
  `wDF62`; signed multiply `00:0DFA`). Straight: accel = Dash/64 px/frame², top = Run + 0.5 px/frame,
  matching the PyBoy measurements below.
* no input: `v` moves to 0 by `Stop` (`74A1` X — only $40 while `wDF0F` bit1 — and `7475` Y).

The sine table `00:0B5C` has 65 entries (0..128 for a quarter turn of 64 steps).
`wDF0F` bit4 = moving (cleared when all of `wDF40-43` are 0).

### Projection (court map pixels) — fitted

From the court lines of the 32×32 court maps (map 2: far baseline y = 70, far service line 96, near
service line 162.5, near baseline 194.5; baselines span the doubles width, service lines the singles
width), one projective model fits every line to ±1 px:
`x = 128 + X·2020/(16224 − Y)`, `y = 127.5 + 804.6·Y/(16224 − Y)`. Heights use the same scale (×0.85,
estimated). The game's own routine (`00:2D8C ProjectPoint`, tables in banks 2E/2F) is not decoded.

### Shot tables — partial (tool: `tools/dump_shot_tables.py`)

`07:52A0 SetShotSpinSpeed` (HL = table, D = spin row, E = speed row) loads topspin → `wC41C`,
sidespin → `wC41E` (negated when `wC4A7` ≠ 0, the left/right mirror) and returns the speed
(8.8 px/frame) from 8-byte rows in bank 07:

| Table | Shot (by signature) | Topspin | Sidespin | Speed rows 0→9 |
|-------|---------------------|---------|----------|----------------|
| `07:4F11` | flat stroke | 0 | 0 | 34.3 → 54.8 |
| `07:4F61` | topspin stroke | 8192 | −1024 | 34.3 → 54.8 |
| `07:4FB1` | slice stroke | −1024 | 4096 | 34.3 → 54.8 |
| `07:5001` | slower flat (lob/drop?) | 0 | 0 | 31.3 → 50.2 |
| `07:5051` / `07:5061` | spin-only, 2 rows | 16384/24576 · −4096/−256 | 0 · 1024/16384 | — |
| `07:5071` | topspin serve | 8960 → 11264 | −1024 → −3328 | 52 → 88 |
| `07:50C1` | slice serve | −880 → −1024 | 2048 → 11264 | 48 → 66 |
| `07:5111` | flat serve | 0 | 0 | 48 → 84 |

Verified: Luigi's recorded serve had topspin 8855 / sidespin 1012 one frame after the hit,
exactly `07:5071` row 0 (8960 / ±1024) minus one frame of decay. Its speed was 57.0 px/frame
(row 1 = 56.0). Row indices come from the player struct (spin row = Top/Slice, speed row = Serve/Stroke/Volley,
see above). Luigi's Serve 4 selects 68 px/frame, but the recorded serve left at 57; the extra
scaling (timing/charge or the trajectory table) is not decoded yet.

### CPU AI — VERIFIED structure (bank 08 `7A60-7F00`, tables in banks 02 and 38)

Both humans and CPUs drive the same player state machine through a **virtual joypad** `DF1F`
(high nibble = d-pad, low nibble = buttons). State `DF1E` 0 = human (`08:7855` copies the real
pad), 1 = CPU (`08:7863`): a think timer `DF12` counts down, then the CPU "presses" the pad.

CPU parameters live in the character record (bytes +10..+17) and are copied to the player struct;
the CPU-difficulty menu overwrites them from `DifficultyTable 38:5FFB` (found by diffing WRAM
after choosing Easy vs Intense):

| Difficulty | deep-ball delay `DF79` | short-ball delay `DF7A` | positioning error `DF7B` | smart placement `DF7C` | profile `DF7D` | level |
|---|---|---|---|---|---|---|
| Easy | 28 | 24 | 12 | 60/256 (23%) | 0 | 1 |
| Normal | 18 | 15 | 9 | 120/256 (47%) | 1 | 3 |
| Hard | 10 | 9 | 5 | 190/256 (74%) | 2 | 5 |
| Intense | 2 | 2 | 0 | 230/256 (90%) | 3 | 7 |

Student characters carry their own values (Alex 18/12/10/200, level 1; the Mushroom Kingdom cast
32/28/14/60, level 5).

Decision steps (all use the RNG `08:43F6`):
* **Reaction** (`08:7D0A`, `08:7E84`): `DF12 = delay + rand(0..3)` frames, deep delay when the ball
  is beyond the service line (`DF50` bit 4), short delay otherwise. `DF59 = DF7B` is the positioning error.
* **Intercept** (`08:7C86` via `BallCrossingAt 08:7C57`): the X where the ball's heading line crosses a
  chosen depth — `$0180` (384, net rush), `$0200` (512) or `$0460` (1120, baseline) — becomes the
  target `DF46/DF48` (`08:7C70`). Sub-states (`DF1A`, `DF7F`) sequence wait → run → swing.
* **Shot choice** (`08:7B7B`): lob/drop (`$30` = A+B) when flagged (`wC4DA`) or when the opponent is
  inside Y < 320 (net), but only if the profile allows it (`02:5EE2` membership test); otherwise a
  random pick from the profile's 16-entry table `02:5E23`: profile 0 = 7×A, 7×B, 2×A+B; profile 3 =
  mostly `$11`/`$22` variants and lobs. `DF58` high nibble = button mask, low nibble = variant.
* **Aim** (`08:7AEB`, `08:7B13`): a random left/right press, replaced with probability `DF7C`/256 by a
  press *away from the opponent's X*; `08:7C10` then presses the shot buttons.
* **Serve** (`08:7A64`): first serves wait 50 frames, or 35 ("quick serve") with probability 0/8, 3/8,
  6/8, 8/8 by profile (`08:7A9D`); second serves always 50.
* Controller byte `DF0A`: 0 human, 1 CPU, 9 none; bit 1 = far side (negates target depths, `08:7C33`).

### Sound driver — partial (bank 0 `3129-3Dxx`, data banks 78-7F; tool: `tools/dump_sound_index.py`)

`SoundStart 00:3297`: ids `$01-$32` are **music** (index `00:3151`), `$50-$AF` **SFX** (`00:31B5`);
ids `$40-$44` are remapped to music `$2E-$32` through `00:2FE0`. Index entry = `bank | channels << 4`,
`index`; the song's channel table is at `bank:$4000 + index*4`, one 4-byte row per channel
(`driver slot`, `flags`, `ptr`). Music uses 4 rows (slots `$40/$60/$80/$A0`), SFX 1-2 (slot `$00`).
Sequence bytes (`00:3566`): `< $A0` note (then a duration byte; `$1F` = rest; noise channel maps
`< $10` through `00:3836`), `$A0 n` volume/envelope, `$A1 n` tempo/length, `$B0-$CF` duty/envelope
and loop setup, `$D0-$DF` / `$E0-$EF` transpose ±n, `$F0-$FC` misc, `$FD` loop-point, `$FF` end.
Note periods: `00:3B1D`. Observed ids: `$01` intro cutscene, `$02` title, `$03` main menu, `$44→$32`
exhibition match, `$06` point jingle; SFX `$51` racket hit, `$59` serve, `$5B` bounce, `$5E/$5F/$60`
menu confirm/cursor/back, `$65` boot.

### Emulator harness (Ph5.5) — PyBoy 2.8

`tools/emu/session.py` wraps PyBoy (headless, CGB, ~1200 fps): `run`, `press`, `hook(bank, addr, fn)`,
`wram(bank, addr, n)`, `shot`, `save/load` state. Drivers: `emu_boot.py` (boot + key script +
screenshots), `emu_trace_loads.py` (logs LoadCharacterSprites / LoadMap calls), `emu_charmatch.py`
(start a match with the k-th character and dump WRAM), `emu_dump.py`. States go to `states/`
(gitignored). The disassembler is `tools/disasm.py` (renamed from dis.py: that name shadowed the
stdlib `dis` module and broke numpy/PyBoy imports for scripts in tools/).

Observed boot flow: Nintendo logo → Camelot logo → intro cutscene (bank $78 active: intro music, id $01) → title (screen #26) → MAIN MENU (3×3: Exhibition, Mario
Mini-Games, Linked Play / Mario Tour files 1-3 / Status, Dictionary, Saved Data) → Play menu →
character select → CPU difficulty → match.

### Sound — partial

`SoundUpdate $2F1A` runs from VBlank and from the Timer ISR when the LCD is off (music keeps
playing during loading). `SoundDriverTick $3373` swaps 32 bytes of driver state between WRAM7
`$D000` and HRAM `$FFD0` around the tick. Requests: `rst $08 ; db id` or `PlaySound $3024 (A=id)`;
ids `$40-$4F` are queued through `wSoundQueued $C33E`/`hSoundPending $FFCD`. Banks 78-7F hold
the sequence data (the sound index points only there).

### Character roster & types — VERIFIED

`38:58CD PrintCharNameType(C)` prints name = text `30#(27+C)` and type =
text `30#(153 + CharTypeTable[C])`, `CharTypeTable 38:58FB`. Roster index C:

| C | Name | Type | C | Name | Type | C | Name | Type |
|---|------|------|---|------|------|---|------|------|
| 0 | Alex | Power | 11 | Curt | Tricky | 22 | (not used) | ??? |
| 1 | Nina | Power | 12 | Mark | All-Around | 23 | Luigi | All-Around |
| 2 | Harry | Power | 13 | Sean | All-Around | 24 | DK | Power |
| 3 | Kate | Power | 14 | Sammi | Technique | 25 | Baby Mario | Speed |
| 4 | Allie | Speed | 15 | Elden | Speed | 26 | Mario | All-Around |
| 5 | Joy | Technique | 16 | Spike | All-Around | 27 | Waluigi | Technique |
| 6 | Brian | All-Around | 17 | Emily | Speed | 28 | Yoshi | Speed |
| 7 | Pam | All-Around | 18 | B. Coz | Power | 29 | Bowser | Power |
| 8 | Bob | Power | 19 | A. Coz | Tricky | 30 | Wario | Power |
| 9 | Beth | Speed | 20 | Kevin | ??? | 31 | Peach | Technique |
| 10 | Fay | Power | 21 | (not used) | ??? | | | |

Types: 0 Power, 1 Technique, 2 All-Around, 3 Tricky, 4 Speed, 5 ???. Mushroom-kingdom types
match the N64 game, which supports the decode. Stats are Power / Spin / Speed / Control (equipment
messages `30#263-293` give ±1/±2 modifiers). **Stat table not found yet.**

The **sprite id** (CharSpriteTable, 0-45) is a different index from the roster index C. ID 3
has a Bowser-like silhouette and ID 26 is a large robot, so a translation table must exist.

### Character records & stats — VERIFIED location (PyBoy WRAM diff)

Found by starting six exhibition matches with different characters in PyBoy and diffing WRAM
(`tools/emu_charmatch.py`, `tools/analyze_wram_diff.py`). A match copies the character's
29-byte record from **`CharRecords 02:52CE`** (roster order) into the player struct:
P1 name `wCA00`, roster id `wCA0B`, record `wCA0E-wCA2A`; P2 at `wCA80/wCA8B/wCA8E`.
Luigi as P1 and as P2 gave identical bytes, as did Baby Mario.

Record bytes +18..+28 are **11 stats (0-9)**, order **VERIFIED** in PyBoy. During Create
Character, the stat screen draws from WRAM6 `$D00E-$D018` (+ equipment modifiers at `$D019-$D023`,
drawn by `1C:430E`). Writing 1..11 into the buffer at that hook placed the numbers as:

| Byte | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|------|---|---|---|---|---|---|---|---|---|---|----|
| Stat | Top | Slice | Serve | Stroke | Volley | Angle | Placement | Speed | Dash | Reaction | Stop |
| Group | Spin | Spin | Power | Power | Power | Control | Control | Speed | Speed | Speed | Speed |

The ROM records use the same order. The type correlation is consistent: every Power type
peaks at Serve/Stroke (6-7), the Tricky types at Top/Slice (A. Coz 9/9, Curt 7/8), and the Speed
types high in the Speed group (Yoshi Speed 6 / Dash 8, Baby Mario Dash 6 / Stop 9). A new Mario Tour character starts at
`1 1 1 2 1 1 1 1 3 1 1` (Stroke 2, Dash 3). The four player avatars (Alex/Nina/Harry/Kate) have
`5 5 …` placeholders in ROM; the real values come from the creation code.

| # | Name | Type | Top | Slice | Serve | Stroke | Volley | Angle | Placement | Speed | Dash | Reaction | Stop | header bytes +0..+17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Alex | Power | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | `c9 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 1 | Nina | Power | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | `00 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 2 | Harry | Power | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | `00 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 3 | Kate | Power | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | `00 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 4 | Allie | Speed | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 3 | 4 | 0 | 0 | `00 01 80 00 a0 00 00 08 0c 00 02 80 00 1b 12 0e 46 00` |
| 5 | Joy | Technique | 0 | 2 | 0 | 0 | 1 | 5 | 7 | 0 | 0 | 1 | 1 | `00 01 80 00 a0 00 00 08 0c 00 02 80 00 19 13 0a 50 00` |
| 6 | Brian | All-Around | 3 | 2 | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 3 | 2 | `00 01 80 00 a0 00 00 08 0c 00 02 80 00 1e 1c 0d 1e 00` |
| 7 | Pam | All-Around | 2 | 2 | 0 | 1 | 2 | 5 | 4 | 1 | 2 | 1 | 0 | `00 01 80 00 a0 00 00 08 0c 00 03 80 00 16 12 0a a0 00` |
| 8 | Bob | Power | 3 | 1 | 6 | 5 | 3 | 0 | 0 | 0 | 1 | 1 | 2 | `00 01 80 00 a0 00 00 08 0c 00 03 80 00 16 12 0a a0 00` |
| 9 | Beth | Speed | 2 | 0 | 1 | 2 | 1 | 2 | 1 | 6 | 7 | 3 | 2 | `00 01 80 00 a0 00 00 08 0c 00 03 80 00 16 11 0a a0 00` |
| 10 | Fay | Power | 2 | 1 | 5 | 6 | 4 | 2 | 2 | 2 | 3 | 2 | 3 | `00 01 80 00 a0 00 00 08 0c 00 04 80 00 12 0c 0a aa 00` |
| 11 | Curt | Tricky | 7 | 8 | 3 | 2 | 1 | 3 | 2 | 1 | 2 | 1 | 2 | `00 01 80 00 a0 00 00 08 0c 00 04 80 00 12 0c 0a aa 00` |
| 12 | Mark | All-Around | 3 | 2 | 3 | 4 | 3 | 4 | 3 | 4 | 3 | 3 | 3 | `00 01 80 00 a0 00 00 08 0c 00 04 80 00 0f 0a 08 aa 00` |
| 13 | Sean | All-Around | 3 | 3 | 4 | 3 | 2 | 4 | 5 | 4 | 4 | 3 | 3 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 0a 09 05 c8 00` |
| 14 | Sammi | Technique | 1 | 4 | 2 | 3 | 4 | 8 | 7 | 4 | 3 | 2 | 3 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 0a 09 05 c8 00` |
| 15 | Elden | Speed | 4 | 1 | 3 | 5 | 4 | 4 | 2 | 7 | 6 | 4 | 3 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 0a 09 05 c8 00` |
| 16 | Spike | All-Around | 4 | 4 | 5 | 4 | 3 | 5 | 4 | 4 | 4 | 3 | 3 | `00 01 80 00 a0 00 00 08 0c 00 05 80 02 0a 09 05 e6 08` |
| 17 | Emily | Speed | 4 | 2 | 3 | 4 | 5 | 4 | 3 | 7 | 8 | 5 | 4 | `00 01 80 00 a0 00 00 08 12 00 05 80 00 08 07 03 dc 03` |
| 18 | B. Coz | Power | 7 | 1 | 7 | 8 | 5 | 2 | 3 | 3 | 2 | 2 | 4 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 0a 09 05 b4 00` |
| 19 | A. Coz | Tricky | 9 | 9 | 3 | 4 | 5 | 4 | 3 | 4 | 2 | 3 | 3 | `00 01 80 00 a0 00 00 08 0c 00 05 80 01 08 07 03 ff 07` |
| 20 | Kevin | ??? | 4 | 3 | 3 | 4 | 4 | 7 | 6 | 5 | 4 | 4 | 5 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 09 08 04 dc 00` |
| 21 | unused21 | ??? | 0 | 0 | 0 | 0 | 0 | 9 | 9 | 1 | 9 | 9 | 9 | `00 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 22 | unused22 | ??? | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | `00 01 80 00 a0 00 00 08 0c 00 01 80 00 12 0c 0a c8 00` |
| 23 | Luigi | All-Around | 0 | 3 | 4 | 5 | 8 | 4 | 5 | 4 | 6 | 3 | 3 | `00 01 90 00 a0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 24 | DK | Power | 0 | 2 | 6 | 7 | 4 | 2 | 3 | 4 | 5 | 0 | 3 | `00 01 90 00 b0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 25 | Baby Mario | Speed | 3 | 2 | 5 | 5 | 6 | 8 | 7 | 5 | 6 | 5 | 9 | `00 01 70 00 a0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 26 | Mario | All-Around | 3 | 2 | 5 | 6 | 5 | 4 | 6 | 6 | 5 | 3 | 3 | `00 01 80 00 a0 00 00 09 0c 00 05 80 00 20 1c 0e 3c 00` |
| 27 | Waluigi | Technique | 0 | 3 | 4 | 4 | 8 | 1 | 8 | 3 | 6 | 6 | 3 | `00 02 a0 00 a6 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 28 | Yoshi | Speed | 2 | 3 | 4 | 5 | 4 | 5 | 7 | 6 | 8 | 3 | 5 | `00 00 80 00 a0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 29 | Bowser | Power | 2 | 0 | 6 | 7 | 4 | 3 | 5 | 4 | 2 | 3 | 3 | `00 00 90 00 b0 00 80 07 0b 00 05 80 00 20 1c 0e 3c 00` |
| 30 | Wario | Power | 3 | 0 | 6 | 7 | 5 | 5 | 6 | 5 | 4 | 4 | 5 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |
| 31 | Peach | Technique | 1 | 3 | 4 | 4 | 6 | 5 | 9 | 4 | 7 | 7 | 8 | `00 01 80 00 a0 00 00 08 0c 00 05 80 00 20 1c 0e 3c 00` |


**Record bytes +0..+17 — VERIFIED copy targets** (`07:5AB3` copies them into the player struct at match
start; uses in the swing code `08:6D5A-6E2C`):

| Byte | → | Meaning (from the uses) | Values |
|------|---|-------------------------|--------|
| +0 | `wDF94` = `$20` if nonzero | OBJ X-flip flag for the swing sprites (left-handed?) | 0 for every ROM character |
| +1 | — | not copied by `07:5AB3` | 0-2 (Waluigi 2, Yoshi/Bowser 0) |
| +2/+3 | `wDF70` = word − 16 | **height reach**: compared with ball Z (`wC40A`) to choose a high-ball swing | `$80`; Luigi/DK/Bowser `$90`, Baby Mario `$70`, Waluigi `$A0` |
| +4/+5 | `wDF72` | **side reach**: compared with the ball's lateral distance | `$A0`; DK/Bowser `$B0`, Waluigi `$A6` |
| +6/+7 | `wDF74` = word + `$200` | stored negated into `wDF44` when the player lunges (dive impulse) | `$0800`; Bowser `$0780`, Mario `$0900` |
| +8/+9 | `wDF76` | used by the swing code at `08:6E0F` | `$000C`; Emily `$0012`, Bowser `$000B` |
| +10 | `wDF95` | CPU level / tour level | 1-5 |
| +11/+12 | `wDF90` | bit 7 picks the swing side test at `08:6D5A` | `$80`, Spike/A. Coz `$0280`/`$0180` |
| +13..+17 | CPU params | deep/short reaction, position error, placement, profile (see "CPU AI") | |

These are the per-character inputs of the swing windows (deferred item 2).

Roster → sprite: `RosterToSprite 07:5A44` = table `07:5A50` (verified live: Luigi 23 → sprite 27,
Baby Mario 25 → 29). The unused roster slot 21 maps to sprite 26, the robot. Colours: sprite
header +0 (3-7) selects one of five OBJ palettes at `18:4300` (verified live via OAM for Luigi
and Baby Mario).

### Screens — VERIFIED (tool: `tools/render_screens.py`)

`39:407E LoadScreen(C)` with `ScreenTable 39:40F5`, 8 bytes per screen = 4 bank refs:
tiles (LZ → VRAM1 $9000/$8800), 32×32 tilemap (LZ), attribute map (LZ), 64-byte palette (raw → BG 0-7).
47 valid entries: title screen (#26, matches the emulator screenshot), Nintendo/Camelot logos,
intro cutscene panels, the DMG-style warning, exhibition/N64-tournament/tournament record grids,
link screens, results ("YOU WIN!"), Varsity team charts, tournament brackets, the ending
("And the greatest player ever!"), and portraits.

Who shows which screen (`ld c, id ; rst $18 ; db $00, $39`): `$0C` Exhibition difficulty `3B:45E3`,
`$0D/$0E` N64 tournaments `3B:49F6/49FD`, `$0F` tournament `3B:4DBF`, `$12` Ringshot points `3B:51BC`,
`$25/$26` Varsity team chart `3B:77AF/77D4`, `$10` link warning `3E:4CCB`, `$11` "LINKING..." `3E:4A16`,
`$22` link interrupted `3E:4AE0`, `$21` racket select `3E:53F3`, `$13/$14` "YOU WIN!" `16:4914/491B`,
`$23` match statistics `16:5C8C`, `$29/$2A` brackets `1B:4F2D/4F40`, `$2B` mini-game ranking
`1B:744B`, `$15` logos `6B:51B3`, `$16-$1E` intro `6B:423F…488A`, `$1F` title `6B:75E0`, `$28` ending
`6D:6A8E`, `$01` VS screen `38:4FC9`.

**Menu icons** (traced with `tools/emu_lz_trace.py` from the title into the main menu): the main menu
`3B:55D1` decompresses its six big icons from bank-table refs `3B:57E0` (`3C:12`, `3C:14`, … `3C:1C`)
and copies each to VRAM1 `$A800 + $100·i` (dest table `3B:57EC`) in `3B:56D0`. Smaller icon tiles go
through the generic loader **`LoadIconTiles 39:468B`** (export `39:$10`; B = icon id → bank-table
ref in `39:46B7`, decompressed to WRAM1 `$D000`, then `CopyToVRAM` DE/C) — e.g. the `3C:1B-22`, `3D:3E`
sets loaded right after the menu screen.

### Menus — VERIFIED structure (PPU dumps `tools/emu_screen_dump.py` + `tools/analyze_ppu_dump.py`)

All front-end menus are drawn the same way: a background from the LZ bank tables, icon tiles copied into
VRAM bank 1 at `$8800 + $100·i` (BG tiles `$80 + 16·i`, each icon 5×3 tiles row-major), the **selected
icon's palette** (BG palette 4) swapped by code while the others use the grey palette 5, sprite **badges**
(8×16 OBJs, 8-10 side by side) under the selected icon, a scrolling **marquee title** (10 OBJs at y = 0,
OBJ palette 1 from `39:4B65`), two cursor arrows (`3C:5AA6`, icon id `$1B`) and a text bar in rows 15-17.

| Menu | Routine | Background | Icons | Badges / titles | Grid |
|------|---------|------------|-------|-----------------|------|
| Main | `3B:55D1` | stadium: `39:4C38` loads refs `3C:08` tiles, `3C:0A` map, `3C:0C` attrs, `3C:0E` 64-byte palette (map copied twice: `D000` working, `D800` pristine for the slide-in `39:4DEB`) | `3B:57E0` → `3C:12..1C` (Exhibition, Mini-Games, Linked Play, Status, Dictionary, Saved Data); the three file digits are stadium tiles | badges ids `$1D-$22` at `3B:591B` (x,y) with tile bases `3B:592D`; marquee id `$3E` | 3×3, `3B:412A (B=cols, C=rows)`, cell→item `3B:56BA`; selected palette `3B:5A6A` → `5A7C/5A8C/5A94/5A9C/5A84/5AA4`; file slots recolour with the saved character's scheme (`18:4339`) |
| Play | `3B:5CF3` | stadium | `3B:5EBD` → `3C:62..6E` (singles, doubles, 2 games, 6 games, 1/3/5 sets) | badges `$23-$29`; marquee `$3F`; row palettes `3B:5DD4/5DDC/5DE4` (pal 4/6/7) | 1 column × 3 rows; ←/→ toggles the row's choice `wCB0E/0F/10` (`3B:5F3C`); texts `30 #135/136`, `#137/138`, `#139-141` |
| Character | `38:7408` | screen `$01` (the orange VS screen); the small-caps font and the 1P/2C/VS tiles are part of its tile set | 16×16 **portraits**: raw 2bpp sheet `18:5AF0 + 64·roster` (rosters 21/22 are blank), 3 visible at x = 10/34/58, y = 47, OBJ palette = the character's colour scheme (`18:4300`), grey when taken | bracket corner = LZ stream `39:44F6` (decompressed straight to VRAM1 `$8000`), arrows `38:50A7` (left, right, up, down; each 8×8 + blank); marquee `$64` ("SELECT A CHARACTER"); titles `30 #142/#144/#149`, type `#153+type` | carousel; **order on a fresh save (verified live): Luigi, Baby Mario, DK, Allie, Joy, Brian**; availability bits `38:7686` from `D840+` |
| Difficulty | same screen | | | EASY/NORMAL/HARD/INTENSE + symbols are tiles of the screen-1 set, cursor brackets at y 123/129 | ←/→ |
| Court | `3E:5D11` / `3E:65C9` | stadium | `3E:5DF1` → `3F:02..12` (9 slots; unlocked ones replace `3F:5F7D`), dest `3E:5E05` | badges `$65-$68` at `3E:5F41` (y,x); marquee `$40`; selected palettes `3E:5FF1` → `6003/600B/6013/601B` | 2×2 (3×3 when unlocked, `3E:413A`); speed/bounce texts `30 #169+3E:608A[i]` / `#169+3E:60C1[i]`; **court id → map (verified live): 0 hard → 5, 1 clay → 4, 2 grass → 2, 3 composition → 8**; music `3E:6102` |

The 8×8 **UI font** used by every menu bar is raw 2bpp at **`01:4410`** (glyphs `$20-$7F`, colour 1 =
background, 3 = ink, 2 = shadow), drawn fixed-width (tile = `$100 + ASCII` in VRAM bank 0). The main-menu
palette set is `3C:0E`; OBJ palette 0 (badges) is at `39:4619`.

### Save data (SRAM) — partial

Battery SRAM, 4 × 8 KB banks; enabled with `$0A → $0000` and disabled after each access.

| Address (bank 0) | Content |
|------------------|---------|
| `$A020-$A02F` | signature `"CAMELOTGBTENNIS\0"` (`03:47E9`) |
| `$A030-$A031` | checksum = 16-bit sum of the bytes `$A038-$A76F` (`03:4844`) |
| `$A038` | byte, default `$71` |
| `$A040-$A05F` | 256 persistent flags (`03:4D86 Test / 4DB6 Set / 4DE4 Clear`, DE = byte<<8 \| bit<<5) |
| `$A060-$A76F` | **block directory**: 113 × 16-byte records (see below; the old "11 records at `$A6C1`" were its last entries) |

`SRAM_Commit 03:48A1` writes the checksum and mirrors bank 0 `$A000-$A7FF` into **bank 1 as a
backup**. `SRAM_Validate 03:495D` (called from MainLoop) checks signature + checksum, restores from
the bank-1 copy on failure and rechecks; if both fail, it wipes all 4 banks and builds a new save
(`03:47F9`, `03:404A`, `03:48A1`, `03:519A`).

**Block directory** (tool: `tools/dump_save_layout.py`). Record n at `$A060 + 16·n`: `+0` valid,
`+1` SRAM bank, `+2` offset from `$A000`, `+4` size, `+6` 16-bit byte-sum checksum, `+8` tag (DE).
Defaults are written by `03:404A`. `SaveBlock 03:4A89` (B = block, HL = WRAM source, DE = tag) copies,
checksums, marks the record valid and commits (`SRAM_Commit`); `LoadBlock 03:4B9B` reads back,
`03:4C14` verifies a block against memory.

| Blocks | Bank | Range | Use (from the callers in bank 03) |
|--------|------|-------|-----------------------------------|
| 0-5 | 0 | `$A800-$B6FF` | 3 Mario Tour slots × (`$300` + `$200`): block 2·slot = WRAM0 `$C800-$CAFF` image (`SaveGame 03:4D10`, `LoadGame 03:4D64`, slot = `wC36C`) |
| 6-10 | 0 | `$B700-$B79F` | small records (48/32/32/32/16 B) from a WRAM bank at `$D000` (`03:558E-5636`) |
| 11-26 | 0 | `$B800-$BFFF` | `$200` block from `$D500` (`03:5775`) and 15 × `$80` records |
| 27-53 | 1 | same offsets | **backup copies**: every save writes block n then n + 27 and verifies both |
| 54-73 | 2 | `$A000-$BFFF` | `$300`×2, 6×`$20`, `$60`, `$DA0`, `$6C0`, 9×`$80`; blocks 56+ from `$D480` (`03:50CF`) |
| 74-87 | 3 | `$A000-$B4FF` | `$100`/`$200`/`$500` blocks |
| 88-112 | 4-14 | | listed but beyond the 32 KB cartridge RAM (header `$149` = 3); no static caller found — leftover layout |

So the `$C800-$CAFF` WRAM0 region is the persistent Mario Tour state (it holds `wC8E0-` match
counters, `wC900` player name, `wC940` second name, `wCA0B/CA8B` rosters, …).

**Player records** (64 B; Mario Tour player `wC900`, partner `wC940`; match slots `wCA00/CA40/CA80/CAC0`
= P1, P1 partner, P2, P2 partner; `wC800/C840` hold a working copy of the two tour records):

| Offset | Content |
|--------|---------|
| +$00 | name, 0-terminated (8 B) |
| +$0B | roster id (match slots) / play style 0-3 (tour records, `& 3`) |
| +$0C | `wC90C`: class/rank? (Alex 3, Harry 2) |
| +$0E | the 29-byte character record (`02:52CE` format) starts here: +$10-$16 header words, +$18 level, +$1A-$1F CPU params |
| +$20-$2A | the 11 stats 0-9 (Top, Slice, Serve, Stroke, Volley, Angle, Placement, Speed, Dash, Reaction, Stop) |
| +$2C-$2E | EXP (24-bit) |
| +$30-$36 | copy of the template header |
| +$38-$3B | tour **training values** T0-T3 |
| +$3C | `wC93C`: nonzero → stats need a rebuild (`02:47C6`) |

**Other save-image fields** (`$C800-$CAFF`, from their readers/writers):

| Address | Content |
|---------|---------|
| `wC880-C883` | random 4-byte **file ID** (`02:4380`), regenerated until it differs from the other two slots (`02:42D6`) |
| `wC884` | file flag (`02:424D`) |
| `wC88E-C891` | **play time** frames, seconds, minutes, hours (≤ 99): copied from the clock `wC0F0` that `00:23DD` ticks, under `di` (`00:2452/246D`); shown by `3B:5B20` |
| `wC8B1/C8B3` | EXP pools summed with `wC9B0/C9B2` on the EXP transfer screen (`1E:6AFD`) |
| `wC8B5-C8B8` | four progress counters read by area code (`10:579D`) |
| `wC8B9` | progress/chapter value read by `16:5C17`, `1E:498F` |
| `wC8BB+` | random bytes filled by `02:434E` |
| `wC8C0-C8D4` | match statistics counters (see ScoreUpdate) |
| `wC8E0-C8F8` | score and match configuration |
| `wC9B0/C9B2` | **pending EXP** for the tour player / partner; handed out by `1B:6399` through the EXP screen `1A:44D8` (`AddTourExp`) and then cleared |
| `wC9C0-CABF` | event flags |

**Mario Tour stat growth — VERIFIED** (tool: `tools/tour_stats.py`; `RebuildStats 02:44E9`). Each play style
has a 113-byte template (`02:47F2` → `47FA/486B/48DC/494D`): a 13-byte header copied into the record and
11 rows of 9 signed thresholds. `stat = number of leading thresholds < B`, with
`B = clamp(5·T − (level − 1), −127, 127)` (`02:44B7`, `02:4494`) and T = **+$38 for Top/Slice, +$39 for
Serve/Stroke/Volley, +$3A for Angle/Placement, +$3B for Speed/Dash/Reaction/Stop** (the four training
categories). Checked against the save: Alex (style 0, level 1, T = 0) → Stroke 1, Dash 2; Harry (style 2)
→ Top 1, Serve 2, Angle 1, Speed 1 — both exactly the stored +$20 bytes. This is why the stat-screen
values never appeared verbatim elsewhere in SRAM: they are derived from style, level and training.

**Levels and EXP — VERIFIED from code.** EXP is 24-bit at record **+$2C**; the total needed for each level
is a 3-byte table at `02:4E7A` (pointer `02:4E78`): 0, 15, 45, 90, 144, 204, 270, 341, 417, 498, 585, 678, …,
9119 (level 45), …, 27669 (level 98), `$FFFFFF` at 99. `CanLevelUp 02:4D99` compares EXP with
`table[level]`; `ExpToNext 02:4DC8` returns the difference. `LevelUp 02:49BE (D = category 0-3, $FF none)`:
if level < 99, training T[D] += 1, level += 1, then `RebuildStats`. Because B = 5·T − (level − 1), each
level-up raises the chosen category's B by 4 and lowers the other three by 1. `02:4B99` builds preset
characters from `02:4C18` (4 bytes per preset = level-ups given to T0..T3, e.g. 7/3/5/3, 10/8/6/5).
The level-up screen (`1C:41C2`) counts pending level-ups while `CanLevelUp` holds.
`AddExp 02:4D30` (HL = EXP field, DE = amount) adds and caps at 99999 (`02:4D50`);
`AddTourExp 02:4D8F` (A = player/partner) and `02:4D6D` (match slots) use it; `ClearExp 02:4D61`.

### Data Structures

*(TBD)*

### State Machine

Boot: `Init $2578` → `MainLoop 01:4018` (clears WRAM banks 1-6, inits subsystems in banks 03/02/08,
SRAM check `03:495D`) → `0A:4F2C GameTop`, an endless loop of `ClearTasks; AddTask(0A:4EFC); FieldScene 0A:4F40` (see "Field scenes").

Per-frame work is a **cooperative task list** (`wTaskList $C1C0`, 16 × 4 bytes
`[param, addr lo, addr hi, bank]`) run by `WaitFrame $2631 → RunTasks $1BFF`.
`AddTask $1B6A` (A=param, HL=func in the current bank), `RemoveTask $1BCB`.

After `GameTop` returns there is an unreachable **debug loop** (01:40B2) that prints the build
string at `$0153` with the ASCII debug font (`PrintStringDebug $1906`).

VBlank `$2749`: SCX/SCY shadows, OAM DMA from the double buffer, VRAM/HDMA queue, palette upload,
joypad (A+B+Select+Start = soft reset to `$2582`), sound.

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
| `web/catalog.html` | asset browser over gfx/ and docs/text_dump.txt |

Run `python3 tools/gen_all.py` to regenerate everything above from the ROM (all gitignored).

---

## Verification Checklist

- [x] Ph3: 3+ functions traced and cross-checked against emulator trace (PyBoy hooks, `tools/emu_fullmatch.py`: BallStep once per frame in play, BallNetCheck inside every step, LaunchBall per hit, VBlank per frame; LoadCharacterSprites / LoadMap arguments logged)
- [x] Ph4: 5+ sprites/tiles extracted and visually compared to emulator (PyBoy: title screen, Nintendo/Camelot logos, intro panels, Nintendo hard court, Luigi/Baby Mario sprites + colours)
- [x] Ph5: key data struct confirmed in emulator memory dump (CharRecords 02:52CE == wCA0E player struct, Luigi/Baby Mario on both sides)
- [x] Ph6: full game session played (bot vs CPU, exhibition 1 set, to the results screen: 8 points, a 69-shot rally, 94 launches)
- [x] Ph7: court rendering pixel-compared against emulator frames at the game's own SCX/SCY (`tools/compare_frames.py`): 99.93% / 99.93% / 98.52% of BG pixels (rest = HUD/pop-ups). Sprite/HUD comparison not done

---

## Reference Resources

- Pan Docs (https://gbdev.io/pandocs/) — hardware registers, MBC5, CGB palettes
- No public disassembly of this game is known.

---

### Deferred for Fable (hard, long-chain problems — do last)

These need long uninterrupted reasoning over large code/data with emulator cross-checks; they are
parked for a stronger model (Fable 5.1). Each entry lists what is already known and the acceptance test.

1. ~~**Shot trajectory selection**~~ DONE — see "Aiming and launch" (178 traced shots + 25 serves
   reproduce the record address, index and heading exactly; `tools/emu_shot_trace.py`,
   `tools/analyze_shots.py`). Ported to `web/js/shots.js`.
2. **Swing timing windows and shot speed scaling** (bank 08 player swing code, `wDF0F` bits 0/1).
   Known: serve speed 57-73 px/frame depending on toss timing; the charge counter `wDF4B` (frames from
   press to contact, max 63) feeds the speed threshold (see "Aiming and launch"). Needed: reach box,
   contact test `08:7267`/`wDF50` bit0, auto-swing vs button. Test: bot hits in `emu_bot.py`
   reproduce in the web port within a frame.
3. **Sound sequence format** (driver `00:3566`, data banks 78-7F). Known: index, channel table,
   partial opcode map. Needed: every `$A0-$FF` opcode with operand sizes and semantics, loops/calls,
   envelopes, noise mapping `00:3836`, then a dumper and a WebAudio player. Test: rendered audio of
   ids `$01-$32` matches PyBoy's APU output (spectrogram or note-event compare).
4. **`00:2D8C ProjectPoint`** (tables in banks 2E/2F). Needed: exact world → screen projection to
   replace the fitted one in `web/js/main.js`. Test: sprite OAM positions from a recorded rally match
   the port to ±0 px.
5. **CPU AI sub-state machine** (`wDF1A`, `wDF7F`, bank 08 `7A60-7F00`): exact intercept-depth rule
   and movement targets per state (structure and parameters are decoded; ordering/timing is not).

## Next Tasks

### RE Investigation

- [x] Ph1: identify binary header and platform
- [x] Ph2: identify compression (LZ at 00:1797) and write tools/decompress.py
- [x] Ph3: build instruction_set.py, disasm.py, xref.py, search_bytes.py with inline-RST decoding
- [x] Ph3: disassemble VBlank handler ($0040 → $2749) and document per-frame work
- [x] Ph3: trace MainLoop (01:4018) to the top level (0A:4F2C GameTop, task scheduler)
- [x] Ph3: GameFlow: everything runs in FieldScene 0A:4F40; location table 0A:564F (42 areas) + scene descriptors (tools/dump_scenes.py)
- [x] Ph3: front-end banks identified from their LoadScreen calls (3B setup, 3E link, 16 results, 1B brackets, 6B intro/title)
- [x] Ph3: boot area 00 init → logos/intro/title → main menu 3B:55D1 → dispatch 10:4FC6
- [x] Ph3: disasm.py: handle `rst $00` inline jump tables (print the dw table and stop linear decode)
- [x] Ph3: recursive code tracer tools/trace_code.py (coverage feeds tools/bank_map.py)
- [x] Ph3: decode rst $08 SoundCmdInline (00:2FB3) — music/SFX index, ids observed live
- [x] Ph3: identify the sound driver (bank 0 3129-3Dxx) and data banks 78-7F
- [x] Ph3: bank map 00-7F (tools/bank_map.py); refine the ? rows (0C, 1D, 1E, 24, 28-2C, 73)
- [x] Ph5: mini-game id → game mapping verified live (emu_call.py)
- [x] Ph5: mini-game descriptor layout (0B:4002 / 0D:4006)
- [ ] Ph3: decode the sequence opcodes fully ($A0-$FF handlers) and write a sequence dumper
- [x] Ph4: text encoding (ASCII + control codes) and text-bank layout; dump all 4109 messages
- [x] Ph4: understand banks 5F-69 map layout via LoadMap 0A:585D — all 37 maps render
- [x] Ph4: dialogue font (05:7920, widths 05:7F80), VWF printer, control/substitution codes
- [x] Ph4: map w4 = collision grid, w5 = event-trigger ids
- [x] Ph4: map header +2..+5 = scroll bounds / size
- [x] Ph4: map header bytes +6.. are unused (no reader; clobber test identical)
- [x] Ph4: courts have no map header (w0 aliases w4; the court path never uses wC329-C32C)
- [x] Ph4: identify banks 40-5D as character sprite banks (header, frame list, anim scripts)
- [x] Ph4: find the OAM builder and decode sprite frame placement, render all frames (tools/render_sprites.py)
- [x] Ph4: map sprite id → character (RosterToSprite 07:5A50, verified live); header +0 = colour scheme (+2 still TBD)
- [x] Ph4: find OBJ palettes for characters and render sprites in color (18:4300)
- [x] Ph4: animation script format at header +6, frame = group×5 + view (dump_anims.py)
- [x] Ph7: web port plays the ROM animation scripts (anim ids per state from a recording)
- [x] Ph4: RPG actor bytecode interpreter 04:447D — all 22 opcodes, actor layout, tools/dump_script.py
- [x] Ph4: enumerate actor spawns and events per area (dump_scenes.py)
- [x] Ph4: dump every actor script reachable from the spawn lists (dump_scenes.py --scripts)
- [x] Ph4: pair tile/map/palette blocks into full screens (LoadScreen 39:407E, 47 screens incl. title)
- [x] Ph5: decode SRAM save container (signature, checksum, bank-1 backup, persistent flags)
- [x] Ph5: save payload $A060-$A76F = block directory (113 blocks), slots, backups (dump_save_layout.py)
- [x] Ph5: player record layout (64 B) in the $C800 save image
- [x] Ph5: save-image fields (file ID, play time, EXP pools, progress counters)
- [ ] Ph5: where EXP amounts are computed: no instruction writes wC9B0/C9B2 directly (only clears/reads), so they arrive by a block copy (link transfer?); contents of SRAM blocks 6-26 / 54-87
- [x] Ph5: character roster + type table (38:58FB)
- [x] Ph5: find the character stat table (02:52CE, verified by WRAM diff in PyBoy)
- [x] Ph5: verify stat label order (PyBoy: Create Character stat screen, poke + hook 1C:430E)
- [x] Ph5: created-character stats: derived from style template + training T0-T3 + level (RebuildStats 02:44E9, verified)
- [x] Ph5: record bytes +0..+17 → wDF70-wDF95 (reach, lunge, CPU level), copied by 07:5AB3
- [x] Ph5/6: ball physics (position/velocity layout, integrate, drag, gravity, bounce, fences), verified by simulation
- [x] Ph5/6: model the spin terms 08:5613 (side wC41E, top wC41C) — in ball_sim.py, 0.03 px
- [x] Ph5/6: shot tables in bank 07 (spin + speed per level), serve spin verified live
- [ ] Ph5/6: shot model: map speed rows to stats (wDF6C/6D), how direction/angle is chosen, timing/charge effects
- [x] Ph5/6: court constants, net collision 08:5814, in/out 08:463A, point counters and deuce (verified live)
- [ ] Ph5/6: decode trajectory-table selection in banks 20-23 (export $7E7D) and how the aim heading wC43A is chosen
- [x] Ph5/6: game/set/tiebreak counters and match-end logic (ScoreUpdate 08:5AD7, WinCheck 08:5D71)
- [x] Ph5/6: serve rotation tables 08:49D9 (tiebreak 1-2-2 serve order, ends swap every 6 points)
- [x] Ph5/6: wDF0A position codes confirmed live (bit1 end, bit0^bit1 ad court)
- [x] Ph5/6: player struct (WRAM4/5 DF00) and stat → parameter formulas (verified 6 chars)
- [x] Ph5/6: player movement code (acceleration, dash, braking) using DF60-DF66 (08:73CA)
- [x] Ph5/6: CPU AI per difficulty (parameters, reaction, intercept, shot/aim/serve decisions)
- [ ] Ph5/6: decode the CPU sub-state sequence (DF1A/DF7F) and the intercept-depth choice rule
- [x] Ph5: roster-index → sprite-id translation (07:5A50, verified live)
- [x] Ph5: wEventFlags usage map (dump_flags.py, 704 flags); naming story milestones still open
- [x] Ph4: build web/catalog.html asset browser (maps, LZ sheets with palette recolor, palettes, searchable text)
- [x] Ph4: 64-byte LZ blocks = palette keyframes (fades), loaded in BG/OBJ pairs every 6 frames
- [x] Ph4: render the title screen and full-screen layouts (LoadScreen 39:407E, 47 screens)
- [x] Ph4: menu icon loaders: 3B:56D0 (main menu icons from 3B:57E0) and LoadIconTiles 39:468B

### Web Port Fixes

- [x] Ph7: web port of a singles exhibition match (web/index.html, docs/architecture_web.md)
- [ ] Ph7: replace the stroke speed/spin approximations with the bank 20-23 trajectory tables once decoded
- [x] Ph7: port the decoded CPU AI parameters (reaction delays, placement probability, positioning error, shot profiles, quick serve)
- [ ] Ph7: decode ProjectPoint 00:2D8C and replace the fitted projection
- [x] Ph7: HUD and messages drawn with the game's dialogue font
- [x] Ph7: menus rebuilt in the web port (main, play, character ×2, difficulty, court) from the ROM's menu data
- [ ] Ph7: score graphics as in the game (scoreboard tiles); sound
- [x] Ph7: pixel-compare court rendering against emulator screenshots (99.9%)

### Documentation

- [x] docs/architecture_exe.md (first version — update as subsystems are understood)
- [x] docs/architecture_web.md
