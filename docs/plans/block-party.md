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
idle. Nothing is open; "Defaults" at the end lists what was taken without a question.

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
| In the lobby | The board, the length (10, 15 or 20 turns) and Chris's tutorial, as game options |
| Starting coins | 10, handed out by Chris |
| Bonus Stars | 3 with 3 or 4 players; 2 with 2 players (at most 1 each) |
| Rolling | Jump to hit the die |
| Hotbar | A Block Party look drawn with JSON UI: Items and Dice open bars of their own, only the slots in use show, and health, hunger and XP are hidden (see "Turns and controls") |
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

## The Warden

- **Sculk Tax:** lose 5-10 coins to the bank.
- **Hush Money:** pay 3 coins to each other player.
- **Star Tax:** pay 3 coins per Star you hold.
- **Silenced:** lose your next item.
- **Slow Curse:** your next roll uses the Slow Die.
- **Zombie Curse:** a zombie follows you for 3 rounds.
- **Sonic Boom** (rare): the leader loses 1 Star.

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

## Items

At most 3 held.

- **Stone Totem:** roll an extra die next turn.
- **Golden Totem:** roll an extra die that doubles, next turn.
- **Ender Pearl:** switch places with a player (the Enderman performs it).
- **Cursed Totem:** used on a rival: their next roll is halved, rounded up.
- **Dueling Glove:** forces a 1v1 with 10 coins at stake.
- **Lightning Strike:** the player with the most Stars (then coins) gives 10 coins (capped at what they have) to the player with
  the fewest. Used on yourself, it gets rid of a zombie, but you still lose coins. Coins only, never
  Stars.
- **Zombie Spawn:** a zombie follows a rival and takes 3 coins every round. It leaves when the
  target finishes top 2 in a minigame, after 3 rounds, when the target has no coins left to take, or
  when the target uses an Iron Golem or a Lightning Strike.
- **Iron Golem:** shakes down a player for up to 5 coins, or removes a zombie from you.
- **Villager:** trade a die or an item for coins: half its value, rounded down (see "Dice"). Not
  on the final turn.

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

**Corners** (the user's second look): the walk slows into every corner and the end and speeds up
out of them (smoothstep over about 2 blocks), and the turn is spread over a few ticks while it's
slow, so a corner isn't taken in one sweep. Where a piece stops on a space (and the back and forth
some spots showed) is settled with the board markup's spaces (pass 3).

### Turns and controls

- **The hotbar** (the user's idea): a Block Party look drawn with JSON UI, the vanilla hotbar
  restyled rather than hidden and replaced, so scrolling, number keys, controller bumpers and
  tapping on a touch screen all still pick a slot. The selected item's name and what it does show
  over it. The spike showed all of this works. After it the user asked for:
  - **Bars of their own:** the main bar is Items, Dice and the menu (standings, settings). Using
    Items swaps the bar for the items held, and Dice for the dice held (the standard one and any
    special ones), each with a Back slot.
  - **Only the slots in use show,** centered: two dice show as two slots and Back. Empty slots draw
    nothing, and a scroll skips them.
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

**Pre-game**
- Intro flyover of the board (D, spline).
- Player introductions, one at a time (S close-up or slow orbit).
- Turn-order roll: a group shot, each player's die on its own pedestal (S).
- Turn-order reveal (S, podium).
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
- **At play time** the board's server has every published arena with it (how is a build question:
  saved as structures the server loads). When a minigame is picked, the game places its arena in
  the slot of the board's arena background (see "Arena backgrounds"), loads it with a ticking area,
  moves the players in behind a fade (Minecade's logo fades in on the black if it lasts), and
  clears it afterward. The next play places a fresh copy, so floors that fall away or get mined
  (TNT Run, Spleef Duo, Hot Floor, Mining Race) are always whole. This is how Build Swap's arenas
  already work (minigame-core's `game/arenas.ts`, `docs/spike-results.md`, "Arena tiles"), except
  that the arena comes from another map.
- Nobody needs the board loaded during a minigame, so the arena has most of the world's 300 ticking
  chunks to itself.

### Board maps

**Pass 3 so far (2026-11-15):** minigame-core's board kit (`src/board`: spaces in map.json,
their edits, the dealer, the board check), Block Party's `map.board` and its optional Arena slot (a
40 x 60 region, switches in Checklist Features while the spike plays Probe's maps), and game Edit's
Spaces tool with `/boardcheck` (`docs/editor.md`). The Panel's Spaces tool is next. Not checked
yet: special event markup, camera anchors and stages (passes 6 and later), and the free block beside
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

- Leave a flat 2.5x2.5 spot for each space: four pieces can share it, one on each corner.
- The game lays each space's type on its spot at the start, in vanilla blocks (proposed: Blue blue
  concrete, Red red concrete, Item a gold block, Shop an emerald block, Chance Time purple concrete,
  Warden sculk, Versus orange concrete, Happening pink concrete, Start white concrete). A re-deal
  never means rebuilding, and nothing is textured. Build the path, not colored pads.
