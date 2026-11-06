# Mario Tennis (GBC) — ROM architecture

Status: early (bootstrap session). Addresses are `bank:addr`; bank 0 is fixed at `$0000-$3FFF`.
Everything here was derived from the ROM with the tools in `tools/`.

## Binary layout

```
bank 00          fixed: vectors, trampolines, LZ, VRAM/palette helpers, tasks, ISRs, sound driver core
banks 01-0B      engine / game-logic code (each starts with a $4000 export table)
banks 0C-16      mixed (small export tables; not yet classified)
banks 17-19,1B   compressed graphics (tile sets, 1 KB maps, 64-byte blocks)
banks 1A,1C-1E   code (many Decompress callers -> screen setup code)
banks 1F,25,26,30-37,5E,6E   TEXT banks (ASCII, offset table at $4004) — 4109 messages
banks 20-24,27-2C            code/data (TBD)
banks 2D-2F      math lookup tables (2D sine for MulSinCos 00:1332; 2E/2F used by ProjectPoint 00:2D8C)
banks 38-3F      screen graphics: tiles, tilemaps, palettes (menus, title, results)
banks 40-5D      character SPRITE banks, char ids 0-29 (240-byte frames, 8x16 OBJ column-major)
banks 5F-63      COURTS: LoadMap descriptors 0-15 (32x32 maps)
banks 63-69      RPG-mode AREAS: LoadMap descriptors 16-36 (64x64 maps)
banks 6A-6D      graphics (6C/6D: many palettes + tiles)
banks 6F-77      code/data (TBD)
banks 78-7E      no export table; active during the intro cutscene (cutscene data, PyBoy-observed)
bank 7F          padding ($FF)
```

## Bank-0 module map

| Range | Module | Key entry points |
|-------|--------|------------------|
| `0000-0067` | RST/IRQ vectors | rst00 JumpTable, rst08 SoundCmd, rst10/18 FarCall, rst20/28/30 flags |
| `015E-024D` | far-call trampolines | `015E FarCallHL`, `0184 FarJumpTable`, `01B6 FarCallInline`, `021A CopyBankTable`, `0234 DecompressBankTable` |
| `02EB-0345` | input | `02EB ReadJoypad` (held/pressed/repeat, soft-reset combo) |
| `03AF-0464` | memory | `03AF MemClear256`, `03DB MemCopy`, `03F3 MemCopy16` |
| `0480-05xx` | VRAM/palette | `0480 CopyToVRAM` (A000-BFFF = VRAM bank 1, HDMA queue when LCD on), `05B0 LoadBGPalettes` |
| `0692-06EF` | LZ wrappers, OAM DMA | `0692 DecompressFar`, `06AC InstallOAMDMA`, `06C4 JumpTableInline`, `06CF DecompressBankTable2` |
| `1797-188A` | LZ decompressor | `1797 Decompress` |
| `18EB-1960` | debug text | `1906 PrintStringDebug`, `1935 PrintHex16` |
| `1B38-1C3F` | task scheduler | `1B38 ClearTasks`, `1B6A AddTask`, `1BCB RemoveTask`, `1BFF RunTasks` |
| `249F-2577` | event flags | `rst $20/$28/$30` → set/clear/test bit in `wEventFlags $C9C0` |
| `2578-2630` | boot | `2578 Init` |
| `2631-2748` | frame sync | `2631 WaitFrame` |
| `2749-28xx` | interrupts | `2749 VBlank`, `27D7 Timer`, `27F5 STAT`, `2861 Serial` |
| `2F1A-33xx` | sound | `2F1A SoundUpdate`, `2FB3 SoundCmdInline`, `3024 PlaySound`, `3297 SoundStart`, `3373 SoundDriverTick` (state in WRAM7 `$D000`, swapped with HRAM `$FFD0`) |

## Calling conventions

* **Export tables**: every code bank starts with `dw` entry points at `$4000`. Cross-bank calls
  are `rst $18 ; db idx, bank` (idx = byte offset into the table). Data banks reuse the same
  table layout to index assets, consumed by `DecompressBankTable (H=bank, L=idx)`.
* **State machines**: `rst $00` followed by an inline `dw` table, index in A.
* **Event flags**: `rst $30 ; dw n<<5` tests flag n (Z clear if set). Flag storage `$C9C0`.
* **Sound**: `rst $08 ; db id` or `ld a,id ; call $3024`.
* Registers A/HL survive a farcall; the callee's bank is restored on return.

## Boot & per-frame flow

```
$0100 -> $0150 -> Init $2578
  CGB check (A==$11) -> DMG: farcall 01:6030 "CGB only" screen, halt
  SP=$D000, clear WRAM/HRAM, OAM-DMA stub -> $FF80, timer/STAT/serial/IE, LCDC=$E7
  rst $18 00 01 -> MainLoop 01:4018
      clear WRAM banks 1-6, init subsystems (banks 03, 02, 08), SRAM check 03:495D
      farcall 0A:4F2C GameTop  (never returns)
          loop: ClearTasks; AddTask(0A:4EFC); call GameFlow 0A:4F40

GameFlow 0A:4F40 (per scene):
  fades, LoadMap (0A:585D), InitMapScroll (0A:5930, adds scroll task),
  WaitFrame loop ... (state machine: TBD)

WaitFrame $2631:  RunTasks -> flip OAM double buffer ($C0/$C5 via wC3A7) -> wait VBlank flag
VBlank  $2749:    SCX/SCY from shadows ($FF8B/$FF8A), window mode ($FF98), OAM DMA,
                  HDMA/VRAM queue ($218D/$052E), palette upload ($1893), frame counter,
                  ReadJoypad (+ soft reset A+B+Sel+Start), $0A3A, $23DD, $1D5E, $1D48, SoundUpdate
Timer   $27D7:    SoundUpdate while the LCD is off (keeps music running during loads)
```

## Data flow: a map/court on screen

```
LoadMap(A=id)
  0A:59D9[id] -> 8 bank refs
  w7 tiles  --LZ--> WRAM1:D000 --CopyToVRAM--> VRAM1 $9000/$8800
  w2 map    --LZ--> WRAM3:D000 ┐
  w3 attrs  --LZ--> WRAM2:D000 ├ streamed into the 32x32 BG map by the scroll task
  w4/w5     --LZ--> WRAM6:D000/D400 (TBD)
  w1 pal    --copy-> WRAM1 --LoadBGPalettes(2..7)--> wPalBuffer $C1xx/$C2xx --VBlank--> BCPD
  w0 header --copy-> WRAM6:DC08 -> wC329..wC32C
```

## Shared RAM regions (known so far)

| Address | Name | Purpose |
|---------|------|---------|
| `C000-C09F`, `C500-C59F` | OAM buffers | double-buffered; `wC3A7` holds the high byte ($C0/$C5) |
| `C1C0-C1FF` | `wTaskList` | 16 × [param, addr lo, addr hi, bank] |
| `C100/C200` | palette buffers | written by `LoadBGPalettes` |
| `C600` | `wTextBuffer` | current message |
| `C9C0` | `wEventFlags` | RPG-mode event bits |
| `D880` (WRAM?) | `wNameBuffer` | short strings |
| WRAM1-3,6 `D000` | map work areas | see LoadMap |
| WRAM7 `D000` | sound driver state | |
| `FF80` | `hOAMDMA` | DMA routine |
| `FF8A-FF8D` | scroll shadows, frame counter, VBlank flag |
| `FF90/FF91/FF94` | joypad held / repeat / pressed |
| `FF95-FF97` | ROM / WRAM / SRAM bank shadows |
| `FFFE` | `hIsCGB` |
