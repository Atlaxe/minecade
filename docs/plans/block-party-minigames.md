# Block Party minigames (plan)

**Status:** plan, 2026-11-26. Every minigame on `block-party.md`'s list ("Minigames"), written out so
each can be built: how it plays and ends, what its arena map marks in the map editor, the numbers each
map sets (Game settings), the rows a map can turn off or count (Checklist Features), what the game
spawns and hands out, the tutorial's controls and how bots play it. It covers pass 9 ("The rest of
the minigames") and the parts of pass 11 ("The minigame editor") the minigames need.

Three are built (Hot Floor, Co-op Painters, Hunter). Everything else here is proposed, for the user
to change: the designs fill in what the first draft's one-liners leave open, and every number is a
starting point to tune in play tests. The questions that change a design are at the end.

**For the session that builds one:**
- Work in a worktree of your own (`CLAUDE.md`, "Branch and merge"). Build a batch at a time
  ("Build order"), stop and report after each, end the report with a list of what to test, and
  commit and push only that batch's files, with no attribution.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- The user builds and publishes every arena map. Never make a map thumbnail, a Minigame Thumbnail or
  a game picture, not even a placeholder.
- Anything the game says goes through the dialogue tool (`block-party.md`, "Dialogue").
- Item and model art is the user's: a new item or model gets a stand-in the user replaces.

## How a minigame is built

1. **Its code:** `games/blockparty/behavior_pack/scripts/minigames/<id>.ts`, a `MinigameDef`
   (`kit.ts`): its id, name and kind (`ffa`, `2v2` or `1v3`), its rules line and tutorial, where each
   side starts (`spawns`), why a map can't be played (`problem`), and `play`, which returns the
   places (FFA) or the side that won (teams). Listed in `minigames/index.ts`.
