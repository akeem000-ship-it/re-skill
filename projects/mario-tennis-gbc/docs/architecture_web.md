# Mario Tennis (GBC) — web port architecture

Scope: a **singles exhibition match** (Mushroom Kingdom cast, any of the 15 court maps, 2- or 6-game
set with tiebreak, four CPU difficulties). Plain ES modules, no build step:

```
cd projects/mario-tennis-gbc && python3 -m http.server 8000
open http://localhost:8000/web/index.html      # auto-loads rom/mario_tennis.gbc, else file picker
```

No game data is embedded: `rom.js` decompresses everything from the user's ROM in the browser
(SHA-1 is checked).

## Module graph

```
index.html
  └─ js/main.js        ROM loading, input, camera + projection, rendering, 60 fps loop
       ├─ js/rom.js     Rom (bank addressing, bank tables, LZ decompressor), BGR555, 2bpp tiles
       ├─ js/assets.js  courtImage, characterSprites, characterData, shotRow (+ roster/court lists)
       ├─ js/physics.js ball state, step(), launch(), predictBounce(), COURT constants
       ├─ js/shots.js   the game's aiming + trajectory-table selection (computeShot, atan2Rom, shotType)
       ├─ js/match.js   Match: serve/toss/rally/dead state machine, shots, AI, judging, scoring
       └─ js/menus.js   Menus: main → play → character → opponent → difficulty → court (ROM backgrounds, icons, badges, fonts)
tests/
  physics_vs_emulator.mjs  JS ball step vs PyBoy recording (needs states/phys_ref.json)
  soak.mjs                 CPU vs CPU headless match; rally length / outcome statistics
  scoring.mjs              deuce / set / tiebreak / serve-order rules vs the decoded ScoreUpdate
  shots_vs_emulator.mjs    shots.js vs the game's own shot selection (needs states/shots*.json from tools/emu_shot_trace.py)
  record_match.mjs         CPU vs CPU match -> PNG frames
  record_flow.mjs          boot -> intro -> title -> VS -> match -> PNG frames
```

## ROM → web mapping

| Web function | ROM routine / data | Verified how |
|--------------|--------------------|--------------|
| `Rom.lz` | `00:1797 Decompress` | DMG screen, 37 maps, 47 screens render correctly |
| `courtImage(id)` | `0A:585D LoadMap`, table `0A:59D9`, tiles → VRAM1 signed | court renders match emulator |
| `characterSprites` | `07:5A50` roster→sprite, `04:4F75` table, header +0 colour scheme `18:4300`, +4 frames | Luigi/Baby Mario colours from live OAM |
| frame layout | `00:2C2B/2CED` 8×16 OBJ column-major, 12 tiles | all 145 frames of char 0 coherent |
| `characterData` stats | `02:52CE` records, order from stat screen `1C:430E` | poke/hook in PyBoy |
| player movement | `08:73CA PlayerMove` (accel `745B/7441`, clamp `750C/74D7`, brake `74A1/7475`), `DF60-DF66` formulas | formulas: 6 characters in WRAM; accel/top speed: live measurement |
| `physics.step` | `08:576B BallStep` (+ `5949` fences, `5814` net, `55B4` drag, `5613` spin, `46B0` damp) | bit-identical to `tools/ball_sim.py`; 0.03 px vs emulator (serve), ≤0.52 px over 124 frames |
| `physics.launch` | `08:45A9 LaunchBall` | formula from code |
| `shotRow` | shot tables `07:4F11-5160` via `07:52A0` | serve spin = table row 0 |
| `COURT` | `08:40E5` constants, `08:4300` doubles width | real-tennis proportions; live serve/limits |
| `judge()` in/out & serve box | `08:463A InOutCheck`, `wC486` swap (`08:4CFF`, `0D:4BC8`) | constants from code |
| scoring / deuce / tiebreak | `08:5AD7 ScoreUpdate`, `08:5D71 WinCheck`, `DeuceCompress`, faults `08:5B7F`, tiebreak serve order from `08:49D9` | live point 0-15; rules from code; `tests/scoring.mjs` |
| `screenImage` + front end | `39:407E LoadScreen` table `39:40F5`: logos $15, intro $16-$1E, title $1F, VS $01 (boot order from `10:4F0D`) | screens match the Python renders; `tests/record_flow.mjs` |
| `Menus` | main `3B:55D1`, play `3B:5CF3`, character `38:7408`, court `3E:5D11`: stadium refs `3C:08-0E`, icons `3B:57E0/5EBD`, `3E:5DF1`, badges via `39:46B7`, portraits `18:5AF0`, UI font `01:4410`, texts bank `30` | PPU dumps of each real menu; roster order and court→map verified live |
| `gameFont` | font `05:7920`, widths `05:7F80` (`05:7322 DrawGlyph`) | glyph sheet rendered and checked |
| `proj()` | fitted to court-line pixels of the 32×32 court maps (projective, D = 16224) | ±1 px on the 4 lines |

