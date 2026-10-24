# Mario Golf (GBC, USA) — architecture of the ROM

The ROM as it is understood so far. Details and evidence are in [../REVERSE.md](../REVERSE.md); names are in
[../labels.csv](../labels.csv). Addresses are `BB:AAAA`. "Confirmed" means read from the code and, where marked,
checked in the emulator (`tools/emu_verify.py`).

## Binary layout

- 2 MiB, MBC5 + 8 KiB battery SRAM, CGB only. SHA-1 `7f2062e51b4fc87378c1d5e6b9578c9277b94e0b`.
- Bank 0 (home): `$0000-$30FF` code, rest `$FF`. Most of it is the same engine library as Mario Tennis's home
  bank (114 routines match, many at the same or shifted addresses); Golf's sound engine is not in bank 0.
- Banks 1-7F: each starts with a `$4000` word table of exports/assets (bank 46 has none; 27 is empty).

| Banks | Role | Status |
|-------|------|--------|
| 00 | home: far calls, memory, math/trig, LZ, text/number printing, fades, frame tasks, timers, VBlank, joypad, serial | confirmed |
| 01 | GameMain (boot), font tiles, palettes; an unreachable debug boot menu | confirmed |
| 02 | setup and save code (SRAM signature "CAMELOT GAMEBOY" at 02:4162) | partly read |
| 03 | text box and glyph drawing; the font (03:50F0) and widths (03:5750) | confirmed |
| 05 | text loading and printing (LoadText 05:6179, PrintText 05:5235, control codes) | confirmed |
| 08 | golf round helpers (hole setup, frame waits during the round) | seen in traces |
| 0A | the map engine (MapEngine 0A:498C, MapTable 0A:5188) — the main loop of the game | confirmed |
| 0B | map graphics loader (MapGfxTable 0B:4048) | confirmed |
| 10 | the golf round (GolfRound 10:4451) | entry confirmed in the emulator |
| 12, 13 | hole setup (LZ data during hole load) | seen in traces |
| 18-1F | text banks: 2963 ASCII strings | confirmed (emulator) |
| 28-2F, 72-74 | overworld map graphics (35 descriptors) | confirmed (emulator) |
| 30-35 | map headers and their lists (63 maps) | confirmed |
| 40, 4B-4E, 58 | LZ UI tiles, faces, sprites | partly seen |
| 50-5D, 5F-71 | probably course / hole data (LZ read during hole load) | hypothesis |
| 7C, 7D, 7E | sound driver (identical code in each) + music | confirmed |
| 7F | sound effects | confirmed |

## Conventions (calling and data)

- `rst $18 ; db idx, bank` far call (FarCall 00:01B6); `rst $10 ; db idx, bank` second far call (00:01F6).
  Both call the word at `bank:$4000+idx` and restore the bank. `rst $00` + inline `dw` table (A-indexed);
  `rst $08 ; db id` sound command; `rst $20/$28/$30 ; dw` set / clear / test a flag.
- `hROMBank` (`$FF95`) and `hWRAMBank` (`$FF96`) shadow the MBC and SVBK registers; the sound driver keeps its
  own ROM bank shadow (`$FFBF`).
- Assets: LZ (00:1F2F; `tools/decompress.py`). Text: ASCII, ids `bank $18 + (id >> 10 & 7)`, index `id & $3FF`.

## Execution flow

```
power on -> 0100 -> 0150 -> Start 00:2DA0
  Start: hIsCGB; SoftReset 00:2DAA (stack $D000, clear WRAM0/HRAM, CGB check -> 01:5278 if not CGB,
         OAM DMA routine, double speed, ClearFrameTasks, sound init 7E:4072, timer/serial/LCD, ei)
  -> farcall GameMain 01:400E (never returns)
       InitSerialLink, clear WRAM 1-7, font, palettes, bank-02 setup (02:41F6, 02:45D3, 02:4E3D)
       -> 01:41A6: wMapId = 0, wMapEntrance = 3 -> MapEngine 0A:498C (never returns)

MapEngine, forever:
    ClearFrameTasks; RegisterFrameTask(1, 0A:4950 debug coordinates)
    MapRun 0A:4A21: load map record + header (bank 30-35), place at entrance, music,
                    map graphics (0B:46DF -> 0B:440C), fade in,
                    MapEventLoop: every frame react to wMapEvent ($C440-$C444):
                        warp -> leave MapRun; A button -> talk / object / sign handlers; menu (41:6E6E)
    MapTakeWarp 0A:5146: next wMapId / wMapEntrance from the warp record

map 00 (entrance 3): intro -> character select -> play-mode menu -> GolfRound 10:4451 (round id in $C833)
```

Frame timing: the main loop calls AdvanceFrame (00:2E3B), which halts until the VBlank handler sets
`hVBlankDone`, then runs ClearUnusedSprites and RunFrameTasks. The VBlank handler (00:2EF9) does the VRAM work
(scroll, OAM DMA, BG blit queue or HDMA copy queue) only when the main loop has finished its frame, and every
frame reads the joypad (soft reset on A+B+Select+Start), runs the sound update (7E:40EB), timers, fades and
frame tasks. The timer interrupt runs the sound update while the LCD is off; the serial interrupt runs the link
protocol (nibble-coded `$5x` bytes, `$70/$71` handshake; LinkLostReset after 32 idle bytes).

## Data flow (main structures)

| Data | Source | Destination |
|------|--------|-------------|
| MapTable record (6 bytes) | 0A:5188 | `$C450-$C455` |
| map header (14 bytes) | banks 30-35 | `$C456-$C463`, bank in `$C464` |
| map graphics: tilemap / attributes / 3 maps / tiles / palettes | banks 28-2F, 72-74 (LZ) | WRAM3 / WRAM2 / WRAM6 / VRAM1 / BG palettes |
| message text | banks 18-1F | wTextBuffer `$C600` (`$180` bytes) |
| shadow OAM | game code | `$C000-$C09F` -> OAM by DMA from `$FF80` |
| VRAM copy queue | game code | `$C0A0` (10 x 8 bytes) -> HDMA in VBlank |
| music request / effect request | PlaySoundCmd | `$C4C0` / `$C4C2` -> sound driver |
| link send / receive buffers | golf round, menus | `$CB00` / `$CB40` |

## Not yet mapped

The golf engine itself (shots, ball physics, terrain, putting, CPU players, scoring), the course and hole data
format, the save layout in SRAM, the menu system, and the story scripts. See REVERSE.md "Next Tasks".
