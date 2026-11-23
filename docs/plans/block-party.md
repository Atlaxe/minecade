# Block Party (plan)

**Status:** design, 2026-11-14. The spike (step 1 of "Suggested order") was built on 2026-11-15 as a test game, `games/blockparty`, and the user looked at it the same day: pieces are the player pushed along the path, NPC poses hold, the hotbar gets bars of its own for items and dice, arenas load behind a fade with the logo, and arenas will load into each board's arena background (see "Arena backgrounds"). What it found is in `docs/spike-results.md`, "Block Party". This plan combines the user's Block Party plan
with the minigame list from their first draft, their follow-up numbers (the shop, the Witch's
reroll, the Wandering Trader, the Happening table, 1v3 payouts, Star prices) and the map design
worked out with them. The same day the user answered the first open questions: 2-4 players, a
Chance outcome that takes a Star (Shooting Star), ideas for where special dice come from and what
they sell for (see "Dice"), pieces that walk from space to space with a custom animation while
everyone watches through the scripted camera (see "Pieces"), and duels that also play FFA
minigames. Later the same day they answered most of the rest: 3 bonus Stars, names over
the pieces, picking in the lobby, Chris handing out the starting coins, rolling by jumping, a
restyled hotbar, no timers, votes (to skip a cutscene, to start a minigame, to let a late joiner
in), and NPCs that are the vanilla mobs' own models. Then the last five: 2 bonus Stars in a 2-player
game (at most 1 each), the Cursed Totem, the Mystery Die, a late joiner's start, and players who go
idle. Nothing is open; "Defaults" at the end lists what was taken without a question. On
2026-11-17 the user replaced the hotbar (minigames need it) and set out the UI, the cameras, the
player animations and the sounds for pass 10: `block-party-ui.md`.

**For the session that implements this:**
- Work in a worktree of your own (`CLAUDE.md`, "Branch and merge").
- Stop and report after each pass, and end the report with a list of what to test. Commit and push
  after each pass, committing only that pass's files, with no attribution.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- Change the map store only through `MapStore` (`tools/maps/store.ts`), never by hand.
- Never make a map thumbnail or a game picture, not even a placeholder (`CLAUDE.md`, "Also").

## Your decisions