- Space them 4-5 blocks apart, center to center, 4.5 by default on a straight stretch. Pieces
  move in straight lines between spaces, so put a space at every corner of the path.
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
| Pre-game lineup, one spot per player, and the turn-order pedestals | Game marker tool |
| NPC stages: Chris, Villager (the shop counter), Witch (the cauldron), Referee, and the Allay's landing spot. Each is the NPC's spot and the guest's spot (where the player stands to talk), both with a facing; the conversation shots are worked out from the two, and a camera named for the stage replaces the default | Game marker tool |
| A spectator or queue spawn | Spawn tool |

Chris at the Star, the Enderman's swaps and the Trader's visits happen on the board itself, framed
from the spaces.

**Map settings** for a board (Panel and game Edit): the NPCs' vanilla variants (the Villager's biome type and profession, Chris's pig variant), the
Happening flavor (a few lines of text, one picked each time, and a sound), the special event and
its timing, and the map's time of day.

**Size:** 36-45 spaces, longer if the theme wants it. About 100x100 blocks lets one overview camera
show the whole board, even at a console's render distance. A longer board leans on its region
anchors.

### /boardcheck

The board's checks show in both editors' checklists, each flagged space clickable (the Panel flies
there). `/boardcheck` in game Edit prints the report in chat. Errors block Publish like any
checklist problem; warnings don't.

- **Errors:** exactly one Start; every space reachable; every path returns to the loop; no dead
  ends; branches have 2-3 exits; enough Star candidates; both opening spots present; every Star
  candidate still reachable when a path event closes a route.
- **Warnings:** a type's share more than ~3% off target; adjacent reds; Wardens or Versus spaces too
  close; a ~12-space stretch with no Item; shortcuts too strong or too weak (against ~10%); Star
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
designed.

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
4. **The board loop:** turns, dice, moving pieces, branches, spaces, Stars, coins.
5. **Minigame plumbing:** formats, placing arenas into the arena background's slot, results and payouts, with a first few minigames.
6. **NPCs and cameras:** stages, conversations, the shot list.
7. **Items, dice, Chance Time, the Warden, the shop and the Trader.**
8. **End of game:** bonus Stars, the tiebreaker, the podium.
9. **The rest of the minigames.**

## Defaults

Every question is answered. These were taken without one; the user can change any of them.

- Coins never go below 0: every payment is capped at what the payer has.
- A 4th item or a 3rd special die: the player picks which one to drop.
- No computer players for now.
- The zombie takes its coins at the start of its target's turn.
- A Half-price Star lasts until it's used.
- Chance Time growing later: coin amounts go up by half in the last third of the game; Coin Swap,
  Position Shuffle and Shooting Star come only in the last third.
- Reduced motion is each player's own setting, in the hotbar's menu.
- Jump is the one button for going ahead: hitting the die, Ready, and voting to skip.
- The plan's other "proposed" items: Happening's share goes to Blue on maps without it, the Star
  moves at least ~30% of the loop away on bigger boards, the beacon beam is a model, results play on
  the board's podium, the space blocks, the restyled hotbar, and the NPC entities.
