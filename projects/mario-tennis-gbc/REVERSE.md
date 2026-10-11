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
| 18 | 33× 64-byte blocks — *not* plain BGR555 palettes (many entries decode to black/near-black); fade tables or OAM data? TBD |
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

### Sprites (banks 40-5D, 6F-71) — VERIFIED layout (tool: `tools/render_sprites.py`)

`04:4B68 LoadCharacterSprites(D=char id)` → `CharSpriteTable 04:4F75` (46 × `idx, bank`) →
16-byte header at `[bank:$4000+idx]` copied to `wSprHeader $DAD0`:

| Offset | Bank 40 | Meaning |
|--------|---------|---------|
| +0 | `06` | → wDF37/wDF3A (varies 3-7 per character; OBJ palette? TBD) |
| +2 | `03 00` | TBD (`04 02` in banks 6F-71) |
| +4 | `$400E` | frame tile-data pointer list → `wSprFramePtrs $DF24` |
| +6 | `$7F24` | animation scripts → `wSprAnimPtrs $DF28`; `(frame, duration)` pairs, `$FF/$FB/$FD` control |
| +A | `$7CE0` | per-frame info, 4 B: `dy, dx, flag, ntiles` → `wSprFrameInfo $DF38` |

`00:2E6B UploadSpriteFrame` copies `ntiles × 16` bytes of the current frame to VRAM (when `flag`
≠ 0, a second chunk at frame+$100 follows). Frames are drawn as **8×16 OBJs, column-major**
(`00:2C2B` 24×32 / `00:2CED` 32×32): tile *t* → column *t÷4*, row *t mod 4*. Typical frame:
`fc f1 00 0c` = 12 tiles = 24×32 px, offset (-4, -15). Frames are stored 240 B apart.

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
* **Score**: `wC8E4/wC8E5` = points in the current game (P1/P2). `08:5BC6 DeuceCompress(B)`
  drops both scores to B−1 when both reach B (deuce/advantage loop; called with B = 7, the tiebreak
  cap). Faults: `08:5B7F` (`wC8EE` second-serve flag, `wC4D8` 1 = fault, 2 = double fault).
  Match config `wC8F0-wC8F3` from the menu (singles/doubles, 2- or 6-game sets, 1/3/5 sets).
  Verified live: Baby Mario's return ace set `wC8E5` = 1 and the HUD showed 0-15.

### Aiming and launch — partial

`08:45A9 LaunchBall(HL = speed, BC = elevation angle, DE = heading)`:
vZ = speed·sin(elev), vX = speed·cos(elev)·cos(heading), vY = speed·cos(elev)·sin(heading)
(two `MulSinCos` calls). Shots don't compute ballistics at run time. Banks 20-23 hold
**trajectory tables** of 6-byte records (speed, elevation, heading offset), searched by distance
threshold (`20:401F`) and launched by `20:405D` with heading = `wC43A` (aim) + offset, mirrored by
`wC4A7`. Per-mode table selection is in each bank's export `$7E7D` (reads `wDF6F`). Not fully decoded.

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
* **Braking** ≈ 0.87 px/frame² for Stop 3 (mixed with swing animation in this capture; not exact).
* **Serves**: 71-73 px/frame, elevation −2.4°, topspin-serve table row = Top stat (8960/±1024).
  An earlier serve, hit later in the toss, left at 57, so speed depends on hit timing.
* **Groundstrokes**: 30-37 px/frame, elevation 11-19°, varying per shot (trajectory tables pick
  speed/elevation for the target). Initial spins (one frame of decay removed): Luigi topspin
  3072 / ±448; Baby Mario topspin 4608 / ±640, flat 0 / 0, slice −912 / 1536 (−912 = slice
  table row 2 = his Slice stat).

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

### Sound driver — partial (bank 0 `3129-3Dxx`, data banks 70-7F; tool: `tools/dump_sound_index.py`)

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

