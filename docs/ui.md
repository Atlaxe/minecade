# Look and feel

How Minecade talks to players and how its lobby UI is built. Later parts of the UI pass (the
terminal, hologram and menus) add their sections here.

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

- **Lobby:** nothing. Starting a game shows titles and a countdown instead.
- **Games:** lives in games with lives, "Respawning in N" while respawning, and "Waiting for
  players" before the match. A game can show more by overriding `hud(name)`.

Every match has a clock: `timeLimitSeconds` in `game.config.ts`, 5 minutes when a game doesn't
set one (`DEFAULT_TIME_LIMIT_SECONDS`), or `0` for no limit. Games that override `play()` should
use `this.timeLimit` so the default applies to them too. When time runs out, `onTimeUp()`
decides the result (the highest score, or a draw).

The clock shows top right with a clock icon, turning red in the last 30 seconds. Bedrock has no
script API for placing text on the HUD, so it rides on the action bar: games send
`::T04:59|<rest of the line>` (`::R` in the last 30 seconds, see `hudLine()` in
`packages/minigame-core/src/hud.ts`), and the core resource pack's `ui/hud_screen.json` splits it:
the clock goes top right and the rest shows as the normal action bar line. Without the pack the
line still reads as text. To see JSON UI errors in the client, turn on Settings, Creator, Content
Log GUI.

## Countdown sounds

Every countdown (the match start, each round, and the lobby's "Joining" countdown) plays a tick
for each second, a bell for 3, 2 and 1, and a flourish with "Go!" (`CHIMES` and `countdownChime()`
in `hud.ts`). Games can play them too with `this.chime("bell")`.

## The core resource pack

`packages/minigame-core/resource_pack/` goes to every server, before the server's own pack: the
HUD clock now, and other shared UI later. The build stamps every resource pack's version from a
hash of its files, because clients cache server packs by UUID and version and would otherwise keep
an old copy. Images come from `tools/assets/make-assets.py` (Pillow): rerun it after changing the
art and commit the PNGs it writes.
