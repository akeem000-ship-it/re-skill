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
- **Music script** (MusicRunScript 7E:43EF, one script per channel at wChScriptPtr `$C4D5`; per-channel arrays
  of 4 bytes from `$C4CD` to `$C535`, labelled in labels.csv). A byte `< $D0` is a note: the low nibble + 1
  times wChLengthUnit is the duration in frames, the high nibble the pitch (0 = rest; on the noise channel an
  instrument from NoiseInstrumentTable 7E:4F41). The frequency is MusicFreqTable 7E:4C4B indexed from the
  octave base (MusicOctaveTable 7E:4C43) + 2 x pitch + 2 x transpose, plus the signed detune. A note sounds
  for wChGate/8 of its duration, then the release envelope. Commands (MusicCommandTable 7E:4407):

  | Byte | Effect | Byte | Effect |
  |------|--------|------|--------|
  | D0 nn | length unit | E4 nn | detune (signed) |
  | D1-D6 | octave 0-5 (wave channel +1) | E5 nn | duty (`nn & $C0`) |
  | D7 / D8 | octave up / down | E6 nn | envelope (NRx2) |
  | D9 | tie (next note not retriggered) | E7 nn | wave pattern (WavePatternTable 7E:4CDD) |
  | DA, DB, EF-FF | channel end | E8 nn | gate in eighths |
  | DC nn | panning bits (NR51 shadow wPanning) | E9 nn | wave volume after the gate |
  | DD / DE | set loop point / jump to it (song loop) | EA nn | vibrato type (VibratoTable 7E:50C9) |
  | DF nn / E0 | repeat block nn times | EB nn | vibrato delay |
  | E1 ww | jump | EC nn / ED nn | transpose set / add |
  | E2 ww / E3 | call / return (12-byte stack per channel) | EE nn | release envelope |

  The channels a sound effect is using (wSFXChannelMask `$C4CC`) are left alone by the music. Exports `$08-$14`
  (mute mask, music / effect playing tests, pause toggle, master volume, save-and-stop / restore of the whole
  driver state to `$C59A`) are never far-called in this ROM.
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
  | w4, w5 | LZ, 1024 bytes each | WRAM6 `D000`, `D400` terrain grid and event grid, 32 x 32 cells of 2 x 2 tiles (see "Banks by role", bank 0B) |
  | w6 | — | not loaded |
  | w7 | LZ | WRAM6 `D800` |
  | w8 | tiles, LZ | WRAM1 `D000`, then VRAM bank 1: first `$800` bytes to `$9000`, next `$800` to `$8800` |

  The same layout as Mario Tennis's RPG maps (Tennis 0A:59D9 has 8 refs); Tennis's RPG engine evidently
  comes from this one. `render_map.py` draws all 35 correctly (checked by eye: gfx 02 is a clubhouse
  interior, gfx 14 the Palm Club area map, gfx 1E the star background used by maps 00, 01 and 24).
- **Font**: 03:50F0 is plain 2bpp 8x8 tiles in ASCII order from `$20` (rendered: `gfx/raw_03_50f0.png`).
- **Other LZ banks**: 40, 4B-4E, 58 hold LZ entries of many sizes (`extract_tiles.py`): 40:66F6 is menu UI
  tiles (digits, pre-drawn mode labels, character face icons); 4D holds sprite frames. Not traced to loaders yet.

#### Golf round (bank 10; first pass with the emulator)

Found by playing in PyBoy (Start, A, Right x4 to Mario, A, A, A: "Play Modes" -> "Stroke: Try a practice round!"
-> hole 1, par 4, 374 y) and recording the callers of AdvanceFrame (`tools/emu_callers.py`):

- **10:4451 GolfRound** (a = round id, kept in wRoundId `$C833` / `$C839`; `$12` in that Stroke round). Per hole:
  wind from AdvanceRandomSeed (direction `wWindDir` = `rand & 3`, strength from MulHLByAFrac(rand, 20)); in link
  play (`$C893` = 3) the two Game Boys swap 5 bytes per hole (`$C836-$C838`, `$C815`, `$C816`) through the
  serial buffers. Then hole setup (farcalls 08:47B4, 08:6432, 12:6F8D, 08:47FD) and the shot loop
  (10:45E7). During aiming the frame wait is reached through 10:486B -> 10:5D19; bank 08 (08:45D3 -> 08:649F)
  also waits frames during the round.
- **10:4415** (bank 10 export 0) runs the bank-02 setup and then GolfRound(`$12`) forever; only the unreachable
  debug boot menu calls it, so it is a developer's direct-to-golf entry.
- The round runs with wMapId still 00: golf is entered from map 00's menus, not through a map warp.
- **Hole data**: see "Holes" below.

**Round structure (10:4451).** Per hole (10:44B4): wind, hole setup, then the shot loop (10:45D9-4632):
PickNextPlayer (10:4674) chooses who plays next among the players not yet holed out (player record field
`+$2A`); a shot is ShotSetup (10:4798) -> swing -> ShotLaunch (10:49B7); the loop ends when both players' holed
flags are set; then wHoleNumber (`$C837`) goes up (wrapping 19 -> 1) and wHolesLeft (`$C839`) down. Players are
`$40`-byte records at `$C880` and `$C8C0` (PlayerField 10:4B14 indexes the current one, wCurPlayer `$C835`);
field `+$20` is the stroke count on the hole (went to 1 after the first shot in the emulator).

**Swing meter** (10:57E0 for the player, 10:5643 for the computer; WRAM6). Confirmed in the emulator
(`tools/emu_watch.py`, button presses from `states/stroke_hole1.state`):

| Variable | Meaning |
|----------|---------|
| `D44E` wSwingCount | +1 per frame once the meter starts |
| `D44F` wSwingCursor | = count up to `$3C` (full), then `$78 - count` back down; the swing times out at count `$8A` (cursor -18) |
| `D450` wSwingPower | cursor at the first press (`$80` = not set; `$3C` = full power -> `D452` = 1, sound `$5E`) |
| `D451` wSwingPerfect | 1 when the second (impact) press comes with the cursor exactly at 0 (sound `$5E`) |
| `D4D8` / `D4D9` | the computer's target power and impact point (SwingMeterCPU stops the cursor at them) |

Test: presses at frames 60 / 100 / 158 / 218 after the state gave power `$3A`, a perfect impact, and a
235-yard drive ("235y" on screen, 137 y left on the 374 y hole).

**Ball** (WRAM6 `D400-D415`; BallTask 10:4D45 is registered as frame task 1 for the shot):

| Address | Field |
|---------|-------|
| `D400-D402` / `D403-D405` | x / y: 8-bit fraction + 16-bit integer; the 235 y drive moved y by `$1D59` and x by `$25`, so about 32 units per yard |
| `D406-D407` | height (8.8); `D4C1` gets a copy each frame |
| `D409` / `D40B` / `D40D` | velocity vx / vy / vz (8.8 signed) |
| `D40F` | curve (sideways force) |
| `D411` | spin / lift |
| `D413` / `D414` | speed and direction of (vx, vy), recomputed each frame (10:4CDE) |
| `D415` | 1 in the air, 0 on the ground |

Flight step (BallFlightStep 10:4EE0, while `D415` = 1): curve force `D40F x speed x $1C` added across the direction
(angle + `$40`); vz += `D411` (spin) x airspeed term x `$1C`, then vz -= `$20` (gravity; the net change seen in the
emulator was `-$19`/`-$1A` per frame); spin decays by about 1/128; wind (10:52EE) and a drag step (10:5268) act
on vx, vy, vz; position and height are integrated (10:52DA). Landing (10:4D09): height 0 and |vz| < `$20` ends
the flight (sound `$40`). Roll step (BallRollStep 10:4D86, `D415` = 0): the curve force (x `$40`), forward
speed decay x `$FC`/256, wind, and a friction factor from the terrain table at 10:67E4 (terrain type 3 plays
sound `$51` and drops the ball: water). BallTerrainCheck (10:527C) reads the terrain under the ball every frame
(TerrainAt 10:6536) and remembers the last safe spot in `D51D` (not for types 3 and 7). On the green
(`D443`) positions are taken relative to `D441`/`D442` and scaled x4.

**Ball simulator** (`tools/ball_sim.py`, with the bank-0 math in `tools/golfmath.py`): a Python port of BallTask
that reproduces the game's ball state (`D400-D415`) **exactly, step for step**. Recordings come from
`tools/emu_ball_record.py`, which snapshots WRAM6 `D400-D4FF` at every BallTask entry. Result on five shots on
hole 1 (wind 7 mph): perfect drive 437 steps, topped shot 216, late-impact shot 387, 3-wood 486, aimed-left
shot 257: **all 1783 steps identical**, through flight, bounces and roll. Details the port pinned down:

- BallSpeedAndDir (10:4CDE): direction = high byte of AngleFromVector16(**vy, vx**) (angle from +x toward +y),
  speed = IsqrtHL(vx²/65536 + vy²/65536) with MulHLByDEBothSigned.
- Air step (10:4EE0): curve push `curve x speed x $1C` along direction + `$40`; lift
  `spin x (speed x 256 + wind x cos(dir - wind dir + $80)) x $1C` added to vz with gravity `-$20`; spin decay
  `spin -= spin / 128` rounded away from zero; vx, vy move toward the wind vector by 1/256 of the difference
  and vz loses 1/256 (each rounded toward zero, 10:5268); position and 24-bit height integrated.
- Wind (10:52EE): only in the air; size WindSpeedTable[`$C815` mph] (10:5315), direction `$C816`.
- Bounce (10:4FF2): terrain factors `D448` / `D449` = TerrainPropTable bytes 0 and 2; height, vz, spin, curve
  x `D448` (height and vz negated); slope push (size -32 along the slope; plus vz x `$DD`/256 along it, vz
  halved); curve x `$40` and spin x `$40` pushes; vx, vy x `D449`. Water and bunkers: see "Putting, the cup,
  water and bunkers" below.
- Landing (10:4D09): integer height 0 and |vz| < `$20` -> rolling.
- Roll (10:4D86): curve push (x `$40`) and spin push along the direction, both decaying x `$FC`/256 each
  frame; slope push; then vx, vy x the terrain's friction byte (TerrainPropTable byte 1).