Observed boot flow: Nintendo logo → Camelot logo → intro cutscene (ROM bank $78 active, so banks
78-7E hold cutscene data, not music) → title (screen #26) → MAIN MENU (3×3: Exhibition, Mario
Mini-Games, Linked Play / Mario Tour files 1-3 / Status, Dictionary, Saved Data) → Play menu →
character select → CPU difficulty → match.

### Sound — partial

`SoundUpdate $2F1A` runs from VBlank and from the Timer ISR when the LCD is off (music keeps
playing during loading). `SoundDriverTick $3373` swaps 32 bytes of driver state between WRAM7
`$D000` and HRAM `$FFD0` around the tick. Requests: `rst $08 ; db id` or `PlaySound $3024 (A=id)`;
ids `$40-$4F` are queued through `wSoundQueued $C33E`/`hSoundPending $FFCD`. Banks 78-7E (no
export table, dense data) are the likely music data.

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

### Save data (SRAM) — partial

Battery SRAM, 4 × 8 KB banks; enabled with `$0A → $0000` and disabled after each access.

| Address (bank 0) | Content |
|------------------|---------|
| `$A020-$A02F` | signature `"CAMELOTGBTENNIS\0"` (`03:47E9`) |
| `$A030-$A031` | checksum = 16-bit sum of the bytes `$A038-$A76F` (`03:4844`) |
| `$A038` | byte, default `$71` |
| `$A040-$A05F` | 256 persistent flags (`03:4D86 Test / 4DB6 Set / 4DE4 Clear`, DE = byte<<8 \| bit<<5) |
| `$A6C1-$A770` | 11 × 16-byte records, default `[n, 0, 0, 0, $1E]` (records/rankings? TBD) |

`SRAM_Commit 03:48A1` writes the checksum and mirrors bank 0 `$A000-$A7FF` into **bank 1 as a
backup**. `SRAM_Validate 03:495D` (called from MainLoop) checks signature + checksum, restores from
the bank-1 copy on failure and rechecks; if both fail, it wipes all 4 banks and builds a new save
(`03:47F9`, `03:404A`, `03:48A1`, `03:519A`).

### Data Structures

*(TBD)*

### State Machine

Boot: `Init $2578` → `MainLoop 01:4018` (clears WRAM banks 1-6, inits subsystems in banks 03/02/08,
SRAM check `03:495D`) → `0A:4F2C GameTop`, an endless loop of `ClearTasks; AddTask(0A:4EFC); GameFlow 0A:4F40`.

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

## Next Tasks

### RE Investigation

