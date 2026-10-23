# MTenn3D — full changelog (every version)

**0.35.24 is the shareable build: it contains no game data** (it does carry a little surprise for the [REDACTED] and the [REDACTED]; 0.35.25 is your own build with the ROM inside: keep it on your phone). On first start, tap the file box and pick your
own legal dump of *Mario Tennis (USA)* for Game Boy Color (`.gbc`, SHA-1 starting `414ba583`). The app
checks it, keeps it on the phone (never uploaded), and starts with it by itself after that. Builds up to
0.24 were private builds with the ROM inside; keep those to yourself. Newest first.

## Known issues (as of 0.35)
- Next week: the second half of the story scripts in the JS port, practice mode (a ball machine on any court) and a check of doubles in 3D (a recording of a doubles match would help).
- Characters fading during power shots, and a slight blur at the start of a match: not reproduced yet; a screenshot or a timestamp in a recording would help.
- Practice courts: a player rallying there who is also a [REDACTED] classmate can switch colours between strokes (their swing frames are not part of the mod yet).
- The instant replay is not available yet when the JS port runs the game (CODE: PORT).
- The cafeteria's seated people were set up without a recording of them sitting: tell me if anyone still sinks into a seat.
- The shared builds run the game on the built-in interpreter (slower than your private build); set LIGHT
  quality to Low (or BATTERY: saver) if a phone struggles.
- Enhanced physics only applies to matches (not mini-games or drills).
- Recordings made with a custom look before 0.18 no longer replay exactly.

---

## 0.35 — stadium adverts and grander big-match intros
- **Stadium adverts:** the boards along the stands carry Mushroom Kingdom adverts instead of plain coloured blocks.
- **Grander intros for the big matches** (the Island Open and the Dream Matches): fireworks over the stadium, a
  sweep of the camera high round the stands, a big gold title banner, roars from the crowd, and confetti as each
  player walks on. Senior and exhibition matches get a cheer as each player walks on.
- **Players' tunnels:** both players walk out of tunnels in the middle of the side stands, by the net (yours in red
  on your side, your opponent's in blue on theirs), then run to their places.
- **Mods with photos:** an opponent mod can carry a picture for each character, shown as their portrait (in full
  detail with UI: HD), and many more modded characters can now have full-colour portraits.
