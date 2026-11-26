# Block Party minigames (plan)

**Status:** plan, 2026-11-26, revised the same day with the user's answers ("The user's answers"
below). Every Block Party minigame, written out so each can be built: how it plays and ends, which
formats it plays (Plays as), what its arena map marks in the map editor, the numbers each map sets
(Game settings), the rows a map can turn off or count (Checklist Features), what the game spawns and
hands out, the tutorial's controls, how bots play it and its test arena. It covers pass 9 ("The rest
of the minigames") and the parts of pass 11 ("The minigame editor") the minigames need.

44 minigames, 3 of them built (Hot Floor, Co-op Painters, Hunter). Everything else is proposed, for
the user to change: the designs fill in what the user's one-liners leave open, and every number is a
starting point to tune in play tests. The questions still open are at the end.

**For the session that builds one:**
- Work in a worktree of your own (`CLAUDE.md`, "Branch and merge"). Build a batch at a time
  ("Build order"), stop and report after each, end the report with a list of what to test, and
  commit and push only that batch's files, with no attribution.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- The user builds and publishes every arena map. Never make a map thumbnail, a Minigame Thumbnail or
  a game picture, not even a placeholder.
- Test arenas are for testing only: a plain platform with the marks the minigame reads, nothing
  dressed up (piece 4).
- Anything the game says goes through the dialogue tool (`block-party.md`, "Dialogue").
- Item and model art is the user's: a new item or model gets a stand-in the user replaces.

## The user's answers (2026-11-26)

- **Test arenas:** yes, one in code for each minigame, for testing only, never in a real game. A
  plain platform is enough; the user makes the real arenas later. Some minigames need a **tiled**
  arena, a copy for each player as Build Swap does, so players don't get in each other's way.
- **Plays as:** every minigame gets four checkboxes, **1v1**, **FFA**, **2v2** and **1v3**, any
  number of them checked, set to defaults now for the user to change later.
- **Mob Freeze:** caught moving sends a player back to the start.
- **Carry Race:** the rider does nothing in game but guide the walker over the voice call, with
  buttons that call Left, Right, Straight and Back to the walker.
- **Removed:** Bridge Dash, Name That Mob or Item, Quick Draw, Trap Door Maze.
- **Merged:** Do the Opposite into Simon Says (do and don't commands, colors and actions).
- **Replaced:** Don't Look by **Enderman Roulette**; Prop Hunt by **Barnyard Bluff** (find the
  players disguised as farm animals).
- **Changed:** Hot Floor (1 x 1 tiles), Item Scramble (search chests), Button Mash (the launch
  cutscene), Kit Brawl (one kit for everyone, no coins, the name), Egg Drop (slow eggs), Minecart
  Dodge (a mineshaft lane crossing), Quiz Floor (4 answers, quiz show style), Count the Mobs (sheep,
  counted with jump), Spleef Duo (snowballs), Trap Master (more kinds of trap, water), Boss Fight
  (boss bar, powers lost as it weakens).
- **Bomb Disposal:** revise or remove; a new design below for the user to judge.
- **New:** Cook's Request, Slither, Mini Survival Games, Hot Potato, Leg Breaker, Montecarlo, Cactus
  Slap, Climb the Ladder, Hole in the Wall, Labyrinth, Towers of Fortune, Hook the Mob.

## How a minigame is built

1. **Its code:** `games/blockparty/behavior_pack/scripts/minigames/<id>.ts`, a `MinigameDef`
   (`kit.ts`): its id and name, the formats its code can play (piece 3), its rules line and
   tutorial, where each side starts (`spawns`), why a map can't be played (`problem`), and `play`,
   which returns the places or the side that won. Listed in `minigames/index.ts`.
2. **Its arena:** an entry with the same id in `minigames/arenas.ts`: its name, most players, teams
   (Red and Blue for 2v2), the Arena box (40 x 60 across at most, either way around, 48 tall),
   whether it's tiled (piece 9), and its checklist (`map`: spawns, points, regions, settings,
   adjustable rows). That entry is the map editor's and the Panel's "<Name> (Block Party)", kept in
   the map store as `blockparty-<id>`. An id is lower case letters and digits only.
3. **Its test arena:** a plain platform laid in code with the marks its `play` reads (piece 4).
4. **Its words:** the tutorial panel's objective and up to 3 controls for each side (`MAX_CONTROLS`).
   In code until pass 11 moves them to the dialogue tool.
5. **Its bots:** how a bot plays it, with `bots.ts`'s helpers (`stepToward`, `thinkTicks`).
6. **The arena map:** the user makes it under its entry, marks what the checklist asks, and
   publishes it. The next Block Party game has it, no Start needed.
7. **Trying it:** Tests' Play a minigame now, `/minigame win <name>`, and (piece 8) Preview from the
   arena map itself.

## What every minigame must handle