## Approximations (not decoded yet)

* **Shot targeting**: `shots.js` is a port of the game's own pipeline (REVERSE.md "Aiming and launch"):
  shot type from the buttons, aim depth per type, target X from the aim table, heading via the ROM's
  table atan2, speed threshold from stats + charge + incoming speed + movement, then the first record
  of the type's trajectory table (banks 20-24, 2C, 29-2B, read from the ROM) whose speed reaches the
  threshold — exactly as the game (web/tests/shots_vs_emulator.mjs replays 200+ traced shots with zero
  differences). Still approximated: the swing contact test (reach box) and the charge mechanic's timing.
* **CPU AI** (decoded parts, REVERSE.md "CPU AI"): the difficulty table `38:5FFB` (reaction delay for
  deep/short balls + rand 0-3, positioning error, smart-placement probability, shot profile), the four
  shot-profile tables `02:5E23` (A / B / A+B lob picks), lob-when-opponent-at-net, aim away from the
  opponent vs random side, quick-serve chance per profile, and the net-rush intercept depth ($0180).
  Approximated: the scale of the positioning error (×14 units), the CPU swing reach (70 × 140),
  the net-rush probability per profile (5/15/30/45 %), and a contact-timing scatter that stands in for
  the undecoded swing windows. Calibration (CPU vs CPU soak): 2.0 / 3.2 / 6.2 / 4.7 hits per point.
* **Swing windows**: reach box 110 × 140 units, height ≥ −330; serve speed scales down when the
  toss is hit away from its apex (the emulator showed 57 vs 72 px/frame).
* **Net**: the ball bounces back off the tape (quartered horizontal speed). Net-cord handling is not ported.
* **Animation**: the ROM's animation scripts (`Animator` in `assets.js`, rules of `08:7791 AnimTick`), frame =
  group × 5 + view. Animation ids per state come from a PyBoy recording (1 ready, 2 run, 16/15/7 serve,
  13/14 → 9/10 forehand/backhand, 11 high ball, 4/3 point won/lost); the state → id choice and the run
  view per direction are the port's own logic. The camera follows the midpoint of ball and near player.
* HUD and messages use the game's dialogue font (`gameFont`: 05:7920 2bpp glyphs, widths 05:7F80); the score
  bar layout is the port's own.
* Front end: logos, intro panels, title (Enter = Start, Enter skips the intro), then the game's menus rebuilt from
  their ROM data (Z/Enter = A, X = B/back, arrows), then the VS screen. Only Exhibition singles is selectable;
  the other main-menu items answer "Can't choose this yet!" (text #131) as the game does for locked items. The
  character list offers the fresh-save six first, then the rest of the Mushroom Kingdom cast (normally unlocked
  by play). The HTML controls still work as a shortcut (Start button).
* Not ported: doubles, mini-games, Mario Tour (RPG), sound/music.

## Timing

Fixed 60 Hz timestep (`main.js` loop): logic runs once per 1/60 s regardless of the display refresh rate
(120 Hz screens get one update every other paint; a slow device catches up by at most 4 updates per paint).
A match frame costs ~0.1 ms in headless Chromium, so even phones have headroom; the page shows the measured
updates per second under the ROM status.

## State machine (`Match.state`)

```
serve --(A/B, or CPU after 50 frames)--> toss --(A/B while Z < -150)--> rally
toss  --(ball falls back)--> serve
rally --(judge: fault | out | net | 2nd bounce | fence)--> dead --(70 frames)--> serve
dead  --(fault on first serve)--> serve (same server, secondServe = true)
game won --> server switches; set won (N games, lead 2, or tiebreak at N-N to 7) --> over
```
