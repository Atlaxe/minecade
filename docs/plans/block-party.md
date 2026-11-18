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
- Shortcuts save about 10% of the loop.
- At most one special event per map, of one of four types written in code: path toggle, teleport,
  time-of-day modifier, roaming hazard (what the map marks for each: "Board maps").
- Events never change the Star price or minigame payouts.

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
passes a random item of each holder's to the next in turn order, all at once.

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

## Tiebreaker

Checked after the bonus Stars:

1. Most Stars.
2. Most coins.
3. A sudden-death minigame among only the tied players, picked at random from a short pool (Quick
   Draw, Hot Floor, Sumo Duel). FFA if 3 or more are tied.
4. If still tied, the Allay picks the winner at random.

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
| `letters` | One or two characters standing in for its icon in the item panel |
| `block` | The block floating over the roller's head while it's out, until it has a texture |
| `ink` | The color of the numbers on its model's faces, `"#rrggbb"` (`#1e1e1e` if left out); a face can have its own |
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

A roll's coins, events and lines come right after the roll's title, face by face, before the walk.
The lines the dice say now are the user's Dice texts (`dice.triple`, `dice.golden`,
`dice.risk.zero`, `dice.cursed.lucky` and `.unlucky`, `dice.mystery.*`). Bots hold only the standard
die until items and the Shop hand dice out; the Tests' Dice and items held picks any two of the
file's dice.

#### The die model

The die over the roller's head (`blockparty:die`) is drawn in two layers, each its own render controller on the one entity, both turning with the spin (they share the bone `die`):

1. **The body:** the die's `texture` on an 8 x 8 x 8 cube (`geometry.blockparty.die_plain` for one square on every face, `geometry.blockparty.die` for six).
2. **The faces:** each face's value stands half a body pixel off it, in pixels half a body pixel wide. A face's `show` text is drawn in the game's own Minecraft Ten font (the "10" font: digits are 7 x 10 pixels, so they come out 5 units high on the 8-unit face, two of them side by side a pixel apart) in its ink; a face with a picture (`textures/blockparty/dice/faces/<show>.png`, best 16 x 16 with the picture inside a margin, see-through around it) shows the picture, each pixel a small block of its color (a picture over 16 pixels across is shrunk to fit the face). Text wider than 14 pixels (some letter pairs) is shrunk to fit.

`tools/blockparty/dice-pack.ts` makes the faces from the dice file: one geometry per die (`resource_pack/models/entity/die_faces.geo.json`, cubes colored from `textures/blockparty/die_palette.png`, one pixel per color), and the lists in the client entity and render controllers. It reads the font from Minecraft on this PC (`resource_packs/vanilla/font/minecraft-ten.ttf`, or `MINECRAFT_TEN`), never copying the font itself into the repo. `tools/blockparty/dice-model.json` keeps what it last made the model from; `test/dice.test.ts` compares it with the dice file and the pictures, so the tests fail until the tool has run again.

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
  markers", below), and four pieces share its pedestal, one on each corner. A re-deal never means
  rebuilding. Build the path, not colored pads.
- Space them 4-5 blocks apart, center to center, 4.5 by default on a straight stretch (a gap of 1
  or 2 blocks between markers). Never closer than 3 along both x and z: the markers would overlap
  (`/boardcheck` warns). Pieces move in straight lines between spaces, so put a space at every
  corner of the path.
- Leave a free block beside every Star candidate and every Item space: Chris stands beside the
  Star, and the Wandering Trader beside its Item space.
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
| Podium set: 4 spots, 1st to 4th, facing front | Game marker tool |
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

**Map settings** for a board (Panel and game Edit): the NPCs' vanilla variants (the Villager's biome type and profession, Chris's pig variant), the
Happening flavor (a few lines of text, one picked each time, and a sound), the special event and
its timing, and the map's time of day.

**Size:** 36-45 spaces, longer if the theme wants it. About 100x100 blocks lets one overview camera
show the whole board, even at a console's render distance. A longer board leans on its region
anchors.

### Space markers

**Built 2026-11-18** (the user asked for 3D markers in place of the colored block pads). Every space
is a model the game stands on the floor at the start (`blockparty:space`, `space-markers.ts`), in
two parts, each in its type's block texture:

| Part | Size | Where |
|---|---|---|
| **Perimeter** | 48 x 48 pixels (3 x 3 blocks), 2 pixels tall | On the floor: the marker's whole footprint, its middle on the space's block |
| **Pedestal** | 40 x 40 pixels (2.5 x 2.5 blocks), 6 pixels tall | On the perimeter, centered: its top 8 pixels (half a block) over the floor. The pieces stand on it |

A pixel is a sixteenth of a block, as in a block's texture. The user's ranges: the perimeter 1-2
pixels tall, the pedestal 6-8.

**Spacing and room:**

- Spaces 4-5 blocks apart, center to center (a gap of 1 or 2 blocks between footprints); 3 at the
  least, where two markers touch. `/boardcheck` warns about any closer (the board config's
  `footprint`, 3).
- A flat 3 x 3 floor under each, the layer above it empty, and room to stand over that.
- The pieces: each one's middle 0.7 blocks from the space's middle on a corner, so the four take 2 x 2
  blocks of the pedestal's 2.5 x 2.5 (a piece is 0.6 wide). They stand on its top, 0.5 over the floor.
- NPCs beside a space (Chris by the Star, the Wandering Trader, the Villager, the Witch) stand on the
  floor 2.5 blocks from its middle, outside the footprint: leave that block free.