- **Every format it's checked for** (piece 3). FFA plays with 2, 3 or 4, and as a Battle (the same
  play with a pot). 1v1 is a duel (Versus, the Dueling Glove, a sudden death between two) on the
  first 2 spawns. 2v2 always has 4. 1v3 plays 1 against 3, or 1 against 2 with 3 players (the
  trio's marks list 3; 1v2 uses the first 2).
- **An end of its own.** The board waits for players; a minigame doesn't. Each has a time limit, and
  most end sooner (one left standing, a goal reached).
- **Places.** FFA and 1v1: places best first, ties allowed (`{ places }`). Teams: the side that won,
  or a draw (`{ winner }`). Coins follow `block-party.md`'s "Coins awarded".
- **Out players** watch from the spectator spawn as spectators (`play.out`); out bots float there.
- **Someone leaving** in the middle: `bodyOf` gives nothing and the rest play on.
- **Hits.** Block Party plays with `damage: "none"` and no fall damage (`game.config.ts`), which
  cancels every hit, knockback too. A minigame that wants hits to push, or to hurt, turns them on for
  its players while it plays (piece 13). A hit it only counts (Hunter's catch) is an
  `entityHitEntity`.
- **Adventure mode** (`minigame-runner.ts`): nobody breaks or places blocks unless the item they're
  handed allows it, or the minigame plays in Survival (piece 15).
- **The hotbar** is vanilla's while a minigame plays. Whatever a minigame hands out is taken back at
  its end.
- **Controls** are only what a script can read: the movement keys or stick (`getMovementVector`),
  jump, sneak (a plain press, never held while doing something else), attack (a hit on a mob or
  block), use (an item's use, or a use on a block or mob in reach), sprint, and where the player
  looks. No other key reaches a script, and a use with an empty hand at the sky fires nothing.
- **Nothing left over:** what a minigame spawns lives in its `scope` and ends with it, and the arena
  slot is put back after every minigame.
- **Arena maps keep no mobs or loose items:** the game spawns everything that moves (chickens,
  carts, sheep, farm animals) at the marks its map has.
- **Team colors** in a 2v2 are Red and Blue (`PAINTER_TEAMS`, to be shared by every 2v2). Team
  armor is `teamArmor` with vanilla leather (packs/armor's dyed pieces), never dyed by a script.
- **The status line** top right (`play.status`) carries its clock and score.

## What every arena map has (built)

| Mark | Map editor tool | What it's for |
|---|---|---|
| **Arena** box | Region tool (Arena) | What the game places: at most 40 x 60 across either way around, 48 tall. Everything below goes inside it |
| **Spectator spawn** | Spawn tool | Where out players watch from |
| **Minigame podium** | Game marker tool | 4 spots, 1st to 4th, where the results play |
| **Podium camera** | Game marker tool | The camera on the podium; a map can turn it off (Checklist Features) |
| **Start view** | Camera tool | The rules camera, while everyone gets ready |
| **Time of day** | Time tool | Set while the minigame plays, the board's put back after |

## The pieces the minigames need

Shared work the minigames lean on, built before the minigames that need them.

### For every minigame

1. **Game settings reach the minigame** (pass 11's per-minigame settings). An arena's `map.settings`
   is already in core's config, but nothing carries a map's numbers to the minigame yet: the Game
   settings tool on arena maps, and a `settings(key)` on the `Field` that `play` reads (the
   setting's default on a test arena).
2. **Kill Y reaches the minigame.** `mapField` brings the spawns, points, regions, spectator spawn,
   Start view and time, not the map's Kill Y. It comes along moved with the Arena box, so a minigame
   that ends in a fall reads `field.killY`.
3. **Plays as** (the user, 2026-11-26): four checkboxes on each minigame, **1v1**, **FFA**, **2v2**
   and **1v3**, any number checked.
   - **Where:** on the minigame's entry in the Panel ("<Name> (Block Party)", beside its maps), kept
     in the map store with the entry the way a game's picture is, so the next Block Party game uses
     them with no Publish or build. The defaults are the ones in "Overview".
   - **What they pick:** a round's format picks among the minigames checked for it: FFA rounds and
     Battles from FFA, duels from 1v1, 2v2 rounds from 2v2, 1v3 rounds from 1v3. A format with
     nothing checked falls back to what plays today (FFA minigames for duels). The sudden death's
     pool (Hot Floor, Sumo Duel and, proposed, Cactus Slap) plays as 1v1 for two tied players and
     FFA for more.
   - **Kind becomes kinds:** `Kind` (`minigame-rules.ts`) gains `1v1`, and a `MinigameDef` lists
     every format its code can play. The Panel grays out a box its code can't play.
   - **Any FFA minigame can play 1v1** with no change: two players on its first 2 spawns.
   - **Any FFA minigame can play 2v2 or 1v3** by a shared rule, for when the user checks one its
     design has no teams for: teammates wear team colors and can't hit or push each other, and the
     sides are judged from the places. 2v2: the side whose best player placed higher wins (level,
     then their second players; still level, a draw). 1v3: the solo wins by beating more of the
     others than beat them (1st or 2nd of 4; with 3 players 1st wins and 2nd is a draw).
   - **A team minigame plays FFA** only where its entry says how.
4. **Test arenas only in tests** (the user, 2026-11-26). Each minigame keeps its test arena in code:
   a plain platform (or a plain tile, piece 9) with the marks its `play` reads and only the shapes
   its rules can't play without (a ladder wall, a water channel). Never dressed up; the user builds
   the real arenas. A test arena never plays in a real game once the network is open: a **Test
   arenas** switch on the Panel's Block Party settings, on while no arena map is published (today
   every minigame plays its test arena), and off before players come. Off, the roulette leaves out
   every minigame with no published arena map, and test arenas play only from Tests, `/minigame`
   and Preview (question 1).
5. **Pot point** (pass 11): where a Battle's pot lands, the arena's middle without one. Every arena
   that plays FFA; a map can turn it off.
6. **Rules camera end** (pass 11): a second camera, and the rules camera pans slowly from the Start
   view to it while the tutorial is up. Every arena; a map can turn it off.
7. **Covered arena** (pass 11): a Game setting, 0 or 1, that cuts straight into the arena behind the
   stars with no camera coming down from above, for indoor arenas.
8. **Preview from an arena map** (pass 11): a Block Party preview straight into that minigame on that
   map, bots in the empty seats, `/minigame win` at hand, back in Edit when it ends.

### For the minigames named

9. **Tiled arenas** (the user, 2026-11-26): the arena map is one player's place (or one team's), and
   the game lays a copy for each, as Build Swap copies its arena (`docs/maps.md`, "Build Swap and
   Guess the Build"). The arena entry says whether a copy is per player or per side. The copies go
   side by side, east (+x) with no gap, the map's own first: inside the arena slot when they fit
   (a tile of at most 10 x 60 or 20 x 30 for four), otherwise far east of the board where arenas
   play on a board with no slot. Each copy's markup comes to the minigame as its own `Field`
   (`play.tiles`, in side order); the rules camera, spectator spawn and podium are the first
   copy's. Every copy is a ticking area while it plays (the server's 300-chunk room, Build Swap's
   limit). Montecarlo, Cook's Request, Paired Parkour, Carry Race.
10. **Lists in pairs and groups.** Trap Master's nth lever works its nth trap, and Montecarlo's nth
    hallway start is its nth hallway's (counts keep their order already); the checklist needs a rule
    that two lists have the same count. Montecarlo also groups its doors by the hallway box each is
    inside.
11. **A look input on the tutorial panel.** Its inputs are move, jump, attack, use, sneak and sprint
    (`TUTORIAL_INPUTS`); Enderman Roulette, Simon Says, Hook the Mob and Cannon Duel need "look" too
    (the mouse, the right stick, a touch drag).
12. **Banks the user writes:** Quiz Floor's questions, Kit Brawl's kits, Item Scramble's items, Cook's
    Request's dishes, Towers of Fortune's item pool and Mini Survival Games' loot, each a file in
    `games/blockparty/` like `items.json` and `dice.json` (question 5). Until the user fills one, a
    short list in code stands in.
13. **Hits: pushes and real damage.** Block Party's combat is `damage: "none"`, which cancels every
    hit and its knockback (core's `combat.ts`). A minigame says what a hit does to its players while
    it plays:
    - **Push:** a 0-damage hit, with vanilla's knockback and hit cooldown (Sumo's way). King of the
      Hill, Sumo Duel, Cactus Slap, Climb the Ladder, Hot Potato, Tug of War, Capture the Wool, Spleef
      Duo's snowballs.
    - **Real:** vanilla damage, weapons, armor, potions, falls and magma all counting, and vanilla's
      hearts on the HUD. Core already catches a lethal hit before it kills (no death screen) and
      calls `down`; the minigame takes that player out. Kit Brawl, Towers of Fortune, Mini Survival
      Games, Leg Breaker, Defend the Core, Boss Fight.
    - Teammates never hit each other. Health is put back to full when the minigame ends.
14. **Extra knockback:** a push on top of a hit by script (`applyKnockback`), Sumo's measured
    numbers (a 1.5x push on top of a 0-damage hit is twice vanilla's). Every minigame with a
    Knockback setting.
15. **Place and break, and Survival mode.** Blocks and tools handed out with `setCanPlaceOn` and
    `setCanDestroy`, so an Adventure player places or breaks only what the minigame allows: Mining
    Race, Spleef Duo, Cook's Request. Towers of Fortune plays in Survival instead (anything placed
    or broken, spawn eggs work): the arena is placed fresh each time, the Arena box keeps players in,
    and what's on the ground is cleared with it.
16. **Moving entities of the game's own:** a model moved and turned by script, like the board's NPCs:
    Mob Freeze's mob, Enderman Roulette's Enderman, Button Mash's buttons, Egg Drop's eggs, Snowball
    Sniper's targets, Minecart Dodge's carts and logs, Count the Mobs' sheep, Hook the Mob's mobs,
    Cannon Duel's cannons and balls, Trap Master's TNT, Bomb Disposal's bombs.
17. **Moving platforms that carry players:** Minecart Dodge's logs. A player doesn't move with an
    entity they stand on, so the game carries whoever stands on a log by the log's step each tick.
    Smooth carrying may jitter; the fallback moves logs a block at a time with their riders. Try
    both in a spike, headless and then in game, before the rest of Minecart Dodge.
18. **Riding and leads** (the players pack, built in the spike: `private_packs/players/`): `addRider`
    puts a player on another's head and they move together; `leashTo` ties a player to another, the
    lead pulling at 5 blocks. Carry Race, Paired Parkour.
19. **Words for one player:** `play.tell(who, text)`, a notice in one player's dialogue box, and a
    status line of their own. Carry Race's calls, Count the Mobs' count, Hot Potato's "you have
    it", Item Scramble's finds, Bomb Disposal's defusing.
20. **Cameras in a minigame:** a fixed view everyone looks through (Count the Mobs' Pen camera), a
    camera preset that follows a player (Labyrinth's hunter, high over them, as the `follow_orbit`
    presets in Chameleon's private pack do), and short shots one after another (Button Mash's
    launches), with the runner's camera code (rules camera, podium camera).
21. **Bots on a course:** bots that follow a route with jumps and climbs, using the board's walk
    (`terrain.ts`, `walk-plan.ts`, `walk-follow.ts`) from checkpoint to checkpoint. Rising Lava,
    Paired Parkour, Carry Race, Trap Master, Minecart Dodge, Leg Breaker, Labyrinth.
22. **Playing as a mob:** the player's model swapped for a vanilla mob's (the players pack, pointing
    at vanilla's model by name as the board's NPCs do), name tag hidden. Boss Fight's Wither, Barnyard
    Bluff's cows, pigs, sheep and chickens, and (a look only) Labyrinth's hunter. The player's eye
    height and hitbox stay a player's (Chameleon found they can't change). One spike for both before
    either minigame.
23. **A boss bar:** vanilla shows one only for an entity with `minecraft:boss`, so a hidden entity of
    the game's own carries it, its health set by script to the Wither player's and its name the
    bar's title, close enough that everyone in the arena sees it. Boss Fight.

## Overview

"Plays as" is each minigame's default checks (piece 3); the user changes them on the Panel.

| Minigame | id | Plays as | About | Status | Pieces past 1 to 8 |
|---|---|---|---|---|---|
| Hot Floor | `hotfloor` | FFA, 1v1 | up to 12 rounds | Built (1 x 1 tiles to do) | 2 |
| Mob Freeze | `mobfreeze` | FFA, 1v1 | 30 s | Proposed | 16 |
| Simon Says | `simon` | FFA, 1v1 | 60 s | Proposed | 11 |
| Enderman Roulette | `enderman` | FFA, 1v1 | 60 s | Proposed | 11, 16 |
| Button Mash | `buttonmash` | FFA, 1v1 | 10 s and launches | Proposed | 16, 20 |
| Anvil Rain | `anvilrain` | FFA, 1v1 | 60 s | Proposed | |
| TNT Run | `tntrun` | FFA, 1v1 | 60 s | Proposed | 2 |
| Egg Drop | `eggdrop` | FFA, 1v1 | 30 s | Proposed | 16 |
| Hot Potato | `hotpotato` | FFA | 60 s | Proposed | 13, 19 |
| Hole in the Wall | `holeinwall` | FFA, 1v1 | 60 s | Proposed | 2 |
| Minecart Dodge | `minecarts` | FFA, 1v1 | 60 s | Proposed, spike first | 16, 17, 21 |
| Rising Lava | `risinglava` | FFA | 60 s | Proposed | 21 |
| Leg Breaker | `legbreaker` | FFA, 1v1 | 60 s | Proposed | 13, 21 |
| Montecarlo | `montecarlo` | FFA, 1v1 | 60 s | Proposed | 9, 10 |
| Climb the Ladder | `ladder` | FFA, 1v1 | 45 s | Proposed | 13, 14 |
| Item Scramble | `scramble` | FFA, 1v1 | 3 rounds | Proposed | 12, 19 |
| Snowball Sniper | `snowball` | FFA, 1v1 | 40 s | Proposed | 16 |
| Chicken Chase | `chickens` | FFA, 1v1 | 30 s | Proposed | |
| Mining Race | `mining` | FFA, 1v1 | 30 s | Proposed | 15 |
| Slither | `slither` | FFA, 1v1, 2v2 | 45 s | Proposed | |
| Hook the Mob | `hookmob` | FFA, 1v1, 2v2 | 45 s | Proposed | 11, 16 |
| Cook's Request | `cook` | FFA, 2v2 | 3 dishes | Proposed | 9, 12, 15 |
| Quiz Floor | `quiz` | FFA, 1v1 | 8 questions | Proposed | 12 |
| Count the Mobs | `countmobs` | FFA, 1v1 | 3 rounds | Proposed | 16, 19, 20 |
| Kit Brawl | `kitbrawl` | FFA, 1v1, 2v2 | 30 s | Proposed | 2, 12, 13 |
| King of the Hill | `hill` | FFA, 1v1 | 40 s | Proposed | 2, 13, 14 |
| Sumo Duel | `sumoduel` | 1v1, FFA | 45 s | Proposed | 2, 13, 14 |
| Cactus Slap | `cactus` | FFA, 1v1 | 60 s | Proposed | 2, 13, 14 |
| Towers of Fortune | `towers` | FFA, 1v1 | 120 s | Proposed | 2, 12, 13, 15 |
| Mini Survival Games | `survival` | FFA, 2v2 | 120 s | Proposed | 12, 13 |
| Co-op Painters | `painters` | 2v2 | 30 s | Built | |
| Tug of War | `tugofwar` | 2v2 | 45 s | Proposed | 2, 13, 14 |
| Capture the Wool | `wool` | 2v2 | 60 s | Proposed | 13 |
| Spleef Duo | `spleef` | 2v2, FFA, 1v1 | 60 s | Proposed | 2, 13, 14, 15 |
| Paired Parkour | `parkour` | 2v2 | 90 s | Proposed | 2, 9, 18, 21 |
| Carry Race | `carryrace` | 2v2 | 60 s | Proposed | 9, 18, 19, 21 |
| Cannon Duel | `cannons` | 2v2 | 60 s | Proposed | 11, 16 |
| Hunter (Hunter vs. Runners) | `hunter` | 1v3 | 45 s | Built | |
| Trap Master | `trapmaster` | 1v3 | 60 s | Proposed | 2, 10, 16, 21 |
| Defend the Core | `core` | 1v3 | 60 s | Proposed | 13 |
| Barnyard Bluff | `barnyard` | 1v3 | 75 s | Proposed, spike first | 22 |
| Labyrinth | `labyrinth` | 1v3 | 60 s | Proposed | 20, 21, 22 |
| Boss Fight | `bossfight` | 1v3 | 90 s | Proposed, spike first | 2, 13, 14, 22, 23 |
| Bomb Disposal | `bomb` | 1v3 | 75 s | New design, keep or cut | 16, 19 |

Each entry below lists the map's marks besides every map's own (above), its Game settings as
`key`, **label**, default and range, and its Checklist Features beyond the Podium camera, Pot point
and Rules camera end every map has. Spawns are the Spawn tool's, points the Game marker tool's,
regions the Region tool's; every one of them inside the Arena box. A 1v1 uses the first 2 spawns.

## Quick reflexes

### Hot Floor (built; to change: 1 x 1 tiles)

A color is called; after a countdown every tile of another color vanishes, and whoever isn't on the
color falls and is out. The tiles come back in new colors, the countdown shorter each round. Last
one standing wins; the rest place by when they fell (falling together is a tie).

- **Change (the user):** every tile one block (`hot-floor.ts` lays 3 x 3 tiles today, `TILE`). A
  player can stand on a corner of a block of the right color with most of them over another, so a
  fall is judged by where the player ends up (below the floor, or Kill Y with piece 2), not by the
  tile under their middle.
- **Marks:** 4 spawns on the floor; **Floor (tiles)**, a region whose lowest layer is the tiles, a
  block each (at least 6 x 6).
- **Game settings** (the numbers in `hot-floor.ts` today): `firstCount`, **First countdown**, 40
  tenths of a second (15 to 100); `lastCount`, **Shortest countdown**, 15 tenths (5 to 50);
  `countStep`, **Shorter each round by**, 3 tenths (0 to 20); `rounds`, **Most rounds**, 12 (3 to
  30); `colors`, **Colors**, 6 (2 to 6).
- **Checklist Features:** Kill Y can be off.
- **Test arena:** today's, with 1 x 1 tiles.

### Mob Freeze

Red Light, Green Light. Everyone starts on a line facing a mob at the far end. While it looks away,
players creep toward it; it turns around after a warning sound, and anyone moving while it watches
goes back to the start line and starts again (the user). First over the Finish wins; when time runs
out, the rest place by how close they got.

- **Marks:** 4 spawns on the start line, facing the mob; **Mob** (point, 1): where it stands,
  facing the players; **Finish** (region, 1): a player over it has made it.
- **Game settings:** `playTime`, **Time limit**, 30 s (15 to 90); `awayMin` and `awayMax`, **Looks
  away for**, 10 to 40 tenths of a second (5 to 100); `watch`, **Watches for**, 25 tenths (10 to
  60); `warning`, **Warning before it turns**, 5 tenths (0 to 20); `grace`, **Reaction time**, 3
  tenths (0 to 10): moving this soon after it turns doesn't count.
- **Spawns:** the mob, an entity of the game's own on a vanilla mob's model like the board's NPCs
  (an Iron Golem proposed), turned by script.
- **Controls:** move, "Creep toward the mob while it looks away"; sprint, "Go faster".
- **Bots:** walk while it looks away, stop at the warning, now and then a moment late.
- **Notes:** moving is the movement input or a jump, read each tick while it watches, so pushing
  against a wall counts too.
- **Test arena:** a plain strip with the start line at one end and the mob at the other.

### Simon Says (with Do the Opposite)

Each player stands on a small fenced pad facing a station of 4 colored blocks. Commands come one at a
time, each with a short answer time:

- **Colors:** "Hit red!", or "Don't hit red!", which means hit one of the other three.
- **Actions:** "Jump!", "Sneak!", "Spin around!" (a full turn), "Look up!", "Look down!", "Keep
  moving!" and "Freeze!" (both held for the whole answer time).
- **Don'ts:** "Don't jump!", "Don't sneak!", "Don't look up!" and the like are traps: doing it is
  wrong.

A wrong answer, or none to a command that wants one, costs a heart; out at none. The answer time
shortens as it goes. Last one in wins; the rest place by when they went out.

- **Marks:** 4 spawns, each on its own pad; **Stations** (point, 4, in spawn order): the middle of
  each player's 2 x 2 of colors, facing them (the game lays the colors); **Display** (point, 1): a
  big 2 x 2 everyone sees, which lights the called color.
- **Game settings:** `hearts`, **Hearts**, 2 (1 to 5); `firstWindow`, **First answer time**, 30
  tenths of a second (10 to 60); `lastWindow`, **Shortest answer time**, 12 tenths (5 to 30);
  `commands`, **Most commands**, 20 (5 to 40); `dontShare`, **Don't commands**, 35% (0 to 70).
- **Checklist Features:** Display can be off.
- **Controls:** attack, "Hit the color it calls"; look, "Spin, look up or down" (piece 11); move,
  "Keep moving or freeze". Jump and sneak are named in the commands themselves.
- **Bots:** right about 85% of the time.
- **Notes:** each command's words are texts in the dialogue tool. A hit on a color is
  `entityHitBlock`; if Adventure mode stops it firing, the colors are entities of the game's own, hit
  like Button Mash's buttons. Unlit, a color is its terracotta; lit, its concrete. A spin is a turn
  of 330 degrees or more one way within the answer time; looking up or down is past 60 degrees.
  Keep moving is movement input every tick after the first half second; Freeze is none, and no
  jump. Moving is the movement input, not where the player is, so a small pad works.
- **Test arena:** 4 pads in a row, each with its station.

### Enderman Roulette (replaces Don't Look)

An Enderman stands in front of everyone. Each round, everyone stares at it, and it grows restless:
shaking, then humming, then trembling. At a hidden moment it snaps, screaming with its jaw open:
anyone still looking at it is out. Looking away first is safe, and the longer you stared, the more
you score: in each round the safe players score in the order they looked away, the last to look
away the most (as many points as players), the first 1. Once you look away, you're done for the
round. Players out place below everyone still in, by when they went out; those still in after the
last round place by points.

- **Marks:** 4 spawns facing the Enderman; **Enderman** (point, 1): where it stands, facing them.
- **Game settings:** `rounds`, **Rounds**, 5 (1 to 10); `snapMin` and `snapMax`, **Snaps after**, 30
  to 120 tenths of a second (10 to 300); `cone`, **Looking at it within**, 15 degrees (5 to 45).
- **Spawns:** the Enderman, an entity of the game's own on vanilla's Enderman model, with vanilla's
  angry face for the snap and a scream animation.
- **Controls:** look, "Stare, and look away before it snaps" (piece 11).
- **Bots:** look away at a random moment in the round's window, now and then too late.
- **Notes:** players are held where they stand and only turn. Looking at it is the angle between the
  player's view and the line to its head, with nothing solid between. A player not looking at it
  when a round starts counts as looking away first.
- **Test arena:** a plain platform with the Enderman at one end.

### Button Mash

Each player faces a big button of their own. On Go, hit it as many times as you can; its count rises
over it. When time's up, a cutscene goes through the players from last place to first (the user):
the camera on each in turn as they blast up into the sky on a firework trail, higher for more hits,
the winner last and highest. Then the podium. Most hits wins; equal counts tie.

- **Marks:** 4 spawns; **Buttons** (point, 4, in spawn order): each in reach in front of its player,
  facing them. Keep the sky over the spawns open.
- **Game settings:** `playTime`, **Time**, 10 s (5 to 30).
- **Spawns:** 4 buttons, a model of the game's own that presses in on a hit.
- **Controls:** attack, "Hit your button".
- **Bots:** a hit every 3 to 5 ticks.
- **Notes:** a vanilla button has a cooldown and a held use repeats by itself, so the count is hits
  on the button entity (`entityHitEntity`), only its own player's. Players are held in place while
  it plays. Each launch is about 2 seconds, shot from in front of the player's button looking up
  (piece 20); the launch is a push straight up, and the player is put back before they land.
- **Test arena:** a plain platform, 4 buttons in a row.

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
- **Test arena:** a plain platform with room above.

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
- **Test arena:** 3 plain layers, 6 blocks apart.

### Egg Drop

Eggs drift down over the drop area, slowly (the user), each with a shadow under it; catch them before
they land by walking into them. Brown eggs count 2 and blue eggs 3. An egg that lands breaks with a
splat. Most points wins.

- **Marks:** 4 spawns; **Drop** (region, 1): eggs start at its top and fall over its footprint (the
  floor goes inside it).
- **Game settings:** `playTime`, **Time**, 30 s (15 to 90); `eggRate`, **Eggs a second**, 2 (1 to
  8); `eggSpeed`, **Fall speed**, 3 blocks a second (1 to 10); `rareShare`, **Brown and blue
  eggs**, 15% (0 to 50).
- **Spawns:** eggs, an entity of the game's own on vanilla's egg look (each color), moved down by
  script at the fall speed. An egg item falls at vanilla's speed, which is why they aren't items.
- **Controls:** move, "Get under the eggs"; jump, "Catch the high ones"; sprint.
- **Bots:** run to the nearest egg's landing spot.
- **Notes:** a catch is an egg within a player's box, then it's gone with a pop.
- **Test arena:** a plain platform.

### Hot Potato (new)

One player holds a hot potato and passes it with a hit; no passing it straight back. Its fuse is
hidden (15 to 30 seconds), but it shows how close it is: smoke over the holder, then flames, and a
ticking that speeds up. The holder runs a little faster, to catch someone. When the fuse runs out it
pops: the holder blasts up in a puff and is out, and after a moment a new potato goes to a random
player still in. Last one in wins; the rest place by when they popped.

- **Mechanics (the user asked for help):** the hidden fuse above is proposed. Two others to pick
  from (question 2): a **heat meter** each, filling only while you hold it, out when it's full (no
  luck, and nobody waits out a fuse); or **lives**, each pop costing the holder one of 3, out at
  none (longer, nobody out at the first pop).
- **Marks:** 4 spawns, in a walled arena.
- **Game settings:** `fuseMin` and `fuseMax`, **Fuse**, 15 to 30 s (5 to 90); `noPassBack`, **No
  passing back for**, 20 tenths of a second (0 to 50); `holderSpeed`, **Holder's speed**, 1 (0 to
  3), a Speed level.
- **Gives:** the potato, locked in the holder's hand.
- **Controls:** attack, "Pass the potato with a hit"; move; sprint.
- **Bots:** the holder chases the nearest player; the others keep away from the holder.
- **Notes:** a pass is a push-only hit (piece 13), so the one passed to is knocked back too. "You
  have it" shows to the holder alone (piece 19).
- **Test arena:** a plain walled platform.

### Hole in the Wall (new)

Players stand on a platform over water. Walls come at them one after another, each with holes shaped
for a player, fewer holes than players. Get in a hole: the wall passes around you. A wall that
reaches a player outside a hole pushes them off the far edge into the water, out. Each wall comes
faster. Last one in wins; the rest place by when they went out.

- **Marks:** 4 spawns on the platform; **Platform** (region, 1): where players stand, which the wall
  sweeps across; **Wall start** (region, 1): the wall's shape where it starts, a box one block thick
  across the platform's width at one end; the wall moves from there across the Platform to its far
  side; Kill Y.
- **Game settings:** `walls`, **Walls**, 10 (3 to 30); `firstSpeed`, **First wall speed**, 2 blocks
  a second (1 to 8); `lastSpeed`, **Last wall speed**, 5 (1 to 12); `holes`, **Holes**, 0 (0 to 6): 0
  means one fewer than the players still in.
- **Spawns:** each wall as blocks, moved a layer at a time (the new layer placed, the old cleared),
  its holes cut at random: 1 wide and 2 tall at the floor, some raised a block to jump into.
- **Controls:** move, "Get in a hole"; jump, "Jump into the high ones".
- **Bots:** walk to the nearest free hole's line after a reaction delay.
- **Notes:** blocks moved by script don't push players, so the game pushes anyone the wall's new
  layer would overlap who isn't inside a hole.
- **Test arena:** a plain platform over water, the wall start at one end.

## Races and courses

### Minecart Dodge (changed: a lane crossing in a mineshaft)

A lane-crossing race through a mineshaft (the user): get from the Start across the lanes to the
Finish.

- **Track lanes:** carts run along them, each lane its own speed and direction: minecarts, chest
  carts and furnace carts, and now and then a TNT cart that blows up when it reaches a player,
  sending everyone within a few blocks back. A cart that hits you sends you back to the start.
- **Water lanes:** logs of different lengths float along them; stand on a log and it carries you.
  Big dripleaves on the water (the map's own blocks; vanilla tips them a moment after you land) are
  stepping stones too. Falling in the water sends you back to the start.

First over the Finish wins; at time, the rest place by the furthest lane they reached, then by who
reached it first.

- **Marks:** 4 spawns at the start; **Finish** (region, 1); **Track lanes** (region, up to 10): each
  a straight box, carts running its long way in either direction (build the rails inside it);
  **Water lanes** (region, up to 8): logs float along its long way on the water's top.
- **Game settings:** `playTime`, **Time limit**, 60 s (30 to 120); `cartSpeed`, **Cart speed**, 5
  blocks a second (2 to 15), each lane a little faster or slower; `cartGap`, **A cart every**, 30
  tenths of a second (10 to 100); `tntShare`, **TNT carts**, 5% (0 to 30); `tntRadius`, **TNT
  blast**, 3 blocks (1 to 6); `logSpeed`, **Log speed**, 2 blocks a second (1 to 8); `logMin` and
  `logMax`, **Log length**, 2 to 5 blocks (1 to 10); `respawn`, **Back after**, 10 tenths of a
  second (0 to 40).
- **Checklist Features:** Track lanes' count, 0 to 10; Water lanes' count, 0 to 8.
- **Spawns:** carts, the game's own entity on vanilla's minecart, chest, furnace and TNT minecart
  models, moved by script (vanilla's rail physics can't be told where to go or how fast); logs, the
  game's own entities a player can stand on, carrying them (piece 17).
- **Controls:** move; jump, "Hop onto logs and leaves"; sprint.
- **Bots:** wait for a gap in a track lane and cross; step onto a log as it comes (piece 21).
- **Notes:** the TNT cart's blast is a look and a push, breaking no blocks. Spike piece 17 first: the
  logs are the risky part.
- **Test arena:** a plain strip with 3 track lanes and 2 water lanes.

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
- **Bots:** climb along a route the game finds from the platforms (piece 21); they're weak here.
- **Notes:** a player is out once the liquid's top passes their feet, so swimming up in water saves
  nobody. With no damage, lava doesn't hurt, though it may still set players alight to look at.
- **Test arena:** a plain tower of steps.

### Leg Breaker (new)

Everyone jumps down a shaft through layers of platforms with holes in them; first to the bottom wins.
Each layer mixes five blocks, each landing its own way (vanilla's own): **slime** bounces you back up,
**cobweb** catches you and slows you, **hay bale** takes most of a fall's damage, **concrete** takes
none of it, and **magma** burns while you stand on it. Falls hurt for real in this one (piece 13); a
hard landing (3 hearts or more) also breaks a leg: Slowness for 3 seconds. A player with no hearts
left goes back to the top, healed. At time, the rest place by how deep they got.

- **Marks:** 4 spawns at the top; **Bottom** (region, 1): reaching it is the finish (water there
  makes a soft landing); **Layers** (region, 1): the game lays random layers in it each time, evenly
  spaced, each a noise mix of the five blocks with holes.
- **Game settings:** `playTime`, **Time limit**, 60 s (30 to 120); `layers`, **Layers**, 8 (3 to
  15); `holes`, **Holes**, 25% (10 to 60); `slime`, `cobweb`, `hay`, `concrete` and `magma`, **Slime,
  Cobweb, Hay, Concrete, Magma**, 15, 10, 20, 40 and 15 (0 to 100 each), how much of each the layers
  get; `respawn`, **Back to the top after**, 2 s (0 to 10).
- **Checklist Features:** Layers can be off: the map's own layers, built by the user, stay as they
  are (the user: built or random).
- **Controls:** move, "Find the holes"; jump; sneak, "Stand on magma without burning" (vanilla's).
- **Bots:** walk to the nearest hole over the next layer's softest block and drop.
- **Notes:** 48 blocks is a short fall for this; a taller Arena box for Leg Breaker alone (96
  proposed) if the slot's sky has the room (question 8).
- **Test arena:** a plain shaft, the game's random layers in it.

### Montecarlo (new, tiled)

A run of hallways, each ending in a wall of doors: one or two lead on to the next hallway, and the
rest drop you back to the start of the hallway you're in. Through the last hallway's right door is
the Finish. Fastest through wins; at time, the rest place by hallways passed, then by who got there
first.

- **Tiled** (piece 9): each player plays their own copy, so nobody can follow anyone through the
  right door; each copy gets its own right doors at random, so watching through a window teaches
  nothing.
- **Marks** (one player's copy): 1 spawn at the start; **Hallways** (region, 3 to 8, in order): each
  hallway's box; **Hallway starts** (point, as many as Hallways, in the same order: where a wrong door
  puts you back; piece 10); **Doors** (region, 2 to 6 inside each hallway box): each the space just
  behind a door; **Finish** (region, 1).
- **Game settings:** `playTime`, **Time limit**, 60 s (30 to 120); `rightDoors`, **Right doors per
  hallway**, 1 (1 to 2); `backAfter`, **Back after a wrong door**, 10 tenths of a second (0 to 40).
- **Controls:** use, "Open a door"; move, "Go through".
- **Bots:** try a door they haven't tried in this hallway, a few seconds each.
- **Notes:** the doors are vanilla wooden doors (Adventure opens them), or open doorways. Stepping
  into a door's box decides it: a right door moves you to the next hallway's start (or the Finish),
  a wrong one drops you through a trapdoor look and back to this hallway's start. Nothing behind a
  door needs building.
- **Test arena:** a plain tile, 4 hallways of 3 doors.

### Climb the Ladder (new)

A tall wall of ladders. Everyone climbs; hit the others to knock them off. A fall lands you at the
bottom to climb again (no fall damage). First to the top wins; at time, the rest place by how high
they got.

- **Marks:** 4 spawns at the bottom; **Top** (region, 1): reaching it wins. The ladders are the
  map's.
- **Game settings:** `playTime`, **Time limit**, 45 s (20 to 120); `knockback`, **Knockback**, 20
  tenths of vanilla's (10 to 40).
- **Controls:** move and jump, "Climb"; attack, "Knock them off".
- **Bots:** climb their own column and hit anyone in reach.
- **Notes:** a hit pushes out from the wall (pieces 13 and 14) so the climber lets go. Try how a
  ladder holds a pushed player in game early.
- **Test arena:** a plain wall with 4 ladder columns.

## Points and collecting

### Item Scramble (changed: search the chests)

Each player starts in a ring of 8 chests of their own (the user). An item is called ("Find a golden
carrot!"), and everyone searches their chests, full of random items, for it: having it in your
inventory is a find. Finds score by order, 3 for the first, then 2 and 1. A new item each round, the
chests refilled. Most points after the rounds wins.

- **Marks:** 4 spawns, each with room around it for its ring.
- **Game settings:** `rounds`, **Rounds**, 3 (1 to 6); `roundTime`, **Round time**, 30 s (10 to
  60); `ring`, **Chests this far out**, 3 blocks (2 to 6); `perChest`, **Items in a chest**, 12 (4 to
  27).
- **Spawns:** 8 chests around each spawn, facing it. Every player's chests hold the same items,
  shuffled among the chests and slots; the called item is in exactly one of them.
- **Bank:** the items it calls and the ones that fill the chests (piece 12).
- **Controls:** use, "Open a chest"; move.
- **Bots:** open a chest every 2 to 3 seconds, finding the item when they open its chest.
- **Notes:** players are kept within their own ring (put back as Build Swap does past its padding).
  Every round the inventory is cleared and the chests are refilled. A find shows to that player
  (piece 19) and the scores to all.
- **Test arena:** a plain platform, 4 spawns far apart.

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
- **Test arena:** a plain platform, the stands at one end.

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
- **Test arena:** a plain walled pen.

### Mining Race

Each player has a cube of stone, filled with ores by the game. Break ores for points (coal and copper
1, iron, redstone and lapis 2, gold 3, diamond 5, emerald 8). Most points wins.

- **Marks:** 4 spawns; **Mines** (region, 4, in spawn order): each player's cube, which the game fills.
- **Game settings:** `playTime`, **Time**, 30 s (15 to 90); `oreShare`, **Ores**, 15% of the blocks
  (5 to 50).
- **Checklist Features:** Mines' count, 1 or 4: with one, everyone digs the same cube.
- **Gives:** a pickaxe that breaks only stone and the ores (piece 15), quick enough to dig fast.
  Nothing drops.
- **Controls:** attack, "Mine"; move.
- **Bots:** break the nearest ore every second or two.
- **Test arena:** a plain platform with 4 cubes.

### Slither (new)

Everyone starts on a small patch of their own color and grows it by walking: the floor block under
you takes your color when it's unpainted and next to (side by side, not corner to corner) a block
already yours. Nobody paints over anyone else. Walk anywhere, but grow only from your own edge, so
cut the others off. Most blocks at time wins.

- **Marks:** 4 spawns on the floor; **Floor** (region, 1): its lowest layer is what gets painted,
  flat, in any one block.
- **Game settings:** `playTime`, **Time**, 45 s (20 to 120); `startPatch`, **Starting patch**, 2
  blocks across (1 to 4).
- **Plays as 2v2:** each team one color, growing from any of its blocks.
- **Controls:** move, "Grow your color from its edge"; sprint.
- **Bots:** walk along their edge toward the most unpainted blocks.
- **Notes:** shares Co-op Painters' floor painting (`painters.ts`). Colors: each player's concrete
  (red, blue, green, yellow); Red and Blue in a 2v2. It ends early when nobody can grow.
- **Test arena:** a plain platform.

### Hook the Mob (new)

Mobs wander a pen in the middle; each player stands at the edge of their own pit. Cast your fishing
rod, hook a mob, and reel it in: it flies up in an arc to where you're looking. Land it in your pit to
score (chickens 1, pigs 2, sheep 2, cows 3). Creepers are bad: one in a pit blows, and that pit's
player loses 3. Aim one at someone else's pit. Most points wins.

- **Marks:** 4 spawns, each at its pit; **Pits** (region, 4, in spawn order); **Pool** (region, 1):
  where the mobs wander.
- **Game settings:** `playTime`, **Time**, 45 s (20 to 120); `mobs`, **Mobs at once**, 10 (4 to 30);
  `creeperShare`, **Creepers**, 15% (0 to 50); `reach`, **Throws up to**, 12 blocks (6 to 30).
- **Plays as 2v2:** each team's two pits count for the team.
- **Spawns:** the mobs, entities of the game's own on vanilla's models, walked about the pool by
  script and thrown on an arc by script.
- **Gives:** a fishing rod.
- **Controls:** use, "Cast, then reel in"; look, "Aim at your pit" (piece 11).
- **Bots:** cast at the nearest good mob and aim at their pit; now and then a creeper at the
  leader's.
- **Notes:** a hook landing on a mob hooks it (`projectileHitEntity` with the fishing hook); the
  second use reels it in, and it flies toward the block the player looks at, as far as the reach.
  One that lands outside every pit walks back to the pool.
- **Test arena:** a plain platform, a pen in the middle and 4 pits around it.

### Cook's Request (new, tiled)

A farm. A villager asks for a dish, and everyone races to make it: harvest the crops, collect eggs,
milk the cow, fetch what's in the pantry chests, craft and cook (crafting table, furnace, smoker),
then hand the dish to the villager. The dishes take several steps: cake, pumpkin pie, rabbit stew,
cookies, golden carrots, and the custom foods the user adds to the main resource pack (sushi and the
rest; none in the repo yet, question 4). Each request scores by order of delivery (3, 2, 1), then the
farm resets for the next. Most points after the requests wins.

- **Tiled** (piece 9): each player (each team in 2v2) has a farm of their own, so nobody takes
  anyone's wheat; in a 2v2 the two cook together.
- **Marks** (one farm): 1 spawn; **Villager** (point): where the customer stands; **Pantry**
  (point, 1 to 6): chests the game fills each request; **Cow** and **Chickens** (point, 0 to 4
  each): where the game puts them. Crops, crafting tables and furnaces are the map's own blocks.
- **Game settings:** `requests`, **Requests**, 3 (1 to 5); `requestTime`, **Time per request**, 60
  s (30 to 180).
- **Bank:** the dishes, each with its ingredients and where they come from (piece 12).
- **Gives:** a hoe and shears that break only the farm's crops and leaves (piece 15), a bucket and
  bowls as the dish needs.
- **Controls:** use, "Harvest, craft, cook and hand it over"; attack, "Break crops"; move.
- **Bots:** deliver after a time drawn around a good player's, now and then late.
- **Notes:** the farm resets by placing its copy again. The villager is the board's Villager NPC
  model. Eggs come from the chickens' spot as items, quicker than vanilla laying.
- **Test arena:** a plain tile with a few crops, a crafting table, a furnace and a chest.

## Brains

### Quiz Floor (changed: 4 answers, quiz show style)

A question shows in the dialogue box with 4 answers, each over one of 4 colored pads. Stand on your
answer; jump on it to lock it in. When time's up, every right answer scores, more for a faster lock
(10 points, and up to 10 more for speed); an answer never locked counts for the pad you're on, with
no speed points. The right pad lights up. Most points after the questions wins.

- **Marks:** 4 spawns; **Answer pads** (region, 4, in order): each floor lit in its own color (red,
  blue, yellow, green) with its answer floating over it.
- **Game settings:** `answerTime`, **Answer time**, 10 s (5 to 30); `questions`, **Questions**, 8 (3
  to 20).
- **Bank:** the user's questions, each with 4 answers and the right one (piece 12).
- **Controls:** move, "Stand on your answer"; jump, "Lock it in".
- **Bots:** right about 60% of the time, locking in after 2 to 6 seconds.
- **Notes:** the answers also show in the dialogue box beside their colors.
- **Test arena:** a plain platform, 4 pads.

### Count the Mobs (changed: count the sheep)

Everyone looks through one fixed camera at a pen. Sheep in grays (white, light gray, gray, black)
come into the pen and leave it through gates on the left and the right, in groups. The round names a
color ("Count the black sheep!") or all sheep. Count with jump: each press adds one, and sneak takes
one off. When the round ends the sheep stop, the right ones are counted out one by one, and the
counts show: the closest scores most (3, 2, 1; spot on, 1 more). Most points after the rounds wins.

- **Marks:** 4 spawns, out of sight (the players' bodies wait there); **Pen** (region, 1); **Pen
  camera** (point, 1): where the camera goes, placed with Take my facing; **Gates** (point, 2): the
  left and right ways in and out.
- **Game settings:** `rounds`, **Rounds**, 3 (1 to 5); `roundTime`, **Round time**, 20 s (10 to 60);
  `mostSheep`, **Most sheep in the pen**, 12 (4 to 30).
- **Spawns:** sheep, entities of the game's own on vanilla's sheep model in the four grays, walked by
  script from a gate into the pen and out again (vanilla sheep wander where they like).
- **Controls:** jump, "Count one"; sneak, "Take one off".
- **Bots:** their count lands within 2 of the right one.
- **Notes:** everyone sees their own count on their own status line, nobody else's (piece 19). The
  camera is piece 20.
- **Test arena:** a plain fenced pen with a gate on each side.

## Fights and knock-offs

### Kit Brawl (changed: one kit for everyone)

Everyone gets the same kit, picked at random from the kit file each time (the user: no coins, no
reroll), and fights. Real damage (piece 13): out at no hearts. Last one in wins; at time, the rest
place by hearts left, then by when they went out.

- **Marks:** 4 spawns facing the middle; Kill Y (a fall is out).
- **Game settings:** `playTime`, **Time**, 30 s (10 to 90).
- **Checklist Features:** Kill Y can be off (an arena walled in).
- **Gives:** the kit.
- **Bank:** `games/blockparty/kits.json`, the user's: each kit's items and armor, and its weight.
- **Plays as 2v2:** teammates can't hurt each other; team colors on the name and the leather armor,
  when the kit has none of its own.
- **Controls:** attack, "Hit"; move; use, when the kit has a bow or food.
- **Bots:** walk at the nearest player and hit about twice a second.
- **Test arena:** a plain walled platform.

### King of the Hill

Hold the Hill: every second you're on it alone scores a point, and a shared second scores nobody.
Hits knock others off. A fall puts you back at your spawn a moment later. Most points at time wins.

- **Marks:** 4 spawns around the hill, facing it; **Hill** (region, 1): standing over it counts;
  Kill Y.
- **Game settings:** `playTime`, **Time**, 40 s (20 to 120); `knockback`, **Knockback**, 20 tenths
  of vanilla's (10 to 40); `respawn`, **Back after a fall**, 2 s (0 to 10).
- **Checklist Features:** Kill Y can be off (a hill with no drop).
- **Controls:** move; attack, "Knock them off"; jump.
- **Bots:** head onto the hill and hit anyone in reach.
- **Test arena:** a plain platform with a raised middle.

### Sumo Duel

Knock everyone else off the platform. Hits push twice vanilla's (Sumo's measured numbers). Last one
on wins; the rest place by when they fell. In the sudden death's pool.

- **Marks:** 4 spawns around the platform, facing in; Kill Y.
- **Game settings:** `playTime`, **Time limit**, 45 s (20 to 120); `knockback`, **Knockback**, 20
  tenths of vanilla's (10 to 40).
- **Controls:** move; attack, "Push"; jump.
- **Bots:** walk at the nearest player and hit, backing off the edge.
- **Notes:** Block Party's own minigame on its own arena map; it can share code with Sumo through
  core, never Sumo's maps.
- **Test arena:** a plain round platform over the void.

### Cactus Slap (new)

A platform ringed by cactus. Everyone holds a slap stick whose hit sends a player flying. Touch a
cactus and you're out. Last one in wins; the rest place by when they went out; at time, everyone
still in ties first. Proposed for the sudden death's pool.

- **Marks:** 4 spawns facing the middle; Kill Y (a fall off is out too, on a map with a drop). The
  cactus is the map's own, anywhere in the arena.
- **Game settings:** `playTime`, **Time limit**, 60 s (20 to 120); `knockback`, **Knockback**, 40
  tenths of vanilla's (10 to 80).
- **Checklist Features:** Kill Y can be off.
- **Gives:** the slap stick (a stick with the enchanted glint).
- **Controls:** attack, "Slap"; move; jump.
- **Bots:** walk at the nearest player and slap, keeping away from the cactus.
- **Notes:** touching is a cactus block within a hair of the player's box, checked each tick (with
  damage off, vanilla's cactus hurts nobody).
- **Test arena:** a plain platform ringed by cactus on sand.

### Towers of Fortune (new)

Everyone starts on top of a one-block pillar, far apart. Every few seconds everyone gets a random
vanilla item: building blocks, tools, weapons, armor, food, potions, ender pearls, spawn eggs. Build,
bridge and fight; real damage (piece 13), and a fall is out. Last one standing wins; at time, the
rest place by hearts left.

- **Marks:** 4 spawns, each on top of its pillar (the map's pillars); Kill Y.
- **Game settings:** `playTime`, **Time limit**, 120 s (60 to 300); `itemEvery`, **An item every**,
  5 s (2 to 20).
- **Bank:** the item pool, each with its weight (piece 12).
- **Controls:** use, "Place, eat, throw"; attack, "Fight, break"; move.
- **Bots:** bridge toward the nearest player with the blocks they get and hit in reach; weak here.
- **Notes:** plays in Survival (piece 15), so everything places and breaks and spawn eggs work; mobs
  from spawn eggs end with the minigame.
- **Test arena:** 4 plain pillars over the void.

### Mini Survival Games (new)

Everyone starts on a pedestal around a stash of chests in the middle, more chests around the arena.
On Go, grab gear and fight; real damage (piece 13). Nobody can hurt anyone for the first moments.
After a while the border closes in toward the middle, and outside it hurts. Last one standing wins;
at time, the rest place by hearts left.

- **Marks:** 4 spawns, the pedestals, facing the middle; **Chests** (point, 4 to 20, typed Middle
  and Outer): the game places a chest at each and fills it, the Middle ones with better loot.
- **Game settings:** `playTime`, **Time limit**, 120 s (60 to 300); `grace`, **No fighting for**, 10
  s (0 to 30); `borderStart`, **Border closes after**, 60 s (0 to 240); `borderEnd`, **Border ends
  at**, 8 blocks across (4 to 30).
- **Bank:** the Middle and Outer loot (piece 12).
- **Plays as 2v2:** teammates can't hurt each other.
- **Controls:** use, "Open chests"; attack, "Fight"; move.
- **Bots:** go to the nearest chest, take what's best, then fight the nearest player.
- **Notes:** the border is a ring of particles; outside it costs a heart a second.
- **Test arena:** a plain platform with chests in the middle and around.

## 2v2

Every 2v2 map has Red and Blue team spawns, 2 each (a tiled one: 2 on its one copy).

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
- **Notes:** the draft's knockback version; question 7 has a rope instead.
- **Test arena:** a plain long platform over the void.

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
- **Test arena:** a plain platform, a base at each end.

### Spleef Duo (changed: snowballs)

Everyone gets a shovel that breaks the snow floor in one hit, and every block you break gives you a
snowball to throw (the user). A snowball that hits a player knocks them back. Dig under the other
team, or knock them into a hole; a fall is out. The last team with someone standing wins.

- **Marks:** **Floor** (region, 1): the game lays snow across its lowest layer; Kill Y.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120): after it, the floor crumbles by itself;
  `knockback`, **Snowball knockback**, 15 tenths of vanilla's (5 to 40).
- **Checklist Features:** Floor's count, 1 to 3 (layers).
- **Plays as FFA and 1v1:** the same, each alone; places by when they fell.
- **Gives:** a shovel that breaks only snow (piece 15); a snowball for every block broken.
- **Controls:** attack, "Break the snow"; use, "Throw a snowball"; move.
- **Bots:** walk at a rival and break the blocks under them; throw now and then.
- **Test arena:** a plain platform over the void.

### Paired Parkour (tiled)

Teammates are tied together by a lead and cross a parkour course; when one falls, both go back to
their last checkpoint. First team with both over the Finish wins; at time, the team further along
wins, and equal is a draw.

- **Tiled** (piece 9): the map is one course, copied for each team, so leads never tangle.
- **Marks** (one course): 2 spawns; **Checkpoints** (region, 3, in order); **Finish** (region);
  Kill Y.
- **Game settings:** `playTime`, **Time**, 90 s (30 to 180).
- **Checklist Features:** Checkpoints' count, 0 to 8.
- **Needs:** the players pack's leads (piece 18): the lead pulls at 5 blocks and holds about 5.9
  behind; the game can't make it shorter.
- **Controls:** move; jump; sprint.
- **Bots:** follow the course (piece 21).
- **Test arena:** a plain tile with a few gaps to jump.

### Carry Race (changed: the rider guides; tiled)

One teammate walks a maze carrying the other on their head. The maze walls are too tall for the
walker to see over, but the rider sees the whole maze: the rider guides the walker over the voice
call, and has four buttons that call Left, Right, Straight and Back to the walker (the user). First
team to the Finish wins; at time, the team nearer the Finish wins.

- **Tiled** (piece 9): the map is one maze, copied for each team.
- **Marks** (one maze): 2 spawns (walker, then rider); **Finish** (region). Walls 3 blocks tall, so
  the rider (eyes about 3.3 blocks up) sees over them and the walker can't.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120).
- **Needs:** the players pack's riding (piece 18): the rider sits 1.67 over the walker's feet and
  they move together.
- **Gives:** the rider 4 items, Left, Right, Straight and Back: a use shows that word in the walker's
  dialogue box with a sound (piece 19).
- **Controls:** walker: move, "Walk where your rider says". Rider: use, "Call a way to your walker".
- **Bots:** a bot walker follows the maze's route (piece 21); a bot rider calls the next turn.
- **Test arena:** a plain tile with a small maze.

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
- **Controls:** use, "Pick up and load a cannonball, or sit in the cannon"; look, "Aim" (piece 11);
  attack, "Fire".
- **Bots:** the loader walks between pile and cannon; the aimer fires with some error.
- **Test arena:** a plain platform, a cannon and a target at each end.

## 1v3

Every 1v3 map marks the solo's spawn and 3 for the trio (1v2 uses the first 2).

### Hunter (built, the plan's Hunter vs. Runners)

The runners start at one end, the hunter in the middle, who waits a moment after Go. A runner the
hunter hits is caught and out; one who reaches the goal is safe. The runners win if at least half get
home before time; otherwise the hunter wins.

- **Marks:** **Hunter spawn**, **Runner spawns** (3), **Goal** (region).
- **Game settings** (the numbers in `hunter.ts` today): `playTime`, **Time**, 45 s (20 to 120);
  `headStart`, **Hunter waits**, 2 s (0 to 10).

### Trap Master (changed: more kinds of trap, water)

The trio cross a gauntlet to the Finish. The solo watches from a booth and hits levers, each
springing its trap, and the lever then waits a few seconds. Four kinds of trap (the user):

- **Drop:** the floor in its box drops away for a moment.
- **Vanish:** every block in its box (a parkour run) vanishes for a moment.
- **TNT:** a lit TNT drops into its box and blows, throwing runners near it (a push, breaking no
  blocks).
- **Water:** water pours over its box for a moment.

A runner who falls or is touched by water (the trap's or any in the gauntlet) dies and goes back to
the start. The runners win if at least half get through before time; otherwise the master wins.

- **Marks:** **Master spawn** (point): in the booth, facing the course; **Runner spawns** (point, 3);
  **Traps** (region, 6, in order); **Levers** (point, as many as Traps, in the same order, typed
  Drop, Vanish, TNT or Water: the nth lever works the nth trap, its type the trap's kind; piece 10);
  **Finish** (region, 1); Kill Y.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `open`, **Trap lasts**, 20 tenths of a
  second (5 to 60); `cooldown`, **Lever waits**, 5 s (1 to 20); `tntRadius`, **TNT blast**, 3 blocks
  (1 to 6).
- **Checklist Features:** Traps' count, 2 to 10 (Levers follow it).
- **Spawns:** a lever model at each Lever point; the TNT.
- **Controls:** master: attack, "Hit a lever to spring its trap". Runners: move; jump; sprint.
- **Bots:** the master springs the trap a runner is on after a reaction delay; runners walk the
  course (piece 21; until then, straight at the Finish).
- **Notes:** water poured by the game is source blocks on the box's top layer, cleared when the trap
  ends, flow and all.
- **Test arena:** a plain strip with one trap of each kind.

### Defend the Core

The raider, with strong gear and many hearts, must break the Core. The three defenders, each with a
few hearts and back at their spawn a moment after going down, fight the raider off. Real damage
(piece 13). The raider wins by breaking the Core; the defenders by taking the raider down or holding
until time.

- **Marks:** **Core** (point): the game stands the core there; **Raider spawn** (point);
  **Defender spawns** (point, 3).
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `coreHits`, **Hits to break the core**,
  20 (5 to 60); `raiderHearts`, **Raider's hearts**, 20 (10 to 60); `respawn`, **Defenders back
  after**, 3 s (0 to 10).
- **Gives:** the raider's and the defenders' kits (in code); the raider's extra hearts as vanilla's
  Health Boost.
- **Controls:** raider: attack, "Hit the core and the defenders"; move. Defenders: attack, "Hit the
  raider"; move.
- **Bots:** the raider heads for the core and fights back when hit; defenders chase the raider.
- **Test arena:** a plain platform, the core in the middle.

### Barnyard Bluff (new, replaces Prop Hunt)

A farm full of vanilla farm animals, and three of them are players in disguise (the user). The farmer
has to find them. The hiders each look like a cow, a pig, a sheep or a chicken and must act like one:
wander, stop, wander. The farmer hits an animal to guess: a hider is found and out; a real animal
costs one of the farmer's wrong guesses. The farmer wins by finding all three; the hiders win if any
is still hidden at time, or when the farmer runs out of wrong guesses.

- **Marks:** **Farmer spawn** (point): in the barn; **Hider spawns** (point, 3); **Herd** (region,
  1): the game spawns the animals inside it, and the map's fences keep them there.
- **Game settings:** `hideTime`, **Time to blend in**, 10 s (5 to 30): the farmer waits shut in the
  barn; `playTime`, **Time to find them**, 60 s (30 to 120); `animals`, **Animals**, 20 (8 to 40);
  `wrongGuesses`, **Wrong guesses**, 3 (1 to 10).
- **Spawns:** vanilla cows, pigs, sheep and chickens, wandering as vanilla's do.
- **Needs:** playing as a mob (piece 22): each hider's model is a farm animal's, picked at random
  and named in their tutorial, name tag hidden.
- **Controls:** hiders: move, "Act like an animal". Farmer: attack, "Hit the animal you think is a
  player"; move.
- **Bots:** hiders wander and stop like the animals; the farmer hits an animal near a hider now and
  then, finding them with a chance.
- **Notes:** a hider's hitbox and eye height stay a player's, a tell for a sharp farmer.
- **Test arena:** a plain fenced field and a barn.

### Labyrinth (new)

A maze with walls 2 blocks tall. The trio start at one side and must reach the Exit; the hunter
chases them with a camera high over their own head that sees over every wall (the user's custom
view), and catches a runner with a hit (out). The trio win if enough of them get out before time;
otherwise the hunter wins.

- **Marks:** **Hunter spawn** (point); **Runner spawns** (point, 3); **Exit** (region, 1); **Maze**
  (region, 1): the game builds a random maze with 2-tall walls inside it each time.
- **Game settings:** `playTime`, **Time**, 60 s (30 to 120); `headStart`, **Hunter waits**, 3 s (0
  to 10); `needed`, **Runners who must get out**, 2 (1 to 3; 1v2 at most 2); `cameraHeight`,
  **Hunter's camera height**, 8 blocks (4 to 20).
- **Checklist Features:** Maze can be off: the map's own maze stays as it is.
- **Needs:** the hunter's camera (piece 20), a `follow_orbit` preset raised over them; the hunter
  can look like a big mob (piece 22, a look only).
- **Controls:** hunter: move, "Chase them; you see over the walls"; attack, "Catch". Runners: move,
  "Find the exit"; sprint.
- **Bots:** the hunter takes the maze's shortest way to the nearest runner; runners head for the
  exit by the maze's way, with a wrong turn now and then.
- **Notes:** the user wrote that the 3 runners have to reach the end; Hunter's "at least half" is
  proposed as the default, and `needed` 3 makes it all three (question 6).
- **Test arena:** a plain floor, the game's random maze on it.

### Boss Fight (changed: boss bar, powers lost)

The solo is the Wither: big, flying, firing skulls; its health is a boss bar everyone sees (the
user). The trio each have hearts and lives, with bows and swords. As its health falls, the Wither
loses its powers in turn (the user): below 75% no more blue exploding skulls, below 50% no more
black wither skulls (only its hit), below 25% it can't fly. The trio win by bringing its health to
nothing; the Wither wins when the trio are all out or time runs out.

- **Marks:** **Boss spawn** (point); **Trio spawns** (point, 3); Kill Y.
- **Game settings:** `playTime`, **Time**, 90 s (45 to 180); `bossHealth`, **Wither's health**, 100
  (20 to 500); `trioLives`, **Trio's lives**, 2 (1 to 5); `loseBlue`, `loseBlack` and `loseFlight`,
  **No blue skulls below**, **No black skulls below**, **Grounded below**, 75, 50 and 25% (0 to 100).
- **Checklist Features:** Kill Y can be off.
- **Needs:** real damage (piece 13), knockback (14), the Wither form (22) and the boss bar (23).
  Flying is hovering by script (Adventure can't fly): jump to rise, as Sumo's double jump pushes.
  The skulls are vanilla's own (`wither_skull`, `wither_skull_dangerous`) shot by script, their
  blasts breaking no blocks.
- **Controls:** Wither: use, "Fire a skull"; jump, "Rise"; attack, "Hit". Trio: attack, "Hit"; use,
  "Shoot"; move.
- **Bots:** the Wither hovers and fires at the nearest player; the trio shoot from range.
- **Notes:** the riskiest one: try the Wither form, its hover and the boss bar in a spike first. The
  plan wanted up to 128 blocks for this one (question 8).
- **Test arena:** a plain walled platform.

### Bomb Disposal (new design, keep or cut)

The user wants better mechanics or none (question 3). Proposed:

1. **Plant** (15 s): the trio wait shut in a room while the Bomber walks the arena and plants 3
   bombs, each at any of the map's Bomb sites (use on a site).
2. **Defuse:** the trio hunt for the bombs, which tick (louder closer). Standing at a bomb defuses
   it over 4 seconds, twice as fast with two; the progress shows to the defusers (piece 19). The
   Bomber's hit freezes a defuser for 2 seconds and loses that bomb's progress, so the trio guard
   each other.
3. **End:** the trio win by defusing all 3 before the fuse runs out; otherwise the bombs go off and
   the Bomber wins.

- **Marks:** **Bomber spawn** (point); **Squad spawns** (point, 3); **Squad room** (region): where
  the trio wait; **Bomb sites** (point, 6 to 12).
- **Game settings:** `plantTime`, **Time to plant**, 15 s (5 to 30); `fuse`, **Fuse**, 60 s (30 to
  120); `bombs`, **Bombs**, 3 (1 to 5); `defuseTime`, **Defusing takes**, 4 s (1 to 10); `freeze`,
  **Frozen for**, 2 s (1 to 5).
- **Spawns:** the bombs, a model of the game's own.
- **Controls:** Bomber: use, "Plant a bomb"; attack, "Freeze a defuser". Squad: move, "Find the
  bombs by their ticking"; stand at a bomb to defuse it.
- **Bots:** the Bomber plants at random sites; squad bots head for the nearest bomb they can hear.
- **Test arena:** a plain walled platform with sites and the room.

## Build order

A batch at a time, each a pass of its own with the user's look after it. A 20-turn game plays about
3 rounds each of 2v2 and 1v3, and only one of each is built, so the early batches bring more of
both.

0. **The pieces for every minigame** (1 to 8), Plays as with the defaults above, and the look input
   (11). The three built minigames get their Game settings; Hot Floor gets 1 x 1 tiles; Quick Draw
   leaves the sudden death's pool (`end-game.ts`, `TIEBREAK_IDS`).
1. **Plain FFA, nothing new:** Mob Freeze, Simon Says, Enderman Roulette, TNT Run, Anvil Rain,
   Chicken Chase, Slither (a 2v2 too).
2. **Push hits, and a second team game of each kind:** King of the Hill, Sumo Duel, Cactus Slap (then
   into the sudden death's pool), Climb the Ladder, Hot Potato, Tug of War (2v2), Capture the Wool
   (2v2), Trap Master (1v3, with lists in pairs and its four traps).
3. **Real damage:** Kit Brawl (a 2v2 too), Defend the Core (1v3), Leg Breaker.
4. **Place and break, Survival:** Mining Race, Spleef Duo (2v2), Towers of Fortune, Mini Survival
   Games.
5. **Banks, words for one player, cameras:** Quiz Floor, Item Scramble, Count the Mobs, Button Mash
   with its launches.
6. **Tiled arenas:** Montecarlo, Cook's Request (a 2v2 too).
7. **Moving entities:** Egg Drop, Snowball Sniper, Hole in the Wall, Hook the Mob (a 2v2 too), Cannon
   Duel (2v2).
8. **Riding, leads and bots on a course:** Paired Parkour (2v2), Carry Race (2v2), Rising Lava,
   Labyrinth (1v3).
9. **Moving platforms:** Minecart Dodge, after its spike (piece 17).
10. **Playing as a mob:** Barnyard Bluff (1v3) and Boss Fight (1v3), after their spike.
11. **Bomb Disposal,** if the user keeps it.

## Questions for the user

1. **Test arenas in real games:** a Test arenas switch on the Panel, on while no arena map is
   published and off before the network opens (proposed), or never at all (a minigame with no
   published arena map left out of every real game, which today is all of them)?
2. **Hot Potato:** how a player loses: the hidden fuse (proposed), a heat meter, or lives?
3. **Bomb Disposal:** keep the new design (the Bomber plants, the squad finds and defuses), or cut
   it?
4. **Cook's Request:** which pack has the custom foods (sushi)? None are in network or the workshop
   yet. And a farm for each player (proposed) or one shared farm where players can take each
   other's crops?
5. **The banks** (quiz questions, kits, Item Scramble's items, Cook's dishes, Towers of Fortune's
   items, Mini Survival Games' loot): files of your own (proposed), or texts in the dialogue tool?
6. **Labyrinth:** how many runners must get out to win: 2 of 3 (proposed, a Game setting), or all 3?
7. **Tug of War:** the draft's knock-off (proposed), or a real tug: each team hits its end of a
   rope, the rope moves toward the team hitting more, and the losers are pulled into the water?
8. **Room:** do Boss Fight and Hunter fit 40 x 60 (proposed: yes), and should Leg Breaker get a
   taller Arena box (96 proposed) for a longer fall?
