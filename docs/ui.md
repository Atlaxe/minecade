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

## The lobby terminal

The lobby's menus live on a terminal in the middle of the lobby, not on items. One player uses it
at a time; a public hologram above it shows everyone what they're doing.

| Screen | The terminal's user sees | Everyone sees (the hologram) |
|---|---|---|
| Idle | nothing | The idle picture (the logo, "Tap the terminal") |
| Main | The themed menu: logo, Play and Stats side by side | Play and Stats, the chosen one lit, and the user's name |
| Play | A grid of game tiles: icon, name, players needed (red when there aren't enough) | The game grid picture and the user's name |
| Game | Left: map tiles (Random first, the chosen one outlined). Right: the game's name and info, a red warning when there aren't enough players, settings (Teams: Pick or Random, for team games), Start | The game picture with the game's icon, "Map: ...", and the user's name |

Closing a menu goes back one step (game screen to grid to main menu); closing the main menu ends
the session. Team picking and the stats screens get their own screens next.

**Pieces:**

- **The console:** nine `minecade:terminal` blocks (`lobby/behavior_pack/blocks/terminal.json`),
  one block type with a `minecade:part` state from 0 to 8 (reading order from the north-west
  corner). The top faces are drawn for the north-west corner and the north edge, and each part
  rotates its block. The center is the glowing projector. Tapping any part calls the
  `minecade:terminal` custom component, registered in `main.ts` at startup.
- **The hologram:** one `minecade:holo_display` entity (`behavior_pack/entities/holo_display.json`,
  `resource_pack/entity/...`). Its model is one 3x3 panel copied to all four sides by rotating it
  (`panel_s`, `panel_e`, `panel_n`, `panel_w`), so every side shows the same, unmirrored picture,
  plus a projection beam. Bedrock entity models flip the x axis, so the panel's UV runs backwards
  (`"uv": [48, 0], "uv_size": [-48, 48]`) to read correctly. The `minecade:screen` property
  (client-synced) picks the picture from `Array.screens` in
  `render_controllers/holo_display.render_controllers.json`; the order must match `SCREENS` in
  `scripts/hologram.ts`.
- **The game icon:** the hologram's `minecade:game` property picks an icon (from `Array.icons` in
  the `holo_icon` render controller), shown on each side on the game screen. The build fills that
  list from the games in registry order (icon 0 is none), and the lobby script uses the same order.
- **Names and info:** text fixed to each of the four sides (`TextPrimitive`s in
  `scripts/hologram.ts`): the user's name, and the chosen map on the game screen. If the text ever
  reads from the inside, add 180 to every yaw in `SIDES`.
- **Placement:** the map's `points.terminal` is the middle console block. At boot the lobby
  keeps that area loaded (a ticking area), places the console and spawns the hologram, and
  checks every 5 seconds that they're still there.
- **The lock:** `TerminalController` (`scripts/terminal-controller.ts`, unit-tested with ports).
  The session ends when its player closes the menu, starts a game, leaves, walks more than 8
  blocks away, or leaves it alone for 2 minutes.

**The game screen's buttons** sit at fixed places so the themed layout can split them into two
columns: map tiles first (8, padded with empty buttons; the selected one starts with an invisible
`SELECTED` mark), then Start (button 8), then the settings (buttons 9 and 10). The layout pins
Start and the settings by `collection_index`. See `scripts/game-screen.ts`. Start sends
`start_game` with the settings, the orchestrator passes them to the game server as `GAME_SETTINGS`,
and a game reads them from `ctx.vars.settings` (random teams skips team picking).

**Themed menus:** a form whose title starts with a layout mark (formatting codes that never
render, `LAYOUT` in `scripts/menus.ts`) gets Minecade's layout from the lobby resource pack:
`ui/server_form.json` merges a second form factory into the vanilla screen and hides the vanilla
form for marked titles, and `ui/minecade_forms.json` holds the layouts. Without the pack, marked
forms are plain forms with a readable title. A test checks the marks match the pack.

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

## The art

Every image is a placeholder from `tools/assets/make-assets.py` (Pillow), meant to be redrawn by
hand. The script only writes images that don't exist yet; `--force` regenerates all of them and
overwrites any edits. Images are stretched to their display size, so keep each one's proportions.

| Image | Shown as | Art size |
|---|---|---|
| `packages/minigame-core/resource_pack/textures/minecade/hud/clock.png` | HUD clock icon, 10x10 | 16x16 |
| `lobby/resource_pack/textures/minecade/ui/logo.png` | Main menu logo, 232x50 | 1072x240, transparent background |
| `lobby/resource_pack/textures/minecade/ui/panel.png` | Main menu background, 300x116 | 600x232 |
| `lobby/resource_pack/textures/minecade/ui/tile_default.png`, `tile_hover.png`, `tile_pressed.png` | Menu buttons, 136x34 | 272x68 |
| `lobby/resource_pack/textures/minecade/ui/icon_play.png`, `icon_stats.png` | Button icons, 20x20 | 64x64 |
| `lobby/resource_pack/textures/minecade/ui/panel_grid.png` | Game grid background, 430x300 | 860x600 |
| `lobby/resource_pack/textures/minecade/ui/tile_game_default.png`, `_hover`, `_pressed` | Game tiles, 96x78 | 192x156 |
| `lobby/resource_pack/textures/minecade/ui/panel_game.png` | Game screen background, 440x232 | 880x464 |
| `lobby/resource_pack/textures/minecade/ui/tile_map_default.png`, `_hover`, `_pressed` | Map tiles, 98x38 | 196x76 |
| `lobby/resource_pack/textures/minecade/ui/tile_map_selected.png` | Drawn over the chosen map's tile, 98x38 | 196x76, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/button_default.png`, `_hover`, `_pressed` | Start and setting buttons, 200x32 | 400x64 |
| `lobby/resource_pack/textures/minecade/ui/icon_random.png`, `icon_map.png` | Map tile icons (Random, and maps without their own icon), 18x18 | 64x64 |
| `games/<id>/icon.png` | The game's tile icon (36x36) and its hologram icon | 128x128, required for every game |
| `games/<id>/maps/<map>/icon.png` | A map tile's icon, 18x18 (optional) | 64x64 |
| `lobby/resource_pack/textures/minecade/holo/idle.png`, `main.png`, `main_play.png`, `main_stats.png`, `games.png`, `game.png` | Hologram screens, 3x3 blocks on all four sides; `game.png` gets the game's icon over its upper middle | 512x512 (square), additive |
| `lobby/resource_pack/textures/minecade/holo/beam.png` | Projection beam, two crossed planes 2 wide by 2.5 tall | 128x256, additive, the projector at the bottom |
| `lobby/resource_pack/textures/minecade/blocks/terminal_side.png` | Console sides | 16x16 |
| `lobby/resource_pack/textures/minecade/blocks/terminal_corner.png`, `terminal_edge.png`, `terminal_center.png` | Console tops | 16x16; the corner is drawn as the north-west corner (rims on the north and west sides) and the edge as the north edge, and the blocks rotate them into place |

The logo source is `tools/assets/source/minecade-title.png` (the orange original); the script
recolors it to holographic blue.