2. **Its arena:** an entry with the same id in `minigames/arenas.ts`: its name, most players, teams
   (a 2v2's Red and Blue), the Arena box (40 x 60 across at most, either way round, 48 tall) and its
   checklist (`map`: spawns, points, regions, settings, adjustable rows). That entry is the map
   editor's and the Panel's "<Name> (Block Party)", kept in the map store as `blockparty-<id>`. An id
   is lower case letters and digits only.
3. **Its test arena:** today every `MinigameDef` also lays a plain arena in code (`size`, `build`,
   `testField`), played while it has no published arena map (question 1).
4. **Its words:** the tutorial panel's objective and up to 3 controls for each side (`MAX_CONTROLS`).
   In code until pass 11 moves them to the dialogue tool.
5. **Its bots:** how a bot plays it, with `bots.ts`'s helpers (`stepToward`, `thinkTicks`).
6. **The arena map:** the user makes it under its entry, marks what the checklist asks, and
   publishes it. The next Block Party game has it, no Start needed.
7. **Trying it:** Tests' Play a minigame now, `/minigame win <name>`, and (pass 11) Preview from the
   arena map itself.

## What every minigame must handle

- **Player counts.** An FFA minigame plays with 2, 3 and 4, as a Battle (the same play with a pot),
  and as a duel (Versus, the Dueling Glove) with 2 on its first 2 spawns, so it must be fun with 2.
  A 2v2 always has 4. A 1v3 plays 1 against 3, and 1 against 2 with 3 players (its maps mark 3
  spawns for the trio; 1v2 uses the first 2).
- **An end of its own.** The board waits for players; a minigame doesn't. Each has a time limit, and
  most end sooner (one left standing, a goal reached).
- **Places.** FFA: places best first, ties allowed (`{ places }`). Teams: the side that won, or a
  draw (`{ winner }`). Coins follow `block-party.md`'s "Coins awarded".
- **Out players** watch from the spectator spawn as spectators (`play.out`); out bots float there.
- **Someone leaving** in the middle: `bodyOf` gives nothing and the rest play on.
- **No damage.** Block Party plays with `damage: "none"` and no fall damage (`game.config.ts`). A
  minigame that wants hits, hearts or knockback counts them itself (a hit is an `entityHitEntity`,
  as Hunter's catch; see "Scripted hearts" and "Knockback" below).
- **Adventure mode** (`minigame-runner.ts`): nobody breaks or places blocks unless the item they're
  handed allows it (see "Place and break").
- **The hotbar** is vanilla's while a minigame plays. Whatever a minigame hands out is taken back at
  its end.
- **Controls** are only what a script can read: the movement keys or stick (`getMovementVector`),
  jump, sneak (a plain press, never held while doing something else), attack (a hit on a mob or
  block), use (an item's use, or a use on a block or mob in reach) and sprint. No other key reaches
  a script, and a use with an empty hand at the sky fires nothing.
- **Nothing left over:** what a minigame spawns lives in its `scope` and ends with it, and the arena
  slot is put back after every minigame.
- **Arena maps keep no mobs or loose items:** the game spawns everything that moves (chickens,
  carts, targets, mobs) at the points its map marks.
- **Team colors** in a 2v2 are Red and Blue (`PAINTER_TEAMS`, to be shared by every 2v2). Team
  armor is `teamArmor` with vanilla leather (packs/armor's dyed pieces), never dyed by a script.
- **The status line** top right (`play.status`) carries its clock and score.

## What every arena map has (built)

| Mark | Map editor tool | What it's for |
|---|---|---|
| **Arena** box | Region tool (Arena) | What the game places: at most 40 x 60 across either way round, 48 tall. Everything below goes inside it |
| **Spectator spawn** | Spawn tool | Where out players watch from |
| **Minigame podium** | Game marker tool | 4 spots, 1st to 4th, where the results play |
| **Podium camera** | Game marker tool | The camera on the podium; a map can turn it off (Checklist Features) |
| **Start view** | Camera tool | The rules camera, while everyone gets ready |
| **Time of day** | Time tool | Set while the minigame plays, the board's put back after |

## The pieces the minigames need

Shared work the minigames below lean on, built before the minigames that need them. Pieces 1 to 6
are pass 11's and serve every minigame; the rest serve the minigames named.

1. **Game settings reach the minigame** (pass 11's per-minigame settings). An arena's `map.settings`
   is already in core's config, but nothing carries a map's numbers to the minigame yet: the Game
   settings tool on arena maps, and a `settings(key)` on the `Field` that `play` reads (the
   setting's default for a test arena). Almost every minigame below has some.
2. **Kill Y reaches the minigame.** `mapField` brings the spawns, points, regions, spectator spawn,
   Start view and time, not the map's Kill Y. It comes along moved with the Arena box, so a minigame
   that ends in a fall reads `field.killY`. Every minigame that names Kill Y below.
3. **Pot point** (pass 11): where a Battle's pot lands, the arena's middle without one. Every FFA
   arena; a map can turn it off.
4. **Rules camera end** (pass 11): a second camera, and the rules camera pans slowly from the Start
   view to it while the tutorial is up. Every arena, a map can turn it off.
5. **Covered arena** (pass 11): a Game setting, 0 or 1, that cuts straight into the arena behind the
   stars with no camera coming down from above, for indoor arenas.
6. **Preview from an arena map** (pass 11): a Block Party preview straight into that minigame on that
   map, bots in the empty seats, `/minigame win` at hand, back in Edit when it ends.
7. **Lists in pairs and groups.** Trap Master's nth lever works its nth trap, and Bomb Disposal's
   nth clue is its nth panel's (counts keep their order already); the checklist needs a rule that
   two lists have the same count. Trap Door Maze groups its doors by row with point types (built).
8. **A look input on the tutorial panel.** Its inputs are move, jump, attack, use, sneak and sprint
   (`TUTORIAL_INPUTS`); Don't Look and Cannon Duel need "look" too (the mouse, the right stick, a
   touch drag).
9. **Answer pads** (game code, shared): 2 to 4 Answer regions, each floor lit in its own color with
   its answer floating over it; a player's answer is the pad they stand on when time's up. Quiz
   Floor, Name That Mob or Item, Count the Mobs.
10. **Banks the user writes:** Quiz Floor's questions, Name That Mob or Item's pictures and names, and
    Mystery Kit Brawl's kits, each a file in `games/blockparty/` like `items.json` and `dice.json`
    (question 5).
11. **Scripted hearts:** hearts of the minigame's own on the HUD (Paintball's fake hearts), a hit
    taking the held weapon's damage, out at 0. Mystery Kit Brawl, Defend the Core, Boss Fight.
12. **Knockback:** a hit pushes by script (`applyKnockback`), Sumo's measured numbers for twice
    vanilla's. King of the Hill, Tug of War, Sumo Duel, Boss Fight.
13. **Place and break:** blocks and tools handed out with `setCanPlaceOn` and `setCanDestroy`, so an
    Adventure player places or breaks only what the minigame allows, and nothing drops. Bridge Dash,
    Mining Race, Spleef Duo.
14. **Moving entities of the game's own:** a target, a cart, a cannonball, a button, a lever: a model
    moved and turned by script, like the board's NPCs (which Mob Freeze and Don't Look reuse).
    Button Mash, Snowball Sniper, Minecart Dodge, Cannon Duel, Trap Master.
15. **Riding and leads** (the players pack, built in the spike: `private_packs/players/`): `addRider`
    puts a player on another's head and they move together; `leashTo` ties a player to another, the
    lead pulling at 5 blocks. Carry Race, Paired Parkour.
16. **Bots on a course:** bots that follow a route with jumps and climbs, using the board's walk
    (`terrain.ts`, `walk-plan.ts`, `walk-follow.ts`) from checkpoint to checkpoint. Bridge Dash,
    Rising Lava, Paired Parkour, Carry Race, Trap Master, Trap Door Maze.
17. **A pick menu in a minigame:** the board menu's JSON UI (movement keys, jump picks), for the solo
    to set traps in secret. Trap Door Maze.
18. **Disguises:** Chameleon's block-wearing (its private pack). Prop Hunt (question 8).
19. **Playing as a mob:** the player's model swapped for the Wither's, hovering by script (Adventure
    can't fly). Boss Fight (question 9).

## Overview

| Minigame | id | Format | About | Status | Pieces past 1 to 6 |
|---|---|---|---|---|---|
| Hot Floor | `hotfloor` | FFA | up to 12 rounds | Built | 2 |
| Mob Freeze | `mobfreeze` | FFA | 30 s | Proposed | 14 |
| Item Scramble | `scramble` | FFA | 40 s | Proposed | |
| Do the Opposite | `opposite` | FFA | 30 s | Proposed | |
| Don't Look | `dontlook` | FFA | 40 s | Proposed | 8, 14 |
| Bridge Dash | `bridgedash` | FFA | 40 s | Proposed | 2, 13, 16 |
| Button Mash | `buttonmash` | FFA | 10 s | Proposed | 14 |
| Mystery Kit Brawl | `kitbrawl` | FFA | 20 s | Proposed | 2, 10, 11 |
| Anvil Rain | `anvilrain` | FFA | 40 s | Proposed | |
| TNT Run | `tntrun` | FFA | 40 s | Proposed | 2 |
| Rising Lava | `risinglava` | FFA | 60 s | Proposed | 16 |
| King of the Hill | `hill` | FFA | 40 s | Proposed | 2, 12 |
| Egg Drop | `eggdrop` | FFA | 30 s | Proposed | |
| Snowball Sniper | `snowball` | FFA | 40 s | Proposed | 14 |
| Minecart Dodge | `minecarts` | FFA | 45 s | Proposed | 14 |
| Chicken Chase | `chickens` | FFA | 30 s | Proposed | |
| Mining Race | `mining` | FFA | 30 s | Proposed | 13 |
| Simon Says | `simon` | FFA | 60 s | Proposed | |
| Quiz Floor | `quiz` | FFA | 60 s | Proposed | 2, 9, 10 |
| Name That Mob or Item | `namethat` | FFA | 60 s | Proposed | 9, 10 |
| Count the Mobs | `countmobs` | FFA | 60 s | Proposed | 9 |
| Quick Draw | `quickdraw` | FFA (duels, sudden death) | 20 s | Proposed | 14 |
| Sumo Duel | `sumoduel` | FFA (duels, sudden death) | 45 s | Proposed | 2, 12 |
| Co-op Painters | `painters` | 2v2 | 30 s | Built | |
| Tug of War | `tugofwar` | 2v2 | 45 s | Proposed | 2, 12 |
| Capture the Wool | `wool` | 2v2 | 60 s | Proposed | |
| Spleef Duo | `spleef` | 2v2 | 60 s | Proposed | 2, 13 |
| Paired Parkour | `parkour` | 2v2 | 90 s | Proposed | 2, 15, 16 |
| Carry Race | `carryrace` | 2v2 | 60 s | Proposed | 15, 16 |
| Cannon Duel | `cannons` | 2v2 | 60 s | Proposed | 8, 14 |
| Hunter (Hunter vs. Runners) | `hunter` | 1v3 | 45 s | Built | |
| Trap Master | `trapmaster` | 1v3 | 60 s | Proposed | 2, 7, 14, 16 |
| Defend the Core | `core` | 1v3 | 60 s | Proposed | 11 |
| Trap Door Maze | `trapdoors` | 1v3 | 60 s | Proposed | 16, 17 |
| Bomb Disposal | `bomb` | 1v3 | 60 s | Needs design | 7 |
| Prop Hunt | `prophunt` | 1v3 | 75 s | Proposed | 18 |
| Boss Fight | `bossfight` | 1v3 | 90 s | Proposed, riskiest | 2, 11, 12, 19 |

Each entry below lists the map's marks besides every map's own (above), its Game settings as
`key`, **label**, default and range, and its Checklist Features beyond the Podium camera, Pot point
and Rules camera end every map has. Spawns are the Spawn tool's, points the Game marker tool's,
regions the Region tool's; every one of them inside the Arena box.

## FFA: reflex and quick reaction

### Hot Floor (built)

A color is called; after a countdown every tile of another color vanishes, and whoever isn't on the
color falls and is out. The tiles come back in new colors, the countdown shorter each round. Last
one standing wins; the rest place by when they fell (falling together is a tie).

- **Marks:** 4 spawns on the floor (a duel uses the first 2); **Floor (tiles)**, a region whose
  lowest layer takes the game's 3 x 3 tiles, as many as fit each way from its lowest corner (at
  least 2 x 2).
- **Game settings** (the numbers in `hot-floor.ts` today): `firstCount`, **First countdown**, 40
  tenths of a second (15 to 100); `lastCount`, **Shortest countdown**, 15 tenths (5 to 50);
  `countStep`, **Shorter each round by**, 3 tenths (0 to 20); `rounds`, **Most rounds**, 12 (3 to
  30); `colors`, **Colors**, 6 (2 to 6).
- **Checklist Features:** Kill Y can be off (it judges falls by the tile today; with piece 2 a map's
  Kill Y could say when a faller is out).

### Mob Freeze

Red Light, Green Light. Everyone starts on a line facing a mob at the far end. While it looks away,
players creep toward it; it turns round after a warning sound, and anyone moving while it watches is
sent back to the start line. First over the Finish wins; when time runs out, the rest place by how
close they got.

- **Marks:** 4 spawns on the start line, facing the mob; **Mob** (point, 1): where it stands,
  facing the players; **Finish** (region, 1): a player over it has made it.
- **Game settings:** `playTime`, **Time limit**, 30 s (15 to 90); `awayMin` and `awayMax`, **Looks
  away for**, 10 to 40 tenths of a second (5 to 100); `watch`, **Watches for**, 25 tenths (10 to
  60); `warning`, **Warning before it turns**, 5 tenths (0 to 20); `grace`, **Reaction time**, 3
  tenths (0 to 10): moving this soon after it turns doesn't count.
- **Spawns:** the mob, an entity of the game's own on a vanilla mob's model like the board's NPCs
  (an Iron Golem proposed, question 3), turned by script.
- **Controls:** move, "Creep toward the mob while it looks away"; sprint, "Go faster".
- **Bots:** walk while it looks away, stop at the warning, now and then a moment late.
- **Notes:** moving is the movement input or a jump (`getMovementVector`, the jump button), read
  each tick while it watches, so pushing against a wall counts too.

### Item Scramble

An item is called ("Get a pickaxe!") and items drop at spots round the arena: the called one, fewer
of them than players, among decoys. The first to pick one up scores; picking up a decoy holds you
still for a second. Rounds go on until someone has enough points or the rounds run out; places by
points.

- **Marks:** 4 spawns in the middle; **Item spots** (point, 12, spread round the arena): the game
  drops an item over each.
- **Game settings:** `rounds`, **Rounds**, 5 (1 to 10); `toWin`, **Points to win**, 3 (1 to 10);
  `roundTime`, **Round time**, 10 s (5 to 30).
- **Checklist Features:** Item spots' count, 6 to 24.
- **Spawns:** items at the spots (a list of vanilla items in code), cleared each round.
- **Controls:** move, "Run to the called item"; jump, "Climb to it". Walking over an item picks it
  up.
- **Bots:** head for the nearest called item after a reaction delay.
- **Notes:** a pickup is read from the player's inventory each tick, then taken away.

### Do the Opposite

Each player stands on a pad of their own. A prompt shows in the dialogue box ("Jump!", "Don't
jump!", "Move!", "Stand still!", "Sneak!", "Don't sneak!"), and players have a moment to do the
opposite. Wrong costs a heart; out at none. The answer time shortens each prompt. Last one in wins;
the rest place by when they went out.

- **Marks:** 4 spawns, each on its own pad so nobody bumps into anyone.
- **Game settings:** `hearts`, **Hearts**, 2 (1 to 5); `firstWindow`, **First answer time**, 25
  tenths of a second (10 to 60); `lastWindow`, **Shortest answer time**, 10 tenths (5 to 30);
  `prompts`, **Most prompts**, 20 (5 to 40).
- **Controls:** jump, "When it says not to"; move, "When it says stand still"; sneak, "When it says
  not to".
- **Bots:** right about 85% of the time.
- **Notes:** each prompt's words are texts in the dialogue tool. Moving is the movement input, not
  where the player is, so a small pad works.

### Don't Look

Players stand in the middle, free to turn. A sound plays from one of the watcher spots round them,
and after a warning an Enderman shows there for a moment: anyone looking toward it is out. The
warning shortens each time. Last one in wins; the rest place by when they went out.

- **Marks:** 4 spawns in the middle; **Watcher spots** (point, 6, round the middle at eye height,
  facing it).
- **Game settings:** `warning`, **First warning**, 20 tenths of a second (5 to 50); `lastWarning`,
  **Shortest warning**, 8 tenths (3 to 30); `cone`, **Looking toward it within**, 30 degrees (10 to
  60); `rounds`, **Most rounds**, 15 (5 to 30).
- **Checklist Features:** Watcher spots' count, 3 to 12.
- **Spawns:** the Enderman, the board's own NPC entity, at a spot for the moment it shows.
- **Controls:** look, "Turn away from the sound" (piece 8); move, "Step round".
- **Bots:** turn away after a reaction delay, now and then too slowly.
- **Notes:** looking toward it is the angle between the player's view and the line to the spot,
  with nothing solid between. The sound plays at the spot so players can tell where it is.

### Bridge Dash

Each player has a lane: a short bridge with gaps. They're handed blocks and bridge the gaps; first
over the Finish wins. A fall puts them back on the last block of the map's they stood on, a moment
later. When time runs out, the rest place by how far along their lane they got.

- **Marks:** 4 spawns, each at its lane's start facing along it; **Lanes** (region, 4, in spawn
  order): where each player may place; **Finish** (region, 1, across every lane's end); Kill Y.
- **Game settings:** `playTime`, **Time limit**, 40 s (20 to 90); `blocks`, **Blocks handed out**,
  32 (8 to 64); `respawn`, **Back after a fall**, 10 tenths of a second (0 to 40).
- **Gives:** a stack of wool that can be placed only on the lanes' blocks and itself (piece 13); a
  block placed outside its player's lane is taken back.
- **Controls:** use, "Place a block"; move, "Run your lane"; jump.
- **Bots:** walk the lane and the game places a block for them at each gap, after a delay.

### Button Mash

Each player faces a big button of their own. On Go, hit it as many times as you can; its count rises
over it. Most hits wins; equal counts tie.

- **Marks:** 4 spawns; **Buttons** (point, 4, in spawn order): each in reach in front of its player,
  facing them.
- **Game settings:** `playTime`, **Time**, 10 s (5 to 30).
- **Spawns:** 4 buttons, a model of the game's own that presses in on a hit.
- **Controls:** attack, "Hit your button".
- **Bots:** a hit every 3 to 5 ticks.
- **Notes:** a vanilla button has a cooldown and a held use repeats by itself, so the count is hits
  on the button entity (`entityHitEntity`), only its own player's. Players are held in place while
  it plays.

### Mystery Kit Brawl

Everyone gets a random kit from the kit file (a diamond sword, or a stick; armor now and then) and
fights for 20 seconds. Each player has hearts of the minigame's own; a hit takes its weapon's damage,
out at none. Last one in wins; at time, the rest place by hearts left, then by when they went out.
While the rules show, a player can reroll their kit once for coins.

- **Marks:** 4 spawns facing the middle; Kill Y (a fall is out).
- **Game settings:** `playTime`, **Time**, 20 s (10 to 60); `hearts`, **Hearts**, 5 (1 to 20);
  `rerollCost`, **Reroll cost**, 2 coins (0 to 10).
- **Checklist Features:** Kill Y can be off (an arena walled in).
- **Gives:** the kit; while the rules show, a Reroll item (use).
- **Bank:** `games/blockparty/kits.json`, the user's: each kit's items, armor and weight, and each
  weapon's damage (piece 10).
- **Controls:** attack, "Hit"; move; use, "Reroll your kit before Go".
- **Bots:** walk at the nearest player and hit about twice a second.
- **Notes:** paying coins in the middle of a minigame is new (question 4).

### Anvil Rain

Anvils fall over the floor, each marked by a shadow a moment before it lands, faster as time goes.
The safe area shrinks: ring by ring from the edge, the floor fills with anvils. A falling anvil that
lands on you is out. Last one in wins; the rest place by when they went out.

- **Marks:** 4 spawns on the floor; **Floor** (region, 1): anvils drop from its top layer onto
  whatever is under them, and the rings close from its edge to its middle (build the floor inside
  it, with room above).
- **Game settings:** `startRate`, **Anvils a second at first**, 2 (1 to 10); `endRate`, **Anvils a
  second at the end**, 8 (1 to 20); `ringEvery`, **A ring closes every**, 4 s (1 to 20); `warning`,
  **Shadow before it lands**, 10 tenths of a second (3 to 30); `playTime`, **Time limit**, 60 s (20
  to 120).
- **Spawns:** anvils placed in the air (vanilla falling blocks), shadow particles.
- **Controls:** move, "Dodge the shadows"; sprint.
- **Bots:** step off a shadow after a reaction delay.
- **Notes:** with no damage, the game takes out whoever a falling anvil reaches (the falling block
  within a player's box). Landed anvils stay as blocks until the arena is cleared.

### TNT Run

Every floor block a player steps on vanishes a moment after. Layers under it catch a fall; below the
last, a player is out. Last one in wins; the rest place by when they fell.

- **Marks:** 4 spawns on the top layer; **Floor** (region, 1): every block inside it vanishes once
  stepped on (build the layers inside it, from any blocks); Kill Y.
- **Game settings:** `delay`, **Vanishes after**, 4 tenths of a second (1 to 20); `playTime`, **Time
  limit**, 90 s (30 to 180).
- **Controls:** move, "Keep moving"; jump, "Hop the gaps"; sprint.
- **Bots:** keep walking toward blocks nobody has stepped on.
- **Notes:** the blocks under all four corners of a player's feet go, so edges don't hold anyone up.

### Rising Lava

Lava (or water, a map's choice) fills the Rise box from its bottom, a layer at a time, faster as it
goes. Players climb the map's platforms; whoever it reaches is out. Last one in wins; everyone still
in when it reaches the top ties first.

- **Marks:** 4 spawns low down; **Rise** (region, 1): the liquid fills it from bottom to top, and
  the climb goes inside it.
- **Game settings:** `liquid`, **Liquid**, 0 lava or 1 water (0 to 1); `startDelay`, **First rise
  after**, 5 s (0 to 30); `riseEvery`, **A layer every**, 20 tenths of a second at first (5 to 100);
  `riseEnd`, **A layer every, at the end**, 8 tenths (3 to 100).
- **Controls:** move; jump, "Climb"; sprint.
- **Bots:** climb along a route the game finds from the platforms (piece 16); they're weak here.
- **Notes:** a player is out once the liquid's top passes their feet, so swimming up in water saves
  nobody. With no damage, lava doesn't hurt, though it may still set players alight to look at.

### King of the Hill

Hold the Hill: every second you're on it alone scores a point, and a shared second scores nobody.
Hits knock others off. A fall puts you back at your spawn a moment later. Most points at time wins.

- **Marks:** 4 spawns round the hill, facing it; **Hill** (region, 1): standing over it counts; Kill
  Y.
- **Game settings:** `playTime`, **Time**, 40 s (20 to 120); `knockback`, **Knockback**, 20 tenths
  of vanilla's (10 to 40); `respawn`, **Back after a fall**, 2 s (0 to 10).
- **Checklist Features:** Kill Y can be off (a hill with no drop).
- **Controls:** move; attack, "Knock them off"; jump.
- **Bots:** head onto the hill and hit anyone in reach.

### Egg Drop

Eggs fall over the drop area; catch them before they land by walking into them. Vanilla's brown eggs
count 2 and blue eggs 3. An egg that lands breaks with a splat. Most points wins.

- **Marks:** 4 spawns; **Drop** (region, 1): eggs start at its top and fall over its footprint (the
  floor goes inside it).
- **Game settings:** `playTime`, **Time**, 30 s (15 to 90); `eggRate`, **Eggs a second**, 2 (1 to
  8); `rareShare`, **Brown and blue eggs**, 15% (0 to 50).
- **Spawns:** egg items with a shadow under each.
- **Controls:** move, "Get under the eggs"; jump, "Catch the high ones"; sprint.
- **Bots:** run to the nearest egg's landing spot.
- **Notes:** a catch is read from the inventory and taken away; an egg item that touches ground is
  removed with the splat.

### Snowball Sniper

Targets slide back and forth across the arena; everyone throws snowballs (as many as they like) from
their stand. A hit scores the target's points, more for the far ones. Most points wins.

- **Marks:** 4 spawns, the stands, facing the targets; **Target lanes** (region, 4): a target slides
  along each box's long side, at its middle.
- **Game settings:** `playTime`, **Time**, 40 s (20 to 90); `targetSpeed`, **Target speed**, 4
  blocks a second (1 to 15).
- **Checklist Features:** Target lanes' count, 2 to 8.
- **Spawns:** a target per lane (a model of the game's own), snowballs kept topped up.
- **Controls:** use, "Throw a snowball"; move.
- **Bots:** throw where a target will be every second or so, hitting about half the time.
- **Notes:** a hit is `projectileHitEntity` on a target; a lane's points are 1 for every 10 blocks
  from the stands. Snowballs do nothing to players.

### Minecart Dodge

Carts race along tracks across the floor, more and faster as time goes; a cart that reaches you
takes you out. Last one in wins; everyone still in at time ties first.

- **Marks:** 4 spawns; **Tracks** (region, 6): each a straight box 1 block wide, carts running its
  long way in either direction (build the rails inside it); Kill Y.
- **Game settings:** `playTime`, **Time**, 45 s (20 to 90); `cartSpeed`, **Cart speed at first**, 6
  blocks a second (2 to 20); `cartEvery`, **A cart every, at first**, 20 tenths of a second (5 to
  60).
- **Checklist Features:** Tracks' count, 2 to 12; Kill Y can be off.
- **Spawns:** carts, the game's own entity on vanilla's minecart model, moved by script (vanilla's
  rail physics can't be told where to go or how fast).
- **Controls:** move; jump, "Hop a track"; sprint.
- **Bots:** step off a track when a cart is coming, now and then late.
- **Notes:** the plan wanted up to 128 blocks for this one; straight tracks of 60 fit the slot.

### Chicken Chase

Chickens run loose in the pen. Hit one to catch it: it vanishes in a puff for a point, and another
comes. Vanilla's cold chickens count 2. Most points wins.

- **Marks:** 4 spawns; **Pen** (region, 1): chickens spawn inside it (build its walls).
- **Game settings:** `playTime`, **Time**, 30 s (15 to 90); `chickens`, **Chickens at once**, 8 (2
  to 20).
- **Spawns:** vanilla chickens, whose running about is the point here; one out of the pen is put
  back.
- **Controls:** move; attack, "Catch a chicken"; sprint.
- **Bots:** chase the nearest chicken.

### Mining Race

Each player has a cube of stone, filled with ores by the game. Break ores for points (coal and copper
1, iron, redstone and lapis 2, gold 3, diamond 5, emerald 8). Most points wins.

- **Marks:** 4 spawns; **Mines** (region, 4, in spawn order): each player's cube, which the game fills.
- **Game settings:** `playTime`, **Time**, 30 s (15 to 90); `oreShare`, **Ores**, 15% of the blocks
  (5 to 50).
- **Checklist Features:** Mines' count, 1 or 4: with one, everyone digs the same cube.
- **Gives:** a pickaxe that breaks only stone and the ores (piece 13), quick enough to dig fast.
  Nothing drops.
- **Controls:** attack, "Mine"; move.
- **Bots:** break the nearest ore every second or two.

## FFA: brain and memory

### Simon Says (Block Edition)

A big display shows a pattern, its colored squares lighting one at a time, each with its own note.
Each player hits the same 4 colors at their own station in the same order. The pattern grows by one
each round; a wrong hit or running out of time is out. Last one in wins; those out in the same round
tie.

- **Marks:** 4 spawns, each facing its station; **Stations** (point, 4, in spawn order): the middle
  of each player's 2 x 2 of colors, facing them; **Display** (point, 1): the middle of the big 2 x 2
  everyone watches, facing them. The game lays the colors.
- **Game settings:** `startLength`, **First pattern**, 3 (1 to 6); `showSpeed`, **A step every**, 6
  tenths of a second (2 to 20); `answerTime`, **Time per step**, 20 tenths (5 to 50).
- **Controls:** attack, "Hit the colors in order".
- **Bots:** right at each step with a chance that falls as the pattern grows.
- **Notes:** a hit on a block is `entityHitBlock`. Unlit, a color is its terracotta; lit, its
  concrete.

### Quiz Floor

A true or false question shows in the dialogue box, and players stand on True or False before time
is up. The wrong side's floor drops away and those on it are out. If everyone is wrong, nobody falls.
Last one in wins; when the questions run out, everyone still in ties first.

- **Marks:** 4 spawns between the sides; **True** and **False** (region, 1 each): each side's floor,
  which the game drops and puts back; Kill Y.
- **Game settings:** `answerTime`, **Answer time**, 6 s (3 to 20); `questions`, **Most questions**, 8
  (3 to 20).
- **Bank:** the user's questions, each true or false (piece 10, question 5).
- **Controls:** move, "Stand on your answer".
- **Bots:** right about 60% of the time.

### Name That Mob or Item

A picture shows top middle: a mob's silhouette or a crop of an item's texture. Four answers float
over four colored pads; stand on yours by time's up. A right answer scores. Most points wins.

- **Marks:** 4 spawns; **Answer pads** (region, 4): the answers float over them in order.
- **Game settings:** `answerTime`, **Answer time**, 8 s (3 to 20); `questions`, **Questions**, 6 (3
  to 12).
- **Bank:** the mobs and items it asks about, with their names. The silhouettes and crops are made by
  the build from the client's vanilla files into a private pack (never git, as the bots' Steve
  portrait is); the picture shows in a JSON UI component of the workshop tool's.
- **Controls:** move, "Stand on your answer".
- **Bots:** right about half the time.

### Count the Mobs

Mobs pour into the pen for a few seconds, then vanish in a puff: how many were there, or how many
sheep? Four numbers float over the answer pads; stand on yours. A right answer scores. Most points
wins.

- **Marks:** 4 spawns looking over the pen; **Pen** (region, 1): where the mobs show; **Answer pads**
  (region, 4).
- **Game settings:** `showTime`, **Mobs show for**, 3 s (1 to 10); `rounds`, **Rounds**, 5 (3 to 10);
  `mostMobs`, **Most mobs**, 15 (5 to 30).
- **Spawns:** vanilla farm animals (sheep, cows, pigs, chickens), wandering as they do.
- **Controls:** move, "Stand on your answer".
- **Bots:** right about half the time, else a number close to it.

## FFA for duels and the sudden death

The plan's "1v1 and sudden death" pair. Both play with 2 to 4 here, so they're FFA minigames: duels
and Battles get them, and the sudden death pool (Quick Draw, Hot Floor, Sumo Duel) works for any
number tied (question 2).

### Quick Draw

Each player faces a target of their own. After a random wait, "Draw!" shows and a bell rings; the
first to hit their own target wins the round, and hitting it before Draw loses the round. First to 2
rounds wins; the rest place by rounds won.

- **Marks:** 4 spawns (a duel uses the first 2); **Targets** (point, 4, in spawn order): each in
  reach in front of its player.
- **Game settings:** `roundsToWin`, **Rounds to win**, 2 (1 to 5); `waitMin` and `waitMax`, **Wait
  before Draw**, 20 to 60 tenths of a second (5 to 150).
- **Spawns:** the targets, a model of the game's own.
- **Controls:** attack, "Hit your target on Draw".
- **Bots:** hit 0.3 to 0.6 s after Draw, now and then too early.

### Sumo Duel

Knock everyone else off the platform. Hits push twice vanilla's (Sumo's measured numbers). Last one
on wins; the rest place by when they fell.

- **Marks:** 4 spawns round the platform, facing in; Kill Y.
- **Game settings:** `playTime`, **Time limit**, 45 s (20 to 120); `knockback`, **Knockback**, 20
  tenths of vanilla's (10 to 40).
- **Controls:** move; attack, "Push"; jump.
- **Bots:** walk at the nearest player and hit, backing off the edge.
- **Notes:** Block Party's own minigame on its own arena map; it can share code with Sumo through
  core, never Sumo's maps.

## 2v2

Every 2v2 map has Red and Blue team spawns, 2 each.

### Co-op Painters (built)

Every block of the floor a player walks over takes their team's color; the team with more floor at
time wins.

- **Marks:** **Floor** (region): its lowest layer is what gets painted, flat, in any one block.
- **Game settings:** `playTime`, **Time**, 30 s (15 to 120), the number in `painters.ts` today.

### Tug of War

The teams start at either end of a long platform over a drop. Hits push hard: knock the other team
off. A fall is out. The last team with someone standing wins; at time, the team with more standing
wins, and equal is a draw.

- **Marks:** Kill Y.
- **Game settings:** `playTime`, **Time**, 45 s (20 to 120); `knockback`, **Knockback**, 20 tenths
  of vanilla's (10 to 40).
- **Controls:** move; attack, "Push"; jump.
- **Bots:** walk at the nearest rival and hit.
- **Notes:** the draft's knockback version; question 10 has a rope instead.

### Capture the Wool

Each team's wool stands at its base. Walk into the other team's wool to take it and bring it to your
own base. A rival's hit on the carrier sends the wool home and the carrier back to their spawn. First
capture wins; at time, a draw.

- **Marks:** **Wool** (point, per team): where the team's wool stands; **Base** (region, per team): a
  carrier over their own base captures.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `captures`, **Captures to win**, 1 (1 to
  3); `respawn`, **Back after a tag**, 2 s (0 to 10).
- **Gives:** team leather armor; the carrier holds the wool.
- **Controls:** move; attack, "Tag the carrier"; sprint.
- **Bots:** one goes for the wool, one stays home.

### Spleef Duo

Everyone gets a shovel that breaks the snow floor in one hit. Dig under the other team; a fall is
out. The last team with someone standing wins.

- **Marks:** **Floor** (region, 1): the game lays snow across its lowest layer; Kill Y.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120): after it, the floor crumbles by itself.
- **Checklist Features:** Floor's count, 1 to 3 (layers).
- **Gives:** a shovel that breaks only snow (piece 13). Nothing drops.
- **Controls:** attack, "Break the snow"; move; jump.
- **Bots:** walk at a rival and break the blocks under them.

### Paired Parkour

Teammates are tied together by a lead and cross a parkour course; when one falls, both go back to
their last checkpoint. First team with both over the Finish wins; at time, the team further along
wins, and equal is a draw.

- **Marks:** **Checkpoints** (region, per team, 3, in order); **Finish** (region, per team); Kill Y.
  Two courses side by side, one per team, so leads never tangle.
- **Game settings:** `playTime`, **Time**, 90 s (30 to 180).
- **Checklist Features:** Checkpoints' count, 0 to 8.
- **Needs:** the players pack's leads (piece 15): the lead pulls at 5 blocks and holds about 5.9
  behind; the game can't make it shorter.
- **Controls:** move; jump; sprint.
- **Bots:** follow the course (piece 16).

### Carry Race

One teammate rides on the other's head through a maze. The carrier walks; the rider, up high, hits
the flags hung along the way that only a rider can reach. First team to hit all its flags and reach
the Finish wins. Halfway, at the Swap spot, they change places.

- **Marks:** **Flags** (point, per team, 6, high over the maze); **Swap** (point, per team);
  **Finish** (region, per team). Two mazes side by side, one per team.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120).
- **Needs:** the players pack's riding (piece 15): the rider sits 1.67 over the carrier's feet and
  they move together.
- **Controls:** move, "Carry: walk the maze"; attack, "Ride: hit the flags".
- **Bots:** carry along the maze's route (piece 16) and hit flags in reach.
- **Notes:** what the rider does is the open part of the draft (question 6).

### Cannon Duel

Each team has a cannon. The loader fetches cannonballs from the team's ammo pile and loads the
cannon (use on each); the aimer sits in the cannon, turns it by looking, and fires (attack). A ball
that lands in the other team's target scores. First to 3 wins; at time, more hits wins, and equal is
a draw.

- **Marks:** **Cannon** (point, per team): where it stands, facing its target; **Ammo** (point, per
  team); **Target** (region, per team): the box that team shoots at.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `hitsToWin`, **Hits to win**, 3 (1 to
  10); `reload`, **Reload**, 2 s (0 to 10).
- **Spawns:** the cannons (a model of the game's own with a seat) and cannonballs (a projectile of the
  game's own, flying by script from the cannon's aim).
- **Controls:** use, "Pick up and load a cannonball, or sit in the cannon"; look, "Aim" (piece 8);
  attack, "Fire".
- **Bots:** the loader walks between pile and cannon; the aimer fires with some error.

## 1v3

Every 1v3 map marks the solo's spawn and 3 for the trio (1v2 uses the first 2).

### Hunter (built, the plan's Hunter vs. Runners)

The runners start at one end, the hunter in the middle, who waits a moment after Go. A runner the
hunter hits is caught and out; one who reaches the goal is safe. The runners win if at least half get
home before time; otherwise the hunter wins.

- **Marks:** **Hunter spawn**, **Runner spawns** (3), **Goal** (region).
- **Game settings** (the numbers in `hunter.ts` today): `playTime`, **Time**, 45 s (20 to 120);
  `headStart`, **Hunter waits**, 2 s (0 to 10).
- **Notes:** the plan wanted up to 128 blocks for this one; the built one fits 40 x 60.

### Trap Master

The trio cross a gauntlet to the Finish. The solo watches from a booth and hits levers, each opening
its trap: the floor in its box drops away for a moment, and the lever then waits a few seconds. A
runner who falls goes back to the start. The runners win if at least half get through before time;
otherwise the master wins.

- **Marks:** **Master spawn** (point): in the booth, facing the course; **Runner spawns** (point, 3);
  **Traps** (region, 6, in order); **Levers** (point, as many as Traps, in the same order: the nth
  lever works the nth trap; piece 7); **Finish** (region, 1); Kill Y.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `open`, **Trap open for**, 20 tenths of
  a second (5 to 60); `cooldown`, **Lever waits**, 5 s (1 to 20).
- **Checklist Features:** Traps' count, 2 to 10 (Levers follow it).
- **Spawns:** a lever model at each Lever point.
- **Controls:** master: attack, "Hit a lever to spring its trap". Runners: move; jump; sprint.
- **Bots:** the master springs the trap a runner is on after a reaction delay; runners walk the
  course (piece 16).

### Defend the Core

The raider, with strong gear and many hearts, must break the Core. The three defenders, each with a
few hearts and back at their spawn a moment after going down, fight the raider off. The raider wins
by breaking the Core; the defenders by taking the raider down or holding until time.

- **Marks:** **Core** (point): the game stands the core there; **Raider spawn** (point);
  **Defender spawns** (point, 3).
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `coreHits`, **Hits to break the core**,
  20 (5 to 60); `raiderHearts`, **Raider's hearts**, 20 (5 to 60); `defenderHearts`, **Defenders'
  hearts**, 5 (1 to 20); `respawn`, **Defenders back after**, 3 s (0 to 10).
- **Gives:** the raider's and the defenders' kits (in code).
- **Controls:** raider: attack, "Hit the core and the defenders"; move. Defenders: attack, "Hit the
  raider"; move.
- **Bots:** the raider heads for the core and fights back when hit; defenders chase the raider.

### Trap Door Maze

The runners go through rows of doors toward the Finish. Before Go, the solo picks in secret which
door in each row is trapped (a menu: rows down, doors across, jump picks; piece 17). Past a trapped
door the floor drops into a pit that leads back to the row's start. Every fall scores for the solo,
every runner through the Finish for the trio; more points wins, equal is a draw.

- **Marks:** **Master spawn** (point): where the solo watches from; **Runner spawns** (point, 3);
  **Doors** (point, typed Row 1 to Row 4, 3 each): the middle of a doorway's floor, facing through it;
  **Finish** (region, 1). The pit under each row is the map's, with a way back to the row's start.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `trapsPerRow`, **Traps per row**, 1 (1
  to 2).
- **Checklist Features:** each row's door count, 2 to 4; Rows 3 and 4 can be off.
- **Controls:** solo: move, "Pick a door"; jump, "Set the trap". Runners: move; jump.
- **Bots:** a solo bot picks at random; runner bots pick a door at random.
- **Notes:** the game drops the 3 x 3 of floor just past a trapped door, by the door point's facing.

### Bomb Disposal

Needs the user's design: the draft says the trio solve a puzzle while the solo tries to stop them.
Proposed: three panels round the arena, each with 4 colored wires; the right order for each shows at
its clue spot somewhere else in the arena. A defuser hits a panel's wires in its clue's order; all
three done defuses the bomb. The attacker's hit freezes a defuser for a few seconds, and the
attacker can scramble one finished panel. The trio win by defusing in time; the attacker wins if the
bomb goes off.

- **Marks:** **Attacker spawn** (point); **Defuser spawns** (point, 3); **Bomb** (point): the bomb
  model and its timer; **Panels** (point, 3, facing where a player stands); **Clues** (point, 3, in
  the same order as the panels; piece 7).
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `freeze`, **Frozen for**, 3 s (1 to
  10); `wires`, **Wires per panel**, 4 (3 to 6).
- **Controls:** defusers: attack, "Hit the wires in the clue's order"; move. Attacker: attack,
  "Freeze a defuser, scramble a panel"; move.

### Prop Hunt (micro)

The trio hide as blocks of the arena (click a block to wear it, Chameleon's way) while the seeker
waits in the dark. Then the seeker hunts: a hit on a hidden player finds them, and they're out. The
seeker wins by finding all of them; the trio win if anyone is still hidden at time.

- **Marks:** **Seeker spawn** (point); **Hider spawns** (point, 3).
- **Game settings:** `hideTime`, **Time to hide**, 15 s (5 to 30); `playTime`, **Time to seek**, 60
  s (30 to 120).
- **Needs:** Chameleon's disguise (piece 18, question 8).
- **Controls:** hiders: use, "Wear the block you click"; move. Seeker: attack, "Hit a block you
  think is a player"; move.
- **Bots:** hiders wear a block beside them and keep still; the seeker hits blocks near where hiders
  are, finding them with a chance.

### Boss Fight

The solo is the Wither: big, hovering, firing skulls that knock players back and take hearts, its
health a bar everyone sees. The trio each have a few hearts and lives, with bows and swords. The
trio win by bringing the Wither's health to nothing; the Wither wins when the trio are all out or
time runs out.

- **Marks:** **Boss spawn** (point); **Trio spawns** (point, 3); Kill Y.
- **Game settings:** `playTime`, **Time**, 90 s (45 to 180); `bossHealth`, **Wither's health**, 100
  (20 to 500); `trioHearts`, **Trio's hearts**, 5 (1 to 20); `trioLives`, **Trio's lives**, 2 (1 to
  5).
- **Checklist Features:** Kill Y can be off.
- **Needs:** pieces 11, 12 and 19: the player's model swapped for the Wither's (the players pack,
  pointing at vanilla's model by name as the NPCs do), hovering by script (jump to rise, as Sumo's
  double jump pushes), skulls as projectiles of the game's own.
- **Controls:** Wither: use, "Fire a skull"; jump, "Rise"; move. Trio: attack, "Hit"; use, "Shoot";
  move.
- **Bots:** the Wither hovers and fires at the nearest player; the trio shoot from range.
- **Notes:** the riskiest one. Try the Wither form and its hover in a spike before the rest of it.
  The plan wanted up to 128 blocks for this one (question 9).

## Build order

A batch at a time, each a pass of its own with the user's look after it. A 20-turn game plays about
3 rounds each of 2v2 and 1v3, and only one of each is built, so the early batches bring more of
both.

0. **Pass 11's pieces** (1 to 6), and the look input (8). The three built minigames get their Game
   settings.
1. **Plain FFA**, nothing new: Mob Freeze, Do the Opposite, Don't Look, Button Mash, TNT Run, Anvil
   Rain, Chicken Chase, Egg Drop.
2. **Knockback and a second of each team format:** King of the Hill, Sumo Duel, Quick Draw, Tug of
   War (2v2), Trap Master (1v3, with lists in pairs).
3. **Place and break:** Bridge Dash, Mining Race, Spleef Duo (2v2).
4. **Answer pads and banks:** Quiz Floor, Name That Mob or Item, Count the Mobs, Simon Says, Item
   Scramble.
5. **Scripted hearts:** Mystery Kit Brawl, Defend the Core (1v3), Capture the Wool (2v2).
6. **Moving entities:** Snowball Sniper, Minecart Dodge, Cannon Duel (2v2).
7. **Riding and leads, bots on a course:** Paired Parkour, Carry Race, Rising Lava.
8. **The rest of 1v3:** Trap Door Maze, Bomb Disposal, Prop Hunt.
9. **Boss Fight**, after its spike.

## Questions for the user

1. **Test arenas in code:** every minigame lays one today, for playing without an arena map. Keep
   writing one for each new minigame, or drop them once Preview from an arena map (piece 6) lets the
   user's own map stand in from the start?
2. **Quick Draw and Sumo Duel:** play with 2 to 4 (FFA, so duels, Battles and any sudden death), as
   proposed, or duels only (a new 1v1 kind)?
3. **Mob Freeze:** caught moving sends a player back to the start (proposed) or out? And the mob: an
   Iron Golem (proposed), or another?
4. **Mystery Kit Brawl's reroll:** 2 coins in the middle of a minigame, a free reroll, or none?
5. **The banks** (Quiz Floor's questions, Name That Mob or Item's list, the kits): files of their own
   that the user edits (proposed), or texts in the dialogue tool?
6. **Carry Race:** what the rider does. Proposed: hits flags only a rider can reach, and the two
   swap halfway.
7. **Bomb Disposal:** the puzzle. Proposed: wire panels with clues elsewhere in the arena.
8. **Prop Hunt:** use Chameleon's disguise pack (its pack, not its game or maps)?
9. **Boss Fight:** worth the risk of a player as a hovering Wither? And does it fit 40 x 60 (the
   plan's open point for it, Hunter vs. Runners and Minecart Dodge; proposed: all three fit)?
10. **Tug of War:** the draft's knock-off (proposed), or a real tug: each team hits its end of a
    rope, the rope moves toward the team hitting more, and the losers are pulled into the water?
