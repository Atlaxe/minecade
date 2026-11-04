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
script API for placing text on the HUD, so it rides on the action bar: `hudLine()` in
`packages/minigame-core/src/hud.ts` starts the line with `HUD_MARK`, a run of formatting codes
that never renders, then the clock and anything else ("2:53   Lives: 2"). The core resource
pack's `ui/hud_screen.json` turns the action bar into a full-screen panel and shows marked lines
in a box top right, after a clock icon; unmarked lines show like the vanilla action bar. Without
the pack, the action bar just reads "2:53   Lives: 2". To see JSON UI errors in the client, turn
on Settings, Creator, Content Log GUI.

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

**Own score:** a game whose `scoring` has `display: "own"` (One in the Quiver) has no sidebar.
Each player sees only their own score (their team's in team games) in a second box left of the
clock's, with a skull and the number, its own background like the clock's. It rides on the same
action bar line: since JSON UI can't cut text out of it, `countCodes()` in `hud.ts` adds the number
at the end as more formatting codes ("§k§t§1§k§u§5§r" is 15: each place's codes, then the digit as
a code), which never show in the clock's box. The pack's box has a label for each digit in each
place, and keeps only the ones whose codes are in the line (`"ignored"`, so a 5 is one digit wide).
It shows 0 to 999. A test checks the codes match the pack. With no clock (a time limit of 0), the
score is plain action bar text ("Kills: 5").

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
is the match's, over all the rounds; with no clock at all, the clock's box goes (`§k§v`), or keeps
only the rest of the line without the clock icon (`§k§o`).

**Team scores as sides:** a game whose `scoring` has `display: "sides"` (Paintball) has no sidebar:
every team's score shows in the rounds box, as the best-of score does, each in its team's color with
gray bars between ("3 | 1 | 0 | 2", up to 99). It's for team scores (`per: "team"`) of up to four
teams, in a game without best-of rounds, which would need the same box (the build checks). Dark
green (§2, Paintball's Green) has its own color there, as the other team colors do.

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
- **On it:** a status line (who's still picking, in their team colors, and the seconds left), then
  each kit: its picture over a button with the kit's name, disabled on the player's own pick (it
  can't turn green: see Looks). Nobody sees what the others picked. The base kit everyone gets isn't
  shown.
- **Looks:** a live form renders in Minecraft's Ore UI, whose panel, buttons and fonts no resource
  pack or script can change (the layout is the client's `script_ui` pack, `ddui/root/custom_form.json`,
  and the script API has no style option). What's ours is the text, the color codes in labels, and
  the pictures.
- **Buttons take no color:** a live form ignores color codes in a button's text (a `§a` doesn't turn
  it green), so a button's text is always the form's own color. Take that as a given for now. An
  image button (`imageDetails` in the button's options) is likely the only way to color one; not
  tried yet. The team form's green "On Red" is plain text too.
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

Every server loads the shared guns pack (`packs/guns`), so any game can hand out its guns as kit
items and fire them with `Guns` from the guns package (`packages/guns`, imported as
`@minecade/guns`). The names and numbers are in `packages/guns/src/defs.ts`, which the pack's
generator reads too.

| Gun | Fires (left click) | Rate (its hotbar slot shades) | Balls | Spread aiming / from the hip | Zoom | Range |
|---|---|---|---|---|---|---|
| Paintball Pistol | One shot a click | 6 ticks | 1 | 0.5 / 2.5 degrees | 60 | 2 s of flight |
| Paintball Rifle | Again and again while the button is down | 4 ticks | 1 | 2 / 5 degrees | 50 | 2 s of flight |
| Paintball Shotgun | One spray a click | 20 ticks | 6 | 9 / 12 degrees | 60 | Half a second of flight; at most 2 of a spray count on one target |
| Paint Grenade | Thrown with either click, used up; lands, swells for a second, bursts | Half a second | | | | 10 s |

- **Items in every paint:** each gun and the grenade is an item in each of the 16 dyes, its paint
  parts (the hopper, the grenade's shell) in that color: `minecade:<dye>_paintball_pistol`,
  `_paintball_rifle`, `_paintball_shotgun`, `minecade:<dye>_paint_grenade` (`gunItem(kind, dye)`).
  A kit asks for the team's with `teamGunItem(kind)` ("minecade:{color}_paintball_pistol"); white is
  the pickups' look. A shot paints in its gun's color unless the game's `colorOf` says otherwise.
- **Controls:** left click fires (Bedrock repeats the swing while the button is down, so the rifle
  keeps firing until a moment after the last swing). A right click raises the gun to aim and the
  next lowers it: Bedrock sends no left click while right click is held, so aiming is a toggle. While
  it's up, the camera zooms to the gun's field of view (`camera.setFov`), the shots stray less, and
  the held model eases up to the middle of the screen; switching slots lowers it. Guns keep their
  left click swing to 0.05 s (`minecraft:swing_duration`) so a shot barely moves the hand.
- **Hotbar:** each shot starts the gun's own cooldown (`minecade_<gun>`, its fire rate), which
  Minecraft shades over the slot until the gun can fire again. While it shades, a right click
  doesn't raise or lower the gun (a cooling item can't be used). The icon is the model itself,
  drawn by the game the way it draws a wall or a banner: each item places a hidden block holding the
  model (`minecade:<dye>_paintball_<gun>_model`, only placeable on itself, so never placed), and an
  item that places a block with no icon of its own shows the block.
- **Held models:** each gun is a 3D model (an attachable). Its poses are plain animations of the
  bound `gun` bone in a hand-edited file (see "Editing where the guns sit"): from the hip and aiming
  in first person, blended by `v.aim`, and third person. `v.aim` eases toward 1 while the aim
  marker's cooldown runs (`minecade:aim_marker`, restarted every 2 ticks while the player aims), and
  each shot kicks the `body` bone back and tips the muzzle up off the gun's shot marker
  (`minecade:<gun>_shot`, `q.cooldown_time_remaining('minecade_<gun>_shot')`): hidden items whose
  cooldown categories only the models read.
- **Grenades:** a thrown grenade (`minecade:paint_grenade_thrown`) that hits something becomes
  `minecade:paint_grenade_primed` where it landed: it falls to the ground, swells to nearly twice
  its size and flashes white, slowly and then faster, for its 1 second fuse (with the fuse sound), then
  bursts (`onBurst`, and a splat sound).
- **Ammo:** a `GunDef` can have an `ammo` (magazine, reload ticks, spare rounds). The gun then fires
  its magazine and reloads by itself when it's empty (crossbow loading sounds, a dry click with no
  spare rounds left); `reload`, `refill` and `ammoOf` let a game reload, fill up on a respawn and
  show it (`onAmmo`, `ammoText` for the HUD). Paintball's guns have none: they never run dry.
- Balls fly as `minecade:paintball`, a sprite like the snowball's, in one of 16 paint colors (the
  `minecade:color` property, Minecraft's dye order). Where a ball lands, the game decides what
  happens; `paintSplash` throws the pack's splash particle in its color.
- `minecade:gun_pickup` floats, spins and bobs a white gun or grenade (the `minecade:kind`
  property: pistol, rifle, shotgun, grenade) for games with pickups.
- The models are boxes listed in `tools/assets/guns.ts`, which writes their geometry (box UV,
  Blockbench-ready), a texture per paint color, the model blocks, the recoil animations and the kit
  pictures' icons (`packs/guns/icons`, not in the packs). After changing it or `defs.ts`, rerun
  `npx tsx tools/assets/guns.ts` and commit what it writes.

### Editing where the guns sit

The poses are in `packs/guns/resource_pack/animations/guns_hold.animation.json`, the one file the
generator leaves alone (it writes it only when it's missing, from a solver's first guesses: delete
it and rerun to start over). Each gun has three animations, each a single pose of the `gun` bone:
`animation.minecade.gun_<gun>.first_person_hip`, `.first_person_aim` and `.third_person` (the
grenade has no aim). To change one in Blockbench (5.1 or later, which previews attachables):

1. File > Open Model: `packs/guns/resource_pack/models/entity/guns.geo.json`, and pick the held
   model, `geometry.minecade.gun_<gun>` (not `_display` or `_icon`). Drag in a texture, such as
   `packs/guns/resource_pack/textures/minecade/guns/pistol/red.png`.
2. In the Animate tab, import `guns_hold.animation.json` (the Animations panel's import button).
3. Set the Bedrock animation mode on the toolbar: Attachable First Person for the hip and aim
   poses, Attachable Third Person for `third_person`.
4. Pick the animation, select the `gun` bone, and move, turn or scale it at time 0.
5. Save the animation file (not the model: the generator owns `guns.geo.json`).

Keep to the `gun` bone (the `body` bone carries the recoil), keep the animation names, and leave
`guns.animation.json` alone (it's generated). Blockbench's preview is approximate: check in game.
`npm run check` confirms every pose the guns name is still in the file.

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

Paintball (`games/paintball`) is two to four teams with the shared guns: first team to 10 kills, a
10 minute clock, unlimited respawns after 3 seconds. Its numbers are in
`games/paintball/game.config.ts` (`hitsToOut`, `powerUps`, `grenade`, `splash`).

- **Team count:** the lobby's game screen has Team count (2, 3 or 4; 2 at first). A match has that
  many teams, Red, Blue, Yellow, then Green, or fewer when the players can't fill them (three players
  never make four teams), and the lobby's team form offers the same ones. Any team game can have
  one: `teams.option` names one of its `options`, whose values are team counts inside `teams.count`
  (`teamLimit` in minigame-core; the build checks them).
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
- **Paint:** every ball paints where it lands, in the shooter's team's color: the block it hit and
  touching blocks of the same open surface, 3 to 5 in all, never outside the map's bounds. Full
  blocks (glass and leaves too) become concrete; stairs and slabs vanilla's concrete stairs and
  slabs; carpets the color's carpet; walls, fences, panes and bars, fence gates, doors, trapdoors
  and vertical slabs Paintball's painted blocks of the same shape, which keep their facing, their
  connections and whether they're open, and open and shut with a right click. Small things stay
  as they are: plants, torches, rails, signs, buttons, plates, ladders, chests, beds, heads,
  lanterns and chains. Nothing painted drops an item (the `doTileDrops` rule is off for the match:
  painting a door's half breaks the other for a moment). Blocks from the shared blocks pack are
  painted by their shape, read at build time from the installed pack's own table (`#mod-blocks`,
  `tools/build/mod-blocks.ts`); a build without the pack paints only vanilla blocks.
- **Painted blocks** (`minecade:paint_<dye>_<shape>`, in each team's dye) are in Paintball's own
  packs, so only its servers and previews have them. `tools/assets/paint-blocks.ts` writes them from
  `games/paintball/behavior_pack/scripts/shapes.ts` (rerun it and commit after changing either; a
  test checks the committed files match): vanilla's own concrete textures, and each shape drawn
  from boxes in Java's block coordinates, a box showing for the states that use it, so nothing is
  turned. `spike/paint/run.ts` checks them on a throwaway server: every state loads, and every
  vanilla door, gate and trapdoor state paints to the same shape (a door's `cardinal_direction` is
  a quarter turn from Java's facing).
- **Stats:** kills, deaths and wins, plus Blocks painted.

## The prompt form

Build Swap has every player write prompts before the countdown, in a live form like the kit form
(`games/buildswap/behavior_pack/scripts/prompt-form.ts`):

- **On it:** a status line (who's still writing, or how many, and the time left), two text boxes
  (Build prompt and Twist prompt, each with a short example under its label), a line for what's
  wrong with an answer, then Submit and Skip.
- **Answers:** Submit takes either box or both, each up to 50 characters (color codes are taken
  out); with both empty it asks for a prompt or a skip. Skip takes nothing. Either one closes the
  form for good, and the player sees "Waiting for N players" on the action bar.
- **Staying open:** closing the form brings it back within half a second, until the player submits
  or skips. After 2 minutes (`promptSeconds`), whoever hasn't answered is skipped and the countdown
  starts. A preview's fake players get no form.
- **Text filter:** what's typed goes through Minecraft's filter for the writer (`getFilteredText`),
  and is taken as typed when the filter is off or doesn't answer within 3 seconds.

## Countdown sounds

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
`mob_effects_renderer` from the HUD). A lock-in queue makes players invisible with an effect, and
the HUD draws every effect's icon as one piece, so the invisibility one can't be hidden alone. A
kit's effects don't show either.

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
from its place in the list. Start sends `start_game` with the map (or "random") and the settings,
the orchestrator passes the settings to the game server as `GAME_SETTINGS`, and a game reads them
from `ctx.vars.settings`.

**Team picks in the lobby:** for team games where players pick (Teams: Pick on the game screen),
players pick in the lobby while the game server boots, so no time is lost on the game server.
- **Two players don't pick:** with only two players going, there's nothing to choose, so nobody
  gets the form: the lobby sends the start as Random, and the game puts them on teams of their own
  at random.
- **The form:** right after Start, every player in the match gets a live team form. It's a
  data-driven `CustomForm` from `@minecraft/server-ui` (`scripts/team-pick-form.ts`), the newer
  kind of form whose text updates while it's open and whose buttons don't close it. It renders in
  Ore UI, so the resource pack can't theme it.
- **On it:** each team with its players and count ("2/3"), a Join button per team (disabled when
  the team is full), a Random team button, and a status line.
- **Buttons as pictures:** Ore UI's buttons can't take a color, and their text shows color codes
  as they are. So each button is a clickable picture the full width of the form, lined up with the
  text above it: the team's color with white text ("Join Red"), framed in white on the player's own
  team ("On Red"), dimmed when full ("Red is full"), and a gray Random team (framed while the player
  has no pick). The build draws them into the lobby pack for every team any game can have
  (`tools/build/team-buttons.ts`, a pixel font drawn after Minecraft's; `teamButtonPath()` names
  them). A picture can't be disabled, so a tap on your own or a full team does nothing. If a form
  with pictures can't show, it's shown again with Ore UI's plain buttons.
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
When the match starts, Probe says the settings it got and who is on which team.

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
  Friend", "failed") stays visible, on a taller button (`MARK.twoLine`).
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
  to Map, Name and game settings) has no back arrow: a form with fields has one button, the green
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
| `games/<id>/icon.png` | The game's picture: on its card (60x34) and on the hologram (2 blocks wide) while the map is random | 320x180 (16:9), required for every game |
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
