# Mario Golf (GBC) — web build

The game runs in the browser on this project's own Game Boy Color core. Nothing from the ROM ships with the page:
it loads the user's dump at runtime.

## Running it

```bash
python3 -m http.server 8765          # from projects/mario-golf-gbc, with the ROM at rom/mario_golf.gbc
# open http://localhost:8765/web/    (or open web/index.html anywhere and pick the ROM file)
```

Keys: arrows, `Z` A, `X` B, `Enter` Start, `Shift` / `Q` Select, `Space` fast forward, `P` pause, `M` mute.
Gamepads (standard mapping; the left stick works as the d-pad) and an on-screen pad on touch screens.

## Files

| File | Role |
|------|------|
| `web/index.html`, `web/style.css` | the page: screen, touch pad, ROM picker (shown when `rom/mario_golf.gbc` is not served) |
| `web/js/main.js` | loads the ROM (SHA-1 checked), runs the core at 59.73 fps (`requestAnimationFrame` with a frame accumulator), input, sound (an AudioWorklet fed with the core's samples), the battery save in `localStorage` (`mg-sram-<sha1 prefix>`, written a second after the game stops writing SRAM and on page hide) |
| `web/js/gamepad.js` | Gamepad API (and an Android bridge mask) into the key map |
| `web/js/gb/` | the Game Boy Color core: `cpu.js`, `mem.js` (MBC5, timer, joypad, DMA), `ppu.js`, `apu.js`, `gbc.js` (machine and frame loop), `snapshot.js` (resume from a PyBoy state), `state.js`, `exec.js` (for recompiled code, unused yet) |

The core was copied from `../mario-tennis-gbc/web/js/gb/` and changed where Mario Golf showed it differs from
PyBoy (below). The two copies now differ; when both games go into one app the Golf version is the one to keep.

## Checked against PyBoy (the reference emulator)

| Test | Run | Result |
|------|-----|--------|
| `web/tests/core_vs_pyboy.mjs out/py_play.txt --keys …` | power-on, menus, a Stroke round (6000 PyBoy frames; `tools/emu_frame_hashes.py`) | every comparable frame identical (PyBoy's first 64 frames are its boot logo) |
| `web/tests/snap_vs_pyboy.mjs` from `states/postboot.state` | 24 000 frames of mixed input: menus, hole 1 played out, hole 2 | 24 000 of 24 000 identical |
| `snap_vs_pyboy.mjs` from the recorded holes (`out/hole*_bot.json`) | 4 holes, 3500-4321 frames each | all identical except frame 0 |

`snap_vs_pyboy.mjs` resumes the core from a PyBoy state (`tools/emu_dump_snapshot.py`, which also carries PyBoy's
16-bit divider and LCD clock read from its save-state bytes) and plays the presses of a recording; PyBoy's hashes
come from `tools/emu_frame_hashes.py --state STATE --presses REC.json`. Frame 0 after a snapshot differs because
the palette RAM is restored from the game's buffer (`wPalLive $C100`), which can lead the real palettes by a frame.

### Core changes made to match

- Frames end where PyBoy's do: when line 153 wraps to 0, when the LCD is switched on, or when it is switched off
  (then every 70224 dots); inputs given per frame therefore land at the same point. The screen is blank while the
  LCD is off and during the first frame after it is switched on.
- After the LCD is switched on it restarts when the writing instruction ends; that frame's line 0 is 8 dots short
  and its line 153 8 dots long.
- Timer: TIMA counts falling edges of the divider bit (edge glitches on DIV and TAC writes); on overflow it reads 0
  for 4 cycles before the TMA reload and the interrupt. STOP (the speed switch) resets the divider.
- Register access timing: the Timer, sound and LCD registers are read and written with the hardware advanced to the
  cycle of the access inside the instruction (4 for `ldh`, 8 for `ld a,[nn]` / `ld [nn],a`, 4/8 for `(hl)` CB ops).
- A halted CPU sleeps straight to the next PPU transition or timer tick (at least 4 cycles).
- An HBlank DMA started during HBlank (or with the LCD off) copies its first block at once.
- Power-on state: the registers, divider and LCD position PyBoy's boot ROM leaves at `$0100`.
