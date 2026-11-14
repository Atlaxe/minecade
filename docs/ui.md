# Look and feel

How Minecade talks to players and how its lobby UI is built: messages and colors, the HUD clock,
countdown sounds, and the lobby terminal with its hologram and themed menus.

## Messages and colors

Every message players read (chat, titles, the action bar) goes through
`packages/minigame-core/src/text.ts`, so the whole network uses one palette:

| Helper | Color | Use for |
|---|---|---|
| `say.minor` | gray (§7) | Minor notes: "You're spectating", "Wrapping up the last game" |
| `say.info` | aqua (§b) | Information: waiting for players, "Starting Sumo..." |
| `say.important` | blue (§9) | Important news: who's starting a game, round winners |
| `say.success` | green (§a) | Good news: "Go!", "Victory!" |
| `say.warn` / `say.error` | red (§c) | Warnings and errors: not enough players, a failed start |
| `say.highlight` | yellow (§e) | Highlights: countdown numbers, winners, the kill feed |

`nameOf(name, color?)` writes a player or team name in its team color (white without a team).
A name inside a `say.*` line hands the line's color back after itself, so this stays aqua:

```ts
say.info(`${nameOf("Alex")} is starting Sumo.`)
```

`stripColors(text)` removes the codes, for logs and tests (tests compare what players see).

**The map editor's chat** names a map as `[Game : Map]`, the game in gold (§g) and the map in
orange (§6): `chatMapName(game, map)` in minigame-core's editor protocol. Only chat does this; the
editor's menus name a map as "Sumo: Arena (arena_1)".

## Kill feed

When a player goes down, the game broadcasts one line:

- **With a killer:** `<victim> was <verb> by <killer>`, the verb picked at random from
  `KILL_VERBS` (obliterated, dominated, man-handled, bonked, ...). The line is yellow, the victim
  is gray and the killer red, or both in their team colors in team games.
- **Without a killer:** a line picked by cause: falling into the void or off the map
  ("took a long walk off a short platform"), fall damage, or a generic one.

A game can add its own verbs, or use only its own, in `game.config.ts`:

```ts
deathMessages: { verbs: ["painted", "splattered"] }                 // added to the defaults
deathMessages: { verbs: ["painted"], replace: true }                // only these
deathMessages: { noKiller: ["fell off the plot"] }                  // lines with no killer
```

For anything more (a line that depends on the weapon, say), override
`protected deathMessage(victim, down)` in the game's `Minigame` class. Returning `undefined`
skips the line.

## Action bar and match clock

The action bar (the line above the hotbar) only shows what matters right now:

- **Lobby:** nothing. Starting a game shows a chat message, and the countdown is on the terminal's
  hologram (no titles).
- **Games:** lives in games with lives, and "Waiting for players" before the match. A game can
  show more by overriding `hud(name)`. A respawn countdown is a title instead, like the start's:
  the seconds left over "Respawning in", the last one gone as the player comes back.

Every match has a clock: `timeLimitSeconds` in `game.config.ts`, 5 minutes when a game doesn't
set one (`DEFAULT_TIME_LIMIT_SECONDS`), or `0` for no limit. Games that override `play()` should
use `this.timeLimit` so the default applies to them too. When time runs out, `onTimeUp()`
decides the result (the highest score, or a draw).

The clock shows top right with a clock icon, turning red in the last 30 seconds. Bedrock has no
script API for placing text on the HUD, so everything top right rides on the action bar:
`hudLine()` in `packages/minigame-core/src/hud.ts` starts the line with `HUD_MARK`, a run of
formatting codes that never renders. The core resource pack's `ui/hud_screen.json` turns the action
bar into a full-screen panel and shows marked lines top right; unmarked lines show like the vanilla
action bar. To see JSON UI errors in the client, turn on Settings, Creator, Content Log GUI.

**Every thing top right gets a bubble of its own** (the user's rule, 2026-11-04): the clock, the
own score, the rounds, and the line's text (`hud(name)`: "Lives: 2", Build Swap's prompt) are each
in their own box, never two in one. Anything added there later gets its own bubble too. The clock,
score and rounds sit side by side in a row (the rounds left, the clock right); the text's bubble is
above the row, against the right edge, and wraps a long line (Build Swap's prompts) at 200 pixels.

Since JSON UI can't cut text out of the action bar, only the text is visible on the line: a label
showing the whole line shows just it, and the line's `TEXT_MARK` code (`§k§c`) says there's text
to show. Everything else rides at the end of the line as more codes that never render, and the
pack shows the digit or picture whose code it finds in each place. The clock's codes
(`clockCodes()`: each place, minutes' tens from 10, minutes, seconds' tens, seconds, then its digit
as a code, `§k§b` first for red) are drawn by a label per digit per place in white and in red,
generated by `tools/assets/clock-hud.ts` into `ui/minecade_clock.json` (a test fails if the
committed file is out of date). `hudText()` puts text alone top right (the map editor's Replace
mode). Without the pack, the action bar shows only the text.

What JSON UI allowed here, found in-game on 26.60:

- Engine variables such as `$actionbar_text` work in expressions only after being copied into
  the control's own variable: `"$atext": "$actionbar_text"`.
- Expressions go in plain properties. `"visible": "(not (($atext - 'x') = $atext))"` works, and
  `"text": "('%.8s' * $atext)"` works ('%.Ns' keeps the first N bytes).
- String subtraction doesn't produce text: `"text": "($atext - 'x')"` fails with "expected a
  string". That's why the mark is invisible formatting codes instead of being cut off.
- View bindings need a `#property`: one whose expression only uses `$atext` fails with "Must
  define a source property name in the binding!".
- A pack's control is merged into vanilla's of the same name, property by property, so it keeps
  vanilla's type: vanilla's `hud_actionbar_text` is an image (ours has a clear texture,
  `textures/minecade/hud/clear`) and its `hud_title_text` a vertical stack panel (the editor's holds
  one full-screen panel). Another type logs vanilla's leftover properties (`texture`,
  `orientation`) as unknown in the content log.

**Notes top left:** lines for everyone on the server, each in a bubble of its own, top left
above the paper doll and the chat (Build Swap's prompt while a build is voted on, and its twist
under it). The action bar and the title are taken (the HUD top right, a preview's mode line), so
notes ride on the scoreboard sidebar: `Notes` (`packages/minigame-core/src/game/sidebar.ts`) shows
a sidebar whose title is `NOTES_MARK` (`§r§m§n§r`), with its lines as participants scored from the
top down. The core pack's `ui/hud_screen.json` does the rest:
- It swaps vanilla's column top left (`chat_stack`, copied from 26.60 as `mc_chat_stack`) for one
  with the notes (`mc_notes`, an `mc_note` bubble per line) first, under only the touch layout's
  padding for its hearts, so the paper doll and the chat move down under them. The paper doll
  moves into that column for it (`mc_paper_doll`, out of `centered_gui_elements` and
  `not_centered_gui_elements`).
- It puts vanilla's sidebar in again (`root_panel`'s `sidebar`), hidden while its title is the
  mark. Hiding it in `ui/scoreboards.json` doesn't work: the HUD places the sidebar with its own
  visibility binding, and an instance's bindings take the place of its def's.

