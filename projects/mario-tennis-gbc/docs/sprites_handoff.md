# Mario Tennis (GBC) sprites: a handoff for making new characters

This is written for an AI assistant (or a person) who will draw new character sprites ("sprite conversions": new looks for the
game's characters) for MTenn3D, the Mario Tennis GBC remaster in this repository. It explains how the game's sprites are built,
what the zip of exported sprites holds, and exactly what to produce so a new character works in the game.

All addresses are `BANK:ADDR` (hex). The full reverse-engineering notes are in `REVERSE.md` ("Sprites", "Character records").
The sprite pictures in the zip come from the player's own cartridge dump: they are reference material for private use, and must
never be committed to this repository or published.

---

## 1. What is in the zip

| Folder | What it holds |
|---|---|
| `match_sprites/NN_name/fFFF.png` | Every frame of every match sprite set (46 sets, 0-45), at 1x, in the set's default colours, transparent background. Made by `tools/export_sprite_frames.py`. |
| `match_sprites/NN_name/fFFF_idx.png` | The same frame as **palette indices**: transparent = 0, grey 85 = 1, grey 170 = 2, grey 255 = 3. This is the real data; the colours are applied by the game. |
| `match_sprites/manifest.json` | Per set: id, the roster names using it, bank, and per frame its width, height, draw offset (`dy`, `dx`) and tile count. |
| `walk_sprites/NN_name.png` | The campus (overworld) walking sprites of the 32 roster characters: one row per frame (up to 16), one column per facing (4), 16x16 each, as palette indices. Made by `tools/export_walk_frames.py`. |
| `walk_sprites/manifest.json` | Per character: walking object id, bank, frame pointers, and which frame numbers share one picture. |
| `faces/portraits/NN_name.png` | The 24x24 portrait (character select, VS screen, results, messages), palette indices. Made by `tools/export_portraits.py`. |
| `faces/heads/NN_name_a.png`, `_b.png` | The two 16x16 heads beside the score in a match, palette indices. |
| `sheets/char_NN.png` | Contact sheets of each match sprite set in colour (`tools/render_sprites.py`), for a quick look. |
| `examples/*.json` | Working mod files that already run in the app (see section 5). |
| `examples/template_mod.json` | A blank, commented-by-example mod to start from. |

---

## 2. Game Boy Color sprite basics

* Graphics are **8x8 tiles, 2 bits per pixel**: every pixel is an index 0-3. 16 bytes per tile (two bit-planes per row).
* Sprites (OBJs) use index **0 = transparent**, so a sprite has **3 visible colours**.
* The colours come from one of 8 OBJ palettes of 4 colours, each a 15-bit BGR value (5 bits per channel). In this game a
  character's palette is chosen by its sprite set header (+0, values 3-7, palettes at `18:4300`), and the match code
  recolours for the court side and the player's look.
* In every player sprite: **index 1 = the light colour** (skin, highlights, white of clothes), **index 2 = the character's
  own colour** (shirt, cap: what the game recolours), **index 3 = the dark colour** (outline, hair shadow, shoes).
* The game draws 8x16 OBJs, at most 10 per screen line. A 24-pixel-wide frame is 3 OBJs across, so two players side by side on
  one line already use 6: **do not make frames wider than they are now**.

---

## 3. Match sprites (the players on court)

**Where they live.** `LoadCharacterSprites 04:4B68` takes a sprite id (0-45) and reads `CharSpriteTable 04:4F75` (46 entries of
`idx, bank`). Ids 0-29 are the tennis players (banks `40`-`5D`, one per bank); 30-45 are NPC / mini-game sprites (banks
`6F`-`71`, 10-15 frames each). A roster character (0-31, the text order) is mapped to a sprite id by `RosterToSprite 07:5A50`;
two roster characters can share a set (the manifest's `names` lists them all; Kevin and A. Coz both use set 10). Note that the
`match_sprites` folders are numbered by **sprite id**, while `walk_sprites`, `faces` and a mod's `char` use the **roster number**.

**The header** (16 bytes at `[bank:$4000+idx]`): `+0` palette slot (3-7), `+4` frame pointer list, `+6` animation table,
`+A` per-frame info, 4 bytes per frame: `dy, dx, flag, ntiles`.

**A frame.** `ntiles` tiles (usually 12 = 24x32 px, sometimes 16 = 32x32), stored **column-major as 8x16 OBJs**: tile *t* goes to
column *t / 4*, row *t mod 4* (each column is 8 px wide and 32 px tall). `dx, dy` place the frame relative to the player's feet
(typical: `dx = -15, dy = -4`). When `flag` is not 0 a second chunk (the standing shadow, 3 more tiles) follows at frame + `$100`.
`UploadSpriteFrame 00:2E6B` copies the current frame's tiles to VRAM each time the frame changes, so **a frame can never use more
tiles than its `ntiles`**.

**145 frames per player = 29 groups x 5 views.** `frame = group x 5 + view`. The view comes from the player's facing (8
directions folded into 5: 0 = back, 1 = back-diagonal, 2 = side, 3 = front-diagonal, 4 = front; the other three directions are
the same pictures flipped). So every pose must be drawn from 5 angles.

**Animations** (`tools/dump_anims.py`): `[frame, duration]` pairs, `$FF n` loops, `$FE id` switches animation, `$FB m` flips. The
ids used in a match: 1 ready, 2 run, 16 serve stance, 17 ball bounce, 15 toss, 7 serve hit, 13/14 forehand / backhand wind-up,
9/10 swing, 11 high-ball swing, 4 point won, 3 point lost; 5-8 short swings, 12 a held pose, 18 another one-shot pose.
**Timing and hit frames belong to the animations, not to the pictures**: a new character keeps the same animations, so each new
frame must show the same moment of the stroke as the frame it replaces (look at the original frame with the same number).

**Special sets.** Set 26 holds the training robot (its first ~40 frames) before normal player frames. A set shared by two roster
characters changes both at once. Set 19 (Bowser's) is only used once he is unlocked
from the N64 game, which is why mods may borrow it (section 5, `matchSet`).

---

## 4. Campus sprites, portraits and HUD heads

**Walking sprites.** Character C's walking object is `CharObjectTable 04:4C29[C]`; the object's bank ref is in `04:4F75`, its header
`+4` is a list of up to 16 frame pointers. Each frame is 256 bytes = **4 facings x 16x16 px** (2x2 tiles, column-major). Several
frame numbers point at the same picture (the manifest's `blocks`): change the picture once and every frame using it changes.

**Portrait.** 24x24, LZ-compressed, 3x3 tiles row-major, from table `16:6968` (a word per character). Shown at character select, on
the VS screen, on the results and in messages. Up to 4 BG palettes of colours.

**HUD heads.** 16x16, raw 2bpp, 2x2 tiles column-major, at `18:5AF0 + 64 x C` and `18:62F0 + 64 x C` (two variants).

---

## 5. Making a new character that works in the game (the supported way: a mod file)

MTenn3D changes characters with **mod files** (JSON), read by `web/js/look/mods.js`. A mod never edits the cartridge file: when
the app starts it patches a copy of the game in memory, in place, keeping every table and size the same, so nothing can break the
game's code or timing. This is the route that works today, on Android and Windows, offline and online.

### What a mod can change, per character (`chars[]`)

| Field | Meaning | Rules |
|---|---|---|
| `char` | which character to replace, by roster number (the list below) | required |
| `name` | new name | 1-9 printable ASCII characters |
| `body` | `"alex"` or `"nina"`: the hero whose 145 match frames and walking frames become this character's body | the body is redrawn from the hero's frames, pose for pose, so every animation lines up |
| `style` | hairstyle or hat drawn onto every frame | alex: `cap`, `headband`, `ponytail`, `short`, `spiky`, `neat`, `visor`, `afro`, `puffs`, `cornrows`, `locs`, `braids`, `fade`, `twists`, `long`; nina: `pigtails`, `cap`, `bob`, `ponytail` and the same eight from `afro` |
| `extras` | drawn on top | any of `glasses`, `bow`, `headband`, `trim` |
| `colours` | the colour of each region | keys `skin`, `hair`, `hat`, `top`, `bottom`, `shoes`, `racket`, `trim`, `outline`, `shade`; values `"#rrggbb"` (rounded to the GBC's 15-bit colour) |
| `touchups` | single-pixel fixes after the automatic drawing | `{"walk:<frame>:<facing>": [{"x":..,"y":..,"r":"hair"}], "match:<frame address hex>": [...]}`; `r` is a region name: `outline`, `skin`, `hair`, `hat`, `top`, `bottom`, `shoes`, `racket`, `trim`, `shade`, `keep`, `none` |
| `portrait` | the 24x24 face | `{"pal": ["#rrggbb", ...], "rows": [24 strings of 24 characters]}`: each character is an index into `pal` written with `0-9a-zA-Z` (up to 62 colours), `.` keeps the game's own pixel. Drawn in the HD layer over the game's portrait, so it may use many colours |
| `head` | the 16x16 HUD head | the same format, 16 rows of 16 |
| `photo` | a high-resolution face for the HD menus | `data:image/png;base64,...` (or jpeg / webp), square, under 400 KB; give `portrait` too for the Game Boy picture |
| `stats` | a play style | 11 weights 0-9: Top, Slice, Serve, Stroke, Volley, Angle, Placement, Speed, Dash, Reaction, Stop. The total strength stays the game's, only the shape changes |
| `lines` | what the character says | `{"intro": ..., "win": ..., "lose": ...}`, each up to 64 printable ASCII characters |
| `matchSet` | a sprite set of its own | only for a character that shares its set with another; must be a set nobody else uses (19 is allowed: it is copied first) |
| `from` | `"senior"` | in story mode the character keeps the game's look until a junior class title is won |

And per mod: `id` (short, unique), `title`, and optionally `texts` (a line of dialogue replaced: `{"bank": "30", "id": 12, "text": "..."}`;
`\n` new line, `{02}` next page, `{03}` end, `{07}` the player's name).

The roster numbers: 0 Alex, 1 Nina, 2 Harry, 3 Kate, 4 Allie, 5 Joy, 6 Brian, 7 Pam, 8 Bob, 9 Beth, 10 Fay, 11 Curt, 12 Mark, 13 Sean, 14 Sammi, 15 Elden, 16 Spike, 17 Emily, 18 B. Coz, 19 A. Coz, 20 Kevin, 23 Luigi, 24 DK, 25 Baby Mario, 26 Mario, 27 Waluigi, 28 Yoshi, 29 Bowser, 30 Wario, 31 Peach (21 and 22 are unused slots).

### How a mod is drawn (so the art comes out right)

1. The hero's frames (`body`) are copied over the character's own frame blocks, **same size, same tile count, same frame
   numbers**, so all 145 match poses and all walking frames line up with the animations.
2. Every pixel is labelled with a region (skin, hair, hat, top, bottom, shoes, racket, outline...) by `web/js/look/label.js`.
3. The `style` and `extras` are drawn, then `touchups`.
4. The regions are coloured with `colours` (each modded character gets its own block of region colours, used by the 3D and HD
   views). The 2D Game Boy picture can still show only 3 colours plus transparent per sprite, so always check the 2D view too.
5. `portrait`, `head` and `photo` are drawn over the game's own faces in the HD layer.

### Loading and testing a mod

* **In the app**: LOOK (in OPTIONS > MENUS & TEXT) > the mods list > **Import a mod file...**, pick the `.json`, tick it on. It is kept
  on the phone.
* **Bundled** (a private build): put the file in `web/mods/` and add its name to `web/mods/index.json`; bundled mods are on by default.
* **Check every place the character appears**: character select (portrait, name), the VS screen, a whole match (serve, forehand,
  backhand, high ball, dive, point won, point lost, from both ends of the court), the HUD head by the score, the results and EXP
  screens, the campus (walk all four directions), and the 3D view as well as 2D.
* The file is validated when it loads (`normalizeMod`); a field that breaks a rule is dropped silently, so if something does not
  appear, check it against the table above.

---

## 6. Brand-new pixel art (frames drawn from scratch)

A mod's body is always one of the two heroes' bodies. A character with a really different shape (a robot, a tall character, an
animal) needs its own frames. The app does not load raw frames from a mod file yet; to have them added, deliver them in **exactly
this form** and the loader can be written to match:

**Match frames** (one folder per character):
* 145 PNGs named `f000.png` ... `f144.png`, each **the same width and height as the original frame with the same number**
  (`manifest.json`: `w`, `h`), drawn from the same 5 views per group, the feet at the same place (the `dx, dy` offsets are kept).
* **Palette indices only**: transparent, and the three greys 85 / 170 / 255 for indices 1 / 2 / 3, following the meaning in
  section 2 (1 light, 2 the character's colour, 3 dark outline). No other colours, no anti-aliasing, no half-transparent pixels.
* Keep the outline (index 3) closed around the figure: the 3D view extrudes the sprite from its outline, and holes show as gaps.
* Keep the racket in the same hand and at the same place as the original frame: the hit timing is fixed by the animation.
* Do not use more pixels than the original frame's tile count allows (`ntiles x 64`); in practice keep inside its bounding box.
* Frames that are copies of other frames in the original (the manifest repeats them) can be copies in the new set too.

**Walking frames**: one PNG per character in the `walk_sprites` layout (rows = frames, columns = 4 facings, 16x16 each, 1 px gaps),
same indices, drawing only the frame numbers whose block is listed in `blocks` (shared numbers get one picture).

**Faces**: the 24x24 portrait and the 16x16 head(s), either as index PNGs in the `faces` layout or directly in the mod `portrait` /
`head` format (which may use full colour).

**Colours**: give the three colours for index 1 / 2 / 3 as `#rrggbb`, and if the character should be recoloured by region (shirt,
shoes...), a second set of PNGs of the same frames painted with one flat colour per region, with a key, so the region map can be
made from it.

### HD sprite packs (high-resolution redraws, in full colour)

A hero's frames can also be redrawn at a much higher resolution in full colour and shown in their place (SPRITES: HD), in the
2D view and as the player card in 3D. The game still picks the frame; the pack answers by the frame it shows, and a frame the pack
lacks keeps the game's sprite. Deliver one sheet per shot list (the hero's frames laid out by pose and view, made from your own
ROM), each drawing where the game frame sits, on flat magenta (#FF00FF), at 2x the shot list's size or more, the feet on the game
frame's feet, the red team-colour parts (cap, collar, shoes, racket frame) in red only. `tools/cut_hd_sheets.py SHEETS cells.json`
cuts the sheets into `web/hdpacks/<hero>/` (atlas, team-colour mask, pack.json keyed by each frame's ROM offset) and writes
`out/hd_check_<hero>.png`, each picture over the game frame it replaces. `web/tests/hd_sprites.mjs` shows them in the game.
The packs are private art of the game's characters: `web/hdpacks/` is gitignored and left out of the shareable builds.

---

## 7. Rules that keep the game working

* Never change a frame's size or tile count, the number of frames, or the order of the frame numbers: the game's tables point at
  them by position.
* Only 3 colours plus transparent per sprite in the 2D game picture.
* Names: at most 9 characters (the game's name field), printable ASCII only.
* A character's stats in a mod keep the game's total: a mod changes the style, not the difficulty.
* In online games, mods and custom looks are switched off on both phones (both games must be identical), so a mod character only
  appears in single-player.
* Art made from the cartridge's graphics, and the exported sprites themselves, stay private: they are never committed to this
  repository or published.