- **Slopes**: off the green, a 4 x 4-cell nibble map per tile (course asset ref 0 entry 4, WRAM1 `$D800`; bit 3
  = sloped, bits 0-2 = direction through SlopeDirTable 10:6516 with the tile's flips), push `$20`
  (SlopeCellAt 10:674E). On the green, a per-tile byte (hole asset ref 1 entry 2, WRAM6 `$D700`; strength in
  bits 4-5, push 0/2/4/6, scaled by the ball speed in 10:4E98), used while `D443` is 1-3.
- The math routines used are all checked against the ROM on random inputs (`tools/test_math.py`, via
  `tools/emu_callfn.py`, which calls a ROM routine inside PyBoy): multiplies, MulSin/MulSinCos (16- and 8-bit
  angles), AngleFromVector16, IsqrtHL (00:0F04; the Tennis name "AngleFromVector" was wrong) and DivAHLByDE
  (00:0DDB), whose three-phase division drops remainder bits for large divisors — the port reproduces that.

**Shot launch** (ShotLaunch 10:5F94, bank 10 export `$4A`; verified on the 235-yard drive with `emu_watch.py`):

1. ShotClubParams (10:5EEF) for wClub (`D329`; 0 = 1W ... `$0D` = putter): spin start (ClubParamTable 10:61A6),
   elevation from 02:518B, a curve start value from CurveStartTable (10:5F74, `+3 .. -3` x 256).
2. Speed `D416`: ShotSpeed (10:6CDB) for the player, or the computer's targets copied into the meter
   variables. Distance first: ClubBaseDistance (10:68B1) = ClubDistance (02:511A) x `$20`, where ClubDistance
   is the golfer's driver distance (wDriverDistance `D4C6`: `$010E` = 270 for Mario, the "270Y" on the HUD)
   times ClubDistanceTable[club] (02:5171: 1, .932, .864, .796, .75, .704, .659, .614, .568, .523, .477, .409,
   .318; checked in the emulator: Down on the tee switches to "3W 252Y" = 270 x .932); then the lie factor (LieFactor 10:65EF: per club and terrain, table 10:660E), the power
   (ScaleByPower 10:6865: linear, p/60 below full power), and 08:60BC. `$20` per yard matches the ~32 position
   units per yard measured on the drive.
3. Impact: `D44C` (impact height) scales the speed (x `$F9`/256 or + 7/256) and the spin; `D44B` (impact side)
   adds `-32 x D44B` to the curve; 10:6C54 / 10:6C9F add miss-hit offsets to the direction and the curve;
   elevation `D41A` gets 10:6B1F / 10:6C18 added (capped at `$3F00`).
4. MulSinCos (00:11BA) splits the speed by the elevation into horizontal speed and vz, then by the direction
   `D418` into vx, vy; the ball is put in the air (`D415` = 1; the putter rolls: `D415` = 0, sound `$48`).

On the test drive: speed `$298E`, elevation `$0A39` (14.4 deg), direction `$C194` (272 deg, up the screen) gave
vz `$0A4B` and (vx, vy) = (`$018B`, `-$2841`), equal to speed x sin / cos to within rounding.

**Putting, the cup, water and bunkers** (read from the code; every branch below is reproduced by the whole-shot
replay further down):

- **Views** (`D443` wOnGreen): 0 is the course view; 1 the green view (putting view; BallInGreenArea 10:5617:
  the ball within 5 x 4 map units of the green corner `D441`/`D442`); 2 the cup close-up; 4 occurs in normal
  shots. In views 1-3 the ball step reads the **green maps** (hole asset ref 1: terrain, slope bytes at WRAM6
  `$D700`) with positions relative to the green corner and x4; otherwise the course maps. A view change runs
  ShotViewLeave (3B:431F) and LoadShotView (13:432B), which take several frames with AdvanceFrame calls inside.
- **ShotMainLoop** (10:6E99) runs once per frame after the launch (the flight-camera loop 10:49D8 runs first) and
  returns to 10:4A25 with the shot's **outcome** in `a`:
  - outside the hole's bounds (`$C329-$C32C`) -> ShotOutOfBounds (10:6E90): sound `$40`, 30-frame wait, `a` = 7;
  - view 1: NearCup (10:7122; within `$20` of the cup `D43D`/`D43F`) and PinCheck (10:72E7) -> a low ball enters
    the cup close-up (CupViewEnter 13:44A4, `D443` = 2); view 2 goes back (CupViewLeave 13:4528) when the ball
    is high again or no longer near; otherwise BallInGreenArea picks view 0 / 1;
  - view 2: CupFlyIn (10:7263; a falling ball whose next height is below 0 over the cup) or, on the ground
    within 6 of the cup (IsqrtHL of the squared distance), CupRollIn (10:716B, `D4B1`) -> ShotHoled (10:7052): `D444` = 1,
    CupDrop (10:79AF; `a` = 2 when the ball pops back out and the loop goes on), sound `$5A`, HoleOutPlace
    (10:7888, the ball set on the cup), `a` = **`$80`**;
  - PinCheck: a ball at height `$C0-$E7` next to the pin hits it (sound `$59`, `D48E` bit 2, velocity zeroed);
  - CupPull (10:7CAB): near the cup the ball is pulled toward it (ported: `ball_sim.cup_pull`);
  - at rest (`D4D3` reaches `$28`, or B) -> ShotAtRest (10:7029): height and vz cleared, BallLieTerrain
    (10:648B) gives the terrain type, the lie quality PlayerField `$3F` / `D446` comes from a 16-byte table indexed
    by the position's fraction nibbles (fairway and type `$0E`: 10:70DB; rough: 10:7112); `a` = the terrain type
    (0 fairway, 1 rough, 2 bunker, 3 water, 6 green, 9 semirough).
- **Water** (BallBounce 10:5021, type 3): sound `$51` and the splash (WaterSplashAt 12:6A9C at the ball,
  WaterSplashGfx 12:6A7F); a ball with speed >= 5 and a landing angle (AngleFromVector16(speed x 256, -vz))
  of `$28` or more **skips**: `D48E` bit 0 and a normal bounce with the water's factors; otherwise BallStop
  (10:521C: velocity and height 0, the spot in `D4CF-D4D2`, `D4D3` = `$C8`, `D331` = 1) and the shot ends in
  the water. Rolling into water (BallRollStep 10:4E3F) splashes and stops the same way.
- **Bunkers** (types 2 and `$0D`, 10:5068): every landing sets PlayerField `$15` bit 0; a landing angle below
  `$14` **plugs**: lie `D446` / PlayerField `$3F` = 1 (2 below `$0E`), sound `$4B`, BallStop. Otherwise the ball
  bounces with the sand's factors.

**Whole-shot replay** (`tools/sm83.py`, `tools/shot_sim.py`, `tools/shot_suite.py`). `sm83.py` is an SM83
interpreter (MBC5 banking, WRAM/VRAM banks, rLY/rSTAT faked for the LCD-off waits) checked against the math ports
(`tools/test_sm83.py`). `emu_shot_record.py` records a shot in PyBoy: a full RAM snapshot at the first pass of
the main thread's loop (ShotMainLoop 10:6EAA or the flight-camera loop 10:49DD), then every AdvanceFrame entry
(F), BallTask entry (T) and loop pass (L / P) with WRAM6 `D300-D5FF` and `C800-C8FF` (round and player data).
`shot_sim.py` restores the snapshot and runs **the game's own main thread** in the interpreter from that point;
each AdvanceFrame it calls runs that frame's recorded BallTask calls (keeping hROMBank, hWRAMBank and rSVBK as
RunFrameTasks 00:247D does) and returns. At every event both RAM ranges are compared with the game, except bytes
owned by other frame tasks: the camera and display bytes `D42E-D437`, `D465-D467`, bank 11's sprite state
`D45C-D45F`, `D46B-D47F`, and the wind indicator's counters `D326-D327`. Modes: `--rom` runs only ROM code; by
default the Python ports replace BallFlightStep with BallBounce, BallLandCheck, BallRollStep, CupPull and the
cup routines (cup_sim.py); `--task` replaces BallTask as a whole (shot_py.ball_task). **`shot_run.py` runs the
whole shot in Python** (shot_py.Shot: BallTask and the main thread, the machine used only as memory) and compares
the same events. The suite (27 cases from saved states, button scripts and RAM pokes) matches **every event in
all four modes**, with the game's outcome:

| Cases | Outcome |
|-------|---------|
| tee shots, approaches, a sand shot out of a bunker, flight and roll from mid-shot states | `$00` fairway, `$01` rough, `$09` semirough, `$06` green |
| a putt from 3.6 ft that misses; three that **hole out** (the hole finished in 5); a chip falling into the cup view | `$06`, `$80` x 4 |
| a ball rolling into a bunker; a sand shot landing in sand; a flat bunker landing | `$02` |
| two vertical bunker landings (poked: no horizontal speed) -> **plugged** (lie 2) | `$02` |
| a shot over water that **skips twice** and then rolls in; a vertical water landing (poked) | `$03` |
| a ball sent into a tree trunk (bounces back at half speed) and through its canopy (slowed) (poked) | `$01` |
| a ball sent over the hole's left edge (poked) -> **out of bounds** | `$07` |

The cases the old frame-by-frame comparison could not reach were the view switches: the game spends several
frames inside LoadShotView, so the replay must know which AdvanceFrame each ball step belongs to (the F events).

**The cup in detail** (tools/cup_sim.py; each routine checked against the ROM on random states by
tools/test_cup.py, and in the suite). Offsets are 8.8 from the cup (`D43D`/`D43F`):

- CupOffsets (10:73CA): `D499`/`D49B` = ball - cup, `D4A5` = Dist16 (sqrt in steps of 16). Dist16 below `$200`
  on the ground in the cup view (and `D4D5` clear) drops the ball at once (CupRollIn 10:716B); otherwise
  PathNearest (10:74A1, via PathOffset 10:741D) finds where the path passes the cup, and the ball drops when
  3 x speed is below twice that miss distance scaled by the angle (`D4B1`).