Notes are the same for everyone (the sidebar is the world's), and a game shows notes or sidebar
scores, never both. Without the pack they'd show as a plain sidebar on the right with a blank
title.

**Pictures on the right:** a sidebar whose title is `PICTURES_MARK` (`§r§m§p§r`, in `hud.ts`)
shows as a column of pictures where the vanilla sidebar sits, centered on the screen's right edge:
each participant's name is a texture path in a pack the server loads, drawn at 40 pixels in a
bubble of its own, top to bottom in the sidebar's order (highest score first). Scores aren't shown,
and two participants can't share a name, so a picture shows once. The core pack's `mc_pictures`
binds each row's `#player_name_sidebar` to the image's `#texture`, and `root_panel`'s sidebar hides
for this mark as it does for notes. It's the world's sidebar too, so everyone sees the same
pictures. Probe's chameleon test shows the hiders' costumes this way, to everyone.

**Own score:** a game whose `scoring` has `display: "own"` (One in the Quiver) has no sidebar.
Each player sees only their own score (their team's in team games) in a box left of the clock's,
with a skull and the number. It rides on the same action bar line: `countCodes()` in `hud.ts` adds
the number at the end as more formatting codes ("§k§t§1§k§u§5§r" is 15: each place's codes, then
the digit as a code). The pack's box has a label for each digit in each place, and keeps only the
ones whose codes are in the line (`"ignored"`, so a 5 is one digit wide). It shows 0 to 999. A test
checks the codes match the pack. With no clock (a time limit of 0), the score is plain action bar
text ("Kills: 5").

**Best-of rounds:** a game with a `bestOf` config (Bridges) shows its rounds in a third box, left of
the others, in one of two ways (`bestOf.display`):

- **Icons** (two sides, best of up to 7): a white circle per round. Each round's winner colors the
  next circle, left to right, in their team color; a drawn round is gray. Bridges' best of 5 starts
  as five white circles.
- **Score** (up to 4 sides, any number of rounds): each side's round wins in its color, separated
  by gray bars, "2 | 1", or "R | Y | G | B" for four teams. A first-to-10 game uses this one.

Without `display`, icons are used when they fit and the score otherwise. It rides on the action
bar like the own score: `bestOfCodes()` in `hud.ts` adds codes for the number of circles and each
won circle's color (`§k§i`, `§k§j`), or each side's color and its wins' tens and units (`§k§q`,
`§k§m`, `§k§s`). The box's controls are generated, since there's one per code it can find:
`tools/assets/rounds-hud.ts` writes `ui/minecade_rounds.json` (listed in the core pack's
`ui/_ui_defs.json`), and a test fails if the committed file is out of date. A best-of game's clock
is the match's, over all the rounds; with no clock at all, the clock's box goes, and the line's
text stays in its own bubble.

**A gun's scope:** `SCOPE_CODE` (`§k§l`) anywhere on the line draws a scope over the whole screen
(`mc_scope` in the core pack's `ui/hud_screen.json`): the lens (`textures/minecade/hud/scope.png`)
as wide as the screen is tall (`"100%y"`) in the middle, and `black.png` hung off either side of it,
three lenses wide, so it fits any screen. (Black sides placed from the screen's middle by a `"%y"`
offset covered all but a narrow strip of the lens, seen in game: an offset's `"%y"` isn't the
control's own height, though a size's is.) It's first in the action bar's controls, so the HUD's
bubbles show over it. The lens is art to paint over (the table below). A game adds the code
through `Minigame.hudCodes` (docs/guns.md, "Aiming"); with it, a line with no clock is still marked
(`HUD_MARK`), so its text shows top right rather than over the hotbar.

**A flag to take:** `FLAG_CODE` (`§k§e`) anywhere on the line shows a bubble of its own reading
"Capture the flag!" in gold, left of the rounds, the score and the clock (`mc_flag_box` in the core
pack's `ui/hud_screen.json`). Gunfight adds it through `hudCodes` while its flag's circle is up.

**Team scores as sides:** a game whose `scoring` has `display: "sides"` (Paintball) has no sidebar:
every team's score shows in the rounds box, as the best-of score does, each in its team's color with
gray bars between ("3 | 1 | 0 | 2", up to 99). It's for team scores (`per: "team"`) of up to four
teams, in a game without best-of rounds, which would need the same box (the build checks). Dark
green (§2) has its own color there, as the other team colors do.

## The kit form

A game whose `kits` have `select` (Bridges, Siege, Probe) has players pick a kit in a live form, the same
kind as the lobby's team form (a data-driven `CustomForm`: it updates while open and its buttons
don't close it; `packages/minigame-core/src/game/kit-form.ts`, its logic in `kit-picker.ts`).

- **When:** `select: "match"` once before the match, `select: "round"` before every best-of round
  (round 1's pick is the match's, and players wait frozen at their spawns). Kit changes in the middle
  of a round aren't built yet.
- **Where:** once everyone is in, teams are dealt first (by the lobby's picks), so players wait at
  their own team's spawns, frozen; on a map with a queue spawn, they pick in the queue.
- **Staying open:** the form stays open until everyone has picked. Closing it brings it back within
  a second. Players can change their pick until the last one picks; then every form closes and the
  usual countdown runs (Bridges' 5 seconds), or the round's. After `pickSeconds` (30 by default),
  whoever hasn't picked gets the first kit.
- **The star:** before the match, players hold a nether star named "Change kit" (the last hotbar
  slot). It brings up the kit form: while kits are being picked, the same form at once; before or
  after that (waiting, the countdown), a form of its own with no status line, where a pick changes
  their kit until the match starts. The forms close when it does. Teams aren't picked here: that's
  the lobby's job.
- **On it:** a status line (who's still picking, and the seconds left), then
  each kit: its picture over a button with the kit's name, disabled on the player's own pick (it
  can't turn green: see Looks). Nobody sees what the others picked. The base kit everyone gets isn't
  shown.
- **Looks:** a live form renders in Minecraft's Ore UI, whose panel, buttons and fonts no resource
  pack or script can change (the layout is the client's `script_ui` pack, `ddui/root/custom_form.json`,
  and the script API has no style option). What's ours is the text and the pictures.
- **No color codes in a live form, ever** (the user's rule, 2026-11-04): Ore UI shows a `§` code as
  typed instead of changing the color, in a label, a text field's label or description, or a
  button. Never use `§` codes to color anything in a live form, and don't try it again: the kit
  form, the lobby's team form and Build Swap's prompt form pass their text through `stripColors`
  where it goes in. A picture would be the only way to color a button, but pictures don't show in a
  live form (the user, 2026-11-13: the team form's picture buttons never appeared), so the team
  form's buttons are plain.
- **Pictures:** the build draws each kit's picture into the game's resource pack
  (`tools/build/kit-pictures.ts`): a hotbar of nine slots (a gray frame around a dark see-through
  square), all four times as large. The kit's items fill it from the left (then what it puts in
  the off hand), each with its count over 1 in the corner the way the hotbar draws a stack. A kit
  with armor shows it in the last slot: one piece fills it, more share it at half size (head, chest,
  legs, feet), and only eight items fit beside it. Without armor, nine items fit. Items past the
  slots are left out. One picture per team dye for a kit with items in team colors or leather it
  dyes (`teamArmor`). The icons are Minecraft's own textures, a block's (wool) drawn as a cube,
  leather tinted (its own brown, or the team's color); an item Minecraft has no texture for is left
  out. The form needs the pack's UUID, so the game passes it (Bridges' and Probe's `main.ts` read
  their resource pack manifests), and it worked in game. A game whose players pick kits ships its
  resource pack even when it holds nothing else. If a form with pictures can't show, it's shown
  again without them, with each kit's items as text ("8x Snowball").
- **Minecraft's textures** (`tools/build/vanilla-textures.ts`) are Mojang's, so they never go in
  git. The build reads them from the vanilla resource pack of the Minecraft install on this PC
  (`MINECRAFT_VANILLA` points elsewhere), which keeps them in two archives
  (`__brarchive/textures/items.brarchive` and `blocks.brarchive`), and copies those into
  `tools/assets/vanilla/` (git-ignored). The Docker build has no Minecraft, but it gets that folder
  with the rest of the checkout, and the Panel refreshes it before every start. Without either, the
  build warns and the kit form lists items as text.

Kits themselves: `base` is what everyone gets on top of their pick. Each kit's `refill` says when
it comes back: `"life"` on every spawn (the default), `"round"` at the start of the match and of
every round, with what's left kept through a respawn (Bridges' snowballs and Leap), or `"match"`
once. An item id with `{color}` takes the team's dye: `minecraft:{color}_wool` is red wool on Red.
A kit's `enchantments` list puts enchantments on its items and armor by item id (Siege's Seaman:
Loyalty III on the trident, Depth Strider III on the boots); the pictures don't show them.
A map can add kits of its own or replace the game's (`kits` in `map.json`, see `docs/maps.md`),
unless the game's `kits.mapKits` is false (Siege's classes are the same on every map).

**Seconds over the hotbar:** Bridges' arrow and Siege's abilities count down on the player's level
(`LevelSeconds` in `packages/minigame-core/src/game/level-seconds.ts`), never going up onto a
multiple of 5, where Minecraft plays its level-up chime.

## Siege's classes

Siege's seven classes are its kits, picked before every round in the kit form (the class form) and
the same on every map. Each has its gear and an ability: the item in the last hotbar slot, used like
Bridges' Leap feather. The level over the hotbar counts the seconds until it's ready again, with a
chime once it is, and a low note when it's used too soon. Each player is told in chat what their
class's ability does the first round they play it. Numbers are in `games/siege/game.config.ts`
(`abilities`, `water`).

| Class | Gear | Ability (cooldown) |
|---|---|---|
| Soldier | Iron sword, iron armor | Rally (blaze powder, 25 s): Strength I and Speed I for 6 s, for them and teammates within 8 blocks. |
| Archer | Bow (Power I), wooden sword, 32 arrows, leather and chainmail | Volley (flint, 15 s): 5 arrows at once in a fan where they look. |
| Seaman | Trident (Loyalty III), turtle helmet, leather and chainmail, Depth Strider III boots | Tidal Wave (heart of the sea, 20 s): enemies within 6 blocks are pushed away, slowed, and soaked for 3 s (water hurts them wherever they are). Water never hurts a Seaman, who has Speed II in it and Water Breathing; a trident that doesn't come back in 5 s is replaced. |
| Tank | Stone sword, diamond and iron armor, Slowness I | Fortify (shulker shell, 25 s): Resistance II for 6 s, and no hit pushes them. |
| Medic | Wooden sword, leather and chainmail | Heal (glistering melon slice, 20 s): 4 hearts back for them and teammates within 8 blocks. |
| Scout | Stone sword, leather armor, Speed I, no fall damage | Leap (feather, 8 s): a push the way they look, as Bridges' Leap. |
| Assassin | Diamond sword, leather armor | Vanish (ink sac, 25 s): invisible for 6 s with no armor and no name over their head, until they hit someone or someone hits them. |

Leather armor is in the team's color, and names show over heads in the team's color
(`nameTags: true`). Health comes back only from a Medic (the `naturalRegeneration` game rule is off
for the match), and hunger stays full (a Saturation effect in the base kit). A Fortified Tank's hits
are canceled and their damage taken off the next tick instead, since a canceled hit pushes nobody;
Minecraft's half second between hits is kept by hand.

## The guns

Every gun, grenade, knife and stimpack, Paintball's and the arsenal's, how they work in game, and how
to edit their numbers, models, colors, holds and recoil: `docs/guns.md`.

## Dyed leather armor

Bedrock's scripts can't dye vanilla leather (setting `ItemDyeableComponent.color` on it does
nothing), so the shared armor pack (`packs/armor`) has leather in each of the 16 dyes as its own
items: `minecade:<dye>_leather_helmet`, `_chestplate`, `_leggings`, `_boots` (`dyedLeather(piece,
dye)`), named, protecting and wearing out like vanilla leather. A kit with `teamArmor` puts on the
piece in the team's dye in place of the vanilla leather it lists (`teamArmorItem`), and a preview's
team switch swaps it; any game can hand one out by name. They look like dyed leather because they
are: the build tints Minecraft's own leather textures by the dye's leather color (`LEATHER_DYES`, the
same multiply the game does) and writes the pack, git-ignored, from the textures on this PC or
their cache (`tools/assets/armor.ts`). Kit pictures draw them the same way.

### Team armor in a new game

Any game whose teams should wear their color uses these pieces. Never dye leather from a script:
Bedrock ignores it and the armor stays brown.

- **In a kit (the usual way):** list vanilla leather in the kit's `armor` and set `teamArmor: true`.
  Each player gets the armor pack's pieces in their team's dye, and the kit form's picture shows
  them. Leather can sit beside other armor: only the leather pieces change. Enchantments are
  written against the vanilla id and carry over.

  ```ts
  armor: { head: "minecraft:leather_helmet", chest: "minecraft:iron_chestplate", feet: "minecraft:leather_boots" },
  teamArmor: true,
  enchantments: [{ item: "minecraft:leather_boots", enchantment: "minecraft:feather_falling", level: 2 }],
  ```

- **The team's dye** comes from its color code (`dyeName`): `§c` and `§4` red, `§9` and `§1` blue,
  `§e` yellow, `§a` lime, `§2` green, `§6` orange, `§d` magenta, `§b` light blue, `§3` cyan, `§5`
  purple, `§f` white, `§7` light gray, `§8` gray, `§0` black. Core's default green team is `§a`, so
  it wears lime; a game that wants dark green gives its team `§2`. Pink and brown have no color code,
  so only a script can hand them out.
- **From a script** (armor that changes in play, such as Paintball's hits, or a color that isn't the
  team's): put on `dyedLeather(piece, dye)` from `@minecade/minigame-core` as an ordinary item,
  where `piece` is `"helmet"`, `"chestplate"`, `"leggings"` or `"boots"` and `dye` one of
  `LEATHER_DYES`' 16 names. `parseDyedLeather(id)` says which piece and dye a worn item is,
  `teamArmorItem(id, teamColor)` turns a vanilla leather id into the team's piece, and
  `leatherColor(dye)` gives a dye's color. Only those 16 colors exist, so a mixed color (`mixDyes`)
  has to be matched to the nearest of `LEATHER_DYES`.
- **In tests,** the fake world's worn armor is the pack's id, such as
  `minecade:blue_leather_chestplate` (Siege's tests check it).
- **The pack** is written by every build from Minecraft's textures on this PC or their cache
  (`tools/assets/vanilla/`, which the Panel fills before a start). On a PC with neither, the build
  warns and leaves `packs/armor` as it was. It's git-ignored: never commit it, and add a dye or a
  piece in `tools/assets/armor.ts` and minigame-core's `kit-defs.ts`, not by hand.

## Paintball

Paintball (`games/paintball`) is Red against Blue with the shared guns: first team to 10 kills, a
10 minute clock, unlimited respawns after 3 seconds. Its numbers are in
`games/paintball/game.config.ts` (`hitsToOut`, `powerUps`, `grenade`, `splash`).

- **Teams:** Red and Blue, picked in the lobby's team form or dealt out evenly. (Yellow and Green
  were taken out on 2026-11-11.) Any team game can still let the lobby pick how many teams play:
  `teams.count` a range and `teams.option` naming one of its `options`, whose values are team
  counts inside the range (`teamLimit` in minigame-core; the build checks them).
- **Hits:** a ball that hits an enemy colors the leather piece it hit (by how high: head, chest,
  legs or feet), or the nearest piece not yet colored, in the piece's color mixed with the
  shooter's: by Minecraft's dye recipe when there is one (red and blue make purple, red and yellow
  orange, blue and green cyan), else the nearest of the 16 dyes to the two mixed as leather mixes
  them (red and green make brown, yellow and green lime). Health shows the hits left, a quarter
  each; the fourth puts the player out and scores for the shooter's team. Balls from teammates, and
  any during the 2 seconds of protection after a respawn, do nothing. Nothing else hurts (melee,
  falls); leaving the bounds or falling below kill Y still puts a player out. Names show over heads
  in the team's color.
- **Power-ups:** two float on the map's Power-up spots at a time, each on its own timer (every 26
  and every 34 seconds). Both appear at Go, and each time its timer comes round, taken or not, it
  appears again on a free spot at random, as a rifle, a shotgun or a paint grenade. Walking onto one
  takes it. A rifle or shotgun takes the pistol's place for 30 seconds (the number over the hotbar
  counts them down), then the pistol comes back; nobody can take a gun while they have one. A
  grenade goes in the second slot, one at a time: it paints a ball of blocks 4 blocks around where
  it bursts, and hits every enemy within 3 blocks twice.
- **Paint:** every ball paints a circle 5 blocks across where it lands (`splash.radius` 2.5), in the
  shooter's team's color, never outside the map's bounds: every block with a face within 2.5 blocks
  of where the ball hit that the paint reaches through the air in front of the hit. On a floor or a
  wall that's a circle; it runs up a wall beside the hit and over edges, but never through a wall
  to its other side. It flies through plants, torches and rails (whatever flowing water washes
  away) to the floor under them, and stops at water. A ball lands where its path first meets a
  block (`@minecade/guns` finds it with a ray each tick, so it never glances off), and a shot at a
  wall right in front of you or at your own feet paints there at once. A player right in front of
  you is hit at once the same way. Full
  blocks (glass and leaves too) become concrete; stairs and slabs vanilla's concrete stairs and
  slabs; carpets the color's carpet; walls, fences, panes and bars, fence gates, doors, trapdoors
  and vertical slabs Paintball's painted blocks of the same shape, which keep their facing, their
  connections and whether they're open, and open and shut with a right click. Small things stay
  as they are: plants, torches, rails, signs, buttons, plates, ladders, chests, beds, heads,
  lanterns and chains. Nothing painted drops an item (the `doTileDrops` rule is off for the match:
  painting a door's half breaks the other for a moment). Blocks from the shared blocks pack are
  painted by their shape, read at build time from the installed pack's own table (`#mod-blocks`,
  `tools/build/mod-blocks.ts`); a build without the pack paints only vanilla blocks.
- **Walking on paint:** on your own team's paint you walk at 1.3 times your speed, on the other
  team's at 0.7 (`paintSpeed`, your movement attribute, so a sprint still adds on top). Paint is any
  block that shows a team's color as paint: its concrete, concrete stairs and slabs, carpet, or a
  painted shape (`paintDyeOf`), whether a ball painted it or the map was built with it. The block
  under your feet is checked every 2 ticks while you're on the ground; in the air you keep the
  speed you had. Being put out, respawning or the match ending puts your speed back. A change of
  speed also changes your field of view a little, unless "FOV can be altered by gameplay" is off in
  your video settings.
- **Preview fakes:** a fake player's hearts (on its name tag) go down with each hit. It wears no
  armor, so no piece changes color.
- **Painted blocks** (`minecade:paint_<dye>_<shape>`, in each team's dye) are in Paintball's own
  packs, so only its servers and previews have them. `tools/assets/paint-blocks.ts` writes them from
  `games/paintball/behavior_pack/scripts/shapes.ts` (rerun it and commit after changing either; a
  test checks the committed files match): vanilla's own concrete textures, and each shape drawn
  from boxes in Java's block coordinates, a box showing for the states that use it, so nothing is
  turned. `spike/paint/run.ts` checks them on a throwaway server: every state loads, and every
  vanilla door, gate and trapdoor state paints to the same shape (a door's `cardinal_direction` is
  a quarter turn from Java's facing).
- **Stats:** kills, deaths and wins, plus Blocks painted.

## Gunfight

Two teams of one or two (2 to 4 players, so a preview's fake players and the player fill 4 at
most), Red and Blue, names over heads in their color, team leather. First to 5 round wins (best of
10, as the user asked), shown top right as each team's wins in its color ("R | B", the rounds box's
score display). One life a round, 4 minute rounds, then the flag. `games/gunfight`.

- **The flag:** when a round's 4 minutes run out, a circle comes up around the map's flag (its
  `flag` point, which Siege's maps carry for Gunfight) for 20 seconds, on a clock of its own top
  right, with a "Capture the flag!" bubble beside it (`FLAG_CODE`), a title and a line in chat. The
  circle is a ring of `minecade:flag_ring` particles (the core pack's), 2 blocks out from the flag,
  gold, or the color of the team taking it. A team alone in it (2 blocks across, from a block
  below the flag to 2 above) for 5 seconds in a row takes the round ("took the flag"); the other
  team stepping in holds it up ("Contested" for those in it), and the taking team leaving starts
  it over (`FlagCapture`). Those taking it see the seconds left as a title with a tick each
  second, and chat says when a team starts taking it. Standing the other team down still takes the
  round meanwhile. Nobody takes it: the team with more health left takes the round, then the one
  that dealt more damage that round (`flagTimeUpWinner`), else it's a draw. A map with no flag goes
  straight to that rule (and the log says so). The config's `flag` holds the numbers.

- **Loadouts:** each round everyone gets the same one, dealt by `LoadoutDeck` from the config's
  `loadouts`: a primary (Assault Rifle, SMG, Burst Rifle, Pump Shotgun, Double Barrel, Sniper
  Rifle, Rail Gun or Crossbow; each comes up once before any comes again), a secondary (Pistol,
  RPG or Netherite Sword) and a grenade (Frag, Molotov, Flashbang, Smoke or Throwing Knife), never
  the same secondary or grenade twice running, plus a Stimpack. Slots: primary 1, secondary 2,
  grenade 3, stimpack 9, each locked in place; a crossbow comes with 8 arrows above the hotbar.
  Each player hears the round's loadout in chat as they spawn, the magazines full.
- **Sides:** `bestOf.swapSides` makes the teams take each other's team spawns every even round
  (core's `spawnSide`); chat says so.
- **Guns** fire only while a round is in play. Their hits take health straight off (no armor),
  teammates are spared, a crossbow's arrow and a netherite sword kill in one hit, and health comes
  back only from a stimpack. The held gun's ammo is the text bubble top right, over the round's
  clock and circles, redrawn shot by shot.
- **Stats:** kills, deaths and wins as every team game, and Headshots.
- **Maps:** Siege's (`map.borrow`), each with a Flag (Gunfight) point: Siege asks for one, so the
  checklist of every Siege map has it. Previews: open a Siege map in Edit, Preview, Play as
  Gunfight.

## Gun Game

Free for all, 2 to 8 players, unlimited respawns (2 seconds, then 2 seconds of protection, at a
spawn away from everyone: core's `spawnAway`), late joiners welcome, a 10 minute clock.
`games/gungame`.

- **The ladder:** the config's `ladders`, picked by the lobby's Ladder setting: 11 weapons (Pistol,
  SMG, Assault Rifle, Burst Rifle, Pump Shotgun, Double Barrel, Sniper Rifle, Rail Gun, RPG,
  Crossbow, Netherite Sword) or 6 (Pistol, Assault Rifle, Pump Shotgun, Sniper Rifle, RPG,
  Netherite Sword). Everyone starts on the first, alone in the first hotbar slot, locked and
  selected (a crossbow's 8 arrows sit just above the hotbar). A late joiner starts on the lowest
  weapon anyone's on.
- **Moving up:** a kill whose last hit came from the weapon you're on moves you to the next, a tick
  later (once the shot is done), magazine full; chat says which ("Next: the SMG (2 of 11)") with a
  chime. A shot fired before you moved up doesn't count again, so one rail beam or rocket through
  two players moves you once. Everyone hears when someone reaches the last weapon, and the first
  kill with it wins.
- **Melee:** a hit with a fist, or a bash with whatever's in hand, takes 5 health (a quarter of 20,
  the config's `meleeHits`); the Netherite Sword and a crossbow's arrow kill in one hit. A melee
  death puts the victim back one weapon (the killer stays where they are), and so does dying with
  nobody to credit (falling out of the map, your own rocket); never below the first. The kill feed
  adds "(back one weapon)". Leaving costs nothing.
- **Health** comes back only by respawning (no natural regeneration); saturation keeps everyone
  able to sprint.
- **HUD:** the held gun's ammo in the text bubble top right, the clock, and in the skull box how
  far up you are (the kills that counted). The Sniper Rifle's scope as in Gunfight.
- **Time up:** the furthest up the ladder wins, then the most kills; otherwise a draw.
- **The win** says only who won: no reason after it (the first kill with the last weapon says it all).
- **Stats:** kills, deaths and wins, and Headshots.
- **Maps:** One in the Quiver's (`map.borrow`). It has no picture of its own yet: the lobby shows the
  stand-in until one is taken. Previews: open a Quiver map in Edit, Preview, Play as Gun Game.

## Chameleon

Hide and seek where the hiders wear the blocks around them: 2 to 8 players, one seeker (picked in
the lobby's team form, where the only button is Seekers, else dealt at random) and everyone else
hiding. `games/chameleon`.

- **The hide:** after the countdown at the team spawns, the seekers wait at theirs, unable to move
  and blinded, for the map's Hide time (its `hideSeconds` setting in the map editor's Game settings
  tool, 30 seconds unless set); nobody can be hit meanwhile. Then "Ready or not!" and the seek runs
  on a 5 minute clock.
- **Hotbars** (handed out by the game, each item named and locked in its slot): hiders get Wear
  block, Pose, Lock position, Taunt and Free look with the first slot free, and weakness; seekers
  get the Pump Shotgun and the Detector. Each ability is the game's own item
  (`minecade:chameleon_<ability>`, `scripts/abilities.ts`) with its own icon in the ability's old
  wool color: a block, a figure striking a pose, a padlock, a megaphone, an eye and a radar screen
  (`tools/assets/chameleon-items.ts` draws them into the game's packs). The map editor's mannequins
  hold only the shotgun, since Edit mode doesn't load a game's own items.
- **Finding:** the seekers' Pump Shotgun never runs out or reloads (only its fire rate holds it
  back) and hits only hiders, or a hider's free look stand-in, which brings that hider back to it;
  shots pass through other seekers. One pellet that lands finds a hider, at any range (the user's
  ask, 2026-11-13). A hider shot down "was found by" the seeker and, 3 seconds
  later, comes back at the seekers' spawn as a seeker. A hider who falls out of the map is found
  too; a seeker who does just comes back. A seeker's own hits do nothing.
- **Hiders hitting seekers:** throws the seeker the way the hider faces, about as far as knockback 5
  would, and takes half a heart, never the last; the same seeker can be thrown again after half a
  second (the config's `hiderHit`).
- **The Detector:** right click for how near the nearest hider (or stand-in) is: beeps, more and
  quicker the nearer, and a word in chat (Hot within 8 blocks, Warm to 16, Cool to 32, Cold past
  that), then 10 seconds before it works again. While it's held, the experience bar empties as the
  wait runs out and the level shows the seconds left (the config's `detector`).
- **HUD:** the clock, and how many hiders are left top right. Every hider's costume is a picture on
  the right (the chameleon pack's); a found hider's goes.
- **The win:** the seekers, once every hider is found; the hiders, when the clock runs out with any
  of them still hidden, or if every seeker leaves. Alone (a test with `DEV_MIN_PLAYERS=1`) you hide,
  and the match runs until the clock does.
- **The hiders' side** (wearing a block, the poses, the close camera, Lock position, Taunt, free
  look's stand-in, being seen by other hiders only up close, the costume pictures) is the chameleon
  pack, a private pack in `games/chameleon/private_packs/` (its README) that the workshop's
  chameleon-test project builds and installs, since it copies Minecraft's player files and textures.
  It knows a hider by their Wear block item and a seeker by their Detector, and the game tells it the
  rest by script events (`PACK_EVENTS`: a match is on, bring a hider back, a hider is found). Free
  look's stand-in is tagged with its hider's name. Without the pack the game plays, and the hiders
  look like themselves.
- **Maps** need a spawn for the seekers and one for the hiders. It has no map or picture yet.

## The prompt form

Build Swap and Guess the Build have every player write prompts before the match, in a live form
like the kit form (minigame-core's `src/building/prompt-form.ts`, which Guess the Build's guess form
uses too):

- **On it:** a status line (who's still writing, or how many, and the time left), the text boxes (Build
  Swap's Build prompt and Twist prompt, Guess the Build's Build prompt alone, each with a short
  example under its label), a line for what's wrong with an answer, then Submit and Skip. All plain
  text: a live form takes no color codes.
- **Answers:** Submit takes any box or all, each up to 50 characters (color codes are taken out);
  with every box empty it asks for a prompt or a skip. Skip takes nothing. Either one closes the
  form for good, and the player sees "Waiting for N players" on the action bar.
- **Staying open:** closing the form brings it back within half a second, until the player submits
  or skips. After 2 minutes (`promptSeconds`), whoever hasn't answered is skipped and the match
  starts. A preview's fake players get no form.
- **Text filter:** what's typed goes through Minecraft's filter for the writer (`getFilteredText`),
  and is taken as typed when the filter is off or doesn't answer within 3 seconds.
- **Where answers go:** into the prompt bank (README, "The prompt bank") for a later match, never
  this one (the user's ask, 2026-11-13): nothing written in this match's form is dealt in it, nor
  anything that says the same, so nobody knows what someone else is building or guessing. Each
  prompt dealt is, at even odds, a fresh one from the bank (written in an earlier match, never dealt)
  or one played before (the bank's dealt ones and the game's own list), the other kind when one runs
  out (`deal()` in `building-game.ts`, `dealPrompts()` in `prompts.ts`).

## The building games' tools

Build Swap and Guess the Build share these (minigame-core's building kit, `src/building/`:
`building-game.ts`, `selection.ts`, `commands.ts`). Everything here works only while building, and
only inside the area being built:

- **Blocks that fall stay put:** concrete powder, sand, red sand, gravel, the anvils and the dragon
  egg become their twin the tick they're placed (`minecade:still_<id>`, the same look and name, no
  gravity; `still-blocks.ts`, drawn by `tools/assets/still-blocks.ts` into each game's packs). A
  block that falls would otherwise turn into a falling block entity two ticks later, which the game
  removes like anything spawned, so it vanished. An anvil keeps its facing; a twin doesn't open the
  anvil screen or turn concrete powder into concrete in water.
- **/wand** gives the selection wand, a wooden axe named Selection Wand (any wooden axe works). Left
  click a block for the first corner, right click one for the second; neither breaks nor strips
  anything. A corner outside your area is refused. Chat says each corner, and the selection's size
  once both are set. The selection shows as yellow dots on its edges (core's `drawOutline`, the map
  editor's Select outline), to its builder alone, while they look its way. Corners are forgotten
  each round.
- **/set `<block>`** fills the selection; **/replace `<from>` `<to>`** swaps one block for another
  in it (a block that falls goes in as its twin, and `/replace sand ...` takes the twins too). Both
  autocomplete block names and say how many blocks changed.
- **/fix**, standing in water or lava: the pool around you turns still and level, as WorldEdit's
  `//fixwater`: every block of that liquid or air joined to where you stand, never higher, within 7
  blocks and inside your area, becomes a still source.
- **Why one slash:** Bedrock reads WorldEdit's `//wand` as a command named `/wand` and stops at the
  second slash ("Unknown command: /"), so `//` can't work; measured in `spike/commands`
  (docs/spike-results.md, "Custom command names").
- **Voting:** a voter who still hasn't voted 10 seconds after a build shows (`voteNagSeconds`) gets
  a big "Vote!" title and a wither's roar, again every 10 seconds until they do.

## Guess the Build

Telephone with building (`games/guessbuild`). Before the match everyone writes one prompt (or skips),
then the map's arena is copied once per player (docs/maps.md). Everyone sits in a shuffled circle
and owns a chain: a dealt prompt (what the players wrote waits in the prompt bank for a later
match, so nobody knows what the others are building or guessing; the user's ask, 2026-11-13), never
one written in an earlier match by anyone who works on that chain, living in their copy of the
arena. The steps go round the circle, one fewer than players, so everyone works once on every
chain but their own and never sees their own chain's prompt until the end (`chains.ts`):

- **Build steps** (the first, third, ...): everyone builds the latest text of the chain they're on,
  the next player's prompt first, then the guess before them, in that chain's arena. 10 seconds to
  read it (the title, and the line top right), then the lobby's Build time (3 or 5 minutes) with the
  building tools. From the second build on, the arena's build area is put back as the map made it
  first; each build is saved when its time is up.
- **Guess steps** (the second, fourth, ...): everyone moves to the chain they're on and looks at its
  last build, with the paper (named Guess) locked in their first slot: right click brings up the
  guess form, one box (Your guess), Submit only. It also comes up on its own 15 seconds in
  (`guessLookSeconds`) for whoever hasn't guessed. From then on, a player who still hasn't guessed
  and doesn't have the form up (closed it, or it couldn't show) gets a big "Guess!" ("Use the paper
  to write what it is") and a wither's roar every 10 seconds (`guessNagSeconds`), like Build Swap's
  voters (the user's ask, 2026-11-13). A guess can be changed with the paper until the
  45 seconds (`guessSeconds`) are up, or the step ends once everyone has guessed. Whatever's typed
  but not submitted when time's up counts; no guess at all means the next builder builds what the
  build before was built from. A guess whose builder left has nothing to look at: that player waits.
- **The showcase:** chain by chain in a random order, everyone in its arena. Its prompt shows top
  left (notes), each build is put back for everyone but its builder to vote 1 to 5 (the terracotta
  blocks, as in Build Swap, 3 seconds after the last vote to change it), and each guess shows by its
  guesser's name, as a title and in chat: "A guessed it was a boat" (4 seconds, `revealSeconds`),
  added to the notes. A chain that ends on a guess shows "It started as" and its prompt last.
- **The end:** builders stay anonymous until then: chat shows the standings, each player hears what
  each of their builds earned, and the winner's best build is put back with everyone there to see
  it. The most points wins; no votes at all is a draw.
- **Maps:** Build Swap's (it borrows them), or its own, of the same kind. A match needs a copy of
  the arena for every player: if the server can't keep them all loaded, the match stops.

## Countdown sounds

A game's frozen countdown at the spawns is `countdownSeconds` (5 unless it says; Build Swap has none,
since everyone already starts in their own area and the first prompt shows at once).
Every countdown (the match start, each round, and the lobby's countdown before sending players) plays a tick
for each second, a bell for 3, 2 and 1, and a flourish with "Go!" (`CHIMES` and `countdownChime()`
in `hud.ts`). Games can play them too with `this.chime("bell")`.

## The core resource pack

`packages/minigame-core/resource_pack/` goes to every server, before the server's own pack: the
HUD clock, the loading screen, and art more than one pack uses (the logo, the stars). The build stamps every resource pack's version from a
hash of its files, because clients cache server packs by UUID and version and would otherwise keep
an old copy. Images come from `tools/assets/make-assets.py` (Pillow): rerun it after changing the
art and commit the PNGs it writes.

**The loading screen** while a world loads (joining a Minecade server, a transfer between them)
shows the star field instead of vanilla's dirt, and Minecade's logo instead of Minecraft's.
`ui/progress_screen.json` points the world loading screens at a tiled `stars.png` (vanilla
darkens its dirt with a gradient; ours has none), and `ui/ui_art_assets_common.json` swaps the
logo (`common_art.title_image`, so the pause menu shows it too), keeping its shape. Both merge into
the vanilla files. A server's packs only apply once the player is joining it, so the screens
before that ("Locating server", downloading packs) are the player's own and stay vanilla.

**Locked items look like any other item** (the default everywhere: kit items, Quiver's arrows, the
map editor's map menu). Vanilla marks a locked item three ways, and the core pack removes all
three: the red or yellow corner on its slot (`textures/ui/item_lock_red` and `item_lock_yellow`
are blank), the lines under its name in the hotbar and the inventory ("Can't Move Items can't be:
moved, dropped, removed, crafted with", "This item is not lost on death"), and "Can't move item"
above the hotbar when one is moved (`common.item_lock_notification` is hidden in
`ui/ui_common.json`). The lines are a reset code (`§r`) in `texts/en_US.lang` and `en_GB.lang`,
which draws nothing: blank values didn't take in the client (it kept vanilla's text). The item's
name above the hotbar (`hud.item_name_text_root` in `ui/hud_screen.json`) shows only its first line
too, so the box stays one line tall whatever the lines say. A game never needs to do anything for
this: lock items as usual (`lockMode`, `keepOnDeath`).

**Effect icons are hidden on every server** (the core pack's `ui/hud_screen.json` removes
`mob_effects_renderer` from the HUD). A lock-in queue (and the camera view, and a shared spawn)
makes players invisible with an effect, and the HUD draws every effect's icon as one piece, so the
invisibility one can't be hidden alone. A kit's effects don't show either.

## The lobby terminal

The lobby's menus live on a terminal in the middle of the lobby, not on items. One player uses it
at a time; a public hologram above it shows everyone what they're doing.

| Screen | The terminal's user sees | Everyone sees (the hologram) |
|---|---|---|
| Idle | nothing | The logo frame, "Tap the terminal", until someone first uses the terminal. After that, the last screen stays up between sessions, and the main screen after a game starts |
| Main | The themed menu: logo, Play and Stats side by side | The logo frame, Play and Stats, the chosen one lit |
| Play | A scrolling grid of game tiles, 4 across, 80% of the screen's height, laid out like the game screen's map tiles: the game's 16:9 picture in a frame, its name over a dark fade at the bottom, and under the name, smaller and darker gray, a player icon and the players needed (red when there aren't enough) | "Choose a game" and the game names, dimmed when there aren't enough players |
| Game | Left: the game's name and info, a red warning when there aren't enough players, the Random map switch (on at first), the settings (Teams: Pick or Random for team games, then the game's own options) and Start, scrolling under the name and info. Right: scrolling map tiles, 2 across, each a 16:9 preview with the name over it; dimmed while Random is on, the chosen one outlined when it's off. Clicking a tile turns Random off and picks that map | Across the top, as wide as the frame allows: the chosen map's preview (or the "No preview" placeholder), or the game's picture while the map is random. Under it, two columns starting at the same height: the game's name and the players it needs on the left, and a table of "Map:" and each setting (up to 3) in white with the answers in yellow on the right. No map list or Start (only the terminal's user picks those) |
| Teams | After Start on a team game set to Pick, with more than two players, **every player in the match** gets a live team form (see below) | The game's name, each team and its players in the team's color, who's still random, and when teams lock |
| Starting | Nothing on screen (a chat message says who started what); the countdown chimes play for the players in the match | Centered: "Starting Sumo", the map and "Getting the server ready" while its server boots (after the team picks, for team games), then "Starting Sumo in", the seconds left in big yellow numbers, and the map |
| Stats list | A scrolling list of everyone with stats, each with their letter badge; you first, marked "(me)", even with no stats yet | "Stats" and the players' names, the viewer first but without "(me)", up to 7, then "+N more" |
| Player stats | Left: the player's badge (where their 3D skin goes later, see `docs/skins.md`) and a tab per view: Global, then each game they've played. Right: their name, their rank in the open view, and their stats as tiles in three columns: Results, Combat, More | A grid. Top row: the badge on the left; beside it the open tab's name (yellow), the player's name and their rank. Below: the open tab's stats as a table across the panel, the same three columns of value over label |

The back arrow (top left of every menu, white) and Esc go back one step (game screen to grid to
main menu, player stats to the list to the main menu); on the main menu they end the session. The
X (top right of every menu, white, red when hovered) leaves the terminal from any menu. It's every
themed menu's first button (marked `MARK.close`), and `menuChoice()` in `game-screen.ts` turns it
into `CLOSE`, so the scripts can tell it from the back arrow.

The terminal remembers where each player was (`Memory` in `terminal-controller.ts`) until a game
starts. However a session ends (the X, Esc on the main menu, walking away, timing out, or leaving
the lobby), the player's next tap opens the menu they were on, and each game's screen keeps their
Random switch, map and settings. The stats screens open on the player and tab they had open,
until they go back to the list. The hologram keeps the last screen up between sessions. Once a
game starts (the players are sent), everyone starts over: the hologram shows the main screen, the
next tap opens the main menu with every game's first choices, and the stats screens open on the
list. A start that fails keeps everything. A game running when someone taps still sends them to
the main menu.

**Pieces:**

- **The console:** nine `minecade:terminal` blocks (`lobby/behavior_pack/blocks/terminal.json`),
  one block type with a `minecade:part` state from 0 to 8 (reading order from the north-west
  corner). The top faces are drawn for the north-west corner and the north edge, and each part
  rotates its block. The center is the glowing projector. Tapping any part calls the
  `minecade:terminal` custom component, registered in `main.ts` at startup.
- **The hologram:** one `minecade:holo_display` entity (`behavior_pack/entities/holo_display.json`,
  `resource_pack/entity/...`). Its model is one 3x3 panel copied to all four sides by rotating it
  (`panel_s`, `panel_e`, `panel_n`, `panel_w`), so every side shows the same, unmirrored picture,
  plus a projection beam. The panel is a flat cube at z = +24 whose south face points outward,
  with its UV running normally (`"uv": [0, 0], "uv_size": [48, 48]`).
- **Frames:** the hologram has two background frames, picked by the client-synced
  `minecade:screen` property from `Array.screens` in
  `render_controllers/holo_display.render_controllers.json` (the order must match `FRAMES` in
  `scripts/hologram.ts`): `frame_logo` (the logo up top, for idle and main) and `frame_panel`
  (everything else).
- **Layouts:** each screen's hologram recreates its form. `scripts/holo-content.ts` builds a list
  of text elements, each placed on the panel (`x` and `y` in blocks from the middle, -1.5 to 1.5,
  as its reader sees it) with a size, a tone or team color, and what it stands for: a button, the
  selected (open or chosen) one, or a stat's tile. `scripts/hologram.ts` keeps 48 text shapes
  (`TextPrimitive`s) per side and places them. Text never gets a background, because a solid
  background hides the hologram's glow: buttons are light blue, the selected one yellow. The
  builders take the same views the forms use, so a form and its hologram can't drift apart.
  Positions and sizes are in `HOLO_LAYOUT` in `holo-content.ts`; tune them there if text overlaps
  or redrawn frames need it elsewhere. Colors are in `TONES` and `BOX_COLORS` in `hologram.ts`
  (text isn't blended with the glowing panel, so they show as they are).
- **Fitting text:** text is placed by its middle, and there's no way to measure it, so
  `textWidth()` estimates widths from the default font's character widths in font pixels (most
  characters are 6, a space 4, "l" 3, "i" and ":" 2; the table is `ADVANCES`), at 0.024 blocks
  per font pixel at scale 1 (`HOLO_LAYOUT.pixel`, measured in game). Per-character widths matter
  for left-aligned text: with a flat width per character, lines with spaces and colons started
  further right than their neighbors. `fitScale()` shrinks text to fit a width (down to a
  minimum), `truncate()` cuts what still doesn't fit with "..", `wrap()` splits long game names
  onto two lines, and left-aligned text is placed half its width right of the left edge.
- **The safe edge:** the frame's border and corner brackets sit about 0.1 blocks inside the
  panel's edge, so text stays within 1.25 blocks of the middle (`HOLO_LAYOUT.edge`). The layout
  tests check that no text runs past it (with a little slack) by the width estimate.
- **Previewing layouts** (`DEV_HOLO_PREVIEW=1` in `.env`): the terminal's main menu gets a small
  Preview button in its corner. It lists every hologram screen (`scripts/holo-preview.ts`); pick
  one, the form closes, and that screen stays on the hologram with sample data until the terminal
  is tapped again, so you can walk around it without a form in the way. It also keeps the game
  screen layouts tried before: a taller picture with its sides cropped (`gameContent(view,
  "tall")`), and the old layout with the picture in the top right corner (`gameCornerContent()`).
  The terminal uses `gameContent(view)`.
- **Which way text faces:** a `TextPrimitive`'s y rotation is the direction its reader faces, and
  it turns the opposite way from Minecraft's player yaw: 0 is read facing south, 90 facing east,
  180 north, 270 west (measured in game). Text on a side is read from outside, facing the middle,
  so `readerYaw()` in `hologram.ts` gives the south side 180, the west 90, the north 0 and the
  east 270.
- **Pictures:** the model has two picture spots on each side, fixed in
  `models/entity/holo_display.geo.json`:
  - **The picture:** on the game screen, the chosen map's preview, or the game's picture while the
    map is random. The `minecade:picture` property picks it from `Array.pictures` (`holo_picture`
    render controller). `holoPictures()` in `packages/minigame-core/src/registry.ts` makes the list
    (none, the placeholders, then every game's picture and map preview), up to 256.
  - **Where the picture goes:** the game screen puts it across the top (the banner: full 16:9,
    2.72 blocks wide, y -0.17 to 1.36, just inside the frame's corner brackets). The Preview menu
    keeps two spots tried before: a taller banner (y -0.39 to 1.36) that crops 6.25% off each side
    of the picture (its bones' UV starts at 3 of 48 and spans 42) instead of stretching it, and
    the top right corner (16:9, 1.2 blocks wide). The `minecade:picture_spot` property picks the
    spot (0 the corner, 1 the banner, 2 the taller banner; `pictureSpot` in the content), and the
    `holo_picture` render controller shows the `picture_*`, `banner_*` or `tall_*` bones to match.
  - **The portrait** (top left, square, 0.75 blocks, top-aligned with the title): on a player's
    stats, their badge. The `minecade:portrait` property picks it from `Array.portraits`
    (`holo_portrait` render controller), listed by `holoPortraits()` (none, then every badge).

  The build writes both lists into the pack, and the lobby looks pictures up in the same lists.
  The model's x runs opposite to the reader's left and right: the picture (on the reader's right)
  has negative x in the model, and the portrait (on the reader's left) positive x.
- **Placement:** the map's `points.terminal` is the middle console block. At boot the lobby
  keeps that area loaded (a ticking area), places the console and spawns the hologram, and
  checks every 5 seconds that they're still there.
- **The lock:** `TerminalController` (`scripts/terminal-controller.ts`, unit-tested with ports).
  The session ends when its player closes the menu, starts a game, leaves, walks more than 8
  blocks away, or leaves it alone for 2 minutes.

**Columns of buttons:** a form's buttons are one list, but the themed layouts sort them into
columns by a mark at the start of each button's text (`MARK` in `scripts/game-screen.ts`,
formatting codes ending in `§r`, so they never render). In `ui/minecade_forms.json`, each column
is a stack panel that makes an item for every button and shows only the items with its mark; a
hidden item takes no space. The game grid alternates its tiles between four columns. The game
screen's buttons come in this order: the Random map switch (`MARK.toggle`, plus `MARK.on` while
it's on, which swaps its switch picture), the settings, the maps (alternating between the two map
columns; `MARK.dim` darkens them while Random is on, and `MARK.selected` outlines the chosen
one), then Start. `gameButtons()` says what each one does, so the terminal knows what was pressed
from its place in the list. Start sends `start_game` with the map (Random's pick when Random is on;
everyone still hears "a random map") and the settings, the orchestrator passes the settings to the
game server, and a game reads them from `ctx.vars.settings`.

**Booting ahead:** while the game screen is open, its game's server boots on the map in effect,
so Start is quicker. Random picks its map when the screen opens (or when Random is turned back
on) and keeps it. Once the map has stayed put for a second (`PREPARE_TICKS` in
`terminal-controller.ts`; tapping through maps boots only the last), the lobby sends
`prepare_game`, and the orchestrator starts the game's container with `AWAIT_START`: its script
boots and waits. Start for that game and map adopts it: the orchestrator sends the game
`configure` (the settings and players) as soon as its pack is up, the game builds its match and
answers `configured`, and the lobby hears `game_ready`. Another map replaces it; leaving the
screen any way but Start (back, the X, walking away, timing out) sends `cancel_prepare`, and it
also goes after 3 minutes unused. It's removed at once (nobody is on it), and it never shows in the
orchestrator's status. A game that can't start (too few players, one already on) boots nothing
ahead. The start's timings show the boot that came before Start as negative times.

**Team picks in the lobby:** for team games where players pick (Teams: Pick on the game screen),
players pick in the lobby while the game server boots, so no time is lost on the game server.
- **Two players don't pick:** with only two players going, there's nothing to choose, so nobody
  gets the form: the lobby sends the start as Random, and the game puts them on teams of their own
  at random.
- **Roles:** a game whose teams are roles (a team of a fixed size: Chameleon's one seeker) has the
  Teams setting too, and its form offers only the fixed-size roles (Seekers), each up to its size:
  whoever wants to seek takes it, and everyone else is dealt (the user's ask, 2026-11-11). Two
  players get the form as well, and it locks as soon as the roles are full (after the 5 seconds at
  least), else at 10 seconds.
- **The form:** right after Start, every player in the match gets a live team form. It's a
  data-driven `CustomForm` from `@minecraft/server-ui` (`scripts/team-pick-form.ts`), the newer
  kind of form whose text updates while it's open and whose buttons don't close it. It renders in
  Ore UI, so the resource pack can't theme it.
- **On it:** each team with its players and count ("2/3"), a Join button per team (disabled when
  the team is full), a Random team button, and a status line.
- **Plain buttons:** each team's button is Ore UI's own, under its text: "Join Red", "On Red" on
  the player's own team and "Red is full" (both disabled), then "Random team" (disabled while the
  player has no pick). Ore UI's buttons can't take a color, and their text shows color codes as
  they are, so they're white. From 2026-11-02 they were clickable pictures in the team's color
  instead (the build still draws them into the lobby pack: `tools/build/team-buttons.ts`,
  `teamButtonPath()`), but on 2026-11-13 the user found that pictures don't show in a live form at
  all: every team game's form had only the teams' text and nothing to tap, so nobody could pick.
  The form is plain buttons since then.
- **Rules:** the teams and caps are the game's own (`activeTeams`, and `ceil(players / teams)`
  per team, as `assignTeams` honors), worked out in `scripts/team-picks.ts`. A player who leaves
  the lobby loses their pick. Someone who closed the form gets it back by tapping the terminal.
- **When teams lock** (`scripts/team-pick-controller.ts`, unit-tested with ports): once the game
  server is ready, and everyone has picked or 20 s have passed, but never before 5 s. Then the
  forms close, the lobby sends `team_picks` to the orchestrator, which forwards it to the game
  server, and the usual countdown and transfer run.
- **On the game server:** `Minigame.setTeamPicks()` keeps the picks for when the match begins.
  Players without a pick are dealt out randomly, and picks over a team's cap move to another team.
  With Random, nobody picks. Teams are only picked in the lobby: a start that doesn't come from
  the lobby's game screen (the debug API, a preview) deals them all at random. Either way they're
  dealt as soon as everyone is in, before the kit form and the countdown, so players wait at their
  own team's spawns. (The game's nether star is for kits now, not teams: see the kit form.)
- **The hologram:** while teams are picked it shows them, and it stays on the starting game until
  the players are sent; then it shows the main screen.
- **Why a live form here, unlike the other menus:** a classic form (the themed menus) closes on
  every click and can't change while it's open, so every change means showing the form again.
  For team picks, players would only see each other's picks after their form reopened, and every
  pick would close and reopen everyone's form. The live form updates in place and its buttons
  don't close it; the cost is that it can't be themed.
- **If live forms become stylable:** if a future Minecraft update lets resource packs style these
  live forms the way JSON UI styles classic forms, move the themed menus (main menu, game grid,
  game screen, stats) to live forms too, so they update in place instead of reopening on every
  click.

**Stats screens** (`scripts/stats-controller.ts`, `scripts/stats-screens.ts`, unit-tested with
ports):
- **The list:** Stats on the main menu asks the orchestrator for everyone with stats
  (`stats_query` with `kind: "players"`) and lists them by name, with you first, marked "(me)",
  even before your first match that counts.
- **A player:** picking one asks for their overall stats, the games they've played and their
  rank. Each tab (Global, then each game, most played first) is asked for once, then remembered
  while the screen is open.
- **Stat columns:** the open tab's stats show as tiles (value over label) in three columns,
  `statColumns()` in `scripts/stats-screens.ts`: Results (games, wins, losses, draws, win rate),
  Combat (kills, deaths, K/D, best streak) and More (damage, time played, matches left early, and
  the game's own counters). Draws and matches left early only show when there are some. The tiles
  are form buttons marked for their column (`MARK.stats`), drawn as plain tiles, so they can't be
  clicked.
- **Ranks:** the orchestrator ranks everyone with matches that count by wins, then win rate, then
  kills (`StatsStore.rank`). Players equal on all three share a place. Global leaves co-op games
  out, as the totals do.
- **Which matches count:** matches with at least 2 players, or co-op games.
- **Testing alone:** `DEV_DEMO_STATS=1` in `.env` fills the stats with made-up players and matches
  (`orchestrator/src/stats/demo.ts`), kept in memory only. The real stats database isn't read or
  changed while it's on.
- **Badges:** until players' skins can be shown (`docs/skins.md`), each player has a letter badge
  by their name's first letter or digit (`badgeFor()`).

**Game options:** a game can offer its own settings on the game screen with `options` in
`game.config.ts`. Each value has a label; the first is the default. The build checks the ids
(lower camelCase, as the orchestrator passes them on) and allows at most 8 settings, Teams
included. Each setting's button shows its value and, under it, a bar per value with the chosen one
bright (`settingBars()` in `scripts/menus.ts`, drawn with font glyphs). Probe is the test game for
all of this: it has two teams (so Teams: Pick or Random, and the team form) and a Round setting
that really sets its stage length. Its three kits test the kit form's pictures: Soldier (nine items
and iron armor: eight items, then the armor), Builder (nine items, no armor) and Scout (three items
and leather in the team's color). The lobby lists it only while `DEV_TEST_GAMES=1` (its config has
`test: true`). It needs 2 players, so set `DEV_MIN_PLAYERS=1` to test alone.
When the match starts, Probe says the settings it got and who is on which team. Its Chameleon kit
is the chameleon test's hider hotbar as named wool (Wear block, Pose, Lock position, Taunt, Free
look, with the first slot free to hit seekers with; `/chameleon:role` switches to a seeker's, the
Pump Shotgun and a Detector); the test is a private pack (`games/probe/private_packs/README.md`) that the workshop's
chameleon-test project installs, and Round 20 min gives it time.

```ts
options: [
  { id: "round", label: "Round", values: [{ value: "15", label: "15 s" }, { value: "30", label: "30 s" }] },
],
```

**Waypoints:** every game server starts with nobody on the locator bar (the dots over the hotbar
that point to the other players: the `playerWaypoints` game rule set to `off`). A game can let the
game screen choose, with `WAYPOINTS_OPTION` from `@minecade/minigame-core/config` in its `options`:
a Waypoints setting, Off at first, where On shows everyone there (`everyone`). One in the Quiver
has it. The lobby keeps the locator bar as it is.

**Demo games:** to test the menus with more games than exist, set `DEV_DEMO_GAMES` in `.env` (up
to 12). The lobby lists that many made-up games (`scripts/demo-games.ts`) after the real ones,
with placeholder pictures, several maps (one has 9, so the map column scrolls), and some team and
option settings. They can't be started.

**The player icon** on the game cards is a font glyph: `lobby/resource_pack/font/glyph_E3.png` is
a page of 16x16 cells for the characters U+E300 onward, and `GLYPH` in `scripts/menus.ts` names
them (cell 0 is the player icon). Glyphs can go in any text a form shows.

**JSON UI notes for these layouts:** a factory's collection only works on a `stack_panel`, `grid`
or `collection_panel` (on a plain panel, `collection_index` is silently ignored, and every item
shows button 0). Scrolling areas reuse vanilla `common.scrolling_panel`. The back arrow is vanilla
`common.close_button` with our own arrow textures (`back_*`). The X can't be a close button (that
only closes the form, the same as Esc), so it's a form button in its own one-button column
(`close_x`), anchored top right, its image swapped on hover and press. `"fill": true` on an image scales it to
cover its control and crops what overflows (even with `"keep_ratio": false`), so pictures use it
and frames never do. Sizes in percent are of the parent. Vanilla sizes the form
screen's content panel (`server_form.main_screen_content`) `[0, 0]`, which makes any percentage
inside it zero, so `ui/server_form.json` resizes it to fill the screen; then the layouts' root
(`long_form`) fills the screen too and the game grid can be `"80%"` of it. A texture with a `.json`
file next to it (`nineslice_size`, `base_size`) is a nine-slice: its outer slices keep their size
and the middle stretches. A flip book (`"anim_type": "flip_book"`, set as an image's `uv`, with
`uv_size` one frame) steps right through frames side by side, `frame_step` pixels each, and loops:
vanilla's loading bar is 640x8 in steps of 64. The map editor's loading dots
(`editor/resource_pack/textures/minecade/editor/loading_dots.png`) are one.

**Controls a binding shows start hidden.** Every control whose visibility comes from a view
binding (the menus picked by their title mark, every column item, the state pictures, and
vanilla's `long_form` in `ui/server_form.json`) also has `"visible": false`. A new screen's first
frame comes before its bindings apply. In that frame every column shows every item, so the game
screen's switch column has the X's item (button 0) right where the Random switch sits. Clicking the
switch made the menu reopen, and a second click without moving the mouse closed the terminal, most
likely because the click went to what the pointer was over in that first frame. Starting hidden
leaves nothing stale there. The X's 6-tick guard (`strayClose`) stays as a second line, and the lobby log says how long a
menu had been open whenever the X closes it. `tools/build/test/pack-json.test.ts` checks this rule in
every pack's UI files, and that every pack JSON file parses. The second click still closes the
terminal now and then; that's accepted as an edge case, and since the terminal remembers the
player's place, the next tap opens the same screen with the same choices.

**The square style:** every button (main menu tiles, game cards, settings, the Random switch, Start,
player rows, tabs) uses one set of art, `button_default/hover/pressed.png`: a 1x nine-slice, navy
with a cyan line down the left and right edges and square corners, so it looks the same at any
size. Outlines (map tiles, the chosen map, the open tab, the portrait) are square nine-slices too.
Nothing in the menus is round.

**Themed menus:** a form whose title starts with a layout mark (formatting codes that never
render, `LAYOUT` in `scripts/menus.ts`) gets Minecade's layout from the lobby resource pack:
`ui/server_form.json` merges a second form factory into the vanilla screen and hides the vanilla
form for marked titles, and `ui/minecade_forms.json` holds the layouts. Without the pack, marked
forms are plain forms with a readable title. A test checks the marks match the pack.

## The map editor's menus

The rules every editor menu follows (the user's, from 2026-10-31):

- **Side menus.** Almost every menu is a dark panel down the right side, the world in view on the
  left: button menus and forms with fields alike (a title with the side mark draws a form with
  fields there too, the game's own fields with a green submit pinned at the bottom).
- **No redundant or helper text.** Help that isn't needed once you know it goes in a tooltip: a
  button's second line (§7) shows only as its hover tooltip; an icon's tooltip; a question-mark
  icon. A tool's how-to is a **Help** link that puts it in chat, with a chime. What the mode box top
  center already shows (the map, the game) isn't repeated. Status that changes (a card's "open:
  Friend", "failed") stays visible, on a taller button (`MARK.twoLine`). The Panel's map viewer
  follows the same rule (`docs/viewer.md`, "The window").
- **Buttons** use the game's regular font (only titles use Minecraft Ten), one line, 22 pixels tall.
- **Icon rows** for actions that fit an icon (Players, Back one step, New map), with tooltips.
- **Toggles** (one choice of several: a spawn's list, what a selection is saved as, how many fake
  players) are tiles touching in a row, the one that's on green. Each tile is a third of the row,
  so a row of three lines up with the buttons under it.
- **Lists** (a choice of many, or of teams: the Game marker tool's Marker, the region screen's
  Region, a Team) are a row with "Label: value" and an arrow (`MARK.dropdown`, `dropdownText`);
  tapped, the form opens again with the options under it as plain rows, the one picked outlined
  (`optionText`), and picking one closes it. An action form sends any tap back to the script, so a
  pick always opens the form again. In a form with fields, a real list (Export's For) opens about
  five options tall.
- **Tool screens:** what a tool sets up (a spawn, a selection, kill Y) opens in its own side screen,
  the way hitting a marker does: a toggle first, then its settings, nudge rows (a minus and a plus
  each), and a green button pinned at the bottom that saves it. Closing it keeps nothing.
- **No tool opens a menu at the sky:** menus open from the map menu, or from a tool aimed at a block
  (the Spawn tool). A tool used at the sky does nothing, or acts at once (the Kill Y tool sets kill
  Y, the Camera tool places a camera). The Snapshot tool is the exception the user asked for: a use
  lists the cameras.
- **Cards** (the editor lobby's maps): two lines on the left, what it is (the game, gray) and its
  name (white) under it, with a row of icons on the right, centered on the two lines. Each icon has
  a tooltip and no face at all, not even hovered, faded (`MARK.dim`) when that step isn't done yet.
  The title isn't a button. Built like the tool grid: a column of titles (`MARK.cardTitle`) and one column per icon
  (`MARK.cardIcon` with `CARD_COLUMNS`), a card's buttons one after another so the rows line up.
  A heading row over them (`MARK.cardHead`) can carry a link with an icon on its right
  (`MARK.cardLink`: Search), white, with no face and no change while hovered.
- **Picture tiles** (the thumbnail menus): two to a row (`MARK.picture`), the button's icon as a
  16:9 picture with its name under it, outlined green (`picked_green`) while it's the one in use.
  The pictures are in the editor's pack (`tools/editor/pictures.ts`), so new ones show from the next
  server start.
- **Back to Lobby** is an icon (a house) at the right end of the icon row of every menu that can
  leave for the editor lobby. A sub-menu (Nudge sides, the Snapshot, a thumbnail menu) has a back
  arrow left of its title, opposite the X, drawn like the X: a bare white arrow with no face,
  lighter when hovered (`back_default`, `_hover`, `_pressed`). A side menu with text boxes (Export
  to Map, Name and map id) has no back arrow: a form with fields has one button, the green
  one at the bottom, so it can't hear another; the X closes it.
- **Step** (how far a nudge moves) is a toggle too, right before the nudge rows.
- **Loading:** whoever waits for another server sees the loading screen (the dots) until they're
  moved, wherever they are: the host tells the server (`loading`, `loaded`).
- **A side menu open shows the outlines** (Select), as holding the tool does.
- **Text sits in the middle of its button** (lifted a pixel: the face's dark bottom edge makes the
  middle look lower). Headings wrap rather than overlap.
- **Locked items** (the map menu, Select's tool) look like any other item, as on every server (see
  "The core resource pack").
- **Every sub-menu** (the gear, the checklist, Boundaries, a tool screen opened from the map menu, a
  camera's or a box's menu, Players) has the back arrow.
- **Previews** get the side panel too (`editor/preview/` adds the editor's form UI to a preview's
  resource pack), for a fake player's panel and Preview over (`SIDE_TITLE` and the green and red
  buttons' marks in `packages/minigame-core/src/game/preview.ts` match the editor's; a test checks).
- The step that finishes something is green; deleting or removing is red.

## How the hologram looks the way it does

The hologram PNGs are dark, but in game the hologram looks light, see-through and glowing. Two
settings do that, not the images:

- **Additive blending** (the `entity_beam_additive` material in
  `resource_pack/entity/holo_display.entity.json`): each pixel's color is added to whatever is
  behind it. Black adds nothing, so it's invisible; dark colors are a faint tint; bright colors
  glow. Transparency in the PNG doesn't matter, brightness does.
- **`ignore_lighting: true`** (in the render controllers): the hologram is always fully bright,
  day or night, in shade or not.

So when drawing hologram art: paint on black, use brightness for glow, and expect dark fills to
mostly disappear.


Adding light can't make anything darker or change what's behind it. A **backdrop** sits just
inside the panels (the `backdrop_*` bones): `backdrop.png`, a faint blue (about 14%), drawn with an
alpha-blended material (`entity_alphablend`) before the panels, so the sky behind the panels is
tinted blue before the panels, pictures and portrait add their light. That material keeps depth,
so anything drawn after it behind a backdrop plane is hidden: the beam, which runs up inside the
panels, is drawn first (its render controller is first in the list) and the backdrop tints over it. A darker color
(black at about 60% was tried first) dims a bright sky instead; more opacity makes either stronger.

**The star box** (lobby map.json `"stars": true`) uses the same additive trick at a much larger
size: a model at the terminal (`geometry.minecade.star_box`) that is four walls, a floor and a
ceiling, each 96 blocks wide (48 blocks out from the middle), facing inward, each covered by
`stars.png`. Black adds nothing, so the real night sky shows through and only the stars add light;
the sky keeps its own stars and moon behind them (the north and south walls use the warp
images instead, below). The east and west walls and the ceiling (the
`moving` bone) drift north to south, one wall width every 30 seconds, as if the lobby were flying
north: their own render controller (`controller.render.minecade.star_box_moving`) scrolls the
texture with `uv_anim`, using vanilla's `charged_creeper` material (additive like the rest, and it
repeats the texture as it scrolls). Change the `30.0` there for another speed, or flip its sign to
reverse it. The west wall's texture is mirrored so one scroll moves both walls the same way. The
ceiling is a copy of the east wall turned flat about the north-south axis, so its stars drift the
same way; it has both faces (the same stars on each), so it shows from below whichever way it
ends up facing. The box always faces south, so the direction holds.

The north and south walls **warp**: stars on the north wall spread out from its middle, as if
coming toward you, and stars on the south wall sink into its middle, as if left behind. Each wall
has four layers (`star_box_north_0` to `_3`, `star_box_south_0` to `_3`), each a different part
of one star field. A layer lives 8 seconds: it zooms from 1x to 2x about the wall's middle (2x to
1x on the south wall) with `uv_anim`, fading in over its first 2 seconds and out over its last 2,
and starts over while it's dark, so the restart can't be seen. The layers are a quarter of a life
apart, so while one fades out another is already fully in, and two are always fully in. Each
layer is its own plane (the `north_0` to `north_3` and `south_0` to `south_3` bones), a block
nearer the middle than the one before and drawn after it: on one shared plane the first layer
drawn hid the others (the material keeps depth), so only one showed, with a gap whenever it
started over.
The fade switches between `warp_1.png` to `warp_7.png` (the field at 7 brightness levels; level
0 is black), since a render controller can't dim a texture. The client entity's `pre_animation`
works out each layer's life, brightness and zoom. At the edges, the stars move about as fast as
the side walls'.

The box is drawn by the hologram's own entity (`minecade:holo_display`, its `stars` geometry), when
the map asks for it (the `minecade:stars` property, set by `hologram.ts`): its render controllers
come first in the entity's list, so the stars are drawn before the hologram's panels. Every one of
the hologram's materials keeps depth, so stars drawn after them were hidden behind the panels when
the box was an entity of its own (the order two entities draw in isn't the pack's to pick). The
entity faces south, and its model's bounds are as big as the box's, so it isn't culled when the
terminal is out of view. It
only looks right at night (`"time": "midnight"`), since in daylight the dim stars disappear into the
bright sky. On a very short render distance, fog can fade the walls 48 blocks out.

**The menus can't blend that way.** Form images (JSON UI) have no blend mode, only transparency
(vanilla's UI files have no blend setting anywhere). So the menu backgrounds copy the hologram's
look with transparency instead: a see-through dark fill (the world shows through dimly, as through
the hologram), a glowing border and corner brackets, and faint scanlines. Two JSON UI features
keep it crisp at any size: `holo_panel.png` is a nine-slice (its outer 24 pixels, with the border
and brackets, keep their size; the middle stretches), and `holo_scanlines.png` is tiled
(`"tiled": true`), repeated at its own size instead of stretched. Both are drawn together as
`holo_background` in `ui/minecade_forms.json`. The hologram frames and the menu background are
separate images, so redrawing one doesn't change the other.

## The art

Every image is a placeholder from `tools/assets/make-assets.py` (Pillow), meant to be redrawn by
hand. The script only writes images that don't exist yet (delete one to regenerate it); `--force`
regenerates all of them and overwrites any edits. Images are stretched to their display size, so
keep each one's proportions, except the nine-slice menu background, which stretches only its
middle, and the tiled scanlines, which repeat.

| Image | Shown as | Art size |
|---|---|---|
| `packages/minigame-core/resource_pack/textures/minecade/hud/clock.png` | HUD clock icon, 10x10 | 16x16 |
| `packages/minigame-core/resource_pack/textures/minecade/hud/skull.png` | HUD own score icon (kills), 10x10 | 16x16 |
| `packages/minigame-core/resource_pack/textures/minecade/hud/scope.png` | The Sniper Rifle's scope while aiming: a square as tall as the screen, in its middle, the screen's own crosshair over its center | Any square (the first is 512x512): clear where you see through, opaque black around the circle so it meets the black sides. The first draft is from `tools/assets/scope-hud.ts`, not make-assets.py; it too only writes a missing file (`--force` to redraw) |
| `packages/minigame-core/resource_pack/textures/minecade/hud/black.png` | Fills the screen either side of the scope | Any size, plain black |
| `packages/minigame-core/resource_pack/textures/minecade/ui/logo.png` | Main menu logo, 232x50; the logo on every server's loading screen and pause menu | 1072x240, transparent background |
| `lobby/resource_pack/textures/minecade/ui/holo_panel.png` | Every menu's background (main menu 300x116, game grid 460 wide by 80% of the screen, game screen 460x250) | 64x64 at 1x, nine-slice (`holo_panel.json`): the outer 24 pixels hold the border and corner brackets and keep their size, the middle stretches; partly transparent |
| `lobby/resource_pack/textures/minecade/ui/holo_scanlines.png` | Scanlines over every menu's background, tiled (repeated at 1 pixel per pixel) | 4x3, one faint line on top, the rest transparent |
| `lobby/resource_pack/textures/minecade/ui/icon_play.png`, `icon_stats.png` | Button icons, 20x20 | 64x64 |
| `lobby/resource_pack/textures/minecade/ui/tile_map_default.png`, `_hover`, `_pressed` | Map and game tile frames, drawn over the preview or the game's picture, 104x58; the picture sits inside the 2 pixel border (100x54) | 16x16 at 1x, nine-slice (4 pixel slices): a 2 pixel square outline, transparent middle (a light tint on hover and press) |
| `lobby/resource_pack/textures/minecade/ui/tile_map_selected.png` | Drawn over the chosen map's tile, 104x58 | 16x16 at 1x, nine-slice: a white 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/tile_dim.png` | Darkens the map tiles while Random is on, 100x54 | 8x8, black, partly transparent |
| `lobby/resource_pack/textures/minecade/ui/fade_bottom.png` | The dark fade under a map's name, stretched over the tile's lower half | 8x64, black, transparent at the top |
| `lobby/resource_pack/textures/minecade/ui/map_placeholder.png` | The preview of a map without its own (on its tile and the hologram) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/game_placeholder.png` | The picture of a game without its own (demo games) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/button_default.png`, `_hover`, `_pressed` | Every button: main menu tiles (136x34), the Random switch, settings and Start (210x28), player rows, tabs | 16x16 at 1x, nine-slice (4 pixel slices): navy, a 2 pixel cyan line down the left and right edges, square corners |
| `lobby/resource_pack/textures/minecade/ui/back_default.png`, `_hover`, `_pressed` | Every menu's back arrow, top left, 15x15 | 15x15, a white arrow (light blue on hover) |
| `lobby/resource_pack/textures/minecade/ui/close_default.png`, `_hover`, `_pressed` | Every menu's X, top right, 15x15 | 15x15, a white X (red on hover, dark red pressed) |
| `lobby/resource_pack/textures/minecade/ui/toggle_on.png`, `toggle_off.png` | The Random map switch, 26x13 | 52x26, a square track with a square knob |
| `lobby/resource_pack/textures/minecade/ui/tab_selected.png` | Drawn over the open tab on a player's stats | 16x16 at 1x, nine-slice: a white 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/portrait_frame.png` | The frame around the portrait on a player's stats, 96x96 | 16x16 at 1x, nine-slice: a cyan 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/stat_tile.png` | Behind each stat on a player's stats, 90x27 | 16x16 at 1x, nine-slice: dim navy, no lines (so it doesn't look clickable) |
| `lobby/resource_pack/textures/minecade/badges/a.png` to `z.png`, `0.png` to `9.png`, `other.png` | Player badges: 20x20 in the stats list, 88x88 as the portrait on a player's stats and about 0.9 blocks on the hologram (where their skin goes later) | 64x64, a square |
| `lobby/resource_pack/font/glyph_E3.png` | Icons inside text, about the height of a letter: cell 0 (U+E300) is the player icon on the game cards; cells 1 and 2 (U+E301, U+E302) are a setting's bars under its label, bright for the chosen value and dim for the others | 256x256, 16x16 cells, on transparent |
| `games/<id>/icon.png` | The game's picture: on its card (60x34) and on the hologram (2 blocks wide) while the map is random | 320x180 (16:9); a game without one shows the stand-in picture (the build warns) |
| `packages/minigame-core/resource_pack/textures/minecade/hud/round_open.png`, `round_<code>.png` | The best-of rounds circles, 8x8 top right: white for a round to play, then the winner's color (`c`, `9`, `a`, `e`, `6`, `d`, `b`, `2`, `f`; `7` gray for a drawn round) | 16x16 pixel art, a filled circle with a darker rim |
| `packs/guns/resource_pack/textures/minecade/guns/<kind>/<dye>.png` | A gun's or the grenade's model texture in one paint color: in hand, thrown and landed (the grenade), and white floating as a pickup | 64 wide, box UV; written by `tools/assets/guns.ts` (not make-assets.py), which overwrites it: redraw the model there, or stop generating it first |
| `packs/guns/icons/<item>.png` | A gun's or the grenade's slot in a kit picture (the hotbar draws the model itself) | 128x128, the model drawn in 3D as a block is; written by `tools/assets/guns.ts`, outside the packs |
| `packs/guns/resource_pack/textures/minecade/guns/balls/<dye>.png`, `splash.png` | A paint ball in flight (a sprite like the snowball's), in each of the 16 dyes; the splash's drop, tinted by the particle | 16x16 and 8x8; written by `tools/assets/guns.ts` |
| `games/paintball/markers/powerup.png` | The map editor's Power-up spot marker, the floating white rifle (`powerup.geo.json`) | 64 wide, box UV; written by `tools/assets/paint-blocks.ts` (not make-assets.py) from the guns pack's white rifle, which overwrites it |
| `games/bridges/resource_pack/textures/minecade/bridges/hole_<dye>.png` | Bridges' hole (3 blocks square): black walls and floor (left half), the rim's ring in the team's color (right half) | 96x48, 16 pixels a block; the ring's middle is clear |
| `games/<id>/maps/<map>/preview.png` | A map's preview on its tile (100x54) and on the hologram when it's chosen (optional) | 320x180 (16:9), such as a screenshot |
| `lobby/resource_pack/textures/minecade/holo/frame_logo.png`, `frame_panel.png` | Hologram frames, 3x3 blocks on all four sides, with live text over them; `frame_logo` has the logo up top | 512x512 (square), additive |
| `lobby/resource_pack/textures/minecade/holo/backdrop.png` | Behind the hologram's panels, tinting the sky behind them | 16x16, light blue (28, 185, 244) at about 14% (alpha 35), alpha-blended |
| `packages/minigame-core/resource_pack/textures/minecade/sky/stars.png` | The star box's east and west walls, floor and ceiling, 96 blocks wide each (it scrolls on the east and west walls and the ceiling); every server's loading screen, tiled | 512x512, stars on black, additive (black shows nothing); drawn with a fixed seed; must tile (no seams), since it repeats as it scrolls |
| `lobby/resource_pack/textures/minecade/holo/warp_1.png` to `warp_7.png` | The star box's north and south walls (four zooming layers each) | 512x512, one star field (600 stars, a different seed from `stars.png`) at brightness 1/7 to 7/7, additive; must tile; regenerate all seven together |
| `lobby/resource_pack/textures/minecade/holo/beam.png` | Projection beam, two crossed planes 2 wide by 3.25 tall | 128x256, additive, the projector at the bottom; fade the top to black so the beam has no hard edge |
| `lobby/resource_pack/textures/minecade/blocks/terminal_side.png` | Console sides | 16x16 |
| `lobby/resource_pack/textures/minecade/blocks/terminal_corner.png`, `terminal_edge.png`, `terminal_center.png` | Console tops | 16x16; the corner is drawn as the north-west corner (rims on the north and west sides) and the edge as the north edge, and the blocks rotate them into place |

The logo source is `tools/assets/source/minecade-title.png` (the orange original); the script
recolors it to holographic blue.