**Standing on it.** The pedestal is stood on for real: under it the game puts an invisible block,
`blockparty:space_floor`, in each block the pedestal covers, as tall as its top (a slab's height), so
a walking piece steps up onto it and down off it. A block the map already has in that layer is left
alone.

**Lit up** (emissive, to show the difference): a marker lights while a piece anyone can see stands
on it (its middle over the pedestal, so a walk lights each space it crosses; a seat faded out on
someone else's turn doesn't count) and while a cutscene's shot is on the space (a Star's reveal and
its move, the Wandering Trader arriving, a Happening). Lit is drawn at full light, unshaded, with the
highlight's color laid over it, pulsing. The Tests menu's **Light every space** lights them all, to
look at.

**Editing the textures:** `games/blockparty/spaces.json`. Each type has a `pedestal` and a
`perimeter`: any of Minecraft's block textures by its path (`textures/blocks/concrete_blue`, no
`.png`), or a 16 x 16 picture of your own put in
`games/blockparty/resource_pack/textures/blockparty/spaces/` and named
`textures/blockparty/spaces/<name>`. Pictures must be square: an animated texture (sculk's) is its
frames one under another and shows squashed, which is why the Warden is cyan concrete. Its
`highlight`: `color` (`"#rrggbb"`), `strength` (how much of the color, 0 to 1), `pulse` (up and down
by this much) and `seconds` (one pulse).

**Editing the model:** `games/blockparty/resource_pack/models/entity/space.geo.json`, a Bedrock
entity model: open it in Blockbench (File, Open Model). Its two bones are `perimeter` and
`pedestal`; a cube is in the part its bone's name starts with, or the bone it's inside. Use cubes of
any size, turned or not: the tool cuts every cube on the block grid (the model's middle on a block's
middle) and maps the block texture onto each piece as the block there would show it, so the marker
looks laid in real blocks. A face taken off a cube in Blockbench stays off. To see it textured in
Blockbench, give it any 16 x 16 block texture. The game reads its sizes from the model: the floor is
the pedestal's widest reach from the middle (the same both sides) and as tall as its top. Limits:
within 24 pixels of the middle (3 blocks across), the pedestal's top at most 16 (more than 9 and a
walking piece may stop at its edge: the tool warns).

**After a change** to either: `npx tsx tools/blockparty/space-pack.ts`. It checks both, cuts the
model in place and writes the client entity's textures, its four render controllers (each part
plain and lit), the floor block (`behavior_pack/blocks/space_floor.json`) and
`games/blockparty/space-model.json` (what the game reads). `test/spaces.test.ts` fails until it has
run. Then merge and Restart.

### /boardcheck

The board's checks show in both editors' checklists, each flagged space clickable (the Panel flies
there). `/boardcheck` in game Edit prints the report in chat. Errors block Publish like any
checklist problem; warnings don't.

- **Errors:** exactly one Start; every space reachable; every path returns to the loop; no dead
  ends; branches have 2-3 exits; enough Star candidates; both opening spots present; every Star
  candidate still reachable when a path event closes a route.
- **Warnings:** a type's share more than ~3% off target; adjacent reds; two spaces whose markers
  overlap (closer than 3 blocks both ways); Wardens or Versus spaces too close; a ~12-space stretch with no Item; shortcuts too strong or too weak (against ~10%); Star
  candidates bunched together, or one without others 10-25 spaces away; a missing camera anchor or
  stage; a Star candidate or Item space with no free block beside it.
- **Report:** counts by type against the targets, route lengths (the loop and each shortcut), and
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
it has none. The checklists so far, each with the Arena box and a spectator spawn:

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
- **Results and the winner highlight** play back on the board's podium set, so arenas need no podium
  (proposed).
- **Its own time of day:** the game sets the world's time when the minigame starts and puts the
  board's back after.
- **No saved mobs or loose entities:** the game spawns chickens, carts and targets at points the map
  marks.
- **Kill Y, kill regions, bounds** and the minigame's own points and regions, as its checklist asks,
  within the options below.

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
   - **Not yet:** blocks from the dialogue tool, the other NPCs' stages (the Villager, the Witch,
     the Allay: with their passes), the board view's modes and the turn shot, button prompts per
     device, heads in the skip strip (names for now). Player animations and the lines' actions
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
   - **Not yet:** NPC stages for the Villager and the Witch (they stand beside the lander's space),
     the map's own Happening flavor (map settings hold only numbers), shots beyond the two-shots and
     a space cut (the Witch's cauldron close-up, the Trader's pan in), Gift Exchange's passes shown
     anywhere but chat.
8. **End of game:** bonus Stars, the tiebreaker, the podium.
9. **The rest of the minigames.**
10. **Refinement: cameras and UI** (the user, 2026-11-17): everything that works made to work and
    look better: the cameras, the titles and the HUD, and showing coins as they're won and lost
    (the user couldn't tell when coins came in; more on this from them later). The user's spec,
    2026-11-17: `block-party-ui.md` (the hotbar replaced by the game's own JSON UI, the cameras,
    player animations, gain and loss pops, sounds).

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
- Space markers (2026-11-18): the sizes above ("Space markers"); every perimeter smooth quartz but
  Start's, which is gold; the Warden's pedestal cyan concrete (sculk's texture is animated); a space
  lights for any piece in sight on it, not only the turn's; the highlight white, pulsing between 0.1
  and 0.4 over 1.2 s.
- Pass 7 (2026-11-18): one item a turn; Chance's potions colored by kind; the Chance, Warden and
  prize weights above; the Villager item worth 6 (it isn't in the Shop); a zombie's 3 coins go to the
  bank; Silenced takes the next prize, not a purchase; the Golden Totem's extra die counts double
  (not the whole roll); the Cursed Totem halves the whole roll after a totem; Coin Swap is the
  lander's pick; a bot buys in the Shop or from the Trader only when it keeps 5 coins over.