- CupDrop (10:79AF) unregisters BallTask and runs its own loop, one AdvanceFrame per pass: the ball moves by
  vx / vy; RimClamp (10:78AD) keeps it within 6 x 256 of the centre (`D4B8` bit 0 at the wall, bit 1 near the
  centre); CupSink (10:7860) adds gravity `-$38` per frame until the height reaches `-$14` (in: `a` = 1). At the
  wall, CupDeflect (10:760E: Reflect 10:771E about the contact point from PinContact 10:750B, and CupWall
  10:7A63 when lower than 4) turns the velocity; if the height comes back above 0 the ball pops out (`a` = 2:
  back in the air, BallTask on again, the main loop goes on; seen in three of the suite's putts).
- PinCheck (10:72E7): with the height below `$E8` and PinDist (10:62AD, a 24-bit distance through Isqrt24
  00:1D6A) at most 2, a ball at `$C0-$E7` hits the flagstick and drops (velocity 0, sound `$59`); lower it
  bounces off (PinBounce 10:765F: half the reflected velocity, sound `$58`). Once per shot (`D4B9`).

**Trees** (TreeCheck 08:51D2, part of BallTask, not in the green views 1 / 2). A tile is a tree when bit 7 of its
`$D700` byte is set. The height (`D407-D408` x 8 / 256, below `$18`) picks a half width from `D4F3` (hole 1:
`$11` for levels 0-3, then `$40`-`$50`); the ball's spot in the tile (4 + 4 bits) gives the distance and angle
to the trunk (tables 08:5426 and 08:5326); the tree is hit when the sideways distance of the trunk from the
ball's direction is below the width. Bit 0 of the width means solid: the direction is mirrored about the trunk
and the speed halved; otherwise (leaves) vx, vy x `$E6`/256 and vz x `$F0`/256. `D48E` bit 4 is set and the tile
is remembered (`D516`/`D519`) so it hits once.

**ShotLaunch in detail** (tools/launch_py.py; tools/test_launch.py checks recorded launches and 300 random swings
against the ROM). In order: the position is saved to `D51D`; ShotClubParams (10:5EEF) loads spin and base speed
(ClubParamTable 10:61A6), the elevation (ClubElevation 02:518B: per club + per trajectory class `D4C8`), the
direction offset of the shot shape (ShotShape 10:6B03: the golfer's `D4CA`, nudged for the driver by equipment
bits `D4CC`, mirrored by `D333` bit 0; ShapeDirection 08:607C) and the curve start (CurveStartTable). Then the
speed: the computer copies its targets into the meter; the player's is ShotSpeed (10:6CDB):
ClubBaseDistance (driver distance `D4C6` x ClubDistanceTable, x `$20`, +10% in shot mode 1) x the lie factor
(LieFactor 10:65EF by LieClass 10:6672: terrain `D4CD` and lie quality `D446`; a factor sum of `$A0` or more
with a perfect full swing sets the cue bit `D48E` bit 3) x the miss factor (MissSpeed 10:6BC7 by MissIndex
10:6B1F: the impact cursor through a per-golfer table `D321`) x the power curve, then / 32 and ShapeSpeed
(08:60BC); that distance indexes one of nine **distance -> launch speed tables** in banks 38-3A chosen by the
trajectory class (10:6D6A; odd indices average two entries; shot mode 2 uses a byte table). The putter instead
reads a speed straight from 10:6DCD by range `D32B` and power. The club's base speed is scaled by that
(ScaleSpeed 10:6134), and by the impact height `D44C` (x `$F9`/256 above, + 7/256 below). Except for the putter,
the miss index adds an elevation change (MissElevation 10:6C18, capped at `$3F00`), a direction change
(MissDirection 10:6C54, x 1.5 from lie terrain `$0C`) and a curve change (MissCurve 10:6C9F), each through the
golfer's control `D4CB` (Control 10:6BEF); the spin is scaled by the impact height and the power, and the impact
side `D44B` adds `-32 x side` to the curve. Last, MulSinCos splits the speed by the elevation and the direction
into vx, vy, vz. After it (10:49A3): the stop spot is cleared, the lie reset, in shot mode 1 an imperfect swing
uses up a power shot (PowerShotUse 10:433B), `D438` = `$11`, and BallTask starts (ShotFly 10:49B7; on the green
views the flight camera is skipped).

**The swing** (tools/swing_py.py and shot_py.Shot.address / swing / after_swing; the whole golf shot from the
moment the golfer addresses the ball). ShotSetup (10:4798) is the whole shot: lie and club set-up, the aiming
menu (AimMenu 10:5BA6), then AddressBall (10:56B0): Up / Down change club (view 4), Left / Right nudge the aim
`D418` by `$80` per frame (at most 8 steps either way), A starts the swing, B returns to the menu. The meter
(SwingMeterLoop 10:57E0, main thread) counts `D44E` up each frame; the cursor `D44F` follows it to `$3C` and
back; presses are read every second frame (odd frames latched in `D453`). The first A sets the power (the
putter swings at once, with its range `D32B` as the shot mode), the second the impact (perfect at cursor 0);
without power the swing is cancelled at count `$78` (or B): 20 frames and back to the address; without impact
it ends at count `$8A`. Meanwhile frame task 10:55AC turns the d-pad held into the impact side and height
(`D44B` / `D44C`, table 10:55CE): those are the hook / slice and top / low controls. After the swing
(10:4921): the shot record (ShotRecord 02:46B0), in view 4 the wait until the swing animation reaches the
club's contact mark (`D464`, script 11:6ECD by golfer and club), otherwise a fixed `$30` / `$24` / `$32`
frames; the retry copy (`D359-D36A`), one stroke more (CountStroke 10:477C), and ShotLaunch.

Two frame tasks matter for the RAM before the launch: the golfer's animation (11:6E3E; LoadShotView stops it)
and, while aiming and addressing (`D485` bit 4), the **landing preview** (11:4E5E): every 32 frames a ghost
ball is launched from a perfect full swing with the current aim (PreviewRestart 10:543C, which reuses
ShotClubParams and ShotSpeed and so rewrites `D40F-D41D`), then flown each frame with BallFlightStep's
rules (PreviewStep 10:5355: it borrows the real ball's speed, direction, curve and spin, and the real ball's
height for the wind, so on the tee it flies without wind) until a tree stops it (08:5109). None of what it
writes survives into the launch: ShotLaunch rebuilds those values.

The joypad (ReadJoypad 00:02EB, in VBlank; tools/joypad.py): held, newly pressed, and auto-repeat (on the
first frame of a change, then every `$FFA6` frames after 18). `emu_shot_record.py --from-address` records from
AddressBall with the joypad of every frame; `shot_run.py` replays it in Python either from those bytes or from
the button script through joypad.py, and both match every event of every suite case. `shot_run.py REC --free
--press 100:a 160:a 220:a 150:left:80` plays any swing from the address: e.g. from hole 1's tee a well-timed
drive goes about 250 yards, an early or late impact hooks or slices, holding right through the swing pushes
it into a bunker, a club down per press shortens it.

**A hole** (tools/hole_py.py; hole_run.py checks recorded holes, play_hole.py plays one in Python). After the
shot (PostShot 10:4A82): a putt is counted when the shot started on the green; OutcomeRules (3B:7260) applies
the result: the hole's bonus `D4F1` (+10 for a water skip; +4 reaching the green off the pin, +2 reaching it with three
or more strokes to spare against par, or two and within `$21` of the pin), points `C83C` when holed (the bonus, +10 off the pin, +6 / +8
holed from off the green, +4 for a putt from `$280`, +6 birdie, +10 eagle, +16 albatross, +20 hole in one,
each x the course factor / 2, in modes 1-3, 5, `$0A`, `$0B`), **water**: a penalty stroke and the ball back to
the last safe spot `D51D`, **out of bounds**: a penalty stroke and the old spot kept (stroke and distance);
the new spot goes to the player's record (PlayerField `$22`). The loop (10:45E7): a stroke limit of 3 x par
in some modes, the scorecard when holed (Scorecard 10:4101), the next player (PickNextPlayer 10:4674: the
farther from the pin; it loads the ball and the golfer's stats). ShotSetup (10:4798): lie and lie quality,
the club the game picks (PickClub 10:6341: the most lofted club that reaches the pin, from those the lie
allows), the aim (AimMenu 10:5BA6 -> SmartAim 10:6406: at the cup, or a direction whose landing is fairway or
green), the putter's range by distance (`D32B`: 0, 1 from `$140`, 2 from `$42B`), the view behind the golfer
and its camera (11:476E: at the ball, angle `$C000` - aim). The flight camera also ends when the ball leaves
its picture (BallView4 11:4795 sets `D331`), which decides how many frames a long shot spends in it.

Four recorded holes (tools/hole_suite.py: bot play chosen by the Python engine; hole 1 in par, hole 2 in six,
hole 2 with two balls in the water, hole 1 with one out of bounds) match the game in every shot frame by frame,
at every address step, and in the round and player records at the end. Only the display state that depends on
how long the menus took (the golfer's idle animation, the landing preview, the target marker) is taken from the
recording at an address step; all of it is rebuilt before it is read. `play_hole.py` plays a whole hole in Python
in about two seconds, and on hole 1 its shots are the ones the game played.

**From swing to outcome in Python.** With `emu_shot_record.py --from-launch` the recording starts at ShotLaunch's
entry (event S); `shot_run.py` then runs the launch, the flight, the main loop and the cup in Python. All the
suite's swing cases are recorded that way, and every event of every case matches. `shot_run.py REC --free
W6:D450=20 ...` plays a recorded swing out with a changed power, club or impact, without the game.

**The rest of BallTask** (10:4D45, all in shot_py.ball_task): after the step, BallTerrainCheck (10:527C) saves
the position to `D51D` unless on water or out of bounds; TreeCheck; B sets `D360`; RestWatch (10:7077) counts
frames at the same integer spot in `D4D3` (the main loop ends the shot at `$28`); the height goes to `CAAB` and
`D4C1`.

**The main thread's frames** (what decides how many ball steps a shot gets): the flight-camera loop (10:49D8)
runs until the first touch-down (`D331`), the green area, or `$5A` frames; then LoadShotView (one AdvanceFrame,
13:4462), WaitFramesCmd 1, the cue 3B:4339 (`D48E` bit 3 without bit 4), WaitFramesCmd 1, and ShotMainLoop.
In the loop a change between views 0 and 1 costs ShotViewLeave (one AdvanceFrame, 3B:432F) and LoadShotView
(one); the cup close-up (1 <-> 2) costs none; out of bounds waits 30 frames; HoleOutPlace 30. A fade
(WaitFade 00:2625) only runs when the screen was faded out, which does not happen mid-shot.

#### Holes (bank 13 loaders; tools/render_hole.py, tools/emu_hole_check.py, tools/hole_stats.py)

- **HoleAssetTable (13:4A16)**: one 16-byte row (8 refs `(idx, bank)`) per hole id; the current id is wHoleId
  (WRAM6 `$D320`; `$0A` in the Stroke round's hole 1). Each ref names a list in a bank's `$4000` table, and
  FarDispatchIndexed (00:069A) LZ-decompresses entry n of that list. HoleAsset (13:49EE) maps (ref, entry) for
  the current hole.
- **Ids `$0A-$63` are the 5 courses x 18 holes**: the course tile set (ref 0) changes every 18 rows: `$0A-$1B`
  50:00, `$1C-$2D` 50:02, `$2E-$3F` 51:00, `$40-$51` 51:02, `$52-$63` 52:00 — the five clubs Marion, Palm, Dune,
  Links and Peach's Castle (renders: `$2E` is a desert hole, `$52` is shaped like Peach). Ids `$00-$09` and
  `$64` up reuse a few assets (practice and special rows, not traced).
- **Overhead view** (HoleLoadMaps 13:4014, HoleLoadTiles 13:40CA, when `hFFB0` = 0):

  | Asset | Destination |
  |-------|-------------|
  | ref 0 (course) entry 0: palettes | `$40` bytes copied; the first `$28` are BG palettes 2-6 (checked against wBGPalMaster `$C200`) |
  | ref 0 entry 1: tiles (LZ) | WRAM1 -> VRAM bank 1, `$9000` then `$8800` (signed addressing, LCDC `$E7`) |
  | ref 0 entry 3: terrain table (LZ, 2048 bytes) | WRAM6 `$D800`: 8 bytes per tile = 4 x 4 cells of 4-bit terrain types |
  | ref 0 entry 4 (LZ, 2048 bytes) | WRAM1 `$D800`: slope nibbles, 4 x 4 cells per tile (read by SlopeCellAt 10:674E) |
  | ref 1 (hole) entry 0: attributes (LZ, 4096) | WRAM2 `$D000` |
  | ref 1 entry 1: tilemap (LZ, 4096) | WRAM3 `$D000`, 64 x 64 |
  | ref 1 entry 2 (LZ, 256) | WRAM6 `$D700`: green slope byte per tile (GreenSlopeAt 10:64D1) |
  | ref 1 entry 3 | WRAM4 `$DC00` via 00:0749 (not identified) |
  | refs 2-4 | the behind-the-golfer view (`hFFB0` = 1 paths; banks 55, 56, 12, 13) |

  `emu_hole_check.py` on hole 1: tilemap, attributes and terrain table equal the decoded assets byte for byte;
  VRAM1 `$8800` equals the second half of the tiles, `$9000` all but tiles `$00-$10` (overwritten by the HUD).
- **Terrain** (TerrainAt 10:6536): ball x/y integer parts -> tile (64 x 64, one tile = 256 position units, about
  8 yards) and cell (64 units); the tile's attribute flips are applied to the cell. Types seen on hole 1:
  `0` fairway (also the tee box), `1` rough, `2` bunker, `6` green, `7` out of bounds (the tree area),
  `9` semi-rough (the ring round fairway and green; the game showed "SemiRough" where the test drive stopped);
  `3` is water (BallRollStep plays sound `$51`; friction byte `+$01`). TerrainPropTable (10:6825) holds 4 bytes
  per type; byte 1 is the roll friction (fairway `$F8`, rough `$E0`, bunker `$F0`, green `$FC`, OB `$80`).

#### Save (bank 02; tools/dump_save.py)

| SRAM | Content |
|------|---------|
| `$A020-$A02F` | "CAMELOT GAMEBOY" + `$00` (02:4162) |
| `$A030` | 16-bit sum of `$A032-$A1BF` (SaveChecksum 02:419D) |
| `$A040 + 32 n` | block directory, 12 entries: `[used, SRAM bank, offset from $A000 (word), length (word), sum (word), ...]` |
| `$A200-$BFFF` | the blocks (fresh save: blocks 0-2 `$200` bytes at `$A200/$A400/$A600`; 3 `$400` at `$A800`; 4-7 `$280` at `$AC00/$AE80/$B100/$B380`, marked used; 8-11 `$200` at `$B800-$BE00`) |
| `$B620-$B7BF` | backup of `$A020-$A1BF` (in the gap between block 7, which ends at `$B600`, and block 8 at `$B800`) |

SaveLoad (02:41F6, bank 02 export 1, called by GameMain) checks signature and checksum; if they fail it
restores the backup and checks again; if that fails too it erases SRAM (02:4172), writes the defaults (02:4078)
and commits (02:41C1: checksum + backup). SaveBlockLoad (02:4355) copies a block to WRAM and checks its sum
(`$FE` = empty, `$FF` = bad). `dump_save.py` on the emulator's fresh save: signature and checksum valid, backup
equal, the directory as above. What each block holds (characters, records, tournament progress) is not
traced; three `$200` blocks would fit the three create-a-character slots on the character select.

#### Banks by role (labelling pass; names in labels.csv)

##### Bank 0B: map graphics, map buffers, result screens, records queries, ending credits

A mixed library, not just map graphics.

- **Map graphics** (exports $00-$1E): MapStartGfx / MapLoadGfxScreen / MapLoadGfx (already known), plus
  MapDrawFullScreen 0B:4306 (22 x 20 tiles from the 64x64 WRAM2 attribute / WRAM3 tile maps into $9800, both
  VRAM banks; a = 0 centres the camera first with MapCenterCamera 0B:49D3). The camera is wMapScrollX/Y
  ($C320/$C322, high byte = tile), clamped to the 4 header bytes $C329-$C32C (min x, min y, width, height).
  MapGfxStartTileAnim 0B:4900 / MapGfxStopTileAnim 0B:497D call export 0 / 2 of the gfx banks 28-2F, 72-74
  through MapGfxAnimTable 0B:42C0 (tile animations, frame task in that bank, state $C32F-$C33C).
  DebugMapGfxViewer 0B:4579 (from the debug menu 05:6B7B) shows any gfx id picked with 05:5197.
- **The two WRAM6 grids** (MapGfxTable refs w4 / w5, 32x32 cells of 2x2 tiles, address
  `$D000/$D400 + (y/2)*32 + x/2` with x, y in tiles): `$D000` is terrain (bank 04 walking speed drops on value
  $0B, 04:541A), `$D400` is the event grid read by the map engine: low nibble 1 = trigger, 8 = object, $C = talk
  across a counter; high nibble = id (0A:4C9B, 0A:4D1F). Get/set/rect-copy helpers 0B:45AB-46DE (rect copies
  are used by map scripts 33-35).
- **Map buffer edits**: MapBufCopyRect 0B:6DC7 / MapBufCopyRectRedraw 0B:4864 copy a tile rectangle
  (src (b c), dst (d e), size (h l)) inside the 64x64 maps; the second redraws the screen (05:4492, 05:42AD) and
  is far-called by the map scripts (30-32) to change rooms (doors etc.).
- **Round result screen** RoundResultScreen 0B:59DE (export $18; callers bank 08 and script 32) loads map gfx
  $0A (gfx/map_0a.png is the result-screen sheet: WIN/LOSE plates, digits, trophies, "Congratulations"),
  then DrawRankResult 0B:61CF (a = 1: rank digits, course name by $C836, score $C8BE) or DrawVsResult 0B:5F54
  (1P/2P plates, portraits, hole counts from wMatchHoles $C96E via MatchHolesUp 0B:65AE). All drawing is
  MapBufCopyRect from the sheet, numbers by DrawResultNumber 0B:65FE / DrawResultSign 0B:6646. Waits A/B/Start.
- **Records queries** (exports $28-$42, callers mostly bank 0C): LoadRecordsBlock 0B:4FB7 loads save block 3
  into WRAM6 $DC00 ($32-byte records; RecordsSelect sets $D224); bit-field queries return in b/c or $D226
  (RecordsHoleBit 0B:5303 reads an 18-bit per-hole field at record +$2F). Game meaning of the fields not traced.
- **Menu glue**: ModeSelectMenuLoop 0B:4D9D (from map script 32:54EC) drives MainMenu 07:4006 and two
  submenus (07:51A6, 07:63EC) into bank 0C screens, the character select 06:6071 and EventListScreen 0A:6F56.
  A failed load or empty roster shows a picture message (ShowSaveMessageAndWait 0B:4F66).
- **Ending credits**: CreditsRun 0B:5395 (part a = $C2AC, from 0A:573B) prints the staff text ($1900+ in bank 1E)
  into the window and scrolls it (0B:56EF-5883); CopyrightScreen 0B:58B0 shows Camelot / Monegi / Nintendo.
- Data tables: 0B:42C0 anim table; 0B:572C credit pages; 0B:5209 / 51F7 / 521B records index tables.
- Odd: xref.py lists far calls to 0B:4637 (MapSetEventAt) from 7D:78D0/79E8/7A75, inside the sound bank;
  probably data bytes that look like `rst $18`, not real calls.

##### Bank 0A: the map engine (extends REVERSE.md "Top level")

- **Actors**: WRAM4 `$D000 + slot*$40`, up to $18 slots (ActorSlotAddr 0A:42E0). Known fields: +0/+1/+2 handler
  address and bank (ActorSetHandler 0A:431E; default 0A:435D), +4/+6 x/y words (ActorSetPos 0A:43C6), +$10
  facing (bits 6-7 direction; ActorSetFacing 0A:4644), +$12 bit 0 busy, +$29 angle. wPlayerActor $C290 and
  wScriptActor $C292 hold slot pointers. ActorPointAhead 0A:4C6A gives a point at a distance ahead of an actor.
- **Map header fields resolved**: +4 object spawn list (MapInitObjects 0A:4F45 -> 04:5084), +6 talk list
  (MapTalkTo 0A:4F96), +8 object list (MapUseObject 0A:5066), **+10 trigger list** (MapStepTrigger 0A:50CB
  for wMapEvent+0, MapCheckTrigger 0A:5109 for the A button), **+12 enter script** (MapRunEnterScript 0A:4F71).
  All lists are 8-byte records `[id, facing mask, flag word (bit 15 = inverted), script, ...]`, searched by
  MapListFind / MapListFindIfFlag (0A:4EA0 / 4EC5) and copied to wMapRecord $C400.
- **Scripts**: MapRunScript 0A:4EFF: a "script" below $2000 is a text id shown with 05:5D49; otherwise code in
  the header bank called between ScriptBegin / ScriptEnd (0A:4092 / 40D6). ScriptWaitFrames 0A:410D is the
  wait used ~785 times by script banks 30-35.
- MapShowNameBanner 0A:4DDB shows text $12C + map index for 80 frames at map start (bank 18 names such as
  "Marion Clubhouse", "Norio Sample", "Mini-Character Test": a development banner?).
- Return point: MapSaveReturnPoint / MapWarpToReturnPoint (0A:4D5B / 4D8A, wReturnMap $C960).
- **NavigationMenu 0A:7174** (map 2's A button and 41:7413): the "Navigation" list (text $1A05-$1A13: clubs,
  Peach's Castle, Golf Clinic, Club Maker's Hut, Windy Valley, ... Quit) of places whose flag is set (table
  0A:6FA9); writes wNavDestination $C2A7, read by 0A:78CE-7A20. RAM $C473-$C480.
- **EventListScreen 0A:6F56** (export $58): pages Marion / Palm / Dune / Links / Field ($19E1+page) listing the
  lessons and contests (Shot Lesson, Approach Contest, ...) that are unlocked (flags 0A:680A), with a mark for
  cleared ones (flags 0A:6852). RAM $C470-$C472.
- Bug (latent): ScriptWaitFrames 0A:410D jumps to its `ret` with af and bc still pushed when a = 0 and flag #22
  is clear; any caller passing 0 frames would return to a garbage address.

##### Bank 06: name entry and character select

- NameEntryScreen 06:51DC (export 2): letter grid 17 x 6 (layout 06:505B, two pages $C4B3), cursor $C3F6/$C3F7,
  name up to 7 letters in wPlayerName $C800; Select jumps to END; on END $C80B-$C80F get random bytes; empty name
  takes a default from 05:40C2.
- CharacterSelectScreen 06:6071 (export $0C; 06:6D3E is a variant without the big portrait): the roster built by
  02:5B5B at $D658 (10 records of 32 bytes: +0 character, +2 name, +$0D, +$0E word, +$10, +$11) shown as a 5x2
  grid; an empty slot ($0B) reads "Create a new character here." (text $10F6). Cursor $D214, remembered in $CABE.
  Portraits are LZ per character (tables 06:637E, 06:6E35).
- 06:4EA8 (export 0) is a bare `ret`. 06:6914 prints the remembered cursor with PrintHexByte (debug leftover).

##### Bank 07: graphical menu engine

- MenuScreenInit 07:741E + MenuSelect 07:7C00: menus whose items are pre-drawn LZ pictures (descriptor at hl:
  item gfx words, +$28 = extra tiles), highlighted by blinking; Up/Down wrap, A = item, B = $FF. With the link
  flag ($D205) item 1 performs a serial handshake (send $10, wait $20) and returns $11.
- Three menus: MainMenu 07:4006 (3 items when the records block loads, else 2), MenuFiveItems 07:51A6,
  MenuFourItems 07:63EC; cursors remembered at $CABB-$CABD. The item pictures were not rendered, so item
  meanings are unknown.

##### Bank 09: second copy of the menu engine

- 09:400A-498F is the same code as 07:741E-7DAF (only addresses differ) (MenuScreenInit / MenuSelect / item drawing) with its own
  graphics; MenuScreenInitAlt 09:7AD5 is a variant. Menus: LinkMenu 09:4A12 (export 0, link handshake on),
  09:5AC5 (2 items), 09:6A74 (3 items) and 09:6A9B (redraw of that menu; called from 00:125B and script 32);
  cursors $CAB8-$CABA. All are far-called from map script bank 32.

Read from the code. Texts are from `tools/dump_text.py`. The labels are in `labels_a2.csv` (162 lines: 131 routines, 17 data tables and 14 RAM labels).

##### Character record at $C800 (what these banks read)

| Offset | Use (evidence) |
|---|---|
| +$00 | name (wPlayerName; 41:6D25, 41:5765) |
| +$10 | character 0-3 (wCharId; 42:400B indexes 42:41F2 with it) |
| +$12 | level, max $63 (wCharLevel; 02:546B level-up test, 02:4FFA, 41:550C) |
| +$1A (word), +$1C-$1F | values shown on the level-up and stats screens (41:49ED -> $D63E, $D640-$D646) |
| +$20 +$21 +$22 +$24 | points given to the 4 skills (02:4FFA: d = 0-3 increments one of them and the level) |
| +$26 (3 bytes) | EXP, 24 bit (41:57A9 prints it in decimal) |
| +$2D bit 7 | set while a bank 41 screen or menu is open |
| +$34 / +$36 / +$37 | mode (9 = on the overworld, map name instead) / course / hole for the card (41:7C7D, 48:4696, 48:480D) |
| $C819 bits 1-2 | badge value shown on the stats screen (02:5395, 41:65D1) |

##### Bank 41: level-up and stats screens, pause/start menus, credits

Export table at `$4000` (21 words):

| idx | Routine | Callers |
|---|---|---|
| $00 | 41:402A LevelUpScreen | map scripts 30-35, 48:4DA2 (after EXP), 57 |
| $02 | 41:6FF4 RunMenu | internal |
| $04 | 41:707C ClearMenuState | 05:40B9 |
| $06-$1A | menus (table below) | 08, 0A, 2D, 70 |
| $1C / $1E | 41:7DB3 / 41:7DF4 open/close the character summary | no caller found / 32:7D77 |
| $20 | 41:77EA DebugPointsEditor | 08:46FF |
| $22 | 41:6506 CharDataScreen | 0B:4F18, 41:7945 |
| $24 | 41:6784 CharYesNoPrompt | 31:4673, 32:7A75, 32:7B70 |
| $26 | 41:7E07 StaffCredits | 01:4115, 31:7835 |
| $28 | 41:7BB4 PutMenuTile | 05:4F82-4FC2 (8 calls) |

- **Level-up screen** (41:402A): returns at once (`ret nz`) unless 02:546B says the EXP at +$26 reaches the next level. 41:48F4 finds how many levels are due: it calls 02:546B and 02:4FFA in a loop, counts them in `$D435`, then restores the record. The player gives that many points to the four skills (texts $10DF-$10EA: "Improve which skill?", Drive, Height, Shot, "Meet Area and" Control, "Is this OK?", Yes/No).
  - The phase is in `$D632`: 0 = message, 1 = choosing a skill (Left/Right move `$D630`; A adds a point with 02:4FFA and records it in the history `$D4D2`, count `$D4D1`), 2 = Yes/No (`$D40A`), 3 = done.
  - B undoes the last point (41:550C).
  - Eight frame tasks run while the screen is up: cursor blink 41:42FA / 41:4328, gauges, palette cycling 41:50D2 (table 41:6486), and the character sprite 42:4074 through 41:5088.
  - Each skill is shown as a gauge from -4 to +4 (41:4F71). The preview delta comes from 02:503C.
- **Stats screen** (41:6506, the "Char. Data" menu item) reuses the same drawing with phase 0. **CharYesNoPrompt** (41:6784) asks "Is this OK?", "Copy <name>?" or "Erase <name>?" over it. It saves and restores the whole screen (palettes, WRAM2/3 buffers, VRAM1 $9000, VRAM $8400) with 41:6D4E / 41:6DC7, and returns a = 1 for Yes.
- **Menus**: every menu export sets bit 7 of +$2D, calls a set-up routine (text id of the options, handler word table, window size) and then RunMenu (41:6FF4). RunMenu opens the window with 05:4BB0 (wMenuWindow `$C3F8`), reads the choice with 05:4CD7 and jumps through the handler table. Handlers leave their result in wMenuResult `$C3FD`.

| Export | Text | Options |
|---|---|---|
| $06 41:6E49 | $147F | Camera Mode, Course Map, Scorecard, Settings, Give Up, Quit |
| $08 41:6E6E | $1480 / $1481 | Char. Data, Stars, Message, Save & Quit (Navigation first on map 2): the map start menu, wMapEvent +4 |
| $0A 41:6E96 | $1482 / $1483 | golf pause menu with Save & Quit |
| $0C 41:6EBB | $1482 | same text, handlers 41:756F |
| $0E 41:6EE0 | $1484 | Camera Mode, Course Map, Hole Out, Wind Direction, Wind Speed, Settings, Back to Menu |
| $10 / $12 | $1485 / $1486 | Quit Practice (+ Wind Direction / Wind Speed), Settings |
| $14 / $16 | $1488 / $1489 | Continue, Mulligan, Hole Out / Start Over, Back to Main Menu |
| $18 41:6F9F | $148A | Quit Mini-Game, Settings |
| $1A 41:6FC4 | $1480 | the map menu from bank 70 |

- **Credits** (41:7E07): plays song 3 and scrolls `hSCY` one pixel per two frames. Each 16 pixels it prints the next string from text $181C onward ("MARIO GOLF STAFF" ...) and stops at a string that starts with '#'. A, B or Start then leaves through 01:41B3.
- **Debug leftover**: 41:77EA is a points editor, reached from 08:46F3 after a golf pause menu when `hDebugMode` is set and Select is held. It shows wPoints `$C83C`; A adds 100, Right adds 10 and Left subtracts 10 (02:544E); B gives the points as EXP (48:4D70).
- **RAM**: the screen variables are WRAM6 scratch (`$D400-$D4D2`, `$D5A4`, `$D630-$D657`). They overlap the golf ball variables (wBallX ... wCameraX), so the names that labels.csv gives to those addresses do not apply inside this bank.
- **Corrections to the hints**:
  - 41:4780 writes `$D345` with WRAM bank **2** selected (41:450B), so it is a byte of the level-up attribute-map buffer and not the 3B caption state.
  - 41:4A99, 41:4B80 and 41:557D write `$D455` with WRAM6 selected, but here it holds a copy of skill points (+$22) that the screen shows, not the HUD flag of 12:4B19.
  - These are address overlaps, not real accesses to those variables.

##### Bank 48: EXP award screen and character card

Exports: $00 48:4053 ExpScreen, $02/$04 48:4A81/4AC3 (graphic prompts, 32:7D3C/7D4D), $06 48:4A27 (Yes/No input, no caller found), $08 48:4D70 AwardExpPoints, $0A 48:5E42 ShowPictureScreen, $0C `$6C00` (no caller; neither code nor LZ, left unlabelled).

- **ExpScreen**(a, de, h): a = 0 shows only the character card (name and level 48:4639; mode, course, hole and score 48:4696, or the map name 48:480D when +$34 = 9).
  - Otherwise de EXP are counted into the character (48:4C02; award `$D630`, counted `$D632`, points to the next level `$D63C`/`$D642`, done `$D638`).
  - h picks the message (48:4C7D): 0 "Calculating EXP Pts.", 1 "Bring EXP Pts from N64 Mario Golf." (the N64 transfer text), 2 "Pts to next level:", 3 "Level up!" (sound $63), 4 "Your level increased.", 5 "It's the highest level!".
  - The count runs one step per 4 frames. After A or B (latched in `$D639`) it runs every frame, with extra steps while 1000+ or 10000+ EXP remain.
  - A bonus line (48:4DFF) is drawn from `$CAAD`: 1-3 Gold / Silver / Bronze Trophy, or "for beating" an opponent ($14-$19 -> text $47-$4C Putts, Grace, Tiny, Gene Yuss, Mario, Luigi; others Wario). `$CAAE` is the amount added.
  - It commits with 02:5465.
- **AwardExpPoints** (48:4D70) is called by 08:4F29 after a round with wPoints, by map script 32:5146 and by the debug editor. It runs ExpScreen and, when a level is reached (`$D63B`), LevelUpScreen 41:402A and then ExpScreen with message 4.
- **ShowPictureScreen** (48:5E42) runs from 08:4F75 when wHolesLeft = $0A. It shows an LZ full-screen picture for up to $0E10 frames (one minute) or until a key is pressed. What the picture is has not been looked at.
- Drawing goes into the WRAM1 buffers (`$D000` attributes, `$D400` tiles, 32 wide; 48:48CF). Tile strings handle dakuten codes $9E/$9F/$DE/$DF (48:4867), a leftover of the Japanese text.
- **Leftovers**: 48:47D7 is the same code as 48:4791. 48:4A27 and export $0C have no callers.

##### Bank 42: menu character sprite (animated golfer with shadow)

Exports: $00 42:400A and $02 42:4008 are `ret` stubs (called from 62/66 and 01:4118). $04 42:400B InitCharSprite and $06 42:4074 CharSpriteTask are used by 41, 48 and 66.

- 42:41F2 holds four records, one per character (`$C810` = 0-3). Each gives an OBJ palette (loaded as OBJ palette 6) and pointers to frame tiles, metasprites and animations; the pointers are copied to `$D540-$D547`.
- The animation state is `$D548` animation, `$D549` frame, `$D54A` frame timer, `$D54B` next animation (bit 7 = none), `$D54C/$D54D` position, `$D54E/$D54F` offset (the jump height), `$D550` delay and `$D551` tile upload pending.
- Each frame of an animation is 4 bytes: tile set, metasprite, dx and dy. Tiles are LZ-decompressed to VRAM1 `$8000`. Frame $FF ends the animation.
- The shadow sprite size depends on the height (42:41B1, table 42:4254; tiles 42:4200-4238).
- These WRAM6 addresses are also used heavily by bank 3C (`$D548`/`$D551`), so they are not labelled as RAM.

##### Bank 44: debug palette editor and hole records

Exports: $00 44:7E74 CopyHoleRecord (17:4298, 66:4982) and $02 44:42FB DebugPaletteEditor (05:6B83 in the debug menu 05:6B2E, and 08:4708 after a pause menu when `hDebugMode` is set and Up is held).

- **DebugPaletteEditor** loads hex digit tiles 44:4020 to `$8600` and draws a 16 x 4 grid of the colours in `$C100` (wPalLive: BG palettes 0-7, then OBJ).
  - The cursor is `$C3F6` (colour) and `$C3F7` (palette). A opens an R G B window (44:4156): Left/Right pick a component, Up/Down change it with AdjustColorRed/Green/Blue, and the palettes are uploaded at once (`$FF9D` = 3). B leaves.
  - This is development code that the retail game can still reach through the debug mode.
- **CopyHoleRecord** copies $C0 bytes for course `$C836` and hole `$C837` (table 44:4311: a pointer per course to a list of record pointers) to de; bank 17 passes `$C640`.
  - The records are about $88 bytes apart, so the copy reads past the end of each one.
  - A record holds a grid of 4-bit values (10-byte rows; nibbles 0/1/3/F), then a list of tile numbers ending with $FF. It is probably a picture of the hole or green for the bank-17 view. Not confirmed.
- The rest of the bank (44:43E8-7E73) is data, not traced.

All addresses come from `tools/disasm.py` and `tools/xref.py`. Names are in `labels_a6.csv` (275 lines: 228 routines/tables, 47 RAM).

##### Bank 02: save data, the player's character, golfer setup, link shots, points/EXP, debug screens

- **Save blocks** (next to SaveLoad 02:41F6): SaveBlockStore 02:429B (export 4: block b <- WRAM hl + 24-byte header de; sum + used flag; SaveCommit), SaveBlockClear 02:431D, SaveBlockVerify 02:43CC (0 / `$FE` empty / `$FD` differs / `$FF` bad sum), SaveBlockHeader 02:4454. SaveCheckAllBlocks 02:45D3 (export `$6A`, one of GameMain's three setup calls) checks blocks 0-2 (on a bad sum it restores from backup block b+8, 02:457F), block 3 (02:45AA) and blocks 4-7 (a bad block becomes `$280` zero bytes, 02:45B7).
- **SaveGame 02:4489** (export `$34`, about 50 calls from the story banks 30-35, plus 08 and 41): only when slot `$C2A5` < 3. It calls SaveGameTimer and BuildClubTable, then stores the character record `$C800` in block slot and again in slot+8 (header template 02:63A0), verifying each copy.
- **SRAM flag bits** at `$A038`: TestSaveFlag 02:44F2, SetSaveFlag 02:4522 (bank 08 calls it 7 times), ClearSaveFlag 02:4550 (unreferenced).
- **Character record `$C800`** (name first): type `$C810`, level `$C812` (max 99), flags `$C819`, driver distance `$C81A`, 24-bit EXP `$C826`, stat points at +`$20`/`$21`/`$22`/`$24`. Routines: NewGame 02:4E3D (export `$14`: clears `$C800-$C9FF`, CreateCharacter, map 0 entrance 2); CreateCharacter 02:4E82; CharLevelUp 02:4FFA/4FFD (raises one stat and the level); CharComputeStats 02:4F07 (per-type tables at 02:4D3D); CharLevelUpDiff 02:503C (the stat changes for the level-up screen); AddExp 02:5465, CheckLevelUp 02:546B and ExpToNextLevel 02:5498 (thresholds at 02:54CD by type); BuildClubTable 02:51F6 (13 clubs x 7 bytes -> `$C900`).
- **Golfer setup**: SetupPlayerGolfer 02:4A28 (export `$1E`, 141 call sites). It fills player record c from golfer b: `$80` = own character, `$81` = `$C600`, `$82` = link partner `$CB40` (sets +`$13` = 3), any other value = preset golfer from 02:4B1D. Player field +`$13` is the controller type (0 = human; AddPoints and 02:5BEC test it). Golfer lists for the select screens go to WRAM6 `$D000`, 32 bytes per entry (02:5985, 02:5A2D, 02:5B5B). Presets are gated by game flags or by save flags.
- **Shot records**: LoadShotRecord 02:463E and WriteShotRecord 02:46E3 move 13 bytes (ball, aim, club, mode, power or targets). Per-stroke copies sit at `$D680`; LoadStrokeRecord 02:4626 and BallToShotStart 02:4691 read them back.
- **Link play**: LinkSendShot 02:48B8, LinkSendShotResult 02:4924 and LinkReceiveShot 02:483A send a shot record through `$CB00`/`$CB40`. Control bytes: `$20`/`$21` = idle/aiming, `$2F` = end of block, `$2E` = abort, `$1x` = a button press. While aiming, a partner's button press plays a sound from 02:4802 (02:4812, 02:47ED).
- **Points**: ClearPoints 02:540A, AddPointsRaw 02:5415 (export `$54`; the body of AddPoints without the mode check), AddPointsSigned 02:544E (has a floor of 0). Per-course hole bitmaps at `$C996`, 25 bytes per course (02:5C50, 02:5C77, 02:5CA5).
- **Debug leftovers**:
  - DebugCharacterEditor 02:6176 is reached only from the unreachable debug boot menu (01:4128). D-pad = level up a stat, A/B = change type, Select = slot, Start = save.
  - DebugSaveViewer 02:5D2F (export `$68`, called from 35:776B) hangs with "NO FILE" or "CHECK SUM ERROR", otherwise shows 10 pages of block 3.
  - An EXP test loop at 02:611D (A = +10, B = +100, then automatic level-ups) has no caller.

##### Bank 12: golf HUD and on-course sprites

- HudInit 12:442C (export 0, from 10:4214) draws every HUD part and registers the HUD task 12:449F. The task is gated by `$D358`; `wHudPanelsHidden` `$D455`; `wHudBlink` `$D454` blinks the current player's panel.
- HUD parts (all render to WRAM then queue to VRAM1): lie icon 12:45F4 (by HudLieIndex 12:4239), club icon 12:465C, shot panel 12:46A6 (shot type by wShotMode, club name, club base distance), hole/yards/par 12:4A0A (`$C837`, `$D323`, `$D325`), wind 12:4A81 (`$C815` speed, `$C816` angle), player faces and strokes 12:4B8A / 12:4C18 (player records +`$10` / +`$19` / +`$20`), pin distance 12:4CB1.
- UpdateWindIndicator 12:50A0 animates the objects at `$CAB0`.
- Target-marker blink and edge arrows: 12:502C (uses `$D36B` from 40:640E).
- StrongWindIntro 12:6F8D runs at hole start when wind is `$0C` or more.
- FreeLookCursor 12:6D3D (export `$42`, from 41:7879) moves cursor `$D422`/`$D424` with acceleration `$D486` and switches to the green view when the cursor enters the green. **Debug:** with hDebugMode set, A teleports the ball to the cursor; with hDebugMode >= 2, 12:6F16 prints the cell's terrain and slope in hex.
- Countdown control for UpdateGameTimer (`$C0F4`: 1 = run, 2 = pause, `$FF` = expired): CountdownStart 12:4F52 and CountdownPause 12:4F73, both called from bank 34. Resume 12:4F67 and stop 12:4F7F are unreferenced.
- Cell lookups at map positions: TerrainAtPos 12:40FD, GreenSlopeDirAt 12:4098 (the slope direction is remapped by the tile flips through 12:40DD).
- Unreferenced: HudDrawClubLieNumbers 12:4622, and a lone `ret` at 12:4DE8.

##### Bank 04: map actors (people sprites) and map scrolling

- There are 24 actors of `$40` bytes in WRAM4 `$D000`. Fields: +0 script/bank, +4/+6 x/y, +`$16`/`$17`/`$1E` state, +`$18` leader, +`$20`/`$22` character tables, +`$24`/`$26` animation, +`$2B` bank, +`$2C` slot, +`$2D` palette, +`$30` character, +`$31` animation, +`$38` VRAM tiles.
- Init and spawning: ActorsInit 04:410D; ActorAlloc 04:4139 (**bug/leftover:** computes a random 8-15 value, then overwrites it with `$0800`); ActorSpawn 04:4FFB (12-byte spawn records gated by a game flag, 04:4FBE); SpawnActorList 04:5084; SpawnPlayerActor 04:510A; SpawnPartnerActor 04:51D0 (partner chosen by flags #144-147, follows the player via ActorStartFollow 04:4525).
- Character and animation: ActorSetCharacter 04:4D42 (headers at 04:4F1C), ActorSetAnim 04:4E51.
- Proximity and lists: FindActorNear 04:55C4 (talk target), BuildActiveActorList 04:56FD -> `$CAC0`.
- MapScrollTask 04:4072 (export `$3C`, also run as a frame task) blits BG rows and columns as the view tile changes; SCX/SCY include the shake offset `$C368`/`$C369`.
- Golf uses actor 0 as the golfer's map sprite: 04:57BA, 04:57A1, 04:5808.

##### Bank 15: the behind-the-golfer picture (objects and flag)

- BuildBehindView 15:46AB (export 0, from 13:43AE) runs these steps:
  1. BehindViewSetup 15:4570: viewpoint `$280` units behind the ball along wLaunchDir.
  2. Ground (bank 16).
  3. ProjectViewObjects 15:47BD: objects from the WRAM4 `$DC00` list inside the view cone, at most `$55` of them; sound `$23` when the list is full.
  4. Screen columns and rows (15:498F, tables 15:48E7 / 15:490F).
  5. Column and depth sort (15:49F7, 15:4AC7).
  6. Flag sprite (15:4DC1, hidden when occluded).
  7. Scenery by course: jump table 15:463F by `$C836` -> export 0 of banks 4B/4C/4D/4E/4F/4A; course 7 chooses by hole.
  8. Copy to VRAM.
- **Debug leftover:** ProjectFlag 15:4B18 prints the flag's distance and angle with PrintDecimalWord on every build.
- TerrainAtCell 15:4F9A works like TerrainAt but in quarter-tile units.

##### Bank 16: behind-view ground renderer

- RenderBehindViewGround 16:4058 (export 2; also called from bank 7D) draws 20 rows (`$C47E`) into WRAM tiles `$CF80-$D9FF`.
- Per row: SampleViewRow 16:7B01 takes 64 terrain samples along a perspective row (row offsets at 16:7AD9, origin `$C3A4`/`$C3A6`; an unrolled sampler at 16:7A65 that uses stack tricks under `di`). Then: class translation through `$C400` (table 16:4010, loaded by export 0); SmoothGroundRow 16:5967; DominantGroundClass 16:432A for 8 column groups; pattern words written by DrawGroundColumn 16:435F (tables 16:3D67 / 16:3F67 / 16:4567, or 16:4767 on course 3).

##### Bank 11: golf camera, ball/golfer sprites

- Camera: CameraComputeGoal 11:413C (mode `$D438`: scroll / ball / marker / look cursor / cup, clamped to wMapBounds), CameraStep 11:422F (step size by distance, writes the scroll position `$C320`/`$C322`), CameraAtGoal 11:41F7, WaitCameraAtGoal 11:4224.
- InitBallCamera 11:476E is the view-4 camera.
- PreviewMarkerView4 11:48AB projects the preview ghost spot.
- LoadPictureTiles 11:4EAB is an LZ list at 11:4F02 decompressed into VRAM1 (called from 0B and 32).
- LoadGolferSpriteTiles 11:6E1E and LoadGolferFrameTiles 11:6E08 load from the per-golfer list 11:6EEF; wGolferId is `$D332`.
- **Leftover:** CpuPlanShot 11:4046 (SmartAim + club + power) has no caller.

##### Bank 40: full-screen pictures, target-marker placement, LZ UI tiles

- LoadFullScreenPicture 40:5BF9 takes a (idx, bank) list: palettes, tiles, attributes, map.
- ShowPictureTimed 40:6666 (export 1, pictures in banks 7B and 49) and ShowPictureUntilButton 40:66B5 (export 2, waits up to 60 s or a button). Callers: the debug boot menu (01:4131-4155, unreachable) and story banks 31, 33, 65, 77.
- PlaceTargetMarker 40:640E (export 3, from 10:5A2B / 10:5D10) places the marker at ball + club base distance along the aim (AimOffset 40:62BC). The offset is scaled down so the marker stays inside the map, or inside the green view's 5x4 tiles; edge bits go to `$D36B`.
- The LZ UI tiles at 40:66F6 were already known.

##### Bank 4F: one course's behind-view scenery, and captions

- ComposeObjectPicture 4F:5645 (export 0, through 15:463F) blits the sorted object list `$DA00` into the WRAM tile sheet. Type-1 shapes come from 4F:6049 / 4F:57FB (colours 0 and 3 opaque, BlitRowOpaque03 4F:615C); type 2/3 shapes from 4F:5712 and 4F:611C (colour 0 transparent, 4F:6169). An extra shape is drawn when the ball's terrain `$C3B7` = `$0C`. Then LZ 4F:5410 and palettes 4F:5615.
- **Captions** (bank 3B): StartCaptionAnim 4F:619C (sound `$4A`, sprite object `$CAA0`, scripts 4F:632B / 4F:6569; the OBJ palette comes from 4F:63A9 and is varied by `$C836` and hole number via 4F:627B / 4F:6294), WaitCaptionAnimEnd 4F:618B, StopCaptionAnim 4F:6184.

##### Bank 77: story pictures

- LoadStoryPicture 77:6E3E (export 6, from 32:4AB5 and 3B:7737): c = picture (< `$0B`), b = variant (via 77:6F86).
  - Tiles: LZ list 77:7346 into WRAM1, then six `$200`-byte HDMA copies to `$9200-$97FF` and `$8800-$8DFF`.
  - Map: 77:7376 / 77:752E.
  - Animation: script 77:76E6 (`$D347`), tasks 77:7033 and 77:6F8E.
  - Then farcall 4A:6205, which acts only for variant 0.

##### RAM introduced (see CSV)

- Camera: `$D42E`, `$D432`, `$D438`.
- Behind view: `$C3A0-$C3B9`, `$C47C-$C487`, `$C836` (course?).
- HUD: `$D322-$D328`, `$D454`, `$D455`, `$D36C`, `$D422`, `$D486`.
- Wind: `$C815`, `$C816`.
- Countdown: `$C0F4`.
- Character record: `$C810-$C826`, `$C900`, `$C996`.
- Save: `$C2A5`, `$A038`.
- Game mode: `$C834`.
- Actors: `$C296`, `$CAC0`, `$C324`, `$C368`.
- Story pictures: `$D347-$D34C`.
- Effect objects: `$CA80`.
- Caption object: `$CAA0`.

##### Bank 05: window manager, menus, message boxes, text printer, debug menu

Role: the whole UI layer that the overworld/RPG, golf and cutscene code calls (61 exports at `$4000`; ~560 far
calls). It owns WRAM5 `$D000-$DFFF` and draws windows over the overworld map into a WRAM5 BG shadow that is
queued to VRAM through 00:0468.

**BG shadow** (WRAM5): `D000-D3FF` tile map 32x32, `D400-D7FF` attributes (same addresses as WRAM6 wBallX etc.,
so no RAM label). ShadowTileAddr 05:414F; copies to VRAM: QueueShadowRows 05:4262 (tiles to `$9800`, attrs to
`$B800` = VRAM1 `$9800`; 00:0468 treats `$A000+` as VRAM bank 1), CopyShadowRowsFramed 05:42AD (7 rows per frame),
CopyShadowToVRAMFramed 05:64D1. The map under windows comes back from the 64x64 overworld map (WRAM3 tiles,
WRAM2 attrs, see Graphics): CopyMapRowToShadow 05:450B (column `$C321`, row from `$C323`), RestoreShadowFromMap
05:4492 (20 rows, 5 per frame; the standard "redraw" call, always followed by UpdateWindows).

**Windows.** 6 slots at `$D800` (4 bytes: record pointer, priority<<5 | text-id high, text-id low). The pointer's
high nibble doubles as a command: `$D` = live, `$C` = close request (CloseWindow 05:4C5C). Records live in 7
buffers of `$11D` bytes at `$D900` (bitmask `$D823`): flags, x, y, w, h, then (tile, attr) pairs. Frame tiles are
`$02-$09`; text windows (BuildTextWindowRecord 05:4773) number their interior tiles from `$80` on every other row,
so each window has its own run of glyph tiles. API: OpenWindow 05:4AF2 (export 04; d,e = screen tile pos
relative to the scroll, b,c = size; returns the slot), OpenWindowWithAttr 05:4AD2, OpenMessageWindow 05:4B20,
OpenMenuWindow 05:4BB0, SetWindowText 05:5A51, SetWindowTile/GetWindowTile 05:4408/444F, SetWindowPriority
05:4C75, CloseWindow 05:4C5C, RemoveWindow 05:67BB. UpdateWindows 05:4949 (export 14) walks priorities 1-8:
erases windows marked for closing (FreeWindowSlot 05:48CE) and draws the rest (DrawWindowToShadow 05:4831,
CopyWindowRowsFramed 05:4384), printing each slot's text id. Callers do `RestoreShadowFromMap ; UpdateWindows`
after every change.

**Menus.** OpenMenuWindow sizes a window from a text whose options are separated by `$01` and pushes it on a
6-deep menu stack (`$D832`, depth `$D83E`). RunMenu 05:4CD7 (export 4E) moves the cursor (frame task
MenuCursorTask 05:4F20 blinks tile `$0D`), sounds `$5B` move / `$5C` select / `$5D` cancel, returns the row, `$FF`
for B (or Start when `$C3FC` bit 7), `$FE`/`$FD` for Left/Right in paged menus (RunPagedMenu 05:5197).
RunYesNoMenu 05:45F6 uses text `$001A` "Yes/No".

**Message boxes.** ShowMessage 05:5D49 (export 46): hl = text id, a = speaker actor; OpenMessageBoxNearSpeaker
05:5F62 puts a 20x7 box at the bottom or top depending on the speaker's y (actor records `$D000 + n*$40` in WRAM4,
GetActorPtr 05:6472) and grows it to the measured text size in 8 steps; pages loop on wTextPagePending `$D850`.
Variants: ShowMessageKeepOpen 05:5DE5, ShowMessageAt 05:5E70 (centred on d,e; bank 30 cutscenes), ShowMessageInPlace
05:67C5. Text size: MeasureTextBox 05:5C3B / SizeMessageBox 05:5B3B walk the string with per-code measure helpers
(05:55CB, 5634, 5679, 56E2, 579E, 57FD, 5857) and FontWidths. Typing: TextCharDelay 05:5CC2 plays a voice blip
(sound `$69 + voice*4 + (char & 3)`; voice from SpeakerVoiceTable 05:66C0 by the actor's `+$30` byte) and waits
`$D829` frames, set from the text speed option `$C82D` by SetTextDelayFromOption 05:5D1F (0 / 2 / 4 frames).

**Text arguments.** PushTextStringArg 05:54CF (export 54, list `$DFAE`), PushTextNumberArg 05:551F (export 56,
`$DFCE`), PushTextByteArg 05:5552 (export 58, `$DFEE`), 16 each, consumed by codes `$04`/`$09`/`$08`; SetTextCourseIndex
05:57C3 (export 5A) sets the `$0B` argument `$D85D`. All control-code handlers are now labelled (TextCmd*, 05:52EF-5921).
NormalizeTextId 05:622F adds an index offset to a text id and carries into the next text bank using TextBankSizeTable
05:629A (512 216 252 285 264 497 768 169 = the per-bank string counts in "Text").

**Text to arbitrary tile maps.** PrintTextToBuffer 05:62AA (export 22) renders a text into glyph tiles and writes
their numbers into any tile buffer (stride c); PrintTextToShadow 05:648E, the window-buffer helpers 05:652F-65F1,
DrawStringToWindow 05:65FF (characters as tile numbers straight into a window record).

**Debug menu** (05:6B2E, export 60; only the debug boot path reaches it): text `$0084` "Scene / Map / Palette /
Flag". Scene = DebugWarpMenu 05:6C25 (pick a MapTable record by index with its name, text `$012C + n`, and an
entrance 0-15; A sets wMapId / wMapEntrance and `$C441 = $FA`); Map = farcall 0B:4579; Palette = farcall 44:42FB;
Flag = DebugFlagEditor 05:6A57 (4 pages of 64 game flags `$C840`; A toggles, Start next page, tiles `$65`/`$40`).

**Leftovers / oddities.**
- No callers (dead code): ClearBGShadow 05:40E6, DebugHDMAShadowToVRAM 05:4102 (HDMA while A is held),
  ReadShadowTile 05:413E, CopyShadowRowToVRAM 05:4221, CopyMapEdgeRows 05:44B7, BuildPlainWindowRecord 05:4717,
  EraseWindowFromShadow 05:486F, PrintHex/Dec*Inline 05:59D1-59FC, GetWindowText 05:5A75, SetWindowPriorityAlt
  05:5B0F, ContinueMessageAt 05:5F02 (takes the voice actor from e - 9), ResizeMessageBox 05:60C3,
  PrintNumberInWindowBufferNow 05:65CC, DrawNumberToWindow 05:6658.
- CloseMessageBoxAnimated 05:60FF jumps over its own shrink animation (05:6108-614C unreachable).
- SizeMessageBox calls PrintHexByte (00:22A5) with the box width at `de = $0A0C` (05:5BF3): a debug print left in.
- CopyWindowRowsFramed 05:43F4 is `jr $` (hang) if a wrapped window part is 8+ rows.
- OpenMessageBoxCentered 05:682D is a byte copy of OpenMessageBoxAt 05:605F.
- `$DE`/`$DF` (dakuten) handling everywhere: Japanese-version residue.

**RAM** (all WRAM5 unless noted): window slots `D800-D817`; `D820` last opened, `D821` current, `D822` count,
`D823` buffer mask, `D824` message window, `D825-D828` its x y w h, `D829` char delay, `D82A/D82B` pen line start,
`D82F-D831` menu window / cursor / rows, `D832-D83E` menu stack, `D841-D845` cursor blink and addresses, `D846`
menu page, `D847-D84C` argument indices / counts, `D84D` window tile attribute, `D84E` resume pointer, `D850` page
pending, `D851` speaker, `D854` box width, `D85D` course index, `D860` window buffer index, `D862` voice, `D863`
prompt window, `D864` PrintTextToBuffer pointer, `D866-D868` measure indices, `D869` read pointer, `D880` short
text, `D900` buffers, `DFAE/DFCE/DFEE` argument lists. WRAM0: `C360-C362`, menu options `C3F9/C3FA/C3FC`,
`C780` string scratch, `C7E0` map row buffer, `C82D` text speed, debug `C470-C474` and `C484-C489`.

##### Bank 03: proportional-font glyph renderer

Role: draws text pixel by pixel. Glyphs from Font 03:50F0 (2bpp, 16 bytes) are OR-ed into a glyph buffer of
`$80` tiles in WRAM7 `$D000` at a bit-precise pen (`$C36A`, bits 0-2 = pixel, /128 = tile) by DrawGlyph 03:4B45 /
BlitGlyphByte 03:4B9D, advancing by FontWidths 03:5750 (GetCharWidth 03:4B89). The tiles are uploaded to
`$8800-$8CFF` (tile ids `$80+`, VRAM1 when the window attribute has bit 3): all at once (UploadGlyphBuffer 03:4C60,
UploadGlyphTiles 03:4F6C: per-frame when the LCD is on, direct when off), per character for typed messages
(UploadCurrentCharTiles 03:4DF0, only when `$C82D` is not instant), or as a range (UploadGlyphRange 03:5087).
Pen/block state: `$C36A` pen, `$C36C` line length, `$C36D` next line tile, `$C36E` next free tile, `$C36F` block
start, `$C370/$C371` upload count / start, `$C372` VRAM bank. Bank 05 drives it: InitTextPen 03:4D41 at the start
of PrintText, DrawNextChar 03:4D93 per character, FinishTextBlock 03:4F7D at the end; DrawCharFromHL 03:4E6A /
WriteGlyphTileNumbers 03:4F21 / CommitGlyphBlock 03:4F58 for PrintTextToBuffer. ResetGlyphBuffer 03:4EB8 (16 far
callers in many banks) and DrawStringToGlyphs 03:50CD (export 26) are the entries used outside bank 05.

Notable: ResetGlyphBufferDup 03:4EDC is the same code as 03:4EB8; RenderStringToGlyphs 03:4CF1 (export 08) has
no callers; 03:4028-40AA is an unreferenced full-screen picture routine (LZ tiles 03:40AB, map 03:4950, attrs
03:4A9E, palettes 03:4B05, song `$06`, waits for a button; it first resets the serial link) not in the export
table: probably an old link/error screen.

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
| `gfx/hole_XX.png`, `gfx/hole_XX_terrain.png` (gitignored) | the 90 holes and their terrain types |
| `gfx/lz_BB_AAAA.png`, `gfx/raw_03_50f0.png` (gitignored) | LZ entries as tile sheets; the font |
| `python3 tools/gen_all.py` | rebuilds all of the above |
| `out/boot_FFFFF.png` (gitignored) | emulator screenshots from `emu_boot.py` |
| `out/suite_<case>.json`, `states/suite_<case>.state` (gitignored) | shot recordings and poked states from `shot_suite.py` |
| `docs/text_dump.txt` (gitignored) | every string: `id bank:index text`, control codes as `{XX}` (`python3 tools/dump_text.py`) |

---

## Verification Checklist

- [x] Ph3: 3+ functions traced and cross-checked against emulator trace (`tools/emu_verify.py`: LZDecompress,
      LoadText, MapLoadHeader, MapLoadGfx; see "Verification" below)
- [x] Ph4: tiles extracted and compared to the emulator: two whole map tile sets in VRAM bank 1 match byte for
      byte; gfx 1E matches the character-creation screen by eye
- [x] Ph5: key data structs confirmed against emulator memory: MapTable record, hole maps (tilemap, attributes,
      terrain), and the ball state D400-D415 field by field (ball_sim.py reproduces it exactly)
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
- [x] Find the golf round: GolfRound 10:4451 (emulator, emu_callers.py), entered from map 00's menus
- [x] Golf engine, first pass: round and shot loop, swing meter, ball state and the flight / roll steps
- [x] Golf engine: shot launch (ShotLaunch 10:5F94): club distance table, power curve, speed / elevation / direction
- [x] Golf engine: ball step ported exactly (ball_sim.py: flight, wind, drag, bounce, roll, slopes; 5 shots, 1783 steps)
- [x] Ball step: the green (putting) branches, water drop and skip, bunker plug; the cup and holing out
      (ShotMainLoop 10:6E99; whole-shot replay in the interpreter, shot_suite.py: 24 cases, every event matches)
- [x] Cup routines in Python (cup_sim.py, test_cup.py), trees (TreeCheck 08:51D2), the rest of BallTask, and
      ShotMainLoop with the flight-camera loop (shot_py.py): whole shots run in Python (shot_run.py, 27 cases)
- [ ] ShotMainLoop's retry branch (10:6FC9, A with `D35F` set) and 13:4276: not reached yet
- [x] ShotLaunch in Python (launch_py.py, test_launch.py), chained into shot_run.py: swings from the launch to
      the outcome match the game in every case
- [x] The swing in Python from the address step: club and aim changes, the meter, the impact pad, the swing
      animation's timing, the landing preview, the stroke count (swing_py.py, joypad.py; 27 suite cases)
- [x] A whole hole in Python (hole_py.py): penalties, drops, points, scorecard, the game's club and aim choice;
      four recorded holes match (hole_suite.py); play_hole.py plays a hole with the Python engine choosing swings
- [ ] The aiming menu's other answers (club list, shot modes, power shots, map view), two players, the stroke
      limit, a retry (B), the computer's swing (10:5643) and choices; then the round (next hole, wind) in Python
- [ ] Golf engine: aiming loop (10:486B), club select, CPU golfers' targets, scoring (strokes, PlayerField `+$20`)
- [x] Hole data: HoleAssetTable 13:4A16, overhead assets, terrain table; all 90 holes render (render_hole.py)
- [ ] Holes: the per-hole data still unidentified (ref 1 entries 2-3: tee/pin positions? par/length?), terrain
      types 4, 5, 8, A-F, the behind-the-golfer view assets (refs 2-4), hole ids `$00-$09` and `$64` up
- [ ] How the play-mode menu (map 00) calls GolfRound, and the RPG side's golf (story tournaments from maps)
- [ ] Map header fields +10/+12; warp record bytes 0-5; entrance byte 1; MapTable byte 5
- [x] Save: signature, checksum, backup, block directory (02:41F6 SaveLoad and friends; dump_save.py)
- [ ] Save: what each of the 12 blocks holds (play a story file, save, diff with dump_save.py); GameMain's other
      bank-02 calls 02:45D3 and 02:4E3D
- [x] Sound: driver copies in 7C/7D/7E, song bank/pointer tables, command id ranges, effects bank 7F
- [ ] Sound: channel script format (7E:42B9 per channel) and the effect format (7F); exports 7E:4043-4064, 49DF, 49EB
- [x] Text: text banks 18-1F, id format, control codes, font 03:50F0 (dump_text.py)
- [x] Text: font rendered; plain 2bpp tiles
- [ ] Text: control code `$0D` (05:531B) and where the argument lists `$DFAE`/`$DFEE` are filled
- [x] Decompress and render LZ entries (extract_tiles.py); overworld maps fully rendered (render_map.py)
- [ ] Map descriptor w7 (WRAM6 D800): find its readers (w4 = terrain grid, w5 = event grid: bank 0B notes)
- [ ] Loaders for the LZ entries in banks 40, 4B-4E, 58 (UI, faces, sprites) and the golf course graphics
- [ ] Milestone 3: run the game on `web/js/gb` (copy from Tennis) with SRAM saving; `core_vs_pyboy.mjs`

### Web Port Fixes

### Documentation

- [x] `docs/architecture_exe.md` (binary layout, bank roles, execution flow, data flow)
- [ ] `docs/architecture_web.md` once the web port starts