- [x] Ph1: identify binary header and platform
- [x] Ph2: identify compression (LZ at 00:1797) and write tools/decompress.py
- [x] Ph3: build instruction_set.py, disasm.py, xref.py, search_bytes.py with inline-RST decoding
- [x] Ph3: disassemble VBlank handler ($0040 → $2749) and document per-frame work
- [x] Ph3: trace MainLoop (01:4018) to the top level (0A:4F2C GameTop, task scheduler)
- [ ] Ph3: decode GameFlow 0A:4F40 scene sequence (title → menus → match / RPG); name each farcall target
- [x] Ph3: disasm.py: handle `rst $00` inline jump tables (print the dw table and stop linear decode)
- [ ] Ph3: build a recursive code tracer (tools/trace_code.py) from vectors + $4000 export tables to classify code vs data per bank
- [x] Ph3: decode rst $08 SoundCmdInline (00:2FB3) — music/SFX index, ids observed live
- [x] Ph3: identify the sound driver (bank 0 3129-3Dxx) and data banks 70-7F
- [ ] Ph3: decode the sequence opcodes fully ($A0-$FF handlers) and write a sequence dumper
- [x] Ph4: text encoding (ASCII + control codes) and text-bank layout; dump all 4109 messages
- [x] Ph4: understand banks 5F-69 map layout via LoadMap 0A:585D — all 37 maps render
- [ ] Ph4: find the dialogue font tiles and the text printer (control-code handler for $02/$03/$07/$0E)
- [ ] Ph4: decode map w4/w5 1 KB layers (collision / event triggers?) and header bytes 0-3, 6-$87
- [ ] Ph4: why do courts (maps 0-15) have w0 == w4? check the court-loading path (a different loader?)
- [x] Ph4: identify banks 40-5D as character sprite banks (header, frame list, anim scripts)
- [x] Ph4: find the OAM builder and decode sprite frame placement, render all frames (tools/render_sprites.py)
- [x] Ph4: map sprite id → character (RosterToSprite 07:5A50, verified live); header +0 = colour scheme (+2 still TBD)
- [x] Ph4: find OBJ palettes for characters and render sprites in color (18:4300)
- [ ] Ph4: decode the animation script format at header +6 (`$FF/$FB/$FD` opcodes)
- [x] Ph4: pair tile/map/palette blocks into full screens (LoadScreen 39:407E, 47 screens incl. title)
- [x] Ph5: decode SRAM save container (signature, checksum, bank-1 backup, persistent flags)
- [ ] Ph5: map the rest of the save payload $A038-$A76F (RPG character, records at $A6C1)
- [x] Ph5: character roster + type table (38:58FB)
- [x] Ph5: find the character stat table (02:52CE, verified by WRAM diff in PyBoy)
- [x] Ph5: verify stat label order (PyBoy: Create Character stat screen, poke + hook 1C:430E)
- [ ] Ph5: find how created-character stats are stored in SRAM (display buffer values were not found verbatim in SRAM; probably points/EXP converted at display time)
- [ ] Ph5: decode record bytes +0..+17
- [x] Ph5/6: ball physics (position/velocity layout, integrate, drag, gravity, bounce, fences), verified by simulation
- [x] Ph5/6: model the spin terms 08:5613 (side wC41E, top wC41C) — in ball_sim.py, 0.03 px
- [x] Ph5/6: shot tables in bank 07 (spin + speed per level), serve spin verified live
- [ ] Ph5/6: shot model: map speed rows to stats (wDF6C/6D), how direction/angle is chosen, timing/charge effects
- [x] Ph5/6: court constants, net collision 08:5814, in/out 08:463A, point counters and deuce (verified live)
- [ ] Ph5/6: decode trajectory-table selection in banks 20-23 (export $7E7D) and how the aim heading wC43A is chosen
- [ ] Ph5/6: game/set/tiebreak counters and match-end logic (bank 07 5Exx / bank 16 5Dxx)
- [x] Ph5/6: player struct (WRAM4/5 DF00) and stat → parameter formulas (verified 6 chars)
- [ ] Ph5/6: player movement code (acceleration, dash, braking) using DF60-DF66
- [x] Ph5/6: CPU AI per difficulty (parameters, reaction, intercept, shot/aim/serve decisions)
- [ ] Ph5/6: decode the CPU sub-state sequence (DF1A/DF7F) and the intercept-depth choice rule
- [x] Ph5: roster-index → sprite-id translation (07:5A50, verified live)
- [ ] Ph5: map wEventFlags ($C9C0) flag numbers used by RPG mode
- [x] Ph4: build web/catalog.html asset browser (maps, LZ sheets with palette recolor, palettes, searchable text)
- [ ] Ph4: identify what the 64-byte LZ blocks (bank 18, 39, 3F, 6D) really are
- [x] Ph4: render the title screen and full-screen layouts (LoadScreen 39:407E, 47 screens)
- [ ] Ph4: menus with icons (main menu, play menu) are drawn by other code; find their loader

### Web Port Fixes

- [x] Ph7: web port of a singles exhibition match (web/index.html, docs/architecture_web.md)
- [ ] Ph7: replace the stroke speed/spin approximations with the bank 20-23 trajectory tables once decoded
- [x] Ph7: port the decoded CPU AI parameters (reaction delays, placement probability, positioning error, shot profiles, quick serve)
- [ ] Ph7: decode ProjectPoint 00:2D8C and replace the fitted projection
- [ ] Ph7: HUD with the game's font/score graphics; sound
- [x] Ph7: pixel-compare court rendering against emulator screenshots (99.9%)

### Documentation

- [x] docs/architecture_exe.md (first version — update as subsystems are understood)
- [x] docs/architecture_web.md
