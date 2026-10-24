# Mario Golf (Game Boy Color) — Reverse Engineering Notes

## Binary Identification

From `python3 tools/header.py` (all values checked against the dump; they agree with Data Crystal's USA column).

| Field | Value |
|-------|-------|
| File | `rom/mario_golf.gbc` (dump name `Mario Golf (USA).gbc`) |
| SHA-1 | `7f2062e51b4fc87378c1d5e6b9578c9277b94e0b` |
| MD5 | `83f791645ce282093a9d59c121ffc49d` |
| Size | 2 097 152 bytes = 128 banks of 16 KiB |
| Title / maker code | `MARIO GOLF` + `$00`, manufacturer code `AWXE` ($013F) |
| CGB flag ($0143) | `$C0`: CGB only |
| Licensee | new `01`, old `$33` (Nintendo) |
| SGB flag | `$00` (none) |
| Cartridge ($0147) | `$1B` MBC5 + RAM + battery |
| ROM size ($0148) | `$06` = 2 MiB |
| RAM size ($0149) | `$02` = 8 KiB SRAM (Tennis: `$03`, 32 KiB) |
| Region / version | `$01` overseas, mask ROM version `$00` |
| Header checksum | `$7A` (computed `$7A`, OK) |
| Global checksum | `$0FC7` (computed `$0FC7`, OK) |
| CPU | Sharp SM83 (LR35902) |
| Entry point | `0100: nop ; jp $0150`, `0150: jp $2DA0` (Start) |
| Build stamp | `0153`: ASCII `9908020118` + `$00` (reads as 1999-08-02; Tennis has its stamp at the same address) |

---

## Memory Map

Standard Game Boy Color map. Project-specific uses so far:

| Address Range | Purpose |
|---------------|---------|
| 0000-3FFF | ROM bank 0 (home). Used up to `$3100`; the rest is `$FF`. |
| 4000-7FFF | switchable ROM bank (MBC5, shadow in `hROMBank` = `$FF95`) |
| 8000-9FFF | VRAM, 2 banks |
| A000-BFFF | 8 KiB battery SRAM (enabled through `MBC5_RAMG`; Start writes `$00` = disabled) |
| C000-CFFF | WRAM bank 0. SoftReset clears `C000-CFEF` (ClearMemory16, `c = $FF` x 16 bytes); the stack starts at `$D000` and grows down into it. |
| D000-DFFF | WRAM banks 1-7 (shadow in `hWRAMBank` = `$FF96`); GameMain clears all seven (ClearMemory16 with `c = 0` = 4 KiB each). |
| FF80-FFFE | HRAM. `$FF80-$FFEF` cleared by Start; the OAM DMA routine is copied there (CopyOAMDMARoutineToHRAM, 00:066C). |

---

## Data-Range Map

| Start | End | Size | Classification | Notes |
|-------|-----|------|----------------|-------|
| 00:0000 | 00:0067 | $68 | vectors | RST and interrupt vectors, see Architecture |
| 00:0100 | 00:014F | $50 | header | |
| 00:0150 | 00:30FF | ~12 KiB | code | home bank, ~110 routines named from Tennis |
| 00:3101 | 00:3FFF | ~3.8 KiB | fill `$FF` | the sound engine is not in bank 0 (Tennis has it at 00:2F1A-3DFF) |
| 01-7F | | | mostly unclassified | per-bank `$4000` tables: see Bank map |

---

## Key Findings

### Architecture

#### Vectors (tools/disasm.py 0 0000)

| Vector | Target | Meaning (shown by reading the target) |
|--------|--------|------------------------------------|
| `rst $00` | 00:0690 JumpTableDispatch | `add a ; pop hl ; ... jp hl`: A-indexed `dw` jump table inline after the `rst` |
| `rst $08` | 00:2BBB PlaySoundCmd | reads 1 inline byte (sound id) and returns past it: songs < $36, jingles $36-$3A, effects >= $40 (see Sound) |
| `rst $10` | 00:01F6 FarCallVectorInline | reads inline `db idx, bank`, switches bank, jumps to word `[bank:$4000+idx]`, restores the bank, returns past the 2 bytes |
| `rst $18` | 00:01B6 FarCall | same inline `db idx, bank` far call; keeps a/hl (code identical to Tennis 00:01B6) |
| `rst $20` | 00:2D86 SetGameFlagCmd | inline `dw` flag argument (via FetchInlineWordOperand 00:2D65) |
| `rst $28` | 00:2D93 ClearGameFlagCmd | inline `dw` |
| `rst $30` | 00:2D79 TestGameFlagCmd | inline `dw` |
| `rst $38` | — | no handler (`$FF` fill; executing `$FF` would loop) |
| VBlank | 00:2EF9 | see "VBlank" below |
| LCD STAT | 00:2F81 | `reti` only |
| Timer | 00:2F6F | farcalls 7E:40EB (sound update) while the LCD is off |
| Serial | 00:2F93 | link-cable byte protocol, see "Serial link" below |
| Joypad | 00:0060 | `reti` |

So the Tennis conventions hold, with one difference: Golf's vector table has `rst $10` as a second far call
(Tennis's `$0010` holds data; its `call $01F6` form is replaced here by `rst $10`). Golf uses `rst $10` in
Start and the interrupt handlers; `tools/farcall_stats.py` finds only 87 byte-pattern hits for it, at the level
of chance (the `rst $20` baseline gets 222), so it is rare. `rst $18` has 8067 pattern hits, ~36x the
baseline: it is the normal far call.

#### Start-up (00:2DA0 Start, 00:2DAA SoftReset)

1. `A == $11` from the boot ROM -> `hIsCGB` (`$FFFE`) = 1.
2. SoftReset: `sp = $D000`, DisableLCDSafely, clear `C000-CFEF`, clear HRAM `$FF80-$FFEF`, zero IF/IE/SCY/SCX/STAT.
3. If not CGB: farcall 01:5278 (`rst $10 ; db $02, $01`), presumably the "CGB only" screen.
4. VBK/SVBK/RP = 0, SRAM disabled, OAM DMA routine to HRAM, ClearVRAMBank, SwitchCPUSpeed (double speed),
   `hFFA6 = 6`, 00:2683, ClearFrameTasks, 00:0458, farcall 7E:4072 (sound init).
5. WX = 7, WY = $90, TMA = $77, TAC = `$04` (timer on), STAT = `$08` (HBlank int source), LYC = $50, serial
   set up, IE = `$0D` (VBlank + Timer + Serial), LCDC = `$E7`, `ei`.
6. farcall 01:400E GameMain (`rst $10 ; db $00, $01`), which never returns (a `stop` follows).

GameMain (01:400E) starts by calling 00:304D, DisableLCDSafely, then clears WRAM banks 1-7 through `hWRAMBank`.

#### Frame sync (00:2E3B AdvanceFrame)

Same structure as Tennis's AdvanceFrame (00:2631; the first 12 instructions match): saves registers; if
`hLinkActive` (`$FFC8`) is set and `hLinkIdleCount & $E0` (32+ idle serial bytes: the link cable is gone) jumps
to LinkLostReset 00:2F8D, which farcalls 08:555F and restarts at SoftReset; a debug slow-motion/frame-step block driven by `hFF9E`/`hFF9A` and the joypad bytes at
`$FF90/91/94`; then `halt` until `hVBlankDone` (`$FF8D`), runs 00:2688 and RunFrameTasks (00:247D), clears
the flag and increments `wFrameCounter` (`$C4B2`). WaitFrames (00:2EF0) calls it C times; WaitFramesCmd
(00:2ED5) takes C as an inline byte after the `call`.

#### VBlank (00:2EF9 VBlankHandler)

1. ApplyPendingPaletteUpdates.
2. Only if the main loop has consumed the last frame (`hVBlankDone` = 0): scroll from the shadows `hSCX`/`hSCY`
   with BG map `$9800`, or, when `hWindowScroll` (`$FF98`) is set, SCX 0 / SCY `$40` with BG map `$9C00`; OAM DMA
   (`call $FF80`); ProcessBGBlitQueue, and if it had nothing to do ProcessVRAMCopyQueue (queue of 10 HDMA copies at
   `$C0A0`); UpdateDebugOverlay when `hDebugMode`; set `hVBlankDone`, increment `hVBlankCount`.
3. Every VBlank: ReadJoypad; held = `$0F` (A+B+Select+Start) jumps to SoftReset; SerialVBlankTick; farcall
   7E:40EB SoundUpdate; ResumeBGMAfterJingle; UpdateGameTimer; UpdateFadeOut; UpdateFadeIn; RunFrameTasks with
   A = `$80`.

So the joypad, sound and fades run at 60 Hz even when the main loop runs slow; VRAM work is done only for
frames the main loop finished. The main loop's AdvanceFrame also calls RunFrameTasks (A = 0) and
ClearUnusedSprites.

#### Serial link (00:2F93 SerialHandler, 00:304D InitSerialLink)

InitSerialLink sends `$70` on the external clock. A side that receives `$70` becomes the internal-clock side
(`hLinkRole` = 1, rSC = `$83`); one that receives `$71` becomes the external-clock side (`hLinkRole` = 2). Then
every received byte goes to `hSerialRecv`; `hLinkIdleCount` counts consecutive `$00`/`$FF` bytes (32 of them
in a row trigger LinkLostReset through AdvanceFrame). Data travels as nibbles: the sender (00:30AD
SerialNextSendNibble) takes byte `hFFC7 >> 1` of the send buffer `$CB00`, high nibble first, and sends
`$50 | nibble`; the receiver (00:30C9 SerialStoreNibble) packs `$5x` bytes into the receive buffer `$CB40`
(index `hFFC6 >> 1`, up to 64 bytes); a received `$4x` resets the receive index (`hFFC6` = 0), i.e. starts a
block. What is sent depends on `hSerialSendMode`: the idle byte (`$10`), the block (count in `hFFC5`) or `$40`.
SerialVBlankTick (00:3038) restarts the transfer each frame on the internal-clock side. InitSerialLink is called
from GameMain 01:400E, 02:63B8, 03:402E, 07:7CDA, 08:5565 (the link-lost path), 09:48BA and three times in bank
32: those are the link-mode entry points to trace.

#### Home bank vs Mario Tennis (tools/compare_home.py)

The Tennis ROM is not needed for this: the tool reads Tennis's bank 0 from the vendored disassembly
(`../mario-tennis-gbc/third_party/mario-tennis-gbc-disasm`, the files its `main.asm` puts in ROM0), reduces both
sides to instruction shapes (registers and conditions kept, numbers and symbols replaced) and finds, for each
Tennis routine of 6+ instructions, the Golf offset that agrees for longest.

Result: of 238 Tennis home routines, **114 match in full** and 14 more match for at least half their length.
`--labels` turned the full matches into 108 labels (marked `(as in Mario Tennis 00:XXXX)`); two Golf addresses
were claimed by twin Tennis routines that differ only in their callees:

- 00:0B3C: MulHLBySin or MulHLBySinSigned. Resolved to MulHLBySin, since its callee 00:0B4C matches
  MulHLBySinHalf in full.
- 00:11CB: MulSin or DivBySin. Resolved to MulSin: its callee 00:11DB (MulSinUnsigned, different code from
  Tennis) looks the angle up in SineTable (00:1201) and calls MulHLByDE.

The 14 partial matches were read one by one; the ones that are the same routine with changes got the Tennis
name with "partial match" in the comment (ReadJoypad, ProcessVRAMCopyQueue, AngleFromVectorCoarse,
ResumeBGM, SyncBGMEnableFlag, WaitJingleEnd, TickSecondaryTimer, InitSerialLink, plus SoftReset and
AdvanceFrame). The others were chance overlaps with already-named code (FarCallVector at 00:0235 is inside
DecompressDataFromBank, MulHLByDE32 at 00:0CB6 is MulHLByDE shifted by one byte, ...) or too short to tell
(EnableLCD, QueueVRAMCopyFromBank, IncrementLinkFrameCounter, RunSoundEngine).

Layout of Golf's bank 0, in Tennis's order with shifted addresses:

| Golf range | Contents (Tennis names) | Shift vs Tennis |
|------------|-------------------------|-----------------|
| 015E-0340 | bank-switch call helpers, FarCall, CopyDataFromBank, DecompressDataFromBank, VRAM clear, OBJ palettes, SwitchCPUSpeed | 0 (same addresses) |
| 0341-0690 | LCD on/off, memory clear/copy, VRAM copy queues (changed), palettes, Far* readers, OAM DMA | -5 to -0x40 |
| 0690-0880 | JumpTableDispatch (different code), indexed far helpers, 32->64 map copies | -0x30 to -0x68 |
| 08B9-1C00 | multiply/divide, random seed, sine/trig, AngleFromVector16 | about -0x6D to +0x5ED (Golf has extra code in this area; DivAHLByDE* do not match) |
| 1F2F-2035 | LZDecompress: different code, same format as Tennis 00:1797 | |
| 203E-2400 | debug overlay/text printing, decimal/hex formatting | +0x7AB |
| 23B6-24EA | frame task list | +0x87E |
| 24EB-2660 | colour components, fades | +0x881 |
| 27B4-2B00 | sprite world positioning, BG blit queue, 64-wide map blits | about +0x850 to +0x7D0 |
| 2B31-2C60 | sound command layer (PlaySoundCmd and BGM helpers); farcalls into bank 7E | |
| 2C6B-2D10 | game timer | +0x88E |
| 2D65-2DA0 | FetchInlineWordOperand, flag commands | +0x828 |
| 2DA0-2F92 | Start, SoftReset, AdvanceFrame, WaitFrames, interrupt handlers | |
| 2F93-3100 | serial link | |

Not in Golf's bank 0 (no match at all): Tennis's sound engine (00:2F1A-3DFF: PlaySound, UpdateSoundChannels,
RunSoundChannelScript, ...), the game-flag routines by byte/number (00:249F-2523), SortFrameTasks, the text
window drawing and 3D view projection helpers (00:2A2E-2F0C), the QueueSprite* family. The sound engine is
farcalled in bank 7E (7E:4016 from PlaySoundCmd, 7E:4072 from Start, 7E:40EB from TimerHandler).

#### LZ compression (00:1F2F LZDecompress; tools/decompress.py)

Read from the code: the same format as Tennis. A control byte gives 8 flags, LSB first: 1 = literal byte,
0 = back-reference `lo, hi`. `lo = hi = 0` ends the stream. Displacement `((hi >> 5) << 8 | lo) - $800`
(the code builds `h = (hi >> 5) | $F8`), length `(hi & $1F) + 3`. The routine is unrolled (control `$FF` copies
8 literals at once; `c` holds the inverted remaining flags plus a sentinel bit). It returns hl = bytes written.
DecompressDataFromBank (00:0234) calls it with hl = `[bank:$4000 + l]`.

Checked on data: `tools/decompress.py` on the bank 28 table gives 28:452F -> 4096 bytes, 28:478D -> 4096,
28:4924 / 28:499B -> 1024, 28:4A13 -> 2048 (whole tile blocks, each stream ending on its end marker). Other
entries in the same table (28:4068, 28:4A99: 3-byte streams to 0 bytes; and some that fail) are not LZ
streams, so each table mixes compressed and raw entries.

#### Bank map (first pass; tools/scan_jumptables.py, tools/bank_map.py)

`bank_map.py` columns: `$4000` table entries, entries that LZ-decompress cleanly, `rst $18` call sites into the
bank. Assets are LZ: banks 28-2F, 40, 4B-4E, 72-74 have 12-37 clean LZ entries each.

| Banks | Evidence | Likely role |
|-------|----------|-------------|
| 01 | 7-entry table; GameMain 01:400E | boot / top level |
| 02, 05, 0A, 0B, 10 | most far-call targets (0A: ~5150 call sites, 10: ~880, 05: ~560, 02: ~370, 0B: ~220) | engine libraries |
| 28-2F, 72-74 | 22-52 entries, ~60% LZ | **overworld map graphics** (confirmed: MapGfxTable, see Graphics) |
| 40, 4B-4E | LZ entries of many sizes | UI tiles, faces, sprites (40:66F6 = menu tiles and face icons; 4D: sprite frames) |
| 30-35 | 900-1400 `rst $18` call sites each, mostly into 0A | script-like code (story / RPG mode?) |
| 7C-7E | the same sound driver code in each, songs after it | **sound driver + music** (confirmed, see Sound) |
| 7F | 2 exports | **sound effects** (confirmed) |
| 18-1F | 2 exports each, at the end of the bank, called from LoadText 05:6179 | **text banks** (confirmed, see Text) |
| 0D, 3D, 44 | 1-2 exports far from `$4000`, but real: far-called from code (0D:4AA7 from 32/3D/58; 3D:431A from 3C; 44:42FB from 05/08/32) | code |
| 46 | 2 words, no far call uses them (`scan_jumptables.py` kind `header`) | data, no export table |
| 27, 47 | no table; 27 is all `$FF` | empty / data |

These roles are guesses from counts only (except the text banks); they are listed so they can be checked.
A first pass called banks 18-1F, 44 and 46 heuristic false positives; the far-call evidence above corrected
that, and `scan_jumptables.kind()` now uses it.

#### Text (tools/dump_text.py, tools/text_stats.py; read from 05:6179, 18:7D14 and the printer 05:5235)

- **Text id** (16 bit): bank `$18 + ((id >> 10) & 7)`, index `id & $3FF`. LoadText (05:6179, export `$24` of
  bank 05) decodes it and farcalls that bank's export 0, which copies `$180` bytes of the string to wTextBuffer
  (`$C600`). LoadTextShort (05:61D4) farcalls export 1, which copies `$20` bytes to `$D880` (names, labels).
- **Text bank layout**: each bank's loader holds its own constants `ld hl, TABLE ... ld hl, DATA`. The word
  table at TABLE (`$4004` in every bank seen) holds string offsets relative to DATA (bank 18: `$4404`, 19:
  `$41B4`, ...); the table runs up to DATA. 2963 strings: 18: 512, 19: 216, 1A: 252, 1B: 285, 1C: 264, 1D: 497,
  1E: 768, 1F: 169.
- **Encoding**: ASCII `$20-$7E`; strings end with `$00`. Font: 03:50F0, one 2bpp 8x8 tile per glyph, glyph =
  char - `$20` (102 slots, `$20-$85`; `$7B` and up are blank), drawn by 03:4B45 into WRAM bank 7; per-glyph widths
  at 03:5750 (variable width).
- **Control codes**: the printer 05:5235 ends on `$00`, reads `$0E`'s argument byte into `$C361`, sends every
  byte below `$20` to the handler table at 05:592C (dispatcher 05:58E2), and maps `$DE`/`$DF` to handlers `$1E`/`$1F`.

| Code | Handler | Meaning (from the handler; text examples in `docs/text_dump.txt`) |
|------|---------|-----------------------------|
| `$01` (and `$00`, `$14-$1D` in the table) | 05:52EF | new line |
| `$02` | 05:538E | new text box (next page) |
| `$03` | 05:5433 | wait for A/B (joypad `& $F3`) unless flag #22 is set, then close (farcall 03:4F7D) |
| `$04` | 05:546A | insert the next string argument (list at `$DFAE`, counter `$D847`) |
| `$05` | 05:534C | pause 30 frames |
| `$06` | 05:5369 | pause up to 15 frames, skipped by a button |
| `$07` | 05:55C0 | insert the string at `$C800` (the player's name: "`{07}` checked the chest...") |
| `$08` | 05:564C | insert the next byte argument (list at `$DFEE`) |
| `$09` | 05:56AB | insert the next number argument (WRAM bank 5; "You earned `{09}` EXP Pts!") |
| `$0A` | 05:5307 | cursor down one row |
| `$0B` | 05:5786 | club / course name: text `$3C + [$D85D]` (Marion, Palm, Dune, Links, Peach, Pitch & Putt) |
| `$0C` | 05:5465 | pause 60 frames (calls WaitFramesCmd with the inline byte `$3C`) |
| `$0D` | 05:531B | uses the pointer at `$D864` and `$C362` (not yet understood) |
| `$0E xx` | 05:57DF | character name: text `$43 + xx` (`$43` Kid, `$44` Sherry, `$45` Azalea, `$46` Joe, ...) |
| `$0F` | 05:5828 | placing: text `$1CA3 + ([$DFCE] & 3)` ("000", "1st", "2nd", "3rd") |
| `$10-$13` | 05:5900-5921 | write tile `$0A-$0D` directly (special glyphs) |
| `$DE`, `$DF` | 05:5580, 05:55A0 | modify the previous glyph (Japanese dakuten / handakuten, left over from the Japanese version) |

#### Sound (banks 7C/7D/7E and 7F; tools/dump_songs.py)

- **Commands** (`rst $08 ; db id`, PlaySoundCmd 00:2BBB): id `< $36` = song id: stored in wCurrentBGM (`$C33E`)
  and passed to SoundCmdDispatch (7E:4016), which accepts it if below SongCount (`$2B` = 43 songs) and writes
  wMusicRequest. Ids `$36-$3A` are jingles: song `JingleSongTable[id - $36]` (00, 17, 18, 19, 1A), with
  `hActiveJingle` set so the BGM comes back afterwards (WaitJingleEnd, ResumeBGMAfterJingle). Ids `>= $40`
  are effects: `id - $40` goes to SoundRequestSFX (7E:4022), which keeps the higher-priority request
  (SFXPriorityTable 7E:5235).
- **Driver**: the code at `$4000-$52D8` is byte-identical in banks 7C, 7D and 7E
  (`python3 tools/compare_banks.py 7c 7e`); each bank holds different songs after it. SongStart (7E:4186)
  picks the song's bank from SongBankTable (7E:52A5) and writes it straight to the MBC (with its own shadow
  `hFFBF`, not hROMBank); because the code is the same in every copy, execution continues in the new bank.
  SoundUpdate (7E:40EB, every VBlank) first runs the effects engine (farcall 7F:406C), then switches to
  wSoundBank and updates the four channels (7E:42B9, 4308, 4359, 43AE); SoundCheckMusicEnd (7E:49CC) marks
  the music finished when the four channel flags at `$C4CD` are clear.
- **Song table**: word `$52D7 + 2n` in the song's bank. A song header is 9 bytes: a channel mask (bit 0 =
  channel 1) and 4 channel pointers. Songs 01-09 are in 7E, 0A-16 in 7D, 17-2A in 7C; song 00 (mask 0) is
  silence (SyncBGMEnableFlag plays it to mute the music).
- **Effects**: bank 7F (2 exports: SFXStart 7F:400A, SFXUpdate 7F:406C). Two effect tables: ids `< $65` at
  7F:495C (count) / 7F:495D (pointers), ids `>= $65` at 7F:615F / 7F:6160.

#### Graphics (tools/render_map.py, tools/extract_tiles.py)

- **Overworld map graphics**: MapStartGfx (0B:46DF, a = wMapGfx from the MapTable record) -> MapLoadGfxScreen
  (0B:44C4) -> MapLoadGfx (0B:440C). MapGfxTable (0B:4048) has 35 descriptors (`$00-$22`, exactly the gfx ids
  the map table uses), 18 bytes each: 9 `(idx, bank)` refs into `$4000` tables:

  | Ref | Data | Destination |
  |-----|------|-------------|
  | w0 | header, 16 bytes raw | `$C600`; bytes 2-5 -> `$C329-$C32C` |
  | w1 | palettes, `$40` bytes raw | WRAM1 `D000`; BG palettes 2-7 from `+$10` |
  | w2 | tilemap, LZ, 4096 bytes | WRAM3 `D000`: 64 x 64 tile numbers, signed `$9000` addressing |
  | w3 | attribute map, LZ, 4096 bytes | WRAM2 `D000` (bits 0-2 palette, 3 VRAM bank, 5/6 flip) |
  | w4, w5 | LZ, 1024 bytes each | WRAM6 `D000`, `D400` (collision / events? not yet known) |
  | w6 | — | not loaded |
  | w7 | LZ | WRAM6 `D800` |
  | w8 | tiles, LZ | WRAM1 `D000`, then VRAM bank 1: first `$800` bytes to `$9000`, next `$800` to `$8800` |

  The same layout as Mario Tennis's RPG maps (Tennis 0A:59D9 has 8 refs); Tennis's RPG engine evidently
  comes from this one. `render_map.py` draws all 35 correctly (checked by eye: gfx 02 is a clubhouse
  interior, gfx 14 the Palm Club area map, gfx 1E the star background used by maps 00, 01 and 24).
- **Font**: 03:50F0 is plain 2bpp 8x8 tiles in ASCII order from `$20` (rendered: `gfx/raw_03_50f0.png`).
- **Other LZ banks**: 40, 4B-4E, 58 hold LZ entries of many sizes (`extract_tiles.py`): 40:66F6 is menu UI
  tiles (digits, pre-drawn mode labels, character face icons); 4D holds sprite frames. Not traced to loaders yet.

### Data Structures

*(none yet)*

### State Machine

#### Top level: the map engine (bank 0A; tools/dump_maps.py)

GameMain (01:400E) initialises WRAM, palettes and the font tiles (01:41CE LoadFontTiles), runs three bank-02
setup calls (02:41F6, 02:45D3, 02:4E3D), clears the shadow OAM, then `jp 01:41A6`, skipping a debug boot menu at
01:40A6-41A2 that nothing reaches (it prints BuildStamp and starts tests on Up + a button). 01:41A6 sets
`wMapId` = 0 and `wMapEntrance` = 3 and farcalls **MapEngine (0A:498C)**, which never returns:

```
MapEngine:  forever:
    ClearFrameTasks; RegisterFrameTask(1, MapDebugCoordsTask 0A:4950)
    MapRun (0A:4A21):
        fade out (c = $0C); wMapLoadPhase = $10
        clear wMapEvent; MapLoadHeader (0A:4BBC); MapPlaceAtEntrance (0A:4C0D)
        play wMapMusic unless $FF (00:2C19); phase $20: header +4 -> 0A:4F45; farcall 04:4D2B
        phase $30: player position -> $C320/$C322; farcall 0B:46DF with wMapGfx; phase $40: 0A:4F71
        fade in; MapEventLoop (0A:4AAA): each frame (AdvanceFrame via 0A:4BAC) look at wMapEvent:
            +0: 0A:50CB     +1: warp id -> $C46B, leave MapRun
            +4: sound $62, menu farcall 41:6E6E
            +3: a timer at $C28C-$C28E (>= 30) raises flag #23 and an action
            +2 (the A button): talk list (0A:49C6 -> 0A:4F96), object list (0A:49E9 -> 0A:5066),
                0A:4D1F -> 0A:5109; otherwise the debug menu 05:6B2E when hDebugMode,
                or 0A:7174 on map 2 (sound $5C)
    MapTakeWarp (0A:5146): warp record (8 bytes) -> wMapId = +6, wMapEntrance = +7
```

**MapTable (0A:5188)**: 6-byte records `[map id, gfx id, header idx, header bank, music, ?]`, ending with `$FF`.
63 maps (`$00-$3E`); the header is the word at `bank:$4000 + idx`. Header banks are 30-35, which explains their
many far calls into 0A. Some maps share a header (08-0B; 0E/11/14/17; 18-1B; 2E/2F), presumably the same room
in different states.

**Map header** (14 bytes, copied to `$C456`; every pointer is in the header's bank, `wMapBank`):

| Offset | Field | Used by |
|--------|-------|---------|
| +0 | entrances: 6-byte records `[entry id, ?, x (word), y (word)]`, end `$FF` | MapPlaceAtEntrance |
| +2 | warps: 8-byte records, bytes 6/7 = destination map / entrance | MapTakeWarp |
| +4 | data right after the header; passed to 0A:4F45 at map start | MapRun |
| +6 | talk targets | 0A:49C6 |
| +8 | objects | 0A:49E9 |
| +10, +12 | not yet known | |

The pointers in each header point just past it and increase in this order, which supports the layout. The map
engine is the RPG ("story") side; how golf rounds and the menus are entered from it is the next thing to trace.

---

## Intermediate Output Files

| File | Contents |
|------|----------|
| `python3 tools/dump_maps.py [--entrances]` (stdout) | map table and headers |
| `gfx/map_XX.png` (gitignored) | the 35 overworld map graphics, 512 x 512 |
| `gfx/lz_BB_AAAA.png`, `gfx/raw_03_50f0.png` (gitignored) | LZ entries as tile sheets; the font |
| `python3 tools/gen_all.py` | rebuilds all of the above |
| `out/boot_FFFFF.png` (gitignored) | emulator screenshots from `emu_boot.py` |
| `docs/text_dump.txt` (gitignored) | every string: `id bank:index text`, control codes as `{XX}` (`python3 tools/dump_text.py`) |

---

## Verification Checklist

- [x] Ph3: 3+ functions traced and cross-checked against emulator trace (`tools/emu_verify.py`: LZDecompress,
      LoadText, MapLoadHeader, MapLoadGfx; see "Verification" below)
- [x] Ph4: tiles extracted and compared to the emulator: two whole map tile sets in VRAM bank 1 match byte for
      byte; gfx 1E matches the character-creation screen by eye
- [ ] Ph5: key data struct confirmed in emulator memory dump, all fields match (MapTable record at $C450-$C455:
      yes; the map header fields and the golf structures: not yet)
- [ ] Ph6: full game session played, no major logic gaps found
- [ ] Ph7: web port pixel-compared against emulator screenshots

---

### Verification (PyBoy 2.8, `tools/emu_verify.py`, `tools/emu_boot.py`)

`emu_boot.py` boots the game headless (no battery RAM) and saves screenshots to `out/`: the intro (narration
text, then large character art) plays in map 00 at entrance 3; Start then A reach the character select
(map 00) and the character creation room (map `$1E`, gfx `$1E`, the star background).

`emu_verify.py` runs the same boot with hooks on the real routines and compares with the Python decoders.
Result over 4800 frames:

| Check | Hook | Result |
|-------|------|--------|
| LZ | 00:1F2F entry / 00:1F8D end: bytes written vs `decompress.py` | 1849 of 1849 match |
| Text | 05:6179 / 05:61CF: wTextBuffer vs `dump_text.py` | 8 of 8 match |
| Map record | 0A:4BFA: `$C450-$C455` vs MapTable (`dump_maps.py`) | 2 of 2 match |
| Map graphics | 0B:4500: WRAM3 tilemap, WRAM2 attributes, VRAM1 `$9000`/`$8800` tiles vs `render_map.py` | 6 of 6 regions match |

---

## Reference Resources

- Data Crystal: https://datacrystal.tcrf.net/wiki/Mario_Golf_(Game_Boy_Color) (header values; stub page)
- `../mario-tennis-gbc/` (same developer and cartridge; its vendored disassembly is used only by
  `tools/compare_home.py` to find shared routines and names)

---

## Next Tasks

### RE Investigation

- [x] Ph1: identify binary header and platform (header.py; SHA-1 recorded)
- [x] Ph1: RST and interrupt vectors, entry point, Start / SoftReset / AdvanceFrame
- [x] Ph1: bank 0 comparison with Mario Tennis (compare_home.py, 108 labels)
- [x] Ph1: confirm LZ format (LZDecompress 00:1F2F = Tennis format)
- [x] Teach `disasm.py` the `$4000` table: it lists the entries as `dw` when disassembling a bank from `$4000`
- [x] Short `$4000` tables: classified by far-call evidence (`scan_jumptables.kind()`); only bank 46 is a header,
      banks 18-1F turned out to be the text banks
- [x] Resolve 00:11CB: MulSin
- [x] Read the 14 partial matches and name them from the code
- [x] Name the unmatched bank-0 code: 0458, 2683/2688, 304D, 3038, 2C4A, the VBlank handler, the serial protocol
- [ ] 00:2B31 (copies a column into WRAM bank 3, sets `hFFB9`): no `call` to it; find how it is reached
- [ ] Link modes: trace the InitSerialLink callers in banks 02, 03, 07, 09 and 32
- [x] GameMain 01:400E: followed to MapEngine 0A:498C (map table, header, warps, event loop)
- [x] Map 00 (the boot map, entrance 3): the intro, then the character select (emulator, emu_boot.py)
- [ ] Map 00: how its init data (32:4FF7, header +4) drives the intro and the character select (0A:4F45)
- [ ] How a golf round is started from a map (talk/object handlers 0A:4F96 / 0A:5066 / 0A:5109) and how it returns
- [ ] Map header fields +10/+12; warp record bytes 0-5; entrance byte 1; MapTable byte 5
- [ ] The bank-02 setup calls in GameMain (02:41F6, 02:45D3, 02:4E3D) and the save check at 02:4078 ("CAMELOT GAMEBOY" at 02:4162)
- [x] Sound: driver copies in 7C/7D/7E, song bank/pointer tables, command id ranges, effects bank 7F
- [ ] Sound: channel script format (7E:42B9 per channel) and the effect format (7F); exports 7E:4043-4064, 49DF, 49EB
- [x] Text: text banks 18-1F, id format, control codes, font 03:50F0 (dump_text.py)
- [x] Text: font rendered; plain 2bpp tiles
- [ ] Text: control code `$0D` (05:531B) and where the argument lists `$DFAE`/`$DFEE` are filled
- [x] Decompress and render LZ entries (extract_tiles.py); overworld maps fully rendered (render_map.py)
- [ ] Map descriptor w4/w5/w7 (WRAM6 D000/D400/D800): collision, event or height maps? Find their readers
- [ ] Loaders for the LZ entries in banks 40, 4B-4E, 58 (UI, faces, sprites) and the golf course graphics
- [ ] Milestone 3: run the game on `web/js/gb` (copy from Tennis) with SRAM saving; `core_vs_pyboy.mjs`

### Web Port Fixes

### Documentation

- [ ] `docs/architecture_exe.md` once the main loop and bank roles are confirmed