| Topic | Decision |
|---|---|
| The game | Block Party: a board game with minigames between turns. Most Stars wins |
| Players | 2 to 4 |
| Pieces | The player, pushed from space to space by the script (vanilla's walk plays), easing into every corner, while everyone watches through the scripted camera (see "Pieces"). No names over the pieces: a HUD says whose turn it is |
| Duels | 1v1 minigames, and FFA minigames played by 2 |
| In the lobby | The board and the length (10, 15 or 20 turns), as game options. Chris's tutorial is a question in the pre-game, not an option (the user's call, 2026-11-17) |
| Starting coins | 10, handed out by Chris |
| Bonus Stars | 3 with 3 or 4 players; 2 with 2 players (at most 1 each) |
| Rolling | Jump to hit the die |
| Walking | Nobody walks the board by themselves (the user, 2026-11-17): the movement keys move a player only off the board (a minigame, a ride) and on the pre-game podium until their roll; on the board they look round, jump and sneak |
| Hotbar | Vanilla's, shown only while a player plays a minigame (the user, 2026-11-17): never on the board or in cutscenes. The board's controls are the game's own JSON UI: a menu top left (Dice block, Items, Board) steered with the movement keys, jump and sneak, player cards top right, a dialogue box (see `block-party-ui.md`); until the menu is built the bar's items sit in hidden slots (the picked die's name top right while rolling) and the Tests are `/blockparty:tests`. Health, hunger and XP hidden |
| Timers | None: the game waits for the player |
| Votes | Every player: to skip a cutscene, to start a minigame after its rules, to let a late joiner in |
| NPC looks | The vanilla mobs' own models, nothing textured |
| Boards | Maps of their own: a themed loop with 2-3 shortcut branches, about 36-45 spaces (longer is fine) |
| Minigames | One arena map per minigame, its own small map. No variant maps, and no borrowing other games' maps or minigames |
| Arenas at play time | Copied into the board's world when picked, a fresh copy every time it's played, into the slot of the board's arena background |
| Arena backgrounds | Each board has a themed surround with a fixed 40 x 60 slot that every minigame arena loads into (see "Arena backgrounds"); arena maps are made to fit it |
| Board markup | A ported world, then space markers chained by clicking (the clicked one is the previous). Types are dealt automatically by the share and the rules, and can be changed or locked in the marker's menu, which also holds a Star candidate box |
| Requirement options | Most checklist rows become options a map can turn off or set a count for, like Game settings, in the Panel's map viewer only |
| Board check | `/boardcheck`: errors, warnings and a report (see "/boardcheck") |
| Controls | Vanilla controls and perspective only in minigames. On the board a script moves each piece and the camera is scripted |
| NPCs | Defined by role; a map changes only their skins |
| Special events | One per map at most, from four types written in code |

## Characters

NPCs are defined by role and look like their vanilla mob, with nothing textured. A map changes only
the vanilla variant, where the mob has one (the Villager's biome type and profession, Chris's pig
variant).

- **Chris** (the Pig, a piggy bank): tutorial guide in speech roles (toggleable per game), Star
  seller, and commentator on standings and big moments.
- **Warden:** the villain.
- **Villager** (shopkeeper): buys and sells items for coins at Shop spaces. Profession is cosmetic.
  The Villager item uses the same NPC.
- **Witch:** hosts Chance Time. She offers three mystery potions: take one, or pay 3 coins to
  reroll the three, once per visit and only if you can afford it (about one Blue space's worth, a
  small tax).
- **Enderman:** performs Ender Pearl swaps and the teleport outcomes of Chance Time.
- **Wandering Trader:** appears every 3-4 rounds on a random Item space for one round (see "Shop,
  Villager and Wandering Trader").
- **Referee** (Vindicator): announces Versus duels and Dueling Glove challenges, states the stakes,
  reads the odds and takes spectator bets.
- **Allay:** delivers a Nether Star for each bonus award, and picks the winner on a final tie.
- **Iron Golem and Zombie:** item characters (see "Items").
- **Wither:** the playable boss in the 1v3 Boss Fight, not an NPC.

**Why not frozen vanilla mobs** (the user asked): Bedrock has no switch that turns a mob's AI off,
and the real mobs act on their own. The Warden attacks and digs away, the Enderman teleports and
picks up blocks, the Allay chases dropped items, the Witch throws potions, the Zombie attacks and
burns in daylight, the Iron Golem attacks, and the Wandering Trader leaves. So the game has one
entity of its own per role that points at the vanilla mob's model, textures and animations by name,
with no AI (proposed). Nothing is copied, so nothing has to stay out of git, and nothing gets
textured. Each NPC stands still, plays a vanilla animation when the game says (the Warden's roar and
sonic boom), and moves only when the script moves it.

### Dialogue

Everything the game says (titles, chat lines, forms, the HUD's status line during a minigame, and
what each NPC says) is a line in `games/blockparty/dialogue.json`, by id, and the code says it with
`line(id, fills)` (`behavior_pack/scripts/lines.ts`). `{player}`, `{coins}` and the like are filled in
by the code ("12 coins" with its word); a moment with several lines picks one at random. An id with
no line is skipped, the user's call (2026-11-17): chat, titles and the status show nothing for it,
and a form button, which can't be left out, shows its id. The dialogue editor lists the ids the game
says that have no line.

**What the NPCs say** goes in the dialogue box (pass 6, `block-party-ui.md` "The dialogue box";
`dialogue.ts`): bottom middle, the same for everyone, the speaker's name on its border. A line comes
a sentence at a time, each sentence with one sound of the speaker's voice (the user's sound map,
`games/blockparty/sounds.json`, installed from the same editor; a line with a sound of its own plays
that instead). Said to one player (`talk`), it has buttons (Next when there's no choice) steered
with W and S, jump to pick, sneak for its back button; said to everyone (`say`), it goes on by
itself once read, and a skippable one (or a skippable cutscene) is skipped once every player has
jumped. `dialogue.json` carries each moment's character and how it shows (`moment()` in
`lines.ts`); the code still picks talk or say for each.

The lines are the user's: `dialogue.json` is written by their dialogue editor (not in this repo),
which keeps every line with its scene, character, when it's said, how it shows, a review status and
notes, including the ones no pass has built yet (Chris's tutorial, the Witch's outcomes, the
Referee's calls). Never edit `dialogue.json` by hand: a pass that adds something the game says adds
its lines in the editor's file (with the fills its code hands over) and installs them. Left in code
for now: the HUD's line and the standings (built from parts), space type names (the board config),
each minigame's own name, rules and play messages, error messages, and the Tests menu.

## Core loop

1. In the lobby, pick a board, a game length of 10, 15 or 20 turns, and whether Chris gives the
   tutorial. Every length uses the same board. Chris hands everyone 10 starting coins.
2. Take a turn: use an item if you want, roll, and a script moves your piece that many spaces.
   Choose a path at branches.
3. Land on a space and its effect triggers. Passing or landing on the Star spot lets you buy a
   Star.
4. After all players have moved, everyone plays a minigame. Winners earn coins.
5. Repeat until the last turn, then award the bonus Stars.
6. Most Stars wins (see "Tiebreaker").

There's no lap reward: extra turns just mean extra laps.

## Boards

- A loop with 2-3 shortcut branches, about 36-45 spaces. Longer boards are fine (a longer train).
- Start can be on the loop or lead into it: a board needn't lead back to Start (the user,
  2026-11-23). The loop is where Start's first exits go round; the spaces before it are the lead-in,
  walked once.
- Shortcuts save about 10% of the loop.
- At most one special event per map, of one of four types written in code: path toggle, teleport,
  time-of-day modifier, roaming hazard (what the map marks for each: "Board maps").
- Events never change the Star price or minigame payouts.

### Golems (Golem Gardens' event)

The user's design (2026-11-22) for Golem Gardens, a board of 4-5 loops: golems block some of the
paths, a player pays to go by, and now and then they move, "a way to keep players in the loop". A
path toggle with a toll. **Built 2026-11-22, not yet seen in game.**

- **Four golems, two active.** Each has a **post** (where it stands while it's active, blocking the
  path from one space to the next), a **rest spot** (where it stands while it isn't), and the bends
  of its walk between the two. Golems 1 and 2 start on their posts, 3 and 4 at their rest spots. A
  golem can block any path, not only a fork's way (the user): its settings name the space before it
  and the space after it.
- **The toll: a flat 5 coins** (the user). A walk that comes to an active golem's path stops at the
  space before it, and the golem asks (the dialogue box: Pay 5 coins, or Not now; short of coins, it
  says so). Paid, the coins fly to it (to the bank, spent of the player's own accord), it steps aside
  along the first 3 blocks of its walk, the piece goes by, and it walks back to its post (my
  proposal, which the user called perfect). Not paid: at a fork the player picks another way (the
  last way left is taken without asking); anywhere else their walk ends at the space before it, and
  they land there. A walk that ends where it started (they didn't pay before a step) doesn't land
  again. A walk back (a Happening's Move back) goes past a golem for free: it steps aside and back.
  A bot pays when it has the coins, at a fork only on the way to the Star.
- **The swap, each Star bought** (the user picked this trigger from my list; not the 3-round
  backup, not a Happening, not a rising toll): one active golem and one resting, each picked at
  random, trade places, so two are always active (the user: "1 of the active, and one of the
  inactive, to keep a balance"). A skippable cutscene after the Star's purchase (and its results):
  the camera cuts to the golem leaving, which says it has to move (golem.swap, in the dialogue box);
  then the camera pans over the whole board (Board's view of the spaces and the golems' spots, swung
  50 degrees round its middle) while both walk to their new spots, and the cutscene ends once the
  last is there (the user). Skipped, they're put there.
- **Golems walk, never teleport** (the user). Each leg of a walk is planned over the ground as a
  piece's is ("Moving over the board") and followed a tick at a time, as bots walk, at 0.12 blocks a
  tick. A golem stuck on a leg for 2 seconds past its time is put at the leg's end (the one time it
  isn't walked), so mark bends round anything in its way. The golem NPC (blockparty:iron_golem) is 1
  block wide so it fits garden paths.
- **Marked in the Panel only** (docs/viewer.md, "Golems"): map.json `golems`, four entries of
  `post`, `rest` (each [x, y, z, yaw, pitch]), `before`, `after` (space ids) and `bends`. The board
  check (and Publish) needs all four set once any is, each on a path from a space to one it leads to,
  no two on one path. A draft with some golems unfinished plays the finished ones.
- **Code:** minigame-core `board/board-golems.ts` (data, edits, checks); the Panel's
  `board-points.ts`; the game's `golem-rules.ts` (pure: which golem blocks a path, the swap, a bot's
  toll, the step aside) and `golems.ts` (the golems on stage, the toll, the swap's cutscene, their
  walks); board-loop.ts move() stops at a golem. Lines: `golem.toll` (Pay/Not now: `golem.toll.pay`,
  `golem.toll.no`), `golem.toll.paid`, `golem.toll.declined`, `golem.toll.short`, `golem.swap`
  (character Iron Golem; my drafts in the workshop's Golems scenes, for the user to rewrite).

### Space types

| Type | Effect | Share | On 40 spaces |
|---|---|---|---|
| Blue | +3 coins | ~45% | 18 |
| Red | -3 coins | ~12% | 5 |
| Item | get an item (weighted: trailing players are likelier to get strong ones) | ~13%, Shops included | 3 |
| Shop | the Villager's shop (2 on a 36-space board, about 4 on 75) | out of the Item share | 2 |
| Chance Time | the Witch's random event | ~10% | 4 |
| Warden | a bad event | ~9% | 4 |
| Versus | a 1v1 duel for coins | ~7% | 3 |
| Happening | an effect from the shared table, in the map's flavor | ~4%, optional | 1 |
| Start | where everyone begins | 1 | 1 |

A map without Happening spaces gives their share to Blue (proposed).

### Placement rules

- Never 2 reds in a row.
- The first 4-5 spaces after Start are safe (Blue or Item).
- Item spaces follow reds or sit just before a branch.
- Branches are risk against reward: a short path with a red, a Warden and a Versus, against a long
  path of blues and an item.
- Every ~12-space stretch has at least one Item and at most one Warden.
- Chance spaces are spread evenly (no "back half" rule).
- Versus spaces are spread out. Wardens come about one per 10-12 spaces.

## Stars (Nether Stars)

- Whoever has the most Stars wins.
- One Star is active at a time (two in 10-turn games). A beacon beam marks it, and everyone is told
  where it is.
- Chris sells the Star at its spot for coins. One Star per pass.
- After a purchase the Star moves to a random candidate spot at least ~12 spaces from the last one
  (about 30% of the loop on bigger boards, proposed).
- Star candidates: roughly 1 per 4-6 spaces, 25-30% of them on shortcuts. 2 are flagged as opening
  spots, 10-20 spaces from Start.
- Losing Stars is rare: only through a Chance outcome (Shooting Star) or a Warden event (Sonic
  Boom), one Star at a time, taken from the leader.

| Length | Star price | Active Stars |
|---|---|---|
| 10 turns | 15 | 2 |
| 15 turns | 20 | 1 |
| 20 turns | 25 | 1 |

**Tuning:** these are starting values. Log per game: Stars bought, coins unspent at the end, turns
until the first Star, and the winning margin. Aim for 5-8 Stars bought in a 4-player game. If
players finish with more unspent coins than one Star costs, raise the price by 5. If fewer than 4
Stars get bought, lower the price or add a second active Star. Play about 3 games per mode before
changing anything.

## Chance Time (the Witch)

Outcomes get bigger later in the game, so late ones help trailing players.

- **Coin Rain:** everyone gets +5 coins.
- **Coin Swap:** swap coin totals with a player you pick, or the Witch picks (late game only).
- **Reverse Fortune:** the leader gives 5 coins to last place.
- **Double or Nothing:** bet up to 10 coins on a coin flip.
- **Gift Exchange:** everyone passes an item to the next player.
- **Lucky Draw:** gain a random item.
- **Position Shuffle:** everyone swaps spots at random (rare).
- **Battle Royale:** forces a Battle minigame.
- **Zombie Outbreak:** a zombie appears on the leader.
- **Half-price Star:** last place gets 5 off their next Star.
- **Shooting Star** (rare, late game only): the leader's Star flies to last place. The leader is
  the one with the most Stars, then coins. It's never drawn while the leader has no Star.

**Built in pass 7** (`space-play.ts`, `space-rules.ts`): the Witch comes to the lander's space with
three potions, three different outcomes drawn by weight from those that can do something now. Each
potion's color says what kind of outcome is inside (proposed, so a reroll means something): gold
for coins (Coin Rain, Coin Swap, Reverse Fortune, Double or Nothing), green for items (Gift Exchange,
Lucky Draw), purple for the board (Position Shuffle, Battle Royale, Zombie Outbreak), white for Stars
(Half-price Star, Shooting Star). Brew new ones (3 coins) is a fourth button, once a visit. Weights
(proposed): Coin Rain 12, Lucky Draw 12, Reverse Fortune 10, Double or Nothing 10, Gift Exchange 8,
Battle Royale 8, Zombie Outbreak 8, Half-price Star 8, Coin Swap 6, Position Shuffle 4, Shooting Star
3. Double or Nothing bets 2, 5 or 10 coins (15 late), never more than the lander has; Gift Exchange
passes a random item of each holder's to the next in turn order, all at once: the camera rises over
everyone and each item flies from the giver's head to the taker's (2026-11-18, the user asked).

## The Warden

- **Sculk Tax:** lose 5-10 coins to the bank.
- **Hush Money:** pay 3 coins to each other player.
- **Star Tax:** pay 3 coins per Star you hold.
- **Silenced:** lose your next item (built: the next item or die they'd get from an Item space,
  Lucky Draw or a Happening goes to the Warden; what they buy is theirs).
- **Slow Curse:** your next roll uses the Slow Die.
- **Zombie Curse:** a zombie follows you for 3 rounds.
- **Sonic Boom** (rare): the leader loses 1 Star.

**Built in pass 7:** the Warden comes up beside the lander (the emerge animation), roars (Sonic
Boom's own animation for that), does his event and digs away. Weights (proposed): Sculk Tax 20,
Hush Money 16, Slow Curse 14, Star Tax 12, Silenced 12, Zombie Curse 12, Sonic Boom 4; Star Tax
needs a Star, Hush Money another player, Sonic Boom a leader with a Star.

## Happening

One shared table of small effects, weighted, with no Stars and no big swings:

| Effect | Weight |
|---|---|
| +5 coins | 25% |
| Free item | 20% |
| Move forward 2 | 15% |
| Move back 2 | 10% |
| Lose 3 coins | 10% |
| Nothing, flavor only | 10% |
| Swap one item with a random player | 5% |
| Bonus move: roll again now | 5% |

Each map gives only the flavor text and visuals (a conductor handing you a ticket on the train, a
sculk shrieker going off in the Ancient City).

**Built in pass 7:** the camera cuts to the space, `happening.flavor` is said (one line for every
board until map settings can hold text), then the effect. Move forward walks 2 (a Star or the Trader
passed on the way still stops it, a branch still asks) without landing again; Move back walks back the
way the links came; Roll again is a standard-die roll with no items, then the walk and the space it
lands on (never a second one in a turn); Swap an item needs the lander and someone else to hold one.

## Shop, Villager and Wandering Trader

**Shop spaces:** landing on one opens the Villager's shop. Its stock is 3 random items, refreshed
each round and shown to everyone. Buy as many as you can afford and carry. Prices are all under half
a Star, so shopping delays a Star but never blocks it:

| Item | Price |
|---|---|
| Stone Totem | 5 |
| Ender Pearl, Cursed Totem, Zombie Spawn | 8 |
| Golden Totem, Iron Golem, Dueling Glove | 10 |
| Lightning Strike | 12 |
| Slow Die (proposed) | 3 |
| Risk Die (proposed) | 6 |

**Selling,** through the Villager item or at a Shop, pays half the item's value, rounded down (see
"Dice" for value).

**Wandering Trader:** every 3-4 rounds it appears on a random Item space for one round. Chris
announces it and a beacon marks the spot. Pass or land on it to trade, like the Star spot: one buyer
per visit, and the stock is a single item from a rare pool at about 1.5x shop price:

| Item | Price |
|---|---|
| Golden Die | 20 |
| Mystery Die | 18 |
| Lightning Strike | 18 |
| Cursed Die | 15 |
| Golden Totem | 15 |
| Triple Die (proposed) | 15 |

## Versus and the Dueling Glove

- **Versus space:** the lander picks an opponent. The loser pays the winner 5 coins (capped at what
  the loser has). Coins only, never Stars.
- **Dueling Glove:** the same, with 10 coins at stake.
- Stakes double in the last 2 rounds (the last round in 10-turn games), announced by the Referee.
- **Spectator bets:** the other players can bet 0, 3 or 5 coins on the winner. A correct bet wins
  the same amount from the bank, and a wrong one loses it. Duelists can't bet. Bets lock when the
  duel starts, and the Referee reads out the odds.

## Minigame formats

- **4-player FFA**
- **2v2**
- **1v3**
- **Battle:** everyone bets 5 coins (capped at what they have), and the winner takes the whole pot.
  Ties split the pot among the winners.
- **1v1:** Versus spaces and the Dueling Glove. Duels play the 1v1 minigames and the FFA ones,
  played by the two duelists.

**The schedule:** every 3rd round is a team game, taking turns between 2v2 and 1v3. The others are
FFA, with about 1 FFA round in 8 played as a Battle (plus Chance's Battle Royale). The 1v3 solo role
and the 2v2 pairings rotate, so everyone gets an equal share. With 3 players there's no 2v2, and 1v3
becomes 1v2 (the 1v3 minigames with a pair); 2 players play FFA only.

**The minigame** is picked at random within the format, shown with a short roulette. One already
played this game is very unlikely to come up again (about a twentieth as likely as a fresh one).

**Rules, then Ready:** the rules show through the arena's rules camera, and the minigame starts once
every player has said they're ready (a jump). There's no practice round.

## Coins awarded

- **FFA:** 1st 10, 2nd 6, 3rd 3, 4th 1. With 3 players 10, 5, 2; with 2 players 10, 3. Ties
  average the places (2 tied for 1st get 8: (10 + 6) / 2).
- **2v2:** winners get 7 each, losers 2 each.
- **1v3:** solo win 10 for the solo and 1 for each trio member; trio win 6 for each trio member and
  2 for the solo. The user left it to whichever is more balanced: these balance when the solo wins
  about 31% of the time, a realistic rate, while the first numbers (15 / 1 and 5 / 3) balance only
  at 12%. Track the real solo win rate in
  playtests: if it's higher, lower the solo win payout; if it's lower, raise it.
- **Doubling:** coins double in the last 2 rounds (15 and 20-turn games), the last round only in
  10-turn games. Chris announces when doubling starts.

## End-of-game bonus Stars

A game with 3 or 4 players awards 3 bonus Stars, and a 2-player game 2, each worth 1 Star and
delivered by the Allay. A player gets at most 1. They're drawn at random each game, never two from
one category, and kept secret until the end, from:

- **Chaos:** most hazards hit (Red and Warden spaces, zombies), biggest coin swing, luckiest roll,
  most wins from random or luck-based events.
- **Skill:** most kills, most wins, longest win streak, most second places (closest finish), most
  wins decided in a game's final seconds.
- **Behavior:** most items used, fewest deaths, most deaths, most unused items at the end, most
  high-risk choices.
- **Participation:** best comeback, last-place bonus, most improved, biggest jump in standings over
  the last 5 rounds, most wins in 2v2 and 1v3 (team player).

**Built in pass 8 (2026-11-18,** `end-game.ts`), not yet seen in game. The game keeps a record on
every seat all game (`GameStats`) and draws the bonus Stars from it at the end: the categories in a
random order, and in each the first of its awards (in a random order) whose best has no bonus Star
yet goes to them, a tie among the best picked at random. An award whose best already has one isn't
given (it never goes to a runner-up), and a category with nothing to give is passed over; nothing
scores for 0. Each award's name is a text in the dialogue file, `bonus.<id>`, the `{award}` in
`end.bonus.award` (the user words them):

| Category | Award (`bonus.<id>`) | Who gets it |
|---|---|---|
| Chaos | Most Hazards Hit (`hazards`) | the most Red and Warden spaces landed on and zombie bites |
| Chaos | Wildest Coin Swing (`swing`) | the most coins won or lost at once, less what they spent of their own accord |
| Chaos | Luckiest Roll (`roll`) | the highest roll |
| Chaos | Fortune's Favorite (`luck`) | the most coins (and Stars, at their price) Chance Time and Happenings brought them, whoever landed |
| Skill | Most Minigames Won (`wins`) | the most minigames won (a team minigame's winning side, everyone tied for first) and duels won |
| Skill | Longest Win Streak (`streak`) | the most round minigames won in a row, 2 at the least |
| Skill | Most Second Places (`seconds`) | the most free-for-all minigames finished with one player ahead |
| Behavior | Most Items Used (`items`) | the most items used |
| Behavior | Biggest Hoard (`hoard`) | the most items and special dice still held at the end |
| Behavior | Most Tumbles (`tumbles`) | the most times out in a minigame (fell, caught): the plan's "most deaths" |
| Behavior | Biggest Risk Taker (`risks`) | the most duel bets, Double or Nothing bets, and Risk and Mystery Dice rolled |
| Participation | Biggest Comeback (`comeback`) | the furthest climb from their worst place after a round to where they finish |
| Participation | Underdog (`underdog`) | last place at the end (with someone ahead) |
| Participation | Most Improved (`improved`) | the furthest climb from their place after round 1 |
| Participation | Strongest Finish (`surge`) | the furthest climb over the last 5 rounds (a game over 5 rounds) |
| Participation | Best Team Player (`team`) | the most 2v2 and 1v3 minigames won |

Left out until the minigames report them: most kills, fewest deaths, and wins decided in a
minigame's last seconds. A place is the results screen's (Stars, then coins; ties share one), taken
after each round's minigame.

## Tiebreaker

Checked after the bonus Stars:

1. Most Stars.
2. Most coins.
3. A sudden-death minigame among only the tied players, picked at random from a short pool (Quick
   Draw, Hot Floor, Sumo Duel). FFA if 3 or more are tied.
4. If still tied, the Allay picks the winner at random.

**Built in pass 8 (2026-11-18),** not yet seen in game: the pool is the plan's three as they're
built (only Hot Floor so far), else any free-for-all minigame; a duel for two tied, a free-for-all
for more, the rest watching, and the minigame pays nothing. Its places order the tied on the final
podium; a draw (or nobody left standing together) goes to the Allay. Only the seats here at the end
are ranked: someone who left isn't on the final podium.

### The end, as built (pass 8, 2026-11-18)

`board-loop.ts` endGame, `stage.ts` (the end), in the order of the user's End of game scene in the
dialogue tool. Not yet seen in game.

1. **Back on the pre-game podium:** after the last round's minigame and results, a fade to black,
   and behind it everyone stands on the pre-game podium in turn order facing the podium camera,
   Chris at his spot behind them, zombies gone. The black lifts on the podium camera.
2. **The bonus Stars** (a cutscene everyone can vote to skip; skipped, every Star is still given and
   drops in over its winner's head): Chris says it's over (`end.chris.over`) and how many bonus Stars
   there are (`end.bonus.intro`), the Allay flies down from high over the podium to wait over it
   (`end.allay.hello`, the Allay dancing: a seeded action), then for each Star flies over to its
   winner and hovers in front of their head, the two turning to each other while the camera eases
   to them; the Star flies from the Allay to them as it says what for (`end.bonus.award`), and they
   celebrate as it lands. Then the Allay goes back over the podium and the camera with it.
3. **The results screen**, from before the bonus Stars to after.
4. **A tie for first:** Chris calls it (`end.tie.chris`) and the sudden death plays from the
   podium's shot (the stars come in over it, no zoom out of the board), its announcement's format
   line "Sudden death" (`format.sudden`); its podium shows who won it, no coins. Still tied: back on
   the pre-game podium behind a fade, the Allay flies round the tied (twice, once for three or
   more), then to the one it picks (`end.tie.allay`), who celebrates.
5. **The final podium** (a cutscene too): behind a fade to black everyone stands on the board's
   Final podium best first (tied places side by side), Chris at his Final podium spot, and the
   camera eases slowly in from 6 blocks further back and 2 higher (4.5 s). The winner celebrates
   and last place is sad, each holding the pose; Chris names the champion (`end.podium`, Chris
   celebrating: a seeded action), the camera goes round the front of the winner (a 140 degree arc,
   about 5 seconds) and back, Chris thanks everyone (`end.thanks`), and the screen fades to black,
   held while everyone goes back to the lobby. The final standings go to chat (`end.standings`).
6. **Without the board's Final podium,** the pre-game podium stands in: its spots in place order,
   everyone facing its camera, Chris at his spot (or his Final podium marker).

The old end's lines (`end.tie`, `end.title`, `end.subtitle`) are no longer said.

**Tests** (`/blockparty:tests`): Skip to a round has **The end of the game (bonus Stars)** at the
bottom of its list, and **End-of-game tie** sets a tie for after the bonus Stars (the top 2, 3 or
all 4 made level with the leader) and can make the sudden death decide nothing, so the Allay picks.
With `/minigame win <name>` the sudden death ends at once.

## Dice

**How a die looks** (the user, 2026-11-15; the spike uses blocks as stand-ins): each die is a model,
a cube with its faces, that spins over the roller's head until it's hit, and fades in and out (or
grows and shrinks) when the player switches dice in the dice bar. Proposed: an entity of the game's
own per die with its own texture, spun and faded by its pack animations, built with the board loop
(pass 4).

At most 2 special dice held, beside at most 3 items. One movement boost per turn: a die or a totem,
not both. Where each die comes from and its value are proposed (the user asked for ideas). There's
no Double Die: the Stone Totem does the same.

| Die | Faces | Where it comes from | Value |
|---|---|---|---|
| Standard | 1-6 | Everyone, always | |
| Slow | 1-3 | The Shop (a cheap die for landing exactly on the Star or a Shop); the Warden's Slow Curse forces it for one roll | 3 |
| Triple | 3 dice, the total | Item spaces (trailing players), the Wandering Trader at 15 | 10 |
| Risk | 0, 0, 1, 6, 7, 8 | The Shop, Item spaces | 6 |
| Golden | 5 to 10 | The Wandering Trader at 20; Item spaces, last place only, rarely | 13 |
| Mystery | 1-6, and each face also triggers an event for the whole lobby: Everyone swaps places, Coin swap (the roller's coins with a random player's), Double coins (the next minigame pays double), Everyone +5 coins, Everyone back 3, Roll again | The Wandering Trader at 18; Chance's Lucky Draw | 12 |
| Cursed | one face moves 12 and gives 10 coins; the other five move 1 and cost 3 coins. You can make another player use it | The Wandering Trader at 15; Item spaces | 10 |

**Value** is what selling works from: the shop price, or for what only the Trader sells, the Trader
price divided by 1.5, rounded down. Selling pays half the value, rounded down. Item spaces, Lucky
Draw and the Happening's free item all draw from one pool of items and dice, weighted by standing.
The Shop's 3 random slots can hold Slow and Risk dice.

### The dice file

Every die is an entry in `games/blockparty/dice.json` (the user, 2026-11-18: one place to add dice
and say how each looks and what it does); the game reads it (`dice.ts`), and `test/dice.test.ts`
names any mistake in it. Add a die by adding an entry; its key is its id (lowercase letters, digits
and underscores). Each die:

| Setting | What it does |
|---|---|
| `name` | Its name, in the item panel and the roll's title |
| `letters` | One or two capitals (a digit can be the second), never another die's or an item's: they stand in for its icon in the item panel and name its icon file. Never a digit first: the game reads text starting with a digit as a number in the panel's picture path, and the icon shows as the missing texture (the One Die's `1D`, 2026-11-20) |
| `block` | The block floating over the roller's head while it's out, until it has a texture |
| `ink` | The color of the numbers on its model's faces, `"#rrggbb"` (`#1e1e1e` if left out); a face can have its own |
| `shadow` | A shadow under the numbers on its faces (the user, 2026-11-18), as Minecraft draws one under text: `true` for Minecraft's own (the ink at a quarter of its brightness, so white's is `#3f3f3f`), a color `"#rrggbb"`, or `false` (none, the default). It sits a pixel right of and below the number, raised half as far off the face, and the item panel's icon shows it too. A face can have its own (`false` takes it off one face) |
| `texture` | Its model's body, a path in a pack (`textures/blockparty/dice/golden`, no `.png`): one 8 x 8 square worn on every face, or 24 x 16, six 8 x 8 squares, faces 1 to 3 on the top row and 4 to 6 under them (2x or 3x those sizes work too, for finer pixels). A path that isn't in Block Party's pack is one of Minecraft's own textures (`textures/blocks/gold_block`), worn on every face. With one, the die over the head is a spinning die the size of a player head (1 up, 6 down, the others round the sides, opposite faces adding up to 7 for a standard die), each face's value raised off it ("The die model", below), instead of the block. Every die has a stand-in for now: the vanilla texture of its block. After changing a texture, run `npx tsx tools/blockparty/dice-pack.ts` (the tests fail until it has run) |
| `panel` | What the item panel shows for it: `faces` (its six faces), `description` (its description in the faces' place) or `both` |
| `description` | The text the panel shows under its name (needed unless `panel` is `faces`) |
| `count` | How many times it's rolled at once, the moves added up (the Triple Die's 3; 1 if left out) |
| `say` | A line from the user's dialogue file said in the dialogue box when it's rolled (fills: player, die, roll) |
| `value` | What the Shop works from |
| `test` | `true`: a die for the Tests only (the One Die) |
| `faces` | Six faces, below |

Each face:

| Setting | What it does |
|---|---|
| `move` | The spaces it moves (0 to 99) |
| `coins` | Coins for the roller, or taken from them with a minus (never below 0) |
| `event` | What else happens: `again` (roll the same die once more and add it, at most 3 more), `everyone_coins` (everyone gets `amount` coins, 5 if left out), `coin_swap` (the roller's coins swap with a random other player's), `double_minigame` (the round's minigame pays double), `swap_places` (everyone's pieces swap spaces at random), `everyone_back` (everyone, the roller too, goes back `amount` spaces, 3 if left out) |
| `amount` | The event's number |
| `say` | A line said in the dialogue box when it comes up (fills: player, die, roll, coins, other: coin_swap's other player) |
| `show` | What the item panel and the die model show on it, up to two characters: its move if left out (`""` for a blank face). For a picture instead, put `textures/blockparty/dice/faces/<show>.png` in Block Party's resource pack: the die model shows it on every face with that show text, and so can the item panel, by giving each face slot in the workshop JSON UI builder's blockparty_panel an image whose source is `text:textures/blockparty/dice/faces/{{row.face1}}` (face2 to face6 likewise) |
| `ink` | This face's number color, over the die's (the Cursed Die's lucky 12) |
| `shadow` | This face's shadow, over the die's (`true`, a color, or `false`) |

The file's `number` is the look of the moves left over a walker's head (below): `ink` (white if
left out) and `shadow` (as a die's; Minecraft's own if left out), `{ "ink": "#ffffff", "shadow": true }`.
Its `gain` and `loss` are the looks of a transfer's count over a head, "+3" coming in and "-3"
going out (Minecraft's gold `#ffaa00` and red `#ff5555` with their shadows if left out), the same way.

**The roll** (the user, 2026-11-18): the jump hits the die, which shakes, squashes and swells for
a third of a second and bursts: chips of its own body's texture fly out (its burst particle,
`blockparty:die_burst_<id>`, one for every die with a model) in a puff of Minecraft's explosion
smoke. Its number grows in where it was, in Minecraft Ten (`blockparty:count`), and rides over the
roller's head, facing each player's own camera, as they walk; it counts down one at each space
they reach (a little bump each time) and is gone as they land. A totem's extra die or a halved roll
changes it. On the turn order roll everyone's number stays up until their place is said. The
dialogue box no longer shows the roll ("7", "Alex, Standard Die"). The user's Sounds view has the
cues: `dice.hit` as the jump hits, `dice.number` as the number shows, `walk.step` at each space.
The item panel's die icon shows face 1's value on it, as the model draws it.

A roll's coins, events and lines come right after the roll, face by face, before the walk.
The lines the dice say now are the user's Dice texts (`dice.triple`, `dice.golden`,
`dice.risk.zero`, `dice.cursed.lucky` and `.unlucky`, `dice.mystery.*`). Bots hold only the standard
die until items and the Shop hand dice out; the Tests' Dice and items held picks any two of the
file's dice.

#### The die model

The die over the roller's head (`blockparty:die`) is drawn in two layers, each its own render controller on the one entity, both turning with the spin (they share the bone `die`):

1. **The body:** the die's `texture` on an 8 x 8 x 8 cube (`geometry.blockparty.die_plain` for one square on every face, `geometry.blockparty.die` for six).
2. **The faces:** each face's value stands half a body pixel off it, in pixels half a body pixel wide. A face's `show` text is drawn in the game's own Minecraft Ten font (the "10" font: digits are 7 x 10 pixels, so they come out 5 units high on the 8-unit face, two of them side by side a pixel apart) in its ink; a face with a picture (`textures/blockparty/dice/faces/<show>.png`, best 16 x 16 with the picture inside a margin, see-through around it) shows the picture, each pixel a small block of its color (a picture over 16 pixels across is shrunk to fit the face). Text wider than 14 pixels (some letter pairs) is shrunk to fit.

The die stands right over the roller (it used to float in the middle of the block over them, off to one side when they stood on a marker's corner), its bottom about half a block over their head, so their jump hits it.

`tools/blockparty/dice-pack.ts` makes the faces from the dice file: one geometry per die (`resource_pack/models/entity/die_faces.geo.json`, cubes colored from `textures/blockparty/die_palette.png`, one pixel per color), and the lists in the client entity and render controllers. It also makes the numbers over heads: the moves left over a walker's head (`models/entity/count.geo.json`: every digit in its own bone, a digit alone centered, a two-digit number's tens and ones a font pixel apart about the middle, 1.25 units a pixel, the shadow behind; its render controller shows the digits its `blockparty:count` property names) and a transfer's count (`models/entity/tally.geo.json`, a geometry for each of the `gain` and `loss` looks: the sign, then each digit centered in a cell as wide as the widest digit, a font pixel apart, the whole centered; its render controller shows the sign and digits its `blockparty:tally` property names in the geometry its `blockparty:tone` picks, nothing at 0), both colored from `textures/blockparty/number_palette.png`, each die's burst (`particles/die_burst_<id>.json`), and `tools/blockparty/ten-glyphs.json`, the glyphs for every digit and face text, which the build draws the dice icons' numbers from (the server has no font). It reads the font from Minecraft on this PC (`resource_packs/vanilla/font/minecraft-ten.ttf`, or `MINECRAFT_TEN`), never copying the font file itself into the repo. `tools/blockparty/dice-model.json` keeps what it last made the model from; `test/dice.test.ts` compares it with the dice file and the pictures, so the tests fail until the tool has run again.

The number faces the camera with Minecraft's own billboard (the dragon fireball's `animation.actor.billboard`: the `count` bone turned by `q.camera_rotation`) inside a bone, `upright`, that undoes the entity's own turn (`-q.body_y_rotation`, as vanilla's sleeping player does): set moving by impulses, its body turned toward where it went, so the number faced off to one side (seen 2026-11-18). It follows its walker by being set moving each tick toward its spot over their head, a tick and a half ahead of where they're going (`counts.ts`), as the bots walk; a teleport every tick stutters. If it reads mirrored or faces away in game, the billboard's turn is the thing to flip.

Both numbers are drawn with `entity_emissive` from their own palette, every pixel's alpha 1 (nearly see-through, which that material draws at full brightness): with the die's `entity` material the white number came out a dull gray (158 of 255) with a black shadow, shaded like a mob's side.

## Items

At most 3 held.

- **Stone Totem:** roll an extra die next turn.
- **Golden Totem:** roll an extra die that doubles, next turn.
- **Ender Pearl:** switch places with a player (the Enderman performs it).
- **Cursed Totem:** used on a rival: their next roll is halved, rounded up.
- **Dueling Glove:** forces a 1v1 with 10 coins at stake.
- **Lightning Strike:** the player with the most Stars (then coins) gives 10 coins (capped at what they have) to the player with
  the fewest. Used on yourself, it gets rid of a zombie, but you still lose coins. Coins only, never
  Stars. (Built: a user with a zombie picks Strike the leader or Strike me; struck themselves, their
  10 coins go to last place, or the bank if they're last.)
- **Zombie Spawn:** a zombie follows a rival and takes 3 coins every round. It leaves when the
  target finishes top 2 in a minigame, after 3 rounds, when the target has no coins left to take, or
  when the target uses an Iron Golem or a Lightning Strike.
- **Iron Golem:** shakes down a player for up to 5 coins, or removes a zombie from you.
- **Villager:** trade a die or an item for coins: half its value, rounded down (see "Dice"). Not
  on the final turn.

**Built in pass 7** (`item-play.ts`): on their turn, before the roll, a player picks Items in the
board menu, steps to an item and jumps; the menu goes while it works and comes back for the roll.
One item a turn (proposed): Items is dim after one. An item that needs a rival asks in the dialogue
box (each player with their Stars and coins, and Never mind, which keeps the item). A totem is the
turn's movement boost, so after one only the standard die shows in Dice block; its extra die is
rolled after the main roll and shown under the total. The Enderman, the Iron Golem and the Villager
come to do theirs; the Lightning Strike is a flash and a crack, no real bolt. A zombie (zombies.ts)
walks behind its target, fades with them on others' turns, and takes 3 coins as each of their turns
starts (to the bank, proposed). Using the Cursed Die from your own hands asks first: roll it, or make
a rival roll it (their next roll is it). The Warden's Slow Curse and a handed-on Cursed Die are said
as the turn starts, and Dice block shows only that die. Bots use an item 60% of the turns they hold
one: their zombie sent away first, a rival item on the leader when they aren't it, then a totem.

### The items file

Each item's name and look are an entry in `games/blockparty/items.json` (the user, 2026-11-18: the
items' config and textures in one file, as the dice have); the game reads it (`items.ts`), and
`test/items.test.ts` names any mistake in it. What an item does is code (`item-play.ts`), so the file
has an entry for each item the game knows (its key is the item's id: `stone_totem`, `golden_totem`,
`ender_pearl`, `cursed_totem`, `glove`, `lightning`, `zombie`, `iron_golem`, `villager`) and can't
add a new one. Each item:

| Setting | What it does |
|---|---|
| `name` | Its name, in the item panel, the dialogue box and the Shop |
| `letters` | One or two capitals (a digit can be the second), never another item's or a die's: they stand in for its icon on the cards and in the item panel, and name its icon file |
| `texture` | Its icon's picture: a path in Block Party's pack (`textures/blockparty/items/stone_totem`, no `.png`) or Minecraft's own (`textures/items/totem`, `textures/blocks/...`). The build copies it to `textures/blockparty/icons/<letters>.png` in the built pack, a picture smaller than 64 pixels drawn larger with hard pixels; Minecraft's come from the build's copy of the game's textures and never go in git. Nothing to run after a change |
| `description` | What it does, under its name in the item panel |
| `value` | What the Shop works from: its price, and half of it to sell (1 to 999) |

The pictures are the user's own (2026-11-18, `resource_pack/textures/blockparty/items/`), but the
Ender Pearl's, which is still Minecraft's. The cards' three item slots and the item panel's icon
(the workshop JSON UI builder's blockparty_cards and blockparty_panel) are images whose source is
`text:textures/blockparty/icons/{{row.item1}}` (`item2`, `item3`; the panel's `{{row.icon}}`): an
item showing `ST` shows `textures/blockparty/icons/ST.png`. The panel's icon slot is the dice's too:
the build writes each die's icon by its letters the same way, from its body's picture (face 1 of a
six-face one). An empty slot on a card holds `__`, whose picture is clear.

## Presentation and cameras

Players don't walk the board: a script moves each piece space to space. The camera follows the
active player's turn, with authored views for the pre-game, dice rolls, NPC conversations, events
and podiums.

### Pieces

**Decided after the spike (the user's look, 2026-11-15): the player, pushed.** Each tick the script
pushes the player toward the next point (`applyKnockback`, their own walking locked), so their own
client moves them: vanilla's walk plays and the camera stays smooth, for the walker and for those
watching. Anything moved by a teleport or a set velocity each tick (the first way below by
teleport, the mount, the stand-in) stopped 20 times a second and looked jittery, and a jump threw a
rider off the mount, so the mount and the stand-in are out. A turn is a teleport to where the
player already is, with the new facing, at each corner, and the pushes steer back to the path and
settle on the spot. The chase and the watch camera both looked very good with it.

What the spike tried, for the record:

1. **The player, moved along the path by the script** (each tick, their own movement locked), with
   a walk animation the game's pack plays on them, the way Chameleon's pack plays its poses on the
   player.
2. **The player carried by an invisible mount** the script glides along the path, the same pack
   animation overriding the riding pose.
3. **A stand-in figure** wearing the player's saved skin, as the editor's mannequins do, with its
   own walk animation; the player waits out of sight.

The first two show every player's own skin, character creator skins included. The stand-in can't:
a skin reaches it only after the watcher has seen the player and the network has been rebuilt
(`docs/skins.md`), and a character creator skin needs a model of its own, so those players would
get a plain look. That's why it's last.

**Names:** none over the pieces (the user's call after the spike's second look, 2026-11-15). The
spike's label (an invisible entity named for the player, kept over the head) lagged behind the
player, and the players' own name tags are hidden on the board. A HUD says whose turn it is instead
(built with the board loop, pass 4).

**Corners** (the user's third look): one speed all the way (slowing into corners looked worse);
a corner is turned exactly on the space's block middle, and the chase camera pans round it at a
fixed rate instead of cutting. Where a piece stops on a space (and the back and forth
some spots showed) is settled with the board markup's spaces (pass 3).

**Over the ground** (the user, 2026-11-19: walk off ledges to the next spot, stairs, jump before
hitting a block, and more; they picked gaps, ladders and vines, and slabs and partial blocks on top):
each stretch between two spaces is planned from its blocks when the piece sets off on it, and the
pushes carry the plan's height, so pieces walk up and down steps, jump blocks and gaps, fall off
drops and climb ladders and vines. "Moving over the board" (under Maps) has how, and what a board can
ask of a piece.

### Turns and controls

- **Replaced (2026-11-17):** the hotbar below worked, but minigames need the hotbar for their own
  items, so the board's controls move to JSON UI of the game's own: the board menu, the item panel
  and the rest in `block-party-ui.md`. Rolling and items below follow it: pick Dice block or Items in
  the menu, step through the item panel, jump to roll or use. Kept for the record:
- **The hotbar** (the user's idea): a Block Party look drawn with JSON UI, the vanilla hotbar
  restyled rather than hidden and replaced, so scrolling, number keys, controller bumpers and
  tapping on a touch screen all still pick a slot. The selected item's name and what it does show
  over it. The spike showed all of this works. After it the user asked for:
  - **Bars of their own:** the main bar is Items, Dice and the menu (standings, settings). Using
    Items swaps the bar for the items held, and Dice for the dice held (the standard one and any
    special ones), each with a Back slot.
  - **Only the slots in use show,** bottom right: two dice show as two slots and Back, and a
    scroll skips the empty ones. Vanilla's empty slots can't be hidden (two tries), so the bar is
    the pack's own, drawn from codes on each player's action bar (the user's idea), with vanilla's
    hidden; vanilla's slots still pick by scrolling and number keys.
  - **No health, hunger or XP bar** (nor armor or air) on the board.
- **Rolling:** open Dice, pick a die (the standard one or a special one), then jump to hit it.
  The script reads the jump button (`playerButtonInput`, as Sumo's double jump does); the spike
  showed it reports in every lock mode.
- **Items:** open Items, pick one and use it (right click) before jumping. A target is picked
  from a form.
- **Branches:** a form with one button per path, while the camera shows both with arrows.
- **No timers:** the game waits for the player, at the roll and at every choice. If one player
  holds everyone up for a minute (at their turn, or by not voting), the others can vote to go on
  without them: their turn is skipped, or the vote goes ahead without theirs. They keep their place.
- **The turn fade** (the user, 2026-11-18): on a player's turn everyone else fades away, so the
  turn's player is alone on the board; they come back when the turn is over (`fade.ts`). Not on the
  pre-game podium, and not while a minigame has the players (a Versus duel too). Whatever follows a
  player (the Zombie Spawn's zombie) fades with them, and stays when it's that player's turn. The
  board's NPCs (Chris at the Stars, the Referee) stay. A bot or the zombie eases out over 0.4 s (an
  alpha on a color-masked blended material, as vanilla's warden pulses its spots) and then goes
  invisible, which takes its shadow away; a player goes invisible at once (a fade would need
  vanilla's player model copied into a pack and changed).
- **Votes, by every player:** a jump during a cutscene votes to skip it, and it's skipped once
  everyone has voted. A minigame starts once everyone is ready. A late joiner comes in once
  everyone has said yes.
- **Leaving:** the piece stays and is skipped (no turns, no minigames), keeping its Stars and coins,
  and its player takes it back on rejoining, with no vote.
- **Late joiners** (while fewer than 4 play): choose to join or to watch. Joining needs every
  current player's yes; watching is always open. A joiner comes in at the start of the next round,
  at Start, last in the turn order, with as many coins as the player in last place and no Stars.

### Shots

**(S)** a static authored position, **(D)** dynamic (follow, pan, orbit, push-in, spline). Everyone
sees the same shot unless marked **(P)**, a private shot for one player.

The user's camera list (2026-11-17, `block-party-ui.md`, "Cameras") wins where it overlaps this
one: the intro, the starting podium, the order rolls and reveal, the Star reveal, the board view's
two modes, the turn shot, NPC pans and cuts, and the minigame announcement. It is shared by everyone,
so private shots become shared ones there.

**Pre-game**
- Intro flyover of the board (D, spline).
- Player introductions, one at a time (S close-up or slow orbit).
- Turn-order roll: a group shot, each player's die on its own pedestal (S). The user's picture
  (2026-11-17): the starting podium shows everyone, through one static camera set when the map is
  built, while they roll for the order.
- Turn-order reveal: once everyone has rolled, the camera pans to each player in turn order (1st,
  then 2nd, and on), each with their place (D, between the lineup's spots).
- Chris explaining the rules (S, NPC dialog view).
- Chris hands out the starting coins (S).

**Each turn**
- Turn start: the active player close up with a name card (S).
- Item use (S, over the shoulder).
- Dice roll (S, low angle on the die).
- Movement: chase camera with look-ahead (D).
- Branch choice: pulled back to show both paths (S); the chooser sees it as (P) with the arrows.
- Landing result: close-up of the space and its effect (S).
- Board overview (S, high).
- Standings (S).
- Into a minigame (fade; a loading screen, Minecade's star field and logo, once the black lasts).

**Star**
- Star moves: pan to the new spot, beacon beam (D).
- Star pass or purchase: shot and reverse shot between the player and Chris (S).

**Shops and traders**
- Villager's counter: the player and the stock (S, NPC dialog); selling in the same view.
- Wandering Trader arrives: pan to its space (D), then the trade view (S).

**Chance Time**
- The Witch's cauldron: three potions on display (S, close-up).
- Potion choice and reroll (P).
- Outcome cutaways: Coin Rain (wide, S), Coin Swap (two-shot, S), Position Shuffle (overview, D),
  Battle Royale (transition), Zombie Outbreak (the zombie arrives, D), Shooting Star (the Star
  flies from the leader to last place, D).

**Warden**
- Warden event: low-angle looming shot with shake (D).
- Sculk Tax, Hush Money: Warden close-up (S).
- Star Tax: a slow look across the Star holders (D).
- Sonic Boom: the leader and the beam (D).

**Items and effects**
- Enderman swap: two-shot, then a cut to the new positions (S).
- Zombie: a short close-up each round it takes coins (D).
- Iron Golem shakedown or zombie removal: heroic low angle (S).
- Lightning Strike: tilt up to the sky, then the target (D).
- Dueling Glove challenge: two-shot (S).
- Dice and totems: a generic item-use close-up (S).

**Happening**
- The map's flavor close-up on the space and the effect (S).
- The map's special event, a wide cinematic (D): train cars swapping, lava rising.

**Versus duels**
- The Referee announces the stakes (S).
- Face-off two-shot (S).
- Bets: the arena wide plus the Referee reading the odds (S); the betting forms are (P).
- Duel results (S).

**Minigames**
- Arena overview with the rules (S or a slow pan).
- Everyone ready, a countdown, then vanilla controls.
- Battle pot: the bets landing in the middle (S).
- Results and coins awarded (S).
- Winner highlight (S).
- Out players watch from a fixed camera or as vanilla spectators.

**Announcements**
- Doubled rounds: Chris close up, then a board overview with a banner (S).
- Final turn warning: board overview (S).

**End of game**
- Bonus Stars, one at a time: follow the Allay's flight (D), the drop onto the winner, a close-up
  (S).
- Tiebreaker: standings (S), the sudden-death minigame, then the Allay circling the tied players and
  landing on the winner (D).
- Final podium, 1st on top (S, slow ease in).
- Winner celebration: orbit (D).
- Fade out to the lobby.

**NPC conversations** (every NPC)
- Establishing wide (S).
- NPC close-up: eye level for Chris, low angle for the Warden (S).
- Over the player's shoulder (S).
- Reverse shot, then back (S).

**Utility**
- Fade to black or white. Hold a shot. Reset to the default camera. A fallback view when a
  scripted camera fails.

### Camera rules

- Camera anchors are markers placed per map (see "Board maps").
- The follow camera aims 2-3 spaces ahead and eases its turns.
- On sharp corners, cut to the next anchor instead of swinging.
- Keep screen direction within a shot, and don't cross the line between two characters.
- Pull back and rise at branches.
- Tight spaces (train cars) use fixed corner cameras.
- Pacing: about 0.3-0.5 s per space when moving, 0.5-1 s easing between shots.
- Every cutscene can be skipped, and a reduced-motion option uses static cuts.
- Always clear the camera at a minigame's start, on a disconnect, and on any script error.

### The board's cast, forks and results, as built (2026-11-18)

The user's asks after a look at pass 7, all in `stage.ts`, `entrances.ts` and `fork.ts`:

- **Board view** eases both ways over the board camera's ease (`boardCameraEase`), the field of view
  with it; going to it was a cut. While it's up nobody is faded: every player, bot and zombie shows.
- **Talking with an NPC:** the seat and the NPC turn to each other (a player by a teleport where
  they stand, a bot by turning), at the Star, the Shop, Versus, the Trader and every NPC visit.
- **The Star over its space:** the Star model (`blockparty:star`) floats 2.5 blocks over a Star's
  floor, 1.5 times its size, turning and bobbing, popping in when its Chris arrives. Bought, the
  coins fly to Chris, then the floating Star fades (the bots' fade, `controller.render.blockparty.fading`)
  as the bought one flies from it to the buyer. Passed up, it stays.
- **Chris's balloon:** when the Star moves on, a balloon pops out of Chris (a property his client
  reads: `geometry.blockparty.balloon`, `textures/blockparty/balloon.png`, a placeholder to repaint),
  he rises 8 blocks over the higher end, crosses (at most 5.5 s however far) and comes down beside
  the new Star's space, the camera following from the side; there the balloon pops and the Star
  appears. He flies with no gravity and no collisions (`blockparty:fly` and `blockparty:land`), his
  speed set each tick toward the planned spot, as bots move, so clients see it smooth.
- **The Wandering Trader** comes with two llamas on leads (`blockparty:trader_llama`, vanilla's
  llama with the trader's decor, a random coat): the camera cuts to his space, and he walks in
  beside the board's path from at least 12 blocks back (out of the shot), the llamas keeping to his
  trail 1.9 blocks apart. He leaves with them (llamas first, so no lead drops as an item).
- **The Witch** appears and vanishes in a puff of smoke (`blockparty:smoke_puff`, the pack's own
  particle, grayish purple), and **the Enderman** (the Ender Pearl) teleports in and away in his
  blink's portal particles. Everyone else an item brings (the Iron Golem, the Villager, the Glove's
  Referee, the Zombie) just appears (the user).
- **Residents:** the Referee beside every Versus space and the Villager beside every Shop space
  stand there all game, at the default spot beside their space, facing it; a lander's scene turns
  them to the lander and back after. Per-marker spots come with the editor later. The Dueling
  Glove's Referee and the Villager item's Villager still come to the player.
- **Sounds:** new events `npc.chris.balloon`, `npc.chris.balloon_pop`, `npc.witch.appear`,
  `npc.witch.vanish`, `npc.enderman.appear` and `npc.enderman.vanish`, silent until the user maps
  them in the dialogue tool's Sounds view.
- **Wide faces:** the Warden's face, tendrils and all, is a picture twice as wide as it's tall
  (the workshop's make_faces.py WIDE), and the dialogue box's name tab widens for it (the user): the
  workshop install marks a character `wide` when its face's picture is wider than it's tall, and the
  game puts index 1 on its face row (`WIDE_FACE_WORD`, "71"), which shows the 22 x 11 slot in place
  of the 11 x 11 one.
- **Forks** are the fork box (`dialogue.ts` fork, the workshop's `blockparty_fork` component, word
  `bpf`): the buttons alone, side by side across the box (two or three: title codes `§q§2`, `§q§3`),
  named Left, Middle and Right by where each way goes as the piece arrives (`fork.ts`; lines
  `branch.left`, `branch.middle`, `branch.right`). The walker steers with A and D (the ends don't
  wrap) and jumps to pick; the box and the camera are everyone's: each focused way turns the camera
  (from 5 blocks behind the fork, 5 up) to look 2 spaces down it, its first space lit. A bot's focus
  moves to its pick. The old branch form's lines (`branch.title`, `branch.button`,
  `branch.button.star`) are no longer used.
- **Results** take a jump once the changes have played: the party leader's or the turn's player's
  goes on; the screen shows its jump prompt meanwhile (title word `bpj`, the `blockparty_results`
  component's Go on, bottom middle). With no jump it goes after its hold, as before.
- **The skip strip** (since replaced: "The user's look at the board, as built", below) said
  "Skipping 1/3" in place of "Hold [sneak] to skip 1/3" for a player holding sneak.
- **Potions** show their pictures left of their names on Chance Time's buttons (vanilla's fire
  resistance, leaping, nausea and slow falling bottles for gold, green, purple and white), by a code
  after the button's index (`BUTTON_ICONS`).

### The user's look at the board, as built (2026-11-18, evening)

- **The board's button is the jump again** (the controller's A, the space bar): picking in the
  board menu (Dice, Items, Board, an item to use, back from Board), a dialogue box's choice or going
  on, the results' Go on, Ready before a minigame, and the hit on the die. The user tried a punch,
  then a press of use, and went back to it (2026-11-18); the prompts are the jump's icons again.
  **Use (right click) held is the skip vote:** the board's item (`blockparty:standings`, format
  1.21.120: at 1.21.60 its newer components kept it from loading, so nothing could be held) has a use
  that lasts (`use_modifiers`), so `itemStartUse` and `itemStopUse` say when the button goes down and
  up; a right click on a block or a mob is down while its events keep coming.
- **Skipping is holding use** for 4 seconds. The skip strip says, for everyone (`skipText`): "Hold
  use to skip" before anyone has voted, "Waiting to skip 1 / 3" while some have, "Waiting for Alex to
  skip" when one is left, "Skipping" once all have. A player holding use (past half a second, so a
  press shows nothing) sees "Skipping..." instead, its three dots lighting up white as the hold goes
  on (their action bar's `§k§v` and the step's digit, `holdingCode`; four strips in the
  `blockparty_dialogue` component). The old code, `§k§e`, was the core's "Capture the flag!" bubble,
  which showed whenever a player held sneak to skip. The strips never showed at first: the builder
  wrote `$actionbar_text` straight into their expressions, which only work on a copy
  (`"$atext": "$actionbar_text"`), so its sidebar pieces' layouts now make one and their expressions
  read it (workshop json-ui `compile.mjs`).
- **Long button labels** (over 14 characters: the Shop's goods, a rival to pick, a trade) put a
  question in the wide box (title code `§k§9`, BOX_WIDE): the words on top and the buttons under
  them, the box's whole width, in place of the narrow column beside the words.
- **Every throw is a hit:** a Triple Die (and a Roll again face) brings the die back over the head
  after each burst, for the next jump (bots hop each time), and the number over the head is the total
  so far. The roll's words are gone (`turn.rolled`, the Triple and Golden Dice's `say`, the totem's
  "Extra die" notice): the number over the head says it. Effects still have their lines (a 0 on the
  Risk Die, a halved roll, the Mystery and Cursed Dice's faces).
- **The dice look like the standard die:** the user's textures for every die (`dice/<id>.png`), each
  die's `"number": { "ink", "shadow" }` read as its faces' ink and shadow (the look the file's
  top-level `number` has), and the Mystery Die's faces show "?".
- **The numbers over heads are particles** (`numbers.ts`, `number-sprites.ts`): a model's billboard
  turns to `q.camera_rotation`, the player's own look, not the scripted camera they look through, so
  the moves left and a transfer's count faced the wrong way whenever the camera wasn't in front of the
  player. Minecraft always draws a particle facing the camera that draws it, so the game sends one
  `blockparty:number` a tick where each number stands, moving the way the number moves until the next
  takes over, its picture a cell of one atlas of every number (`textures/blockparty/numbers.png`, the
  moves left 0 to 99 and "+1" to "+99", "-1" to "-99" in the dice file's looks with their shadows,
  written by `dice-pack.ts`). The count and tally entities, their models, palette and animations are
  gone. A transfer's count is half the moves left's size and stands just over the head (its middle
  2.1 over the feet, 1.2 higher while the moves left show).
- **Tokens fly to the taker:** a spawned entity's body doesn't keep the turn it's given, so the
  tokens flew off any which way. Their models (the icon's, and the private icons pack's coin and
  Star) have the moves left's old bones: `upright` undoes the body's turn, `heading` turns to the
  token's heading property (Minecraft's yaw toward the taker, whole degrees), and `root` flies along
  the heading's -z (with +z they flew from the taker to the giver, the user saw).
- **Players stand square** to where they look on the board: a teleport turns only the head, so the
  pack's `animation.blockparty.square_up` (on controller `blockparty.square`, played again every 5
  seconds, stopped in minigames) turns the whole model by the head's turn from the body
  (`q.target_y_rotation`); the head, turned relative to the entity, stays where it looks.
- **The Shop** sells once and buys once a visit: each button goes once it's used, and with both
  used the visit is over.
- **Zombies** come and go in the Witch's puff of smoke (events `npc.zombie.appear` and `.vanish`),
  and one leaving says `zombie.leaves` in the dialogue box (chat is hidden on the board), after the
  results when a minigame shakes it off.
- **The Warden** comes up in the pack's own entrance (`warden.enter`: a climb out from 4 blocks down
  in 1.6 seconds, arms first), in place of vanilla's emerge, which held his head out on the floor for
  nearly 2 seconds and took 6.6. He's drawn only while shown (each of his render controllers has the
  condition `q.property('blockparty:shown')`, so never for a frame before), shown 9 ticks in. Vanilla's
  dig keeps his head out for seconds, so the pack's `warden.sink` (3 blocks under from 2.4 to 4
  seconds, on his `root`, played with the dig on a second controller, `NpcMove.also`) takes him
  under, and he's hidden 4.1 seconds into the dig.
- **The crying Sad** has its arms come in over the face (their sideways turn had the wrong sign, so
  a raised arm swung out), a little lower.
- **The round bottom right** is "Round 3 /" light gray (`§7`) and the rounds in all dark gray (`§8`),
  whatever the user's `round.hud` line says around its fills (`roundText`).

### After pass 8 (2026-11-18)

The user's asks after seeing the end of the game, not yet seen in game:

- **Gift Exchange shows its passes:** each item flies from the giver's head to the taker's (the
  transfers' item tokens), and the camera goes back to the Witch and the lander for her goodbye.
  Chat (hidden on the board) still lists them. Since 2026-11-20 it's a hand-over (the user's ask:
  `block-party-ui.md`, "Transfers, as built"): the camera on each giver in turn order as their item
  leaves, then on its taker as it lands, in place of the one shot from high over everyone.
- **Chris comes down under his balloon at the Star reveal** too, as he does whenever a Star moves:
  he starts 10 blocks over his spot beside the Star's space with the balloon out, comes straight
  down with no gravity (eased, about 3 seconds), and the balloon pops as he lands (`balloonIn`,
  `entrances.ts` descentPlan). Skipped, he's simply there.
- **Confetti** (`resource_pack/particles/confetti.json`, `blockparty:confetti`): paper in six party
  colors (vanilla's white concrete tinted), 70 pieces bursting up over the head, spinning and
  flipping as they flutter down, settling on the ground, gone after 3 to 4 seconds. It bursts over
  a seat whenever a Star lands on them (bought, a bonus Star, Shooting Star, any Star gained), over
  every winner of a round minigame (the winning side, everyone tied for first) as the results come
  on its podium, the winner of a duel, the sudden death's winner or the Allay's pick, and three
  times over the champion on the final podium.

## Maps

### How it fits

A game server runs on one world (`docs/maps.md`): each starts from a fresh copy of its map's world.
Sending players to another server for each minigame would mean a loading screen every round, so the
minigame has to come to the board's world instead.

- **Boards** are maps of the Block Party game, made, checked and published like any game's map.
- **Each minigame** is its own entry in the editor's map list, with its own checklist, holding its
  one arena map. No variants: the build warns about a second map for one minigame.
- **At play time** the board's server has every published arena with it: Publish cuts each arena
  map's Arena box out as a structure, and the server's start copies them into the game's pack
  (pass 5 part B, `docs/maps.md` "Arena maps"). When a minigame is picked, the game places its arena in
  the slot of the board's arena background (see "Arena backgrounds"), loads it with a ticking area,
  moves the players in behind a fade (Minecade's logo fades in on the black if it lasts), and
  clears it afterward. The next play places a fresh copy, so floors that fall away or get mined
  (TNT Run, Spleef Duo, Hot Floor, Mining Race) are always whole. This is how Build Swap's arenas
  already work (minigame-core's `game/arenas.ts`, `docs/spike-results.md`, "Arena tiles"), except
  that the arena comes from another map.
- Nobody needs the board loaded during a minigame, so the arena has most of the world's 300 ticking
  chunks to itself.

### Board maps

**Pass 3, built 2026-11-15 and 16:** minigame-core's board kit (`src/board`: spaces in map.json,
their edits, the dealer, the board check), Block Party's `map.board` and its optional Arena slot (a
40 x 60 region, switches in Checklist Features while the spike plays Probe's maps), and game Edit's
Spaces tool with `/boardcheck` (`docs/editor.md`), and the Panel's Spaces tool (`docs/viewer.md`,
2026-11-16): pass 3 is built. Not checked yet: special event markup, camera anchors and stages (passes 6 and later), and the free block beside
Star candidates and Item spaces.

Build the board in a creative world and bring it in with Select or Port to another game. Outside the
board there should be nothing: the game uses the empty space around it for the arenas.

**Spaces** are markers, chained by clicking:

- Each new space links from the previous one, the one placed or clicked last. Click an existing
  space to make it the previous one: placing from a space that already has a next one starts a
  branch.
- **Link** joins the previous space to an existing one without placing a new one: it closes the loop
  and rejoins shortcuts. Links can be removed in the space's menu. Arrows between spaces show the
  way.
- A space with 2-3 next spaces is a branch, where the player picks a path.
- The first space placed is **Start**.
- **Types are dealt.** Each new space gets the type that keeps the board closest to its shares
  without breaking a placement rule; spaces placed before it never change on their own. **Deal
  again** re-deals every unlocked space once the loop is closed, keeping the try with the fewest
  `/boardcheck` warnings.
- **The space's menu** (its marker's form in game, the right panel in the Panel): Type, Lock (Deal
  again leaves it alone), Star candidate, Opening spot (on a Star candidate), and its links.
- Spaces keep their ids when moved, so links survive.

**Building spaces:**

- Leave a flat 3 x 3 spot for each space, its middle block the space's, with the layer above it
  empty (air): the game stands the space's marker there at the start, in its type's look ("Space
  markers", below), and four pieces share its top, one on each corner. A re-deal never means
  rebuilding. Build the path, not colored pads.
- Space them 4-5 blocks apart, center to center, 4.5 by default on a straight stretch (a gap of 1
  or 2 blocks between markers). Never closer than 3 along both x and z: the markers would overlap
  (`/boardcheck` warns). Pieces move in straight lines between spaces, so put a space at every
  corner of the path.
- The path can rise and fall between spaces: stairs, slabs, a block to jump up, a gap to jump, a
  drop, a ladder or vines up a wall. "Moving over the board" (below) says what a piece gets over.
- Leave a free block beside every Star candidate and every Item space: Chris stands beside the
  Star, and the Wandering Trader beside its Item space.
- **NPC spots (built 2026-11-23, not yet seen in game):** the user asked for a way to place where
  the NPCs go at special spaces like Versus and Shops, not needed for every one. Any space an NPC
  comes to can have an NPC spot (map.json: the space's `npc`, [x, y, z, yaw, pitch]), placed in the
  Panel from the space's panel (docs/viewer.md, "NPC spots"): the Shop's Villager, the Versus
  Referee, Chance Time's Witch, the Warden, the Wandering Trader at an Item space, and Chris at a Star
  candidate of any other type (core `spaceNpc`). Every NPC that comes to that space stands there
  (stage.ts besideSpace: the item NPCs too, as they always shared the space's spot), facing the way
  the spot faces while nobody talks to it; without a spot the game picks one beside the space as
  before. A Shop space also sets its Villager's looks (the user): Biome, Profession and Level
  (`villager`: { "biome", "profession", "level" }, lower case names; plain Plains, Unskilled, Stone
  when left out), the same lists as the Tests' NPC menu (core `VILLAGER_PARTS`). The Panel only, as
  with bends and golems (my call).
- The beacon beam is a model the game draws with the vanilla beam's texture (proposed), so it works under a ceiling (an Ancient City
  board). A real beacon would need open sky over every candidate.

**Special event markup**, by the map's event type (picked in Map settings, with its timing):

| Event | What the map marks |
|---|---|
| Path toggle | The link or links it closes and opens |
| Teleport | Pairs of spaces: from, to |
| Time-of-day modifier | The times it moves between |
| Roaming hazard | Its route (a chain of spaces) |

Each also has an event camera.

**Stages and camera anchors** (the per-map camera checklist; `/boardcheck` warns about any missing):

| Anchor | Placed with |
|---|---|
| Board overview | Camera tool |
| Region anchors (the follow camera falls back to them, and carries boards too big for one overview) | Camera tool |
| Intro flyover path (its cameras in order) | Camera tool |
| Special event camera (a map with an event) | Camera tool |
| **Final podium** (pass 8, built 2026-11-18): 4 spots, 1st place to 4th, each placed standing where the player stands with your facing taken; **Final podium camera**, placed standing where the camera goes with your facing taken; and **Chris** with the type **Final podium**. Without a camera, the shot stands in front of the spots the way they face; without Chris's marker, he stands past the end of the podium. Without the podium, the pre-game podium stands in (in place order) | Game marker tool |
| Pre-game lineup, one spot per player, and the turn-order pedestals (the starting podium in `block-party-ui.md`: a wider gap between the 2nd and 3rd spots, Chris's spot further back, a fixed podium camera). **Built in pass 6** as **Pre-game podium** (4 spots, 1 to 4), **Chris** with the type **Pre-game** (the marker's Type list; more types come with later stages), and **Podium camera** (`stage-markup.ts`). Without a podium camera, the shot is from behind the podium looking at Chris | Game marker tool |
| **Intro shots** (pass 6): the intro's cameras in order, each placed standing where the camera goes with your facing taken (the shot is what you saw); the camera eases from each to the next. They stand in for the intro flyover path above | Game marker tool |
| NPC stages: Chris, Villager (the shop counter), Witch (the cauldron), Referee, and the Allay's landing spot. Each is the NPC's spot and the guest's spot (where the player stands to talk), both with a facing; the conversation shots are worked out from the two, and a camera named for the stage replaces the default | Game marker tool |
| A spectator or queue spawn | Spawn tool |

Chris at the Star, the Enderman's swaps and the Trader's visits happen on the board itself, framed
from the spaces.

The pass 6 rows can each be turned off (Checklist Features), and a board without them plays with
stand-ins: the lineup on Start's corners, Chris on the space after Start, the camera behind Start,
and three high intro shots round the board. The camera rows are points rather than Camera tool
cameras: those are the lobby's pictures, which servers never get.

**Map settings** for a board (Panel and game Edit): the NPCs' vanilla variants (the Villager's biome type and profession, Chris's pig variant; a Shop's Villager is now set on its space instead, "NPC spots" above), the
Happening flavor (a few lines of text, one picked each time, and a sound), the special event and
its timing, and the map's time of day.

**Size:** 36-45 spaces, longer if the theme wants it. About 100x100 blocks lets one overview camera
show the whole board, even at a console's render distance. A longer board leans on its region
anchors.

### Space markers

**Built 2026-11-18** (the user asked for 3D markers in place of the colored block pads), and
**changed the same day** after their look: the perimeter plate is gone, the block texture is stretched
once over each face, and the marker is low enough to walk up like a slab or a stair. Every space is a
model the game stands on the floor at the start (`blockparty:space`, `space-markers.ts`): a
**pedestal** 40 x 40 pixels (2.5 x 2.5 blocks) and 6 pixels tall, its middle on the space's block,
the pieces standing on its top. A pixel is a sixteenth of a block, as in a block's texture. It wears
its type's block texture, the whole picture stretched once over the top and once over each side (one
block's worth over the whole face, not a block every 16 pixels).

**Spacing and room:**

- Spaces 4-5 blocks apart, center to center (a gap of 1.5 to 2.5 blocks between markers); 3 at the
  least. `/boardcheck` warns about any closer (the board config's `footprint`, 3: the blocks a
  marker's floor takes).
- A flat 3 x 3 floor under each, the layer above it empty, and room to stand over that.
- The pieces: each one's middle 0.7 blocks from the space's middle on a corner, so the four take 2 x 2
  blocks of the marker's 2.5 x 2.5 (a piece is 0.6 wide). They stand on its top, 0.375 over the floor.
- NPCs beside a space (Chris by the Star, the Wandering Trader, the Villager, the Witch) stand on the
  floor 2.5 blocks from its middle, clear of the marker: leave that block free.

**Standing on it.** The marker is stood on for real: under it the game puts an invisible block,
`blockparty:space_floor`, in each block the marker covers, as tall as its top, so pieces stand on it.
A block the map already has in that layer is left alone. A walking piece is pushed each tick, and a
push sets how fast it goes up (to nothing), so it never stepped up on its own: it stood at the edge
until the walk gave up and put it on the space (the user saw it stick there a moment). The walk
lifted it as its side came to a marker's edge; since 2026-11-20 the marker is just ground the walk's
plan reads (its top, within its reach), walked up and down on a slope like a slab ("Moving over the
board", below). A zombie following its target hops it once.

**Lit up** (emissive, to show the difference): a marker lights while a piece anyone can see stands
on it (its middle over the marker, so a walk lights each space it crosses; a seat faded out on
someone else's turn doesn't count) and while a cutscene's shot is on the space (a Star's reveal and
its move, the Wandering Trader arriving, a Happening). Lit is drawn at full light, unshaded, with the
highlight's color laid over it, pulsing. The Tests menu's **Light every space** lights them all, to
look at.

**Editing the textures:** `games/blockparty/spaces.json`. Each type has one texture: any of
Minecraft's block textures by its path (`textures/blocks/concrete_blue`, no `.png`), or a 16 x 16
picture of your own put in `games/blockparty/resource_pack/textures/blockparty/spaces/` and named
`textures/blockparty/spaces/<name>`. Pictures must be square: an animated texture (sculk's) is its
frames one under another and shows squashed, which is why the Warden is cyan concrete. Its
`highlight`: `color` (`"#rrggbb"`), `strength` (how much of the color, 0 to 1), `pulse` (up and down
by this much) and `seconds` (one pulse).

**Editing the model:** `games/blockparty/resource_pack/models/entity/space.geo.json`, a Bedrock
entity model: open it in Blockbench (File, Open Model). It's one cube in the bone `pedestal`; change
its size, or add cubes and bones of any size, turned or not. Every face of every cube gets the whole
texture stretched over it, and a face taken off a cube in Blockbench stays off. To see it textured
in Blockbench, give it any 16 x 16 block texture. The game reads its sizes from the model: the floor
is its widest reach from the middle (the same both sides) and as tall as its top. Limits: within 24
pixels of the middle (3 blocks across), the top at most 16 (more than 8, a slab's height, and the
tool warns, since the walk's lift is sized for a step).

**After a change** to either: `npx tsx tools/blockparty/space-pack.ts`. It checks both, sets the
model's texture mapping in place and writes the client entity's textures, its two render
controllers (plain and lit), the floor block (`behavior_pack/blocks/space_floor.json`) and
`games/blockparty/space-model.json` (what the game reads). `test/spaces.test.ts` fails until it has
run. Then merge and Restart.

### Moving over the board

**Built 2026-11-20** (the user asked for pieces that walk off ledges to the next spot, take stairs,
jump before they hit a block, "and more", and picked gaps, ladders and vines, and slabs and partial
blocks from the list; not a leap up 2 blocks or more).

**The user's first look (2026-11-20):** almost none of it worked. Pieces stuck on the stairs' last
step, at the bottom and the top of the ladders and on the void gap's far ledge; they seemed to jump
to the space after the partial blocks and the water, and to teleport to the marker after the hurdle.
Down the stairs and the drop of 2 were fine, and the camera's following worked great. **Pass 2**
(the same day, not yet seen in game) found why with a headless check that walks a SimulatedPlayer
over the test board exactly as the game does (`spike/blockparty/walk.ts`; with server-authoritative
movement the server moves a real player the same way, and 6 of the 12 stretches failed there too):
the server's raycast reports a full block's top as 0 inside it, so every full block read a block
low and the plans dove into the floor; a ray goes through water; following half the gap to the plan
each tick never reached a step's top (the feet stopped at 1.995 under 2.0, held by its edge); a
finished climb was pulled back on to it; and a push asked the same along in the air as on the
ground, so a piece in the air sped up to 0.5 a tick and fell behind its plan. All 12 stretches now
get there in the check, a player and a bot, at 0.4 a tick with no stops (`docs/spike-results.md`,
"Walking the test board").

**What a piece does**, on each stretch (one space to the next, in a straight line), as a player
would (`walk-plan.ts`):

- **Steps up or down 0.6 blocks or less** (a slab, a stair, a carpet, snow, a space's marker): walked
  on a slope, lifted before a step up (0.1 over its edge by the time its front meets it) and let
  down once all of it is past a step down. Straight stairs are a slope of half-block steps.
- **A step up of more than 0.6, up to 1.3** (a block): jumped before the piece gets to it. The jump
  is picked from takeoffs up to 2.2 blocks before it and upward speeds 0.28 to 0.62 a tick, leaning
  hard to a player's own 0.42 (so it looks like a jump), flown as a player flies: it must clear
  everything by 0.1 on the way up and come down onto the top (over its edge by 0.1), never into its
  side, about 0.9 onto it.
- **A block in the way it could only stand on for a moment** (a hurdle, a block deep): one arc over
  it, not up and straight back down, staying over it until all of the piece is past (a player moves
  down before along, so the hurdle's back would catch it).
- **A gap** (nothing under it, or water or lava, up to 4.5 ahead): jumped, landing about 0.9 onto the
  far side. A crack it's over for no more than 0.2 (under 0.8 wide) is walked over, as a running
  player does. Pieces never walk into water.
- **A drop** (down more than 0.6, down to 10): walked off and fallen down, as a player falls
  (gravity 0.08 a tick, drag 0.98), still walking at its speed.
- **A rise taller than a jump with a ladder or vines on it** (any of ladder, vine, twisting, weeping
  and cave vines, scaffolding, in the block in front of the wall): it walks to 0.25 from the wall at
  the height it's on and climbs at 0.15 a tick (vanilla's ladder speed), on up until its feet are 0.1
  over the top, then walks on over it, never back onto the climb. **A drop with a ladder or vines**
  below its edge: it goes over the edge into the ladder's block and climbs down.
- **A rise taller than a jump with nothing to climb, or a fall into nothing**: nothing gets it over,
  so the walk puts the piece on the next space when it gets there (as a stuck walk always was).

**How:** when a piece sets off on a stretch, the game reads the ground along it (`terrain.ts`): every
0.1 blocks, the highest ground under the piece's width (it's 0.6 wide, so it stands on anything any
part of it is over), each a ray straight down from 1.6 over its feet (a slab's half, a daylight
detector's 6 pixels, snow at its collision; a full block's top, which the server reports as 0 inside
it, is its top; carpet the ray goes through, so its floor), or from the first open block over a wall
when that's inside one. Stairs are read from their states (a ray meets a stair's whole block), fences
and walls stand 1.5 high, plants and vines aren't ground, and water and lava are no footing (a ray
goes through them, so the blocks over the ground it meets are looked at). A space's marker is ground
at its top. From that ground it plans the feet's height all along the stretch, and each tick
(`walk-follow.ts`):

- **Along**, the push asks for what takes the piece a tick's step from the speed it has: a push keeps
  part of it (half of what's left after friction, so more in the air), which the game reads
  (`getVelocity`, on the ground or not).
- **Up**, the plan's change in height over the step plus 70% of the gap to the plan: a push sets how
  fast a player goes up, and down too (`docs/spike-results.md`, "A push down"), so the game works out
  the push that moves them as planned (`pushUp`). Never under the ground its front sweeps that tick
  (0.1 over it where it rises: a player moves up or down before along, so a dip under an edge it's
  about to meet stops it there). Over walked ground, a piece over the plan is let straight down onto
  it, a little under so it lands rather than hovers.
- **Climbs** in order: it walks to a ladder's foot at the height it's on (the plan never looks past
  the climb before it starts), climbs at its spot, and once off it walks on at its end.
- **Stuck:** a piece that barely moves for 2 ticks is lifted 0.1 over what's ahead; 10 ticks more and
  it's put on the next space. So is one that falls 2.5 under its plan (a jump that missed).

A bot is set moving at the same speeds; a zombie following hops up to a block. The board camera and
the chase camera follow a piece's height eased (30% of the gap a move), so a jump doesn't bob them.

**Building for it:** keep each stretch between two spaces straight (a space at every corner, as
always), and put what a piece gets over on that line, the path wide enough round it (3 is good).
Give it head room: 2 blocks over the path, and a jump goes up to 1.25 over where it takes off (a
ladder's climb, its wall's height). A ladder or vines go on the wall the path climbs, in the path's
line, from the bottom up to the top; down, on the wall under the edge the path drops from. Leave a
flat run of about 1.5 blocks before a jump and after a landing (a takeoff can't be on a stair, and a
piece lands about 0.9 past the edge). Gaps up to 3 wide are comfortable (a jump covers about 4.5 at
the walk's 8 blocks a second); any gap or drop the walk can't make, it skips.

**The test board** (`test-board.ts`, on any map without spaces of its own: Probe's Default, which
Block Party borrows): 12 spaces in a loop 8 blocks apart (center to center), around the plaza beside
the platform, each on a floor of its own at its height (3 along the path by 7 across, 5 by 5 at the
corners, so Chris and the Trader have room beside it), the path 3 wide, with one thing to get over on
each stretch:

| Stretch | What it has | Floor heights |
|---|---|---|
| 1 to 2 | Stairs up 2 | 0 to 2 |
| 2 to 3 | A ladder down 2 | 2 to 0 |
| 3 to 4 | A block up, jumped | 0 to 1 |
| 4 to 5 | A gap of 2 over the void | 1 to 1 |
| 5 to 6 | A slab down | 1 to 0 |
| 6 to 7 | A ladder up 3 | 0 to 3 |
| 7 to 8 | A stair down, then a drop of 2 | 3 to 0 |
| 8 to 9 | Carpet, snow 4 layers deep, a daylight detector, a slab, carpet | 0 to 0 |
| 9 to 10 | A gap of 3 over water | 0 to 0 |
| 10 to 11 | Vines up 2 | 0 to 2 |
| 11 to 12 | Stairs down 2 | 2 to 0 |
| 12 to 1 | A hurdle, jumped over | 0 to 0 |

The types, Stars and openings are the old test board's. `test/walk-plan.test.ts` plans every stretch
of it with each block's shape (as the server's rays see them) and checks each does what it has, and
follows each plan with a model of a pushed piece (down before along, stopped by any edge) to its end
without a stop. `npx tsx spike/blockparty/walk.ts` (`--bot` for a bot) lays it on a throwaway server
and walks it for real, printing each stretch's outcome and writing every tick to
`spike/results/walk.json`: run it after changing the walk.

**Not yet seen in game:** pass 2. The headless check runs the server's own physics, which moves a
real player too (server-authoritative movement), so what's left for a look is how it looks on a
client: the jumps' height, the stepped way down stairs (a player can't go down while any of them is
over the step above), the climbs, and the pieces' speed (the walk's report says it: about 8 a
second). Corner stairs' left and right as Java's aren't checked.

**Bends (built 2026-11-22, not yet seen in game):** the user asked, for every board, for a way to
make the path between two spaces several straight legs that follow a curving path instead of one.
A link's bends are the blocks its path goes through, in order (map.json: a space's `bends`, by the
id of the space the link leads to: `"bends": { "12": [[x, y, z], ...] }`), placed in the Panel only
(the user's pick; docs/viewer.md, "Bends"): each click on a block adds one in the part of the path
it's nearest. The walk (pieces.ts) goes through them as corners: each leg planned over the ground as
any is, a turn at each bend as at a space (onto the bend's block middle, at the height the piece
walked to, facing the next leg), with no step sound and no move counted. A walk back goes through
them backward (board.ts `bendsBetween`). Removing a link or a space removes its bends.

### /boardcheck

The board's checks show in both editors' checklists, each flagged space clickable (the Panel flies
there). `/boardcheck` in game Edit prints the report in chat. Errors block Publish like any
checklist problem; warnings don't.

- **Errors:** exactly one Start; every space reachable; every path returns to the loop (not to
  Start, which can lead into it); no dead
  ends; branches have 2-3 exits; enough Star candidates; both opening spots present; every Star
  candidate still reachable when a path event closes a route.
- **Warnings:** a type's share more than ~3% off target; adjacent reds; two spaces whose markers
  overlap (closer than 3 blocks both ways); Wardens or Versus spaces too close; a ~12-space stretch with no Item; shortcuts too strong or too weak (against ~10%); Star
  candidates bunched together, or one without others 10-25 spaces away; a missing camera anchor or
  stage; a Star candidate or Item space with no free block beside it.
- **Report:** counts by type against the targets, route lengths (the loop, how far after Start it
  starts when Start leads into it, and each shortcut), and
  flagged spaces with their coordinates.

### Arena backgrounds

The user's idea (2026-11-15), documented for later and not built yet: a board can have an **arena
background**, a themed surround (a stadium, a station hall, a cavern) built around an empty slot of
a fixed size. Every minigame arena loads into that slot, so a minigame looks like it belongs to the
board it's played from, and the same arena map works on every board.

- **The slot:** 40 x 60 blocks across (the user's numbers). Every arena map fits it (see "Minigame
  arena maps"). Proposed: up to 48 blocks tall from the slot's floor, and an arena built 60 x 40 is
  turned a quarter turn to fit (a structure can be placed rotated).
- **Where it is** (the user's call, after the spike's second look): built into the board's own map,
  away from the board, as an option of the map. The board is never unloaded: only the minigame's
  arena is placed in the slot and cleared. The board's markup marks it with an **Arena slot** box of
  exactly 40 x 60, and `/boardcheck` checks the box is that size and empty. A board without one
  plays its minigames in the empty space away from it, as the spike does.
- **At play time:** the arena is placed into the slot, fresh each time, behind the fade. The game
  saves the empty slot when the board loads (a structure of its own) and puts it back after each
  minigame, so nothing of the last arena is left over.
- **What the background can hold:** stands where out players watch (the arena's spectator spawn or
  the background's own), the rules camera's backdrop, and lights and decoration. Nothing in it may
  reach into the slot.
- **Time of day:** the arena's own time still applies while it's played (see below).
- **Still to decide when it's built:** whether Boss Fight, Hunter vs. Runners and Minecart Dodge
  (which wanted up to 128) are designed to fit 40 x 60, or a background can have a bigger slot.

### Minigame arena maps

**Built in pass 5 part B (2026-11-17):** each minigame is an arena in Block Party's config
(`minigames/arenas.ts`, core's `arena-map.ts`, `docs/maps.md` "Arena maps"), so its maps are an
entry of their own in the map editor and the Panel ("Hot Floor (Block Party)", `blockparty-hotfloor`),
with their own checklist. A minigame plays on its arena map when one is published, placed fresh
into the arena slot (or far east of a board without one), and on its test arena laid in code while
it has none. The checklists so far, each with the Arena box, a spectator spawn and (since
2026-11-18) the **Minigame podium** and its **Podium camera** ("The minigame podium" below):

| Minigame | Its arena map marks |
|---|---|
| Hot Floor | 4 spawns on the floor (a duel uses the first 2); **Floor (tiles)**, a box whose lowest layer the game lays its 3 x 3 tiles in, as many as fit each way from its lowest corner (at least 2 x 2) |
| Co-op Painters | Red and Blue team spawns, 2 each; **Floor**, a box whose lowest layer is what gets painted |
| Hunter | **Hunter spawn** and 3 **Runner spawns** (1v2 uses the first 2), and the **Goal** box: a runner over it is home |

- **The rules camera** is the arena map's Start view camera (the Camera tool's), else one over the
  arena. The slow pan between two cameras is for pass 10.
- **Out players** watch from the spectator spawn, and bots that are out float there (the stand
  beside the arena is gone, so nothing outside the Arena box is ever touched).
- **Turned to fit:** an arena that only fits the slot the other way round is placed a quarter turn
  clockwise, its markup turned with it (seen working only in tests so far).
- **The arena's time of day** is set while it's played and the board's put back after.
- **A map that can't be played** (no Floor box, one too small for 2 x 2 tiles, no Goal, its
  structure missing) is named in chat and the test arena stands in.

- **One box, the Arena, made to fit the arena background's slot:** 40 x 60 blocks across at most
  (see "Arena backgrounds"), one structure copy. Before the user's arena background idea this was
  64 x 64, with the few that need room (Boss Fight, Hunter vs. Runners, Minecart Dodge) up to about
  128; those three are the open point above.
- **Self-contained:** any backdrop goes inside the box. Outside it is the board's arena background,
  wherever it's played.
- **Spawns by format:** FFA 4 (every FFA arena also works with 2 or 3 players); 2v2 Red and Blue
  team spawns; 1v3 Solo and Trio spawns; a 1v1 minigame 2. Duels on an FFA arena use its first 2
  spawns.
- **Out players** watch from a spectator spawn, or a camera.
- **The rules camera** (the Camera tool): what players look through while the rules show; a slow pan
  is two cameras, start and end.
- **The Battle pot** lands at the arena's middle, or at a Pot point if the map has one.
- **Results** play on the arena's own Minigame podium (the user, 2026-11-18; "The minigame podium"
  below). Before, the plan had them on the board's podium set, so arenas would need none.
- **Its own time of day:** the game sets the world's time when the minigame starts and puts the
  board's back after.
- **No saved mobs or loose entities:** the game spawns chickens, carts and targets at points the map
  marks.
- **Kill Y, kill regions, bounds** and the minigame's own points and regions, as its checklist asks,
  within the options below.

### The minigame podium

**Built 2026-11-18** (the user asked: "minigame podium, where players go for minigame results,
shows players losing and gaining coins, and doing winning and sad emotes and then holding them";
`minigame-podium.ts`, `minigame-runner.ts`, `moves.ts`), not yet seen in game:

- **On every arena map,** marked with the Game marker tool like the board's Pre-game podium:
  **Minigame podium**, 4 spots, 1st place to 4th in order, each placed standing where the player
  stands with your facing taken; and **Podium camera**, placed standing where the camera goes with
  your facing taken (Take my facing). Build the podium itself (steps, blocks, a backdrop) inside the
  Arena box. The Podium camera can be turned off in the Panel's Checklist Features: the shot then
  stands in front of the spots, the way they face, looking at them.
- **After a minigame,** a plain fade to black (the user, 2026-11-18: no stars and no camera move
  between the minigame and its podium; 0.5 s in, held about a second, 0.6 s out), and behind it
  everyone who played stands on the podium best first: an FFA's places (ties side by side, in the
  order they're given), a team minigame's winning side and then the rest, everyone together after a
  draw. A duel uses spots 1 and 2. The players go first, the bots a moment after; everyone, a
  duel's onlookers too, is put on the podium camera, still, and the black lifts on it. After the
  hold, the star transition back to the board starts from there (the camera rises over the arena,
  the stars).
- **There the results come:** who won in the dialogue box, the coins each wins dropping in over
  their head with the count (+3) rising over it, and a bet lost flying off; the winners celebrate
  and those who came away with nothing are sad (`minigameMoods`), and each **holds the pose** until
  everyone goes back to the board, 5.5 seconds on. Then the results screen on the board, as before.
  A duel's stake flies from the loser's head to the winner's there too. It was a hand-over back on
  the board for a moment on 2026-11-20 (`block-party-ui.md`, "Transfers, as built"), and the user
  put it back: a minigame's results are the podium's, never a hand-over's.
- **Held poses:** a Celebration or Sad animation plays to the point where its last move back to
  the resting pose starts (`animations.ts` holdPoint: arms still up, a head still hung), and the
  player goes into its held pose there, an animation named after it with `.hold` on the end
  (`animation.blockparty.player.celebration.arms_up.hold`), which loops until they're let go. The
  pack has one for each of the six Celebration and Sad animations, made from the clip's own pose at
  that point; one the user makes in Blockbench, named that way, holds with no code change, and an
  animation without one plays again each time it ends.
- **No podium marked** (a minigame's test arena, or an arena map from before): a stand-in is laid in
  code in the arena's middle, facing the rules camera's side: four columns, 1st (gold, 3 high)
  between 2nd (iron, 2) and 3rd (copper, 1), 4th (smooth stone) beside 3rd, cleared with the arena.

### Requirement options (Panel only)

**Built in pass 2 (2026-11-15), for any game:** a game marks rows adjustable in its config's
`map.adjustable` (`docs/maps.md`), the Panel's Map settings has the Checklist Features group, and
`map.json` keeps the map's choices as `"requirements"`. Probe's maps can turn off the spectator or
queue spawn, as a test; no real game marks a row yet.

Most checklist rows become options, set in the Panel's map viewer the way Game settings are: a
switch to turn a row off, and a count for how many entries it asks for. Turn off Kill Y for an
arena that ends by falling into the void, or ask for 3 kill regions instead of 1.

- **The game decides what's adjustable.** Each row in a game's `map` config is fixed (the code can't
  run without it: Hot Floor's floor region, a format's spawns, the Arena box) or adjustable, with
  the range its code handles. The game's code must work with every value its config allows: an arena
  that lets Kill Y go off needs another way out.
- **In the Panel:** a **Checklist Features** group in Map settings, beside Game settings: each
  adjustable row with its switch and count, and Use the default, with no helper text (the user). The checklist follows at once.
- **In game Edit:** no screen for them (Panel only, as asked). Its checklist reads the same values,
  so both editors always agree.
- **In map.json:** only what differs from the defaults:
  ```json
  "requirements": { "killY": false, "regions.kill": 3 }
  ```
- **Publish** (in both editors) checks each map against its own choices, within the game's ranges,
  so a map can't ask for less than the code needs. The build checks each game's `map.adjustable`
  (every key names a row, a range holds the game's own count).
- **Any game** can mark rows adjustable; Block Party's arenas and boards will use it most. A borrowed
  map is checked against its own choices, and a borrowing game counts on a lender's row only down
  to the fewest a lender's map can be left with (the build's borrow check).

## Minigames

From the first draft; each gets its own arena map. Its checklist is written when the minigame is
designed (the first three: "Minigame arena maps").

**FFA: reflex and quick reaction (10-20 seconds)**
- **Hot Floor:** a block color is announced, and everything else vanishes after a countdown.
- **Mob Freeze** (Red Light, Green Light): move only while the mob is looking away.
- **Item Scramble:** one item is called out ("Get a pickaxe!"), and the first to hold it wins.
- **Do the Opposite:** prompts like "Jump!" or "Sneak!" show up, and you do the opposite.
- **Don't Look:** a creeper-style sound plays, and you must not look at a certain spot.
- **Bridge Dash:** a short bridge with gaps where you place blocks fast.
- **Button Mash:** hit a button the most times before the timer ends.
- **Mystery Kit Brawl:** everyone gets random gear from a loot table (a diamond sword, or a stick)
  and fights in a tiny arena for 20 seconds. A reroll costs coins.
- **Anvil Rain:** dodge falling anvils across a shrinking safe zone.
- **TNT Run (mini):** the floor drops out as you run over it.
- **Rising Lava / Water:** climb platforms before the level catches up.
- **King of the Hill:** hold a small platform and knock others off.
- **Egg Drop:** catch falling eggs without breaking them.
- **Snowball Sniper:** hit moving targets for points.
- **Minecart Dodge:** survive a track with carts coming at you.
- **Chicken Chase:** catch the most chickens in a pen.
- **Mining Race:** break ores in a small cube, each ore worth its own points.

**FFA: brain and memory**
- **Simon Says (Block Edition):** repeat a pattern of colored blocks in order.
- **Quiz Floor:** answer true or false by stepping on one of two sides.
- **Name That Mob / Item:** identify a silhouette or a texture crop.
- **Count the Mobs:** mobs show up briefly, and you guess how many.

**2v2**
- **Tug of War:** teams push each other with knockback toward the other team's edge.
- **Capture the Wool:** a mini version, one wool block per side.
- **Spleef Duo:** the floor breaks, and the last team with a player standing wins.
- **Paired Parkour:** teammates are tied by a short lead and cross a course together.
- **Carry Race:** one player rides or carries the other through a maze.
- **Cannon Duel:** one loads and one aims at a target across the map.
- **Co-op Painters:** each team colors a floor, and the most area wins.

**1v3**
- **Hunter vs. Runners:** one player hunts three who each have to reach a goal.
- **Boss Fight:** one player is the Wither with big attacks, and three take it down.
- **Prop Hunt (micro):** three hide as props and one seeks, in a small arena.
- **Trap Master:** the solo player triggers traps while three cross a gauntlet.
- **Defend the Core:** three defenders against one raider with high health and strong gear.
- **Bomb Disposal:** three players solve a puzzle while one attacker tries to stop them.
- **Trap Door Maze:** the runners pick between doors; behind each is a shortcut or a dead-end trap
  the solo player assigned in secret. The solo wins by trapping more runners than they let through.

**1v1 and sudden death** (from the tiebreaker pool; duels also play the FFA minigames)
- **Quick Draw**
- **Sumo Duel**

## Parked ideas

From the first draft, not in this plan: **Roulette** (a random event between rounds, like everybody
swapping places), **Item chaos** (power-ups such as freeze, swap or shield used during a minigame)
and the **Wheel of Fortune** (between rounds, the lowest scorer spins a wheel of events that affect
everyone). Its shop rounds and betting became Shop spaces and the duel and Battle bets, and its lap
reward was dropped.

## Suggested order

1. **Spike:** bring an arena from another map into a board's world at play time; scripted cameras
   (eased moves, splines, per-player shots, fades, clearing); the pieces and their names (see
   "Pieces"); the jump button while a player is locked or carried; the restyled hotbar; NPC
   entities on the vanilla mobs' models; and
   what two minigames need from Bedrock: a player riding a player (Carry Race) and a lead between
   players (Paired Parkour), both likely through the game's own copy of `player.json`, as
   Chameleon's pack does.
2. **Requirement options** in the Panel, for any game.
3. **Board markup:** chained spaces, dealt types, the space menu, the Arena slot, `/boardcheck`.
4. **The board loop:** turns, dice, moving pieces, branches, spaces, Stars, coins. Built 2026-11-16
   (`games/blockparty/behavior_pack/scripts/board-loop.ts` and `board-rules.ts`): the Length option
   (15, 10 or 20 turns), 10 starting coins, the turn order rolled by everyone at once, each turn's
   roll and walk (a form at each branch, the Star offered on passing or landing, then moved to a
   far candidate), Blue and Red coins, the standings top left and each player's line top right, a
   pause where the minigame goes, and the winner (a tie at random until the Allay, pass 8). Late
   joiners come in at Start with last place's coins (no vote yet); an absent player is skipped.
5. **Minigame plumbing:** formats, placing arenas into the arena background's slot, results and payouts, with a first few minigames.
   - **Part A, built 2026-11-17** (`minigame-rules.ts`, `minigame-runner.ts`, `minigames/`): after
     each round a minigame in the round's format (the schedule above: every 3rd round 2v2 and 1v3
     in turn, 1v2 with 3 players, else FFA with about 1 in 8 a Battle), the solo and the pairs
     rotating, the pick weighted against repeats; the roulette, the arena laid behind the loading
     screen, the rules through a camera over it until everyone has jumped (Ready), 3-2-1-Go, players
     who are out watching as spectators (bots from a stand beside the arena), the results over the
     arena, and back to the board. Coins as "Coins awarded" (ties averaged, doubled in the last
     rounds), a Battle's pot, and Versus spaces (the lander picks a rival, an FFA minigame for two,
     the loser pays 5, doubled late). Three minigames, one of each kind, each on a test arena it
     lays in code where the arena goes: **Hot Floor** (FFA), **Co-op Painters** (2v2) and
     **Hunter** (1v3, a small Hunter vs. Runners: half the runners home wins it for them).
   - **Bots** (the user's idea, 2026-11-17, to watch a whole game flow): a game one player starts
     gets bots in the empty seats (the lobby's Bots option, 3 by default). A bot is a Steve on
     the player's model (`blockparty:bot`), its piece its own body, walked like a player's. It
     rolls (the die over its head, a moment's thought, a hop), heads for the Star at a branch, buys
     a Star when it can, picks the leader to duel, and plays every minigame, each step after a delay.
     After the user's seventh look: the player's model (vanilla's zombie model maps a 64 x 32 skin
     and stretched Steve's), and a bot that goes into an arena and back is made again there a moment
     after the players (a body moved in the same tick as a player was dropped by that player's
     screen, so the bots vanished at the first minigame while still playing).
   - **Test help** (the user asked): the One Die (always 1) in place of the Slow Die, Get star in
     Tests (on your roll, the roll is the number of spaces to the nearest Star and the branches go
     that way), and 30 starting coins while Block Party is a test game or `DEV_MIN_PLAYERS` is 1.
     After the seventh look: Go to a space (Get star's way to the nearest space of a type, Versus
     for a duel), Skip to a round (straight to its minigame or with its turns) and Play a minigame
     now (any minigame in any of its formats, then the turns go on). 2026-11-18 (the user asked):
     `/minigame win <name>` skips the minigame on now with that player or bot winning it (their
     side in 2v2 and 1v3; in an FFA, a Battle or a duel everyone else ties second), straight to
     its results and coins: at once while it plays, at the rules if typed during the roulette.
     Part of a name does (`big` for "big red fox"). Only while testing: Block Party a test game,
     `DEV_MIN_PLAYERS` at 1, or a preview from the map editor. Also 2026-11-18 (the user asked, to
     try dice and items): `/hold` (`blockparty:hold`, or Hold the game on my turns in Tests) stops
     the game on the typer's turns. Once the turn or minigame going on ends, every turn is theirs
     (no other seat's turn, no round's end, no minigame), and their dice and items are put back
     before and after each turn, so nothing rolled or used is used up: what they held when they
     typed it, or what Dice and items held sets meanwhile. Typed again (Let the game go on), the
     game goes on from the seat where it stopped. Only while testing, as `/minigame win`.
   - **Results** (seventh look: the winners' title ran off the screen and the titles flickered): a
     short title for everyone (one name, Red or Blue, a tie counted) with each player's own place
     and coins under it, the whole list in chat; titles that follow each other quickly (the
     roulette, the countdown) come in at once instead of fading in. They move onto the board's
     podium set with the cameras (pass 6).
   - **Part B, built 2026-11-17:** arena maps. Each minigame its own entry in the editor's map list
     with its own checklist (see "Minigame arena maps": Hot Floor's floor, Co-op Painters' floor
     and team spawns, Hunter's spawns and goal), its published Arena box written as a structure at
     Publish and copied into the board's server at its start (and into a preview's), placed fresh
     into the arena slot, turned a quarter when only that fits, in place of the test arena, which
     still plays a minigame with no arena map. Out bots float at the spectator spawn. Not yet seen:
     the user builds the three arena maps. Then spectator bets on duels and the Dueling Glove
     (pass 7, with the items).
6. **NPCs and cameras:** stages, conversations, the shot list. **Built 2026-11-17** with the
   dialogue box from pass 10 (the user asked for the two together):
   - **The dialogue box** (`dialogue.ts`, `dialogue-codes.ts`, `ui/jui_blockparty_dialogue.json`):
     see "Dialogue". It rides the scoreboard sidebar, everyone's alike, under the core's
     `GAME_SIDEBAR_MARK` and its own `BOX_MARK`; the standings come back when it goes. Since
     2026-11-17 (the user): one sentence at a time, nothing said before left in the box; a jump goes
     on (every player's, for a line to everyone, the right column naming who has; the one it's
     said to, for a question), the jump button's icon for the player's own device at the right
     column's bottom right; holding sneak 4 seconds votes to skip. Its look is the workshop JSON UI
     tool's `blockparty_dialogue` component (a sidebar piece), which the user edits in the builder;
     `node tools\install-component.mjs blockparty_dialogue <worktree> blockparty` in the tool
     installs it.
   - **Voices:** one sound of the speaker's voice for each sentence, from the user's sound map
     (`sounds.json`, installed with the lines); the box's events (open, next, a button, close, a
     skip vote) play their cues once the user maps them.
   - **The stage** (`stage.ts`, `stage-layout.ts`, `stage-markup.ts`): the NPCs as the vanilla
     mobs' models with no AI, placed and turned by the game; shots for everyone, a pan or a cut
     (each moment's Camera in the user's file wins over its default). The board stays loaded
     (its ticking area takes in the podium), so NPCs can be placed anywhere on it.
   - **The pre-game,** in the order of the user's Pre-game flow chart in the dialogue tool: the
     intro (the map's intro shots or high ones round the board) under Chris's welcome, a cut to
     the starting podium (everyone on the pre-game podium facing Chris), Chris asking the first
     player on the podium whether to go over the rules (`pregame.rules`, Yes plays the Tutorial
     scene, No or sneak skips it; it was a lobby option until the user's look), how long the game
     is, the call to roll, everyone turning to the camera and rolling for the order, then the
     reveal (the camera moves to each player in turn order as Chris calls their place,
     `pregame.place.1` to `.4`), the starting coins (`pregame.coins`), and the Star reveal (the
     camera pans to each Star's space and a Chris drops in beside it with slow falling).
     Everything but the roll is a cutscene everyone can vote to skip; skipped, everyone still ends
     on Start and every Star has its Chris.
   - **Chris at the Star:** he stands beside each Star all game. Passing or landing on it, the
     camera pans to the player and Chris, and he offers it in the dialogue box (Buy a Star, Not
     now; sneak is Not now), or says the player can't afford it. Bought, he thanks them, the camera
     pans to the Star's new space, and a Chris drops in there.
   - **The Referee at Versus:** comes to stand beside the lander (a cut), says the stakes are
     doubled in the last rounds, and the lander picks a rival from his buttons; then the face-off
     line, and he goes.
   - **Chris's announcements** as a round starts: halfway, coins doubling from now on, the final
     round (each skippable).
   - **Done** (the user, 2026-11-18): the dialogue tool works as it is (no blocks from it in the
     game), and the skip strip needs no heads or names. The NPCs' stages came with their passes,
     the board view and the turn shot with the cameras. Player animations and the lines' actions
     came later (2026-11-18, `block-party-ui.md` "Player animations", "As built").
   - **After the user's first look (2026-11-17):** the dialogue box showed only Chris's name. Its
     size variables were single parts of a size (`"$box_width": 330`), which the game rejects
     ("Dangling number" in the client's content log), so the box had no width; they're whole pairs
     now, the tabs and the highlight stretch (`keep_ratio`), and the skip strip is a tab on the
     box's top border at the right (bottom right, it overlapped the box on 16:9 screens). The
     workshop's JSON UI tool now draws the box (its Game preview list) and reports that error. A
     sentence no longer ends at an initial or a title ("Chris P. Bacon"). The pre-game follows the
     user's flow chart, with the tutorial as Chris's question; the markers are Pre-game podium and
     Chris by type. Not yet seen in game.
7. **Items, dice, Chance Time, the Warden, the shop and the Trader.** The dice (a dice file, models,
   faces that do more) came first (2026-11-18, "The dice file"). **The rest built 2026-11-18**
   (`space-rules.ts` pure, `seats.ts`, `space-play.ts`, `item-play.ts`, `zombies.ts`), not yet seen
   in game:
   - **Seats hold things for real:** up to 2 special dice and 3 items each (bots too), on the cards
     and in the board menu; a special die is used up when it's rolled. Tests' Dice and items held
     sets your seat's (any two dice, any three items).
   - **Item spaces:** a prize from one pool of items and dice (Item spaces, Lucky Draw, a
     Happening's free item), weak things likelier for the leader and strong ones for those behind;
     the Golden Die only for last place, the Mystery Die only from Lucky Draw. Full hands pick what
     to drop, or keep what they have.
   - **The Shop:** the Villager comes beside the lander: Buy (the round's stock of 3, said to
     everyone as each round starts), Sell something (half its value) or Leave, again after each
     trade until they leave.
   - **The Wandering Trader:** first in round 3 or 4, then every 3 or 4 rounds, for one round on a
     random Item space without a Star (Chris announces it as a skippable cutscene, he drops in, a
     green beam marks it). Passing or landing there stops the walk like a Star; one buyer, then he
     goes.
   - **Chance Time, the Warden, Happening:** as their sections say ("Built in pass 7").
   - **Items:** every item, the zombies, the totems' and the Cursed Totem's rolls ("Items").
   - **Duels:** a Versus space and the Dueling Glove are one duel now: the Referee comes, the
     onlookers bet 3 or 5 coins on either duelist or nothing, one after another in his buttons, he
     reads the odds, and after the duel a right bet wins as much again from the bank and a wrong one
     loses it. The Glove's stake is 10 (doubled in the last rounds like Versus).
   - **The turn fade** keeps in sight the seats a turn's scene is about (an item's rival, Chance's
     leader and last place).
   - **Tests:** Next space outcomes (what the next Chance Time, Warden and Happening do) and Bring
     the Wandering Trader, beside Go to a space.
   - **Lines:** every new thing said is a Draft row in the workshop's dialogue file (5dfb524): the
     NPCs' as one-card scenes, the buttons and the game's own words as texts.
   - **The user's answers (2026-11-18):** the Villager stands by every Shop space and the Referee by
     every Versus space all game (built with the cast, "The board's cast, forks and results"); the
     Witch has no spot of her own and comes to the lander, as built. The Witch's cauldron close-up
     and the Trader's pan in aren't needed.
   - **Not yet:** the map's own Happening flavor (map settings hold only numbers). Gift Exchange's
     passes show now (2026-11-18, "After pass 8").
8. **End of game:** bonus Stars, the tiebreaker, the podium. **Built 2026-11-18** (`end-game.ts`,
   `board-loop.ts` endGame, `stage.ts` the end; "End-of-game bonus Stars", "Tiebreaker", "The end,
   as built"), not yet seen in game: the record kept on every seat, the bonus Stars on the pre-game
   podium with the Allay, the results, the sudden death and the Allay's pick, the board's Final
   podium (new markers), the winner's orbit, and the fade to the lobby.
9. **The rest of the minigames.**
10. **Refinement: cameras and UI** (the user, 2026-11-17): everything that works made to work and
    look better: the cameras, the titles and the HUD, and showing coins as they're won and lost
    (the user couldn't tell when coins came in; more on this from them later). The user's spec,
    2026-11-17: `block-party-ui.md` (the hotbar replaced by the game's own JSON UI, the cameras,
    player animations, gain and loss pops, sounds).
11. **The minigame editor** (the user asked for this pass, 2026-11-18): what the map editor and the
    Panel give a minigame's arena maps, so each minigame of pass 9 is built, marked and tried there.
    Best done before most of pass 9. Everything but the first item is proposed, for the user to
    pick from:
    - **The Minigame podium and its Podium camera** on every arena map. **Built 2026-11-18** ("The
      minigame podium").
    - **Try a minigame from its map:** Preview on an arena map is refused today (an arena plays only
      inside Block Party, `docs/editor.md` "Preview"). It would start a Block Party preview straight
      into that minigame on this map (as Tests' Play a minigame now), bots in the empty seats and
      `/minigame win` at hand, on the test board when no board map is published, and back in Edit
      when it ends.
    - **Covered arena:** a Game setting on the arena map (the Game settings tool, `map.settings`)
      that cuts straight to the arena, the stars fading in and out with no camera zoom out or in
      (`block-party-ui.md`, "The minigame announcement"), for indoor arenas a camera can't come down
      into from above.
    - **The rules camera pan:** a second camera, **Rules camera end**, and the rules camera pans
      slowly from the Start view to it while the tutorial is up.
    - **Points the minigames will need,** as each is written: a **Pot** point (where a Battle's pot
      lands; the arena's middle without one), spots where the game spawns its chickens, carts and
      targets (arena maps keep no mobs), kill regions or Kill Y for a minigame that ends in a fall.
    - **Per-minigame settings:** numbers a minigame reads from each of its maps in the Game settings
      tool (a time limit, a round count, how fast the floor drops), so one minigame can play
      differently on two maps.
    - **The tutorial's words in the dialogue tool:** each minigame's name, its objective per side and
      its controls as texts with the Tutorial panel delivery (`block-party-ui.md`, "The minigame
      tutorial"), in place of the code's (`minigames/kit.ts`, tutorial), so the user words them.
    - **A picture on the wheel:** the announcement's wheel shows names only; it could show each
      minigame's picture, the Minigame Thumbnail the user takes on its arena map (`docs/editor.md`,
      "Pictures").
    - **Rows a map can do without** (the Panel's Checklist Features): the Podium camera now, more as
      each minigame's checklist is written.

## Defaults

Every question is answered. These were taken without one; the user can change any of them.

- Coins never go below 0: every payment is capped at what the payer has.
- A 4th item or a 3rd special die: the player picks which one to drop.
- No computer players for now.
- The zombie takes its coins at the start of its target's turn.
- A Half-price Star lasts until it's used.
- Chance Time growing later: coin amounts go up by half in the last third of the game; Coin Swap,
  Position Shuffle and Shooting Star come only in the last third.
- Reduced motion is each player's own setting, in their settings (`/blockparty:settings`).
- Jump is the one button for going ahead: hitting the die, Ready, and voting to skip.
- The plan's other "proposed" items: Happening's share goes to Blue on maps without it, the Star
  moves at least ~30% of the loop away on bigger boards, the beacon beam is a model, results play on
  the board's podium, the space blocks (since replaced by the space markers), and the NPC entities.
- Space markers (2026-11-18): the size above ("Space markers"), 6 pixels tall, the bottom of the
  user's 6 to 8; the Warden's cyan concrete (sculk's texture is animated); a space lights for any
  piece in sight on it, not only the turn's; the highlight white, pulsing between 0.1 and 0.4 over
  1.2 s.
- Pass 7 (2026-11-18): one item a turn; Chance's potions colored by kind; the Chance, Warden and
  prize weights above; the Villager item worth 6 (it isn't in the Shop); a zombie's 3 coins go to the
  bank; Silenced takes the next prize, not a purchase; the Golden Totem's extra die counts double
  (not the whole roll); the Cursed Totem halves the whole roll after a totem; Coin Swap is the
  lander's pick; a bot buys in the Shop or from the Trader only when it keeps 5 coins over.
- The cast pass (2026-11-18, "The board's cast, forks and results, as built"): every height, speed
  and distance there; a fork's focus starts on Left; Middle for any way between; a red balloon; the
  Witch's smoke grayish purple; results go on at the leader's or the turn's player's jump and still
  go by themselves after their hold; the seat turns to the NPC as well as the NPC to the seat.
- The minigame podium (2026-11-18): 4 spots, 1st to 4th; the Podium camera can be turned off; the
  results stay 5.5 seconds on it with no jump to go on (the results screen on the board after has
  one); a pose is held from where the clip starts back to rest, the held poses made from the clips
  themselves; the stand-in podium's columns (gold 3, iron 2, copper 1, smooth stone) facing the
  rules camera's side; middle places neither celebrate nor are sad (as `minigameMoods` already had).
- The screens before a minigame (2026-11-18): "Minigame!" 1.2 s alone, then the format 1.2 s, then the
  wheel's 17 steps slowing from 2 to 11 ticks and 1.8 s on the pick; the wheel's names in a column
  (a list, not a round wheel: JSON UI can't turn text) with the user's magenta highlight while it
  spins and Minecade blue on the pick; the tutorial panel 180 units wide at the left; the Ready strip
  "Press [jump] when ready 1/4", "Ready! Waiting for the others 3/4" once jumped; each test
  minigame's objective and controls as written in its code.
- The end (pass 8, 2026-11-18): the bonus Stars given on the pre-game podium (everyone in turn order
  facing its camera), not on the board or the final podium; the award list and how each is measured
  above (the plan's kills, fewest deaths and last-seconds wins left out, "most deaths" as times out);
  the award names; a streak needs 2; the bonus Stars and the final podium skippable cutscenes, the
  sudden death not; the tiebreaker paying no coins; only seats here at the end ranked; on the final
  podium the winner celebrating and last place sad, held (as on the minigame podium); every fade,
  ease and orbit length in `stage.ts`; Chris past the end of a final podium with no marker for him;
  the Allay's dance at its hello and Chris's celebration as he names the champion (seeded actions).
- Moving over the board (2026-11-20): every number in "Moving over the board" (a step 0.6, a jump up
  to 1.3, gaps looked for 4.5 ahead, cracks under 0.8 walked over, drops down to 10, climbing 0.15 a
  tick at 0.25 from the wall, slopes 1 up and 1.6 down); a hurdle hopped over in one arc; no leap up
  a wall with nothing to climb (not picked): the piece is put on the next space; pieces never walk
  into water; the cameras' height eased; the test board's layout, 8 blocks apart, and its blocks
  (stone brick stairs, smooth stone slabs, white carpet). Pass 2: the lip of 0.1 over edges and
  climbs' tops, jumps leaning hard to 0.42, 70% of the gap to the plan each tick, lifted after 2
  stalled ticks and put on the next space after 10 more.