- **An easter egg** waits in the [REDACTED] and the [REDACTED]. (LOOK > Mods switches it off.)
- 0.35.4: the easter egg got a wardrobe pass (costumes, a bow, a headband, trim on an outfit, new portraits) and a few new lines.
- Character mods can now add a bow, a headband and outfit trim in a colour of their own.
- 0.35.6, the Training Center in 3D: everyone in a room is there the moment you walk in (people the game had not drawn yet are read from the cartridge; this works on every map, so nobody pops in at the edge any more), and the spare signs kept outside the rooms are gone.
- The drills (Wall Practice, the Tennis Machine and the other mini-games) are played in an indoor hall instead of a stadium: no crowd, scoreboard or floodlight towers.
- Wall Practice: the wall stands up right behind the net, with the target arrows on it (they used to float in a corner of the screen).
- The Tennis Machine's robot is back (a character mod had drawn a player over it) and stands as a solid 3D figure.
- 0.35.8: the drill hall's left side is a glass wall in blue frames, like the one beside the Training Center's own courts, with the Training Center's people sitting on benches behind it, watching (the ones you walked past on the way in).
- 0.35.10: the glass is one clear pane with the same shimmer as the Training Center's other glass walls. Clear a drill and the watchers jump up and cheer, while your face pops up cheering beside the result (the match's win face); fail and they groan "oh no", slumped, and your face cries (the lose face).
- 0.35.12: Yes / No choices no longer flicker between the old and the new font: the blinking cursor in front of the word made it unreadable every other blink.
- 0.35.14: a look mod can give a character a match sprite set of their own by borrowing Bowser's (the N64-transfer character), so a [REDACTED] no longer shares a sprite set with another mod character. Until more sets are added, an unlocked Bowser shows that mod character's look.
- 0.35.16: **portrait mode** for phones held upright (a Fold's cover screen, or the inner screen turned): the game sits on top and the controls get a deck of their own below it, out of the picture, with SELECT next to START and MENU / CAM / REC on top. In a match the deck is the court's own pixel art, with a court-lines stick, scoreboard buttons and advert-board SELECT / START; in the Training Center it is the hall's art, with the Tennis Machine's eye as the stick and glass buttons. A and B are tennis balls on both. Elsewhere (the open world, menus) the deck is plain.
- 0.35.16: after a drill, the pop-up beside the result shows your own character's sprite (in your look) instead of a drawn face: a fist pump when you clear it, tears when you fail. With UI: HD, the results screen's win / lose faces show it too.
- 0.35.18: characters are back to the game's own sprites as blocky voxels (SPRITES: Game, view VOX, VOX: Blocky; set once, the buttons still change them), and NET: Even is the default when the JS port runs the game (CODE: PORT, as in your build), so you can walk up to the net from the far side too.
- 0.35.18: training rooms: the drill hall's watchers face the court and sit on the benches instead of inside them; the hall is lit as a room without windows (no time of day, floodlights or weather) and its window wall became panels; its glass and the Training Center's window (now a thin pane, not a thick block) show clearly; the people at the gym machines sit on them; the drill court's floor behind the net no longer smears into streaks.
- 0.35.18: campus: the lamp in front of the Training Center's steps is gone, the person in the courtside bench nook is no longer inside the stand, and swaying trees and hedges no longer open thin dark seams.
- 0.35.18: menus: the EXP screen's names and numbers (the menus' bold font) are in the HD font; in 3D the pause menu's label under the selected icon (MUSIC, RULES...) and its score panel's digits show properly (a digit was taken for the ball's shadow).
- 0.35.18: matches: the camera sweeps round the stadium after every game and every set, whoever wins it; a player's shadow follows the body's shape (a dive casts a long one); in the walk-out intro each player walks on from the tunnel to their place instead of standing still.
- 0.35.18: [REDACTED] characters who are also the junior courts' classmates keep the game's own look in story mode until you win a junior class title; the [REDACTED] heads beside the score are round cut-outs like the others'.
- 0.35.20: a roomier stadium: the side stands, their tunnels and the floodlights stand further back from the court, with more run-off round it.
- 0.35.20: after each point the winner hops twice under turning stars and the loser gets a sweat drop and a grey cloud (on top of the game's own fist pump and slump; MATCH FX).
- 0.35.20: power shots, smashes and special shots put their speed up for a moment ("142 km/h", BALL FX).
- 0.35.20: fans in the stands hold up banners with your name (red) and your opponent's (blue); the fuller the stadium, the more banners.
- 0.35.20: WEATHER has two more kinds: Wet (after the rain: a dark, glossy court with puddles mirroring the sky and, at night, the floodlights) and Wind (leaves blown across the court in gusts, with a low rush of wind); rain now wets the court too, with rings spreading in the puddles. Random picks them as well.
- 0.35.20: open world (FIELD LIFE): fireflies at night, puddles on the ground for a while after a rainy match, people walking along the campus paths (the map's own kinds of people), and the fountains' night glow now shows.
- 0.35.20: [REDACTED] opponents have something to say: a line in a speech bubble during their walk-out close-up (billed as a RIVAL) and a word on the result when the match ends; more of the story's lines were rewritten for the disguises.
- 0.35.22: a rally counter in the corner from the 5th shot of a rally, and the match's stats (points won, aces, winners, errors, double faults, fastest serve, longest rally) in a TV panel at each changeover and after each set, until the next serve (MATCH FX).
- 0.35.22: the court shows the match: ball marks and foot scuffs stay on clay, grass wears brown where the players spend their time (the baselines first), and a hard court keeps faint ball marks and rubber scuffs where a player stops sharply (BALL FX).
- 0.35.32: VS screen faces fixed: your player shows the portrait the game's menus show (the game's own, in your look's colours, or the redrawn one if you chose Redrawn portraits), no longer the old redrawn face; game characters show their front-facing character-select face in their real colours instead of a whited-out back of the head.
- 0.35.31: trees closer to an HD-2D diorama: round trees are a dark core covered in sunlit leaf lobes with shadowy gaps between them, some in a sunny yellow-green; cypresses are a deeper, cooler green; shrubs are lobed mounds; every tree and shrub casts a stepped shadow on the lawn and the path beside it. The match stats panel at changeovers now goes after 4.5 seconds (a tap or the serve still hides it sooner).
- 0.35.30: the round trees are spikier: every clump is covered in small pointed leaves tilted every way, giving the crowns a jagged leafy outline, and a finer leaf texture.
- 0.35.29: **round trees** (TREES: Round / Leaves, Round by default, with GROUND on Tufts or Carpet): trees and shrubs with crowns of overlapping leaf clumps in chunky pixel leaves, lit yellow-green on top and deep green below; tall narrow trees become cypress cones, bushes become low mounds, some of them in pink or white flower.
- 0.35.28: the walk-out intro now plays for every match: it was skipped when you quit a match and started the next one within about 10 seconds.
- 0.35.27: GROUND has a fourth choice, **Gemini**: the look Gemini made (small swaying 3D grass tufts on about a quarter of the lawn, tree crowns in lobes, and greens cooler in the shade and warmer in the light).
- 0.35.26: **the overworld in detail** (GROUND: Pixel / Tufts / Carpet, Carpet by default): a dense, short turf of fine strands with a few taller clumps, cut in mowing stripes on the school grounds (courts, plaza, school entrance, dorm) and left rough beyond them; trees and shrubs as crowns of many small sunlit leaves; paths with a soft sandy surface, a lighter worn middle, fine grit and raised brick edging. Grass sways in the wind and parts as you walk. **VS screen:** the players' faces close up (VS: Faces / Body).
- 0.35.24: a momentum bar under the scoreboard swings towards whoever is winning the points; three in a row puts ON FIRE on their side, the crowd roars louder with each point of the streak, and the court camera leans in a little as the momentum builds (MATCH FX).

## 0.34 — replays, weather and a better grass court
- **Instant replay:** after a rally of 5 shots or more a REPLAY button shows for a few seconds; tap it to watch the
  point again from a TV camera above the stand, then the match carries on exactly where it was (tap to skip).
- **Pause menu:** while paused in a match the camera cuts between TV shots of the court and the crowd.
- **Crowd claps** in rhythm before big points (and now and then) until the serve.
- **Weather** (STADIUM > WEATHER): Clear, Rain (rain over the court, an overcast sky and the sound of it), Sunset,
  or Random for each match. The look only: the game plays the same.
- **Grass court:** repainted: soft mowing stripes and a fine lawn instead of the noisy stretched pattern.
- **Victory screen** waits for A (B or a stray tap no longer skips it; it ignores presses for its first second).
- **Menus:** the smoothing over menus and character pictures is off: the game's own pixel art again.
- **NET: Even** (GAME menu): the original game stops the far-side player further from the net than the near side;
  Even lets both sides come equally close. Runs through the JS port (no run-ahead with it).

## 0.33 — one campus, match atmosphere and phone extras
**The road and the courtyard**
- **Joined up:** the side-view road and the courtyard are drawn as one place. From the courtyard you see the road,
  its trees and the cafe beyond it in 3D; from the road you see the courtyard in front. The road's path runs
  straight into the courtyard's, the same width, colour and grey stone edging, and the grass is the same all round.
- **No more white flash between them:** walking from one to the other keeps the picture on screen while the game
  loads, then the camera glides into the next area.
- **Courtyard building:** a pitched roof with eaves, and plain side walls with a drainpipe and a vine.

**Night**
- **Lamps** on the junior and senior courts (brighter, to light the courts) and along the paths of the other
  outdoor areas.
- **No white glow** around people standing on pale courts at night.
- **Floodlights** stand behind the corners of the stands.

**Inside**
- **Cafeteria:** the chairs are proper seats (people sitting in them sit on top instead of sinking in), the food
  trays and the ketchup and mustard dispensers stand on the counters, and the smaller cafeteria is in 3D too.
- **VOX characters** are Blocky again by default (Rounded is still on the VOX button).

**Matches** (STADIUM > MATCH FX)
- **Set and match point:** the crowd hushes before the point, and roars again when a set is won.
- **Long rallies:** from the 10th shot the crowd goes "ooh", louder the longer it lasts.
- **Changeovers:** the camera sweeps slowly round the stadium while the players change ends (any button ends it).
- **The end of the match:** the camera circles the winner, two big cheers, and confetti.
- **Scoreboard** shows both players' names.
- **Stats panel** in the intro shows your own play style next to your level.
- **No blur on the players** at the start of a match (the tilt-shift keeps both baselines sharp).

**Overworld** (VIEW > FIELD LIFE)
- Birds cross the sky now and then, cloud shadows drift over the ground, and fountains glint by day and glow at night.

**Phone** (GAME menu)
- **VIBRATE:** a short buzz when you hit the ball, a longer one when you win a point.
- **SHOT:** saves a picture to Downloads/MTenn3D.
- **SAVE 1 / 2 and LOAD 1 / 2:** quick save slots for the exact moment.
- **BATTERY: saver:** the 3D view at 60 fps and low-quality lighting.
- **WHAT'S NEW:** this changelog, in the app.

## 0.32 — overworld 3D fixes
- **Dorms:** the blue boy's dorm has its own furniture layout instead of borrowing the other dorm's. The dorm fence
  is thinner and the gate posts are brick.
- **Benches** on the plaza and the club maps sit flat on the ground instead of standing up like signs.
- **Glass room (map 17):** the desks, chairs and computer screens show through the blue glass.
- **Side-view road:** no white lines in the sky, the sky follows the time of day, stars and moonlight at night,
  and no clouds at night.
- **No more pop-in:** people the game hasn't drawn yet (off the Game Boy's screen) are shown in their places, so
  nobody appears or disappears at the edge of the old screen.

## 0.31 — the intro in VOX
- **VOX mode intro:** the walk-ins and the run-on now show the voxel characters (Rounded or Blocky, whichever you
  picked) with the game's walking and running animation, instead of gliding.

## 0.30 — walk-ins, stats by the head, side menu
- **Intro close-ups:** you, then your opponent, walk in towards the camera along your sides of the court with the
  game's own walking animation, and your stats panel rides along beside your head (right of yours, left of theirs).
- **Side menu:** on the phone, Back now opens the menu as a column down the left-hand side: VIEW, STADIUM, LOOK,
  GAME and REC; a tab opens its buttons right under it.

## 0.29 — the full match intro, crowds that grow, a tidier menu
- **The intro, start to finish:** the crowd pan; your close-up and your opponent's, each with a small stats panel
  (level, play style for the opponent, and bars for power, spin, speed and control); a **VS screen** with you at the
  top and your opponent at the bottom in your waiting-for-serve stance, over a moving background (stripes, rays,
  tennis balls or energy, picked at random each match), a fire line and a VS badge. It splits open along the line
  onto the court: READY? while you both run on with the game's own running animation, then the umpire blows the
  **whistle** and PLAY! starts the match. The opponent's plate shows their class and play style.
- **Crowds grow as you progress:** nearly empty at your first junior practice match, a little fuller with every
  tour match, packed for the Island Open and the dream matches. Exhibition matches are always full. (LIGHT panel:
  the sliders now set the first match, the finals and exhibitions.)
- **Tidier button bar:** Back now shows one short row of tabs: VIEW, STADIUM, LOOK, GAME and REC. Tap a tab to
  open its buttons, tap it again to close.

## 0.28 — both players in the intro, original faces
- **The intro shows you and your opponent:** after the crowd, a close-up of you by the left stand with your
  name plate (your name, the class and the match), then your opponent by the right stand at the far end with
  theirs, then you both walk onto the court.
- **Original faces for the [REDACTED] characters:** the redrawn face pictures (score pop-ups, results,
  character select) are gone; those characters show the game's own artwork again. Their looks on court, colours
  and names stay. Your own character keeps your custom look.

## 0.27 — your test video, run-ahead
- **Score pop-ups fixed:** "0-15", "NICE!" and the other pop-ups slide in smoothly and land in the middle of the
  screen. They used to get stuck to a player as they passed and show up on the court beside them.
- **Stadium scoreboard:** now shows sets, games and points, with deuce, advantage and tiebreak scores right.
- **The umpire is back:** the game's own umpire sits on the 3D chair, and the blurry patch behind the chair is gone.
- **Text boxes:** your character no longer shows on top of the text when you walk in as a box opens.
- **READY? / PLAY!** use the game's own pop-up lettering, and the court music keeps playing during the intro.
- **No more half players:** the far player near the top of the screen used to lose their head and shoulders
  (the game doesn't draw what is off its own little screen); the whole body now always shows.
- **Night:** street lamps along the paths of the main plaza that glow and light the ground, and floodlight beams
  from the stadium towers down onto the court (with corner lights).
- **Crowds:** Junior courts are sparser still (8% of seats).
- **RUN-AHEAD (new button, off by default):** what you press shows one frame (17 ms) sooner. The game itself is
  unchanged (a whole 7-minute recording plays back identically with it on and off). It runs the game twice per
  frame, so turn it off if a phone struggles. Original code only (not the "JS port" modes).

## 0.26 — walk-out intro, crowds by class
- **Walk-out intro before each match (INTRO on/off, 3D stadium):** the camera sweeps low along the stand,
  pushes in on your player under two spotlights with a name plate (Junior Class / Senior Class / Island
  Open, and the kind of match), then watches from high behind the court as both sides walk to their places:
  READY? PLAY! The crowd cheers as the player is shown. Tap anywhere to skip. The game waits while it plays,
  so nothing about the match changes.
- **Crowds grow with the class:** Junior courts are now sparse (12% of seats), Senior courts busier (45%),
  the Island Open and finals packed. The intro uses the same crowd. (If you moved the crowd sliders in LIGHT,
  your own values are kept.)
- **Missed in the 0.25 notes (already in 0.25):** the overworld court nets are see-through mesh with the court
  lines running on under them (please check them in your videos), and a saved state from an older version no
  longer crashes the game when a custom look is on.

## 0.25 — shareable build, crowds, full LIGHT control
- **Shareable:** no ROM inside. Pick your own *Mario Tennis (USA)* `.gbc` on first start (the Android file
  picker now opens from the app); it's remembered and the game starts by itself next time.
- **Hand-pixelled hair on the game's portraits:** every hairstyle you can pick now has its own drawing on
  Alex's and Nina's portrait, win/lose faces and HUD head, in the game's own style, in your colours.
- **Crowds of random fans** in the 3D stadiums, built from the game's own character sprites with random
  skin, hair and shirt colours; they hop and cheer after a point. Junior courts draw a smaller crowd than
  Senior courts, and tournaments and finals are packed.
- **Crowd sounds (CROWD SOUND on/off):** a cheer when a player or team scores, an "awww" on a fault or when
  someone is hit by the ball, and a fence rattle when the ball hits the back fence or gate.
- **LIGHT settings panel (tap LIGHT):** overworld time of day (Off / Day / phone clock / Custom slider),
  match lighting (same as overworld / Day / Night / **Random**: each match rolls morning, noon, sunset or
  night), toggles for shadows, glow, tilt-shift, vignette and night lights, quality (Auto / Low / Medium /
  High), and crowd size per class. Everything is remembered.
- **HD court floors (FLOOR):** hard courts get a fine grain and sheen, clay gets sweep arcs and scuffed
  baselines, grass gets mowing stripes and worn patches, and the special courts a glossy checker. They
  stay vivid under the new lighting and the lines stay exact.
- **Glass and windows:** the first building's glass is now thin glass walls instead of blocks; the
  computers, desks and chairs behind it are drawn solid. Every window shimmers with a soft sweeping
  highlight by day.
- **Decompiling:** the twins' scenes now run as JavaScript, verified against the original game. About
  3,200 routines are now ported and verified; story part 2 is ported but not switched on yet.

## 0.24 — your 3D fixes, real night
- **Text boxes no longer move people:** in 3D, characters used to slide back while a dialogue box was open
  and jump back when it closed (the HD menus mistook their sprites for menu arrows). Fixed on every map.
- **Now 3D (from your screenshots):** the iron fence and brick gate in front of the school, the chain-link
  fences at the back of the court areas, the plaza statue, and the first building's blue panels, which
  are now see-through glass with the pink chairs and desks standing behind them.
- **Net and umpire-chair blur gone:** the ground under the overworld court nets and chairs is cleaned.
- **Night lighting fixed:** nights are now dark blue-grey with dim stands, a warm-white floodlit court
  that is clearly darker than noon, moon shadows, and glow only on the floodlights and bright windows
  (no more bright cyan wash). Sunset and dusk were re-balanced too.

## 0.23 — 3D stadiums, working shadows
- **3D stadiums — "STADIUM: Classic / 3D"** (3D / VOX, default 3D): stepped side and far stands with
  seat rows and a crowd of ~1150 fans that jumps and cheers when a point is scored, a thick back wall,
  rounded hedges and flower boxes, a dot-matrix scoreboard with the score, floodlight towers that line
  up with the night floodlights, and a real 3D umpire chair with the umpire. Colours follow each court.
- **Shadows now actually work with LIGHT:** a typo had switched off the shadow and tilt-shift blur
  passes in 0.21 and 0.22. Players, ball, net, umpire chair and stands now cast sun shadows on courts,
  and buildings, trees and characters on the overworld.
- **Rounded characters in the overworld** are slimmer from the top-down camera, so heads and hair read
  like the sprite instead of stacked cylinders.
- **Enhanced physics:** the CPU now predicts the real curved path and bounce of the ball (it used to
  assume straight lines), so its returns stay as good as in Classic.
- **Decompiling:** story scripts part 1 finished — all 29 files of the first half of the story now run
  as JavaScript, verified against the original game (about 175 new test scenes).

## 0.22 — game portraits, rounded characters, Enhanced physics
- **Portraits back to the game's own art:** Alex and the default boy/girl portraits, win/lose faces and
  scoreboard heads are the default again, recoloured to your look (skin, hair, hat, top). Highlights on
  deep skin tones use a warmer, brighter brown. The redrawn portraits are still there behind
  "Portraits: Game / Redrawn" in the Appearance panel (default Game); face options and HD 96px portraits
  only apply with Redrawn. New hairstyles stay on the in-game sprites.
- **"VOX: Blocky / Rounded"** (VOX only, default Rounded): characters are one smooth rounded figure
  (thickest at the body and head) instead of stacked cubes, with exact pixel colours on the front, a
  shaded back, and soft shading under LIGHT. Works with Sprites: Detailed.
- **"PHYSICS: Classic / Enhanced"** (default Classic, which stays exactly the original): Tennis Elbow-
  style ball flight with air drag and real spin curve, and court-specific bounces (clay grips, grass skids,
  topspin kicks up, slice stays low). Balls still land where the original game puts them, so in/out,
  net calls and scoring stay the game's. Changing it reloads the game; recordings remember the setting.

## 0.21 — lighting and ball effects
- **Elliot-style lighting — "LIGHT: Off / Day / Auto"** (3D / VOX, default Off)
  - Sun and moon shadows from buildings, trees, the net, umpire chair, characters and the ball; they move
    with the time of day (long in the morning, short at noon, long the other way at sunset).
  - Warm sun and cool shade, colour grading by time of day, glow on bright highlights, soft vignette and an
    HD-2D tilt-shift blur at the top and bottom of the view.
  - Night: building windows glow and light the walls, fountains get a cyan light, courts get floodlights.
  - Indoor rooms keep a warm indoor light at any hour. Menus, dialogue and buttons are never lit.
  - Day = a bright afternoon; Auto = follows your phone's clock. Lowers its own quality if the phone
    can't keep up.
- **Ball effects — "BALL FX: on/off"** (3D / VOX, default on)
  - Trail on fast shots coloured by shot type (topspin amber, slice cyan, lob green, drop pink, smash red;
    power shots stronger; serves gold/cyan/white).
  - Spin seam on the ball, squash on bounces, stretch at speed.
  - Court dust matching the surface (clay clouds, grass flecks, hard-court puffs).
  - Small, quick contact flare and sparks (bigger for power shots and smashes) that never cover players.
  - Net wobbles when hit or clipped; the ball shadow sharpens as it lands; big hits briefly light the
    court when LIGHT is on.

## 0.20 — side-court fix and detailed sprites
- **Fixed:** the students playing on the side courts no longer show as half sprites in 3D / VOX; students
  the original game hides off-screen are drawn too, so all 8 players show in the wider 3D view.
- **New "SPRITES: Game / Detailed"** (default Game): every character redrawn from its own sprite at 3x,
  same shape and colours plus outline, shading, highlights and glints. Faces with expressions: effort when
  swinging, happy after a point won, sad after a point lost, occasional blink. Works in 2D, 3D and VOX;
  detailed preview in the Appearance panel.

## 0.19 — 120 fps
- **120 fps smoothing (3D / VOX):** the view is drawn at every screen refresh (up to 120 per second) with
  players, ball, shadows, camera and overworld characters moving smoothly between game frames. The game
  still runs at normal speed. Teleports and scene cuts snap instead of smearing.
- **"SMOOTH: on/off"** button next to CAM (default on); off removes the ~17 ms smoothing delay.
- FPS readout in 3D shows both: "game 60 · view 120 fps".
- **Fixed:** with UI: HD, your created character keeps their look colours on every menu screen.
- **Decompiling:** story scripts part 1 (29 story files) converted to JavaScript; 12 verified and switched
  on (island sky and fireworks, challengers, coach lessons and walks, gym, endings and more). Small
  exactness fixes in character select, character data and scene screens.

## 0.18 — HD menus and new characters
- **HD menus — "UI: HD / Game"** (next to FONT, default HD)
  - Every menu and dialogue box redrawn as a rounded panel with bevel, inner border, sheen and soft shadow;
    smooth HD text; smoothed cursors and arrows.
  - New title screen: the logo with "HD-2D" underneath and a PRESS START bar (2D and 3D/VOX).
  - Pause menus, rules, drill briefings, match stats, results, ranking boards, character data, skill
    points (glossy stat bars), EXP pages and mini-game HUD in HD.
  - 22 menu icons redrawn as sharp vector icons; MORE / BACK buttons redrawn; name-entry grid lined up.
  - "UI: Game" gives exactly the old look.
- **Characters (Create a Character)**
  - Hero portraits redrawn, with normal, win and lose faces and in-match heads.
  - Face options: face shape, eyes (6), brows (3), mouth (4), freckles, glasses, blush.
  - New hairstyles: afro, afro puffs, cornrows, locs, box braids, fade — on portraits and sprites.
  - 12 skin tones (8 deep or warm browns), 16 hair colours, new presets (Afro, Locs, Rows, Puffs, Braids).
  - 96x96 HD portraits when UI is HD.
- **Decompiling:** the last menu screens (equipment, tennis dictionary, mini-game select, debug, link)
  run as JavaScript, all verified exact.

## 0.17 — 120 Hz display
- Asks the phone for its highest refresh rate (120 Hz); the court camera and ball already blended between
  game frames. The game itself still runs at normal speed.

## 0.16 — Senior Class [REDACTED] pack
- Senior Class [REDACTED] characters (private pack; LOOK → Mods to switch off): [REDACTED] replaces [REDACTED]
  (final boss), [REDACTED] replaces [REDACTED], [REDACTED] replaces [REDACTED], [REDACTED] replaces
  [REDACTED], [REDACTED] replaces [REDACTED], [REDACTED] replaces [REDACTED]. New overworld and match
  sprites, hand-drawn portraits, scoreboard heads and names. Matches play exactly as the original.
- New general opponent-mod system: switch mods on/off or import them in LOOK → Mods; recordings keep the mod.

## 0.15 — character creator
- LOOK → Appearance: boy or girl; hairstyles (cap, headband, ponytail, short / pigtails, cap, bob,
  ponytail); separate colours for skin, hair, hat/band, top, shorts/skirt, shoes and racket; presets;
  left-handed option; live preview; prompt on Pick a Character.
- Shows everywhere you appear (overworld, court, portraits, scoreboard) in 2D, 3D and VOX; nobody else
  changes colour. Saved, and kept in recordings.
- Phones: the button bar starts hidden; swipe Back (or press Back) to show or hide it.

## 0.14 — 3D overworld
- VOX is now the default view.
- The connecting world (road and café between the courts) rebuilt in 3D with sky and grass to the horizon.
- Fountains with a water jet, ripples and animated pool water.
- Flowers stand up and sway; trees, bushes, palms and potted plants are 3D and sway on every map.
- Hedges and map-edge foliage are rounded 3D; umbrellas are real 3D umbrellas; edge palms stand up.
- Clean ground under all of these; map changes are much lighter.
- CODE: PORT mode also runs the match engine and the EXP, results and ranking screens as JavaScript.

## 0.13 — HD text polish
- No outline around HD text in 3D.
- CODE: PORT mode runs the pause, briefing, court select and scene menus as JavaScript.

## 0.12 — exact port recordings
- Recordings made in CODE: PORT mode replay exactly (logged from power-on).
- Character select and character data menus run as JavaScript in PORT mode.

## 0.11 — HD fonts
- FONT button: Game / Itim / Kode Mono — the game's text redrawn in a smooth HD font.
- More of the game runs as JavaScript in PORT mode: text engine, shared menu code and main menu,
  mini-games and drills.

## 0.10 — CODE button
- In-game CODE button: original game code / JS port (finished parts) / JS port (every part).
- Converted to JavaScript and verified: sound driver, bank-0 math, graphics and memory, save system,
  cutscenes, system code and the story-mode engine.
- The 3D view's fixes from your overworld recording; the page remembers the ROM and the mode.

## 0.8 — fixes from your first recording
- Fixes found in your recorded session; credit for the community disassembly the project builds on.
- (Behind the scenes, the exact JavaScript match engine was being built at this point.)

## 0.7 — recordings
- REC button: saves the start state plus every button press, so a session can be replayed exactly.

## 0.6 — menus with depth
- Every menu screen gets static layered depth in 3D.

## 0.5 — 3D fixes from play
- Ball no longer jumps at the net; HUD scaled and kept clear of the controls; no fake dialogue boxes while
  walking; stable court colours.

## 0.4 — 3D overworld objects
- 3D objects (buildings, trees) on every RPG map; dialogue boxes at the top middle of the 3D view;
  analog stick.
- 4:3 screen shape with an unstretched wide 2D court.
- Tour-mode fixes: save flushed on pause, side-view maps, map bounds.

## 0.3 — MTenn3D
- App renamed MTenn3D.
- 3D view: stadium bleachers beside and behind the court, inflated voxel bodies, smooth display-rate
  movement; captions as a screen overlay.

## 0.2 — 3D view
- 3D diorama of the match: court plane, players and ball from the game's own coordinates (ball at its
  true height with a shadow), net, umpire chair and stands standing upright, locked camera presets
  ("Low" default), pinch zoom.
- 3D RPG areas: the whole map floor, walls and buildings extruded, characters standing up.

## 0.1 — first build
- The full game running on a Game Boy Color emulator written in JavaScript, with the game's code
  translated ahead of time for speed.
- Touch controls (floating d-pad / stick, A, B, START), controller support, full-screen, any orientation,
  save games kept on the phone.
