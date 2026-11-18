# Block Party UI and cameras (plan)

**Status:** the user's spec, 2026-11-17, written down for the session that builds it. Built so far
(pass 6 of `block-party.md`, 2026-11-17): the dialogue box with its buttons, steering and voices,
the skip strip (names for now, heads later), the NPC pans and cuts, and the pre-game shots (intro,
podium, order rolls and reveal, Star reveal). The rest isn't built yet. It is the content of pass 10 in `block-party.md` ("Refinement: cameras and UI"), and
it replaces that plan's hotbar: the board can't use the hotbar for its controls, because minigames
need the hotbar for their own items. Everything the board shows moves to JSON UI the game draws
itself, steered with the movement keys, jump and sneak.

The user may build a tool for editing JSON UI (beside the workshop's `json-ui` previewer), so each
screen's look is kept in files such a tool can own ("How the HUD gets its data").

The user answered the first open points the same day (the cards' reference picture, the dice,
the colors, losing, the results font, settings by command, own animations, device prompts, no blur,
no chat), and the workshop's dialogue tool gained what this UI reads: each moment's delivery, skip,
cutscene and camera, each line's actions, and the sound map ("The dialogue tool's data").

**For the session that implements this:**
- Read `block-party.md` first (the game, its passes and the spike results it points to), then this.
- Work in a worktree (`CLAUDE.md`). Stop and report after each part of "Build order" with a list of
  what to test, and commit and push each part, with no attribution.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- **No icon art.** Lay the screens out with placeholder letters where icons go (S for a Star, C for a
  coin, the rest in "Icons"). Never draw an icon texture: the user adds placeholder images
  themselves. Models in the world (the die, the gain and loss pops) use vanilla textures as stand-ins,
  as the old bar did.
- Never make a map thumbnail or a game picture (`CLAUDE.md`, "Also").
- Everything the game says is a line in the user's dialogue file, said with `line(id, fills)`
  (`block-party.md`, "Dialogue"). How each line shows, what plays during it, and every sound come
  from the same tool ("The dialogue tool's data").
- Run the item in "Checks first" that a part depends on before building that part.

## What changes

| Before | Now |
|---|---|
| The pack's own hotbar bottom right (Items, Dice, Tests), picked by scrolling and number keys | The board menu top left (Dice block, Items, Board), steered with the movement keys, picked with jump |
| The Items and Dice bars | The item panel bottom left, one item or die at a time |
| Standings top left, each player's line top right | Player cards top right |
| Chat for much of what the game says | The dialogue box bottom middle; vanilla chat hidden |
| The Tests menu on a compass in the bar (with the spike's walk settings) | `/blockparty:tests`, and settings out of the HUD (`/blockparty:settings`) |
| Results as titles and chat | The results screen |
| The roulette in titles, the loading screen's fade | The minigame announcement |
| Skip and ready counted as x / y | Skip and Ready with the voters' heads |

## Everyone sees the same

On the board every player sees the same thing: the same camera, the same cards, and the active
player's menu, item panel and choices, including which dice and items they have. Only the player
whose turn it is (or who an NPC is talking to) can steer them. The exceptions are each player's own
button prompts ("Button prompts") and, in a minigame with sides, each side's own tutorial.

Choices that are forms today (a branch, an item's target, the Star offer, the shop) only show to
the one player, so they should move into these screens: the dialogue box's buttons for offers and
the shop (the user's spec), and the item panel's style for picking a player (proposed). A branch
is proposed as the camera showing the paths with their arrows, left and right picking one, and jump
going.

## Controls

- **Steer:** the movement keys (W, A, S and D, a controller's stick, a touch screen's pad), read
  with `player.inputInfo.getMovementVector()` (in @minecraft/server 2.11.0). A step is the vector
  leaving the middle past about 0.5; holding it repeats after a moment (proposed: 0.4 s, then every
  0.15 s).
- **Select:** jump (`playerButtonInput`, as now). When the active player selects, their piece really
  jumps on the board (the user asked), so jump stays unlocked.
- **Back:** sneak. Sneaking is fine here: players stand on the board, they don't fly (the "no sneak
  controls" rule is for the editor's creative flight).
- **Steering never moves the piece:** walking stays locked (`lock()` in `pieces.ts`), and "Checks
  first" makes sure the vector still reads under that lock.
- On the board players can punch, jump and sneak freely but not walk, and nobody can hurt anybody
  (no damage, no knockback) outside minigames.

### Button prompts

Where the UI says what to press (Skip, Ready, the tutorial's controls), show the player's own key or
button if the game can tell what they play with; if it can't, show words (Jump, Punch, Use, Sneak).

- Bedrock text has tokens that draw the viewer's own key or button for an action, such as
  `:_input_key.jump:`. The client draws them, so one line shared by everyone would show each player
  their own. Check it works in HUD text ("Checks first").
- Failing that, the game picks the prompt itself:
  - **What they're using right now:** the script knows each player's last input mode
    (`player.inputInfo.lastInputModeUsed`: KeyboardAndMouse, Gamepad, Touch or MotionController).
    Keyboard and mouse gets keys, a controller gets buttons, touch gets words.
  - **Which controller:** the script can't tell (`clientSystemInfo.platformType` says only
    Console, Desktop or Mobile), but the watcher can: the player list it already reads for skins
    (`watcher/watcher.ts`) carries each player's device (`build_platform`: PlayStation, Xbox,
    Nintendo Switch, Windows, Android, iOS and so on). The watcher saves it per player beside their
    skin; how a game server gets it (with the build, as the skins list does, or while running) is
    for this pass to settle.
  - **The Panel's Players page** (the user asked) shows each player's device and lets it be set by
    hand, which wins over the detected one: for a player the watcher hasn't seen, or a PC player on
    a controller.
  - **Default** (the user): a console player is taken as Xbox; keyboard and mouse shows keys.

## Look

- **Fonts:** MinecraftTen (`font_type`) only where the user named it: the board menu's buttons, the
  tutorial's minigame name, the results screen's title and places, and "Minigame!" in the
  announcement (nothing else in the announcement). Everything else is the regular font.
- **Highlight** (the turn color), Minecade's blue `#48C0F0` (the Panel's primary): behind a card on
  its player's turn, and behind a selected dialogue button. **Secondary highlight**, Minecade's
  orange `#F5913C`, semi-transparent (proposed: 45%): behind a selected board menu button. Both in
  one place, so they're easy to tune.
- **Panels:** fully transparent or a very light black (proposed: 25%) unless a screen says
  otherwise.
- **Color codes** (`§`) work in HUD text (the action bar and titles), so dialogue can be colored.
  They don't work in script forms (`CustomForm`): never use them there.

## Icons

**Inline icons** (a Star or a coin inside a dialogue line) are characters of a glyph page of the
pack's own, so they draw in any HUD text (proposed: `font/glyph_E1.png`). Until the user draws it,
the code puts the icon's letter in its place, in yellow (proposed), from one table of tokens
(`{star}`, `{coin}`, ...), so switching to the glyphs is one change.

**Icons in panels** each have an id, a letter and a picture path. The generator draws the letter
while the picture isn't in the pack, and the picture once the user drops it in (rerun the
generator). Proposed letters and paths:

| Icon | Letter | Picture the user adds |
|---|---|---|
| Star | S | `textures/blockparty/ui/star` |
| Coin | C | `textures/blockparty/ui/coin` |
| Items | Stone Totem ST, Golden Totem GT, Ender Pearl EP, Cursed Totem CT, Dueling Glove DG, Lightning Strike LS, Zombie Spawn ZS, Iron Golem IG, Villager V | `textures/blockparty/ui/items/<id>` |
| Dice | Standard D, Slow SD, Triple TD, Risk RD, Golden GD, Mystery MD, Cursed CD, the test One Die 1D | `textures/blockparty/ui/dice/<id>` |
| A die's face | its number | `textures/blockparty/ui/dice/<id>_<face>` |
| Chevrons | `<` and `>`, yellow, regular font (the user's call for now) | |
| Player heads | see "Player heads" | |

## Player cards (top right)

- One card per player, in turn order: first on the left, last on the right, against the screen's top
  right.
- Shown on the board and the podium, never during minigames.
- **Revealed one by one** in the turn order reveal ("Cameras"): each card appears as its player is
  shown. The row holds every seat's place from the start (invisible stand-ins for the cards not shown
  yet), so nothing shifts as cards appear. Seats are the game's players, 2 to 4, bots included.
- **A card:**
  ```
  +----------------------+
  |        | S 3         |
  | [head] |             |
  |        | C 12        |
  |----------------------|
  | 1st   [ST] [EP]      |
  +----------------------+
  ```
  - Left: the player's head, a 2D picture ("Player heads").
  - Right, two rows: the Star icon with the count, then the coin icon with the count (0 shows as 0).
  - Under both, a thin line across the card, always there (as in the reference picture), and under
    it a row: the player's place (1st to 4th), then a tiny icon for each item they hold. A player
    with no place yet and no items has no row (proposed: no places until the first standings after a
    minigame; tied players share a place).
  - Background: transparent or a very light black; filled with the highlight color while it's that
    player's turn.
- When coins or Stars change, the number steps to its new value with the gain or loss pop over the
  piece ("Gain and loss").
- **The reference picture** (the user's, from another party game; not in the repo):
  `C:\dev\minecade\assets\block-party\player-cards-reference.png`. Four cards spread evenly across
  the top. Each: a round portrait in a white ring on the left; to its right the Star icon over the
  coin icon, each with its count right-aligned (the Star count bigger and bolder); a thin white line
  under the card from the portrait to the numbers; no box around it. The card whose turn it is is
  filled with a solid color behind all of it. Ours is a plainer, more Minecraft take: the 2D head
  in place of the portrait (a ring is a picture the user can add over it, since JSON UI can't cut a
  circle), placeholder letters for the icons, the place-and-items row under the line.
- The cards and the board menu must not meet on the narrowest screen ("Checks first").

## The board menu (top left)

- Three buttons: **Dice block**, **Items** and **Board**. Proposed as a column, so it never runs into
  the cards on a narrow screen; every movement key steps through it either way.
- Shown to everyone on the active player's turn, until they roll.
- Text in MinecraftTen, semi-transparent, with no background behind the menu. A button has no
  background until it's selected, then the secondary highlight.
- **Disabled** (dimmer text, steps skip it): Items while the player holds no items. Dice block
  always opens (the user): with only the standard die, the item panel shows it with no chevrons.
- **Jump:** Dice block and Items open the item panel for dice or items. Board isn't decided yet:
  proposed, the board overview camera to look the board over (where the Star is, where everyone
  stands), sneak back. An open point.
- Opens on Dice block (proposed). Sneak here does nothing.

## The item panel (bottom left)

Opens from Dice block or Items. While it's open the camera is the player's turn shot, on the active
player.

```
       [icon]
  <  Golden Die  >
  [5][6][7][8][9][10]     a die's faces, or for an item, what it does
```

1. **The icon** of the die or item showing now (its picture or letters).
2. **The name** between two chevrons, `<` and `>` in yellow in the regular font. The chevrons stay
   where they are whatever the name's width: fixed slots, the name centered between them. Behind the
   row, a black gradient, darkest in the middle and fading out to both sides. Proposed without a new
   texture: a row of black strips whose alpha steps down from the middle; a gradient picture if the
   steps show.
3. **What it does:** for an item, its description; for a die, six tiles, one per face, each showing
   the face (its number for now). Dice whose faces do more (Triple, Mystery, Cursed) show numbers
   for now; the user will settle those later.

- **Steer:** A and D (left and right, the chevrons' way) step through what the player holds; W and S
  step too. Wrapping round at the ends (proposed).
- No chevrons when there's only one choice.
- **Jump uses it.** A die spins over the player's head while it shows in the panel (switching dice
  fades one out and the next in, `block-party.md`, "Dice"), and the jump is the roll: the player
  jumps, hits it, and the walk follows. An item is used, its target picked next where it needs one.
- **Sneak** closes it, back to the board menu.

## The dialogue box (bottom middle)

- A box with an outline and a semi-transparent background, at the bottom middle of the screen.
- **The speaker's name** sits on the top border, on a background of its own, so the outline looks
  broken where the name is.
- **Two columns inside** (the user's "60/30": the words about two thirds of the width, the buttons
  the rest):
  - **The words:** what the NPC says, with color codes and inline icons ("Icons").
  - **The buttons:** a column on the right (Next, Buy, Leave, ...), steered with W and S, picked
    with jump; the selected one has the highlight color, the same as a card on its player's turn.
- **Spoken to everyone** (Chris to all players, not one): the right column names who has jumped,
  and where the moment allows it, players can vote to skip with the skip strip ("Skip and Ready").
- **One sentence at a time** (the user, 2026-11-17): nothing said before stays in the box. A jump
  goes on to the next sentence (or the next line, or block in the dialogue tool's scenes): every
  player's jump for a line to everyone (bots don't count), the one it's said to for a question.
  The jump button's icon sits at the bottom right of the right column, the viewer's own (the Space
  key, the controller's A or cross, the touch jump: the client knows its own input), with the name
  of the one it waits for on a question. No Next button and no timer.
- A line can play a sound ("Sounds").
- **The words come from the dialogue file,** with how each shows: its delivery ("Dialogue box" to
  one player, "Dialogue box, everyone", "Dialogue button" for its buttons), whether it can be
  skipped, whether it's a cutscene, and the camera ("The dialogue tool's data"). Its "Chat,
  everyone" (71 rows) and "Chat, one player" (11) lines move to the dialogue box or a title in the
  user's file, or go: the user said much of what's in chat now isn't needed long term. The name on
  the border is the line's character; a "Game" line has no name tab (proposed).

## Skip and Ready (bottom right)

Replaces the x / y count: the word, then the heads of the players who've voted, `Skip [head]
[head]`, or `Ready [head] [head]` in the minigame tutorial. A skip vote is holding sneak for 4
seconds (the user, 2026-11-17: jump goes on to the next sentence), the strip showing how far along
anyone holding is. Beside it, what to press for the viewer's
device where the game can tell, otherwise the word ("Button prompts"). Every skippable cutscene (the
intro), every skippable line spoken to everyone, and every Ready uses it. While the dialogue box is
up, the Skip strip is a tab on its top border at the right, like the speaker's name at the left
(2026-11-17: bottom right, it overlapped the box on 16:9 screens).

## The minigame tutorial (left third)

On the HUD while the minigame's rules camera waits for everyone to be ready:
- A panel over the left third of the screen. At the top, the minigame's name in MinecraftTen; under
  it, what to do (the objective); at the bottom, the controls where the minigame has any: each
  action and what it does ("Jump: hop the gap"), with the key or button where the game can tell.
- The Ready strip bottom right.
- **Per side:** in a 1v3 (and any minigame with sides) each side sees its own objective and
  controls.
- Each minigame's definition gains this (its name, and per side an objective and controls) in
  place of its rules text, as lines in the dialogue file with the "Tutorial panel" delivery
  (proposed; today each test minigame's name and rules are in code).

## The results screen

After every minigame, and when a player gets a Star.
- **Behind it:** the camera's view darkened (the user: no blur needed, black is fine).
- **Results** at the top left, in MinecraftTen.
- **A row per player,** best first: the place (1st to 4th) in MinecraftTen, the player's head, the
  Star icon, the coin icon. Each icon's count sits at its bottom right, the way the hotbar shows a
  stack's count.
- **In order:** first the standings as they were; then the changes play out: Stars and coins count
  up (or down) a step at a time rather than jumping, the places reorder one at a time, and 1st gets a
  border. Each step plays a sound.
- If a row can't slide to its new place, swap one pair at a time with a short pause (proposed).

## The minigame announcement

Replaces the roulette titles and the loading screen's plain fade. The user's spec opens with
"announce it in a title"; read here as the "Minigame!" title of step 3.

1. The camera starts rising and pulling back from the board, still aimed at the same point.
2. After 1 second of that, the star field fades in over the view and keeps moving: two or three
   layers of the stars texture sliding at different speeds (parallax), so it feels as if the camera
   is still traveling once it has stopped.
3. Once the stars move: **Minigame!** in MinecraftTen.
4. When it goes: the format (1v1, 2v2, 1v3, FFA, Battle) in the regular font.
5. Then the wheel: 6 minigames of that format, spun until it lands on the pick. A format with more
   than 6 shows 6 at random, the pick among them.
6. The wheel and the titles fade out. Players move to the arena behind the stars if they need to.
7. Back in: the stars' motion reverses, so it feels like moving forward, the stars fade out, and the
   camera eases down into the arena to its rules camera.

- **Covered arenas:** a minigame can be set to cut straight to its arena (proposed, in its Game
  settings): the stars fade in and out, with no camera zoom out or in.
- The HUD draws over a camera fade (`docs/spike-results.md`, "Block Party"), which is why the star
  field is HUD, as the loading screen is now. It still covers the screen while the arena's chunks
  load (the 2 s hold).

## Gain and loss

A pop over a piece for anything gained or lost: coins, a Star, an item, a die.
- **Gain:** the thing appears above the player's head small and fades in to full size as it moves
  down toward the head; near the head it shrinks and fades out.
- **Loss:** the reverse: from the head it moves up and away, growing in and shrinking out the same
  way.
- Proposed: an entity of the game's own (like the die) with an animation for each, its texture the
  thing's (vanilla stand-ins for now: a nether star for a Star, a gold nugget for coins), seen by
  everyone. The size change for sure; the fade if an animation can drive its opacity ("Checks
  first").
- It plays with the card's number stepping and a sound. This is how coins coming in will show (the
  user couldn't tell when coins came in, `block-party.md` pass 10).

## The vanilla HUD

- **On the board:** the hotbar, health, hunger, XP, armor, air, the paper doll, status effects and
  the item name popup hidden (`setHudVisibility`, as now), and the crosshair too (proposed: the
  camera is scripted). Touch controls stay: touch players need jump, sneak and the pad.
- **In minigames:** vanilla's hotbar comes back while a player plays one, from Go until it ends
  (the user, 2026-11-17: never on the board or in cutscenes), and the board's bar items are taken
  away for it. Each minigame may list more vanilla HUD parts it shows (proposed: health and the
  crosshair).
- **Chat:** hidden everywhere in Block Party, if it can be (the user). `HudElement` has no chat, so
  the pack's `hud_screen.json` turns vanilla's chat feed off (Block Party's pack loads only on its own
  servers). Opening the chat screen may still show the history: hide it there too if the pack can
  ("Checks first"). This also hides what players type to each other. The Tests' reports and error
  messages go to chat today: proposed, chat stays visible in test games behind a switch.
- The old bar goes: the pack's own hotbar went 2026-11-17 (bar codes, its JSON UI and art); the
  loading codes in `bar-codes.ts` and the loading screen in `tools/assets/blockparty-hud-ui.ts`
  remain, and the bar items (`blockparty:bar_<icon>`, in hidden slots until the board menu) go with
  the board menu. Nothing is in a player's hands on the board.

## Settings and Tests

- **Settings leave the HUD.** Not in the pause menu: a resource pack can add a button there, but
  nothing pressed there reaches the server (JSON UI buttons only do what the client's own screen
  code does with them, and scripts get no event), so it could never change a game setting. The user
  is happy with a command.
- **`/blockparty:settings`** opens a player's own settings (reduced motion, and the rest) as a form:
  a custom command, registered the way `packages/minigame-core/src/building/commands.ts` does.
- **`/blockparty:tests`** opens the Tests form the compass opens today, in test games
  (`DEV_TEST_GAMES`) or for operators (proposed).

## Player heads

2D pictures of each player's face, for the cards, the skip and ready strip, and the results screen.
- The network already saves every player's skin (the watcher, `docs/skins.md`) and renders heads into
  the lobby's pack at build time, with a letter badge for anyone the watcher hasn't seen
  (`badgeFor()`). Block Party's pack gets the same, but flat: the skin's face (8 x 8) with its hat
  layer over it, scaled up without smoothing (proposed: a new render kind in `tools/skins/`).
- Skins are players' personal data: the renders stay out of git, as the lobby's do.
- A new skin shows after the next build and restart; until then the player has their letter badge.
  Bots have a badge too (proposed).
- In JSON UI each head's picture path comes from the data (a texture bound from text), so one card
  template serves every player ("Checks first").

## Cameras

Shared: every player sees the same shot. The user's list, 2026-11-17 ("if I missed anything we'll
get to it later"). Where it overlaps `block-party.md`'s "Shots", this list wins; the rest of "Shots"
stays as proposals.

| Shot | What it is |
|---|---|
| **Intro** | A pan through several camera shots showing off the map. A cutscene that can be skipped (the skip strip, on the dialogue box's top border at the right). Then a jump cut to the podium. |
| **Starting podium** | A fixed camera on the players and Chris. The players stand in a line looking at Chris, with a bigger gap between the 2nd and the 3rd so the camera sees Chris, who stands in the middle, further away. Chris's dialogue is here: the rules question (the walk-through if the first player says yes), the game's length, then the dice roll. Players can punch, jump and sneak but not walk, and nobody can hurt anyone. |
| **Order rolls** | Still the podium. The players stop facing Chris and turn the camera's way: facing away from Chris, along the camera's line of sight (not looking straight at it). Each jumps to hit their die. |
| **Order reveal** | The camera moves (never cuts) to each player in turn order. After each, the action bar shows the player's name and place, their card appears, they celebrate, and Chris looks at them. |
| **Star reveal** | Chris says where the first Star will be. The camera pans to the spot, where a pig (Chris's variant) slowly falls down beside the marker. Then the game starts with everyone on Start. |
| **Board view** | Whenever nobody is rolling, on the player whose turn it is. Two modes: **follow** (turns as the board turns) or **fixed** (follows the players but never turns). Distance, angle, zoom and the rest are settings, changed in both editors. Pieces stand facing their next space. |
| **Player's turn** | The board view zoomed in, eased with no cut either way. The player turns to face the camera, body first, then head. The die over their head while Dice block is picked; a jump makes them jump. |
| **NPC dialogue** | A pan from the board camera to the NPC, or a jump cut. Each conversation has a default and can be set either way, per moment in the dialogue tool (Camera: Pan to speaker, Cut to speaker, Camera stays, or the default): Chris at the Star pans; the intro to Chris at the podium cuts. |
| **Minigame announcement** | The zoom out, the stars and the wheel, and the zoom into the arena ("The minigame announcement"). |
| **Minigame camera** | Fixed: the arena's rules camera, with the tutorial, until everyone is ready. |

- **Board view settings** are per map: `map.settings` in Block Party's config and the Game settings
  tool, so both editors have them (the repo's rule for per-map values). Proposed: mode (follow or
  fixed), distance, height, pitch, field of view, the turn shot's distance and field of view, and the
  ease time.
- **Facing:** a teleport with the facing; `setRotation` doesn't reach the player's screen (the
  spike).
- **The falling pig:** proposed, an NPC with gravity and slow falling, so each client moves it
  smoothly; teleporting an entity every tick jitters (the spike).
- **Markup:** the podium needs the lineup spots with the wider gap between the 2nd and the 3rd,
  Chris's spot and the podium camera, and the intro's shots (Camera tool). `block-party.md`'s
  "Stages and camera anchors" lists the lineup and NPC stages; these join it. The podium shots need
  pass 6's stages and NPCs.

## Player animations

Played on the player by the script (`playAnimation`, animations in the game's resource pack, as
Chameleon's poses and the referee's cheer are), a variant picked at random:

| Set | When | Variants |
|---|---|---|
| Celebration | their place in the turn order is revealed, they win a minigame, they get a Star | 1 to 3 |
| Sad | they lose a minigame, lose coins or lose a Star | 1 to 3 |
| Dice roll | the jump that hits the die: a vanilla jump with one or both fists punched up, some kicking their legs | 4 or more |
| Select | they're picked, or their turn starts | 1 to 4 |

"Losing a minigame" is coming away with nothing from it (the user): last place, the losing side in
a team minigame, a duel's loser.

They're animations of the game's own, made in Blockbench: Bedrock's marketplace emotes can't be
played by the server (scripts have no call for it, and nothing sits between players and BDS that
could send one). Start with one simple animation per set (arms up, head down, a punch up, a wave)
so every hook shows something; the user adds the variants.

**During dialogue:** a line's actions in the dialogue tool say who does what and when (at the
start, at the end, or seconds in): the players' four sets above and each NPC's moves (Chris's Talk,
Look at the player, Celebrate and Fall in; the Warden's Roar, Sonic boom, Sniff, Emerge and Dig
away; and the rest in the tool's list, which the user can add to). The NPCs' moves are their vanilla
animations where the mob has one, else the game's own.

## Sounds

Every animation and much of the dialogue plays a sound. The user maps them in the dialogue tool's
Sounds view ("The dialogue tool's data"): a cue for each character's voice, each line, each action,
each game event and the background music, every one silent until it has a sound.
- **Events, the first list** (the tool's seed, which the user can add to): the board menu's step,
  select, back and disabled; the item panel's step and use, switching dice, hitting the die, its
  number; the dialogue box opening, next, its buttons and closing; a skip vote, a ready vote,
  everyone voted; a card revealed, a turn starting; a piece's step and landing on each space type;
  the Star landing and bought; gain and loss (coins, a Star, an item); the results opening, each
  counting step, a place swap, 1st's border; the announcement's zoom out, Minigame!, the format,
  each wheel tick, the wheel landing, the zoom in, 3-2-1 and Go; camera pans and cuts.
- **Music:** the intro, the starting podium, the board, a minigame, the results, the final podium,
  played with `world.playMusic` (fade and loop from the cue) and stopped or crossfaded as the game
  moves on.
- **A line's sound** is its own cue if it has one, else its character's voice.
- Sounds play to everyone (the view is shared), with the cue's volume, pitch and delay.

## The dialogue tool's data

The workshop's dialogue tool (`..\workshop\dialogue`, not in this repo; its README) holds what the
UI shows and plays. This pass extends its install (`tools\install.mjs`) to hand the game what it
needs, as data with no art in it, committed like `dialogue.json`:

- **Per moment** (shared by an id's alternates, in `lines\blockparty.json`): `delivery` (the old
  ones plus "Dialogue box", "Dialogue box, everyone", "Dialogue button", "Tutorial panel"),
  `skippable` and `cutscene` (true or false), `camera` ("Pan", "Cut", "Stay", or "" for the moment's
  default).
- **Per line:** `actions`, each `{ who, action, when, seconds? }`: who is "Speaker" (the line's
  character), "Player" (the `{player}` fill), "Other" (`{other}`), "Every player", or a character by
  name; the action is from the file's `actions` list (by owner: "Player" for the players' sets, else
  the character); when is "Start", "End" or "After" with `seconds`.
- **Blocks:** nodes among the lines (`"kind": "block"`, each with an id of its own, `block-1` and
  on) for what the game does. Since the tool's flow charts (2026-11-17, workshop 606adcb) each
  scene is a chart: `flows` holds, per scene, where each node sits and the links between them
  (`[from, to]`, a line's id or a block's), and a block runs when a link leads to it. Each has a `block` kind from the file's `blocks` list, which
  names the fields that kind takes: `who` and `target` (one of "Player", "Other", "Every player",
  "Everyone else", "The leader", "Last place", "Speaker"), `amount` (spaces back are below 0),
  `item` (from the file's `items`), `seconds`, or `text` (a description). The first kinds: Give
  coins, Take coins, Pay coins, Give Stars, Take Stars, Give item, Take item, Move spaces, Swap
  places, Camera, Wait, Game step; the user adds kinds that take a description. A block's effects
  show with the gain and loss pops and the cards ("Gain and loss"). The game's copy (`dialogue.json`)
  leaves blocks and flows out until a pass carries them; a kind with only a description is for the
  code to do by hand.
- **In the game's copy now** (pass 6): `dialogue.json` has `moments`, each id's character and
  delivery, and `skippable`, `cutscene` and `camera` when set (`moment()` in `lines.ts`); and the
  install writes `sounds.json` beside it, the sound map's cues (`sounds.ts` plays them). Actions,
  blocks and flows aren't carried yet.
- **The sound map** (`sounds\blockparty.json`): `cues` keyed `voice:<character>`, `line:<id>`,
  `action:<owner>/<action>` and `event:<id>`, each a list of `{ sound, volume, pitch, delay }` (music
  events also `fade` and `loop`), one picked at random each time; `events` (the event list, with a
  `music` flag); `sounds` (the user's own, each `blockparty.<name>`).
- **The user's sound files** are already installed by the tool's `install-sounds.mjs` as a private
  pack (`games/blockparty/private_packs/sounds/`, git-ignored), each sound defined under its id
  with its category, volume, pitch and streaming. Minecraft's own sounds play by their ids.

## How the HUD gets its data

Known, from the HUD as it is, the core's `hud.ts` and the workshop json-ui calibration:
- **The action bar, per player:** the core's HUD line (`hudLine`, starting with `HUD_MARK`) carries
  formatting codes that never render, which the pack's JSON UI tests with expressions like
  `has(code)` (`tools/assets/rounds-hud.ts`); Block Party's bar and loading screen ride it today
  (`bar-codes.ts`). Text can be cut out of a binding with string expressions (`'%.8s' * #text`, and
  `-` to remove a part), as the calibration's cases do.
- **The sidebar, the same for everyone:** its title (`#objective_sidebar_name`) is readable (the
  calibration picks its cases by it), and its entries are a list. The shared screens (cards, results,
  the wheel) could ride it, with vanilla's sidebar not drawn ("Checks first").
- **Titles and subtitles,** per player, with their own fade times.

Proposed shape, following the existing pattern:
- **Encoders:** per screen, a pure module in the game's scripts (like `bar-codes.ts`) that turns the
  game's state into codes and text, with tests.
- **Look and wiring kept apart,** so a JSON UI editor can own the look:
  - The look of each screen (sizes, offsets, colors, fonts, textures) in hand-written files of
    templates, such as `blockparty_cards.card`, which the user or their future tool edits.
  - The wiring (a control per seat and per code, bound to the data) generated from the encoders'
    constants into separate files that use the templates (`card_1@blockparty_cards.card`, with
    `$variables` for its bindings), as `tools/assets/blockparty-hud-ui.ts` generates the bar now,
    with a test that the committed files are current.
  - Regenerating never overwrites the look, and changing the look never needs the generator.
- **Preview** each screen in the workshop's json-ui page (`json-ui.cmd`, port 8769), which reads any
  network worktree, before trying it in game.

## Checks first

Short checks, in game or in the previewer, before building on each:

1. The movement vector reads while walking is locked (`lock()`), on keyboard, controller and touch.
   If it reads nothing: try the separate MoveForward, MoveBackward, MoveLeft and MoveRight locks,
   then a seat entity the player sits on (still, not steerable, with Dismount locked).
2. `:_input_key.jump:` and the like, in action bar and title text, draw each viewer's own key or
   button.
3. The chat feed turned off in `hud_screen.json`, and whether the chat screen's history can be
   hidden too.
4. A picture path taken from the data: a head picked by a code or a name in the text.
5. The sidebar's entries as a list the pack draws itself, with vanilla's sidebar not drawn.
6. Looping offset animations on a tiled stars image (parallax), and reversing them.
7. An entity's opacity driven by an animation (gain and loss): else the size change only.
8. The widest layout (4 cards and the menu) on the smallest screen and GUI scale the previewer has.
9. A WAV sound file in a resource pack plays (the dialogue tool makes clipped sounds as WAV); else
   the tool needs another format.

## Build order (proposed)

1. Checks first, and the data's shape: encoders, the look and wiring split, previews.
2. Controls (steer, select, back), the board menu, the item panel for dice and items; the old bar
   out; `/blockparty:tests` and `/blockparty:settings`; the vanilla HUD and chat hidden; button
   prompts, with the watcher's devices and the Panel's Players page marks.
3. Player cards and heads.
4. The dialogue box and the skip and ready strip, with the dialogue file's new deliveries.
5. Cameras: the board view's modes and settings, the turn shot, NPC pans and cuts; then the
   pre-game (intro, podium, order rolls and reveal, Star reveal), with or after pass 6's stages.
6. The minigame announcement, the tutorial panel and the results screen.
7. Gain and loss, player animations, the dialogue tool's actions and sound cues (its install
   extended to carry them).

## Open points for the user

- What Board does (proposed: the board overview, to look the board over).
